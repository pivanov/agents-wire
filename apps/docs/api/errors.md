# Errors

All errors extend `WireError`, which extends the native `Error`. You can catch them specifically or broadly.

## `WireError`

Base error class for all agents-wire errors.

```ts
import { WireError } from "@pivanov/agents-wire";

try {
  await agents.ask("claude", "...");
} catch (error) {
  if (error instanceof WireError) {
    console.error("agents-wire error:", error.message, error.code);
  }
}
```

**Properties:**
- `code?: TKnownErrorCode` - machine-readable code when applicable
- `_tag: string` - literal discriminant for `switch`-based pattern matching without `instanceof`

## `_tag` Discriminants

Every error class carries a `_tag` literal for serialization-safe switching:

```ts
try {
  await agents.ask("claude", "...");
} catch (error) {
  if (!(error instanceof Error)) throw error;
  switch ((error as { _tag?: string })._tag) {
    case "AgentInactivityError":      /* handle hung process */ break;
    case "BudgetExceededError":       /* handle budget */ break;
    case "AbortError":                /* handle cancel */ break;
    case "AgentUnauthenticatedError": /* handle auth */ break;
    case "CapabilityNotSupportedError": /* handle unsupported feature */ break;
    default: throw error;
  }
}
```

## `BudgetExceededError`

Thrown when `maxCostUsd` is set and the cumulative cost exceeds the budget. The process is automatically killed.

```ts
import { BudgetExceededError } from "@pivanov/agents-wire";

try {
  await agents.ask(
    "claude",
    "...",
    {
      maxCostUsd: 0.10,
    },
  );
} catch (error) {
  if (error instanceof BudgetExceededError) {
    const spent = error.spent.toFixed(4);
    const budget = error.budget.toFixed(4);
    console.error(`Spent $${spent} of $${budget} limit`);
  }
}
```

**Properties:**
- `spent: number` - amount spent in USD
- `budget: number` - the limit that was exceeded

::: info Subscription agents
`BudgetExceededError` only triggers when the agent reports per-turn `costUsd` (for example Claude). Cursor, Copilot, Pi, and Auggie are subscription-based and do not report per-turn `costUsd`, so `maxCostUsd` will not fire for them.
:::

## `AbortError`

Thrown when the operation is cancelled via an `AbortSignal`.

```ts
import { AbortError } from "@pivanov/agents-wire";

try {
  await agents.ask(
    "claude",
    "...",
    {
      signal: AbortSignal.timeout(5000),
    },
  );
} catch (error) {
  if (error instanceof AbortError) {
    console.error("Request was cancelled");
  }
}
```

## `AgentInactivityError`

Thrown by the inactivity watchdog when the agent goes silent past `inactivityTimeoutMs` (default: 5 minutes). The watchdog resets on every data chunk, so a chatty stream stays alive indefinitely.

```ts
import { AgentInactivityError } from "@pivanov/agents-wire";

try {
  await agents.ask(
    "claude",
    "...",
    {
      inactivityTimeoutMs: 30_000,
    },
  );
} catch (error) {
  if (error instanceof AgentInactivityError) {
    console.error(`Agent silent for ${error.inactivityMs}ms, killed`);
  }
}
```

**Properties:**
- `inactivityMs: number` - the configured timeout that fired

Extends `WireError`. Pass `Infinity` to disable the watchdog entirely.

## `AgentInitTimeoutError`

Thrown when the agent process fails to complete initialization within the timeout window.

## `AgentConnectionClosedError`

Thrown when the ACP connection to the agent is closed unexpectedly. This is considered a transient error - `session.ask()` will auto-respawn on this error (up to 3 times with backoff).

## `AgentUnauthenticatedError`

Thrown when the agent's stderr (post-init) matches an authentication-failure pattern. Indicates the agent CLI is not logged in.

```ts
import { AgentUnauthenticatedError } from "@pivanov/agents-wire";

try {
  await agents.ask("claude", "...");
} catch (error) {
  if (error instanceof AgentUnauthenticatedError) {
    console.error("Claude is not authenticated. Run: claude /login");
  }
}
```

## `AgentUsageLimitError`

Thrown when the agent's stderr matches a usage-limit pattern (quota exceeded, plan limit, etc.).

## `AgentNotInstalledError`

Thrown when the agent binary cannot be found on `PATH`.

```ts
import { AgentNotInstalledError } from "@pivanov/agents-wire";

try {
  await agents.ask("codex", "...");
} catch (error) {
  if (error instanceof AgentNotInstalledError) {
    console.error("Codex CLI not found. Install it first.");
  }
}
```

## `ProtocolVersionMismatchError`

Thrown when the agent's ACP `protocolVersion` does not match the version the SDK expects. Indicates an incompatible agent CLI version.

**Properties:**
- `agentVersion: string` - the version the agent reported
- `sdkVersion: string` - the version the SDK expected

## `CapabilityNotSupportedError`

Thrown when you attempt to use a feature the agent doesn't support - for example, passing an `http` MCP server to an agent that only supports `stdio`, or calling `listSessions` on an agent that doesn't advertise it.

```ts
import { CapabilityNotSupportedError } from "@pivanov/agents-wire";

try {
  await session.listSessions();
} catch (error) {
  if (error instanceof CapabilityNotSupportedError) {
    console.error("This agent doesn't support session listing");
  }
}
```

## `JsonValidationError`

Thrown by `askJson()` when the response cannot be parsed as valid JSON or fails schema validation.

```ts
import { JsonValidationError } from "@pivanov/agents-wire";

try {
  await agents.askJson("claude", "...", schema);
} catch (error) {
  if (error instanceof JsonValidationError) {
    console.error("Raw text:", error.rawText);
    console.error("Issues:", error.issues);
  }
}
```

**Properties:**
- `rawText: string` - the raw text that failed to parse or validate
- `issues: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>` - validation issues from the schema library

## `KNOWN_ERROR_CODES`

The full set of machine-readable error codes:

```ts
import { KNOWN_ERROR_CODES } from "@pivanov/agents-wire";

console.log(KNOWN_ERROR_CODES);
// ["not-authenticated", "binary-not-found", "permission-denied",
//  "retry-exhausted", "usage-limit", "protocol-version-mismatch",
//  "capability-not-supported", ...]
```

## `isKnownError(error)`

Type guard for errors with a `code` field.

```ts
import { isKnownError } from "@pivanov/agents-wire";

if (isKnownError(error) && error.code === "retry-exhausted") {
  // Session is dead - create a new one.
}
```

## `isTransientError(error)`

Detects transient errors that may succeed on retry (network issues, connection closed). Returns `false` for `AbortError` and `BudgetExceededError` (intentional, not transient). `session.ask()` uses this internally to decide which failures trigger auto-respawn.

```ts
import { isTransientError } from "@pivanov/agents-wire";

if (isTransientError(error)) {
  // safe to retry
}
```

Detected transient patterns: `ECONNREFUSED`, `ECONNRESET`, `ECONNABORTED`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `EAI_AGAIN`, network errors, socket hang-up, `EPIPE`, `SIGPIPE`, broken pipe, and `AgentConnectionClosedError`.

## `classifyStderrFatal(stderr, agentId?)`

Classify a stderr string into an error type. Used internally by the auth/usage-limit detection system; exported for custom integrations.

```ts
import { classifyStderrFatal } from "@pivanov/agents-wire";

const match = classifyStderrFatal("Error: rate limit exceeded", "claude");
// match: { type: "usage-limit" } | { type: "unauthenticated" } | undefined
```
