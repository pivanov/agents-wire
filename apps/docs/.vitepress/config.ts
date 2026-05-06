import { defineConfig } from "vitepress";
import type { HeadConfig } from "vitepress";

const SITE_URL = "https://agents-wire.dev";
const OG_IMAGE = `${SITE_URL}/og.png`;
const SITE_TITLE = "www.agents-wire.dev";
const SITE_DESCRIPTION = "One SDK for every coding agent. Same call, any agent.";

export default defineConfig({
  title: SITE_TITLE,
  description: "One TypeScript SDK for every local coding agent. Spawn, stream, control 12 agents through one API.",
  base: "/",

  head: [
    // Favicon: a stylised owl face matching the playground mascot,
    // painted with the same five-stop palette. SVG works on every
    // modern browser; the apple-touch-icon entry covers iOS bookmarks
    // (Safari on iOS pulls a PNG-sized representation from the SVG).
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["link", { rel: "apple-touch-icon", href: "/favicon.svg" }],
    ["link", { rel: "mask-icon", href: "/favicon.svg", color: "#a855f7" }],
    ["meta", { name: "theme-color", content: "#181825" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "agents-wire, acp, agent-client-protocol, claude, codex, cursor, copilot, gemini, opencode, droid, pi, cline, kilo, qwen, auggie, typescript, sdk, streaming, multi-agent, orchestration, vercel-ai-sdk",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: SITE_TITLE }],
    ["meta", { name: "twitter:description", content: SITE_DESCRIPTION }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
  ],

  transformPageData(pageData) {
    const title = pageData.title ? `${pageData.title} · ${SITE_TITLE}` : SITE_TITLE;
    const description = pageData.description || SITE_DESCRIPTION;
    pageData.frontmatter.head ??= [] as HeadConfig[];
    (pageData.frontmatter.head as HeadConfig[]).push(
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    );
  },

  markdown: {
    theme: {
      light: "one-dark-pro",
      dark: "one-dark-pro",
    },
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "API", link: "/api/index" },
      { text: "Agents", link: "/agents/index" },
      { text: "Orchestration", link: "/guides/orchestration" },
      { text: "npm", link: "https://www.npmjs.com/package/@pivanov/agents-wire" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why agents-wire", link: "/why" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Agents",
        items: [
          { text: "Overview", link: "/agents/index" },
          { text: "Claude", link: "/agents/claude" },
          { text: "Codex", link: "/agents/codex" },
          { text: "Cursor", link: "/agents/cursor" },
          { text: "Copilot", link: "/agents/copilot" },
          { text: "Gemini", link: "/agents/gemini" },
          { text: "OpenCode", link: "/agents/opencode" },
          { text: "Droid", link: "/agents/droid" },
          { text: "Pi", link: "/agents/pi" },
          { text: "Cline", link: "/agents/cline" },
          { text: "Kilo", link: "/agents/kilo" },
          { text: "Qwen", link: "/agents/qwen" },
          { text: "Auggie", link: "/agents/auggie" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "Overview", link: "/api/index" },
          { text: "Client", link: "/api/client" },
          { text: "Session", link: "/api/session" },
          { text: "Stream", link: "/api/stream" },
          { text: "Events", link: "/api/events" },
          { text: "JSON (askJson)", link: "/api/json" },
          { text: "Capabilities", link: "/api/capabilities" },
          { text: "Errors", link: "/api/errors" },
          { text: "Subpath Exports", link: "/api/subpaths" },
          { text: "Testing", link: "/api/testing" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Orchestration", link: "/guides/orchestration" },
          { text: "Vercel AI SDK", link: "/guides/ai-sdk" },
          { text: "CLI", link: "/guides/cli" },
          { text: "Tool Handling", link: "/guides/tool-handling" },
          { text: "Cost Tracking", link: "/guides/cost-tracking" },
          { text: "Examples", link: "/guides/examples" },
        ],
      },
      {
        text: "Protocol",
        items: [{ text: "ACP", link: "/protocol/acp" }],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/pivanov/agents-wire" }],

    search: {
      provider: "local",
    },
  },
});
