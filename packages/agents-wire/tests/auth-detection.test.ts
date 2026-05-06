import { describe, expect, test } from "bun:test";
import { AUTH_FAILURE_PATTERNS, USAGE_LIMIT_PATTERNS } from "@/constants";
import { AgentUnauthenticatedError, AgentUsageLimitError, WireError } from "@/errors";
import { classifyStderrFatal } from "@/runtime/host";
import { connectMockHost } from "@/testing/mock-host";

describe("classifyStderrFatal", () => {
  test("returns undefined when no pattern matches", () => {
    const result = classifyStderrFatal("Starting up agent normally", [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result).toBeUndefined();
  });

  test("returns { kind: 'auth' } on auth pattern match", () => {
    const result = classifyStderrFatal("invalid api key provided", [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result?.kind).toBe("auth");
  });

  test("returns { kind: 'usage' } on usage pattern match", () => {
    const result = classifyStderrFatal("rate limit exceeded, try again later", [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result?.kind).toBe("usage");
  });

  test("usage patterns take priority over auth when both match", () => {
    // "usage limit" is a usage pattern; "unauthorized" is an auth pattern
    // craft a line that hits both
    const result = classifyStderrFatal("unauthorized due to usage limit exceeded", [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result?.kind).toBe("usage");
  });

  test("matching is case-insensitive", () => {
    const result = classifyStderrFatal("INVALID API KEY", [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result?.kind).toBe("auth");
  });

  test("line is preserved in match result", () => {
    const line = "Please run `claude login`";
    const result = classifyStderrFatal(line, [...AUTH_FAILURE_PATTERNS], [...USAGE_LIMIT_PATTERNS]);
    expect(result?.line).toBe(line);
  });

  test("per-agent patterns override global - agent-specific pattern matches", () => {
    const agentPatterns = ["GEMINI_API_KEY"];
    const result = classifyStderrFatal("Please set GEMINI_API_KEY to continue", agentPatterns, [...USAGE_LIMIT_PATTERNS]);
    expect(result?.kind).toBe("auth");
  });

  test("per-agent patterns override global - global pattern does not match if not in agent list", () => {
    // Only use a very specific agent pattern that doesn't include "unauthorized"
    const agentPatterns = ["please run `claude login`"];
    const result = classifyStderrFatal("unauthorized", agentPatterns, [...USAGE_LIMIT_PATTERNS]);
    // "unauthorized" is not in agentPatterns, so no auth match
    expect(result).toBeUndefined();
  });
});

describe("AgentUnauthenticatedError", () => {
  test("sets code to auth-required", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login");
    expect(err.code).toBe("auth-required");
  });

  test("sets agent field", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login");
    expect(err.agent).toBe("claude");
  });

  test("sets loginCommand when provided", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login", "claude /login");
    expect(err.loginCommand).toBe("claude /login");
  });

  test("loginCommand is undefined when not provided", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login");
    expect(err.loginCommand).toBeUndefined();
  });

  test("is instanceof WireError", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login");
    expect(err).toBeInstanceOf(WireError);
  });
});

describe("AgentUsageLimitError", () => {
  test("sets code to usage-limit", () => {
    const err = new AgentUsageLimitError("claude", "Usage limit reached");
    expect(err.code).toBe("usage-limit");
  });

  test("sets agent field", () => {
    const err = new AgentUsageLimitError("gemini", "Quota exceeded");
    expect(err.agent).toBe("gemini");
  });

  test("is instanceof WireError", () => {
    const err = new AgentUsageLimitError("claude", "Usage limit reached");
    expect(err).toBeInstanceOf(WireError);
  });
});

// NOTE: pushStderr on IConnectedMockHost only appends to the tail buffer; it does NOT
// route through the host's wrappedOnStderr callback (which is wired via launchAgent's onStderr
// option that is bypassed when using _connection). A full end-to-end test would require either
// routing the onStderr callback through the fake connection, or spawning a real subprocess.
// The unit tests for classifyStderrFatal above cover the detection logic in full.
test("host operates normally when no fatal stderr is pushed", async () => {
  await using ctx = await connectMockHost({
    onPrompt: function* (_sessionId, _blocks) {
      yield { type: "text-delta" as const, text: "ok", messageId: undefined };
    },
  });
  // Push a line that would match auth pattern to the tail buffer
  ctx.pushStderr("invalid api key provided");
  const sessionId = await ctx.host.newSession();
  const stream = ctx.host.prompt(sessionId, { prompt: "test" });
  for await (const _ of stream) {
    /* drain */
  }
  const result = await stream.completion;
  // Since pushStderr doesn't trigger wrappedOnStderr, no auth error fires
  expect(result.stopReason).toBe("end_turn");
  expect(result.text).toBe("ok");
});
