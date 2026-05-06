import { existsSync } from "node:fs";
import { join } from "node:path";
import { listCursorModels } from "@/internal/list-models";
import { agentHome, HOME } from "@/internal/paths";
import { probeBinaryVersion } from "@/internal/probe";
import type { IAgentDefinition } from "@/types/agent";

export const cursor: IAgentDefinition = {
  id: "cursor",
  label: "Cursor Agent",
  transport: "native-acp",
  homepage: "https://cursor.com/docs/cli/acp",
  installNotice: "Install the Cursor Agent CLI from https://cursor.com/docs/cli/acp, then run `agent login`.",
  authFailurePatterns: ["not logged in", "agent login", "unauthorized", "authentication required"],
  // Cold-start placeholder. Cursor's effort axis is variant-based
  // (effort baked into the model id, e.g. `gpt-5.3-codex-high` vs
  // `-extra-high`). The live list comes from `listAvailableModels()`
  // and resolveModels tags each entry with `effort: { kind: "variant" }`
  // so no separate effort UI renders.
  models: [{ id: "default", label: "Default" }],
  launch(options = {}) {
    // `cursor-agent acp` rejects --model (verified via --help). Model selection
    // would have to flow through ACP modelPreference if Cursor implements it.
    return {
      command: options.binaryOverride ?? "agent",
      args: ["acp"],
      ...(options.env ? { env: options.env } : {}),
    };
  },
  // Filter the false-positive where any binary called `agent` on PATH
  // (unrelated tool, leftover symlink, etc.) makes detection report
  // cursor as installed. Cursor only reports available when its config
  // dir actually exists.
  quickCheck: () => existsSync(agentHome("cursor")),
  legacyDirs: [join(HOME, ".cursor-agent")],
  aliases: ["cursor-agent"],
  probe: () => probeBinaryVersion("agent"),
  listAvailableModels: () => listCursorModels(),
};
