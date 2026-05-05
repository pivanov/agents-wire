# Stream

`agents.stream()` returns an `IAgentStream` that yields typed events as they arrive from the agent.

## Iterating Events

```ts
import { agents } from "@pivanov/agents-wire";

for await (const event of agents.stream("claude", "Explain generics")) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text);
      break;
    case "tool-call":
      console.log(`[tool] ${event.tool}(${JSON.stringify(event.input)})`);
      break;
    case "tool-result":
      console.log(`[result] ${JSON.stringify(event.output)}`);
      break;
    case "turn-complete":
      console.log(`\nDone. Stop reason: ${event.stopReason}`);
      break;
    case "error":
      console.error(event.message);
      break;
  }
}
```

## Convenience Methods

If you don't need real-time events, use convenience methods instead:

### `.text()`

Consumes the stream and returns all text content concatenated.

```ts
const text = await agents.stream("claude", "Hello").text();
```

### `.result()`

Consumes the stream and returns a full `IAskResult` - same as `agents.ask()`.

```ts
const result = await agents.stream("claude", "Hello").result();
console.log(result.text, result.cost?.totalUsd);
```

## Single-Consumption Rule

A stream can only be consumed once. Choose one approach:

- **Iterate** with `for await` - get real-time events
- **Call** `.text()` or `.result()` - get the final result

Mixing them throws an error:

```ts
const stream = agents.stream("claude", "Hello");

for await (const event of stream) { /* ... */ }

// This throws:
await stream.result(); // Error: Cannot call after iterating
```

## Inactivity Watchdog

Streams have a configurable inactivity timeout (default: 5 minutes). The watchdog resets on every data chunk, so an actively streaming response can run indefinitely. Silence past the window throws `AgentInactivityError` and kills the process.

```ts
// Fail fast in interactive UIs:
const stream = agents.stream(
  "claude",
  "Explain generics",
  {
    inactivityTimeoutMs: 15_000,
  },
);

// Disable for batch jobs:
const batch = agents.stream(
  "claude",
  "Long task",
  {
    inactivityTimeoutMs: Infinity,
  },
);
```

`AgentInactivityError` extends `TimeoutError`, so `instanceof TimeoutError` catches both.

## Process Cleanup

The spawned process is always killed on any error (timeout, budget, parse error, etc.), preventing orphaned processes.

## Streaming is Not Auto-Retried

Unlike `session.ask()`, streaming is not automatically retried on transient failure. A mid-stream respawn doesn't help the consumer - the partial output is already lost. If you need retry semantics for streaming workloads, wrap the stream call in your own retry loop, or use `agents.ask()` (non-streaming) which benefits from auto-respawn.

## Full Example

See [`apps/examples/research-agent/`](https://github.com/pivanov/agents-wire/tree/main/apps/examples/research-agent) for a streaming research agent that processes events in real time.
