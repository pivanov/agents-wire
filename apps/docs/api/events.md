# Events

All events are part of the `TAgentEvent` discriminated union. Switch on `event.type` to handle each one.

```ts
type TAgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call"; tool: string; toolCallId: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; output: unknown; isError?: boolean }
  | { type: "session-meta"; sessionId: string; model?: string; tools?: string[] }
  | { type: "turn-complete"; stopReason: TStopReason; usage?: IUsageReport }
  | { type: "error"; message: string; sessionId?: string };
```

## `text-delta`

Text content from the assistant. Stream these deltas to build the full text.

```ts
{
  type: "text-delta",
  text: "Here's the answer..."
}
```

## `thinking-delta`

Internal reasoning (extended thinking / chain of thought). Not all agents emit this.

```ts
{
  type: "thinking-delta",
  text: "Let me analyze the code..."
}
```

## `tool-call`

The agent wants to use a tool. If you have a tool handler configured, it is called automatically.

```ts
{
  type: "tool-call",
  toolCallId: "call_abc123",
  tool: "Read",
  input: { file_path: "main.ts" }
}
```

The `input` field is the parsed JSON object from the wire protocol, passed through as-is.

## `tool-result`

Result of a tool execution.

```ts
{
  type: "tool-result",
  toolCallId: "call_abc123",
  output: "const x = 1;\n",
  isError: false
}
```

## `session-meta`

Emitted once at the start of a session with metadata about the agent and its capabilities.

```ts
{
  type: "session-meta",
  sessionId: "sess-abc123",
  model: "claude-sonnet-4-7",  // live value from the agent; varies by session
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
}
```

::: info Re-emitted on respawn
In session mode, `session-meta` is re-emitted after each process respawn (auto-retry or turn-limit recycle). Treat each emission as the start of a new underlying process within the same logical session.
:::

## `turn-complete`

Emitted at the end of each turn with stop reason and optional usage data.

```ts
{
  type: "turn-complete",
  // "end-turn" | "tool-use" | "max-tokens" | "error" | "cancelled"
  stopReason: "end-turn",
  usage: {
    contextSize: 200000,
    contextUsed: 3500,
    costUsd: 0.018,         // undefined for subscription agents (Cursor, Copilot, Pi, Auggie)
  }
}
```

Usage data is optional - not all agents report it. Subscription-based agents (Cursor, Copilot, Pi, Auggie) do not report `costUsd`.

## `error`

An error from the session, distinct from a thrown exception.

```ts
{
  type: "error",
  message: "Something went wrong",
  sessionId: "sess-abc123"
}
```
