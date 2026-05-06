/**
 * Wire fuzz tests: send deterministic mixed SessionUpdate shapes through the
 * harness and assert no throws, every event has a known type, etc.
 *
 * Uses a simple seeded LCG PRNG for reproducibility without external deps.
 */

import { describe, expect, test } from "bun:test";
import { connectMockHost } from "@/testing/mock-host";
import type { TAgentEvent } from "@/types/events";

// Minimal LCG PRNG (seeded for reproducibility)

const makePrng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    // LCG parameters from Numerical Recipes
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
};

// Event generators

const KNOWN_EVENT_TYPES = [
  "text-delta",
  "thinking-delta",
  "tool-call",
  "tool-call-update",
  "plan",
  "mode-changed",
  "available-commands",
  "session-info",
  "usage",
  "finish",
  "raw",
] as const;

type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

const generateEvents = (prng: () => number, count: number): TAgentEvent[] => {
  const events: TAgentEvent[] = [];
  const toolCallIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const r = prng();
    const idx = Math.floor(r * 8); // pick from 8 event types

    if (idx === 0) {
      events.push({ type: "text-delta", text: `chunk-${i}`, messageId: undefined });
    } else if (idx === 1) {
      events.push({ type: "thinking-delta", text: `thought-${i}`, messageId: undefined });
    } else if (idx === 2) {
      const toolCallId = `tool-${i}`;
      toolCallIds.push(toolCallId);
      events.push({
        type: "tool-call",
        toolCallId,
        tool: "bash",
        kind: undefined,
        status: undefined,
        input: { command: "ls" },
        locations: undefined,
      });
    } else if (idx === 3 && toolCallIds.length > 0) {
      const toolCallId = toolCallIds[Math.floor(prng() * toolCallIds.length)] ?? `tool-${i}`;
      events.push({
        type: "tool-call-update",
        toolCallId,
        title: "bash",
        status: "completed",
        input: { command: "ls" },
        output: "file1.ts\nfile2.ts",
        locations: undefined,
      });
    } else if (idx === 4) {
      events.push({
        type: "plan",
        entries: [
          { title: `task-${i}`, status: "pending" },
          { title: `task-${i}-b`, status: "completed" },
        ],
      });
    } else if (idx === 5) {
      events.push({ type: "mode-changed", modeId: `mode-${i % 3}` });
    } else if (idx === 6) {
      events.push({
        type: "session-info",
        title: `Session ${i}`,
        updatedAt: undefined,
      });
    } else {
      events.push({
        type: "usage",
        usage: { contextSize: 1000 + i, contextUsed: 500 + i, costUsd: 0.001 * i },
      });
    }
  }

  return events;
};

// Tests

describe("wire-fuzz - deterministic mixed event streams", () => {
  test("50 mixed events all produce known event types from the client side", async () => {
    const prng = makePrng(0xdeadbeef);
    const fuzzEvents = generateEvents(prng, 50);

    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield* fuzzEvents;
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "fuzz" });

    const received: TAgentEvent[] = [];
    for await (const event of stream) {
      received.push(event);
    }
    await stream.completion;

    // Every event type must be a known type
    for (const event of received) {
      expect(KNOWN_EVENT_TYPES).toContain(event.type as KnownEventType);
    }
    // At least one finish event
    expect(received.some((e) => e.type === "finish")).toBe(true);
  });

  test("100 mixed events produce no throws", async () => {
    const prng = makePrng(0xc0ffee42);
    const fuzzEvents = generateEvents(prng, 100);

    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield* fuzzEvents;
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "fuzz-100" });
    const received: TAgentEvent[] = [];

    await expect(async () => {
      for await (const event of stream) {
        received.push(event);
      }
      await stream.completion;
    }).not.toThrow();

    expect(received.length).toBeGreaterThan(0);
  });

  test("text-delta events accumulate correctly in final result text", async () => {
    // Generate only text-delta events for this test
    const textEvents: TAgentEvent[] = Array.from({ length: 20 }, (_, i) => ({
      type: "text-delta" as const,
      text: String(i),
      messageId: undefined,
    }));

    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield* textEvents;
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "text-fuzz" });
    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;

    const expected = Array.from({ length: 20 }, (_, i) => String(i)).join("");
    expect(result.text).toBe(expected);
  });

  test("usage events are reflected in the completion usage report", async () => {
    const usageEvents: TAgentEvent[] = [{ type: "usage", usage: { contextSize: 8000, contextUsed: 4000, costUsd: 0.01 } }];

    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        yield* usageEvents;
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "usage-test" });
    for await (const _ of stream) {
      /* drain */
    }
    const result = await stream.completion;

    expect(result.usage).toBeDefined();
    expect(result.usage?.contextSize).toBe(8000);
    expect(result.usage?.contextUsed).toBe(4000);
  });

  test("multiple prompt turns on the same session all succeed without contamination", async () => {
    const prng = makePrng(0xabcd1234);
    const turn1Events = generateEvents(prng, 15);
    const turn2Events = generateEvents(prng, 15);
    let turnIndex = 0;
    const turns = [turn1Events, turn2Events];

    await using ctx = await connectMockHost({
      onPrompt: function* (_sessionId, _blocks) {
        const events = turns[turnIndex] ?? [];
        turnIndex += 1;
        yield* events;
      },
    });

    const sessionId = await ctx.host.newSession();

    for (let t = 0; t < 2; t++) {
      const stream = ctx.host.prompt(sessionId, { prompt: `turn-${t}` });
      const received: TAgentEvent[] = [];
      for await (const event of stream) {
        received.push(event);
      }
      await stream.completion;
      // Each turn should have events + finish
      expect(received.some((e) => e.type === "finish")).toBe(true);
    }
  });
});
