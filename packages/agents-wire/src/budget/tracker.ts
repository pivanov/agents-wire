import type { TAgentId } from "@/types/agent";
import type { ICostBucket, ICostSnapshot, IUsageReport } from "@/types/results";
import { getPricing, type IModelPricing, pricingKey, type TPricingOverrides } from "./pricing";

export interface ICostTrackerOptions {
  readonly budgetUsd?: number;
  readonly estimator?: (usage: IUsageReport, agent: TAgentId, model?: string) => number;
  readonly onUpdate?: (snapshot: ICostSnapshot) => void;
  /** Per-tracker pricing overrides; takes precedence over the process-global table. */
  readonly pricingOverrides?: ReadonlyArray<{ agent: TAgentId; model: string; pricing: IModelPricing }>;
}

export interface ICostTracker {
  readonly snapshot: ICostSnapshot;
  readonly budgetUsd: number | undefined;
  readonly remainingUsd: number | undefined;
  readonly turnCount: number;
  readonly averagePerTurn: number;
  record: (usage: IUsageReport, agent: TAgentId, model?: string) => ICostSnapshot;
  willExceed: (additionalUsd: number) => boolean;
  reset: () => void;
  project: (remainingTurns: number) => { projectedUsd: number };
  fork: () => ICostTracker;
}

const emptyBucket = (): ICostBucket => ({
  totalUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  turns: 0,
});

const fromTable = (usage: IUsageReport, agent: TAgentId, model: string | undefined, scoped: TPricingOverrides | undefined): number => {
  if (!model) {
    return 0;
  }
  const pricing = getPricing(agent, model, scoped);
  if (!pricing) {
    return 0;
  }
  const million = 1_000_000;
  const inCost = ((usage.tokensIn ?? 0) * pricing.inputPerMillion) / million;
  const outCost = ((usage.tokensOut ?? 0) * pricing.outputPerMillion) / million;
  const cacheReadCost = ((usage.tokensCacheRead ?? 0) * (pricing.cacheReadPerMillion ?? 0)) / million;
  const cacheWriteCost = ((usage.tokensCacheWrite ?? 0) * (pricing.cacheWritePerMillion ?? 0)) / million;
  return inCost + outCost + cacheReadCost + cacheWriteCost;
};

const computeCost = (
  usage: IUsageReport,
  agent: TAgentId,
  model: string | undefined,
  estimator: ICostTrackerOptions["estimator"],
  scoped: TPricingOverrides | undefined,
): number => {
  if (typeof usage.costUsd === "number") {
    return usage.costUsd;
  }
  if (estimator) {
    return estimator(usage, agent, model);
  }
  return fromTable(usage, agent, model, scoped);
};

const accumulate = (bucket: ICostBucket, usage: IUsageReport, addedCost: number): ICostBucket => ({
  totalUsd: bucket.totalUsd + addedCost,
  tokensIn: bucket.tokensIn + (usage.tokensIn ?? 0),
  tokensOut: bucket.tokensOut + (usage.tokensOut ?? 0),
  tokensCacheRead: bucket.tokensCacheRead + (usage.tokensCacheRead ?? 0),
  tokensCacheWrite: bucket.tokensCacheWrite + (usage.tokensCacheWrite ?? 0),
  turns: bucket.turns + 1,
});

const addBuckets = (a: ICostBucket, b: ICostBucket): ICostBucket => ({
  totalUsd: a.totalUsd + b.totalUsd,
  tokensIn: a.tokensIn + b.tokensIn,
  tokensOut: a.tokensOut + b.tokensOut,
  tokensCacheRead: a.tokensCacheRead + b.tokensCacheRead,
  tokensCacheWrite: a.tokensCacheWrite + b.tokensCacheWrite,
  turns: a.turns + b.turns,
});

const buildSnapshot = (totals: ICostBucket, byAgent: Map<TAgentId, ICostBucket>): ICostSnapshot => ({
  ...totals,
  byAgent: Object.fromEntries(byAgent.entries()) as ICostSnapshot["byAgent"],
});

/**
 * Internal factory. `baseline` and `baselineByAgent` are frozen snapshots from the parent
 * at fork time - the new tracker accumulates from zero but reports offset-adjusted totals.
 */
const createTrackerInternal = (
  options: ICostTrackerOptions,
  baseline: ICostBucket,
  baselineByAgent: ReadonlyMap<TAgentId, ICostBucket>,
): ICostTracker => {
  let totals = emptyBucket();
  let byAgent = new Map<TAgentId, ICostBucket>();

  const scopedOverrides: TPricingOverrides | undefined = options.pricingOverrides
    ? new Map(options.pricingOverrides.map((entry) => [pricingKey(entry.agent, entry.model), entry.pricing]))
    : undefined;

  const currentSnapshot = (): ICostSnapshot => {
    // Merge baseline byAgent with accumulated byAgent for monotonic per-agent reporting
    const merged = new Map<TAgentId, ICostBucket>(baselineByAgent);
    for (const [agent, bucket] of byAgent) {
      const base = merged.get(agent) ?? emptyBucket();
      merged.set(agent, addBuckets(base, bucket));
    }
    return buildSnapshot(addBuckets(baseline, totals), merged);
  };

  const record = (usage: IUsageReport, agent: TAgentId, model?: string): ICostSnapshot => {
    const addedCost = computeCost(usage, agent, model, options.estimator, scopedOverrides);
    totals = accumulate(totals, usage, addedCost);
    const existing = byAgent.get(agent) ?? emptyBucket();
    byAgent.set(agent, accumulate(existing, usage, addedCost));
    const next = currentSnapshot();
    options.onUpdate?.(next);
    return next;
  };

  const willExceed = (additionalUsd: number): boolean => {
    if (options.budgetUsd === undefined) {
      return false;
    }
    return baseline.totalUsd + totals.totalUsd + additionalUsd > options.budgetUsd;
  };

  const reset = (): void => {
    totals = emptyBucket();
    byAgent = new Map();
  };

  const project = (remainingTurns: number): { projectedUsd: number } => {
    const avg = totals.turns === 0 ? 0 : totals.totalUsd / totals.turns;
    return { projectedUsd: baseline.totalUsd + totals.totalUsd + avg * remainingTurns };
  };

  const fork = (): ICostTracker => {
    // Build a frozen byAgent snapshot: merge baseline with accumulated at fork time
    const forkBaselineByAgent = new Map<TAgentId, ICostBucket>(baselineByAgent);
    for (const [agent, bucket] of byAgent) {
      const base = forkBaselineByAgent.get(agent) ?? emptyBucket();
      forkBaselineByAgent.set(agent, addBuckets(base, bucket));
    }
    return createTrackerInternal(options, addBuckets(baseline, totals), forkBaselineByAgent);
  };

  return {
    get snapshot() {
      return currentSnapshot();
    },
    get budgetUsd() {
      return options.budgetUsd;
    },
    get remainingUsd() {
      if (options.budgetUsd === undefined) {
        return undefined;
      }
      return Math.max(0, options.budgetUsd - baseline.totalUsd - totals.totalUsd);
    },
    get turnCount() {
      return totals.turns;
    },
    get averagePerTurn() {
      return totals.turns === 0 ? 0 : totals.totalUsd / totals.turns;
    },
    record,
    willExceed,
    reset,
    project,
    fork,
  };
};

export const createCostTracker = (options: ICostTrackerOptions = {}): ICostTracker => createTrackerInternal(options, emptyBucket(), new Map());
