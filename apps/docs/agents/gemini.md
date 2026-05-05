# Gemini CLI

**Agent ID:** `gemini`

Google's Gemini CLI. Speaks ACP via a peer-installed bridge package.

## Install

```bash
npm install -g @google/gemini-cli
gemini auth login
```

The `@google/gemini-cli` package must be installed as a **peer** - it is not bundled with `agents-wire`.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "gemini",
  "Summarize this PR",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

`options.model` is forwarded as ACP `modelPreference` (best-effort). The `gemini --acp`
bridge does not accept CLI model flags, so model selection depends entirely on whether the
ACP bridge implements `setSessionConfigOption`. `options.effort` is sent via the same
mechanism (best-effort).

To see which models Gemini currently advertises for a session, read `session.configOptions`:

```ts
import { createSession } from "@pivanov/agents-wire";

const session = await createSession("gemini");
const opts = session.configOptions ?? [];
const modelOpt = opts.find((o) => o.configId === "model" && o.type === "select");

if (modelOpt && modelOpt.type === "select") {
  console.log(modelOpt.options); // live model list from the agent
}
```

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ✅ |
| Session listing (`listSessions`) | ❌ |
| Tool call interception | ✅ |

## Cost Tracking

Gemini reports per-turn `costUsd`. Full cost tracking and `maxCostUsd` budget enforcement work.

## Auth Failure Detection

If `gemini auth login` hasn't been run or credentials have expired, the SDK throws `AgentUnauthenticatedError`.

## Gotchas

- The `@google/gemini-cli` package is a peer dependency - install it separately.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
- Gemini CLI requires a Google account with the Gemini API enabled, or a paid API key.
