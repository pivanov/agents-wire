# multi-agent-classifier

Classify a support ticket using `agents.askJson` with a failover loop: tries Claude first, then Codex, then Gemini. The first agent that responds successfully wins. Uses a Zod schema for validated structured output.

## What it does

1. Accepts a ticket string from the command line (or uses a default).
2. Detects which agents are installed locally.
3. Iterates through the preferred agent list (`claude` → `codex` → `gemini`).
4. Calls `agents.askJson` on each candidate until one succeeds.
5. Prints the validated JSON result including the winning agent.

## Requirements

- At least one of **Claude Code**, **Codex CLI**, or **Gemini CLI** installed and authenticated.
- Bun >= 1.0

Install hints:
- Claude Code: https://claude.ai/download
- Codex: `npm install -g @openai/codex`
- Gemini: https://developers.google.com/gemini

## How to run

```bash
# Classify a ticket (uses default if omitted)
bun run example:classifier "Login keeps failing after password reset"

bun run example:classifier "This feature is amazing, saved me hours!"

bun run example:classifier "Invoice shows wrong amount, need refund urgently"

# Or run the script directly
bun apps/examples/multi-agent-classifier/index.ts "your ticket text here"
```

## Expected output

```
Classifying with failover: claude -> codex -> gemini

[attempt 1] trying claude...
{
  "category": "billing",
  "urgency": "high",
  "reasoning": "The customer explicitly requests a refund and expresses frustration, indicating a billing issue requiring immediate attention.",
  "agent": "claude"
}
```

If the first agent is unavailable:
```
[attempt 1] trying claude...
  failed (agent-not-installed), trying next agent...
[attempt 2] trying codex...
{ ... }
```

## Showcases

- `agents.askJson` + Zod structured output
- Manual failover loop with typed `WireError` codes
- `detectAvailableAgents` to skip unavailable agents upfront
- Multi-agent orchestration without extra orchestration primitives
