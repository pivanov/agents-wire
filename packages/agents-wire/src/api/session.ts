import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import { enforceBudget } from "@/budget/guard";
import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { definitionFor } from "@/catalog/index";
import { DEFAULT_MAX_TURNS_BEFORE_RECYCLE, MAX_RESPAWN_ATTEMPTS, RESPAWN_BACKOFF_MS } from "@/constants";
import { AgentConnectionClosedError, BudgetExceededError, isTransientError, WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import type { IHostStream, IWireHost } from "@/runtime/host";
import { createWireHost } from "@/runtime/host";
import { standardSchemaToJsonSchema } from "@/schema/derive";
import { parseAndValidate } from "@/schema/parse";
import { DEFAULT_JSON_SYSTEM_PROMPT } from "@/schema/prompts";
import { isStandardSchema, type TSchemaInput } from "@/schema/standard";
import type { TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";
import type { IAskOptions, ISessionOptions } from "@/types/options";
import type { IAskResult, IJsonResult, ISessionInfo, ISessionListPage } from "@/types/results";
import { type IAgentStream, wrapStream } from "./stream";

export interface IAgentSession {
  readonly sessionId: string;
  readonly agent: TAgentId;
  readonly cost: ICostTracker;
  readonly modeState: SessionModeState | undefined;
  /**
   * Config options the agent declared for this session (model, reasoning effort, etc.).
   * Use these to render dynamic UI — the agent itself tells you which knobs it accepts
   * and the valid values for `select` types. Returns `undefined` if no options were
   * advertised.
   */
  readonly configOptions: readonly SessionConfigOption[] | undefined;
  ask: (prompt: string, options?: IAskOptions) => Promise<IAskResult>;
  askJson: <T>(prompt: string, schema: TSchemaInput<T>, options?: IAskOptions) => Promise<IJsonResult<T>>;
  stream: (prompt: string, options?: IAskOptions) => IAgentStream;
  listSessions: (input?: { cwd?: string; cursor?: string }) => Promise<ISessionListPage>;
  streamAllSessions: (input?: { cwd?: string }) => AsyncIterable<ISessionInfo>;
  setMode: (modeId: string) => Promise<void>;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Exported for unit testing only. Computes the backoff delay in milliseconds for a given attempt.
 */
export const computeBackoffMs = (attempt: number): number => {
  const idx = Math.min(attempt - 1, RESPAWN_BACKOFF_MS.length - 1);
  return RESPAWN_BACKOFF_MS[idx] ?? 0;
};

const consumeStream = async (
  raw: IHostStream,
  cost: ICostTracker,
  agent: TAgentId,
  model: string | undefined,
  options: IAskOptions,
): Promise<IAskResult> => {
  raw.completion.catch(() => {});
  for await (const event of raw) {
    if (event.type === "usage") {
      cost.record(event.usage, agent, model);
      enforceBudget({ tracker: cost, agent, ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}) });
    }
  }
  const result = await raw.completion;
  options.onCostUpdate?.(cost.snapshot);
  return { ...result, cost: cost.snapshot };
};

const buildSchemaSystemPrompt = async <T>(schema: TSchemaInput<T>, base: string | undefined): Promise<string> => {
  const guidance = base ?? DEFAULT_JSON_SYSTEM_PROMPT;
  if (typeof schema === "string") {
    return `${guidance}\n\nJSON Schema:\n${schema}`;
  }
  if (isStandardSchema(schema)) {
    const derived = await standardSchemaToJsonSchema(schema);
    if (derived) {
      return `${guidance}\n\nJSON Schema:\n${derived}`;
    }
  }
  return guidance;
};

/** @internal Testing only - override the host factory to inject mock hosts. */
export interface ISessionOptionsInternal extends ISessionOptions {
  readonly _hostFactory?: (agent: TAgentId, options: ISessionOptions) => Promise<IWireHost>;
}

export const createSession = async (agent: TAgentId, options: ISessionOptions = {}): Promise<IAgentSession> => {
  const internalOptions = options as ISessionOptionsInternal;
  const hostFactory = internalOptions._hostFactory ?? ((a, o) => createWireHost(definitionFor(a), { ...o, agentId: a }));

  // host and sessionId are mutable so they can be replaced on respawn.
  let host: IWireHost = await hostFactory(agent, options);
  let currentSessionId: string = await host.newSession({
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });

  // cost tracker is mutable; on respawn we fork() so totalUsd keeps growing monotonically.
  let cost: ICostTracker = createCostTracker({
    ...(options.maxCostUsd !== undefined ? { budgetUsd: options.maxCostUsd } : {}),
    ...(options.costEstimator ? { estimator: options.costEstimator } : {}),
    ...(options.onCostUpdate ? { onUpdate: options.onCostUpdate } : {}),
  });

  let closed = false;

  // Per-host-lifetime turn counter - resets on recycle (not on failure respawn).
  let turnCount = 0;
  let pendingRecycle = false;

  /**
   * Core host recreation logic: close old host, fork cost, create new host + session.
   * Used by both respawn() (failure recovery) and recycle() (proactive turn-limit reset).
   *
   * When `options.loadSessionId` is set the new host re-issues `loadSession` with
   * the same id so conversation context survives the respawn (the agent's own
   * persistent storage backs the resume; the SDK is stateless about it).
   */
  const recreateHost = async (): Promise<void> => {
    try {
      await host?.close();
    } catch {
      // ignore close errors during recreation
    }
    cost = cost.fork();
    host = await hostFactory(agent, options);
    const sessionInput = {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      ...(options.meta ? { meta: options.meta } : {}),
    };
    if (options.loadSessionId) {
      currentSessionId = await host.loadSession({
        sessionId: options.loadSessionId,
        ...sessionInput,
      });
    } else {
      currentSessionId = await host.newSession(sessionInput);
    }
  };

  /**
   * Replaces the current host+session after a transient failure.
   * Conversation context survives only when `options.loadSessionId` was set
   * AND the agent's loadSession capability successfully restores history;
   * otherwise the new session starts fresh.
   */
  const respawn = async (attempt: number, error: Error): Promise<void> => {
    options.onRetry?.(attempt, error);
    const delayMs = computeBackoffMs(attempt);
    await new Promise((r) => setTimeout(r, delayMs));
    await recreateHost();
  };

  /**
   * Proactively recycles the host after hitting the turn limit.
   * Unlike respawn, this does not wait for backoff and calls onRecycle instead of onRetry.
   */
  const recycle = async (): Promise<void> => {
    options.onRecycle?.("turn-limit");
    await recreateHost();
    turnCount = 0;
    pendingRecycle = false;
  };

  // Serialize concurrent ask() calls so a mid-respawn ask waits instead of racing.
  let inFlight: Promise<unknown> = Promise.resolve();

  // Model/effort applied at session creation time (passed to createWireHost → launchAgent → definition.launch).
  // Per-call askOptions.model overrides the cost tracker model for pricing purposes but does not
  // respawn the agent — the spawned process is already running with the session-level model flag.
  const doAsk = async (prompt: string, askOptions: IAskOptions = {}): Promise<IAskResult> => {
    if (closed) {
      throw new Error(`Session ${currentSessionId} is closed`);
    }

    // Proactive recycle: if the previous ask hit the turn limit, recycle before this ask.
    if (pendingRecycle) {
      await recycle();
    }

    const merged: IAskOptions = { ...options, ...askOptions };
    const autoRespawn = (merged as ISessionOptions).autoRespawn !== false;
    let attempt = 0;
    const maxTurns = options.maxTurnsBeforeRecycle ?? DEFAULT_MAX_TURNS_BEFORE_RECYCLE;

    while (true) {
      try {
        if (cost.budgetUsd !== undefined && cost.snapshot.totalUsd >= cost.budgetUsd) {
          throw new BudgetExceededError(cost.snapshot.totalUsd, cost.budgetUsd, { agent });
        }
        const raw = host.prompt(currentSessionId, {
          prompt,
          ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
          ...(merged.command ? { command: merged.command } : {}),
          ...(merged.signal ? { signal: merged.signal } : {}),
          ...(merged.meta ? { meta: merged.meta } : {}),
        });
        const result = await consumeStream(raw, cost, agent, merged.model, merged);
        turnCount += 1;
        if (maxTurns > 0 && turnCount >= maxTurns) {
          pendingRecycle = true;
        }
        return result;
      } catch (err) {
        attempt += 1;
        const transient = err instanceof AgentConnectionClosedError || isTransientError(err);

        if (!autoRespawn || !transient || attempt > MAX_RESPAWN_ATTEMPTS) {
          if (attempt > MAX_RESPAWN_ATTEMPTS) {
            throw new WireError("retry-exhausted", `Exhausted ${MAX_RESPAWN_ATTEMPTS} respawn attempts`, { agent, cause: err });
          }
          if (err instanceof WireError) {
            throw err;
          }
          const message = err instanceof Error ? err.message : String(err);
          throw new WireError("stream-error", message, { agent, cause: err });
        }

        if (closed) {
          throw err;
        }

        await respawn(attempt, err as Error);
      }
    }
  };

  const ask = (prompt: string, askOptions: IAskOptions = {}): Promise<IAskResult> => {
    const next = inFlight.then(
      () => doAsk(prompt, askOptions),
      () => doAsk(prompt, askOptions),
    );
    inFlight = next.catch(() => {});
    return next;
  };

  // stream() doesn't retry mid-stream, but it still has to wait for any in-flight ask/respawn to settle
  // so it doesn't hold a stale host/sessionId. Relay through a deferred queue + lazy cancel/completion.
  const stream = (prompt: string, askOptions: IAskOptions = {}): IAgentStream => {
    if (closed) {
      throw new Error(`Session ${currentSessionId} is closed`);
    }
    const merged: IAskOptions = { ...options, ...askOptions };
    const events = createAsyncQueue<TAgentEvent>();
    let upstreamCancel: () => Promise<void> = async () => {};
    let cancelled = false;

    const completion = (async (): Promise<IAskResult> => {
      try {
        await inFlight;
      } catch {
        /* prior op already failed; carry on */
      }
      if (closed) {
        const err = new WireError("cancelled", `Session ${currentSessionId} is closed`, { agent });
        events.fail(err);
        throw err;
      }
      const raw = host.prompt(currentSessionId, {
        prompt,
        ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
        ...(merged.command ? { command: merged.command } : {}),
        ...(merged.signal ? { signal: merged.signal } : {}),
        ...(merged.meta ? { meta: merged.meta } : {}),
      });
      upstreamCancel = raw.cancel;
      if (cancelled) {
        await raw.cancel();
      }
      try {
        for await (const event of raw) {
          events.push(event);
        }
        const result = await raw.completion;
        events.end();
        return result;
      } catch (err) {
        events.fail(err);
        throw err;
      }
    })();
    inFlight = completion.catch(() => {});

    return wrapStream({
      sessionId: currentSessionId,
      events,
      completion,
      cancel: async () => {
        cancelled = true;
        await upstreamCancel();
      },
    });
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, askOptions: IAskOptions = {}): Promise<IJsonResult<T>> => {
    const merged: IAskOptions = { ...options, ...askOptions };
    const guidanceBase = merged.systemPrompt ?? DEFAULT_JSON_SYSTEM_PROMPT;
    const systemPrompt = await buildSchemaSystemPrompt(schema, guidanceBase);
    const raw = await ask(prompt, { ...merged, systemPrompt });
    const data = await parseAndValidate<T>(raw.text, schema);
    return { data, raw };
  };

  const setMode = (modeId: string): Promise<void> => {
    return host.setMode(currentSessionId as never, modeId);
  };

  const cancel = async (): Promise<void> => {
    await host.cancel(currentSessionId as never);
  };

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await host.close();
  };

  const listSessions = (input?: { cwd?: string; cursor?: string }): Promise<ISessionListPage> => {
    return host.listSessions(input);
  };

  function streamAllSessions(input?: { cwd?: string }): AsyncIterable<ISessionInfo> {
    return host.streamAllSessions(input);
  }

  return {
    get sessionId() {
      return currentSessionId;
    },
    agent,
    get cost() {
      return cost;
    },
    get modeState() {
      return host.getModeState(currentSessionId as never);
    },
    get configOptions() {
      return host.getConfigOptions(currentSessionId as never);
    },
    ask,
    askJson,
    stream,
    listSessions,
    streamAllSessions,
    setMode,
    cancel,
    close,
    [Symbol.asyncDispose]: close,
  };
};
