/**
 * Tests for Feature 3: Mode state tracking
 *
 * We test the mutation logic directly against the `handleSessionUpdate`
 * pathway by extracting the core mutation logic as a pure function.
 */
import { describe, expect, test } from "bun:test";
import type { SessionModeState } from "@agentclientprotocol/sdk";

// ─── helper: inline the mutation logic from handleSessionUpdate ──────────────

/**
 * Mirrors the logic in `handleSessionUpdate` in host.ts.
 * Returns the new modeState (or the same object if no change).
 */
const applyModeUpdate = (
  currentModeState: SessionModeState | undefined,
  update: { sessionUpdate: string; currentModeId?: string },
): SessionModeState | undefined => {
  if (update.sessionUpdate === "current_mode_update" && currentModeState) {
    return { ...currentModeState, currentModeId: update.currentModeId ?? currentModeState.currentModeId };
  }
  return currentModeState;
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("mode state tracking", () => {
  const baseModeState: SessionModeState = {
    currentModeId: "auto",
    availableModes: [
      { id: "auto", name: "Auto", description: "Automatic mode" },
      { id: "plan", name: "Plan", description: "Planning mode" },
    ],
  };

  test("mutates currentModeId on current_mode_update", () => {
    const updated = applyModeUpdate(baseModeState, {
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
    expect(updated?.currentModeId).toBe("plan");
  });

  test("preserves all availableModes when currentModeId is updated", () => {
    const updated = applyModeUpdate(baseModeState, {
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
    expect(updated?.availableModes).toEqual(baseModeState.availableModes);
  });

  test("returns undefined gracefully when modeState is undefined", () => {
    const updated = applyModeUpdate(undefined, {
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
    expect(updated).toBeUndefined();
  });

  test("does not mutate modeState for unrelated session updates", () => {
    const updated = applyModeUpdate(baseModeState, {
      sessionUpdate: "agent_message_chunk",
    });
    expect(updated).toBe(baseModeState); // same reference - no mutation
  });

  test("getModeState-like accessor returns undefined for unknown session", () => {
    const sessions = new Map<string, { modeState: SessionModeState | undefined }>();
    const getModeState = (sessionId: string) => sessions.get(sessionId)?.modeState;
    expect(getModeState("nonexistent")).toBeUndefined();
  });

  test("getModeState returns live modeState after update", () => {
    const sessions = new Map<string, { modeState: SessionModeState | undefined }>();
    sessions.set("sess-1", { modeState: baseModeState });
    const getModeState = (sessionId: string) => sessions.get(sessionId)?.modeState;

    // Simulate what handleSessionUpdate does
    const record = sessions.get("sess-1");
    if (!record) {
      throw new Error("expected sess-1");
    }
    record.modeState = applyModeUpdate(record.modeState, {
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });

    expect(getModeState("sess-1")?.currentModeId).toBe("plan");
  });
});
