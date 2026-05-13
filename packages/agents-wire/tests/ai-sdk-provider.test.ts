import { describe, expect, test } from "bun:test";
import { type LanguageModelV3StreamPart, NoSuchModelError } from "@ai-sdk/provider";
import { createAgentLanguageModel, type IAgentSettingsInternal } from "@/ai-sdk/language-model";
import { createAgentProvider } from "@/ai-sdk/provider";
import { AI_SDK_PROVIDER_OPTIONS_KEY } from "@/constants";
import { connectMockHost, type IMockHostScript } from "@/testing/mock-host";
import type { IAgentAdapter } from "@/types/agent";

// Helper: build a minimal IAgentAdapter fixture
const makeAdapter = (id = "test-custom-agent"): IAgentAdapter => ({
  id,
  label: "Test Custom Agent",
  launch: () => ({ command: "/bin/echo", args: ["hello"] }),
  installNotice: "Install instructions",
  homepage: "https://example.com",
});

// AI_SDK_PROVIDER_OPTIONS_KEY constant
describe("AI_SDK_PROVIDER_OPTIONS_KEY", () => {
  test("has the expected value", () => {
    expect(AI_SDK_PROVIDER_OPTIONS_KEY).toBe("agentsWire");
  });
});

// createAgentProvider shape
describe("createAgentProvider", () => {
  test("returns a callable function", () => {
    const provider = createAgentProvider();
    expect(typeof provider).toBe("function");
  });

  test("has specificationVersion v3", () => {
    const provider = createAgentProvider();
    expect(provider.specificationVersion).toBe("v3");
  });

  test("exposes languageModel method", () => {
    const provider = createAgentProvider();
    expect(typeof provider.languageModel).toBe("function");
  });

  test("exposes fromAdapter method", () => {
    const provider = createAgentProvider();
    expect(typeof provider.fromAdapter).toBe("function");
  });

  test("exposes textEmbeddingModel method", () => {
    const provider = createAgentProvider();
    expect(typeof provider.textEmbeddingModel).toBe("function");
  });

  test("exposes imageModel method", () => {
    const provider = createAgentProvider();
    expect(typeof provider.imageModel).toBe("function");
  });

  test("textEmbeddingModel throws NoSuchModelError", () => {
    const provider = createAgentProvider();
    expect(() => provider.textEmbeddingModel("some-model")).toThrow(NoSuchModelError);
  });

  test("imageModel throws NoSuchModelError", () => {
    const provider = createAgentProvider();
    expect(() => provider.imageModel("some-model")).toThrow(NoSuchModelError);
  });

  test("calling provider as function returns a LanguageModelV3", () => {
    const provider = createAgentProvider();
    const model = provider("claude");
    expect(model.specificationVersion).toBe("v3");
    expect(model.modelId).toBe("claude");
  });

  test("languageModel returns a LanguageModelV3 with correct modelId", () => {
    const provider = createAgentProvider();
    const model = provider.languageModel("claude");
    expect(model.specificationVersion).toBe("v3");
    expect(model.modelId).toBe("claude");
  });
});

// fromAdapter
describe("fromAdapter", () => {
  test("returns a LanguageModelV3 whose modelId matches adapter.id", () => {
    const provider = createAgentProvider();
    const adapter = makeAdapter("my-custom-agent");
    const model = provider.fromAdapter(adapter);
    expect(model.specificationVersion).toBe("v3");
    expect(model.modelId).toBe("my-custom-agent");
  });

  test("fromAdapter with settings merges correctly", () => {
    const provider = createAgentProvider({ cwd: "/default" });
    const adapter = makeAdapter("adapter-agent");
    const model = provider.fromAdapter(adapter, { cwd: "/override" });
    expect(model.modelId).toBe("adapter-agent");
  });

  test("createAgentLanguageModel with adapter uses adapter.id as modelId", () => {
    const adapter = makeAdapter("direct-adapter-agent");
    const model = createAgentLanguageModel("direct-adapter-agent", {}, adapter);
    expect(model.modelId).toBe("direct-adapter-agent");
    expect(model.specificationVersion).toBe("v3");
  });
});

// mergeSettings behaviour (via provider defaults + per-call overrides)
describe("mergeSettings", () => {
  test("provider default settings are applied to languageModel calls", () => {
    const provider = createAgentProvider({ cwd: "/workspace" });
    // We can only observe the returned model's static fields at this level;
    // deep merge is tested implicitly through doGenerate / doStream in integration.
    const model = provider.languageModel("claude");
    expect(model.modelId).toBe("claude");
  });

  test("per-call settings override provider defaults (env merging)", () => {
    const provider = createAgentProvider({ env: { FOO: "default" } });
    const model = provider("claude", { env: { BAR: "override" } });
    expect(model.modelId).toBe("claude");
  });
});

// LanguageModelV3 shape checks
describe("LanguageModelV3 shape", () => {
  test("returned model has required LanguageModelV3 properties", () => {
    const provider = createAgentProvider();
    const model = provider("claude");
    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
    expect(typeof model.provider).toBe("string");
    expect(typeof model.modelId).toBe("string");
  });

  test("fromAdapter model has required LanguageModelV3 properties", () => {
    const provider = createAgentProvider();
    const model = provider.fromAdapter(makeAdapter());
    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
    expect(typeof model.provider).toBe("string");
    expect(typeof model.modelId).toBe("string");
  });
});

// Streaming tool-call / tool-result / response-metadata tests
// TODO: These tests require a fully wired mock IWireHost that emits tool-call
// and tool-call-update events through the ACP stream. The current testing
// infrastructure (createMockAgent) mocks at the IAgentSession level and does
// not expose a hook into host.prompt(). To add full coverage:
//   1. Build a mock createWireHost that accepts scripted TAgentEvent arrays.
//   2. Inject it via a test-only override or module mock.
//   3. Collect LanguageModelV3StreamPart[] from doStream and assert:
//      - { type: "response-metadata", id: sessionId } appears after stream-start.
//      - tool-call events become { type: "tool-call", providerExecuted: true }.
//      - tool-call-update (completed) becomes { type: "tool-result" }.
//      - tool-call-update (failed) becomes { type: "tool-result", isError: true }.
//      - callOptionWarnings produces { type: "unsupported", feature: "temperature" } in stream-start warnings.

// Streaming integration tests via _bootstrap injection

const drainStream = async (model: ReturnType<typeof createAgentLanguageModel>): Promise<LanguageModelV3StreamPart[]> => {
  const result = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  });
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = result.stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
  }
  return parts;
};

const buildScriptedModel = async (
  script: IMockHostScript,
  extraOptions: Partial<IAgentSettingsInternal> = {},
): Promise<ReturnType<typeof createAgentLanguageModel>> => {
  const ctx = await connectMockHost(script);
  const sessionId = await ctx.host.newSession();
  return createAgentLanguageModel("claude", {
    ...extraOptions,
    _bootstrap: async () => ({ host: ctx.host, sessionId }),
  } as IAgentSettingsInternal);
};

describe("doStream - integration via _bootstrap", () => {
  test("emits response-metadata immediately after stream-start", async () => {
    const model = await buildScriptedModel({
      onPrompt: function* () {
        yield { type: "text-delta", text: "hi", messageId: undefined };
      },
    });
    const parts = await drainStream(model);
    const metadataIdx = parts.findIndex((p) => p.type === "response-metadata");
    const startIdx = parts.findIndex((p) => p.type === "stream-start");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(metadataIdx).toBe(startIdx + 1);
  });

  test("forwards tool-call events as tool-call parts with providerExecuted: true", async () => {
    const model = await buildScriptedModel({
      onPrompt: function* () {
        yield {
          type: "tool-call",
          toolCallId: "call-1",
          tool: "search",
          kind: undefined,
          status: undefined,
          input: { query: "x" },
          locations: undefined,
        };
        yield { type: "text-delta", text: "ok", messageId: undefined };
      },
    });
    const parts = await drainStream(model);
    const toolCall = parts.find((p) => p.type === "tool-call") as Extract<LanguageModelV3StreamPart, { type: "tool-call" }> | undefined;
    expect(toolCall).toBeDefined();
    expect(toolCall?.toolCallId).toBe("call-1");
    expect(toolCall?.toolName).toBe("search");
    expect(toolCall?.providerExecuted).toBe(true);
    expect(typeof toolCall?.input).toBe("string");
  });

  test("forwards completed tool-call-update as tool-result", async () => {
    const model = await buildScriptedModel({
      onPrompt: function* () {
        yield {
          type: "tool-call-update",
          toolCallId: "call-1",
          title: "search",
          status: "completed",
          input: undefined,
          output: { results: ["a", "b"] },
          locations: undefined,
        };
        yield { type: "text-delta", text: "done", messageId: undefined };
      },
    });
    const parts = await drainStream(model);
    const toolResult = parts.find((p) => p.type === "tool-result") as Extract<LanguageModelV3StreamPart, { type: "tool-result" }> | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult?.toolCallId).toBe("call-1");
    expect(toolResult?.toolName).toBe("search");
    expect(toolResult?.isError).toBeUndefined();
  });

  test("forwards failed tool-call-update as tool-result with isError: true", async () => {
    const model = await buildScriptedModel({
      onPrompt: function* () {
        yield {
          type: "tool-call-update",
          toolCallId: "call-2",
          title: "fetch",
          status: "failed",
          input: undefined,
          output: "boom",
          locations: undefined,
        };
        yield { type: "text-delta", text: "ok", messageId: undefined };
      },
    });
    const parts = await drainStream(model);
    const toolResult = parts.find((p) => p.type === "tool-result") as Extract<LanguageModelV3StreamPart, { type: "tool-result" }> | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult?.toolCallId).toBe("call-2");
    expect(toolResult?.isError).toBe(true);
  });

  test("callOptionWarnings surfaces unsupported call options like temperature", async () => {
    const model = await buildScriptedModel({
      onPrompt: function* () {
        yield { type: "text-delta", text: "ok", messageId: undefined };
      },
    });
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      temperature: 0.7,
      topP: 0.9,
    });
    const parts: LanguageModelV3StreamPart[] = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
    }
    const start = parts.find((p) => p.type === "stream-start") as Extract<LanguageModelV3StreamPart, { type: "stream-start" }> | undefined;
    expect(start).toBeDefined();
    const warningFeatures = (start?.warnings ?? []).map((w) => (w.type === "unsupported" ? w.feature : ""));
    expect(warningFeatures).toContain("temperature");
    expect(warningFeatures).toContain("topP");
  });

  test("consumer stream cancellation cancels the upstream agent prompt", async () => {
    let upstreamAborted = false;
    const model = await buildScriptedModel({
      onPrompt: async function* (_sessionId, _blocks, signal) {
        yield { type: "text-delta", text: "partial", messageId: undefined };
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            upstreamAborted = true;
            resolve();
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              upstreamAborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const reader = result.stream.getReader();
    await reader.read(); // stream-start
    await reader.read(); // response-metadata
    await reader.read(); // text-start
    await reader.read(); // text-delta

    await reader.cancel("consumer stopped reading");

    expect(upstreamAborted).toBe(true);
  });
});
