---
layout: home
hero:
  name: "@pivanov/agents-wire"
  text: One SDK for every coding agent
  tagline: Spawn, stream, and control 12 local coding agents - Claude, Codex, Cursor, Copilot, Gemini, OpenCode, Droid, Pi, Cline, Kilo, Qwen, Auggie - through one TypeScript API.
  image:
    light: /hero-code.svg
    dark: /hero-code.svg
    alt: Animated agents-wire usage example
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/pivanov/agents-wire
features:
  - title: 12 agents, one API
    details: Same ask / stream / session surface across Claude, Codex, Cursor, Copilot, Gemini, OpenCode, Droid, Pi, Cline, Kilo, Qwen, and Auggie.
  - title: Tool policy + permissions
    details: Centralized tool policy pipeline (allowed / blocked / onToolUse) plus permission modes from auto-allow to human-in-the-loop stream.
  - title: Multi-agent orchestration
    details: Failover, race, cascade, and warm pool primitives for resilient agent workflows.
  - title: Vercel AI SDK provider
    details: Drop-in LanguageModelV3 adapter for generateText, streamText, and useChat.
  - title: Structured JSON output
    details: askJson(prompt, schema) with Zod, Valibot, or ArkType via Standard Schema - validated, typed, fence-stripped.
  - title: Usage tracking + safeguards
    details: "Unified usage telemetry across agents: per-turn cost where available, turn-count tracking for subscription agents, plus budget/callback guardrails."
  - title: Resilience by default
    details: Auto-respawn, session recycle, and inactivity watchdog keep long-running automation stable.
  - title: Capability-aware failures
    details: Capability probing fails fast with CapabilityNotSupportedError instead of silent no-ops.
---

<div class="numbers-strip">
  <div class="numbers-grid">
    <div class="number-cell">
      <span class="number-value">1</span>
      <span class="number-label">SDK, every agent</span>
    </div>
    <div class="number-cell">
      <span class="number-value">12</span>
      <span class="number-label">agents supported</span>
    </div>
    <div class="number-cell">
      <span class="number-value">6</span>
      <span class="number-label">subpath exports</span>
    </div>
    <div class="number-cell">
      <span class="number-value">4</span>
      <span class="number-label">orchestration primitives</span>
    </div>
    <div class="number-cell">
      <span class="number-value">325+</span>
      <span class="number-label">Tests</span>
    </div>
  </div>
</div>

<style>
.numbers-strip {
  padding: 48px 24px 0;
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 32px;
}
.numbers-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
  text-align: center;
}
.number-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.number-value {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #4f46e5 0%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1.1;
}
.number-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  line-height: 1.3;
}
@media (max-width: 640px) {
  .numbers-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .numbers-grid .number-cell:last-child {
    grid-column: 1 / -1;
  }
}
</style>
