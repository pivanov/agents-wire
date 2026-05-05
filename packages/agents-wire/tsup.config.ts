import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/errors.ts",
    "src/cli.ts",
    "src/ai-sdk/index.ts",
    "src/testing/index.ts",
    "src/catalog/index.ts",
    "src/orchestrate/index.ts",
  ],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  target: "node22",
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  external: [
    "@agentclientprotocol/sdk",
    "@agentclientprotocol/claude-agent-acp",
    "@zed-industries/codex-acp",
    "@ai-sdk/provider",
    "ai",
    "zod",
  ],
  banner({ format }) {
    return format === "esm" || format === "cjs"
      ? { js: "" }
      : {};
  },
});
