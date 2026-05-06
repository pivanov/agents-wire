import { existsSync } from "node:fs";
import { agentHome } from "@/internal/paths";
import { probeNodeBridge } from "@/internal/probe";
import { resolvePackageEntry } from "@/internal/resolve-package";
import type { IAgentDefinition } from "@/types/agent";

const BRIDGE_ENTRY = "@zed-industries/codex-acp/bin/codex-acp.js";

// Argv-injection guard for values interpolated into codex-acp's TOML-quoted -c flag.
const SAFE_CONFIG_VALUE = /^[A-Za-z0-9._:-]+$/;

export const codex: IAgentDefinition = {
  id: "codex",
  label: "Codex",
  transport: "node-bridge",
  homepage: "https://github.com/zed-industries/codex-acp",
  installNotice: "Codex bridge must be reachable via the bundled @zed-industries/codex-acp. See https://github.com/zed-industries/codex-acp.",
  authFailurePatterns: ["OPENAI_API_KEY", "invalid api key", "incorrect api key"],
  // Cold-start placeholder. codex-acp populates configOptions
  // (Mode + Model selectors) at newSession time without auth - real
  // model list arrives via `resolveModels` immediately after init.
  // Per-model reasoning effort still flows through launch flags
  // (-c model_reasoning_effort) regardless of which model is chosen.
  models: [{ id: "default", label: "Default" }],
  // L2 fix: dropped "gpt-5" — too ambiguous (other agents can also serve
  // gpt-5 via routing). Vendor-named aliases only.
  aliases: ["openai-codex", "openai"],
  quickCheck: () => existsSync(agentHome("codex", "CODEX_HOME")),
  launch(options = {}) {
    const entry = options.binaryOverride ?? resolvePackageEntry(BRIDGE_ENTRY);
    const args = [entry];
    // codex-acp accepts `-c key=value` config overrides (TOML-quoted values); --model is on the raw CLI, not this bridge.
    if (options.model) {
      if (!SAFE_CONFIG_VALUE.test(options.model)) {
        throw new Error(`codex: refusing model id with unsafe characters: ${JSON.stringify(options.model)}`);
      }
      args.push("-c", `model="${options.model}"`);
    }
    if (options.effort) {
      if (!SAFE_CONFIG_VALUE.test(options.effort)) {
        throw new Error(`codex: refusing effort value with unsafe characters: ${JSON.stringify(options.effort)}`);
      }
      args.push("-c", `model_reasoning_effort="${options.effort}"`);
    }
    return {
      command: process.execPath,
      args,
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeNodeBridge(BRIDGE_ENTRY, "codex"),
};
