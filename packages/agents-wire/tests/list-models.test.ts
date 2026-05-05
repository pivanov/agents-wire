import { describe, expect, test } from "bun:test";
import { listAuggieModels, listCursorModels, listKiloModels, listOpencodeModels, parseAuggieModels, parseCursorModels, parseKiloModels, parseOpencodeModels } from "@/internal/list-models";
import { cursor } from "@/catalog/cursor";
import { opencode } from "@/catalog/opencode";

describe("parseCursorModels", () => {
  test("parses live cursor-agent --list-models output", () => {
    const raw = `Loading models…
Available models

auto - Auto
composer-2-fast - Composer 2 Fast  (current, default)
composer-2 - Composer 2
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex-high - Codex 5.3 High
gpt-5.3-codex-xhigh - Codex 5.3 Extra High
gpt-5.2 - GPT-5.2`;
    const models = parseCursorModels(raw);
    expect(models.length).toBe(7);
    expect(models[0]).toEqual({ id: "auto", label: "Auto" });
    expect(models[1]).toEqual({ id: "composer-2-fast", label: "Composer 2 Fast" });
    expect(models.find((m) => m.id === "gpt-5.3-codex-xhigh")?.label).toBe("Codex 5.3 Extra High");
  });

  test("strips ANSI escape codes from terminal output", () => {
    const raw = "\x1b[2K\x1b[Gauto - Auto\nclaude - Claude";
    const models = parseCursorModels(raw);
    expect(models.length).toBe(2);
    expect(models[0]?.id).toBe("auto");
  });

  test("returns empty array on empty input", () => {
    expect(parseCursorModels("")).toEqual([]);
  });

  test("ignores header and loading lines", () => {
    const raw = "Loading models…\nAvailable models\n\nfoo - Foo";
    const models = parseCursorModels(raw);
    expect(models).toEqual([{ id: "foo", label: "Foo" }]);
  });
});

describe("parseOpencodeModels", () => {
  test("parses live opencode models output", () => {
    const raw = `opencode/big-pickle
opencode/gpt-5-nano
opencode/hy3-preview-free
anthropic/claude-sonnet-4-6`;
    const models = parseOpencodeModels(raw);
    expect(models.length).toBe(4);
    expect(models[0]).toEqual({ id: "opencode/big-pickle", label: "opencode/big-pickle" });
    expect(models[3]?.id).toBe("anthropic/claude-sonnet-4-6");
  });

  test("skips lines without a slash (non-model output)", () => {
    const raw = "Loading…\nopencode/foo\nsome header line\nopencode/bar";
    const models = parseOpencodeModels(raw);
    expect(models.map((m) => m.id)).toEqual(["opencode/foo", "opencode/bar"]);
  });

  test("returns empty array on empty input", () => {
    expect(parseOpencodeModels("")).toEqual([]);
  });
});

describe("parseKiloModels", () => {
  test("parses live kilo models output", () => {
    const raw = `anthropic/claude-sonnet-4-5
openai/gpt-5
google/gemini-2.0-flash
kilo-auto/frontier`;
    const models = parseKiloModels(raw);
    expect(models.length).toBe(4);
    expect(models[0]).toEqual({ id: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" });
    expect(models[3]?.id).toBe("kilo-auto/frontier");
  });

  test("strips trailing whitespace decorations", () => {
    const raw = "anthropic/claude-sonnet-4-5  (default)\nopenai/gpt-5  active";
    const models = parseKiloModels(raw);
    expect(models.map((m) => m.id)).toEqual(["anthropic/claude-sonnet-4-5", "openai/gpt-5"]);
  });

  test("skips lines without a slash", () => {
    const raw = "Loading...\nanthropic/claude\nheader\nopenai/gpt-5";
    const models = parseKiloModels(raw);
    expect(models.map((m) => m.id)).toEqual(["anthropic/claude", "openai/gpt-5"]);
  });

  test("returns empty array on empty input", () => {
    expect(parseKiloModels("")).toEqual([]);
  });
});

describe("parseAuggieModels", () => {
  test("parses simple model list output (id per line)", () => {
    const raw = "claude-sonnet-4-5\ngpt-5\ngemini-2.0-flash";
    const models = parseAuggieModels(raw);
    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4-5", "gpt-5", "gemini-2.0-flash"]);
  });

  test("strips bullet / hyphen decorations", () => {
    const raw = "- claude-sonnet-4-5\n* gpt-5\n• gemini-pro";
    const models = parseAuggieModels(raw);
    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4-5", "gpt-5", "gemini-pro"]);
  });

  test("returns empty when not logged in", () => {
    const raw = "You are not currently logged in to Augment.\nRun 'auggie login' to authenticate first.";
    const models = parseAuggieModels(raw);
    expect(models).toEqual([]);
  });

  test("returns empty array on empty input", () => {
    expect(parseAuggieModels("")).toEqual([]);
  });

  test("skips header / loading lines", () => {
    const raw = "Available models:\nLoading...\nclaude-sonnet-4-5";
    const models = parseAuggieModels(raw);
    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4-5"]);
  });
});

describe("catalog wiring", () => {
  test("cursor.listAvailableModels is a function", () => {
    expect(typeof cursor.listAvailableModels).toBe("function");
  });

  test("opencode.listAvailableModels is a function", () => {
    expect(typeof opencode.listAvailableModels).toBe("function");
  });

  test("listCursorModels with non-existent binary returns empty array (no throw)", async () => {
    const models = await listCursorModels("/nonexistent/binary");
    expect(models).toEqual([]);
  });

  test("listOpencodeModels with non-existent binary returns empty array (no throw)", async () => {
    const models = await listOpencodeModels("/nonexistent/binary");
    expect(models).toEqual([]);
  });

  test("listKiloModels with non-existent binary returns empty array (no throw)", async () => {
    const models = await listKiloModels("/nonexistent/binary");
    expect(models).toEqual([]);
  });

  test("listAuggieModels with non-existent binary returns empty array (no throw)", async () => {
    const models = await listAuggieModels("/nonexistent/binary");
    expect(models).toEqual([]);
  });

  test("captureStdout truncates runaway output (1 MB cap)", async () => {
    // /usr/bin/yes spews 'y\n' indefinitely; we should cap, not OOM.
    // listOpencodeModels reuses captureStdout internally - reuse it as the harness.
    // We're not actually parsing yes's output as opencode models; we just verify
    // the call resolves quickly without crashing or hanging.
    const start = Date.now();
    const models = await listOpencodeModels("/usr/bin/yes");
    const elapsed = Date.now() - start;
    // Should resolve well under the 5s timeout (truncation kicks in much faster).
    expect(elapsed).toBeLessThan(2_000);
    // 'y\n' lines have no slash; opencode parser drops them all.
    expect(models).toEqual([]);
  });
});
