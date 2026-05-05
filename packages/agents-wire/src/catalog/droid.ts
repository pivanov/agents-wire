import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const droid: IAgentDefinition = {
  id: "droid",
  label: "Factory Droid",
  transport: "native-acp",
  homepage: "https://app.factory.ai",
  installNotice: "Install Factory Droid with `npm install -g droid`, then set FACTORY_API_KEY (get one at app.factory.ai/settings/api-keys).",
  authFailurePatterns: ["FACTORY_API_KEY", "factory api key", "unauthorized", "authentication failed"],
  // Cold-start placeholder. Factory Droid requires FACTORY_API_KEY
  // before responding. Pre-auth users see "Default" only; post-auth,
  // `resolveModels` upgrades from session.configOptions / modelPreference.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    return {
      command: options.binaryOverride ?? "droid",
      args: ["exec", "--output-format", "acp"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("droid"),
};
