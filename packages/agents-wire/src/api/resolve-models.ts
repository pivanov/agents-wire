import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { definitionFor } from "@/catalog/index";
import type { IAgentModelOption, IModelEffort, TAgentId } from "@/types/agent";
import type { IAgentSession } from "./session";

/**
 * Resolution source. The picker can surface this as a "live" / "fallback"
 * tag so users know whether they're seeing the agent's actual lineup or
 * a placeholder waiting on auth / probe.
 */
export type TModelSource = "session-config" | "live-list" | "static" | "none";

export interface IResolvedModels {
  readonly source: TModelSource;
  readonly models: readonly IAgentModelOption[];
  /**
   * The configId the agent declared for its model selector, when known
   * (e.g. `model` from `category: "model"` configOption). Echoed back
   * via `setSessionConfigOption` when the user picks a model.
   */
  readonly modelConfigId?: string;
  /**
   * The configId the agent declared for its effort selector, when known
   * (e.g. `reasoning_effort`, `thought_level`, `thinking_budget`).
   * Echoed back via `setSessionConfigOption` when the user picks an effort.
   */
  readonly effortConfigId?: string;
}

interface IFlatOption {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

const flattenOptions = (opts: unknown): readonly IFlatOption[] => {
  if (!Array.isArray(opts) || opts.length === 0) {
    return [];
  }
  const first = opts[0] as Partial<IFlatOption> & { options?: readonly IFlatOption[] };
  if ("value" in first) {
    return opts as readonly IFlatOption[];
  }
  // Group form (`{ group, name, options: [...] }`) - flatten one level.
  return (opts as readonly { options?: readonly IFlatOption[] }[]).flatMap((g) => g.options ?? []);
};

const isModelOption = (o: SessionConfigOption): boolean =>
  o.type === "select" && (o.category === "model" || o.id === "model" || /(^|_)model($|_)/i.test(o.id));

const isEffortOption = (o: SessionConfigOption): boolean =>
  o.type === "select" &&
  (o.category === "thought_level" || /effort|reasoning|thinking/i.test(o.id) || /effort|reasoning|thinking/i.test(o.name ?? ""));

const isBudgetOption = (o: SessionConfigOption): boolean =>
  // `boolean` configOptions can't carry a budget; only `select` can. We
  // still match here for forward-compat with any future numeric type
  // ACP introduces (e.g. `range`).
  o.type === "select" && (o.category === "thought_level" || /thinking_budget|reasoning_budget/i.test(o.id));

/**
 * Build IModelEffort from the agent's effort-related configOption.
 *
 *   - select with named tiers (low/medium/high/...)  → kind: "enum"
 *   - select with numeric value labels ("8000", "16000")    → kind: "budget"
 *   - none                                                  → kind: "none"
 */
const effortFromOption = (opt: SessionConfigOption | undefined): IModelEffort => {
  if (!opt || opt.type !== "select") {
    return { kind: "none" };
  }
  const flat = flattenOptions(opt.options);
  if (flat.length === 0) {
    return { kind: "none" };
  }
  // If every value parses as a number, treat as a budget axis with
  // min/max derived from the bounds.
  const numeric = flat.map((f) => Number(f.value)).filter((n) => Number.isFinite(n));
  if (numeric.length === flat.length && numeric.length > 0) {
    return {
      kind: "budget",
      min: Math.min(...numeric),
      max: Math.max(...numeric),
    };
  }
  return {
    kind: "enum",
    values: flat.map((f) => f.value),
  };
};

const buildFromConfigOptions = (
  configOptions: readonly SessionConfigOption[] | undefined,
): { models: IAgentModelOption[]; modelConfigId?: string; effortConfigId?: string } | null => {
  if (!configOptions || configOptions.length === 0) {
    return null;
  }
  const modelOpt = configOptions.find(isModelOption);
  const effortOpt = configOptions.find(isEffortOption) ?? configOptions.find(isBudgetOption);
  if (!modelOpt || modelOpt.type !== "select") {
    return null;
  }
  const flat = flattenOptions(modelOpt.options);
  if (flat.length === 0) {
    return null;
  }
  const effort = effortFromOption(effortOpt);
  const models: IAgentModelOption[] = flat.map((f) => ({
    id: f.value,
    label: f.name,
    ...(f.description ? { description: f.description } : {}),
    ...(effort.kind !== "none" ? { effort } : {}),
  }));
  const result: { models: IAgentModelOption[]; modelConfigId?: string; effortConfigId?: string } = { models };
  if (modelOpt.id) {
    result.modelConfigId = modelOpt.id;
  }
  if (effortOpt?.id) {
    result.effortConfigId = effortOpt.id;
  }
  return result;
};

const tagAsVariant = (models: readonly IAgentModelOption[]): readonly IAgentModelOption[] =>
  models.map((m) => ({ ...m, effort: { kind: "variant" as const } }));

interface IResolveOptions {
  /**
   * Active session whose `configOptions` should be used as the
   * primary source. If omitted, resolve falls through to
   * `listAvailableModels()` and finally the static catalog.
   */
  readonly session?: IAgentSession;
}

/**
 * Resolution hierarchy (highest priority first):
 *
 *   1. session.configOptions          — agent-declared, per-session. THE truth.
 *   2. def.listAvailableModels()      — live CLI listing (cursor, opencode, kilo).
 *   3. def.models                     — cold-start placeholder. Just "Default".
 *
 * Rationale: configOptions says what THIS session accepts right now.
 * listAvailableModels says what the binary supports. Static is "we
 * don't know yet, ask the agent".
 */
export const resolveModels = async (agent: TAgentId, options: IResolveOptions = {}): Promise<IResolvedModels> => {
  const def = (() => {
    try {
      return definitionFor(agent);
    } catch {
      return undefined;
    }
  })();

  // 1. session.configOptions — authoritative when present. Skipped
  // for agents marked `acpCompatible: false` (Pi v0.73 etc.), since
  // their non-ACP CLI never produces a session.configOptions even
  // when "spawned" - the caller shouldn't hand us one.
  if (options.session && def?.acpCompatible !== false) {
    const built = buildFromConfigOptions(options.session.configOptions);
    if (built) {
      return {
        source: "session-config",
        models: built.models,
        ...(built.modelConfigId ? { modelConfigId: built.modelConfigId } : {}),
        ...(built.effortConfigId ? { effortConfigId: built.effortConfigId } : {}),
      };
    }
  }

  // 2. listAvailableModels() — CLI introspection (cursor / opencode / kilo).
  // Cursor's effort is variant-based (baked into the id), so we tag
  // those entries explicitly. OpenCode and Kilo expose plain model
  // ids without per-model effort metadata, so they default to `none`.
  if (def?.listAvailableModels) {
    try {
      const live = await def.listAvailableModels();
      if (live.length > 0) {
        const tagged = agent === "cursor" ? tagAsVariant(live) : live;
        return { source: "live-list", models: tagged };
      }
    } catch {
      /* fall through to static */
    }
  }

  // 3. Static catalog placeholder.
  const staticModels = def?.models ?? [];
  if (staticModels.length > 0) {
    return { source: "static", models: staticModels };
  }

  return { source: "none", models: [] };
};
