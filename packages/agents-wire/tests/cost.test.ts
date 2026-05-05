import { describe, expect, test } from "bun:test";
import { enforceBudget } from "@/budget/guard";
import { getPricing, listPricing, setPricing } from "@/budget/pricing";
import { createCostTracker } from "@/budget/tracker";
import { BudgetExceededError } from "@/errors";

describe("createCostTracker", () => {
  test("uses ACP-reported costUsd directly when present", () => {
    const tracker = createCostTracker();
    tracker.record({ tokensIn: 100, tokensOut: 50, costUsd: 0.005 }, "claude", "haiku");
    expect(tracker.snapshot.totalUsd).toBeCloseTo(0.005, 6);
    expect(tracker.snapshot.tokensIn).toBe(100);
    expect(tracker.snapshot.tokensOut).toBe(50);
    expect(tracker.snapshot.turns).toBe(1);
  });

  test("falls back to pricing table when costUsd missing", () => {
    const tracker = createCostTracker();
    tracker.record({ tokensIn: 1_000_000, tokensOut: 1_000_000 }, "claude", "haiku");
    expect(tracker.snapshot.totalUsd).toBeCloseTo(6.0, 4);
  });

  test("aggregates across agents in byAgent breakdown", () => {
    const tracker = createCostTracker();
    tracker.record({ tokensIn: 100, costUsd: 0.01 }, "claude", "haiku");
    tracker.record({ tokensIn: 200, costUsd: 0.02 }, "codex", "gpt-5");
    expect(tracker.snapshot.totalUsd).toBeCloseTo(0.03, 6);
    expect(tracker.snapshot.byAgent.claude?.totalUsd).toBeCloseTo(0.01, 6);
    expect(tracker.snapshot.byAgent.codex?.totalUsd).toBeCloseTo(0.02, 6);
  });

  test("reports remainingUsd against a budget", () => {
    const tracker = createCostTracker({ budgetUsd: 1.0 });
    tracker.record({ costUsd: 0.3 }, "claude");
    expect(tracker.remainingUsd).toBeCloseTo(0.7, 6);
  });

  test("willExceed predicts based on additional spend", () => {
    const tracker = createCostTracker({ budgetUsd: 1.0 });
    tracker.record({ costUsd: 0.6 }, "claude");
    expect(tracker.willExceed(0.3)).toBe(false);
    expect(tracker.willExceed(0.5)).toBe(true);
  });

  test("invokes onUpdate per record", () => {
    const seen: number[] = [];
    const tracker = createCostTracker({ onUpdate: (snap) => seen.push(snap.totalUsd) });
    tracker.record({ costUsd: 0.1 }, "claude");
    tracker.record({ costUsd: 0.2 }, "claude");
    expect(seen).toEqual([0.1, 0.30000000000000004]);
  });

  test("uses a custom estimator when provided", () => {
    const tracker = createCostTracker({ estimator: (usage) => (usage.tokensOut ?? 0) * 0.001 });
    tracker.record({ tokensOut: 10 }, "claude", "haiku");
    expect(tracker.snapshot.totalUsd).toBeCloseTo(0.01, 6);
  });

  test("reset clears all accumulated state", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 0.5 }, "claude");
    tracker.reset();
    expect(tracker.snapshot.totalUsd).toBe(0);
    expect(tracker.snapshot.turns).toBe(0);
  });

  test("turnCount starts at 0 and increments on each record()", () => {
    const tracker = createCostTracker();
    expect(tracker.turnCount).toBe(0);
    tracker.record({ costUsd: 0.1 }, "claude");
    expect(tracker.turnCount).toBe(1);
    tracker.record({ costUsd: 0.1 }, "codex");
    expect(tracker.turnCount).toBe(2);
  });

  test("averagePerTurn is 0 when turnCount=0, then totalUsd/turnCount", () => {
    const tracker = createCostTracker();
    expect(tracker.averagePerTurn).toBe(0);
    tracker.record({ costUsd: 0.3 }, "claude");
    expect(tracker.averagePerTurn).toBeCloseTo(0.3, 6);
    tracker.record({ costUsd: 0.1 }, "claude");
    expect(tracker.averagePerTurn).toBeCloseTo(0.2, 6);
  });

  test("project(0).projectedUsd equals totalUsd", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 0.4 }, "claude");
    tracker.record({ costUsd: 0.2 }, "claude");
    expect(tracker.project(0).projectedUsd).toBeCloseTo(tracker.snapshot.totalUsd, 6);
  });

  test("project(5).projectedUsd equals totalUsd + averagePerTurn * 5", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 0.4 }, "claude");
    tracker.record({ costUsd: 0.2 }, "claude");
    const expected = tracker.snapshot.totalUsd + tracker.averagePerTurn * 5;
    expect(tracker.project(5).projectedUsd).toBeCloseTo(expected, 6);
  });
});

describe("ICostTracker.fork()", () => {
  test("fork() returns a tracker whose initial snapshot.totalUsd equals the parent's at fork time", () => {
    const parent = createCostTracker();
    parent.record({ costUsd: 0.5 }, "claude");
    parent.record({ costUsd: 0.3 }, "codex");
    const child = parent.fork();
    expect(child.snapshot.totalUsd).toBeCloseTo(parent.snapshot.totalUsd, 6);
  });

  test("recording on the forked tracker increases its total beyond the baseline; the parent is unchanged", () => {
    const parent = createCostTracker();
    parent.record({ costUsd: 0.5 }, "claude");
    const parentTotalAtFork = parent.snapshot.totalUsd;
    const child = parent.fork();

    child.record({ costUsd: 0.2 }, "claude");
    expect(child.snapshot.totalUsd).toBeCloseTo(parentTotalAtFork + 0.2, 6);
    expect(parent.snapshot.totalUsd).toBeCloseTo(parentTotalAtFork, 6);
  });

  test("byAgent on the forked tracker shows accumulated parent values plus new records under same keys", () => {
    const parent = createCostTracker();
    parent.record({ costUsd: 0.5 }, "claude");
    const child = parent.fork();

    child.record({ costUsd: 0.3 }, "claude");
    expect(child.snapshot.byAgent.claude?.totalUsd).toBeCloseTo(0.8, 6);
    expect(parent.snapshot.byAgent.claude?.totalUsd).toBeCloseTo(0.5, 6);
  });

  test("budgetUsd is inherited by the forked tracker", () => {
    const parent = createCostTracker({ budgetUsd: 2.0 });
    parent.record({ costUsd: 0.5 }, "claude");
    const child = parent.fork();
    expect(child.budgetUsd).toBe(2.0);
  });

  test("estimator is inherited by the forked tracker", () => {
    const estimator = (usage: { tokensOut?: number }) => (usage.tokensOut ?? 0) * 0.001;
    const parent = createCostTracker({ estimator });
    parent.record({ tokensOut: 100 }, "claude");
    const child = parent.fork();
    child.record({ tokensOut: 50 }, "claude");
    // child total = 0.1 (parent baseline) + 0.05 (new record via inherited estimator)
    expect(child.snapshot.totalUsd).toBeCloseTo(0.15, 6);
  });

  test("onUpdate is inherited and fires for new records on the forked tracker", () => {
    const seen: number[] = [];
    const parent = createCostTracker({ onUpdate: (snap) => seen.push(snap.totalUsd) });
    parent.record({ costUsd: 0.1 }, "claude");
    const child = parent.fork();
    child.record({ costUsd: 0.2 }, "claude");
    // onUpdate fires for both parent record and child record
    expect(seen).toEqual([0.1, 0.30000000000000004]);
  });

  test("fork() turnCount starts at 0 (own accumulated turns only)", () => {
    const parent = createCostTracker();
    parent.record({ costUsd: 0.1 }, "claude");
    parent.record({ costUsd: 0.1 }, "claude");
    const child = parent.fork();
    expect(child.turnCount).toBe(0);
    child.record({ costUsd: 0.1 }, "claude");
    expect(child.turnCount).toBe(1);
  });
});

describe("enforceBudget", () => {
  test("throws BudgetExceededError when over budget", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 0.2 }, "claude");
    expect(() => enforceBudget({ tracker, agent: "claude", maxCostUsd: 0.1 })).toThrow(BudgetExceededError);
  });

  test("is a no-op when under budget", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 0.05 }, "claude");
    expect(() => enforceBudget({ tracker, agent: "claude", maxCostUsd: 0.1 })).not.toThrow();
  });

  test("is a no-op when no budget supplied", () => {
    const tracker = createCostTracker();
    tracker.record({ costUsd: 999 }, "claude");
    expect(() => enforceBudget({ tracker, agent: "claude" })).not.toThrow();
  });
});

describe("pricing table", () => {
  test("setPricing then getPricing roundtrips", () => {
    setPricing("claude", "test-model-x", { inputPerMillion: 1, outputPerMillion: 2 });
    const result = getPricing("claude", "test-model-x");
    expect(result?.inputPerMillion).toBe(1);
    expect(result?.outputPerMillion).toBe(2);
  });

  test("listPricing includes the seeded entries", () => {
    const all = listPricing();
    expect(all.some((entry) => entry.agent === "claude" && entry.model === "haiku")).toBe(true);
  });
});
