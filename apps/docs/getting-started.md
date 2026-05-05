# Getting Started

Install. Pick an agent. Send a prompt.

## Installation

::: code-group
```bash [bun]
bun add @pivanov/agents-wire
```
```bash [npm]
npm install @pivanov/agents-wire
```
```bash [yarn]
yarn add @pivanov/agents-wire
```
```bash [pnpm]
pnpm add @pivanov/agents-wire
```
:::

**Requirements:** Bun >= 1.0 or Node.js >= 22, plus the agent CLI(s) you want to drive installed and authenticated. Detect what is ready on your machine:

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

(Yarn classic 1.x has no `dlx`; use `npx` instead.)

## Your First Request

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "claude",
  "What is 2 + 2?",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);          // "4"
console.log(result.cost?.totalUsd); // e.g. 0.0012
```

`agents.ask()` spawns the agent process, sends the prompt via ACP, collects all events, and returns a typed `IAskResult`.

## Choose Your Agent

Pass any supported agent ID as the first argument:

```ts
await agents.ask("claude",    prompt); // Claude Code
await agents.ask("codex",     prompt); // OpenAI Codex CLI
await agents.ask("cursor",    prompt); // Cursor
await agents.ask("copilot",   prompt); // GitHub Copilot
await agents.ask("gemini",    prompt); // Gemini CLI
await agents.ask("opencode",  prompt); // OpenCode
await agents.ask("droid",     prompt); // Factory Droid
await agents.ask("pi",        prompt); // Pi
await agents.ask("cline",     prompt); // Cline
await agents.ask("kilo",      prompt); // Kilo
await agents.ask("qwen",      prompt); // Qwen Code
```

See [Agents](/agents/index) for install instructions for each.

## Streaming Events

For real-time output, use `agents.stream()`:

```ts
import { agents } from "@pivanov/agents-wire";

const stream = agents.stream("claude", "Explain closures in JS");

for await (const event of stream) {
  if (event.type === "text-delta") {
    process.stdout.write(event.text);
  }
  if (event.type === "tool-call") {
    console.log("[tool]", event.tool, event.input);
  }
}

const final = await stream.result();
console.log("\nfinished:", final.stopReason);
```

## Structured JSON Output

Use `agents.askJson()` to get typed, validated JSON:

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const schema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
});

const { data } = await agents.askJson(
  "claude",
  "Rate this code on 0-100 and summarize it",
  schema,
);

console.log(data.summary);
console.log(data.score);
```

`askJson()` accepts any [Standard Schema](https://github.com/standard-schema/standard-schema) object (Zod, Valibot, ArkType) or a raw JSON Schema string. Returns `{ data: T, raw: IAskResult }`. Throws `JsonValidationError` if parsing or validation fails.

## Multi-Turn Sessions

Keep a process alive across multiple questions:

```ts
import { agents } from "@pivanov/agents-wire";

await using session = await agents.session(
  "codex",
  {
    permission: "auto-allow",
  },
);

const r1 = await session.ask("List all TODOs in the repo");
const r2 = await session.ask("Now fix the highest-priority one");

console.log(r2.text);
console.log("session cost:", session.cost.snapshot.totalUsd);
```

`await using` calls `session[Symbol.asyncDispose]()` automatically when the block exits. You can also call `session.close()` manually.

## Multi-Agent Example

```ts
import { agents } from "@pivanov/agents-wire";

// failover: try claude first, fall back to gemini
const result = await agents.failover(
  "Summarize this PR",
  ["claude", "gemini"],
);
console.log(result.winner, result.text);

// race: first to finish wins
const fast = await agents.race(
  "Classify this ticket",
  ["claude", "codex"],
);
console.log(fast.winner, "finished first");
```

See [Orchestration](/guides/orchestration) for all four primitives.
