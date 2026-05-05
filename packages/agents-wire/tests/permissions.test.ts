import { describe, expect, test } from "bun:test";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { allowGate, allowOnceGate, denyGate, isStreamingPolicy, policyToResolver } from "@/runtime/permissions";

const buildRequest = (kinds: readonly string[]): RequestPermissionRequest => ({
  sessionId: "s-1",
  options: kinds.map((kind, index) => ({
    optionId: `opt-${index}`,
    name: kind,
    kind: kind as RequestPermissionRequest["options"][number]["kind"],
  })),
  toolCall: { toolCallId: "tc-1", title: "Bash" },
});

describe("permission gates", () => {
  test("allowGate prefers allow_always", async () => {
    const response = await allowGate(buildRequest(["allow_always", "allow_once", "reject_once"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-0" });
  });

  test("allowOnceGate prefers allow_once", async () => {
    const response = await allowOnceGate(buildRequest(["allow_always", "allow_once", "reject_once"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-1" });
  });

  test("denyGate prefers reject_once", async () => {
    const response = await denyGate(buildRequest(["allow_always", "reject_once", "reject_always"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-1" });
  });

  test("falls back to first option when no match", async () => {
    const response = await allowGate(buildRequest(["unknown_kind"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-0" });
  });

  test("returns cancelled when no options exist", async () => {
    const response = await allowGate({
      sessionId: "s-1",
      options: [],
      toolCall: { toolCallId: "tc-1", title: "Bash" },
    });
    expect(response.outcome).toEqual({ outcome: "cancelled" });
  });
});

describe("policyToResolver", () => {
  test("maps named policies to gates", async () => {
    const resolver = policyToResolver("auto-allow");
    const response = await resolver(buildRequest(["allow_always"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-0" });
  });

  test("forwards a custom function policy", async () => {
    const resolver = policyToResolver(async () => "cancel");
    const response = await resolver(buildRequest(["allow_always"]));
    expect(response.outcome).toEqual({ outcome: "cancelled" });
  });

  test("converts a function-returned id to a select outcome", async () => {
    const resolver = policyToResolver(async () => ({ id: "opt-7" }));
    const response = await resolver(buildRequest(["allow_always"]));
    expect(response.outcome).toEqual({ outcome: "selected", optionId: "opt-7" });
  });
});

describe("isStreamingPolicy", () => {
  test("only stream returns true", () => {
    expect(isStreamingPolicy("stream")).toBe(true);
    expect(isStreamingPolicy("auto-allow")).toBe(false);
    expect(isStreamingPolicy()).toBe(false);
  });
});
