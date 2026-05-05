# agents-wire

[![npm](https://img.shields.io/npm/v/@pivanov/agents-wire)](https://www.npmjs.com/package/@pivanov/agents-wire)
[![license](https://img.shields.io/npm/l/@pivanov/agents-wire)](./LICENSE)

One TypeScript SDK for **every local coding agent**. Drives Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Factory Droid, Pi, Cline, Kilo, Qwen Code, and Augment Code (Auggie) over the [Agent Client Protocol](https://agentclientprotocol.com), with cost budgets, structured JSON, tool middleware, multi-agent orchestration, and a Vercel AI SDK provider (LanguageModelV3, `ai@^6`).

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask("claude", "Refactor src/auth.ts", {
  permission: "auto-allow",
  maxCostUsd: 0.5,
});

console.log(result.text, result.cost?.totalUsd);
```

## Why

Local coding agents are powerful but awkward to drive programmatically. Each one ships a different CLI; their output formats drift; cost tracking is bring-your-own; structured outputs are a prompt-engineering project; and combining several agents takes a lot of glue. `agents-wire` fixes all of that with one transport and a small, focused API.

## Features

- **Twelve agents, one API** - Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Factory Droid, Pi, Cline, Kilo, Qwen Code, Augment Code (Auggie)
- **`ask` / `stream` / `session`** - one-shot, streaming async-iterable, multi-turn with shared subprocess
- **`askJson` with Standard Schema** - Zod 4 / Valibot / ArkType auto-derived to JSON Schema, validated post-hoc
- **Cost tracker + budgets** - per-agent breakdown, runtime pricing table, auto-abort when over budget
- **Tool middleware** - `allowed` / `blocked` / `onToolUse` decision pipeline plumbed through ACP permission requests
- **Permission policies** - `auto-allow`, `auto-allow-once`, `auto-reject`, `stream` (HITL), or custom function
- **Orchestration** - `failover` / `race` / `cascade` / `pool` for multi-agent workflows
- **Vercel AI SDK provider** (LanguageModelV3, `ai@^6`) - `agentModel("claude")` drops into `streamText` / `generateText`
- **Typed errors** - `WireError` with `code` field plus `BudgetExceededError`, `JsonValidationError`, `AbortError`, `CapabilityNotSupportedError`
- **Fully typed** - discriminated `TAgentEvent` union, full IntelliSense, no `any`
- **Mock + transcript replay** - `@pivanov/agents-wire/testing` for deterministic tests
- **CLI** - `agents-wire ask | ask-json | stream | detect | agents`

## Install

```bash
bun add @pivanov/agents-wire
# or
npm install @pivanov/agents-wire
```

You also need the agent's CLI installed and authenticated. Run `npx @pivanov/agents-wire detect` to see which agents are available on your machine.

| Agent       | How it speaks ACP                                         | Install                                                                                  |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `claude`    | bridge (`@agentclientprotocol/claude-agent-acp`, bundled) | [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) + `claude /login`       |
| `codex`     | bridge (`@zed-industries/codex-acp`, bundled)             | OpenAI Codex CLI on PATH                                                                 |
| `cursor`    | native (`agent acp`)                                      | [Cursor Agent CLI](https://cursor.com/docs/cli/acp)                                      |
| `copilot`   | bridge (`@github/copilot --acp`, peer install)            | `npm i -g @github/copilot` + `gh auth login`                                             |
| `gemini`    | bridge (`@google/gemini-cli --acp`, peer install)         | `npm i -g @google/gemini-cli` + `gemini auth login`                                      |
| `opencode`  | native (`opencode acp`)                                   | `npm i -g opencode-ai`                                                                   |
| `droid`     | native (`droid exec --output-format acp`)                 | `npm i -g droid` + `FACTORY_API_KEY`                                                     |
| `pi`        | native (`pi acp`)                                         | `npm i -g @mariozechner/pi-coding-agent`                                                 |
| `cline`     | native (`cline --acp`)                                    | `npm i -g cline` + `cline auth` or provider keys                                         |
| `kilo`      | native (`kilo acp`)                                       | `npm i -g @kilocode/cli` + `kilo auth login --provider <id>` or `KILO_API_KEY`           |
| `qwen`      | native (`qwen --acp --experimental-skills`)               | `npm i -g @qwen-code/qwen-code` + `qwen auth qwen-oauth` or `BAILIAN_CODING_PLAN_API_KEY` |
| `auggie`    | native (`auggie --acp`)                                   | `npm i -g @augmentcode/auggie` + `auggie login` (subscription required)                  |

## Quick start

### One-shot

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask("claude", "Summarize README.md in 3 bullets", {
  cwd: process.cwd(),
  permission: "auto-allow",
  maxCostUsd: 0.25,
});

console.log(result.text);
console.log(result.usage);          // { contextSize, contextUsed, costUsd }
console.log(result.cost?.totalUsd); // SDK-side cumulative cost
```

### Streaming

```ts
import { agents } from "@pivanov/agents-wire";

const stream = agents.stream("claude", "Refactor src/auth.ts to use the new session API");

for await (const event of stream) {
  if (event.type === "text-delta") {
    process.stdout.write(event.text);
  }
  if (event.type === "tool-call") {
    console.log("\n[tool]", event.tool, event.input);
  }
}

const final = await stream.result();
console.log("\nfinished:", final.stopReason);
```

### Multi-turn session

```ts
import { agents } from "@pivanov/agents-wire";

await using session = await agents.session("codex", { permission: "auto-allow" });

await session.ask("List all TODOs in the repo");
const fix = await session.ask("Now fix the highest-priority one");
console.log(fix.text);

console.log("session cost:", session.cost.snapshot.totalUsd);
```

### Structured JSON with Standard Schema

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const Issue = z.object({
  title: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});

const { data } = await agents.askJson("claude", "Read src/auth.ts and report issues", Issue);
console.log(data.title, data.severity);
```

Works with **Zod 4**, **Valibot** (with `@valibot/to-json-schema` installed), and **ArkType**. You can also pass a raw JSON Schema string.

### Tool middleware

```ts
const result = await agents.ask("claude", "Fix the build", {
  toolHandler: {
    blocked: ["Bash"],                              // hard block
    onToolUse: async (event) => {
      if (event.tool === "Write" && String(event.input).includes("secrets")) {
        return { decision: "deny", reason: "no secrets" };
      }
      return "allow";
    },
  },
});
```

## Orchestration

Four primitives for combining agents.

### `failover`

Try candidates in order; skip on transient errors, return the first success.

```ts
const result = await agents.failover("Classify this ticket", ["claude", "codex", "gemini"]);
console.log(result.winner, result.text);
```

### `race`

All candidates in parallel; first to finish wins, losers get cancelled.

```ts
const result = await agents.race("Classify this ticket", ["claude", "gemini"]);
console.log(result.winner, "lost:", result.losers.map((l) => l.agent));
```

### `cascade`

Escalation chain. Try cheaper/faster first; fall through if the result fails an `accept` predicate.

```ts
const result = await agents.cascade("Triage this issue", [
  { agent: "claude", options: { model: "haiku" }, accept: (r) => r.text.length > 20 },
  { agent: "claude", options: { model: "sonnet" }, accept: (r) => r.text.length > 50 },
  { agent: "claude", options: { model: "opus" } },
]);
console.log("won at stage", result.winningStageIndex);
```

### `pool`

Warm subprocess pool with capacity limit. Concurrent prompts share the pool.

```ts
await using pool = await agents.pool({ agents: ["claude"], capacity: 4 });

const replies = await Promise.all(
  prompts.map((p) => pool.ask(p)),
);
console.log("total cost:", pool.cost.snapshot.totalUsd);
```

## Vercel AI SDK provider

Use any agent as a `LanguageModelV3` for `streamText` / `generateText`:

```ts
import { streamText } from "ai";
import { agentModel } from "@pivanov/agents-wire/ai-sdk";

const { textStream } = streamText({
  model: agentModel("claude", { permission: "auto-allow" }),
  prompt: "Refactor src/auth.ts",
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

For multi-turn sharing one subprocess across `streamText` calls:

```ts
import { createAgentModelSession } from "@pivanov/agents-wire/ai-sdk";

await using s = await createAgentModelSession("codex");
await streamText({ model: s.model, prompt: "list TODOs" });
await streamText({ model: s.model, prompt: "now fix the highest-priority one" });
```

## CLI

```bash
npx @pivanov/agents-wire ask claude --prompt "explain this repo"
npx @pivanov/agents-wire ask-json claude --prompt "extract metadata" --schema-file ./schema.json
npx @pivanov/agents-wire stream gemini --prompt "summarize this PR"
npx @pivanov/agents-wire detect      # list available agents on this machine
npx @pivanov/agents-wire agents      # list all built-in agents
```

## Testing

`@pivanov/agents-wire/testing` ships a mock agent and transcript record/replay so you can test consumers without spawning real processes.

```ts
import { createMockAgent, createRecorder, replayTranscript } from "@pivanov/agents-wire/testing";

const mock = createMockAgent({
  agent: "claude",
  turns: [
    { text: "ok" },
    { text: "porcupine" },
  ],
});

const turn1 = await mock.ask("remember 'porcupine'");  // → "ok"
const turn2 = await mock.ask("what was it?");          // → "porcupine"
```

## Subpath exports

| Subpath                              | What's there                                               |
| ------------------------------------ | ---------------------------------------------------------- |
| `@pivanov/agents-wire`               | the main facade and types                                  |
| `@pivanov/agents-wire/errors`        | typed `WireError` + subclasses + `KNOWN_ERROR_CODES`       |
| `@pivanov/agents-wire/ai-sdk`        | Vercel AI SDK provider                                     |
| `@pivanov/agents-wire/testing`       | mock agent + transcript replay                             |
| `@pivanov/agents-wire/catalog`       | individual agent definitions + registry                    |
| `@pivanov/agents-wire/orchestrate`   | `failover`, `race`, `cascade`, `pool`                      |

## Requirements

- Bun ≥ 1.0 or Node ≥ 22
- POSIX (macOS, Linux, WSL). Native Windows isn't supported.
- The agent CLIs you want to drive must be installed and authenticated on the host machine.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run --filter '@pivanov/agents-wire' build

# Run the smoke test against your installed Claude
bun packages/agents-wire/tests/smoke.ts
bun packages/agents-wire/tests/smoke-orchestrate.ts
```

## License

MIT - © Pavel Ivanov
