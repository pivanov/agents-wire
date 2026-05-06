import { homedir } from "node:os";
import { join } from "node:path";

// Centralized home / config-dir resolution. Catalog `quickCheck` hooks
// route through here so a future cross-platform / env-override
// adjustment lands in one place. Pure helpers; no side effects.

export const HOME = homedir();

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
