/**
 * Inactivity watchdog tests.
 *
 * Uses a short inactivityTimeoutMs (50ms) so real timers fire quickly.
 * The _clock option lets us control what "now" means for elapsed tracking.
 */

import { describe, expect, test } from "bun:test";
import { connectMockHost } from "@/testing/mock-host";
import { AgentInactivityError } from "@/errors";

const SHORT_TIMEOUT = 50; // ms

describe("inactivity watchdog", () => {
  test("AgentInactivityError fires from stream iteration when agent hangs", async () => {
    let unblock: (() => void) | undefined;

    await using ctx = await connectMockHost(
      {
        onPrompt: async function* (_sessionId, _blocks, signal) {
          // Block without sending any activity
          await new Promise<void>((resolve) => {
            unblock = resolve;
            // Also unblock if the signal fires (cancelled)
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      { options: { inactivityTimeoutMs: SHORT_TIMEOUT } },
    );

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hang" });
    // Suppress unhandled rejection on completion
    stream.completion.catch(() => {});

    let caught: unknown;
    try {
      for await (const _ of stream) { /* drain */ }
    } catch (err) {
      caught = err;
    } finally {
      // Release the blocked promise to avoid leaks
      unblock?.();
    }

    expect(caught).toBeInstanceOf(AgentInactivityError);
    expect((caught as AgentInactivityError).code).toBe("inactivity-timeout");
  });

  test("AgentInactivityError fires from completion promise when agent hangs", async () => {
    let unblock: (() => void) | undefined;

    await using ctx = await connectMockHost(
      {
        onPrompt: async function* (_sessionId, _blocks, signal) {
          await new Promise<void>((resolve) => {
            unblock = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      { options: { inactivityTimeoutMs: SHORT_TIMEOUT } },
    );

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hang" });

    let caught: unknown;
    try {
      await stream.completion;
    } catch (err) {
      caught = err;
    } finally {
      unblock?.();
    }

    expect(caught).toBeInstanceOf(AgentInactivityError);
    expect((caught as AgentInactivityError).agent).toBe("mock");
  });

  test("activity events reset the inactivity timer - no timeout fires", async () => {
    // Send activity every 20ms, timeout is 50ms
    // Prompt completes after 3 rounds of activity, well within the per-activity window
    let promptResolve: (() => void) | undefined;

    await using ctx = await connectMockHost(
      {
        onPrompt: async function* (_sessionId, _blocks) {
          // Emit activity 3 times with 20ms gaps (< 50ms timeout each)
          for (let i = 0; i < 3; i++) {
            yield { type: "text-delta" as const, text: `chunk-${i}`, messageId: undefined };
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          }
          promptResolve?.();
        },
      },
      { options: { inactivityTimeoutMs: SHORT_TIMEOUT } },
    );

    // Start a promise that will resolve when prompt is done
    const promptDonePromise = new Promise<void>((resolve) => {
      promptResolve = resolve;
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "active" });

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    await stream.completion;
    await promptDonePromise;

    // Should complete normally with text-delta events, no AgentInactivityError
    expect(events).toContain("text-delta");
    expect(events).toContain("finish");
    expect(events.filter((t) => t === "text-delta").length).toBe(3);
  });

  test("inactivity error includes elapsedMs >= timeout", async () => {
    let unblock: (() => void) | undefined;

    await using ctx = await connectMockHost(
      {
        onPrompt: async function* (_sessionId, _blocks, signal) {
          await new Promise<void>((resolve) => {
            unblock = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      { options: { inactivityTimeoutMs: SHORT_TIMEOUT } },
    );

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hang" });

    let caught: unknown;
    try {
      await stream.completion;
    } catch (err) {
      caught = err;
    } finally {
      unblock?.();
    }

    expect(caught).toBeInstanceOf(AgentInactivityError);
    expect((caught as AgentInactivityError).elapsedMs).toBeGreaterThanOrEqual(SHORT_TIMEOUT);
  });

  test("inactivity timeout of 0 disables the watchdog", async () => {
    let unblock: (() => void) | undefined;

    // Use a very short-lived prompt that resolves via triggerExit so we don't hang
    await using ctx = await connectMockHost(
      {
        onPrompt: async function* (_sessionId, _blocks) {
          await new Promise<void>((resolve) => {
            unblock = resolve;
          });
        },
      },
      { options: { inactivityTimeoutMs: 0 } },
    );

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hang" });

    // Wait 150ms - far beyond a 50ms timeout would fire, but with 0ms it should NOT fire
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    // Unblock the prompt so the test can finish
    unblock?.();

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }
    await stream.completion;

    // No AgentInactivityError - should have finish
    expect(events).toContain("finish");
  });
});
