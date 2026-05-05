import { probeBinaryVersion, probePeerBridge } from "@/internal/probe";
import { resolvePackageBin } from "@/internal/resolve-package";
import { whichBin } from "@/internal/which-bin";
import type { IAgentDefinition } from "@/types/agent";

const BIN_PACKAGE = "@github/copilot";
const BIN_NAME = "copilot";

export const copilot: IAgentDefinition = {
  id: "copilot",
  label: "GitHub Copilot",
  transport: "node-bridge",
  homepage: "https://docs.github.com/copilot/concepts/agents/about-copilot-cli",
  installNotice: "Install the Copilot CLI with `npm install -g @github/copilot`, then sign in via `gh auth login` or set GITHUB_TOKEN.",
  authFailurePatterns: ["gh auth login", "unauthorized"],
  // Cold-start placeholder. @github/copilot --acp populates
  // configOptions (Mode + Model + Reasoning Effort + Permissions)
  // at newSession time without auth. Real list arrives via
  // `resolveModels` immediately after init.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    if (options.binaryOverride) {
      return {
        command: options.binaryOverride,
        args: ["--acp"],
        ...(options.env ? { env: options.env } : {}),
      };
    }
    // @github/copilot --acp does not advertise --model. Model selection (when
    // Copilot supports it) flows through ACP modelPreference.
    try {
      const entry = resolvePackageBin(BIN_PACKAGE);
      return {
        command: process.execPath,
        args: [entry, "--acp"],
        ...(options.env ? { env: options.env } : {}),
      };
    } catch (cause) {
      // resolvePackageBin already walks `npm root -g` + conventional system
      // paths; this fallback covers pnpm / bun / Volta / fnm / asdf global
      // installs that drop a bin shim on PATH but store the package itself
      // in a private root we can't enumerate. The shim re-execs node with
      // the right entry, so we spawn it directly.
      const onPath = whichBin(BIN_NAME);
      if (!onPath) {
        throw cause;
      }
      return {
        command: onPath,
        args: ["--acp"],
        ...(options.env ? { env: options.env } : {}),
      };
    }
  },
  probe: async () => {
    const peer = await probePeerBridge(BIN_PACKAGE);
    if (peer.available) {
      return peer;
    }
    return probeBinaryVersion(BIN_NAME);
  },
};
