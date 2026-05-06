import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isPathSafe } from "@/internal/is-path-safe";

describe("isPathSafe", () => {
  test("allows contained path", () => {
    expect(isPathSafe("/tmp/base", "/tmp/base/child")).toBe(true);
    expect(isPathSafe("/tmp/base", "/tmp/base/a/b/c")).toBe(true);
  });

  test("rejects path traversal", () => {
    expect(isPathSafe("/tmp/base", "/tmp/base/../other")).toBe(false);
    expect(isPathSafe("/tmp/base", "/tmp")).toBe(false);
    expect(isPathSafe("/tmp/base", "/tmp/base2")).toBe(false);
    expect(isPathSafe("/tmp/base", "/other/path")).toBe(false);
  });

  test("allows exact equality", () => {
    expect(isPathSafe("/tmp/base", "/tmp/base")).toBe(true);
    expect(isPathSafe("/tmp/base", "/tmp/base/")).toBe(true);
  });

  test("rejects prefix that is not a directory boundary", () => {
    expect(isPathSafe("/tmp/base", "/tmp/basename")).toBe(false);
    expect(isPathSafe("/tmp/base", "/tmp/base-extra")).toBe(false);
  });

  test("handles nested containment", () => {
    const base = join("/home", "user", "project");
    expect(isPathSafe(base, join(base, "src", "index.ts"))).toBe(true);
    expect(isPathSafe(base, join("/home", "user", "other"))).toBe(false);
  });
});
