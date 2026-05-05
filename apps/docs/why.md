# Why agents-wire

`agents-wire` answers one question: why not just spawn the agent CLI yourself?

You can. But "production-grade" means handling process lifecycle, parsing undocumented wire formats, implementing retry logic, tracking cost, and writing tool approval plumbing - multiplied by 12 agents, each with a different CLI and output format. `agents-wire` does all of that behind one TypeScript API.

## The Problem

Driving Claude Code directly looks like this:

1. Spawn the CLI process
2. Parse its NDJSON output - an undocumented format that drifts between releases
3. Handle tool-approval prompts, stderr, timeouts, and process cleanup manually
4. Track cost, implement retry logic, and write your own session management

Multiply by 12 agents. Each with different CLIs, different output formats, different auth flows.

## The Solution

`agents-wire` wraps every supported agent behind the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) and exposes a single TypeScript API:

```ts
import { agents } from "@pivanov/agents-wire";

// Same API - different agent
const r1 = await agents.ask(
  "claude",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
  },
);
const r2 = await agents.ask(
  "gemini",
  "Refactor src/auth.ts",
  {
    permission: "auto-allow",
  },
);
```

## What you get

- **Twelve agents, one API** - Claude, Codex, Cursor, Copilot, Gemini, OpenCode, Droid, Pi, Cline, Kilo, Qwen, Auggie
- **ask / stream / session** - one-shot, streaming async-iterable, multi-turn with shared subprocess
- **askJson with Standard Schema** - Zod / Valibot / ArkType, validated post-hoc
- **Cost tracker and budgets** - per-agent breakdown, runtime pricing, auto-abort on overspend
- **Tool middleware** - allowed / blocked / onToolUse pipeline through ACP permission requests
- **Orchestration** - failover / race / cascade / pool for multi-agent workflows
- **Vercel AI SDK v3 provider** - `agentModel("claude")` drops into streamText / generateText
- **Typed errors** - WireError subclasses with code field, plus BudgetExceededError, JsonValidationError, AbortError, CapabilityNotSupportedError, and more
- **Testing harness** - `@pivanov/agents-wire/testing` includes mock sessions, in-process host harness, and transcript replay fixtures

## Use Cases

### Multi-Agent Orchestration

```ts
import { agents } from "@pivanov/agents-wire";

// Try claude first; fall back to gemini or codex on transient failure
const result = await agents.failover(
  "Classify this ticket",
  ["claude", "gemini", "codex"],
);
console.log(result.winner, result.text);
```

### Tool Approval Workflows

```ts
const result = await agents.ask(
  "claude",
  "Deploy the new version",
  {
    toolHandler: {
      onToolUse: async (event) => {
        await slackNotify(`Agent wants to run: ${event.tool}`);
        const approved = await waitForApproval(event.toolCallId);
        return approved
          ? "allow"
          : { decision: "deny", reason: "operator denied" };
      },
    },
  },
);
```

### Structured Classification

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const { data } = await agents.askJson(
  "gemini",
  userMessage,
  z.object({
    intent: z.enum(["question", "command", "feedback"]),
  }),
  {
    permission: "auto-allow",
  },
);
```

### Cost Tracking and Budgets

```ts
const result = await agents.ask(
  "claude",
  "Refactor the auth module",
  {
    maxCostUsd: 0.50,
    permission: "auto-allow",
    onCostUpdate: (cost) => {
      console.log(`$${cost.totalUsd.toFixed(4)} spent so far`);
    },
  },
);
```

### Testing Without Real Agents

```ts
import { createMockAgent } from "@pivanov/agents-wire/testing";

const mock = createMockAgent({
  agent: "claude",
  turns: [{ text: "ok" }, { text: "porcupine" }],
});

const turn1 = await mock.ask("remember 'porcupine'"); // "ok"
const turn2 = await mock.ask("what was it?");         // "porcupine"
```

## Why not just call the CLI directly?

`agents-wire` makes it production-grade:

- **Process lifecycle** - spawn, timeout, inactivity watchdog, kill on abort, cleanup on error
- **Auto-respawn** - transient failures (`ECONNRESET`, `AgentConnectionClosedError`) retry with backoff; cost survives via `cost.fork()`
- **Tool dispatch** - ACP permission requests routed through your handler; allow / deny / mock results
- **Capability probing** - checks agent capabilities before sending unsupported requests instead of failing at runtime
- **Typed errors** - WireError subclasses with `code`, `instanceof` checks, `_tag` for serialization-safe switching
- **Costs** - per-agent pricing table, real-time updates, projection helpers; subscription agents (Cursor, Copilot, Pi) report turn counts instead of fabricated dollars
