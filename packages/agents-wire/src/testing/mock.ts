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
    if (turn.delayMs && turn.delayMs > 0) {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, turn.delayMs));
    }
    return buildResult(turn, sessionId, agent, Date.now() - startedAt, defaultText);
  };

  const stream = (_prompt: string, _options: IAskOptions = {}): IAgentStream => {
    const turn = nextTurn();
    const queue = createAsyncQueue<TAgentEvent>();
    const startedAt = Date.now();
    let cancelled = false;

    const completion = (async (): Promise<IAskResult> => {
      const events = turn.events ?? scriptedEventsFromText(turn.text ?? defaultText);
      for (const event of events) {
        if (cancelled) {
          break;
        }
        queue.push(event);
        if (turn.delayMs && turn.delayMs > 0) {
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, turn.delayMs));
        }
      }
      const result = buildResult(turn, sessionId, agent, Date.now() - startedAt, defaultText);
      queue.push({ type: "finish", stopReason: result.stopReason, usage: undefined, cost: undefined });
      queue.end();
      return result;
    })();

    return {
      sessionId,
      cancel: async () => {
        cancelled = true;
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
    /* no-op for mock */
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
