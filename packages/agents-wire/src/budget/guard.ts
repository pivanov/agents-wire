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
  if (options.tracker.snapshot.totalUsd >= options.maxCostUsd) {
    throw new BudgetExceededError(options.tracker.snapshot.totalUsd, options.maxCostUsd, {
      agent: options.agent,
    });
  }
};
