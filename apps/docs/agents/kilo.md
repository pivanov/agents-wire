# Kilo

**Agent ID:** `kilo`

Kilo is a coding agent that proxies 500+ models via [models.dev](https://models.dev). Speaks ACP natively via `kilo acp`.

## Install

```bash
npm install -g @kilocode/cli
kilo auth login --provider <id>
# or: export KILO_API_KEY="your-api-key"
```

See [kilocode.ai](https://kilocode.ai) for supported providers and setup instructions.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "kilo",
  "Explain this codebase",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Kilo proxies 500+ models via models.dev. Use `listAvailableModels()` to get the live
list (calls `kilo models` under the hood):

```ts
import { definitionFor } from "@pivanov/agents-wire/catalog";

const def = definitionFor("kilo");
const models = (await def.listAvailableModels?.()) ?? def.models ?? [];

// models is IAgentModelOption[] - provider/model pairs from models.dev
console.log(models.map((m) => m.id));
// e.g. ["anthropic/claude-sonnet-4-7", "openai/gpt-5", ...]
```

The static catalog shows a "Default" placeholder before `kilo models` can be called.
`options.model` is sent via ACP `setSessionConfigOption` (best-effort).
Effort kind varies per upstream model - check `IAgentModelOption.effort` on each entry.

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

Cost reporting depends on the upstream model and provider. Token-priced models report
per-turn `costUsd`. Check `result.cost` and `session.cost.snapshot.totalUsd` to see what
is available for your configured provider.

## Auth Failure Detection

If `KILO_API_KEY` is missing or `kilo auth login` has not been run, the SDK catches the
authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- Authenticate with `kilo auth login --provider <id>` before use, or set `KILO_API_KEY`.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
- Model IDs are `provider/model` pairs (e.g. `anthropic/claude-sonnet-4-7`). Use
  `listAvailableModels()` to get the exact IDs the current installation supports.
