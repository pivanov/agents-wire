# Augment Code (Auggie)

**Agent ID:** `auggie`

Auggie is the CLI for [Augment Code](https://www.augmentcode.com), an enterprise AI coding agent backed by their context engine. Subscription-only auth.

## Install

```bash
npm install -g @augmentcode/auggie
auggie login
```

`auggie login` opens an OAuth flow against your Augment account. Without a valid subscription the CLI refuses most operations.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "auggie",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Auggie's model list is gated behind authentication. The static catalog ships a "Default" placeholder; the live list populates via `auggie model list` once you log in:

```ts
import { definitionFor } from "@pivanov/agents-wire/catalog";

const def = definitionFor("auggie");
const models = (await def.listAvailableModels?.()) ?? def.models ?? [];
// Logged in: real Auggie model IDs.
// Logged out: empty (falls back to "Default" placeholder).
```

After creating a session, `session.configOptions` reflects what the running Auggie instance accepts in real time.

`options.model` and `options.effort` are sent via ACP `setSessionConfigOption` (best-effort). Subscription pricing means `result.cost?.totalUsd` stays at `0`.

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ❌ |
| Session listing (`listSessions`) | ❌ |
| Tool call interception | ✅ |

## Cost Tracking

Auggie is subscription-priced and does not report per-turn `costUsd`. `cost.snapshot.totalUsd` stays at `0`, so `maxCostUsd` does not trigger. Monitor usage with `cost.turnCount`.

## Auth Failure Detection

The CLI's `"You are not currently logged in to Augment"` stderr is matched by `authFailurePatterns`, so unauthenticated calls throw `AgentUnauthenticatedError` rather than a generic crash.

## Gotchas

- The SDK injects `AUGMENT_DISABLE_AUTO_UPDATE=1` into Auggie's environment to prevent the auto-update probe from stalling the ACP handshake. Update Auggie manually with `npm update -g @augmentcode/auggie` instead.
- Subscription required - there is no BYOK or free tier.
- Live `auggie model list` output format is best-effort parsed in the SDK; if Auggie changes the format, `listAvailableModels()` returns `[]` and the picker falls back to the placeholder.
