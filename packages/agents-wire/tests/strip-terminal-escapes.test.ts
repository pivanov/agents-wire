import { describe, expect, test } from "bun:test";
import { redactSecrets } from "@/errors";
import { stripTerminalEscapes } from "@/internal/strip-terminal-escapes";

describe("stripTerminalEscapes", () => {
  test("strips OSC title-set sequences", () => {
    expect(stripTerminalEscapes("\x1b]2;evil title\x07")).toBe("");
    expect(stripTerminalEscapes("\x1b]0;window title\x1b\\")).toBe("");
  });

  test("strips CSI cursor-move sequences", () => {
    expect(stripTerminalEscapes("\x1b[2J")).toBe("");
    expect(stripTerminalEscapes("\x1b[1;1H")).toBe("");
    expect(stripTerminalEscapes("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("strips DCS sequences", () => {
    expect(stripTerminalEscapes("\x1bPsome data\x1b\\")).toBe("");
  });

  test("strips simple ESC sequences", () => {
    expect(stripTerminalEscapes("\x1b=")).toBe("");
    expect(stripTerminalEscapes("\x1b>")).toBe("");
  });

  test("strips C1 control characters", () => {
    expect(stripTerminalEscapes("\x84\x8d\x9b")).toBe("");
  });

  test("plain text passthrough", () => {
    const text = "hello world\nfoo\tbar";
    expect(stripTerminalEscapes(text)).toBe(text);
  });

  test("preserves newlines and tabs", () => {
    expect(stripTerminalEscapes("line1\nline2\ttabbed")).toBe("line1\nline2\ttabbed");
  });
});

describe("redactSecrets integration", () => {
  test("strips OSC escape hiding a password before redaction", () => {
    // The OSC sequence wraps a fake title; what follows is a key=value secret.
    // "password=" + 40-char hex value matches SECRET_PATTERNS after escape removal.
    // The entire "password=<hex>" match is replaced, so result is just "[REDACTED]".
    const hexSecret = "a".repeat(40);
    const input = `\x1b]2;evil\x07password=${hexSecret}`;
    const result = redactSecrets(input);
    expect(result).toBe("[REDACTED]");
  });

  test("redacts token embedded after OSC sequence", () => {
    const input = "\x1b]2;title\x07Bearer sk-abc1234567890123456789012345678901234567890";
    const result = redactSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-");
  });
});
