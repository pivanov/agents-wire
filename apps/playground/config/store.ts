import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TAgentId, TPermissionPolicy } from "@pivanov/agents-wire";
import type { TPlaygroundMode } from "@app/commands/types";
import type { TThemeId } from "@app/theme/palette";

const CONFIG_DIR = path.join(os.homedir(), ".agents-wire");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export interface IPersistedConfig {
  readonly theme?: TThemeId;
  readonly agent?: TAgentId;
  readonly mode?: TPlaygroundMode;
  readonly permission?: string;
  readonly budget?: number | "off";
  readonly mock?: boolean;
  readonly modelByAgent?: Readonly<Record<string, string>>;
  readonly effortByAgent?: Readonly<Record<string, string>>;
  // Recently-shown mascot variant indices. Append-only ring buffer (last
  // N entries kept). Used to avoid repeating the same owl across launches.
  readonly mascotHistory?: readonly number[];
  // Mascot gradient angle in degrees. Rotated by +90 on every session
  // start so successive launches show the same owl with a different
  // gradient direction (top→bottom, left→right, bottom→top, right→left).
  readonly mascotGradientAngle?: number;
}

const readConfig = (): IPersistedConfig => {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as IPersistedConfig;
    }
    return {};
  } catch {
    return {};
  }
};

const writeConfig = (config: IPersistedConfig): void => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  } catch {
    // Persistence failures are non-fatal - playground stays usable.
  }
};

export const loadConfig = (): IPersistedConfig => readConfig();

export const saveConfig = (patch: IPersistedConfig): void => {
  const cur = readConfig();
  const merged: IPersistedConfig = {
    ...cur,
    ...patch,
    // Merge per-agent maps without dropping previously-saved agents that
    // weren't in this patch.
    ...(patch.modelByAgent !== undefined ? { modelByAgent: { ...(cur.modelByAgent ?? {}), ...patch.modelByAgent } } : {}),
    ...(patch.effortByAgent !== undefined ? { effortByAgent: { ...(cur.effortByAgent ?? {}), ...patch.effortByAgent } } : {}),
  };
  writeConfig(merged);
};

export const setStoredModel = (agent: TAgentId, model: string | undefined): void => {
  const cfg = readConfig();
  const map = { ...(cfg.modelByAgent ?? {}) };
  if (model === undefined) {
    delete map[agent];
  } else {
    map[agent] = model;
  }
  writeConfig({ ...cfg, modelByAgent: map });
};

export const setStoredEffort = (agent: TAgentId, effort: string | undefined): void => {
  const cfg = readConfig();
  const map = { ...(cfg.effortByAgent ?? {}) };
  if (effort === undefined) {
    delete map[agent];
  } else {
    map[agent] = effort;
  }
  writeConfig({ ...cfg, effortByAgent: map });
};

export const getStoredModel = (agent: TAgentId): string | undefined => readConfig().modelByAgent?.[agent];
export const getStoredEffort = (agent: TAgentId): string | undefined => readConfig().effortByAgent?.[agent];

export const isPermissionSerializable = (p: TPermissionPolicy): boolean => typeof p === "string";
