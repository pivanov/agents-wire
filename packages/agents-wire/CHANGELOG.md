# @pivanov/agents-wire

## 0.0.5

Pre-publish hardening pass. No public-API removals; a few new opt-in fields
on existing interfaces. Existing callers should see only fixes.

### Fixes

- **host.prompt() rejects when host is closed** — was silently building a
  stream against a dead connection.
- **session.close() ordering** fixed to avoid deadlock against an in-flight
  stream it owns. host.close() runs first (force-fails active streams);
  inFlight settles after.
- **cancelStream backstop** — when `inactivityTimeoutMs <= 0`, a dedicated
  `CANCEL_DEADLINE_MS` (30 s) timer force-fails the stream so a non-compliant
  agent that ignores `acp.cancel` can't hang the consumer.
- **Pre-aborted prompt() / doGenerate()** clear the inactivity timer they
  scheduled and short-circuit before spawning, respectively.
- **stderr-fatal classification** enabled BEFORE `acp.initialize` so auth /
  usage-limit errors during handshake surface as the right WireError instead
  of generic `init-failed` / `init-timeout`.
- **`connection.closed` resolves on `error`** as well as `exit`, so
  `dispose()` can no longer hang on a post-spawn child error.
- **Sessions registered locally BEFORE `setSessionConfigOption`** so a hung
  pref call can't leak the agent-side session.
- **askJson always concatenates `DEFAULT_JSON_SYSTEM_PROMPT`** — caller's
  `systemPrompt` no longer replaces the JSON-formatting guidance.
- **`mcpServers` concat-merge by name** in `createClient.with()` and in the
  AI SDK provider's `mergeSettings`. Previously `with({ mcpServers })`
  replaced the default list.
- **`IAgentStream.sessionId` is a live getter** — follows respawn instead of
  pinning a stale id at construction.
- **Pricing key suffix-stripping** — `claude-haiku-4-5-20251014` now resolves
  through `claude-haiku-4-5`. Bounded to digit-only suffixes so we don't
  fall back into an unrelated tier.
- **Budget threshold unified to `>=`** across `record()`, `enforceBudget()`,
  and the `session.ts` pre-check.
- **`tracker.reset()` clears** the pricing-warning dedupe set.
- **No more double-fire of `onCostUpdate`** — the tracker's `onUpdate` is
  the single firing point.
- **AI SDK `LanguageModelV3Usage`** carries `cacheRead` / `cacheWrite`
  (and `noCache = tokensIn − cacheRead`) instead of always-undefined.
- **Non-text user/assistant prompt parts** emit a `SharedV3Warning` instead
  of being silently dropped.
- **Function permission policies**: `respond()` / `cancel()` on the
  `IPendingPermission` now throw with a helpful message instead of silently
  no-op'ing. Function policies decide via return value; the streaming-policy
  path is the one that uses callbacks.
- **`rewrite-input` tool decision** emits a one-shot warning explaining ACP
  can't enforce input rewrites; original input still flows.
- **Catalog-mandated env wins over caller env** in `spawn.ts` —
  `AUGMENT_DISABLE_AUTO_UPDATE` and similar flags can no longer be silently
  nuked by user-supplied `env`.
- **`probe.ts` + `list-models.ts` SIGKILL escalation** only on timeout /
  truncation paths; `.unref()`-ed timer can't pin the event loop.
- **`list-models.ts`** captures stderr (was `ignore`) and surfaces spawn /
  timeout / non-zero-exit failures via `onWarning` instead of returning an
  empty list silently.
- **`resolve-package.ts`** invalidates `cachedGlobalRoot` on lookup failure,
  so `npm i -g` after a previous resolve succeeds without restart.
- **`which-bin.ts`** collapsed `existsSync + statSync` to a single
  `statSync` (closes symlink-swap TOCTOU).
- **`async-queue`** drains buffered items before reporting `end` / `error`
  so trailing items aren't lost on overflow / `fail()` / `end()`.
- **`stripFences`** enforces a 5 MiB cap before regex evaluation, throwing
  a `JsonValidationError` instead of running pathological backtracking on
  a multi-megabyte JSON.
- **`extract-rpc-error`** dropped the `-32000 → auth-required` heuristic;
  AUTH_PATTERNS handles real auth messages.
- **`redactSecrets`** bounded to 40–80-char hex with auth-context fallback
  (`auth` / `unauthorized` / `forbidden` / `invalid token` / `expired`).
  Bare git SHAs in stderr tails are no longer over-redacted; auth-context
  hex still is.
- **Session "is closed" throws** use `WireError("connection-closed", ...)`
  so callers can pattern-match on `.code` instead of stringly-typed message.
- **Mock host (`testing/mock-host.ts`)** — `exitResolve` is idempotent;
  `dispose()` and `triggerExit()` no longer race away each other's
  exit-code accuracy in respawn-watchdog tests.
- **Mock session (`testing/mock.ts`)** — `cancel()` actually cancels every
  active stream (was a top-level no-op). `delayMs` mid-cancel honors the
  cancel synchronously instead of waiting out the full timeout.

### New

- **`IAgentDefinition.nativeSystemPrompt?: boolean`** — replaces the
  hardcoded `agentId === "claude"` check for native system-prompt routing.
  Set on `claude` catalog entry.
- **`ICostTrackerOptions.onWarning?: (msg: string) => void`** — surfaces
  one-shot warnings when budget enforcement is silently a no-op (unknown
  pricing for the model OR the usage event carried no costUsd and no
  tokens).
- **`standardSchemaToJsonSchema(schema, onWarning?)`** — emits a warning
  when Zod has no `toJSONSchema` (Zod v3) or the vendor is unknown, so the
  caller knows schema guidance was dropped.
- **`AGENTS_WIRE_DEBUG=1`** env var on the CLI emits stack traces for
  failed commands.

### Build

- **`PACKAGE_VERSION`** injected at build time from `package.json#version`
  via tsup `define`. No more manual constant-vs-package.json drift.

### Internal

- Round 7–11 audit-driven fixes; see `docs/audit/round-9-deep-review.md`
  for the deep-review pass that uncovered the highest-impact item (token-
  based pricing was dead-code on the ACP path because `usage_update` does
  not carry tokensIn / tokensOut).

## 0.0.4

Initial release.

One TypeScript SDK for every local coding agent. Drives Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Factory Droid, Pi, Cline, Kilo, Qwen Code, and Augment Code (Auggie) over the Agent Client Protocol.

### Core

- `agents.ask` / `agents.stream` / `agents.session` for one-shot, streaming, and multi-turn flows
- `agents.askJson` with Standard Schema (Zod 4 / Valibot / ArkType) auto-derivation to JSON Schema
- Cost tracker with per-agent breakdown, runtime pricing table, and `BudgetExceededError` enforcement
- Tool middleware (`allowed` / `blocked` / `onToolUse` decisions) plumbed through ACP permission requests
- Permission policies (`auto-allow`, `auto-allow-once`, `auto-reject`, `stream`, custom function)
- Typed `WireError` with `code` field and specific subclasses (`BudgetExceededError`, `JsonValidationError`, `AbortError`, `CapabilityNotSupportedError`, `AgentInactivityError`, `AgentInitTimeoutError`, `AgentConnectionClosedError`, `AgentNotInstalledError`)

### Orchestration (`@pivanov/agents-wire/orchestrate`)

- `failover` — try candidates in order, skip transient errors
- `race` — first to finish wins, losers cancelled
- `cascade` — escalation chain with per-stage `accept` predicate
- `pool` — warm subprocess pool with capacity limits and shared cost tracker

### Subpaths

- `@pivanov/agents-wire/ai-sdk` — Vercel AI SDK provider (`LanguageModelV3`, `ai@^6`) plus `createAgentModelSession`
- `@pivanov/agents-wire/testing` — `createMockAgent` + transcript record/replay
- `@pivanov/agents-wire/catalog` — individual agent definitions and registry
- `@pivanov/agents-wire/orchestrate` — orchestration primitives
- `@pivanov/agents-wire/errors` — typed errors

### CLI

- `agents-wire ask | ask-json | stream | detect | agents`
