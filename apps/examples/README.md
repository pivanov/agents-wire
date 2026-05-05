# agents-wire examples

Runnable demos showing common patterns. Each is a single bun script.

## code-review-bot

Pipe a git diff, get structured findings back. `agents.askJson` with Zod.

```bash
git diff main | bun run example:code-review
```

## research-agent

Streaming research session with live tool-call observability.

```bash
bun run example:research "the cost tracker"
```

## multi-agent-classifier

Same classification question across multiple agents with failover. Manual failover loop + `agents.askJson` + Zod structured output.

```bash
bun run example:classifier "ticket text"
```

---

Each example needs the relevant agent CLI installed.
Run the following to see what's available locally:

```bash
bun run --filter ./packages/agents-wire detect
```
