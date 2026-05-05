import { describe, expect, test } from "bun:test";
import { createToolHandler } from "@/tools/handler";
import type { IToolUseEvent } from "@/types/options";

const event: IToolUseEvent = {
  toolCallId: "call-1",
  tool: "Bash",
  input: { command: "ls" },
  agent: "claude",
  sessionId: "s-1",
};

describe("createToolHandler", () => {
  test("default handler allows everything", async () => {
    const handler = createToolHandler();
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("allow");
  });

  test("denies when tool is not in allowed list", async () => {
    const handler = createToolHandler({ allowed: ["Read"] });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("Bash");
  });

  test("allows when tool is in allowed list", async () => {
    const handler = createToolHandler({ allowed: ["Bash", "Read"] });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("allow");
  });

  test("denies blocked tools", async () => {
    const handler = createToolHandler({ blocked: ["Bash"] });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("blocked");
  });

  test("invokes onToolUse callback for fine-grained control", async () => {
    let observed: IToolUseEvent | undefined;
    const handler = createToolHandler({
      onToolUse: (e) => {
        observed = e;
        return { decision: "deny", reason: "policy" };
      },
    });
    const decision = await handler.resolve(event);
    expect(observed?.toolCallId).toBe("call-1");
    expect(decision).toEqual({ decision: "deny", reason: "policy" });
  });

  test("supports rewrite-input decisions", async () => {
    const handler = createToolHandler({
      onToolUse: () => ({ decision: "rewrite-input", input: { command: "echo safe" } }),
    });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("rewrite-input");
    expect(decision.input).toEqual({ command: "echo safe" });
  });

  test("falls back to onError when onToolUse throws", async () => {
    const handler = createToolHandler({
      onToolUse: () => {
        throw new Error("user code blew up");
      },
      onError: () => "allow",
    });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("allow");
  });

  test("denies by default when onToolUse throws and no onError", async () => {
    const handler = createToolHandler({
      onToolUse: () => {
        throw new Error("boom");
      },
    });
    const decision = await handler.resolve(event);
    expect(decision.decision).toBe("deny");
  });
});
