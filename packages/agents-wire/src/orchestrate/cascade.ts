import { createClient } from "@/api/client";
import { isTransientError, WireError } from "@/errors";
import type { TAgentId } from "@/types/agent";
import type { IAskOptions } from "@/types/options";
import type { IAskResult } from "@/types/results";

export interface ICascadeStage {
  readonly agent: TAgentId;
  readonly options?: IAskOptions;
  readonly accept?: (result: IAskResult, stageIndex: number) => boolean | Promise<boolean>;
}

export interface ICascadeRejection {
  readonly stage: ICascadeStage;
  readonly stageIndex: number;
  readonly result?: IAskResult;
  readonly error?: unknown;
}

export interface ICascadeResult extends IAskResult {
  readonly winningStageIndex: number;
  readonly winningAgent: TAgentId;
  readonly rejected: readonly ICascadeRejection[];
}

export interface ICascadeOptions extends IAskOptions {
  readonly onStage?: (info: { readonly stage: ICascadeStage; readonly stageIndex: number }) => void;
  readonly shouldRetry?: (error: unknown, stageIndex: number) => boolean;
}

const stageOptions = (base: IAskOptions, stage: ICascadeStage): IAskOptions => {
  if (!stage.options) {
    return base;
  }
  return { ...base, ...stage.options };
};

const decide = async (stage: ICascadeStage, result: IAskResult, stageIndex: number): Promise<boolean> => {
  if (!stage.accept) {
    return true;
  }
  return stage.accept(result, stageIndex);
};

const defaultShouldRetry = (error: unknown): boolean => {
  if (error instanceof WireError) {
    return (
      error.code === "agent-not-installed" ||
      error.code === "spawn-failed" ||
      error.code === "init-failed" ||
      error.code === "init-timeout" ||
      error.code === "auth-required" ||
      error.code === "usage-limit" ||
      error.code === "connection-closed" ||
      error.code === "overloaded" ||
      error.code === "rate-limit"
    );
  }
  return isTransientError(error);
};

export const cascade = async (prompt: string, stages: readonly ICascadeStage[], options: ICascadeOptions = {}): Promise<ICascadeResult> => {
  if (stages.length === 0) {
    throw new WireError("retry-exhausted", "cascade called with no stages");
  }
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const rejected: ICascadeRejection[] = [];

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stage = stages[stageIndex];
    if (!stage) {
      continue;
    }
    options.onStage?.({ stage, stageIndex });
    const askOptions = stageOptions(options, stage);
    let result: IAskResult;
    try {
      result = await createClient(stage.agent, askOptions).ask(prompt);
    } catch (cause) {
      const more = stageIndex + 1 < stages.length;
      if (!more || !shouldRetry(cause, stageIndex)) {
        throw cause;
      }
      rejected.push({ stage, stageIndex, error: cause });
      continue;
    }
    const accepted = await decide(stage, result, stageIndex);
    if (accepted) {
      return { ...result, winningStageIndex: stageIndex, winningAgent: stage.agent, rejected };
    }
    rejected.push({ stage, stageIndex, result });
  }

  const last = rejected[rejected.length - 1];
  if (!last) {
    throw new WireError("retry-exhausted", "cascade exhausted with no successful stage");
  }
  throw new WireError("retry-exhausted", `All ${stages.length} cascade stages failed or were rejected`, {
    cause: last.error ?? last.result,
  });
};
