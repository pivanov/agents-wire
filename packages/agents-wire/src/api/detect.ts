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

const runProbe = (definition: IAgentDefinition): Promise<IProbeOutcome> => {
  if (definition.probe) {
    return definition.probe();
  }
  return fallbackProbe(definition);
};

export const detectAvailableAgents = async (): Promise<readonly IDetectionEntry[]> => {
  const definitions = listDefinitions();
  const probed = await Promise.all(
    definitions.map(async (definition) => {
      const outcome = await runProbe(definition);
      const entry: IDetectionEntry =
        outcome.reason !== undefined
          ? { id: definition.id, label: definition.label, available: outcome.available, reason: outcome.reason }
          : { id: definition.id, label: definition.label, available: outcome.available };
      return entry;
    }),
  );
  return probed;
};
