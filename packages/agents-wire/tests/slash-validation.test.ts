/**
 * Tests for Feature 2: Slash command validation
 *
 * The `validateSlashCommand` helper is exported from `src/runtime/host.ts`
 * so we can test it in isolation without spinning up an agent process.
 */
import { describe, expect, test } from "bun:test";
import { validateSlashCommand } from "@/runtime/host";
import { WireError } from "@/errors";

// ─── tests ───────────────────────────────────────────────────────────────────

describe("validateSlashCommand", () => {
  test("throws WireError when command is not in the advertised list", () => {
    expect(() =>
      validateSlashCommand(
        { name: "unknown-cmd" },
        [{ name: "create_plan", description: "Create a plan" }],
        "claude",
      ),
    ).toThrow(WireError);
  });

  test("error message contains the command name and agent id", () => {
    let caught: WireError | undefined;
    try {
      validateSlashCommand({ name: "bad-cmd" }, [{ name: "good-cmd", description: "Good" }], "cursor");
    } catch (e) {
      caught = e as WireError;
    }
    expect(caught).toBeInstanceOf(WireError);
    expect(caught?.message).toContain("bad-cmd");
    expect(caught?.message).toContain("cursor");
  });

  test("is permissive when availableCommands is undefined (not yet received)", () => {
    expect(() =>
      validateSlashCommand({ name: "any-cmd" }, undefined, "claude"),
    ).not.toThrow();
  });

  test("is permissive when availableCommands is an empty array", () => {
    expect(() =>
      validateSlashCommand({ name: "any-cmd" }, [], "claude"),
    ).not.toThrow();
  });

  test("allows command that IS in the advertised list", () => {
    expect(() =>
      validateSlashCommand(
        { name: "create_plan", input: "build feature X" },
        [
          { name: "create_plan", description: "Create a plan" },
          { name: "research_codebase" },
        ],
        "claude",
      ),
    ).not.toThrow();
  });

  test("no-ops when command is undefined (no slash command in request)", () => {
    expect(() =>
      validateSlashCommand(
        undefined,
        [{ name: "create_plan", description: "Create a plan" }],
        "claude",
      ),
    ).not.toThrow();
  });
});
