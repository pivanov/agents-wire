# Session

A session keeps a single agent process alive across multiple `ask()` calls, preserving conversation context.

::: warning One-shot classifiers don't belong in a session
Sessions keep the full conversation in context - every turn sees all prior turns. For stateless one-shot work (classifiers, extractors, routers), use `agents.askJson()` instead.
:::

## Creating a Session

```ts
import { agents } from "@pivanov/agents-wire";

await using session = await agents.session(
  "claude",
  {
    cwd: "/my/project",
    permission: "auto-allow",
    maxCostUsd: 1.00,
  },
);
```

`await using` calls `session[Symbol.asyncDispose]()` automatically when the block exits. Alternatively, call `session.close()` in a `finally` block.

## `session.ask(prompt, options?)`

Send a message and wait for the complete response. Each call reads events until the turn completes, then stops - leaving the process alive for the next call.

```ts
const r1 = await session.ask("Read package.json and summarize it");
console.log(r1.text);

const r2 = await session.ask("Now add a lint script");
console.log(r2.text);
```

**Returns:** `Promise<IAskResult>` with the same shape as `agents.ask()`.

### Per-ask options (`IAskOptions`)

Pass a second argument to override session-level callbacks for a single call:

```ts
async function handleRequest(req) {
  return session.ask(
    req.prompt,
    {
      onRetry: (attempt, error) => {
        logger.warn(`req ${req.id} retry ${attempt}`, error);
      },
      signal: AbortSignal.timeout(30_000),  // per-request timeout
    },
  );
}
```

| Option | Type | Description |
|--------|------|-------------|
| `onRetry` | `(attempt: number, error: unknown) => void` | Per-ask retry observer |
| `onCostUpdate` | `(cost: ICostSnapshot) => void` | Per-ask cost observer |
| `signal` | `AbortSignal` | Per-ask abort. Session stays alive. |

## `session.askJson(prompt, schema, options?)`

SDK-side validated JSON within a session. Conversation context is preserved between calls.

```ts
import { z } from "zod";

// "Return JSON: { files: { name: string, bytes: number }[] }"
const prompt = "What are the top 3 files by size? Return JSON";
const schema = z.object({
  files: z.array(z.object({ name: z.string(), bytes: z.number() })),
});

const { data } = await session.askJson(prompt, schema);

console.log(data.files);
```

Accepts Standard Schema objects or raw JSON Schema strings. Throws `JsonValidationError` on failure.

## `session.close()`

Kill the underlying process and release resources.

```ts
try {
  const r1 = await session.ask("First question");
  const r2 = await session.ask("Follow-up");
} finally {
  await session.close();
}
```

## `session.sessionId`

The session ID assigned by the agent. Available after the first successful turn.

## `session.cost`

The session's cost tracker. `session.cost.snapshot` gives the current cumulative totals.

```ts
console.log(session.cost.snapshot.totalUsd);
console.log(session.cost.snapshot.byAgent);  // per-agent breakdown
console.log(session.cost.turnCount);
console.log(session.cost.averagePerTurn);
```

## `session.configOptions`

Agent-declared configuration options for this session. Populated from the ACP `newSession`
response. Each entry is a discriminated union:

- `{ type: "select", configId: string, options: string[] }` - a knob with a fixed
  set of valid values (e.g. model picker, effort selector).
- `{ type: "boolean", configId: string, value: boolean }` - a toggle.

Returns `undefined` if the agent advertises no options.

```ts
import { createSession } from "@pivanov/agents-wire";

const session = await createSession("claude");
const opts = session.configOptions ?? [];

const modelOpt = opts.find(
  (o) => o.configId === "model" && o.type === "select",
);

// modelOpt.options is the exact list the agent accepts
if (modelOpt && modelOpt.type === "select") {
  console.log(modelOpt.options); // ["haiku", "sonnet", "opus", ...]
}
```

Use `configOptions` to render dynamic UI (model pickers, effort selectors) that reflect
what the running agent actually supports, rather than hardcoding values. See also
`IAgentDefinition.listAvailableModels` in the [Catalog API](/agents/index#catalog-api) for
the static and live model lists.

## `resolveModels(agent, options?)`

Helper that walks the full resolution hierarchy and returns a typed `IResolvedModels` object.
Use this instead of reading `configOptions`, `listAvailableModels`, and `def.models` manually.

```ts
import { resolveModels } from "@pivanov/agents-wire";
import { createSession } from "@pivanov/agents-wire";

// Without a session - falls back to live-list or static placeholder
const { source, models } = await resolveModels("opencode");
console.log(source);  // "live-list" | "static" | "none"
console.log(models.map((m) => m.id));

// With a session - uses agent-declared configOptions (highest priority)
const session = await createSession("claude");
const resolved = await resolveModels("claude", { session });
console.log(resolved.source);         // "session-config"
console.log(resolved.modelConfigId);  // e.g. "model"
console.log(resolved.effortConfigId); // e.g. "reasoning_effort"
```

### `IResolvedModels`

```ts
interface IResolvedModels {
  source: TModelSource;        // where the list came from
  models: IAgentModelOption[]; // resolved model list
  modelConfigId?: string;      // ACP configId for model selection
  effortConfigId?: string;     // ACP configId for effort selection
}

type TModelSource = "session-config" | "live-list" | "static" | "none";
```

**Resolution hierarchy (highest priority first):**

1. `session.configOptions` - agent-declared options from the live ACP session
2. `def.listAvailableModels()` - CLI introspection (Cursor, OpenCode, Kilo)
3. `def.models` - cold-start placeholder (`[{ id: "default" }]`)

For agents marked `acpCompatible: false` (Pi v0.73), step 1 is skipped.

## `IModelEffort` discriminated union

Each `IAgentModelOption` may carry an `effort` field that describes what effort controls
the model exposes. The four kinds map directly to UI affordances:

```ts
type IModelEffort =
  | { kind: "none" }
  // finite named tiers (low / medium / high / xhigh / max)
  | { kind: "enum"; values: readonly string[]; default?: string }
  // numeric thinking-token budget (Claude's thinking_budget)
  | { kind: "budget"; min: number; max: number; default?: number }
  // effort is baked into the model id - no separate selector needed
  | { kind: "variant" };
```

| Kind | UI affordance | Example agents |
|------|--------------|----------------|
| `none` | no effort control | Droid, Pi, Cline (BYOK) |
| `enum` | dropdown / segmented control (low / medium / high) | Codex (o3, o1) |
| `budget` | numeric slider or input | Claude (thinking_budget) |
| `variant` | hidden - effort is already in the model id | Cursor |

## `session.modeState`

Current mode state for agents that support mode switching (e.g. Cursor's `auto` / `max` modes).

```ts
console.log(session.modeState?.currentModeId);
console.log(session.modeState?.availableModes);
```

## `session.setMode(modeId)`

Switch the agent's mode. Validates against `modeState.availableModes` and throws `CapabilityNotSupportedError` if the agent doesn't support mode switching.

```ts
await session.setMode("max");
```

## `session.listSessions(options?)`

List previous sessions for the agent (if supported). Throws `CapabilityNotSupportedError` if the agent doesn't advertise session listing.

```ts
const page = await session.listSessions({ cwd: "." });
console.log(page.sessions, page.nextCursor);

// Auto-paginate:
for await (const s of session.streamAllSessions()) {
  console.log(s.sessionId, s.createdAt);
}
```

## Resilience - Auto-Respawn

Transient failures (`AgentConnectionClosedError`, `ECONNRESET`, `ECONNABORTED`, `ETIMEDOUT`, and similar) trigger an automatic respawn inside a single `ask()` call.

- **Budget:** up to 3 respawns per `ask()`.
- **Backoff:** `500ms → 1s → 2s` between retries.
- **Cost preservation:** cost offset is snapshotted before each respawn so cumulative totals survive the new process (`cost.fork()`).
- **Budget exhaustion:** when retries are used up, throws `WireError("retry-exhausted")` and closes the session.
- **Opt out:** pass `autoRespawn: false` to disable.

### Observing retries

```ts
const session = await agents.session(
  "claude",
  {
    permission: "auto-allow",
    onRetry: (attempt, error) => {
      console.warn(`respawn ${attempt}:`, error);
    },
  },
);
```

## Turn Limits

After a configurable number of turns, the session pre-emptively recycles the process to prevent context window overflow. This is transparent - the next `ask()` spawns a fresh process.

Pass `onRecycle` to observe the transition:

```ts
const session = await agents.session(
  "claude",
  {
    onRecycle: (reason) => {
      metrics.increment("agents_wire.session.recycle", { reason });
    },
  },
);
```

## AbortSignal Support

```ts
const session = await agents.session(
  "claude",
  {
    signal: AbortSignal.timeout(60_000),
  },
);
```

## Inactivity Watchdog

Each read operation has a configurable inactivity timeout (default: 5 minutes). If no data arrives within this window, the SDK throws `AgentInactivityError` and kills the process.

```ts
const session = await agents.session(
  "claude",
  {
    inactivityTimeoutMs: 30_000,  // fail fast in production paths
  },
);

// Disable the watchdog for batch jobs:
const longRunning = await agents.session(
  "codex",
  {
    inactivityTimeoutMs: Infinity,
  },
);
```

`AgentInactivityError` extends `TimeoutError`, so existing `instanceof TimeoutError` catches still fire.

## Error Handling

`session.ask()` can reject with:

- **`AgentConnectionClosedError`** - connection dropped (transient - triggers auto-respawn).
- **`AbortError`** - an `AbortSignal` fired during the turn.
- **`BudgetExceededError`** - `maxCostUsd` was exceeded. Session is closed.
- **`WireError("retry-exhausted")`** - respawn budget used up. Session is closed.
- **`AgentInactivityError`** - inactivity watchdog fired.
- **`WireError("session-closed")`** - session was already closed (prior fatal error or `close()` was called).

Only `WireError("retry-exhausted")` and `BudgetExceededError` permanently close the session.
