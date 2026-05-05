# Cost Tracking

Monitor and limit API spending per request, session, or across a pool of agents.

## Budget Limits

Set `maxCostUsd` to automatically abort when spending exceeds the limit:

```ts
const result = await agents.ask(
  "claude",
  "Analyze this monorepo",
  {
    permission: "auto-allow",
    maxCostUsd: 0.50,
  },
);
```

If the budget is exceeded, a `BudgetExceededError` is thrown and the process is killed.

::: tip Test mode
`maxCostUsd: 0` is valid - "disallow any spend". The first turn that reports any cost will throw `BudgetExceededError`. Useful for integration tests that should never hit the API.
:::

::: warning Subscription agents
`maxCostUsd` works for agents that report per-turn `costUsd` (Claude, Codex, Gemini, OpenCode, Droid). It does not apply to subscription agents (Cursor, Copilot, Pi, Auggie), because they do not report per-turn `costUsd`. For subscription agents, monitor usage with `turnCount`.
:::

## Cost Callbacks

Track spending in real time with `onCostUpdate`:

```ts
const result = await agents.ask(
  "claude",
  "Complex task",
  {
    permission: "auto-allow",
    onCostUpdate: (cost) => {
      console.log(`$${cost.totalUsd.toFixed(4)} spent`);
      console.log(`${cost.tokens?.input} input, ${cost.tokens?.output} output tokens`);
    },
  },
);
```

## `ICostSnapshot`

```ts
type ICostSnapshot = {
  totalUsd: number;
  byAgent: Record<string, { totalUsd: number; turnCount: number }>;
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
  turnCount: number;
};
```

`byAgent` gives a per-agent breakdown, useful in orchestration scenarios where multiple agents contribute to one workflow.

## Session Cost Tracking

Cost accumulates across all turns in a session. Access it via `session.cost`:

```ts
await using session = await agents.session(
  "claude",
  {
    permission: "auto-allow",
    maxCostUsd: 1.00,
  },
);

const r1 = await session.ask("First question");
const r2 = await session.ask("Second question");

console.log(session.cost.snapshot.totalUsd);
console.log(session.cost.turnCount);
console.log(session.cost.averagePerTurn);
```

Cost survives process respawns via `cost.fork()` - if the process crashes and auto-respawns, the running total stays monotonic.

## Budget Projection

Forecast future spend based on average turn cost:

```ts
const session = await agents.session(
  "claude",
  {
    permission: "auto-allow",
    maxCostUsd: 5.00,
  },
);

// After several turns...
const projection = session.cost.project(10);  // 10 more turns
console.log(`projected: $${projection.projectedUsd.toFixed(4)}`);
```

`project()` uses `averagePerTurn * remainingTurns` - a simple linear projection. The SDK provides the primitives; you own the math.

| Property | Type | Description |
|----------|------|-------------|
| `turnCount` | `number` | Number of turns processed so far |
| `averagePerTurn` | `number` | `totalUsd / turnCount` (0 if no turns) |
| `project(n)` | `(n: number) => { projectedUsd: number }` | Current spend plus projected spend for `n` more turns |

## `cost.fork()`

Create a child cost tracker that starts from the parent's current totals. Used internally by auto-respawn to keep costs monotonic across crashes.

```ts
const parent = createCostTracker({ maxCostUsd: 5.00 });
// ... after some turns ...
const child = parent.fork();
// child.snapshot.totalUsd === parent.snapshot.totalUsd (starting point)
// child continues accumulating from there
```

## Pool Cost Tracking

Cost across an entire agent pool is tracked in the shared `pool.cost`:

```ts
await using pool = await agents.pool({
  agents: ["claude", "codex"],
  capacity: 4,
  options: { permission: "auto-allow" },
});

await Promise.all(prompts.map((p) => pool.ask(p)));

console.log("total pool cost:", pool.cost.snapshot.totalUsd);
console.log("by agent:", pool.cost.snapshot.byAgent);
// { claude: { totalUsd: 0.12, turnCount: 5 }, codex: { totalUsd: 0.08, turnCount: 3 } }
```

## Handling Budget Errors

```ts
import { agents, BudgetExceededError } from "@pivanov/agents-wire";

try {
  await agents.ask(
    "claude",
    "...",
    {
      maxCostUsd: 0.10,
      permission: "auto-allow",
    },
  );
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log(`Spent: $${error.spent.toFixed(4)}`);
    console.log(`Budget: $${error.budget.toFixed(4)}`);
  }
}
```

## Advanced: `createCostTracker()`

For custom cost tracking logic:

```ts
import { createCostTracker } from "@pivanov/agents-wire";

const tracker = createCostTracker({
  maxCostUsd: 1.00,
  onCostUpdate: (snap) => console.log(snap),
});

tracker.update({ totalUsd: 0.05, turnCount: 1 });
tracker.checkBudget();  // throws BudgetExceededError if over limit
console.log(tracker.snapshot());
console.log(tracker.turnCount, tracker.averagePerTurn);

const child = tracker.fork();  // child starts from current totals
```
