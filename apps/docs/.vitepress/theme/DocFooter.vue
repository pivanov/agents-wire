<template>
  <footer class="aw-foot">
    <div class="aw-foot-grid">
      <div class="aw-foot-brand">
        <div class="aw-foot-logo">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span class="aw-foot-name">agents-wire</span>
        </div>
        <p class="aw-foot-tag">
          One TypeScript SDK for every local coding agent. Same call, any agent.
        </p>
        <div class="aw-foot-badges">
          <a
            href="https://www.npmjs.com/package/@pivanov/agents-wire"
            target="_blank"
            rel="noreferrer"
            class="aw-foot-badge"
          >
            <span class="aw-foot-badge-k">npm</span>
            <span class="aw-foot-badge-v">@pivanov/agents-wire</span>
          </a>
          <a
            href="https://github.com/pivanov/agents-wire"
            target="_blank"
            rel="noreferrer"
            class="aw-foot-badge"
          >
            <span class="aw-foot-badge-k">repo</span>
            <span class="aw-foot-badge-v">pivanov/agents-wire</span>
          </a>
        </div>
      </div>

      <div class="aw-foot-col">
        <h4>Docs</h4>
        <ul>
          <li><a href="/why">Why agents-wire</a></li>
          <li><a href="/getting-started">Getting Started</a></li>
          <li><a href="/api/index">API Reference</a></li>
          <li><a href="/guides/orchestration">Orchestration</a></li>
          <li><a href="/guides/cli">CLI Playground</a></li>
        </ul>
      </div>

      <div class="aw-foot-col">
        <h4>Agents</h4>
        <ul>
          <li><a href="/agents/claude">Claude</a></li>
          <li><a href="/agents/codex">Codex</a></li>
          <li><a href="/agents/cursor">Cursor</a></li>
          <li><a href="/agents/gemini">Gemini</a></li>
          <li><a href="/agents/index">All 12 agents →</a></li>
        </ul>
      </div>

      <div class="aw-foot-col">
        <h4>Community</h4>
        <ul>
          <li><a href="https://github.com/pivanov/agents-wire" target="_blank" rel="noreferrer">GitHub</a></li>
          <li><a href="https://github.com/pivanov/agents-wire/issues" target="_blank" rel="noreferrer">Issues</a></li>
          <li><a href="https://github.com/pivanov/agents-wire/discussions" target="_blank" rel="noreferrer">Discussions</a></li>
          <li><a href="https://www.npmjs.com/package/@pivanov/agents-wire" target="_blank" rel="noreferrer">npm</a></li>
        </ul>
      </div>
    </div>

    <div class="aw-foot-base">
      <div class="aw-foot-meta">
        <span>© {{ year }} agents-wire</span>
        <span class="aw-foot-dot">·</span>
        <span>MIT License</span>
        <span class="aw-foot-dot">·</span>
        <span>
          Made by
          <a href="https://github.com/pivanov" target="_blank" rel="noreferrer">@pivanov</a>
        </span>
      </div>
      <div class="aw-foot-supported">
        Supported by
        <a href="https://logicstar.ai/" target="_blank" rel="noreferrer">LogicStar AI</a>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = new Date().getFullYear();
</script>

<style scoped>
.aw-foot {
  margin-top: 64px;
  padding: 40px 0 16px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.aw-foot-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 40px;
  align-items: start;
}

@media (max-width: 768px) {
  .aw-foot-grid {
    grid-template-columns: 1fr 1fr;
    gap: 28px;
  }
  .aw-foot-brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .aw-foot-grid {
    grid-template-columns: 1fr;
  }
}

.aw-foot-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.aw-foot-logo img {
  display: block;
}

.aw-foot-name {
  font-weight: 700;
  font-size: 16px;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.aw-foot-tag {
  margin: 12px 0 16px;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.aw-foot-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.aw-foot-badge {
  display: inline-flex;
  align-items: stretch;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  border-radius: 6px;
  overflow: hidden;
  text-decoration: none;
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.15s ease;
}

.aw-foot-badge:hover {
  border-color: var(--vp-c-brand-1);
}

.aw-foot-badge-k {
  padding: 3px 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border-right: 1px solid var(--vp-c-divider);
}

.aw-foot-badge-v {
  padding: 3px 8px;
  color: var(--vp-c-text-1);
}

.aw-foot-col h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-1);
}

.aw-foot-col ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aw-foot-col a {
  color: var(--vp-c-text-2);
  text-decoration: none;
  font-size: 13px;
  transition: color 0.15s ease;
}

.aw-foot-col a:hover {
  color: var(--vp-c-brand-1);
}

.aw-foot-base {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.aw-foot-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.aw-foot-dot {
  color: var(--vp-c-text-3);
  opacity: 0.6;
}

.aw-foot-meta a,
.aw-foot-supported a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.aw-foot-meta a:hover,
.aw-foot-supported a:hover {
  color: var(--vp-c-brand-1);
}
</style>
