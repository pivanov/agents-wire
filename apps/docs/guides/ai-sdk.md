# Vercel AI SDK Integration

`agents-wire` ships a first-class [Vercel AI SDK v3](https://sdk.vercel.ai/) provider. Import from `@pivanov/agents-wire/ai-sdk`.

The `ai` package is a peer dependency - install it separately:

```bash
bun add ai
# or: npm install ai
```

## `agentModel(agentId, options?)`

Returns a `LanguageModelV3` that can be dropped into `streamText`, `generateText`, `useChat`, and any other AI SDK consumer.

```ts
import { streamText } from "ai";
import { agentModel } from "@pivanov/agents-wire/ai-sdk";

const { textStream } = streamText({
  model: agentModel("claude", { permission: "auto-allow" }),
  prompt: "Refactor src/auth.ts",
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## `createAgentProvider(options?)`

Creates a provider factory with preset defaults.

```ts
import { createAgentProvider } from "@pivanov/agents-wire/ai-sdk";

const provider = createAgentProvider({
  permission: "auto-allow",
  cwd: process.cwd(),
});

const { text } = await generateText({
  model: provider("claude"),
  prompt: "Summarize this file",
});
```

## Multi-Turn with `createAgentModelSession`

For multi-turn conversations that share one subprocess across AI SDK calls:

```ts
import { streamText } from "ai";
import { createAgentModelSession } from "@pivanov/agents-wire/ai-sdk";

await using s = await createAgentModelSession(
  "codex",
  {
    permission: "auto-allow",
  },
);

await streamText({ model: s.model, prompt: "List all TODOs" });
await streamText({ model: s.model, prompt: "Now fix the highest-priority one" });
```

Each `streamText` call reuses the same session subprocess, so conversation context carries over.

## Slash Commands via `providerOptions`

Send slash commands to agents that support them:

```ts
import { generateText } from "ai";
import { agentModel } from "@pivanov/agents-wire/ai-sdk";

const { text } = await generateText({
  model: agentModel("claude"),
  prompt: "run the test suite",
  providerOptions: {
    agentsWire: {
      command: "/test",  // sent as a slash command
    },
  },
});
```

The key `AI_SDK_PROVIDER_OPTIONS_KEY` (exported from the main entry) holds the string `"agentsWire"` for use in dynamic contexts.

## Tool Call Forwarding

Tool calls from the agent are forwarded as AI SDK `tool-call` and `tool-result` parts, compatible with `useChat`'s tool invocation UI.

```ts
import { streamText, tool } from "ai";
import { agentModel } from "@pivanov/agents-wire/ai-sdk";
import { z } from "zod";

const { fullStream } = streamText({
  model: agentModel("claude", { permission: "auto-allow" }),
  prompt: "Read and summarize src/auth.ts",
  tools: {
    Read: tool({
      description: "Read a file",
      parameters: z.object({ file_path: z.string() }),
      execute: async ({ file_path }) => {
        return await Bun.file(file_path).text();
      },
    }),
  },
});

for await (const part of fullStream) {
  if (part.type === "tool-call") console.log("calling tool:", part.toolName);
  if (part.type === "tool-result") console.log("tool result:", part.result);
  if (part.type === "text-delta") process.stdout.write(part.textDelta);
}
```

## `provider.fromAdapter(adapter)`

Create a `LanguageModelV3` from a custom `IAgentAdapter` (for proprietary or future agents not in the built-in catalog). `fromAdapter` is a method on the provider returned by `createAgentProvider()`, not a standalone export:

```ts
import { createAgentProvider } from "@pivanov/agents-wire/ai-sdk";
import type { IAgentAdapter } from "@pivanov/agents-wire";

const myAdapter: IAgentAdapter = {
  // ... custom launch logic
};

const provider = createAgentProvider({
  permission: "auto-allow",
});
const model = provider.fromAdapter(myAdapter);

const { text } = await generateText({ model, prompt: "Hello" });
```

## Unsupported LLM Parameters

The provider warns when AI SDK parameters that don't map to agent concepts are passed (`temperature`, `topP`, `frequencyPenalty`, etc.). These are forwarded to `options.onWarning` (default: `console.warn`). The call still proceeds - the parameters are silently ignored by the agent.

## Response Metadata

The provider emits `response-metadata` with the live session ID after each turn:

```ts
const { experimental_providerMetadata } = await generateText({
  model: agentModel("claude"),
  prompt: "Hello",
});

console.log(experimental_providerMetadata?.agentsWire?.sessionId);
```
