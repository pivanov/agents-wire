import { existsSync } from "node:fs";
import { listDefinitions } from "@/catalog/index";
import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition, IProbeOutcome, TAgentId } from "@/types/agent";

export interface IDetectionEntry {
  readonly id: TAgentId;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
}

const fallbackProbe = async (definition: IAgentDefinition): Promise<IProbeOutcome> => {
  let spec: ReturnType<IAgentDefinition["launch"]>;
  try {
    spec = definition.launch();
  } catch (cause) {
    return { available: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
  return probeBinaryVersion(spec.command);
};

const runProbe = async (definition: IAgentDefinition): Promise<IProbeOutcome> => {
  // Optional cheap pre-filter — skips the subprocess-spawning probe when
  // the agent's config dirs aren't present. Falls through to legacyDirs
  // for renamed-product graveyard entries before declaring unavailable.
  if (definition.quickCheck && !definition.quickCheck()) {
    const legacyHit = definition.legacyDirs?.some((dir) => existsSync(dir));
    if (!legacyHit) {
      return { available: false, reason: "no config directory found" };
    }
  }
  if (definition.probe) {
    return definition.probe();
  }
  return fallbackProbe(definition);
};

export const detectAvailableAgents = async (): Promise<readonly IDetectionEntry[]> => {
  const definitions = listDefinitions();
  const probed = await Promise.all(
    definitions.map(async (definition) => {
      let outcome: IProbeOutcome;
      try {
        outcome = await runProbe(definition);
      } catch (cause) {
        outcome = { available: false, reason: cause instanceof Error ? cause.message : String(cause) };
      }
      const entry: IDetectionEntry =
        outcome.reason !== undefined
          ? { id: definition.id, label: definition.label, available: outcome.available, reason: outcome.reason }
          : { id: definition.id, label: definition.label, available: outcome.available };
      return entry;
    }),
  );
  return probed;
};
