# Multi-Agent Orchestration

`agents-wire` ships four primitives for combining agents into reliable workflows. All are available from the main entry (`agents.failover()`, etc.) and from `@pivanov/agents-wire/orchestrate`.

## `failover`

Try candidates in order; skip on transient errors, return the first success.

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.failover(
  "Classify this ticket",
  ["claude", "codex", "gemini"],
  { permission: "auto-allow" },
);

console.log(result.winner);  // "claude" (or "codex" if claude failed)
console.log(result.text);
console.log(result.attempts); // IFailoverAttempt[] - all attempts including failures
```

### `IFailoverResult`

```ts
interface IFailoverResult extends IAskResult {
  winner: string;               // agent ID that succeeded
  attempts: IFailoverAttempt[]; // all attempts, including failed ones
}

interface IFailoverAttempt {
  agent: string;
  error?: unknown;  // set on failed attempts
  skipped: boolean; // true if skipped due to transient error
}
```

`failover` only skips on transient errors (`isTransientError(error) === true`). Non-transient errors (budget exceeded, auth failure) propagate immediately - they indicate a configuration problem, not a transient blip.

## `race`

All candidates run in parallel; the first to finish wins, losers are cancelled.

```ts
const result = await agents.race(
  "Classify this ticket",
  ["claude", "gemini"],
  {
    permission: "auto-allow",
  },
);

console.log(result.winner, "finished first");
console.log("lost:", result.losers.map((l) => l.agent));
```

### `IRaceResult`

```ts
interface IRaceResult extends IAskResult {
  winner: string;      // agent ID that finished first
  losers: IRaceLoser[];
}

interface IRaceLoser {
  agent: string;
  error?: unknown;  // set if the loser threw before being cancelled
}
```

::: warning Cost note
All agents in a race consume tokens until they are cancelled. Use `race` when latency matters more than cost.
:::

## `cascade`

Escalation chain. Try cheaper/faster agents first; fall through if the result fails an `accept` predicate.

```ts
const result = await agents.cascade("Triage this issue", [
  {
    agent: "claude",
    options: { model: "haiku", permission: "auto-allow" },
    accept: (r) => r.text.length > 20,
  },
  {
    agent: "claude",
    options: { model: "sonnet", permission: "auto-allow" },
    accept: (r) => r.text.length > 50,
  },
  {
    agent: "claude",
    options: { model: "opus", permission: "auto-allow" },
    // no accept = always wins
  },
]);

console.log("won at stage", result.winningStageIndex);
console.log(result.text);
```

### `ICascadeStage`

```ts
interface ICascadeStage {
  agent: string;
  options?: IAgentOptions;
  accept?: (result: IAskResult) => boolean | Promise<boolean>;
}
```

`cascade` is the right primitive for cost optimization: run haiku first, escalate to sonnet only when the output is too short or low-confidence. The `accept` predicate can be arbitrarily complex - call a classifier, check a score, inspect tool calls.

### `ICascadeResult`

```ts
interface ICascadeResult extends IAskResult {
  winningStageIndex: number;
  rejections: ICascadeRejection[];  // stages that ran and were rejected
}
```

## `pool`

Warm subprocess pool with capacity limit. Concurrent prompts share the pool.

```ts
import { agents } from "@pivanov/agents-wire";

await using pool = await agents.pool({
  agents: ["claude"],
  capacity: 4,
  options: { permission: "auto-allow" },
});

// Run 10 prompts through a pool of 4 claude sessions
const replies = await Promise.all(
  prompts.map((p) => pool.ask(p)),
);

console.log("total cost:", pool.cost.snapshot.totalUsd);
```

`await using` disposes the pool when the block exits, killing all warm sessions.

### `IAgentPool`

```ts
interface IAgentPool {
  ask(prompt: string, options?: IAskOptions): Promise<IAskResult>;
  askJson<T>(
    prompt: string,
    schema: TSchemaInput<T>,
    options?: IAskOptions,
  ): Promise<IJsonResult<T>>;
  stream(prompt: string, options?: IAskOptions): IAgentStream;
  cost: ICostTracker;
  [Symbol.asyncDispose](): Promise<void>;
}
```

### `IPoolOptions`

```ts
interface IPoolOptions {
  agents: string[];      // agent IDs to include in the pool
  capacity: number;      // max concurrent sessions
  options?: IAgentOptions; // shared options for all pool sessions
}
```

The pool automatically respawns sessions if they fail, using the same backoff logic as `session.ask()`. Cost is tracked across the entire pool via a shared `ICostTracker`.

## Importing from the Subpath

```ts
import {
  failover,
  race,
  cascade,
  createAgentPool,
} from "@pivanov/agents-wire/orchestrate";
```

All four primitives are also available directly on the `agents` namespace without an extra import.

## Full Example

See [`apps/examples/multi-agent-classifier/`](https://github.com/pivanov/agents-wire/tree/main/apps/examples/multi-agent-classifier) for a complete multi-agent classification pipeline using cascade and failover.
