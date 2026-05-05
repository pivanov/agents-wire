import type { TAgentEvent } from "@/types/events";
import type { IAskResult } from "@/types/results";

export interface IAgentStream extends AsyncIterable<TAgentEvent> {
  readonly sessionId: string;
  cancel: () => Promise<void>;
  result: () => Promise<IAskResult>;
}

export interface IStreamFactoryInput {
  readonly sessionId: string;
  readonly events: AsyncIterable<TAgentEvent>;
  readonly completion: Promise<IAskResult>;
  readonly cancel: () => Promise<void>;
}

export const wrapStream = (input: IStreamFactoryInput): IAgentStream => {
  return {
    sessionId: input.sessionId,
    cancel: input.cancel,
    result: () => input.completion,
    [Symbol.asyncIterator]: () => input.events[Symbol.asyncIterator](),
  };
};
