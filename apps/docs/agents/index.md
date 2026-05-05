# Agents

`agents-wire` supports twelve local coding agents, all speaking [ACP (Agent Client Protocol)](https://agentclientprotocol.com). The API surface is identical across all agents - the differences are in how you install and authenticate each one.

## Overview

| Agent | ID | Protocol mode | Native session listing | MCP http/sse | MCP stdio |
|-------|----|--------------|----------------------|--------------|-----------|
| [Claude Code](/agents/claude) | `claude` | bridge | ✅ | ✅ | ✅ |
| [Codex CLI](/agents/codex) | `codex` | bridge | ✅ | ❌ | ✅ |
| [Cursor](/agents/cursor) | `cursor` | native | ✅ | ✅ | ✅ |
| [GitHub Copilot](/agents/copilot) | `copilot` | bridge | ❌ | ❌ | ✅ |
| [Gemini CLI](/agents/gemini) | `gemini` | bridge | ❌ | ✅ | ✅ |
| [OpenCode](/agents/opencode) | `opencode` | native | ✅ | ✅ | ✅ |
| [Factory Droid](/agents/droid) | `droid` | native | ✅ | ❌ | ✅ |
| [Pi](/agents/pi) | `pi` | native (non-ACP) | ❌ | ❌ | ✅ |
| [Cline](/agents/cline) | `cline` | native | ❌ | ❌ | ✅ |
| [Kilo](/agents/kilo) | `kilo` | native | ❌ | ❌ | ✅ |
| [Qwen Code](/agents/qwen) | `qwen` | native | ❌ | ❌ | ✅ |
| [Augment Code](/agents/auggie) | `auggie` | native | ❌ | ❌ | ✅ |

**Protocol mode:**
- `bridge` - the SDK includes or expects a peer-installed ACP bridge package that wraps the underlying CLI.
- `native` - the agent speaks ACP directly.

**MCP http/sse:** whether the agent accepts HTTP or SSE MCP server configurations (checked via `CapabilityNotSupportedError`).

## Model Selection by Agent

`options.model` and `options.effort` behave differently across agents. The table below
documents what actually happens today so you can set expectations correctly.

| Agent | What `options.model` does | What `options.effort` does | Model source | How to verify |
|-------|--------------------------|---------------------------|--------------|---------------|
| **claude** | sent via ACP `setSessionConfigOption` (best-effort) | sent via ACP `setSessionConfigOption({ configId: "reasoning_effort" })` (Claude uses token-budget thinking; likely ignored) | session-config | check `session.configOptions` for the exact knobs Claude advertises |
| **codex** | becomes `-c model="X"` CLI arg (works) | becomes `-c model_reasoning_effort="X"` (works; kind: `enum`, values: `low` / `medium` / `high`) | session-config | verified via `codex-acp --help` |
| **cursor** | sent via ACP modelPreference (silently ignored by current `cursor-agent acp`) | baked into model id (kind: `variant`, e.g. `-low`, `-high`, `-xhigh` suffix) | live-list | use `agent --list-models` for the live list; configure default via the Cursor app |
| **copilot** | sent via ACP modelPreference (best-effort) | sent via ACP `setSessionConfigOption` (best-effort) | session-config | -- |
| **gemini** | sent via ACP modelPreference (best-effort; `gemini --acp` does not take CLI flags) | sent via ACP `setSessionConfigOption` (best-effort) | session-config | -- |
| **opencode** | sent via ACP modelPreference (silently ignored by current `opencode acp`) | sent via ACP `setSessionConfigOption` (best-effort) | live-list | use `opencode models` for the live list |
| **droid** | not honored (auto-selects) | not honored (auto) | static | -- |
| **pi** | not honored (non-ACP; v0.73 incompatible) | not honored | static | -- |
| **cline** | sent via ACP `setSessionConfigOption` (best-effort; BYOK provider-dependent) | sent via ACP `setSessionConfigOption` (best-effort) | session-config | check `session.configOptions` after init |
| **kilo** | sent via ACP `setSessionConfigOption` (best-effort) | model-dependent (kind varies per upstream model) | live-list | use `kilo models` for the live list |
| **qwen** | sent via ACP `setSessionConfigOption` (best-effort; BYOK provider-dependent) | sent via ACP `setSessionConfigOption` (best-effort) | session-config | check `session.configOptions` after init |
| **auggie** | sent via ACP `setSessionConfigOption` (best-effort; subscription required) | sent via ACP `setSessionConfigOption` (best-effort) | live-list | use `auggie model list` (login required) |

When the agent silently ignores `model`, your call still succeeds - the agent just uses its
configured default. To know what each agent actually accepts at runtime, read
`session.configOptions` after creating a session. See [session.configOptions](/api/session#session-configoptions)
for details and a code example.

### Live model list (cursor and opencode)

For agents that expose a live model list command, `IAgentDefinition.listAvailableModels()`
wraps the call and returns `[]` on any failure (binary missing, timeout, parse fail). Use
it lazily in pickers and fall back to `def.models` (the static catalog) if it returns empty.

```ts
import { definitionFor } from "@pivanov/agents-wire/catalog";
import { createSession } from "@pivanov/agents-wire";

// Live model list (cursor / opencode only - silently falls back to static)
const def = definitionFor("cursor");
const models = (await def.listAvailableModels?.()) ?? def.models ?? [];

// Agent-declared config options on an active session
const session = await createSession("claude");
const opts = session.configOptions ?? [];
const modelOpt = opts.find(
  (o) => o.configId === "model" && o.type === "select",
);
// modelOpt.options is the exact list the agent accepts
```

## Detect What's Available

::: code-group
```bash [bun]
bunx @pivanov/agents-wire detect
```
```bash [npm]
npx @pivanov/agents-wire detect
```
```bash [pnpm]
pnpm dlx @pivanov/agents-wire detect
```
```bash [yarn]
yarn dlx @pivanov/agents-wire detect
```
:::

```ts
import { detectAvailableAgents } from "@pivanov/agents-wire";

const available = await detectAvailableAgents();
console.log(available.map((e) => e.agent));
// ["claude", "cursor", "opencode"]
```

## Install Table

| Agent | Install command | Auth |
|-------|----------------|------|
| Claude | [Claude Code setup](https://docs.claude.com/en/docs/claude-code/setup) | `claude /login` |
| Codex | OpenAI Codex CLI on PATH | Set `OPENAI_API_KEY` |
| Cursor | [Cursor Agent CLI](https://cursor.com/docs/cli/acp) | Sign in to Cursor app |
| Copilot | `npm i -g @github/copilot` | `gh auth login` |
| Gemini | `npm i -g @google/gemini-cli` | `gemini auth login` |
| OpenCode | `npm i -g opencode-ai` | Provider API keys |
| Droid | `npm i -g droid` | Set `FACTORY_API_KEY` |
| Pi | `npm i -g @mariozechner/pi-coding-agent` | Set `PI_API_KEY` |
| Cline | `npm i -g cline` | `cline auth` or provider keys |
| Kilo | `npm i -g @kilocode/cli` | `kilo auth login --provider <id>` or set `KILO_API_KEY` |
| Qwen | `npm i -g @qwen-code/qwen-code` | `qwen auth qwen-oauth` or set `BAILIAN_CODING_PLAN_API_KEY` |
| Auggie | `npm i -g @augmentcode/auggie` | `auggie login` (subscription required) |

## Pricing and Cost Tracking

Agents fall into two categories:

**Token-priced** (Claude, Codex, Gemini, OpenCode, Droid): report `costUsd` per turn.
The SDK's cost tracker accumulates these and enforces `maxCostUsd`.

**Provider-dependent** (Cline, Kilo, Qwen): cost reporting depends on the configured
provider. Token-priced providers report `costUsd`; subscription / free-tier providers do
not. Check `result.cost` after each turn to see what is available.

**Subscription-priced** (Cursor, Copilot, Pi, Auggie): do not report per-turn cost. The SDK
tracks turn counts instead. `cost.snapshot.totalUsd` stays at `0` for these agents;
`maxCostUsd` will not trigger. Use `cost.turnCount` to count usage.

## Catalog API

```ts
import {
  definitionFor,
  listDefinitions,
  registerDefinition,
} from "@pivanov/agents-wire/catalog";

// Get the definition for one agent
const def = definitionFor("claude");
console.log(def.id, def.displayName, def.capabilities);

// List all built-in agents
const all = listDefinitions();

// Register a custom agent
registerDefinition({
  id: "my-agent",
  displayName: "My Agent",
  launchSpec: { command: "my-agent", args: ["acp"] },
  capabilities: { mcpCapabilities: { supportedTransports: ["stdio"] } },
});
```
