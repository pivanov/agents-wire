import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { definitionFor } from "@/catalog/index";
import { WireError } from "@/errors";
import { createWireHost, type IWireHost } from "@/runtime/host";
import type { TAgentId } from "@/types/agent";
import type { IAskOptions, ISessionOptions } from "@/types/options";
import type { IAskResult } from "@/types/results";

interface IWorker {
  readonly agent: TAgentId;
  readonly host: IWireHost;
  readonly sessionId: string;
  busy: boolean;
}

interface IWaiter {
  resolve: (worker: IWorker) => void;
  reject: (cause: unknown) => void;
  cleanup?: () => void;
}

export interface IPoolOptions extends ISessionOptions {
  readonly agents: readonly TAgentId[];
  readonly capacity?: number;
}

export interface IPoolAskResult extends IAskResult {
  readonly worker: TAgentId;
}

export interface IAgentPool {
  readonly cost: ICostTracker;
  readonly size: number;
  ask: (prompt: string, options?: IAskOptions) => Promise<IPoolAskResult>;
  drain: () => Promise<void>;
  close: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}

const distributeAgents = (agents: readonly TAgentId[], capacity: number): TAgentId[] => {
  if (agents.length === 0) {
    throw new WireError("retry-exhausted", "pool requires at least one agent");
  }
  const slots: TAgentId[] = [];
  for (let index = 0; index < capacity; index += 1) {
    const agent = agents[index % agents.length];
    if (agent) {
      slots.push(agent);
    }
  }
  return slots;
};

const spawnWorker = async (agent: TAgentId, options: ISessionOptions): Promise<IWorker> => {
  const definition = definitionFor(agent);
  const host = await createWireHost(definition, { ...options, agentId: agent });
  const sessionId = await host.newSession({
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
  return { agent, host, sessionId, busy: false };
};

export const createAgentPool = async (options: IPoolOptions): Promise<IAgentPool> => {
  const capacity = options.capacity ?? options.agents.length;
  if (capacity <= 0) {
    throw new WireError("retry-exhausted", "pool capacity must be > 0");
  }
  const slots = distributeAgents(options.agents, capacity);

  // allSettled instead of all so a single failed spawn doesn't abandon
  // the workers that already came up — close survivors before throwing.
  const settled = await Promise.allSettled(slots.map((agent) => spawnWorker(agent, options)));
  const workers: IWorker[] = [];
  const failures: unknown[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      workers.push(result.value);
    } else {
      failures.push(result.reason);
    }
  }
  if (failures.length > 0) {
    await Promise.allSettled(workers.map((w) => w.host.close()));
    throw new WireError("spawn-failed", `Pool spawn failed: ${failures.length}/${slots.length} workers could not start`, {
      cause: failures[0],
    });
  }
  const cost: ICostTracker = createCostTracker({
    ...(options.maxCostUsd !== undefined ? { budgetUsd: options.maxCostUsd } : {}),
    ...(options.costEstimator ? { estimator: options.costEstimator } : {}),
    ...(options.onCostUpdate ? { onUpdate: options.onCostUpdate } : {}),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
  });

  const waiters: IWaiter[] = [];
  const drainResolvers: Array<() => void> = [];
  let closed = false;

  const signalDrainIfIdle = (): void => {
    if (drainResolvers.length === 0) {
      return;
    }
    if (workers.some((worker) => worker.busy)) {
      return;
    }
    for (const resolveDrain of drainResolvers.splice(0)) {
      resolveDrain();
    }
  };

  const acquire = (signal?: AbortSignal): Promise<IWorker> => {
    if (closed) {
      return Promise.reject(new WireError("connection-closed", "Pool is closed"));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new WireError("cancelled", "Pool acquire aborted"));
    }
    const free = workers.find((worker) => !worker.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise<IWorker>((resolve, reject) => {
      const waiter: IWaiter = { resolve, reject };
      waiters.push(waiter);
      if (signal) {
        const onAbort = (): void => {
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) {
            waiters.splice(idx, 1);
          }
          reject(signal.reason ?? new WireError("cancelled", "Pool acquire aborted"));
        };
        // `cleanup` removes the abort listener (called when the waiter is
        // claimed by release() or freed by close()). It is NOT the abort
        // handler itself.
        waiter.cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  };

  const release = (worker: IWorker): void => {
    worker.busy = false;
    // If close() landed while ask() was in flight, don't hand the worker to a
    // queued waiter — close() is mid-await on host.close() and the new caller's
    // host.prompt() would race with the in-flight tear-down. close() flushes
    // pending waiters with connection-closed; let that handle them.
    if (closed) {
      return;
    }
    const next = waiters.shift();
    if (next) {
      next.cleanup?.();
      worker.busy = true;
      next.resolve(worker);
      return;
    }
    signalDrainIfIdle();
  };

  const ask = async (prompt: string, askOptions: IAskOptions = {}): Promise<IPoolAskResult> => {
    if (closed) {
      throw new WireError("connection-closed", "Pool is closed");
    }
    const worker = await acquire(askOptions.signal);
    // Outer try/finally guarantees release(worker) runs even if
    // host.prompt() throws synchronously before the stream is built.
    try {
      const stream = worker.host.prompt(worker.sessionId, {
        prompt,
        ...(askOptions.systemPrompt ? { systemPrompt: askOptions.systemPrompt } : options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(askOptions.command ? { command: askOptions.command } : {}),
        ...(askOptions.signal ? { signal: askOptions.signal } : {}),
        ...(askOptions.meta ? { meta: askOptions.meta } : {}),
      });
      try {
        for await (const event of stream) {
          if (event.type === "usage") {
            // cost.record() throws BudgetExceededError when budgetUsd is
            // set and the threshold is hit — no separate enforceBudget
            // call needed (it would be a redundant snapshot read).
            cost.record(event.usage, worker.agent, askOptions.model ?? options.model);
          }
        }
        const result = await stream.completion;
        // Tracker's onUpdate already fired options.onCostUpdate per usage event.
        return { ...result, cost: cost.snapshot, worker: worker.agent };
      } catch (err) {
        try {
          await stream.cancel();
        } catch {
          /* swallow cancel-on-error */
        }
        throw err;
      }
    } finally {
      release(worker);
    }
  };

  const drain = async (): Promise<void> => {
    if (!workers.some((worker) => worker.busy)) {
      return;
    }
    await new Promise<void>((resolveDrain) => {
      drainResolvers.push(resolveDrain);
    });
  };

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    for (const waiter of waiters.splice(0)) {
      waiter.cleanup?.();
      waiter.reject(new WireError("connection-closed", "Pool closed before request was served"));
    }
    await Promise.allSettled(workers.map((worker) => worker.host.close()));
    // After close, no further release() calls will fire — flush any drain
    // waiters so they don't hang forever.
    for (const resolveDrain of drainResolvers.splice(0)) {
      resolveDrain();
    }
  };

  return {
    cost,
    size: workers.length,
    ask,
    drain,
    close,
    [Symbol.asyncDispose]: close,
  };
};
