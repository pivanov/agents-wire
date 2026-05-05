import { describe, expect, test } from "bun:test";
import { whichBin } from "@/internal/which-bin";

describe("whichBin", () => {
  test("finds a known PATH binary (sh on POSIX, cmd.exe on Windows)", () => {
    const found = process.platform === "win32" ? whichBin("cmd") : whichBin("sh");
    expect(found).toBeDefined();
    expect(found).toMatch(process.platform === "win32" ? /cmd\.exe$/i : /\/sh$/);
  });

  test("returns undefined for a name that does not exist on PATH", () => {
    expect(whichBin("agents-wire-definitely-not-a-real-binary-xyz")).toBeUndefined();
  });

  test("returns undefined when PATH is empty", () => {
    const original = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(whichBin("sh")).toBeUndefined();
    } finally {
      process.env.PATH = original;
    }
  });
});
