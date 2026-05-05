// Per-agent model + effort discovery. Thin wrapper over the SDK's
// `resolveModels(agent, { session? })` which walks the canonical
// hierarchy:
//
//   1. session.configOptions  ← agent-declared, per-session. THE truth.
//   2. listAvailableModels()  ← live CLI listing (cursor / opencode / kilo).
//   3. def.models             ← cold-start placeholder. Just "Default".
//
// Rationale lives in `packages/agents-wire/src/api/resolve-models.ts`.
// The playground caches one resolved snapshot per agent so the picker
// opens instantly on second visit. `r` in the agent picker invalidates.

import {
  agents,
  definitionFor,
  type IAgentModelOption,
  type IAgentSession,
  type IResolvedModels,
  resolveModels,
  type TAgentId,
  type TModelSource,
} from "@pivanov/agents-wire";

export type IModelInfo = IAgentModelOption;

export const NONE_MODEL_ID = "__default__";

const cache = new Map<TAgentId, IResolvedModels>();
const inFlight = new Map<TAgentId, Promise<IResolvedModels>>();

// Hard ceiling on a per-agent probe. Pi (v0.73) doesn't speak ACP and
// never responds to `initialize`, so its `agents.session()` would hang
// indefinitely without this. The boot splash gates on ALL probes
// settling - a single hung agent would freeze the REPL.
const PROBE_TIMEOUT_MS = 6_000;

const withTimeout = <T>(promise: Promise<T>, ms: number, tag: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(`probe timeout (${tag}, ${ms}ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (cause) => {
        clearTimeout(handle);
        reject(cause);
      },
    );
  });

const probe = async (agent: TAgentId): Promise<IResolvedModels> => {
  // Skip the session spawn entirely for agents that don't implement
  // ACP (catalog flag `acpCompatible: false`). Spawning them just
  // produces "Invalid message" log spam from the ACP stream parser
  // and a hung connection waiting for an `initialize` reply that
  // never comes.
  let acpCompatible = true;
  try {
    acpCompatible = definitionFor(agent).acpCompatible !== false;
  } catch {
    /* unknown agent - assume non-ACP, fall through to static */
    acpCompatible = false;
  }

  let session: IAgentSession | undefined;
  if (acpCompatible) {
    try {
      session = await withTimeout(agents.session(agent), PROBE_TIMEOUT_MS, agent);
    } catch {
      /* session unavailable - resolveModels will fall through */
    }
  }
  try {
    return await resolveModels(agent, session ? { session } : {});
  } finally {
    if (session) {
      // Closing a hung session can also block. Don't await longer
      // than the probe itself - kill the close after a beat.
      await Promise.race([
        session.close().catch(() => {}),
        new Promise<void>((r) => setTimeout(r, 1_000)),
      ]);
    }
  }
};

/** Fire-and-cache resolution. Cached after first success per agent. */
export const loadAgentConfig = async (agent: TAgentId): Promise<IResolvedModels> => {
  const cached = cache.get(agent);
  if (cached !== undefined) {
    return cached;
  }
  const pending = inFlight.get(agent);
  if (pending !== undefined) {
    return pending;
  }
  const lookup = (async (): Promise<IResolvedModels> => {
    const result = await probe(agent);
    cache.set(agent, result);
    inFlight.delete(agent);
    return result;
  })();
  inFlight.set(agent, lookup);
  return lookup;
};

/** Synchronous read for instant render. Returns the cached resolved snapshot if any, otherwise the static catalog placeholder. */
export const agentConfigSnapshot = (agent: TAgentId): IResolvedModels => {
  const cached = cache.get(agent);
  if (cached !== undefined) {
    return cached;
  }
  let staticModels: readonly IModelInfo[] = [];
  try {
    staticModels = definitionFor(agent).models ?? [];
  } catch {
    staticModels = [];
  }
  return {
    source: staticModels.length > 0 ? "static" : "none",
    models: staticModels,
  };
};

/** Drop the cached probe for an agent so the next picker open re-resolves. Bound to `r` in the agent picker. */
export const refreshAgentConfig = (agent: TAgentId): void => {
  cache.delete(agent);
  inFlight.delete(agent);
};

/**
 * Kick off `loadAgentConfig` for each agent and await all of them.
 * Idempotent (joins existing in-flight promises per agent), failures
 * are swallowed per-agent so a single broken probe doesn't block the
 * rest. Caller passes the subset of agents that detection reports as
 * installed.
 */
export const preloadAgentConfigs = async (agentIds: readonly TAgentId[]): Promise<void> => {
  await Promise.allSettled(
    agentIds.map((id) => {
      if (cache.has(id)) {
        return Promise.resolve();
      }
      return loadAgentConfig(id);
    }),
  );
};

export const modelsForAgent = (agent: TAgentId): readonly IModelInfo[] => agentConfigSnapshot(agent).models;

export const findModel = (agent: TAgentId, id: string | undefined): IModelInfo | undefined => {
  if (id === undefined) {
    return undefined;
  }
  return modelsForAgent(agent).find((m) => m.id === id);
};

export const supportsEnumEffort = (model: IModelInfo): boolean => model.effort?.kind === "enum";

export const hasEnumEffortAnywhere = (agent: TAgentId): boolean =>
  agentConfigSnapshot(agent).models.some((m) => m.effort?.kind === "enum");

export const effortConfigIdForAgent = (agent: TAgentId): string | undefined => agentConfigSnapshot(agent).effortConfigId;

export const modelConfigIdForAgent = (agent: TAgentId): string | undefined => agentConfigSnapshot(agent).modelConfigId;

export const sourceForAgent = (agent: TAgentId): TModelSource => agentConfigSnapshot(agent).source;

/**
 * True iff the agent's catalog entry advertises ACP support. Defaults
 * to true. The picker uses this to differentiate "we couldn't reach
 * the agent because auth is missing" (auth hint) from "this CLI
 * doesn't speak ACP" (different message), since those failure modes
 * deserve different guidance.
 */
export const isAcpCompatible = (agent: TAgentId): boolean => {
  try {
    return definitionFor(agent).acpCompatible !== false;
  } catch {
    return true;
  }
};

/**
 * Some agents (notably Claude via configOptions) report rows with
 * generic labels like `"Default (recommended)"` and stash the actual
 * model name in the description. This helper promotes the first
 * description segment to the primary label so the picker reads the
 * meaningful name first. See header in agent-picker / model-picker.
 */
export const prettyModel = (model: IModelInfo): { readonly label: string; readonly description: string } => {
  const rawLabel = model.label;
  const rawDesc = model.description ?? "";
  if (rawDesc.length === 0) {
    return { label: rawLabel, description: "" };
  }
  const segments = rawDesc.split(" · ");
  const head = segments[0]?.trim() ?? "";
  if (head.length === 0) {
    return { label: rawLabel, description: rawDesc };
  }
  const rest = segments.slice(1).join(" · ");
  const headLower = head.toLowerCase();
  const labelLower = rawLabel.toLowerCase();
  const labelEmbedded = headLower.startsWith(labelLower) || headLower.includes(labelLower);
  if (labelEmbedded) {
    return { label: head, description: rest };
  }
  const description = rest.length > 0 ? `${rawLabel} · ${rest}` : rawLabel;
  return { label: head, description };
};
