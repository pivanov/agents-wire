# Qwen Code

**Agent ID:** `qwen`

Qwen Code by Alibaba's Qwen team. Speaks ACP natively via `qwen --acp --experimental-skills`.

## Install

```bash
npm install -g @qwen-code/qwen-code
qwen auth qwen-oauth
# or: export BAILIAN_CODING_PLAN_API_KEY="your-api-key"
```

Free tier: 100 requests/day via `qwen auth qwen-oauth`. For higher limits, set
`BAILIAN_CODING_PLAN_API_KEY` with a Bailian API key.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "qwen",
  "Review src/auth.ts",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Qwen Code supports multiple providers (BYOK). There is no `qwen --list-models` CLI flag;
model selection is exposed via the in-session `/model` command. The static catalog shows
a "Default" placeholder pre-init.

After creating a session, read `session.configOptions` to discover which models the
running instance exposes:

```ts
import { createSession } from "@pivanov/agents-wire";

const session = await createSession("qwen");
const opts = session.configOptions ?? [];
const modelOpt = opts.find((o) => o.configId === "model" && o.type === "select");

if (modelOpt && modelOpt.type === "select") {
  console.log(modelOpt.options); // provider-specific model list
}
```

`options.model` and `options.effort` are sent via ACP `setSessionConfigOption` (best-effort).

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

Cost reporting depends on the provider. The free OAuth tier does not report per-turn
`costUsd`. BYOK providers (Bailian, etc.) may report costs. Check `result.cost` and
`session.cost.snapshot.totalUsd` for what is available.

## Auth Failure Detection

If `qwen auth qwen-oauth` has not been run or the API key is invalid, the SDK catches
the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- Run `qwen auth qwen-oauth` before first use, or set `BAILIAN_CODING_PLAN_API_KEY`.
- The `--experimental-skills` flag is required for tool execution. Without it, Qwen
  runs in chat-only mode. The `agents-wire` launch spec passes it automatically.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
