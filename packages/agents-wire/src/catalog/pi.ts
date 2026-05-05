import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

/**
 * Pi (v0.73, @mariozechner/pi-coding-agent) does NOT implement the
 * Agent Client Protocol as of 2026-05-05. Its `--mode rpc` is a
 * Pi-specific JSON-RPC dialect that does not respond to ACP's
 * `initialize` (returns `{"type":"response","success":false,
 * "error":"Unknown command: undefined"}`). The catalog entry is
 * preserved so detection still surfaces "pi is installed" in the
 * agent picker, but live model resolution will fail and the picker
 * will show the static "Default" placeholder. To use Pi, run it
 * directly with `pi` (outside agents-wire).
 *
 * If Pi adds ACP support in a future release, swap the launch args
 * accordingly and remove this notice.
 */
export const pi: IAgentDefinition = {
  id: "pi",
  label: "Pi",
  transport: "native-acp",
  // Pi's `--mode rpc` is NOT ACP-compatible (see header comment).
  // resolveModels skips the session probe and the playground's
  // preload skips the spawn entirely, avoiding "Invalid message"
  // log spam from the ACP stream parser.
  acpCompatible: false,
  homepage: "https://github.com/mariozechner/pi-coding-agent",
  installNotice:
    "Install Pi with `npm install -g @mariozechner/pi-coding-agent`. Note: Pi v0.73 does not implement ACP, so model selection from this picker will not take effect.",
  // Cold-start placeholder. Pi never advances past this because its
  // RPC mode isn't ACP-compatible (see header doc).
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    // `--mode rpc` is the closest thing Pi has to a programmatic
    // interface. It speaks Pi's own JSON dialect, not ACP, so the
    // host's initialize handshake will fail. Documented above.
    return {
      command: options.binaryOverride ?? "pi",
      args: ["--mode", "rpc"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  probe: () => probeBinaryVersion("pi"),
};
