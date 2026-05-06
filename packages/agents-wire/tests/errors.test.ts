/**
 * Pure unit tests for error classes, isKnownError, isTransientError, errorMessage.
 * No harness or subprocess required.
 */

import { describe, expect, test } from "bun:test";
import {
  AbortError,
  AgentConnectionClosedError,
  AgentInactivityError,
  AgentInitTimeoutError,
  AgentNotInstalledError,
  AgentUnauthenticatedError,
  AgentUsageLimitError,
  BudgetExceededError,
  CapabilityNotSupportedError,
  errorMessage,
  isKnownError,
  isTransientError,
  JsonValidationError,
  KNOWN_ERROR_CODES,
  ProtocolVersionMismatchError,
  WireError,
} from "@/errors";

describe("WireError", () => {
  test("sets code and message", () => {
    const err = new WireError("stream-error", "test message");
    expect(err.code).toBe("stream-error");
    expect(err.message).toBe("test message");
  });

  test("sets agent field from options", () => {
    const err = new WireError("stream-error", "msg", { agent: "claude" });
    expect(err.agent).toBe("claude");
  });

  test("name is WireError", () => {
    expect(new WireError("abort", "x").name).toBe("WireError");
  });

  test("is instanceof Error", () => {
    expect(new WireError("abort", "x")).toBeInstanceOf(Error);
  });
});

describe("BudgetExceededError", () => {
  test("code is budget-exceeded", () => {
    const err = new BudgetExceededError(1.5, 1.0);
    expect(err.code).toBe("budget-exceeded");
  });

  test("spentUsd and budgetUsd fields are set", () => {
    const err = new BudgetExceededError(2.5, 2.0);
    expect(err.spentUsd).toBe(2.5);
    expect(err.budgetUsd).toBe(2.0);
  });

  test("message includes amounts", () => {
    const err = new BudgetExceededError(1.5, 1.0);
    expect(err.message).toContain("1.5");
    expect(err.message).toContain("1.0");
  });

  test("is instanceof WireError", () => {
    expect(new BudgetExceededError(1, 2)).toBeInstanceOf(WireError);
  });

  test("name is BudgetExceededError", () => {
    expect(new BudgetExceededError(1, 2).name).toBe("BudgetExceededError");
  });
});

describe("AgentInactivityError", () => {
  test("code is inactivity-timeout", () => {
    const err = new AgentInactivityError("claude", "sess-1", 30_000);
    expect(err.code).toBe("inactivity-timeout");
  });

  test("elapsedMs field is set", () => {
    const err = new AgentInactivityError("claude", "sess-1", 12_345);
    expect(err.elapsedMs).toBe(12_345);
  });

  test("agent field is set", () => {
    const err = new AgentInactivityError("gemini", "sess-2", 1000);
    expect(err.agent).toBe("gemini");
  });

  test("is instanceof WireError", () => {
    expect(new AgentInactivityError("claude", "s", 1)).toBeInstanceOf(WireError);
  });
});

describe("AgentInitTimeoutError", () => {
  test("code is init-timeout", () => {
    const err = new AgentInitTimeoutError("claude", 30_000);
    expect(err.code).toBe("init-timeout");
  });

  test("timeoutMs field is set", () => {
    const err = new AgentInitTimeoutError("claude", 5_000);
    expect(err.timeoutMs).toBe(5_000);
  });

  test("name is AgentInitTimeoutError", () => {
    expect(new AgentInitTimeoutError("claude", 1).name).toBe("AgentInitTimeoutError");
  });
});

describe("AgentUnauthenticatedError", () => {
  test("code is auth-required", () => {
    const err = new AgentUnauthenticatedError("claude", "Please login");
    expect(err.code).toBe("auth-required");
  });

  test("loginCommand is set when provided", () => {
    const err = new AgentUnauthenticatedError("claude", "login", "claude /login");
    expect(err.loginCommand).toBe("claude /login");
  });

  test("loginCommand is undefined when not provided", () => {
    const err = new AgentUnauthenticatedError("claude", "login");
    expect(err.loginCommand).toBeUndefined();
  });

  test("is instanceof WireError", () => {
    expect(new AgentUnauthenticatedError("claude", "x")).toBeInstanceOf(WireError);
  });
});

describe("AgentUsageLimitError", () => {
  test("code is usage-limit", () => {
    const err = new AgentUsageLimitError("claude", "Quota exceeded");
    expect(err.code).toBe("usage-limit");
  });

  test("agent field is set", () => {
    const err = new AgentUsageLimitError("gemini", "Quota exceeded");
    expect(err.agent).toBe("gemini");
  });

  test("name is AgentUsageLimitError", () => {
    expect(new AgentUsageLimitError("claude", "x").name).toBe("AgentUsageLimitError");
  });
});

describe("ProtocolVersionMismatchError", () => {
  test("code is protocol-mismatch", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.code).toBe("protocol-mismatch");
  });

  test("clientVersion and agentVersion are set", () => {
    const err = new ProtocolVersionMismatchError("claude", 1, 99);
    expect(err.clientVersion).toBe(1);
    expect(err.agentVersion).toBe(99);
  });

  test("name is ProtocolVersionMismatchError", () => {
    expect(new ProtocolVersionMismatchError("claude", 1, 2).name).toBe("ProtocolVersionMismatchError");
  });
});

describe("CapabilityNotSupportedError", () => {
  test("code is capability-not-supported", () => {
    const err = new CapabilityNotSupportedError("claude", "sessionCapabilities.list");
    expect(err.code).toBe("capability-not-supported");
  });

  test("capability field is set", () => {
    const err = new CapabilityNotSupportedError("claude", "mcpCapabilities.http");
    expect(err.capability).toBe("mcpCapabilities.http");
  });
});

describe("AgentConnectionClosedError", () => {
  test("code is connection-closed", () => {
    const err = new AgentConnectionClosedError("claude", 1, null);
    expect(err.code).toBe("connection-closed");
  });

  test("exitCode and signal fields are set", () => {
    const err = new AgentConnectionClosedError("claude", 42, "SIGTERM");
    expect(err.exitCode).toBe(42);
    expect(err.signal).toBe("SIGTERM");
  });

  test("stderrTail is preserved", () => {
    const tail = ["line1", "line2"];
    const err = new AgentConnectionClosedError("claude", 1, null, tail);
    expect(err.stderrTail).toEqual(tail);
  });

  test("is instanceof WireError", () => {
    expect(new AgentConnectionClosedError("claude", 1, null)).toBeInstanceOf(WireError);
  });
});

describe("AgentNotInstalledError", () => {
  test("code is agent-not-installed", () => {
    const err = new AgentNotInstalledError("cursor", "Install cursor first");
    expect(err.code).toBe("agent-not-installed");
  });

  test("installHint field is set", () => {
    const err = new AgentNotInstalledError("cursor", "Install from cursor.sh");
    expect(err.installHint).toBe("Install from cursor.sh");
  });
});

describe("AbortError", () => {
  test("code is abort", () => {
    expect(new AbortError().code).toBe("abort");
  });

  test("default message is set", () => {
    expect(new AbortError().message).toBe("Operation aborted");
  });
});

describe("JsonValidationError", () => {
  test("code is json-validation", () => {
    const err = new JsonValidationError("bad json", "raw text", []);
    expect(err.code).toBe("json-validation");
  });

  test("text and issues fields are set", () => {
    const issues = [{ message: "Expected number" }];
    const err = new JsonValidationError("invalid", "raw", issues);
    expect(err.text).toBe("raw");
    expect(err.issues).toEqual(issues);
  });
});

describe("isKnownError", () => {
  test("returns true for WireError", () => {
    expect(isKnownError(new WireError("abort", "x"))).toBe(true);
  });

  test("returns true for all subclasses", () => {
    expect(isKnownError(new BudgetExceededError(1, 2))).toBe(true);
    expect(isKnownError(new AgentInactivityError("claude", "s", 1))).toBe(true);
    expect(isKnownError(new ProtocolVersionMismatchError("claude", 1, 2))).toBe(true);
    expect(isKnownError(new AgentUnauthenticatedError("claude", "x"))).toBe(true);
    expect(isKnownError(new AgentUsageLimitError("claude", "x"))).toBe(true);
  });

  test("returns false for plain Error", () => {
    expect(isKnownError(new Error("x"))).toBe(false);
  });

  test("returns false for string", () => {
    expect(isKnownError("error")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isKnownError(null)).toBe(false);
  });
});

describe("isTransientError", () => {
  test("connection-closed WireError is transient", () => {
    expect(isTransientError(new AgentConnectionClosedError("claude", 1, null))).toBe(true);
  });

  test("overloaded WireError is transient", () => {
    expect(isTransientError(new WireError("overloaded", "overloaded"))).toBe(true);
  });

  test("rate-limit WireError is transient", () => {
    expect(isTransientError(new WireError("rate-limit", "rate limit"))).toBe(true);
  });

  test("auth-required is NOT transient", () => {
    expect(isTransientError(new AgentUnauthenticatedError("claude", "x"))).toBe(false);
  });

  test("budget-exceeded is NOT transient", () => {
    expect(isTransientError(new BudgetExceededError(1, 2))).toBe(false);
  });

  test("plain Error with ECONNRESET is transient", () => {
    expect(isTransientError(new Error("ECONNRESET socket hangup"))).toBe(true);
  });

  test("plain non-transient Error is not transient", () => {
    expect(isTransientError(new Error("something unrelated"))).toBe(false);
  });
});

describe("errorMessage", () => {
  test("returns message for Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("returns the string directly", () => {
    expect(errorMessage("raw string")).toBe("raw string");
  });

  test("JSON-serializes unknown values", () => {
    expect(errorMessage({ code: 42 })).toBe('{"code":42}');
  });

  test("falls back to String() for non-serializable", () => {
    // Circular object is not serializable - falls back to String()
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const msg = errorMessage(obj);
    expect(typeof msg).toBe("string");
  });
});

describe("KNOWN_ERROR_CODES", () => {
  test("includes expected codes", () => {
    const codes = [...KNOWN_ERROR_CODES];
    expect(codes).toContain("connection-closed");
    expect(codes).toContain("auth-required");
    expect(codes).toContain("protocol-mismatch");
    expect(codes).toContain("budget-exceeded");
    expect(codes).toContain("inactivity-timeout");
    expect(codes).toContain("init-timeout");
  });
});
