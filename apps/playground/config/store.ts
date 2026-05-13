import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TAgentId, TPermissionPolicy } from "@pivanov/agents-wire";
import type { TPlaygroundMode } from "@app/commands/types";
import type { TThemeId } from "@app/theme/palette";

const CONFIG_DIR = path.join(os.homedir(), ".agents-wire");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const CONFIG_LOCK_DIR = `${CONFIG_PATH}.lock`;
const CONFIG_LOCK_TIMEOUT_MS = 2_000;
const CONFIG_LOCK_STALE_MS = 30_000;
const CONFIG_LOCK_RETRY_MS = 10;

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

const sleepSync = (ms: number): void => {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
};

const errnoCode = (cause: unknown): string | undefined => {
  return cause instanceof Error && "code" in cause ? String((cause as NodeJS.ErrnoException).code) : undefined;
};

const removeStaleLock = (): boolean => {
  try {
    const stat = fs.statSync(CONFIG_LOCK_DIR);
    if (Date.now() - stat.mtimeMs < CONFIG_LOCK_STALE_MS) {
      return false;
    }
    fs.rmSync(CONFIG_LOCK_DIR, { recursive: true, force: true });
    return true;
  } catch (cause) {
    return errnoCode(cause) === "ENOENT";
  }
};

const acquireConfigLock = (): (() => void) | undefined => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      fs.mkdirSync(CONFIG_LOCK_DIR);
      return () => fs.rmSync(CONFIG_LOCK_DIR, { recursive: true, force: true });
    } catch (cause) {
      const code = errnoCode(cause);
      if (code !== "EEXIST") {
        throw cause;
      }
      if (removeStaleLock()) {
        continue;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= CONFIG_LOCK_TIMEOUT_MS) {
        return undefined;
      }
      sleepSync(Math.min(CONFIG_LOCK_RETRY_MS, CONFIG_LOCK_TIMEOUT_MS - elapsed));
    }
  }
};

const writeConfigUnlocked = (config: IPersistedConfig): void => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmpPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    fs.renameSync(tmpPath, CONFIG_PATH);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
};

const updateConfig = (mutate: (current: IPersistedConfig) => IPersistedConfig): void => {
  try {
    const release = acquireConfigLock();
    if (!release) {
      return;
    }
    try {
      writeConfigUnlocked(mutate(readConfig()));
    } finally {
      release();
    }
  } catch {
    // Persistence failures are non-fatal - playground stays usable.
  }
};

export const loadConfig = (): IPersistedConfig => readConfig();

export const saveConfig = (patch: IPersistedConfig): void => {
  updateConfig((cur) => ({
    ...cur,
    ...patch,
    // Merge per-agent maps without dropping previously-saved agents that
    // weren't in this patch.
    ...(patch.modelByAgent !== undefined ? { modelByAgent: { ...(cur.modelByAgent ?? {}), ...patch.modelByAgent } } : {}),
    ...(patch.effortByAgent !== undefined ? { effortByAgent: { ...(cur.effortByAgent ?? {}), ...patch.effortByAgent } } : {}),
  }));
};

export const setStoredModel = (agent: TAgentId, model: string | undefined): void => {
  updateConfig((cfg) => {
    const map = { ...(cfg.modelByAgent ?? {}) };
    if (model === undefined) {
      delete map[agent];
    } else {
      map[agent] = model;
    }
    return { ...cfg, modelByAgent: map };
  });
};

export const setStoredEffort = (agent: TAgentId, effort: string | undefined): void => {
  updateConfig((cfg) => {
    const map = { ...(cfg.effortByAgent ?? {}) };
    if (effort === undefined) {
      delete map[agent];
    } else {
      map[agent] = effort;
    }
    return { ...cfg, effortByAgent: map };
  });
};

export const getStoredModel = (agent: TAgentId): string | undefined => readConfig().modelByAgent?.[agent];
export const getStoredEffort = (agent: TAgentId): string | undefined => readConfig().effortByAgent?.[agent];

export const isPermissionSerializable = (p: TPermissionPolicy): boolean => typeof p === "string";
