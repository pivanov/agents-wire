/**
 * Cancellation tests: AbortSignal, stream.cancel(), pre-aborted signals.
 * Uses connectMockHost harness - no subprocess required.
 */

import { describe, expect, test } from "bun:test";
import { createSession, type ISessionOptionsInternal } from "@/api/session";
import { BudgetExceededError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

/** Wait for an AbortSignal to fire, rejecting on abort. */
const waitForSignal = (signal: AbortSignal): Promise<never> => {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
};

describe("cancellation", () => {
  test("pre-aborted signal causes prompt to resolve immediately with stopReason cancelled", async () => {
    await using ctx = await connectMockHost();
    const sessionId = await ctx.host.newSession();
    const controller = new AbortController();
    controller.abort();

    const stream = ctx.host.prompt(sessionId, { prompt: "test", signal: controller.signal });
    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    const result = await stream.completion;
    expect(result.stopReason).toBe("cancelled");
    expect(events).toContain("finish");
  });

  test("AbortSignal fired mid-stream cancels the prompt", async () => {
    await using ctx = await connectMockHost({
      onPrompt: async function* (_sessionId, _blocks, signal) {
        yield { type: "text-delta" as const, text: "partial", messageId: undefined };
        // Block until the signal fires
        try {
          if (!signal) {
            throw new Error("mock host always supplies signal");
          }
          await waitForSignal(signal);
        } catch {
          // Signal aborted - stop generating
        }
      },
    });

    const sessionId = await ctx.host.newSession();
    const controller = new AbortController();

    const stream = ctx.host.prompt(sessionId, { prompt: "test", signal: controller.signal });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 20);

    for await (const _ of stream) {
      /* drain until cancelled or done */
    }
    const result = await stream.completion;

    expect(result.stopReason).toBe("cancelled");
  });

  test("stream.cancel() resolves and result has stopReason cancelled", async () => {
    await using ctx = await connectMockHost({
      // biome-ignore lint/correctness/useYield: blocks on the cancel signal; never reaches a yield by design
      onPrompt: async function* (_sessionId, _blocks, signal) {
        // Block until cancelled
        try {
          if (!signal) {
            throw new Error("mock host always supplies signal");
          }
          await waitForSignal(signal);
        } catch {
          // cancelled
        }
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "test" });

    setTimeout(() => void stream.cancel(), 20);

    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;
    expect(result.stopReason).toBe("cancelled");
  });

  test("host.cancel() on a session cancels the active prompt", async () => {
    await using ctx = await connectMockHost({
      // biome-ignore lint/correctness/useYield: blocks on the cancel signal; never reaches a yield by design
      onPrompt: async function* (_sessionId, _blocks, signal) {
        try {
          if (!signal) {
            throw new Error("mock host always supplies signal");
          }
          await waitForSignal(signal);
        } catch {
          // cancelled
        }
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "test" });

    setTimeout(() => void ctx.host.cancel(sessionId), 20);

    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;
    expect(result.stopReason).toBe("cancelled");
  });

  test("cancellation on an unknown session does not throw", async () => {
    await using ctx = await connectMockHost();
    // Should resolve silently even for an unknown session ID
    await expect(ctx.host.cancel("non-existent-session" as never)).resolves.toBeUndefined();
  });

  test("pre-aborted signal does not invoke the agent prompt handler", async () => {
    let promptCalled = false;
    await using ctx = await connectMockHost({
      // biome-ignore lint/correctness/useYield: this generator never yields by design — the test asserts the host short-circuits before invoking it
      onPrompt: function* (_sessionId, _blocks) {
        promptCalled = true;
      },
    });
    const sessionId = await ctx.host.newSession();
    const controller = new AbortController();
    controller.abort();

    const stream = ctx.host.prompt(sessionId, { prompt: "test", signal: controller.signal });
    for await (const _ of stream) {
      /* drain */
    }
    await stream.completion;

    // The agent-side prompt handler should not have been called
    expect(promptCalled).toBe(false);
  });

  test("session.ask cancels upstream when budget is exceeded mid-stream", async () => {
    let aborted = false;
    await using ctx = await connectMockHost({
      onPrompt: async function* (_sessionId, _blocks, signal) {
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
        yield { type: "usage", usage: { contextSize: 100, contextUsed: 1, costUsd: 1 } };
        await waitForSignal(signal ?? new AbortController().signal).catch(() => {});
      },
    });
    const session = await createSession(
      "mock" as never,
      {
        maxCostUsd: 0.01,
        _hostFactory: async () => ctx.host,
      } as ISessionOptionsInternal,
    );

    await expect(session.ask("test")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(aborted).toBe(true);
    await session.close();
  });
});
