import { listAuggieModels } from "@/internal/list-models";
import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const auggie: IAgentDefinition = {
  id: "auggie",
  label: "Augment Code (Auggie)",
  transport: "native-acp",
  homepage: "https://www.augmentcode.com",
  installNotice: "Install Auggie with `npm install -g @augmentcode/auggie`, then run `auggie login` (subscription required).",
  authFailurePatterns: ["not currently logged in", "auggie login", "unauthorized"],
  // Cold-start placeholder. Real list comes from `auggie model list` once
  // the user is logged in. Auggie's CLI gates the model list behind auth,
  // so logged-out users see only "Default" until they sign in.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    return {
      command: options.binaryOverride ?? "auggie",
      args: ["--acp"],
      // Auggie checks for self-update on every spawn, which can stall the
      // ACP handshake. Disable it; users update via `npm update -g` instead.
      env: { ...options.env, AUGMENT_DISABLE_AUTO_UPDATE: "1" },
    };
  },
  probe: () => probeBinaryVersion("auggie"),
  listAvailableModels: () => listAuggieModels(),
};
