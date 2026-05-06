import { BudgetExceededError } from "@/errors";
import type { TAgentId } from "@/types/agent";
import type { ICostTracker } from "./tracker";

export interface IBudgetGuardOptions {
  readonly tracker: ICostTracker;
  readonly agent: TAgentId;
  readonly maxCostUsd?: number;
}

export const enforceBudget = (options: IBudgetGuardOptions): void => {
  if (options.maxCostUsd === undefined) {
    return;
  }
  // snapshot is a getter that builds a fresh object — capture once.
  const totalUsd = options.tracker.snapshot.totalUsd;
  if (totalUsd >= options.maxCostUsd) {
    throw new BudgetExceededError(totalUsd, options.maxCostUsd, {
      agent: options.agent,
    });
  }
};
