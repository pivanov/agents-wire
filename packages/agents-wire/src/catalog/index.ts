import type { IAgentDefinition, TAgentId, TBuiltInAgentId } from "@/types/agent";
import { auggie } from "./auggie";
import { claude } from "./claude";
import { cline } from "./cline";
import { codex } from "./codex";
import { copilot } from "./copilot";
import { cursor } from "./cursor";
import { droid } from "./droid";
import { gemini } from "./gemini";
import { kilo } from "./kilo";
import { opencode } from "./opencode";
import { pi } from "./pi";
import { qwen } from "./qwen";

export { auggie, claude, cline, codex, copilot, cursor, droid, gemini, kilo, opencode, pi, qwen };

const REGISTRY: Readonly<Record<TBuiltInAgentId, IAgentDefinition>> = {
  auggie,
  claude,
  cline,
  codex,
  copilot,
  cursor,
  droid,
  gemini,
  kilo,
  opencode,
  pi,
  qwen,
};

const customRegistry = new Map<string, IAgentDefinition>();

export const definitionFor = (id: TAgentId): IAgentDefinition => {
  const builtIn = REGISTRY[id as TBuiltInAgentId];
  if (builtIn) {
    return builtIn;
  }
  const custom = customRegistry.get(id);
  if (custom) {
    return custom;
  }
  throw new Error(`Unknown agent "${id}". Built-ins: ${Object.keys(REGISTRY).join(", ")}`);
};

export const registerDefinition = (definition: IAgentDefinition): void => {
  if (REGISTRY[definition.id as TBuiltInAgentId]) {
    throw new Error(`Cannot override built-in agent "${definition.id}"`);
  }
  customRegistry.set(definition.id, definition);
};

export const unregisterDefinition = (id: string): boolean => customRegistry.delete(id);

export const listDefinitions = (): readonly IAgentDefinition[] => [...Object.values(REGISTRY), ...customRegistry.values()];
