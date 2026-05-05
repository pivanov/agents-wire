# Client

The `agents` namespace is the main entry point. It's pre-configured and ready to use. For custom defaults, create your own client with `createClient()`.

## `agents.ask(agent, prompt, options?)`

Send a one-shot prompt to an agent and get the complete result.

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "claude",
  "Fix the bug in main.ts",
  {
    cwd: "/path/to/project",
    permission: "auto-allow",
    maxCostUsd: 0.5,
  },
);

console.log(result.text);
console.log(result.cost?.totalUsd);
console.log(result.stopReason);
```

**Returns:** `Promise<IAskResult>`

```ts
type IAskResult = {
  text: string;          // concatenated text output
  // "end-turn" | "tool-use" | "max-tokens" | "error" | "cancelled"
  stopReason: TStopReason;
  usage?: IUsageReport;  // { contextSize, contextUsed, costUsd } - not reported by all agents
  cost?: ICostSnapshot;  // SDK-side cumulative cost tracker snapshot
  sessionId?: string;
  events: TAgentEvent[]; // all events from the turn
};
```

::: info Cost vs usage
`result.usage` comes from the agent's own report (not all agents provide it; Cursor/Copilot/Pi/Auggie are subscription-based and do not report `costUsd`). `result.cost` is the SDK's own tracker - always present, aggregated across the session.
:::

## `agents.askJson(agent, prompt, schema, options?)`

Send a prompt, parse the response as JSON, and validate it against a schema.

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const { data } = await agents.askJson(
  "claude",
  "List 3 colors as JSON: { colors: string[] }",
  z.object({ colors: z.array(z.string()) }),
);

// ["red", "green", "blue"]
console.log(data.colors);
```

Accepts [Standard Schema](https://github.com/standard-schema/standard-schema) objects (Zod, Valibot, ArkType) or a raw JSON Schema string. Returns `{ data: T, raw: IAskResult }`. Throws `JsonValidationError` on parse or validation failure.

**Returns:** `Promise<IJsonResult<T>>`

```ts
interface IJsonResult<T> {
  data: T;          // validated and typed result
  raw: IAskResult;  // full ask result (text, cost, events)
}
```

## `agents.stream(agent, prompt, options?)`

Returns an `IAgentStream` - an async iterable that yields events as they arrive.

```ts
const stream = agents.stream("claude", "Explain this code");

// Option A: iterate events
for await (const event of stream) {
  if (event.type === "text-delta") process.stdout.write(event.text);
}

// Option B: convenience methods (consumes the stream)
const text = await stream.text();
const result = await stream.result();
```

::: warning
Iteration and convenience methods are mutually exclusive. If you start iterating with `for await`, calling `.text()` / `.result()` will throw. Pick one approach.
:::

## `agents.session(agent, options?)`

Create a persistent multi-turn session. See [Session](/api/session).

```ts
await using session = await agents.session(
  "codex",
  {
    cwd: ".",
    permission: "auto-allow",
  },
);
```

## `createClient(defaults)`

Create a new client with preset defaults. All options are merged with per-call overrides.

```ts
import { createClient } from "@pivanov/agents-wire";

const myClient = createClient({
  cwd: "/my/project",
  permission: "auto-allow",
  maxCostUsd: 1.00,
});

const result = await myClient.ask("claude", "What does this do?");
```

## `IAgentOptions`

All methods accept these options:

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string` | Working directory for the agent process |
| `permission` | `TPermissionPolicy` | Permission policy: `"auto-allow"`, `"auto-allow-once"`, `"auto-reject"`, `"stream"`, or custom function |
| `model` | `string` | Agent-specific model identifier. **What this actually does varies by agent** - see [Model selection by agent](/agents/index#model-selection-by-agent). Forwarded to `definition.launch()` as `IWireLaunchOptions.model`; also used for pricing lookup. |
| `effort` | `string` | Reasoning effort hint. For codex, becomes `-c model_reasoning_effort="X"` CLI arg (works). For other agents, sent via ACP `setSessionConfigOption({ configId: "reasoning_effort", value })` after `newSession` - best-effort; the agent may silently ignore. Common values: `"low"`, `"medium"`, `"high"`. |
| `modelPreference` | `{ configId: string; value: string \| boolean }` | Sent via ACP `setSessionConfigOption` after `newSession`. Best-effort: silently ignored if the agent doesn't implement that method. |
| `systemPrompt` | `string` | Override system prompt |
| `toolHandler` | `IToolHandler` | Runtime tool control (allow/deny/intercept) |
| `maxCostUsd` | `number` | SDK-side budget limit. Throws `BudgetExceededError` when exceeded |
| `mcpServers` | `IMcpServer[]` | MCP servers to register with the agent |
| `envFilter` | `(env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv` | Strip or transform the merged environment before spawning. Use this to inject or remove env vars without modifying `process.env`. |
| `signal` | `AbortSignal` | Abort signal for cancellation |
| `onCostUpdate` | `(cost: ICostSnapshot) => void` | Called after each turn with cost data |
| `onWarning` | `(message: string, cause?: unknown) => void` | Routes library warnings. Defaults to `console.warn`; pass `() => {}` to silence. |
| `onRetry` | `(attempt: number, error: unknown) => void` | Called before each backoff delay during auto-respawn. |
| `onRecycle` | `(reason: TRecycleReason) => void` | Called before each proactive recycle. Reason is `"turn-limit"` today. |
| `inactivityTimeoutMs` | `number` | Inactivity watchdog timeout in ms (default: 5 minutes). Pass `Infinity` to disable. |
| `autoRespawn` | `boolean` | Auto-respawn on transient failures (default: `true`). Set `false` to disable. |
| `maxTurnsBeforeRecycle` | `number` | Proactively recycle the host after N turns to bound memory growth. Defaults to 100. Set to `0` to disable. |

### Session-only options

`ISessionOptions` extends `IAgentOptions` with:

| Option | Type | Description |
|--------|------|-------------|
| `onRetry` | `(attempt: number, error: unknown) => void` | Fires each time a transient failure triggers a respawn inside one `ask()`. |
| `autoRespawn` | `boolean` | Default `true`. Re-spawns the host with backoff `[500, 1000, 2000] ms` up to 3 attempts on `AgentConnectionClosedError`, `ECONNRESET`, and similar transient failures. Set `false` to disable. |
| `maxTurnsBeforeRecycle` | `number` | Recycle the host after N turns (default: 100). Set `0` to disable. |

### Per-ask options

`session.ask(prompt, options?)` accepts `IAskOptions`:

| Option | Type | Description |
|--------|------|-------------|
| `onRetry` | `(attempt: number, error: unknown) => void` | Per-ask retry observer. Fires alongside the session-level `onRetry` when both are set. |
| `onCostUpdate` | `(cost: ICostSnapshot) => void` | Per-ask cost observer. Useful for request-scoped metadata. |
| `signal` | `AbortSignal` | Per-ask abort. Aborts this ask only (session stays alive). |

::: info Dual Budget System
`maxCostUsd` is SDK-level budget enforcement (throws `BudgetExceededError`) and uses the SDK cost tracker. It works for agents that report per-turn `costUsd` (for example Claude). Subscription agents (Cursor, Copilot, Pi, Auggie) do not report per-turn `costUsd`, so `maxCostUsd` remains `0` and will not trigger for them.
:::

## Terminal and FileSystem Handlers

Two optional handler groups let the agent call back into your process for file and terminal
operations over ACP.

### `IAgentOptions.fileSystem`

```ts
interface IFileSystemHandlers {
  readTextFile?: (params: ReadTextFileRequest) => Promise<ReadTextFileResponse>;
  writeTextFile?: (params: WriteTextFileRequest) => Promise<WriteTextFileResponse>;
}
```

Implement these to intercept file reads and writes the agent requests. The request and
response types come directly from `@agentclientprotocol/sdk`.

### `IAgentOptions.terminal`

```ts
interface ITerminalHandlers {
  createTerminal?: (
    params: CreateTerminalRequest,
  ) => Promise<CreateTerminalResponse>;
  terminalOutput?: (
    params: TerminalOutputRequest,
  ) => Promise<TerminalOutputResponse>;
  releaseTerminal?: (
    params: ReleaseTerminalRequest,
  ) => Promise<ReleaseTerminalResponse | undefined>;
  waitForTerminalExit?: (
    params: WaitForTerminalExitRequest,
  ) => Promise<WaitForTerminalExitResponse>;
  killTerminal?: (
    params: KillTerminalRequest,
  ) => Promise<KillTerminalResponse | undefined>;
}
```

All five methods are optional. Unimplemented methods are silently skipped.

::: info
Terminal and FileSystem handlers are currently primarily exercised by Claude Code. Other
agents may not invoke these callbacks.
:::

Example wiring both handlers:

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "claude",
  "Read README.md",
  {
    permission: "auto-allow",
    fileSystem: {
      readTextFile: async ({ path }) => ({
        content: await myStorage.read(path),
      }),
      writeTextFile: async ({ path, content }) => {
        await myStorage.write(path, content);
        return {};
      },
    },
    terminal: {
      createTerminal: async ({ id }) => {
        return { id };
      },
    },
  },
);
```
