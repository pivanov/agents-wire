import type { LanguageModelV3 } from "@ai-sdk/provider";
import { NoSuchModelError } from "@ai-sdk/provider";
import type { IAgentAdapter, TAgentId } from "@/types/agent";
import type { IAgentOptions } from "@/types/options";
import { createAgentLanguageModel } from "./language-model";

export interface IAgentProvider {
  (agent: TAgentId, settings?: IAgentOptions): LanguageModelV3;
  readonly specificationVersion: "v3";
  languageModel: (agent: TAgentId, settings?: IAgentOptions) => LanguageModelV3;
  fromAdapter: (adapter: IAgentAdapter, settings?: IAgentOptions) => LanguageModelV3;
  textEmbeddingModel: (modelId: string) => never;
  imageModel: (modelId: string) => never;
}

const mergeSettings = (defaults: IAgentOptions, overrides: IAgentOptions = {}): IAgentOptions => {
  const merged: { -readonly [K in keyof IAgentOptions]: IAgentOptions[K] } = { ...defaults, ...overrides };
  if (overrides.toolHandler !== undefined && defaults.toolHandler !== undefined) {
    merged.toolHandler = { ...defaults.toolHandler, ...overrides.toolHandler };
  }
  if (overrides.env !== undefined && defaults.env !== undefined) {
    merged.env = { ...defaults.env, ...overrides.env };
  }
  if (overrides.meta !== undefined && defaults.meta !== undefined) {
    merged.meta = { ...defaults.meta, ...overrides.meta };
  }
  if (overrides.mcpServers !== undefined && defaults.mcpServers !== undefined) {
    const byName = new Map(defaults.mcpServers.map((s) => [s.name, s]));
    for (const s of overrides.mcpServers) {
      byName.set(s.name, s);
    }
    merged.mcpServers = Array.from(byName.values());
  }
  return merged;
};

export const createAgentProvider = (defaults: IAgentOptions = {}): IAgentProvider => {
  const builder = (agent: TAgentId, settings: IAgentOptions = {}): LanguageModelV3 => {
    return createAgentLanguageModel(agent, mergeSettings(defaults, settings));
  };

  const fromAdapter = (adapter: IAgentAdapter, settings: IAgentOptions = {}): LanguageModelV3 => {
    return createAgentLanguageModel(adapter.id, mergeSettings(defaults, settings), adapter);
  };

  const textEmbeddingModel = (modelId: string): never => {
    throw new NoSuchModelError({ modelId, modelType: "embeddingModel" });
  };

  const imageModel = (modelId: string): never => {
    throw new NoSuchModelError({ modelId, modelType: "imageModel" });
  };

  return Object.assign(builder, {
    specificationVersion: "v3" as const,
    languageModel: builder,
    fromAdapter,
    textEmbeddingModel,
    imageModel,
  }) as IAgentProvider;
};

export const agentModel = (agent: TAgentId, settings: IAgentOptions = {}): LanguageModelV3 => {
  return createAgentLanguageModel(agent, settings);
};
