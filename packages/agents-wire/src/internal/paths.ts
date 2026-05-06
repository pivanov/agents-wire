import { homedir, platform } from "node:os";
import { join } from "node:path";

// Centralized home / config-dir resolution. Catalog `quickCheck` hooks
// route through here so a future cross-platform / env-override
// adjustment lands in one place. Pure helpers; no side effects.

export const HOME = homedir();

/**
 * @public
 * Resolve the user's XDG-style config root. Honors `XDG_CONFIG_HOME`,
 * falls back to `LOCALAPPDATA` on Windows, then `~/.config`. Exported as
 * forward-compat infra for catalog `quickCheck` callers that need the
 * cross-platform variant rather than `agentHome()`.
 */
export const xdgConfigHome = (): string => {
  const explicit = process.env.XDG_CONFIG_HOME?.trim();
  if (explicit) {
    return explicit;
  }
  if (platform() === "win32") {
    const appData = process.env.LOCALAPPDATA?.trim();
    if (appData) {
      return appData;
    }
  }
  return join(HOME, ".config");
};

/**
 * Resolve an agent's expected config dir. If `envVar` is set in the
 * environment its value wins (e.g. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
 * Otherwise returns `~/.<agent>`.
 */
export const agentHome = (agent: string, envVar?: string): string => {
  const override = envVar ? process.env[envVar]?.trim() : undefined;
  if (override) {
    return override;
  }
  return join(HOME, `.${agent}`);
};
