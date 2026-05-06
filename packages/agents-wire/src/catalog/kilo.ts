import { listKiloModels } from "@/internal/list-models";
import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const kilo: IAgentDefinition = {
  id: "kilo",
  label: "Kilo",
  transport: "native-acp",
  homepage: "https://kilocode.ai",
  installNotice: "Install Kilo with `npm install -g @kilocode/cli`, then run `kilo auth login --provider <id>` or set `KILO_API_KEY`.",
  authFailurePatterns: ["KILO_API_KEY", "kilo auth login", "unauthorized", "invalid api key"],
  // Cold-start placeholder. Kilo proxies 500+ models via models.dev at
  // runtime; live list comes from `kilo models` (handled by
  // `listKiloModels`). resolveModels parses provider/model rows and
  // tags effort by what each upstream model declares.
  models: [{ id: "default", label: "Default" }],
  aliases: ["kilo-cli", "kilocode"],
  launch(options = {}) {
    return {
      command: options.binaryOverride ?? "kilo",
      args: ["acp"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("kilo"),
  listAvailableModels: () => listKiloModels(),
};
