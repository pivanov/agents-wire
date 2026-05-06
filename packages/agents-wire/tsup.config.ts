import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

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
  // Polyfill `import.meta.url` in CJS via __filename so resolve-package's
  // createRequire(import.meta.url) works under both formats.
  shims: true,
  // Replace __PKG_VERSION__ at build time so PACKAGE_VERSION in the bundle
  // can never drift from package.json#version (used in ACP clientInfo).
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
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
