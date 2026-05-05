import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const cline: IAgentDefinition = {
  id: "cline",
  label: "Cline",
  transport: "native-acp",
  homepage: "https://cline.bot",
  installNotice: "Install Cline with `npm install -g cline`, then run `cline auth` (cline.bot OAuth) or set provider keys via `cline config`.",
  authFailurePatterns: ["cline account connection failure", "401 unauthorized", "unauthorized"],
  // Cold-start placeholder. Cline is provider-agnostic (30+ providers,
  // BYOK or cline.bot subscription); the real model menu is whatever
  // each configured provider exposes. No `cline models` subcommand
  // documented, so resolveModels falls back to "Default" pre-init and
  // upgrades from session.configOptions if Cline declares them.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    return {
      command: options.binaryOverride ?? "cline",
      args: ["--acp"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("cline"),
};
