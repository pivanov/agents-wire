import { describe, expect, test } from "bun:test";
import { CapabilityNotSupportedError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

describe("host.loadSession", () => {
  test("throws CapabilityNotSupportedError when agent does not advertise loadSession", async () => {
    await using ctx = await connectMockHost({
      capabilities: { loadSession: false },
    });
    let caught: unknown;
    try {
      await ctx.host.loadSession({ sessionId: "previous-session-id" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
  });

  test("returns the requested sessionId verbatim when capability is present", async () => {
    await using ctx = await connectMockHost({
      capabilities: { loadSession: true },
    });
    const id = await ctx.host.loadSession({ sessionId: "previous-session-id" });
    expect(id).toBe("previous-session-id");
  });

  test("loaded session can immediately be used for prompt()", async () => {
    await using ctx = await connectMockHost({
      capabilities: { loadSession: true },
      onPrompt: function* () {
        yield { type: "text-delta", text: "resumed", messageId: undefined };
      },
    });
    const sid = await ctx.host.loadSession({ sessionId: "session-abc" });
    const stream = ctx.host.prompt(sid, { prompt: "continue" });
    const events: string[] = [];
    for await (const ev of stream) {
      if (ev.type === "text-delta") {
        events.push(ev.text);
      }
    }
    const result = await stream.completion;
    expect(events).toEqual(["resumed"]);
    expect(result.text).toBe("resumed");
  });
});
