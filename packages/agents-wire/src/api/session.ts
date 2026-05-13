import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { definitionFor } from "@/catalog/index";
import { DEFAULT_MAX_TURNS_BEFORE_RECYCLE, MAX_RESPAWN_ATTEMPTS, RESPAWN_BACKOFF_MS } from "@/constants";
import { AgentConnectionClosedError, BudgetExceededError, isTransientError, WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import { createClaudeDelegatePool, delegateAskJson, type IClaudeDelegatePool } from "@/runtime/claude-delegate";
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

const consumeStream = async (raw: IHostStream, cost: ICostTracker, agent: TAgentId, model: string | undefined): Promise<IAskResult> => {
  raw.completion.catch(() => {});
  try {
    for await (const event of raw) {
      if (event.type === "usage") {
        // cost.record() throws BudgetExceededError when budgetUsd is set;
        // no separate enforceBudget needed.
        cost.record(event.usage, agent, model);
      }
    }
    const result = await raw.completion;
    // No manual onCostUpdate fire here — the tracker is built with
    // `onUpdate: options.onCostUpdate`, so `cost.record(...)` above already
    // fired the user callback on every usage event including the final one.
    // A second post-loop call would double-fire with identical totals.
    return { ...result, cost: cost.snapshot };
  } catch (err) {
    try {
      await raw.cancel();
    } catch {
      /* swallow cancel-on-error */
    }
    throw err;
  }
};

const buildSchemaSystemPrompt = async <T>(schema: TSchemaInput<T>, base: string | undefined, onWarning?: (msg: string) => void): Promise<string> => {
  const guidance = base ?? DEFAULT_JSON_SYSTEM_PROMPT;
  if (typeof schema === "string") {
    return `${guidance}\n\nJSON Schema:\n${schema}`;
  }
  if (isStandardSchema(schema)) {
    const derived = await standardSchemaToJsonSchema(schema, onWarning);
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
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
  });

  let closed = false;

  // Claude session.askJson delegates to claude-wire's strict CLI channel.
  // Pool is per agents-wire session so closing the agents-wire session closes
  // the underlying claude-wire sessions deterministically. Lazily created
  // because non-Claude sessions never use it.
  let claudeDelegatePool: IClaudeDelegatePool | undefined;

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
    // close() may have landed during the backoff sleep — bail rather than
    // resurrect a process the caller already gave up on.
    if (closed) {
      throw new WireError("connection-closed", `Session ${currentSessionId} closed during respawn backoff`, { agent });
    }
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
      throw new WireError("connection-closed", `Session ${currentSessionId} is closed`, { agent });
    }

    // Proactive recycle: if the previous ask hit the turn limit, recycle before this ask.
    if (pendingRecycle) {
      await recycle();
      // close() may have landed during the recycle await — bail before
      // running the prompt against a now-stale host.
      if (closed) {
        throw new WireError("connection-closed", `Session ${currentSessionId} is closed`, { agent });
      }
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
        const result = await consumeStream(raw, cost, agent, merged.model);
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
      throw new WireError("connection-closed", `Session ${currentSessionId} is closed`, { agent });
    }
    const merged: IAskOptions = { ...options, ...askOptions };
    const events = createAsyncQueue<TAgentEvent>();
    const maxTurns = options.maxTurnsBeforeRecycle ?? DEFAULT_MAX_TURNS_BEFORE_RECYCLE;
    let upstreamCancel: () => Promise<void> = async () => {};
    let cancelled = false;

    const completion = (async (): Promise<IAskResult> => {
      try {
        await inFlight;
      } catch {
        /* prior op already failed; carry on */
      }
      // Honor recycle-on-turn-limit on the streaming path too — without
      // this, a caller that uses only stream() never recycles the
      // subprocess no matter how many turns elapse.
      if (pendingRecycle) {
        await recycle();
        if (closed) {
          const err = new WireError("connection-closed", `Session ${currentSessionId} is closed`, { agent });
          events.fail(err);
          throw err;
        }
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
          if (event.type === "usage") {
            cost.record(event.usage, agent, merged.model);
          }
          events.push(event);
        }
        const result = await raw.completion;
        events.end();
        // Count this streamed turn toward maxTurnsBeforeRecycle (was only
        // counted on the doAsk path, which under-counted callers using
        // stream() exclusively).
        turnCount += 1;
        if (maxTurns > 0 && turnCount >= maxTurns) {
          pendingRecycle = true;
        }
        // No manual onCostUpdate fire — see consumeStream comment above.
        return { ...result, cost: cost.snapshot };
      } catch (err) {
        events.fail(err);
        try {
          await raw.cancel();
        } catch {
          /* swallow cancel-on-error */
        }
        throw err;
      }
    })();
    inFlight = completion.catch(() => {});

    return wrapStream({
      // Getter follows respawn — wrapStream snapshot would otherwise expose
      // a stale id if recreateHost() runs between this call and the IIFE.
      sessionId: () => currentSessionId,
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
    // Claude routes through claude-wire's strict CLI channel. With a
    // systemPrompt, the per-session pool keys by (systemPrompt, schema-fp)
    // so the systemPrompt is Anthropic-prompt-cached across distinct schemas
    // in this agents-wire session. Without a systemPrompt, falls through to
    // claude-wire stateless (sessions accumulate context, so pooling is a
    // cost loss without a cached prefix).
    if (agent === "claude") {
      if (merged.systemPrompt !== undefined && merged.systemPrompt.length > 0) {
        if (claudeDelegatePool === undefined) {
          claudeDelegatePool = createClaudeDelegatePool();
        }
        return claudeDelegatePool.askJson(prompt, schema, merged, merged.systemPrompt);
      }
      return delegateAskJson(prompt, schema, merged);
    }
    // Always include DEFAULT_JSON_SYSTEM_PROMPT — caller's systemPrompt augments,
    // never replaces, the JSON-formatting guidance the parser depends on.
    const guidanceBase = merged.systemPrompt ? `${merged.systemPrompt}\n\n${DEFAULT_JSON_SYSTEM_PROMPT}` : DEFAULT_JSON_SYSTEM_PROMPT;
    const systemPrompt = await buildSchemaSystemPrompt(schema, guidanceBase, merged.onWarning);
    const raw = await ask(prompt, { ...merged, systemPrompt });
    const data = await parseAndValidate<T>(raw.text, schema);
    return { data, raw };
  };

  const setMode = async (modeId: string): Promise<void> => {
    // Chain through inFlight so a concurrent respawn / recycle can't swap
    // host + currentSessionId mid-call. Without this, setMode could land
    // on the closing host with the about-to-be-stale id.
    try {
      await inFlight;
    } catch {
      /* prior op already failed; carry on */
    }
    if (closed) {
      throw new WireError("connection-closed", `Session ${currentSessionId} is closed`, { agent });
    }
    await host.setMode(currentSessionId as never, modeId);
  };

  const cancel = async (): Promise<void> => {
    // Snapshot the host + sessionId pair before the await so a concurrent
    // recreateHost() doesn't swap them mid-call (the in-flight cancel
    // would otherwise hit a now-closed host).
    if (closed) {
      return;
    }
    const snapshotHost = host;
    const snapshotId = currentSessionId;
    await snapshotHost.cancel(snapshotId as never);
  };

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    // Tear down the host first — host.close() failActives every in-flight
    // stream (host.ts) so their queues fail and their IIFEs unblock. Then
    // settle inFlight so callers awaiting close() observe the same final
    // state as the in-flight operation. Awaiting inFlight BEFORE host.close
    // would deadlock: the in-flight stream's IIFE is parked on host events
    // that only host.close can drain.
    try {
      await host.close();
    } catch {
      /* host.close errors are surfaced via onWarning inside host */
    }
    try {
      await inFlight;
    } catch {
      /* in-flight op was cancelled by host.close; that's the contract */
    }
    if (claudeDelegatePool !== undefined) {
      try {
        await claudeDelegatePool.close();
      } catch {
        // best-effort
      }
      claudeDelegatePool = undefined;
    }
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
