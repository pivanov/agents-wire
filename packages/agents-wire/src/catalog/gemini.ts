import { probeBinaryVersion, probePeerBridge } from "@/internal/probe";
import { resolvePackageBin } from "@/internal/resolve-package";
import { whichBin } from "@/internal/which-bin";
import type { IAgentDefinition } from "@/types/agent";

const BIN_PACKAGE = "@google/gemini-cli";
const BIN_NAME = "gemini";

export const gemini: IAgentDefinition = {
  id: "gemini",
  label: "Gemini CLI",
  transport: "node-bridge",
  homepage: "https://github.com/google-gemini/gemini-cli",
  installNotice: "Install the Gemini CLI with `npm install -g @google/gemini-cli`, then run `gemini auth login` or set GEMINI_API_KEY.",
  authFailurePatterns: ["GEMINI_API_KEY", "authentication failed", "failed to authenticate"],
  // Cold-start placeholder. Gemini CLI requires GEMINI_API_KEY before
  // newSession returns configOptions. Pre-auth users see "Default"
  // only; post-auth, `resolveModels` upgrades to the real list.
  models: [{ id: "default", label: "Default" }],
  aliases: ["gemini-cli", "google-gemini"],
  launch(options = {}) {
    if (options.binaryOverride) {
      return {
        command: options.binaryOverride,
        args: ["--acp"],
        ...(options.env ? { env: options.env } : {}),
      };
    }
    // Gemini CLI's `--acp` mode does not accept a `--model` flag (probed via --help).
    // Model selection flows through ACP modelPreference (best-effort) instead.
    try {
      const entry = resolvePackageBin(BIN_PACKAGE);
      return {
        command: process.execPath,
        args: [entry, "--acp"],
        ...(options.env ? { env: options.env } : {}),
      };
    } catch (cause) {
      // Same fallback as copilot: pnpm / bun / Volta / fnm / asdf put a
      // bin shim on PATH but use a private global root we can't enumerate.
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
