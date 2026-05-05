# Agent Client Protocol (ACP)

`agents-wire` speaks [ACP - the Agent Client Protocol](https://agentclientprotocol.com), an open protocol for communicating with local coding agents over JSON-RPC.

## What is ACP?

ACP defines how a host (this SDK) communicates with an agent process:

- **Transport:** JSON-RPC 2.0 over stdin/stdout
- **Session model:** the host spawns the agent process, calls `initialize`, then exchanges `prompt` requests and event notifications
- **Permission model:** the agent requests permissions (tool use, file access) through the host; the host approves or denies them
- **Tool dispatch:** the host handles tool call requests and returns results to the agent
- **MCP integration:** the host registers MCP servers and the agent can call them as tools

## Why ACP?

Before ACP, every agent had its own undocumented wire format. ACP is a shared contract that lets:

- One SDK drive many agents without format-specific code
- Agent authors implement one protocol instead of one per SDK
- Tool middleware, permission policies, and session management to be agent-agnostic

## Agents that speak ACP

| Agent | Mode | Notes |
|-------|------|-------|
| Claude Code | bridge | `@agentclientprotocol/claude-agent-acp`, bundled |
| Codex CLI | bridge | `@zed-industries/codex-acp`, bundled |
| Cursor | native | `cursor agent acp` |
| GitHub Copilot | bridge | peer install required |
| Gemini CLI | bridge | peer install required |
| OpenCode | native | `opencode acp` |
| Factory Droid | native | `droid exec --output-format acp` |
| Pi | non-ACP | v0.73 uses a JSON dialect, not ACP. SDK marks `acpCompatible: false` |
| Cline | native | `cline --acp` |
| Kilo | native | `kilo acp`, plus live `kilo models` introspection |
| Qwen Code | native | `qwen --acp --experimental-skills` |
| Augment Code (Auggie) | native | `auggie --acp` (subscription required) |

**Native:** the CLI speaks ACP directly.
**Bridge:** a wrapper package translates between the CLI's existing interface and ACP.

## ACP Resources

- **Spec and docs:** [agentclientprotocol.com](https://agentclientprotocol.com)
- **SDK packages:** `@agentclientprotocol/sdk` (host side), various agent-side packages
- **Protocol version:** `agents-wire` exports `ACP_PROTOCOL_VERSION` - the version the SDK expects

```ts
import { ACP_PROTOCOL_VERSION } from "@pivanov/agents-wire";
console.log(ACP_PROTOCOL_VERSION);
```

If an agent reports a different protocol version during `initialize`, the SDK throws `ProtocolVersionMismatchError` and disposes the subprocess.

## Custom Adapters

If you have an agent that speaks ACP but isn't in the built-in catalog, implement `IAgentAdapter` and register it:

```ts
import { registerDefinition } from "@pivanov/agents-wire/catalog";

registerDefinition({
  id: "my-agent",
  displayName: "My Custom Agent",
  launchSpec: {
    command: "my-agent",
    args: ["acp"],
  },
  capabilities: {
    mcpCapabilities: { supportedTransports: ["stdio"] },
  },
});

// Now use it like any built-in agent
const result = await agents.ask("my-agent", "Hello");
```

For the Vercel AI SDK provider, use `provider.fromAdapter()`:

```ts
import { createAgentProvider } from "@pivanov/agents-wire/ai-sdk";
const provider = createAgentProvider({ permission: "auto-allow" });
const model = provider.fromAdapter(myAdapter);
```
