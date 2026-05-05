# CLI

`agents-wire` ships a CLI binary for one-off agent interactions and shell pipelines.

::: code-group
```bash [bun]
bunx @pivanov/agents-wire <command> [agent] [options]
```
```bash [npm]
npx @pivanov/agents-wire <command> [agent] [options]
```
```bash [pnpm]
pnpm dlx @pivanov/agents-wire <command> [agent] [options]
```
```bash [yarn]
yarn dlx @pivanov/agents-wire <command> [agent] [options]
```
```bash [global]
# After global install via your package manager:
agents-wire <command> [agent] [options]
```
:::

## `ask`

Send a one-shot prompt and print the result.

```bash
agents-wire ask claude --prompt "explain this repo"
agents-wire ask gemini --prompt "summarize README.md" --cwd /my/project
agents-wire ask codex  --prompt "list TODOs" --max-cost-usd 0.10
```

**Options:**
- `--prompt <text>` - the prompt to send (required)
- `--cwd <path>` - working directory (default: current directory)
- `--model <name>` - model to use
- `--max-cost-usd <number>` - abort if cost exceeds this limit
- `--permission <policy>` - permission policy: `auto-allow` (default), `auto-reject`

## `ask-json`

Send a prompt and return schema-validated JSON. Exits with code 1 if validation fails.

```bash
agents-wire ask-json claude \
  --prompt "extract the title and author from README.md" \
  --schema-file ./schema.json

# Inline JSON Schema:
agents-wire ask-json claude \
  --prompt "return {ok: true}" \
  --schema '{"type":"object","properties":{"ok":{"type":"boolean"}}}'
```

**Options:**
- `--schema-file <path>` - path to a JSON Schema file
- `--schema <json>` - inline JSON Schema string
- All options from `ask`

Output is pretty-printed JSON to stdout. Errors go to stderr.

## `stream`

Stream the response event-by-event, printing text deltas as they arrive.

```bash
agents-wire stream claude --prompt "refactor src/auth.ts step by step"
agents-wire stream gemini --prompt "summarize this PR" | head -20
```

Prints text deltas to stdout. Tool calls and events are printed to stderr for visibility.

## `detect`

List all agents available on the current machine.

```bash
agents-wire detect
```

Example output:

```
✓ claude     Claude Code (v1.4.0)
✓ cursor     Cursor Agent CLI (v0.9.0)
✗ codex      Not found (codex not on PATH)
✗ copilot    Not found (@github/copilot not installed)
✓ opencode   OpenCode (v0.3.2)
```

## `agents`

List all agents built in to the SDK (whether or not they're installed).

```bash
agents-wire agents
```

## Shell Pipeline Examples

```bash
# Extract metadata from a file and pipe to jq
SCHEMA=$(cat <<'JSON'
{"type":"object","properties":{
  "title":{"type":"string"},
  "version":{"type":"string"},
  "description":{"type":"string"}
}}
JSON
)
agents-wire ask-json claude \
  --prompt "extract: title, version, description from package.json" \
  --schema "$SCHEMA" \
  | jq .version

# Classify a commit message
SCHEMA=$(cat <<'JSON'
{"type":"object","properties":{
  "type":{"type":"string"},
  "breaking":{"type":"boolean"}
}}
JSON
)
echo "fix: prevent crash on empty input" | agents-wire ask-json claude \
  --prompt "classify this commit type: $(cat)" \
  --schema "$SCHEMA"

# Stream a refactor, abort if over $0.50
agents-wire stream claude \
  --prompt "refactor src/auth.ts to use the new session API" \
  --max-cost-usd 0.50
```
