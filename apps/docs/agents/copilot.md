# GitHub Copilot

**Agent ID:** `copilot`

GitHub Copilot CLI agent. Speaks ACP via a peer-installed bridge package.

## Install

```bash
npm install -g @github/copilot
gh auth login
```

The `@github/copilot` package must be installed as a **peer** - it is not bundled with `agents-wire`.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "copilot",
  "Review src/auth.ts for security issues",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

`options.model` is forwarded as ACP `modelPreference` (best-effort). Whether the current
Copilot agent version honors it is not guaranteed. `options.effort` is sent via the same
mechanism (best-effort).

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

Copilot is subscription-based and does not report per-turn `costUsd`. `cost.snapshot.totalUsd` stays at `0`, so `maxCostUsd` does not trigger. Monitor usage with `cost.turnCount`.

## Auth Failure Detection

If `gh auth login` hasn't been run, the SDK catches the auth-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- The `@github/copilot` package is a peer dependency - install it separately before using the `copilot` agent.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
- No per-turn cost data - use turn counts to track usage against your GitHub plan.
