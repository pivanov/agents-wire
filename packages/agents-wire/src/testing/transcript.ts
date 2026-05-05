import type { TAgentEvent } from "@/types/events";

export interface ITranscriptEntry {
  readonly at: number;
  readonly event: TAgentEvent;
}

export interface ITranscriptRecorder {
  readonly entries: readonly ITranscriptEntry[];
  observe: (event: TAgentEvent) => void;
  toJSON: () => string;
}

export const createRecorder = (clock: () => number = Date.now): ITranscriptRecorder => {
  const entries: ITranscriptEntry[] = [];
  return {
    get entries() {
      return entries;
    },
    observe(event: TAgentEvent) {
      entries.push({ at: clock(), event });
    },
    toJSON() {
      return JSON.stringify(entries, null, 2);
    },
  };
};

export const recordStream = async (source: AsyncIterable<TAgentEvent>, recorder: ITranscriptRecorder): Promise<void> => {
  for await (const event of source) {
    recorder.observe(event);
  }
};

export async function* replayTranscript(entries: readonly ITranscriptEntry[], options: { realtime?: boolean } = {}): AsyncIterable<TAgentEvent> {
  let lastAt: number | undefined;
  for (const entry of entries) {
    if (options.realtime && lastAt !== undefined) {
      const wait = Math.max(0, entry.at - lastAt);
      if (wait > 0) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, wait));
      }
    }
    lastAt = entry.at;
    yield entry.event;
  }
}

export const parseTranscript = (json: string): readonly ITranscriptEntry[] => {
  return JSON.parse(json) as ITranscriptEntry[];
};
