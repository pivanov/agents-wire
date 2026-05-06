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

// Mirror the TAgentEvent discriminator strings. Kept inline here rather
// than re-exported from events.ts because this is testing-only.
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "text-delta",
  "thinking-delta",
  "tool-call",
  "tool-call-update",
  "permission-request",
  "plan",
  "mode-changed",
  "available-commands",
  "config-options",
  "session-info",
  "usage",
  "finish",
  "raw",
]);

export const parseTranscript = (json: string): readonly ITranscriptEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(`parseTranscript: invalid JSON (${(cause as Error).message})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("parseTranscript: expected an array of transcript entries");
  }
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("parseTranscript: malformed entry (expected { at: number, event: object })");
    }
    const at = (entry as { at?: unknown }).at;
    const event = (entry as { event?: unknown }).event;
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) {
      throw new Error("parseTranscript: entry.at must be a finite non-negative number");
    }
    if (typeof event !== "object" || event === null) {
      throw new Error("parseTranscript: entry.event must be an object");
    }
    const evType = (event as { type?: unknown }).type;
    if (typeof evType !== "string" || !KNOWN_EVENT_TYPES.has(evType)) {
      // Reject unknown discriminators rather than letting them silently
      // hit the `default` branch of a consumer's exhaustive switch at
      // runtime — replay should fail loudly on a corrupted transcript.
      throw new Error(`parseTranscript: unknown event.type "${String(evType)}"`);
    }
  }
  return parsed as ITranscriptEntry[];
};
