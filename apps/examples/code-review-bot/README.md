# code-review-bot

Pipe a git diff into this script and get back structured findings: severity, file, line, and a plain-English message for each issue. Uses `agents.askJson` with a Zod schema so the output is validated before printing.

## What it does

1. Reads a unified diff from stdin.
2. Sends the diff to Claude with a structured-output prompt.
3. Parses and validates the response against a Zod schema.
4. Prints each finding as `[severity] file:line - message`.
5. Prints a one-sentence overall summary.

## Requirements

- **Claude Code** installed and authenticated (`claude` CLI available in PATH).
- Bun >= 1.0

## How to run

```bash
# Review changes since branching from main
git diff main | bun run example:code-review

# Review the last commit
git diff HEAD~1 | bun run example:code-review

# Or run the script directly
git diff main | bun apps/examples/code-review-bot/index.ts
```

If no diff is piped, the script exits with a usage message.

## Expected output

```
Reviewing diff...

[warn] ⚠ src/api/client.ts:42
       Missing null check before accessing .data property
[blocker] ✖ src/auth/token.ts:17
       Secret key logged to console - remove before shipping
[info] ℹ src/utils/format.ts
       Consider extracting the date formatter into a shared helper

Summary: The diff introduces a security regression in auth/token.ts that must be fixed before merging.
```

## Options

- `maxCostUsd: 0.50` - hard cost cap per review (override in source if needed).
- Large diffs are truncated to 60,000 characters to stay within context limits.

## Showcases

- `agents.askJson` + Zod (Standard Schema) structured output
- `detectAvailableAgents` for a friendly pre-flight check
- Error handling with typed `AgentNotInstalledError`
