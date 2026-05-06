import { describe, expect, test } from "bun:test";
import type { IStandardSchema } from "@/schema/standard";
import { createMockAgent, createRecorder, parseTranscript, replayTranscript } from "@/testing/index";
import type { TAgentEvent } from "@/types/events";

const numberAObject: IStandardSchema<{ a: number }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      if (typeof value === "object" && value !== null && typeof (value as { a?: unknown }).a === "number") {
        return { value: value as { a: number } };
      }
      return { issues: [{ message: "expected { a: number }" }] };
    },
  },
};

describe("createMockAgent", () => {
  test("scripts ask responses turn-by-turn", async () => {
    const mock = createMockAgent({ turns: [{ text: "first" }, { text: "second" }] });
    expect((await mock.ask("a")).text).toBe("first");
    expect((await mock.ask("b")).text).toBe("second");
  });

  test("falls back to defaultText after the script is exhausted", async () => {
    const mock = createMockAgent({ turns: [{ text: "one" }], defaultText: "fallback" });
    await mock.ask("first");
    const second = await mock.ask("second");
    expect(second.text).toBe("fallback");
  });

  test("stream emits scripted events and a final result", async () => {
    const mock = createMockAgent({
      turns: [
        {
          events: [
            { type: "text-delta", text: "hello", messageId: undefined },
            { type: "text-delta", text: " world", messageId: undefined },
          ],
          text: "hello world",
        },
      ],
    });
    const stream = mock.stream("hi");
    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
    }
    const result = await stream.result();
    expect(types).toContain("text-delta");
    expect(types).toContain("finish");
    expect(result.text).toBe("hello world");
  });

  test("enqueueTurn appends to the scripted queue at runtime", async () => {
    const mock = createMockAgent();
    mock.enqueueTurn({ text: "added" });
    const result = await mock.ask("ping");
    expect(result.text).toBe("added");
  });

  test("askJson parses the scripted text against a schema", async () => {
    const mock = createMockAgent({ turns: [{ text: '{"a":1}' }] });
    const result = await mock.askJson("get a", numberAObject);
    expect(result.data.a).toBe(1);
  });
});

describe("transcript record/replay", () => {
  test("records observed events and replays them in order", async () => {
    const recorder = createRecorder();
    const events: TAgentEvent[] = [
      { type: "text-delta", text: "abc", messageId: undefined },
      { type: "finish", stopReason: "end_turn", usage: undefined, cost: undefined },
    ];
    for (const event of events) {
      recorder.observe(event);
    }
    const json = recorder.toJSON();
    const parsed = parseTranscript(json);
    const collected: TAgentEvent[] = [];
    for await (const event of replayTranscript(parsed)) {
      collected.push(event);
    }
    expect(collected.length).toBe(events.length);
    expect(collected[0]?.type).toBe("text-delta");
    expect(collected[1]?.type).toBe("finish");
  });
});
