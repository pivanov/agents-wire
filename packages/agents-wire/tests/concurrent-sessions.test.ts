/**
 * Tests for concurrent session behaviour on a single host.
 * Uses connectMockHost harness - no subprocess required.
 */

import { describe, expect, test } from "bun:test";
import { WireError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

describe("concurrent sessions", () => {
  test("two sessions created on the same host get distinct session IDs", async () => {
    await using ctx = await connectMockHost();
    const sessionA = await ctx.host.newSession();
    const sessionB = await ctx.host.newSession();
    expect(sessionA).not.toBe(sessionB);
  });

  test("events from sessionA do not appear in sessionB's stream", async () => {
    await using ctx = await connectMockHost({
      onPrompt: function* (sessionId, _blocks) {
        yield { type: "text-delta" as const, text: `from-${sessionId}`, messageId: undefined };
      },
    });
    const sessionA = await ctx.host.newSession();
    const sessionB = await ctx.host.newSession();

    const streamA = ctx.host.prompt(sessionA, { prompt: "a" });
    for await (const _ of streamA) {
      /* drain */
    }
    const resultA = await streamA.completion;

    const streamB = ctx.host.prompt(sessionB, { prompt: "b" });
    for await (const _ of streamB) {
      /* drain */
    }
    const resultB = await streamB.completion;

    expect(resultA.text).toContain(sessionA);
    expect(resultB.text).toContain(sessionB);
    expect(resultA.text).not.toContain(sessionB);
    expect(resultB.text).not.toContain(sessionA);
  });

  test("prompting an active session throws WireError stream-error", async () => {
    let unblockPrompt: (() => void) | undefined;
    await using ctx = await connectMockHost({
      onPrompt: async function* (_sessionId, _blocks) {
        // Block until the test releases it
        await new Promise<void>((resolve) => {
          unblockPrompt = resolve;
        });
      },
    });
    const sessionId = await ctx.host.newSession();

    const streamA = ctx.host.prompt(sessionId, { prompt: "first" });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    let caught: unknown;
    try {
      ctx.host.prompt(sessionId, { prompt: "second" });
    } catch (err) {
      caught = err;
    }

    unblockPrompt?.();
    for await (const _ of streamA) {
      /* drain */
    }

    expect(caught).toBeInstanceOf(WireError);
    expect((caught as WireError).code).toBe("stream-error");
  });

  test("completing a prompt on sessionA does not affect sessionB", async () => {
    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });
    const sessionA = await ctx.host.newSession();
    const sessionB = await ctx.host.newSession();

    const streamA = ctx.host.prompt(sessionA, { prompt: "a" });
    for await (const _ of streamA) {
      /* drain */
    }
    await streamA.completion;

    const streamB = ctx.host.prompt(sessionB, { prompt: "b" });
    const events: string[] = [];
    for await (const event of streamB) {
      events.push(event.type);
    }
    await streamB.completion;

    expect(events).toContain("text-delta");
    expect(events).toContain("finish");
  });

  test("multiple sequential prompts on same session all succeed", async () => {
    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield { type: "text-delta" as const, text: "response", messageId: undefined };
      },
    });
    const sessionId = await ctx.host.newSession();

    for (let i = 0; i < 3; i++) {
      const stream = ctx.host.prompt(sessionId, { prompt: `turn-${i}` });
      for await (const _ of stream) {
        /* drain */
      }
      const result = await stream.completion;
      expect(result.stopReason).toBe("end_turn");
    }
  });
});
