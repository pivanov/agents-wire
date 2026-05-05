import type { TAgentId } from "@/types/agent";

export interface IModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
}

const compositeKey = (agent: TAgentId, model: string): string => `${agent}::${model.toLowerCase()}`;

const seed: Record<string, IModelPricing> = {
  [compositeKey("claude", "haiku")]: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  [compositeKey("claude", "claude-haiku-4-5")]: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  [compositeKey("claude", "sonnet")]: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  [compositeKey("claude", "claude-sonnet-4-6")]: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  [compositeKey("claude", "opus")]: {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  [compositeKey("claude", "claude-opus-4-7")]: {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  [compositeKey("codex", "gpt-5")]: { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  [compositeKey("codex", "o4-mini")]: { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  [compositeKey("gemini", "gemini-1.5-pro")]: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  [compositeKey("gemini", "gemini-1.5-flash")]: { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  [compositeKey("gemini", "gemini-2.0-flash")]: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

// Process-global overrides; mutated by setPricing for back-compat.
// Multi-tenant callers should pass `pricingOverrides` per cost tracker instead.
const globalOverrides: Map<string, IModelPricing> = new Map(Object.entries(seed));

export type TPricingOverrides = ReadonlyMap<string, IModelPricing>;

export const pricingKey = compositeKey;

export const setPricing = (agent: TAgentId, model: string, pricing: IModelPricing): void => {
  globalOverrides.set(compositeKey(agent, model), pricing);
};

export const getPricing = (agent: TAgentId, model: string, scoped?: TPricingOverrides): IModelPricing | undefined => {
  const key = compositeKey(agent, model);
  return scoped?.get(key) ?? globalOverrides.get(key);
};

export const listPricing = (): ReadonlyArray<{ agent: TAgentId; model: string; pricing: IModelPricing }> => {
  return Array.from(globalOverrides.entries(), ([key, pricing]) => {
    const [agent, model] = key.split("::") as [TAgentId, string];
    return { agent, model, pricing };
  });
};
