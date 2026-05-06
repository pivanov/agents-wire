import { existsSync } from "node:fs";
import { listOpencodeModels } from "@/internal/list-models";
import { agentHome } from "@/internal/paths";
import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const opencode: IAgentDefinition = {
  id: "opencode",
  label: "OpenCode",
  transport: "native-acp",
  homepage: "https://opencode.ai",
  installNotice: "Install OpenCode with `npm install -g opencode-ai`, then run `opencode auth login`.",
  authFailurePatterns: ["unauthorized", "not logged in", "auth login", "invalid api key"],
  // Cold-start placeholder. OpenCode's `acp` mode doesn't expose
  // configOptions; live list comes from `listAvailableModels()`
  // (CLI introspection via `opencode models`). resolveModels tags
  // entries with `effort: { kind: "none" }` since OpenCode doesn't
  // expose a reasoning-effort knob.
  models: [{ id: "default", label: "Default" }],
  quickCheck: () => existsSync(agentHome("opencode")),
  launch(options = {}) {
    // `opencode acp` does not advertise --model (verified via --help). Model
    // selection flows through ACP modelPreference if OpenCode implements it.
    return {
      command: options.binaryOverride ?? "opencode",
      args: ["acp"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("opencode"),
  listAvailableModels: () => listOpencodeModels(),
};
