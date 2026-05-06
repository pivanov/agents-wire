# Tool Handling

Control which tools any agent can use and intercept tool executions at runtime. The same `toolHandler` interface works across all 12 agents.

## Allow List

Only permit specific tools:

```ts
const result = await agents.ask(
  "claude",
  "Analyze the codebase",
  {
    permission: "auto-allow",
    toolHandler: {
      allowed: ["Read", "Glob", "Grep"],
    },
  },
);
```

Any tool not in the list is automatically denied.

## Block List

Block specific tools while allowing everything else:

```ts
const result = await agents.ask(
  "claude",
  "Refactor utils",
  {
    permission: "auto-allow",
    toolHandler: {
      blocked: ["Bash", "Write"],
    },
  },
);
```

## Custom Handler

Intercept each tool use with a callback:

```ts
const result = await agents.ask(
  "claude",
  "Fix the bug",
  {
    permission: "auto-allow",
    toolHandler: {
      onToolUse: async (event) => {
        console.log(`Agent wants to use ${event.tool}`);

        if (event.tool === "Edit") {
          return "allow";
        }

        if (event.tool === "Bash") {
          return { decision: "deny", reason: "shell commands not permitted" };
        }

        // Provide a custom result instead of running the tool
        return { result: "mocked file contents" };
      },
    },
  },
);
```

The handler receives an `IToolUseEvent` and must return one of:

- `"allow"` - let the tool execute
- `"deny"` - block the tool (short form; no reason)
- `{ decision: "deny", reason: string }` - block with a reason surfaced to the model
- `{ result: unknown }` - skip execution, send this as the (successful) tool result
- `{ result: unknown, isError: true }` - mark result as an error so the model can react (retry, fall back) instead of treating it as success

```ts
toolHandler: {
  onToolUse: async (event) => {
    if (event.tool === "Bash" && isDestructive(event.input)) {
      return {
        result: "Destructive shell commands are disabled in this sandbox.",
        isError: true,
      };
    }
    return "allow";
  },
},
```

## Human-in-the-Loop (HITL)

Build approval gates where humans or other systems decide:

```ts
const result = await agents.ask(
  "claude",
  "Deploy the new version",
  {
    permission: "stream",  // stream permission requests to your handler
    toolHandler: {
      onToolUse: async (event) => {
        const callStr = JSON.stringify(event.input);
        await slackNotify(`Agent wants to run: ${event.tool}(${callStr})`);
        const approved = await waitForApproval(event.toolCallId);
        return approved ? "allow" : { decision: "deny", reason: "operator denied" };
      },
    },
  },
);
```

## Error Recovery

If `onToolUse` throws, the stream rejects with the thrown error. Provide `onError` to log, recover, or force a decision:

```ts
const result = await agents.ask(
  "claude",
  "Fix the bug",
  {
    permission: "auto-allow",
    toolHandler: {
      onToolUse: async (event) => {
        return await riskyPolicyCheck(event);
      },
      onError: (err, event) => {
        logger.warn(`policy check failed for ${event.tool}`, err);
        return "deny";
      },
    },
  },
);
```

`onError` returns the same decision shape as `onToolUse`. If it also throws, the error propagates.

## Precedence

When multiple options are set, they're evaluated in this order:

1. **`blocked`** - if the tool is blocked, deny immediately
2. **`allowed`** - if an allow list exists and the tool isn't in it, deny
3. **`onToolUse`** - call the custom handler
4. **Default** - allow (if `permission: "auto-allow"`) or surface to the caller (if `permission: "stream"`)

## Built-in Tool Names

```ts
import { BUILT_IN_TOOL_NAMES, isBuiltInTool } from "@pivanov/agents-wire";

console.log(BUILT_IN_TOOL_NAMES); // flattened set across every known agent
console.log(isBuiltInTool("Read")); // true (any agent declares it)
console.log(isBuiltInTool("Read", "claude")); // true (Claude declares it)
console.log(isBuiltInTool("Read", "codex")); // false (Codex uses snake_case)
console.log(isBuiltInTool("my-mcp-tool")); // false
```

Pass the optional `agentId` to scope the lookup to one agent's namespace — handy when allow/block lists need to differ per agent (Claude's `Read` vs Codex's `read_file`).

::: warning
`BUILT_IN_TOOL_NAMES` is a best-effort snapshot. For the authoritative list for any agent, check the `tools` array in the `session-meta` event from a live session.
:::
