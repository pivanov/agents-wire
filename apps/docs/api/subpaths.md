# Subpath Exports

The package exposes six entry points. The main entry re-exports the full public API; the subpaths give narrower surfaces for tooling, lazy-loaded modules, and test code that should not ship in production builds.

| Subpath | Purpose |
|---------|---------|
| `@pivanov/agents-wire` | Main API: `agents`, `createClient`, `createSession`, errors, types, cost tracking, orchestration. Use this for app code. |
| `@pivanov/agents-wire/errors` | Error classes only - `WireError` + all subclasses + `KNOWN_ERROR_CODES`. Useful for catch handlers in parent apps that don't want to pull the full client. |
| `@pivanov/agents-wire/ai-sdk` | Vercel AI SDK v3 provider - `agentModel`, `createAgentProvider` (whose returned provider exposes `fromAdapter`), `createAgentModelSession`. |
| `@pivanov/agents-wire/testing` | Mock agent + `connectMockHost` harness + transcript record/replay. See [Testing](/api/testing). |
| `@pivanov/agents-wire/catalog` | Individual agent definitions and the registry - `claude`, `codex`, `cursor`, `copilot`, `gemini`, `opencode`, `droid`, `pi`, `cline`, `kilo`, `qwen`, `auggie`, plus `definitionFor`, `listDefinitions`, `registerDefinition`, `unregisterDefinition`. |
| `@pivanov/agents-wire/orchestrate` | `failover`, `race`, `cascade`, `createAgentPool` and their types. See [Orchestration](/guides/orchestration). |
| `@pivanov/agents-wire/package.json` | Direct manifest access (version, repository metadata) for tooling. |

## Why Subpaths?

1. **API hygiene.** The `exports` map is a whitelist. Code reaching into deep paths like `dist/runtime/host.js` is rejected by Node's resolver, so internal refactors stay safe.
2. **Bundle isolation.** Production code that imports only the main entry never includes `dist/testing/` - the mock harness stays out of production bundles even with conservative tree-shaking.
3. **Peer-dep safety.** The `/ai-sdk` subpath only imports from `ai` and `@ai-sdk/provider`. If you don't use the AI SDK provider, those modules are never loaded.

## Examples

```ts
// App code: full API.
import { agents } from "@pivanov/agents-wire";

// Catch handler in a worker that just needs error types.
import { WireError, isKnownError } from "@pivanov/agents-wire/errors";

// Vercel AI SDK integration.
import { agentModel, createAgentProvider } from "@pivanov/agents-wire/ai-sdk";

// Test file: in-process mock, no real agent spawn.
import { createMockAgent, connectMockHost } from "@pivanov/agents-wire/testing";

// Custom agent catalog extension.
import { registerDefinition, definitionFor } from "@pivanov/agents-wire/catalog";

// Orchestration primitives only.
import {
  failover,
  race,
  cascade,
  createAgentPool,
} from "@pivanov/agents-wire/orchestrate";
```
