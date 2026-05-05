# Claude Code

**Agent ID:** `claude`

Claude Code from Anthropic. Speaks ACP via the `@agentclientprotocol/claude-agent-acp` bridge, which is bundled with `agents-wire` (no peer install needed).

## Install

Follow the [Claude Code setup guide](https://docs.claude.com/en/docs/claude-code/setup), then authenticate:

```bash
claude /login
```

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "claude",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
    maxCostUsd: 0.5,
  },
);

console.log(result.text);
console.log(result.cost?.totalUsd);
```

## Model Selection

`options.model` is sent to Claude via ACP `setSessionConfigOption` (best-effort). Whether
the running Claude process honors it depends on the Claude Code version installed.

```ts
await agents.ask(
  "claude",
  prompt,
  {
    model: "haiku",
  },
);
await agents.ask(
  "claude",
  prompt,
  {
    model: "sonnet",
  },
);
await agents.ask(
  "claude",
  prompt,
  {
    model: "opus",
  },
);
// Full IDs also work if Claude's configOptions returns them
```

To see exactly which model knobs Claude currently advertises for a session, read
`session.configOptions`:

```ts
import { createSession } from "@pivanov/agents-wire";

const session = await createSession("claude");
const opts = session.configOptions ?? [];
const modelOpt = opts.find(
  (o) => o.configId === "model" && o.type === "select",
);

if (modelOpt && modelOpt.type === "select") {
  console.log(modelOpt.options); // the exact values Claude accepts
}
```

`options.effort` is sent via ACP `setSessionConfigOption({ configId: "reasoning_effort" })`.
Claude itself uses token-budget thinking rather than a discrete effort enum, so the call
is likely silently ignored. To set Claude's thinking budget directly, use the lower-level
`modelPreference: { configId: "thinking_budget", value: ... }` (whatever configId Claude
advertises in `session.configOptions`).

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ✅ |
| `askJson` | ✅ |
| MCP stdio | ✅ |
| MCP http/sse | ✅ |
| Session listing (`listSessions`) | ✅ |
| Tool call interception | ✅ |
| Thinking/extended reasoning | ✅ (model-dependent) |

## Cost Tracking

Claude reports per-turn `costUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheCreationTokens`. Full cost tracking and `maxCostUsd` budget enforcement work.

## Auth Failure Detection

If `claude /login` hasn't been run or the token has expired, the SDK catches the authentication-failure pattern in stderr and throws `AgentUnauthenticatedError` instead of a generic error.

## Gotchas

- Claude Code requires a POSIX environment. Native Windows is not supported - use WSL.
- The `CLAUDE_CONFIG_DIR` env var controls where Claude reads its configuration. Override it via `options.envFilter` if you need to point it elsewhere.
- Large `systemPrompt` values benefit from prompt caching - check `cacheReadTokens` in the cost snapshot to verify cache hits.
