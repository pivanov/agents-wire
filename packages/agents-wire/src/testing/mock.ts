import type { SessionModeState } from "@agentclientprotocol/sdk";
import type { IAgentSession } from "@/api/session";
import type { IAgentStream } from "@/api/stream";
import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { createAsyncQueue } from "@/internal/async-queue";
import { parseAndValidate } from "@/schema/parse";
import type { TSchemaInput } from "@/schema/standard";
import type { TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";
import type { IAskOptions, ISessionOptions } from "@/types/options";
import type { IAskResult, IJsonResult, ISessionInfo, ISessionListPage } from "@/types/results";

export interface IScriptedTurn {
  readonly events?: readonly TAgentEvent[];
  readonly text?: string;
  readonly thinking?: string;
  readonly stopReason?: string;
  readonly delayMs?: number;
}

export interface IMockSessionOptions {
  readonly agent?: TAgentId;
  readonly sessionId?: string;
  readonly turns?: readonly IScriptedTurn[];
  readonly defaultText?: string;
}

const buildResult = (turn: IScriptedTurn, sessionId: string, agent: TAgentId, durationMs: number, defaultText: string): IAskResult => ({
  text: turn.text ?? defaultText,
  thinking: turn.thinking ?? "",
  stopReason: turn.stopReason ?? "end_turn",
  usage: undefined,
  cost: undefined,
  sessionId,
  agent,
  durationMs,
});

export interface IMockSession extends IAgentSession {
  readonly script: readonly IScriptedTurn[];
  enqueueTurn: (turn: IScriptedTurn) => void;
  reset: () => void;
}

export const createMockAgent = (options: IMockSessionOptions = {}): IMockSession => {
  const agent: TAgentId = options.agent ?? "claude";
  const sessionId = options.sessionId ?? "mock-session";
  const defaultText = options.defaultText ?? "";
  const script: IScriptedTurn[] = options.turns ? [...options.turns] : [];
  let cursor = 0;
  const cost: ICostTracker = createCostTracker();
  // Active in-flight stream cancellers. Top-level session.cancel() walks
  // these so it actually interrupts mid-stream — the previous noop hid
  // every regression in the real host's cancel path that exercised the
  // mock as a contract reference.
  const activeCancellers = new Set<() => void>();

  // Helper: setTimeout that resolves early if `signal` aborts. Without
  // this, a delayMs mid-cancel waits the full timeout before noticing —
  // the cancel path can't be tested for promptness.
  const delayWithCancel = (ms: number, signal: { aborted: boolean }, onCancel: (cb: () => void) => void): Promise<void> =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const handle = setTimeout(() => {
        resolve();
      }, ms);
      onCancel(() => {
        clearTimeout(handle);
        resolve();
      });
    });

  const nextTurn = (): IScriptedTurn => {
    if (cursor >= script.length) {
      return { text: defaultText };
    }
    const turn = script[cursor];
    cursor += 1;
    return turn ?? { text: defaultText };
  };

  const ask = async (_prompt: string, _options: IAskOptions = {}): Promise<IAskResult> => {
    const turn = nextTurn();
    const startedAt = Date.now();
    // Same delay-with-cancel pattern as stream() so a top-level
    // session.cancel() during ask's delayMs doesn't have to wait the
    // full timeout. Without this, tests asserting "cancel + ask settles"
    // hang for the entire delayMs and hide regressions in real-host
    // ask-cancel paths.
    const signal = { aborted: false };
    let onCancelCallback: (() => void) | undefined;
    const fireCancel = (): void => {
      signal.aborted = true;
      onCancelCallback?.();
    };
    activeCancellers.add(fireCancel);
    try {
      if (turn.delayMs && turn.delayMs > 0) {
        await delayWithCancel(turn.delayMs, signal, (cb) => {
          onCancelCallback = cb;
        });
      }
      const baseResult = buildResult(turn, sessionId, agent, Date.now() - startedAt, defaultText);
      return signal.aborted ? { ...baseResult, stopReason: "cancelled" } : baseResult;
    } finally {
      activeCancellers.delete(fireCancel);
    }
  };

  const stream = (_prompt: string, _options: IAskOptions = {}): IAgentStream => {
    const turn = nextTurn();
    const queue = createAsyncQueue<TAgentEvent>();
    const startedAt = Date.now();
    const signal = { aborted: false };
    let onCancelCallback: (() => void) | undefined;
    const setOnCancel = (cb: () => void): void => {
      onCancelCallback = cb;
    };
    const fireCancel = (): void => {
      signal.aborted = true;
      onCancelCallback?.();
    };
    activeCancellers.add(fireCancel);

    const completion = (async (): Promise<IAskResult> => {
      try {
        const events = turn.events ?? scriptedEventsFromText(turn.text ?? defaultText);
        for (const event of events) {
          if (signal.aborted) {
            break;
          }
          queue.push(event);
          if (turn.delayMs && turn.delayMs > 0) {
            await delayWithCancel(turn.delayMs, signal, setOnCancel);
            if (signal.aborted) {
              break;
            }
          }
        }
        // Match the real host: when cancel fires mid-stream, the finish event
        // carries stopReason "cancelled". Otherwise use the scripted reason.
        const baseResult = buildResult(turn, sessionId, agent, Date.now() - startedAt, defaultText);
        const result: IAskResult = signal.aborted ? { ...baseResult, stopReason: "cancelled" } : baseResult;
        queue.push({ type: "finish", stopReason: result.stopReason, usage: undefined, cost: undefined });
        queue.end();
        return result;
      } finally {
        activeCancellers.delete(fireCancel);
      }
    })();

    return {
      sessionId,
      cancel: async () => {
        fireCancel();
      },
      result: () => completion,
      [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
    };
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions = {}): Promise<IJsonResult<T>> => {
    const raw = await ask(prompt, options);
    const data = await parseAndValidate<T>(raw.text, schema);
    return { data, raw };
  };

  const setMode = async (_modeId: string): Promise<void> => {
    /* no-op for mock */
  };

  const cancel = async (): Promise<void> => {
    // Fire every active stream's cancel so the contract matches the real
    // host's session-level cancel — previously a no-op which hid broken
    // cancel paths in any test that exercised the mock as a reference.
    for (const fire of [...activeCancellers]) {
      fire();
    }
  };

  const close = async (): Promise<void> => {
    /* no-op for mock */
  };

  const listSessions = async (_input?: { cwd?: string; cursor?: string }): Promise<ISessionListPage> => {
    return { sessions: [] };
  };

  async function* streamAllSessions(_input?: { cwd?: string }): AsyncIterable<ISessionInfo> {}

  const enqueueTurn = (turn: IScriptedTurn): void => {
    script.push(turn);
  };

  const reset = (): void => {
    script.length = 0;
    cursor = 0;
  };

  return {
    sessionId,
    agent,
    cost,
    modeState: undefined as SessionModeState | undefined,
    configOptions: undefined,
    ask,
    askJson,
    stream,
    listSessions,
    streamAllSessions,
    setMode,
    cancel,
    close,
    [Symbol.asyncDispose]: close,
    // Expose a snapshot getter so callers can't observe in-flight enqueueTurn mutation.
    get script(): readonly IScriptedTurn[] {
      return [...script];
    },
    enqueueTurn,
    reset,
  } as IMockSession;
};

const scriptedEventsFromText = (text: string): readonly TAgentEvent[] => {
  if (text.length === 0) {
    return [];
  }
  return [{ type: "text-delta", text, messageId: undefined }];
};

export const createMockSession = (options: ISessionOptions & IMockSessionOptions = {}): IMockSession => {
  return createMockAgent(options);
};
