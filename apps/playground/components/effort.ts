// Reasoning-effort visuals + cycling helpers, ported from cursor-cli.
// Used by ModelPicker so left/right arrows cycle effort for the
// currently-focused model inline, instead of a separate picker stage.

import type { IAgentModelOption, IModelEffort } from "@pivanov/agents-wire";

const PREFERRED_DEFAULTS: readonly string[] = ["high", "medium", "low"];

/**
 * Pick a sensible default from an enum-shaped effort. Returns null
 * for non-enum kinds (none / variant / budget — these are handled
 * differently in the picker).
 */
export const defaultEffortFor = (effort: IModelEffort | undefined): string | null => {
  if (!effort || effort.kind !== "enum") {
    return null;
  }
  if (effort.default && effort.values.includes(effort.default)) {
    return effort.default;
  }
  for (const candidate of PREFERRED_DEFAULTS) {
    if (effort.values.includes(candidate)) {
      return candidate;
    }
  }
  return effort.values[0] ?? null;
};

// Effort glyphs mirror cursor-cli's progression. See SYMBOLS for the
// exact mapping; unknown values fall back to ● (high).
const SYMBOLS: Record<string, string> = {
  none: "",
  low: "○",
  medium: "◐",
  high: "●",
  "extra-high": "◉",
  xhigh: "◉",
  max: "◈",
};

export const effortSymbol = (value: string | null): string => (value ? (SYMBOLS[value] ?? "●") : "");

const LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  "extra-high": "Extra-high",
  max: "Max",
  xhigh: "X-high",
};

export const effortLabel = (value: string): string => LABELS[value] ?? value;

export const cycleEffort = (values: readonly string[], current: string, dir: 1 | -1): string => {
  const idx = values.indexOf(current);
  const base = idx === -1 ? 0 : idx;
  const len = values.length;
  if (len === 0) {
    return current;
  }
  const next = (base + dir + len) % len;
  return values[next] ?? current;
};

/** True if the model exposes an enum-shaped effort axis (the only kind ←→ cycles). */
export const isEnumEffort = (model: IAgentModelOption): boolean => model.effort?.kind === "enum";

/**
 * True if any model in the list exposes an enum effort axis. Used by
 * ModelPicker to decide whether to show the effort indicator row at
 * all - for agents that ship no enum-effort models (variant / none /
 * budget across the board), the inline ←→ row would be misleading.
 */
export const agentHasAnyEnumEffort = (models: readonly IAgentModelOption[]): boolean =>
  models.some((m) => m.effort?.kind === "enum");
