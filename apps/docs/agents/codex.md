# Codex CLI

**Agent ID:** `codex`

OpenAI's Codex CLI. Speaks ACP via the `@zed-industries/codex-acp` bridge, which is bundled with `agents-wire` (no peer install needed).

## Install

Install the Codex CLI and set your API key:

```bash
npm install -g @openai/codex
export OPENAI_API_KEY="sk-..."
```

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "codex",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

`options.model` becomes `-c model="X"` on the `codex-acp` CLI (verified via
`codex-acp --help`). This is the most reliable model selection path of all built-in agents.

`options.effort` becomes `-c model_reasoning_effort="X"`. Valid values are `"low"`,
`"medium"`, and `"high"`. Only applies to reasoning models (o3, o1).

```ts
await agents.ask(
  "codex",
  prompt,
  {
    model: "gpt-5",
  },
);
await agents.ask(
  "codex",
  prompt,
  {
    model: "o3",
  },
);

// Reasoning effort (o3, o1 only):
await agents.ask(
  "codex",
  prompt,
  {
    model: "o3",
    effort: "low",
  },
);
await agents.ask(
  "codex",
  prompt,
  {
    model: "o3",
    effort: "high",
  },
);
```

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

Codex reports per-turn `costUsd`. Full cost tracking and `maxCostUsd` budget enforcement work.

## Auth Failure Detection

If `OPENAI_API_KEY` is missing or invalid, the SDK catches the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- Requires a POSIX environment (macOS, Linux, WSL).
- The `OPENAI_API_KEY` must be set in the environment. Pass custom env vars via `options.envFilter`.
