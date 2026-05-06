import { describe, expect, test } from "bun:test";
import { AgentConnectionClosedError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

describe("connectMockHost - harness sanity", () => {
  test("creates a host with the mock definition id", async () => {
    await using ctx = await connectMockHost();
    expect(ctx.definition.id).toBe("mock");
    expect(ctx.host.definition.id).toBe("mock");
  });

  test("capabilities from script are reflected on the host", async () => {
    await using ctx = await connectMockHost({
      capabilities: {
        sessionCapabilities: { list: {} },
        mcpCapabilities: { http: true, sse: false },
      },
    });
    expect(ctx.host.capabilities.listSessions).toBe(true);
    expect(ctx.host.capabilities.mcp.http).toBe(true);
    expect(ctx.host.capabilities.mcp.sse).toBe(false);
  });

  test("empty capabilities produce all-false flags", async () => {
    await using ctx = await connectMockHost({ capabilities: {} });
    expect(ctx.host.capabilities.listSessions).toBe(false);
    expect(ctx.host.capabilities.forkSession).toBe(false);
    expect(ctx.host.capabilities.mcp.http).toBe(false);
  });

  test("basic prompt round-trip returns text events and finish", async () => {
    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield { type: "text-delta" as const, text: "Hello from mock", messageId: undefined };
      },
    });
    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hi" });
    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    const result = await stream.completion;
    expect(events).toContain("text-delta");
    expect(events).toContain("finish");
    expect(result.stopReason).toBe("end_turn");
    expect(result.agent).toBe("mock");
  });

  test("text from text-delta events accumulates in completion.text", async () => {
    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield { type: "text-delta" as const, text: "foo", messageId: undefined };
        yield { type: "text-delta" as const, text: "bar", messageId: undefined };
      },
    });
    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "test" });
    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;
    expect(result.text).toBe("foobar");
  });

  test("prompt stopReason is forwarded from script", async () => {
    await using ctx = await connectMockHost({ stopReason: "max_tokens" });
    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "test" });
    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;
    expect(result.stopReason).toBe("max_tokens");
  });

  test("triggerExit causes active session completion to reject with AgentConnectionClosedError", async () => {
    await using ctx = await connectMockHost({
      onPrompt: async function* (_sessionId, _blocks) {
        // Hang until exit is triggered, so the test can assert that an
        // unexpected agent exit propagates as a stream failure mid-prompt.
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      },
    });
    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hang" });

    setTimeout(() => ctx.triggerExit(1), 20);

    let caught: unknown;
    try {
      await stream.completion;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentConnectionClosedError);
    expect((caught as AgentConnectionClosedError).exitCode).toBe(1);
  });

  test("definition overrides are applied", async () => {
    await using ctx = await connectMockHost({}, { definition: { id: "custom-agent" as never, label: "Custom" } });
    expect(ctx.definition.id).toBe("custom-agent");
    expect(ctx.host.definition.label).toBe("Custom");
  });

  test("authMethods from script are reflected on the host", async () => {
    await using ctx = await connectMockHost({
      authMethods: [{ id: "env", name: "Environment Variable", type: "env_var", vars: [] }],
    });
    expect(ctx.host.authMethods.length).toBe(1);
    expect(ctx.host.authMethods[0]?.id).toBe("env");
  });
});
