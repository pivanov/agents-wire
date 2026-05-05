# Cline

**Agent ID:** `cline`

Cline is a provider-agnostic coding agent (30+ providers, BYOK or cline.bot subscription). Speaks ACP natively via `cline --acp`.

## Install

```bash
npm install -g cline
cline auth
```

Run `cline auth` to authenticate via cline.bot OAuth, or configure a provider key via
`cline config` for bring-your-own-key usage.

The `cline` package must be installed as a **peer** - it is not bundled with `agents-wire`.

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "cline",
  "Review src/auth.ts for security issues",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Cline is provider-agnostic. The model list depends entirely on which provider you have
configured (30+ supported). There is no `cline models` CLI subcommand, so the static
catalog shows a "Default" placeholder pre-init.

After creating a session, read `session.configOptions` to discover which models the
running Cline instance exposes:

```ts
import { createSession } from "@pivanov/agents-wire";

const session = await createSession("cline");
const opts = session.configOptions ?? [];
const modelOpt = opts.find((o) => o.configId === "model" && o.type === "select");

if (modelOpt && modelOpt.type === "select") {
  console.log(modelOpt.options); // provider-specific model list
}
```

`options.model` and `options.effort` are sent via ACP `setSessionConfigOption` (best-effort).
Whether Cline honors them depends on the configured provider.

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

Cost reporting depends on the configured provider. Token-priced providers (Anthropic,
OpenAI, etc.) report per-turn `costUsd`. Subscription providers do not. Check
`result.cost` and `session.cost.snapshot` to see what is available.

## Auth Failure Detection

If `cline auth` has not been run or the provider key is invalid, the SDK catches the
authentication-failure pattern in stderr and throws `AgentUnauthenticatedError`.

## Gotchas

- Cline requires configuration before first use - run `cline auth` or `cline config` to
  set a provider.
- Model availability and effort support vary by provider. Use `session.configOptions` to
  discover what the running instance actually accepts.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
