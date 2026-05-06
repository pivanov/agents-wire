# Agent capabilities

Every agent advertises a set of capabilities during the ACP `initialize` handshake. agents-wire normalises these into `IAgentCapabilities`, which surfaces on `IWireHost` and `IAgentSession.capabilities`.

```ts
interface IAgentCapabilities {
  readonly loadSession: boolean;
  readonly forkSession: boolean;
  readonly resumeSession: boolean;
  readonly closeSession: boolean;
  readonly listSessions: boolean;
  readonly additionalDirectories: boolean;
  readonly mcp: {
    readonly stdio: boolean;
    readonly http: boolean;
    readonly sse: boolean;
  };
  readonly prompt: {
    readonly text: boolean;
    readonly image: boolean;
    readonly audio: boolean;
    readonly embeddedContext: boolean;
  };
}
```

## Session capabilities

| Field | Meaning |
|-------|---------|
| `loadSession` | The agent supports `acp.loadSession` (resume by id). When `false`, `host.loadSession()` throws `CapabilityNotSupportedError("loadSession")`. |
| `forkSession` | The agent supports forking an existing session (advisory; the SDK doesn't expose fork yet). |
| `resumeSession` | Variant of session resumption advertised by the agent. |
| `closeSession` | The agent supports an explicit close-session RPC (separate from process exit). |
| `listSessions` | The agent supports `acp.listSessions`. When `false`, `IWireHost.listSessions` / `streamAllSessions` throw `CapabilityNotSupportedError("sessionCapabilities.list")`. |
| `additionalDirectories` | The agent accepts extra read-only directories scoped to the session. See below. |

### `additionalDirectories`

When you set `options.additionalDirectories` on `createSession`, agents-wire forwards the list to `acp.newSession` / `acp.loadSession` **iff** the agent advertises this capability.

- **Capability `true`:** the list is sent on the wire and the agent grants its tools read access to those paths for the session's lifetime.
- **Capability `false`:** the list is **silently dropped** with a one-shot `onWarning("Agent X does not advertise additionalDirectories capability — ignoring N entries.")`. The session still establishes; you just get the agent's default scope. This is loose-by-design — `additionalDirectories` is purely additive context, so a permissive default produces a working session with reduced scope rather than a hard failure.

If you want strict-throw behavior, gate the option yourself: `if (!session.host.capabilities.additionalDirectories) throw …`.

## MCP capabilities

agents-wire validates `mcpServers` at session-creation time against the agent's advertised MCP transports.

| Field | Behavior on mismatch |
|-------|----------------------|
| `mcp.stdio` | Always `true` per the ACP spec (no opt-out flag in `McpCapabilities`). |
| `mcp.http` | If you pass `{ type: "http", … }` and the agent doesn't advertise `http`, `validateMcpServersWithCapabilities` throws `CapabilityNotSupportedError("mcpCapabilities.http")` before any RPC fires. |
| `mcp.sse` | Same shape as HTTP — throws on mismatch. |

stdio MCP servers are always accepted because every ACP-conformant agent must support them.

## Prompt capabilities

| Field | Meaning |
|-------|---------|
| `prompt.text` | Always `true`; text content is the baseline. |
| `prompt.image` | Agent accepts inline image content blocks (base64 data URIs in `LanguageModelV3` user-message parts). |
| `prompt.audio` | Same for audio. |
| `prompt.embeddedContext` | Agent supports inline embedded-context blocks (file references resolved at the agent side). |

The AI SDK provider (`@pivanov/agents-wire/ai-sdk`) reads `prompt.image` / `prompt.audio` and emits a `SharedV3Warning` listing the dropped part types when the user sends parts the agent can't consume.

## Reading capabilities at runtime

```ts
const session = await agents.session("claude");
console.log(session.host.capabilities.additionalDirectories); // true|false
```

For one-shot calls, use `agents.capabilities(agentId)` which spawns and probes:

```ts
const caps = await agents.capabilities("codex");
if (!caps.additionalDirectories) {
  console.warn("codex won't see your extra directories on this build");
}
```
