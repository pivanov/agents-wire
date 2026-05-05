import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const qwen: IAgentDefinition = {
  id: "qwen",
  label: "Qwen Code",
  transport: "native-acp",
  homepage: "https://github.com/QwenLM/qwen-code",
  installNotice:
    "Install Qwen Code with `npm install -g @qwen-code/qwen-code`, then run `qwen auth qwen-oauth` (free tier, 100 req/day) or set `BAILIAN_CODING_PLAN_API_KEY`.",
  authFailurePatterns: ["qwen oauth", "discontinued", "/auth"],
  // Cold-start placeholder. Qwen Code accepts BYOK across multiple
  // providers and exposes models via the in-session `/model` command;
  // no CLI `--list-models` flag found. resolveModels falls back to
  // "Default" and upgrades from session.configOptions where exposed.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    return {
      command: options.binaryOverride ?? "qwen",
      // Both flags required per the ACP agent registry. --experimental-skills
      // unlocks tool execution; without it Qwen runs in a chat-only mode.
      args: ["--acp", "--experimental-skills"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("qwen"),
};
