import { probeNodeBridge } from "@/internal/probe";
import { resolvePackageEntry } from "@/internal/resolve-package";
import type { IAgentDefinition } from "@/types/agent";

const BRIDGE_ENTRY = "@agentclientprotocol/claude-agent-acp/dist/index.js";

export const claude: IAgentDefinition = {
  id: "claude",
  label: "Claude Code",
  transport: "node-bridge",
  homepage: "https://docs.claude.com/en/docs/claude-code",
  installNotice:
    "Install Claude Code from https://docs.claude.com/en/docs/claude-code/setup, then sign in with `claude /login` or set ANTHROPIC_API_KEY.",
  authFailurePatterns: ["please run `claude login`", "please run `claude /login`", "invalid api key", "session expired"],
  // Cold-start placeholder. Real list comes from session.configOptions
  // post-init (claude-agent-acp populates Mode + Model + thought_level
  // selectors at newSession time, no auth required). See `resolveModels`.
  models: [{ id: "default", label: "Default" }],
  aliases: ["claude-code", "claude-agent"],
  nativeSystemPrompt: true,
  launch(options = {}) {
    const entry = options.binaryOverride ?? resolvePackageEntry(BRIDGE_ENTRY);
    return {
      command: process.execPath,
      args: [entry],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeNodeBridge(BRIDGE_ENTRY, "claude"),
};
