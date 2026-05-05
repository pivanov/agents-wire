# Examples

Practical multi-agent examples covering the main SDK features.

## Setup

```bash
git clone https://github.com/pivanov/agents-wire
cd agents-wire
bun install
```

Requires at least one agent CLI installed and authenticated. To check:

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

## One-Shot Ask

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "claude",
  "Summarize README.md in 3 bullets",
  {
    cwd: process.cwd(),
    permission: "auto-allow",
    maxCostUsd: 0.25,
  },
);

console.log(result.text);
console.log(result.cost?.totalUsd);
```

## Streaming with Event Timeline

```ts
import { agents } from "@pivanov/agents-wire";

const stream = agents.stream(
  "claude",
  "Refactor src/auth.ts to use the new session API",
);
const events: string[] = [];

for await (const event of stream) {
  events.push(event.type);
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "tool-call") console.log(`\n[tool] ${event.tool}`);
}

const result = await stream.result();
console.log("\ntimeline:", events.join(" → "));
console.log("cost:", result.cost?.totalUsd);
```

## Multi-Turn Session

```ts
import { agents } from "@pivanov/agents-wire";

await using session = await agents.session(
  "codex",
  {
    permission: "auto-allow",
  },
);

const r1 = await session.ask("List all TODOs in the repo");
console.log("found:", r1.text);

const r2 = await session.ask("Now fix the highest-priority one");
console.log("fixed:", r2.text);

console.log("session cost:", session.cost.snapshot.totalUsd);
console.log("turns:", session.cost.turnCount);
```

## Failover Across Agents

```ts
import { agents } from "@pivanov/agents-wire";

// Try claude first, fall back to gemini or codex
const result = await agents.failover(
  "Classify this support ticket as: bug / feature / question",
  ["claude", "gemini", "codex"],
  {
    permission: "auto-allow",
    maxCostUsd: 0.10,
  },
);

console.log("winner:", result.winner);
console.log("response:", result.text);
console.log("attempts:", result.attempts.length);
```

## Race to First Finish

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.race(
  "Explain closures in 2 sentences",
  ["claude", "gemini"],
  {
    permission: "auto-allow",
  },
);

console.log(result.winner, "won");
console.log(result.text);
```

## Structured JSON with Zod

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const Issue = z.object({
  title: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  file: z.string(),
});

const { data } = await agents.askJson(
  "claude",
  "Read src/auth.ts and report the most critical issue",
  Issue,
  {
    permission: "auto-allow",
  },
);

console.log(data.title, data.severity, data.file);
```

## Cost Budget with Callback

```ts
import { agents, BudgetExceededError } from "@pivanov/agents-wire";

try {
  await agents.ask(
    "claude",
    "Refactor the entire codebase",
    {
      permission: "auto-allow",
      maxCostUsd: 0.50,
      onCostUpdate: (cost) => {
        console.log(`$${cost.totalUsd.toFixed(4)} / $0.50`);
      },
    },
  );
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log(`Stopped at $${error.spent.toFixed(4)} - over budget`);
  }
}
```

## Cascade Escalation

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.cascade("Triage this GitHub issue", [
  {
    agent: "claude",
    options: { model: "haiku", permission: "auto-allow" },
    accept: (r) => r.text.length > 50 && !r.text.includes("unclear"),
  },
  {
    agent: "claude",
    options: { model: "sonnet", permission: "auto-allow" },
  },
]);

console.log("won at stage:", result.winningStageIndex);
console.log(result.text);
```

## Warm Pool for Concurrent Workloads

```ts
import { agents } from "@pivanov/agents-wire";

const prompts = Array.from(
  { length: 20 },
  (_, i) => `Classify ticket ${i}: "${tickets[i]}"`,
);

await using pool = await agents.pool({
  agents: ["claude"],
  capacity: 5,
  options: { permission: "auto-allow", maxCostUsd: 2.00 },
});

const results = await Promise.all(prompts.map((p) => pool.ask(p)));

console.log("classified:", results.length);
console.log("total cost:", pool.cost.snapshot.totalUsd);
console.log("avg per turn:", pool.cost.averagePerTurn);
```

## Vercel AI SDK Integration

```ts
import { streamText } from "ai";
import { agentModel } from "@pivanov/agents-wire/ai-sdk";

const { textStream } = streamText({
  model: agentModel("claude", { permission: "auto-allow" }),
  prompt: "Explain the architecture of this repo",
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## AbortSignal Cancellation

```ts
import { agents, AbortError } from "@pivanov/agents-wire";

const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);  // cancel after 5s

try {
  const result = await agents.ask(
    "claude",
    "Long running analysis...",
    {
      permission: "auto-allow",
      signal: controller.signal,
    },
  );
} catch (error) {
  if (error instanceof AbortError) {
    console.log("Cancelled by timeout");
  }
}
```
