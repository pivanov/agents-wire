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
  // Try alias resolution before bailing out so consumers calling
  // `definitionFor("claude-code")` reach Claude instead of failing.
  const aliased = resolveAgentAlias(id);
  if (aliased && aliased !== id) {
    return definitionFor(aliased);
  }
  throw new Error(`Unknown agent "${id}". Built-ins: ${Object.keys(REGISTRY).join(", ")}`);
};

/**
 * Resolve a freeform input (e.g. `"claude-code"`, `"gpt-5"`) to a canonical
 * agent id by checking `aliases` on every definition. Returns `null` if no
 * match — callers can then surface a friendlier error than `definitionFor`'s
 * throw path. Exact id matches short-circuit immediately.
 */
export const resolveAgentAlias = (input: string): TAgentId | null => {
  if (REGISTRY[input as TBuiltInAgentId] || customRegistry.has(input)) {
    return input;
  }
  for (const def of [...Object.values(REGISTRY), ...customRegistry.values()]) {
    if (def.aliases?.includes(input)) {
      return def.id;
    }
  }
  return null;
};

export const registerDefinition = (definition: IAgentDefinition): void => {
  if (REGISTRY[definition.id as TBuiltInAgentId]) {
    throw new Error(`Cannot override built-in agent "${definition.id}"`);
  }
  customRegistry.set(definition.id, definition);
};

export const unregisterDefinition = (id: string): boolean => customRegistry.delete(id);

export const listDefinitions = (): readonly IAgentDefinition[] => [...Object.values(REGISTRY), ...customRegistry.values()];
