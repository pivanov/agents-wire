import type { TAgentEvent } from "@/types/events";
import type { IAskResult } from "@/types/results";

export interface IAgentStream extends AsyncIterable<TAgentEvent> {
  readonly sessionId: string;
  cancel: () => Promise<void>;
  result: () => Promise<IAskResult>;
}

export interface IStreamFactoryInput {
  /** Either a fixed id (one-shot ask) or a getter that follows respawns. */
  readonly sessionId: string | (() => string);
  readonly events: AsyncIterable<TAgentEvent>;
  readonly completion: Promise<IAskResult>;
  readonly cancel: () => Promise<void>;
}

export const wrapStream = (input: IStreamFactoryInput): IAgentStream => {
  // sessionId is a getter so callers observe the live id even if the wrapper
  // was created before respawn assigned a fresh session under the hood.
  // `IStreamFactoryInput.sessionId` may be a literal string (one-shot path)
  // OR a closure returning the current id (session path); we accept both.
  const readSessionId = typeof input.sessionId === "function" ? input.sessionId : () => input.sessionId as string;
  return {
    get sessionId() {
      return readSessionId();
    },
    cancel: input.cancel,
    result: () => input.completion,
    [Symbol.asyncIterator]: () => input.events[Symbol.asyncIterator](),
  };
};
