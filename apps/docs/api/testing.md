# Testing

The `@pivanov/agents-wire/testing` subpath ships in-process mock agents and a full host harness you can swap in for real agent processes during unit tests. Living behind a subpath means production installs that never import from `/testing` skip the module entirely.

## When to Use

- Tests that exercise SDK behavior (parsing, sessions, retries, tool dispatch) without spawning a real agent binary.
- CI environments where the agent CLI is unavailable or authentication isn't set up.
- Deterministic regression tests that pin a specific transcript.

For end-to-end coverage against a real agent, spawn it normally and consume `agents.ask()` as usual.

## `createMockAgent(options)`

Scripted mock that runs a pre-defined sequence of turns. Pass an array of turns; each turn specifies the text (and optionally tool calls) the mock should emit.

```ts
import { createMockAgent } from "@pivanov/agents-wire/testing";

const mock = createMockAgent({
  agent: "claude",
  turns: [
    { text: "ok" },
    { text: "porcupine" },
  ],
});

const turn1 = await mock.ask("remember 'porcupine'");  // → "ok"
const turn2 = await mock.ask("what was it?");          // → "porcupine"
```

### `IMockAgent`

| Field / Method | Description |
|----------------|-------------|
| `ask(prompt, options?)` | Returns the next scripted turn. |
| `stream(prompt, options?)` | Streams the next scripted turn. |
| `session(options?)` | Returns a mock session backed by the scripted turns. |
| `writes` | Every prompt sent to the mock, in order. |
| `turnIndex` | Current turn index. |

## `connectMockHost(script?, overrides?)`

Full host harness - runs a real `IWireHost` over `TransformStream` pairs with an
`AgentSideConnection`. No subprocess is spawned. This is what the SDK's own test suite
uses for protocol-level tests.

Returns `IConnectedMockHost`:

```ts
interface IConnectedMockHost {
  host: IWireHost;         // real IWireHost backed by in-process streams
  definition: IAgentDefinition;
  pushStderr: (line: string) => void;   // inject stderr lines
  triggerExit: (exitCode: number, signal?: NodeJS.Signals) => void;
  close: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}
```

Use `host.newSession()` then `host.prompt()` to drive the host directly, or wrap it in
`createSession` via the `_hostFactory` testing hook (internal).

```ts
import { connectMockHost } from "@pivanov/agents-wire/testing";

await using harness = await connectMockHost({
  onPrompt: async function* (_sessionId, _blocks) {
    yield { type: "text-delta", text: "analysis complete", messageId: undefined };
  },
});

const sessionId = await harness.host.newSession({ cwd: "." });
const stream = harness.host.prompt(sessionId, { prompt: "Analyze src/auth.ts" });

let text = "";
for await (const event of stream) {
  if (event.type === "text-delta") text += event.text;
}
console.log(text); // "analysis complete"
```

### `IMockHostScript`

```ts
interface IMockHostScript {
  /** Capabilities the mock agent reports during initialize. */
  capabilities?: AgentCapabilities;
  /** Per-prompt callback: yield TAgentEvents to emit before resolving. */
  onPrompt?: (
    sessionId: string,
    blocks: readonly ContentBlock[],
    signal?: AbortSignal,
  ) => AsyncIterable<TAgentEvent> | Iterable<TAgentEvent>;
  stopReason?: StopReason;     // default: "end_turn"
  initializeError?: Error;     // throw during initialize
  newSessionError?: Error;     // throw during newSession
  promptError?: Error;         // throw during prompt
  onSetMode?: (sessionId: string, modeId: string) => void | Promise<void>;
  initialModes?: SessionModeState;
}
```

## Transcript Record and Replay

Record a real ACP event stream to a JSON fixture, then replay it deterministically in tests
without spawning any process.

### Low-level: `recordStream` and `replayTranscript`

`recordStream(source, recorder)` drains an async iterable of `TAgentEvent` and appends
each event to a `ITranscriptRecorder`. `replayTranscript(entries, options?)` replays the
recorded entries as an `AsyncIterable<TAgentEvent>`.

```ts
import {
  createRecorder,
  recordStream,
  replayTranscript,
} from "@pivanov/agents-wire/testing";

// --- record ---
const recorder = createRecorder();
const stream = agents.stream(
  "claude",
  "What is a monad?",
  {
    permission: "auto-allow",
  },
);
await recordStream(stream, recorder);
const json = recorder.toJSON();
await Bun.write("fixtures/monad.json", json);

// --- replay ---
import { parseTranscript } from "@pivanov/agents-wire/testing";
const entries = parseTranscript(
  await Bun.file("fixtures/monad.json").text(),
);
for await (const event of replayTranscript(entries)) {
  // same events the real session emitted, no process spawned
  if (event.type === "text-delta") process.stdout.write(event.text);
}

// Replay with real-time delays (for latency simulation):
for await (const event of replayTranscript(entries, { realtime: true })) {
  // events yielded with original inter-event timing
}
```

Use case: capture a known-good session once, commit the fixture, and run the replay in CI
to guard against regressions in event-parsing logic.

### Session-level recording

```ts
import { createRecorder } from "@pivanov/agents-wire/testing";

const recorder = createRecorder();
const session = await agents.session(
  "claude",
  {
    permission: "auto-allow",
  },
);

const stream = session.stream("What is a monad?");
await recordStream(stream, recorder);
await session.close();

await Bun.write("fixtures/monad.json", recorder.toJSON());
```

## Wiring Into Bun Tests

```ts
import { beforeEach, test, expect } from "bun:test";
import { createMockAgent } from "@pivanov/agents-wire/testing";

let mock: ReturnType<typeof createMockAgent>;

beforeEach(() => {
  mock = createMockAgent({
    agent: "claude",
    turns: [{ text: "hi from mock" }],
  });
});

test("session reads a turn from the mock", async () => {
  const session = mock.session();
  const result = await session.ask("hello");
  expect(result.text).toBe("hi from mock");
});
```

For Vitest or Jest, use the equivalent module-mock primitive (`vi.mock`, `jest.mock`) to redirect the `agents` import to the mock.
