import { createClient } from "@/api/client";
import { isTransientError, WireError } from "@/errors";
import type { TAgentId } from "@/types/agent";
import type { IAskOptions } from "@/types/options";
import type { IAskResult } from "@/types/results";

export interface IFailoverAttempt {
  readonly agent: TAgentId;
  readonly error: unknown;
  readonly durationMs: number;
}

export interface IFailoverResult extends IAskResult {
  readonly winner: TAgentId;
  readonly attempted: readonly IFailoverAttempt[];
}

export interface IFailoverOptions extends IAskOptions {
  readonly shouldRetry?: (error: unknown, agent: TAgentId, attempt: number) => boolean;
  readonly perAgent?: Readonly<Partial<Record<TAgentId, IAskOptions>>>;
  readonly onAttempt?: (info: { readonly agent: TAgentId; readonly attempt: number }) => void;
}

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

const optionsForAgent = (base: IAskOptions, perAgent: IFailoverOptions["perAgent"], agent: TAgentId): IAskOptions => {
  const overrides = perAgent?.[agent];
  if (!overrides) {
    return base;
  }
  return { ...base, ...overrides };
};

export const failover = async (prompt: string, candidates: readonly TAgentId[], options: IFailoverOptions = {}): Promise<IFailoverResult> => {
  if (candidates.length === 0) {
    throw new WireError("retry-exhausted", "failover called with no candidates");
  }
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const attempted: IFailoverAttempt[] = [];

  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const agent = candidates[attempt];
    if (!agent) {
      continue;
    }
    options.onAttempt?.({ agent, attempt: attempt + 1 });
    const startedAt = Date.now();
    const askOptions = optionsForAgent(options, options.perAgent, agent);
    try {
      const result = await createClient(agent, askOptions).ask(prompt);
      return { ...result, winner: agent, attempted };
    } catch (cause) {
      attempted.push({ agent, error: cause, durationMs: Date.now() - startedAt });
      const more = attempt + 1 < candidates.length;
      if (!more || !shouldRetry(cause, agent, attempt + 1)) {
        throw cause;
      }
    }
  }

  throw new WireError("retry-exhausted", `All ${candidates.length} candidates failed`, {
    cause: attempted[attempted.length - 1]?.error,
  });
};
