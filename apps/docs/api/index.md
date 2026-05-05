# API Reference

`agents-wire` exports a layered surface. Start with the main entry for app code; reach into subpaths for narrower imports.

## Main entry - `@pivanov/agents-wire`

The top-level `agents` namespace covers most use cases:

| Method | Description |
|--------|-------------|
| `agents.ask(agent, prompt, options?)` | One-shot prompt. Returns `IAskResult`. |
| `agents.stream(agent, prompt, options?)` | Streaming async-iterable. Returns `IAgentStream`. |
| `agents.session(agent, options?)` | Multi-turn persistent session. Returns `IAgentSession`. |
| `agents.askJson(agent, prompt, schema, options?)` | Structured JSON with schema validation. |
| `agents.failover(prompt, agents, options?)` | Try agents in order, return first success. |
| `agents.race(prompt, agents, options?)` | All in parallel, first to finish wins. |
| `agents.cascade(prompt, stages, options?)` | Escalation chain with `accept` predicate. |
| `agents.pool(options)` | Warm subprocess pool. Returns `IAgentPool`. |

Also exported: all error classes, types, cost tracking helpers, tool handler utilities, Standard Schema helpers, and the agent catalog.

## Pages

- [Client](/api/client) - `agents.ask`, `agents.stream`, `IAgentOptions`
- [Session](/api/session) - `agents.session`, `IAgentSession`, resilience, turn limits
- [Stream](/api/stream) - `IAgentStream`, event iteration, convenience methods
- [Events](/api/events) - `TAgentEvent` discriminated union
- [JSON (askJson)](/api/json) - Standard Schema, Zod/Valibot/ArkType, raw JSON Schema
- [Errors](/api/errors) - `WireError` hierarchy, all error classes
- [Subpath Exports](/api/subpaths) - six subpaths and when to use each
- [Testing](/api/testing) - `createMockAgent`, `connectMockHost`, transcript replay
