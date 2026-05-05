# Factory Droid

**Agent ID:** `droid`

Factory Droid from [Factory AI](https://factory.ai). Speaks ACP natively via `droid exec --output-format acp`.

## Install

```bash
npm install -g droid
export FACTORY_API_KEY="your-api-key"
```

Get your API key from [factory.ai](https://factory.ai).

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "droid",
  "Fix the failing tests",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Droid auto-selects its model. `options.model` and `options.effort` are not exposed. The
active model is determined by Factory AI based on your account and the task.

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ❌ |
| Session listing (`listSessions`) | ✅ |
| Tool call interception | ✅ |

## Cost Tracking

Droid reports per-turn `costUsd` where available. Full cost tracking and `maxCostUsd` budget enforcement work.

## Auth Failure Detection

If `FACTORY_API_KEY` is missing or invalid, the SDK catches the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- `FACTORY_API_KEY` must be set. Pass it via `options.envFilter` if you need to inject it programmatically.
- Requires a POSIX environment (macOS, Linux, WSL).
