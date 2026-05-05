# research-agent

Streams a live research session where the agent reads the codebase and writes a summary. Every tool call the agent makes is logged to stderr in real time, so you can watch it work.

## What it does

1. Accepts an optional topic string from the command line.
2. Opens a streaming session against Claude with `auto-allow` permissions.
3. Prints text deltas to stdout as they arrive (streaming output).
4. Logs each tool call (`Read`, `Glob`, etc.) to stderr.
5. Prints a final stats line: duration, tool-call count, and cost.

## Requirements

- **Claude Code** installed and authenticated (`claude` CLI available in PATH).
- Bun >= 1.0

## How to run

```bash
# Research the default topic (public API surface)
bun run example:research

# Research a specific topic
bun run example:research "the cost tracker"
bun run example:research "how streaming works"
bun run example:research "the orchestrate/failover module"

# Or run the script directly
bun apps/examples/research-agent/index.ts "the budget guard"
```

## Expected output

Stderr (tool calls):
```
Researching: "the cost tracker"

[tool #1] Read
[tool #2] Read
[tool #3] Glob
```

Stdout (streamed summary):
```
The cost tracker (`packages/agents-wire/src/budget/tracker.ts`) is a lightweight
accumulator that records token usage per agent turn. It exposes a `record()` method
that accepts a `IUsageReport` and optional model string, looks up per-token pricing
from the catalog, and adds the computed USD cost to running totals broken down by
input tokens, output tokens, cache-read tokens, and cache-write tokens...
```

Stderr (final stats):
```
Done. 12340ms | 3 tool calls | $0.0031
```

## Showcases

- `agents.stream` for live async iteration over `TAgentEvent`
- `text-delta` events for streaming output
- `tool-call` events for observability
- `stream.result()` for final metadata (duration, cost)
