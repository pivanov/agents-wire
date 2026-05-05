# OpenCode

**Agent ID:** `opencode`

OpenCode speaks ACP natively via `opencode acp` - no bridge package needed.

## Install

```bash
npm install -g opencode-ai
```

Configure your provider API key according to the [OpenCode docs](https://opencode.ai/docs).

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "opencode",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

`opencode acp` does not advertise a `--model` flag (verified via `--help`). `options.model`
is forwarded as ACP `modelPreference` but is currently silently ignored by `opencode acp`.

To list the models OpenCode supports at runtime, call `listAvailableModels()`:

```ts
import { definitionFor } from "@pivanov/agents-wire/catalog";

const def = definitionFor("opencode");
const models = (await def.listAvailableModels?.()) ?? def.models ?? [];

// models is IAgentModelOption[] - falls back to static list on any failure
console.log(models.map((m) => m.id));
```

Configure the active model via the OpenCode configuration (e.g. `opencode auth login`).
`options.effort` is sent via ACP `setSessionConfigOption` (best-effort); whether OpenCode
honors it depends on the installed version.

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ✅ |
| Session listing (`listSessions`) | ✅ |
| Tool call interception | ✅ |

## Cost Tracking

OpenCode reports per-turn `costUsd` depending on the provider configured. Full cost tracking and `maxCostUsd` budget enforcement work when the underlying provider reports costs.

## Auth Failure Detection

If the configured provider API key is missing or invalid, the SDK catches the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- OpenCode is provider-agnostic - configure your provider (Anthropic, OpenAI, etc.) before use.
- Cost reporting depends on the provider; not all providers expose per-turn cost data.
