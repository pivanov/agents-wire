# Pi

**Agent ID:** `pi`

Pi coding agent by Mario Zechner. Pi v0.73 does **not** implement the Agent Client Protocol - its `--mode rpc` uses a Pi-specific JSON dialect that is not ACP-compatible. The catalog entry is preserved so `detect` still surfaces Pi as installed, but live model resolution is skipped and session prompts will fail. Use Pi directly via the `pi` CLI until ACP support lands.

::: warning Non-ACP agent
`acpCompatible` is set to `false` for Pi. `resolveModels()` skips the session probe for Pi and shows the static "Default" placeholder. Do not rely on `agents-wire` to drive Pi until a future release adds ACP support.
:::

## Install

```bash
npm install -g @mariozechner/pi-coding-agent
export PI_API_KEY="your-api-key"
```

## Quick Start

```ts
import { agents } from "@pivanov/agents-wire";

const result = await agents.ask(
  "pi",
  "Explain this codebase",
  {
    permission: "auto-allow",
  },
);

console.log(result.text);
```

## Model Selection

Pi is a single-model product. `options.model` and `options.effort` are not exposed and
have no effect.

## Capabilities

| Feature | Supported |
|---------|-----------|
| `ask` / `stream` / `session` | ❌ (fails until Pi adds ACP support) |
| `askJson` | ❌ |
| MCP stdio | ❌ |
| MCP http/sse | ❌ |
| Session listing (`listSessions`) | ❌ |
| Tool call interception | ❌ |

## Cost Tracking

Pi is subscription-based and does not report per-turn `costUsd`. `cost.snapshot.totalUsd` stays at `0`, so `maxCostUsd` does not trigger. Monitor usage with `cost.turnCount`.

## Gotchas

- `PI_API_KEY` must be set before use.
- Session listing is not supported; `listSessions()` throws `CapabilityNotSupportedError`.
- No per-turn cost data - Pi operates on a subscription model.
