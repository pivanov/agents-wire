# Cursor

**Agent ID:** `cursor`

Cursor's agent CLI. Speaks ACP natively via `cursor agent acp` - no bridge package needed.

## Install

Install the Cursor app and ensure the `cursor` CLI is on your `PATH`. See the [Cursor Agent CLI docs](https://cursor.com/docs/cli/acp).

Sign in to the Cursor application to authenticate.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "cursor",
  "Explain this repo",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

`cursor-agent acp` does not accept a `--model` flag (verified via `--help`). `options.model`
is forwarded as ACP `modelPreference` but is currently silently ignored by `cursor-agent acp`.

To list the models Cursor supports at runtime, call `listAvailableModels()`:

```ts
import { definitionFor } from "@pivanov/agents-wire/catalog";

const def = definitionFor("cursor");
const models = (await def.listAvailableModels?.()) ?? def.models ?? [];

// models is IAgentModelOption[] - falls back to static list on any failure
console.log(models.map((m) => m.id));
```

Configure the active model via the Cursor application settings. `options.effort` is sent
via ACP `setSessionConfigOption` (best-effort); Cursor's effort variants are typically
baked into model IDs (kind: `variant`) - for example a model id might carry a `-low`,
`-high`, or `-xhigh` suffix. Use `listAvailableModels()` to see the live IDs.

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ✅ |
| Session listing (`listSessions`) | ✅ |
| Tool call interception | ✅ |
| Mode switching (`setMode`) | ✅ (`auto`, `max`) |

## Cost Tracking

Cursor is subscription-based and does not report per-turn `costUsd`. `cost.snapshot.totalUsd` stays at `0`, so `maxCostUsd` does not trigger. Monitor usage with `cost.turnCount`.

## Auth Failure Detection

If the Cursor application is not signed in, the SDK catches the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Mode Switching

Cursor supports `auto` and `max` modes:

```ts
const session = await agents.session(
  "cursor",
  {
    permission: "auto-allow",
  },
);

console.log(session.modeState?.currentModeId);     // "auto"
console.log(session.modeState?.availableModes);    // ["auto", "max"]

await session.setMode("max");
```

## Gotchas

- Requires the Cursor app to be installed and signed in on the machine.
- No per-turn cost data - use turn counts to track usage against your Cursor plan.
