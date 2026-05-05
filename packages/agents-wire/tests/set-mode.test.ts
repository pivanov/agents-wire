/**
 * Tests for the setMode() writer on IWireHost and IAgentSession.
 *
 * Uses connectMockHost harness - no subprocess required.
 */

import { describe, expect, test } from "bun:test";
import type { AgentCapabilities, SessionModeState } from "@agentclientprotocol/sdk";
import { CapabilityNotSupportedError, WireError } from "@/errors";
import { connectMockHost } from "@/testing/mock-host";

// Helpers

const AVAILABLE_MODES: SessionModeState["availableModes"] = [
  { id: "auto", name: "Auto", description: "Automatic mode" },
  { id: "plan", name: "Plan", description: "Planning mode" },
  { id: "code", name: "Code", description: "Code mode" },
];

/** Build a newSession modes payload so the host records modeState. */
const buildCapabilities = (): AgentCapabilities => ({});

/**
 * Connect a mock host that returns modeState on newSession via the AgentSideConnection
 * `newSession` response. We achieve this by having the mock return `modes` in the
 * newSession response - but since AgentSideConnection's newSession callback only returns
 * `{ sessionId }`, we instead drive modeState through a `mode-changed` event emitted
 * before setMode, OR we rely on the fact that `newSession` in the real ACP protocol
 * returns `modes`. Our mock harness' AgentSideConnection `newSession` returns `{ sessionId }`.
 *
 * To set up modeState, we extend the onPrompt to emit a `mode-changed` event so the host
 * record.modeState gets populated - EXCEPT the host only populates modeState from `newSession`
 * response.modes. We need to work around this by using a custom newSession override
 * in the AgentSideConnection, but the current harness doesn't expose that.
 *
 * Workaround: we directly test host.setMode via the host by patching sessions map indirectly.
 * We use the `onPrompt` path to first do a prompt that emits `mode-changed`, then check -
 * but actually the host modeState is only initialized from newSession `modes` field.
 *
 * Simplest approach: the AgentSideConnection in mock-host always returns `{ sessionId }`.
 * To test setMode with modeState, we use the `current_mode_update` path to set up modeState
 * via an initial prompt - but modeState is only set from newSession.
 *
 * Alternative: use `overrides.options` to inject an initial newSession that includes modes,
 * but that requires the underlying AgentSideConnection to return modes.
 *
 * We'll extend the AgentSideConnection in the mock harness indirectly by relying on the
 * fact that we can make `onPrompt` emit a current_mode_update event, which will update
 * modeState. But `record.modeState` starts undefined. The `current_mode_update` handler
 * only mutates if `record.modeState` is already defined.
 *
 * Best approach: extend connectMockHost to accept an `initialModes` option that the
 * AgentSideConnection returns in newSession. Since we can't easily do that without
 * modifying mock-host.ts further, we'll test setMode at the host level by first
 * making the host think modeState exists through newSession.
 *
 * We'll add `initialModes` support to connectMockHost via IMockHostScript.
 */

// Feature: setMode on IWireHost

describe("setMode - IWireHost", () => {
  test("setMode succeeds when modeId is in availableModes", async () => {
    await using ctx = await connectMockHost(
      {
        capabilities: buildCapabilities(),
        initialModes: {
          currentModeId: "auto",
          availableModes: AVAILABLE_MODES,
        },
      },
    );
    const sessionId = await ctx.host.newSession();
    await expect(ctx.host.setMode(sessionId, "plan")).resolves.toBeUndefined();
  });

  test("after setMode, getModeState reflects the new currentModeId", async () => {
    await using ctx = await connectMockHost(
      {
        initialModes: {
          currentModeId: "auto",
          availableModes: AVAILABLE_MODES,
        },
      },
    );
    const sessionId = await ctx.host.newSession();
    await ctx.host.setMode(sessionId, "plan");
    const state = ctx.host.getModeState(sessionId);
    expect(state?.currentModeId).toBe("plan");
  });

  test("setMode emits mode-changed event to active stream", async () => {
    let triggerSetMode: (() => Promise<void>) | undefined;

    await using ctx = await connectMockHost({
      initialModes: {
        currentModeId: "auto",
        availableModes: AVAILABLE_MODES,
      },
      onPrompt: async function* (sessionId, _blocks) {
        // Wait for the test to call setMode, then yield whatever setMode pushes
        await new Promise<void>((resolve) => {
          triggerSetMode = async () => {
            await ctx.host.setMode(sessionId, "plan");
            resolve();
          };
        });
      },
    });

    const sessionId = await ctx.host.newSession();
    const stream = ctx.host.prompt(sessionId, { prompt: "hello" });

    const eventsP = (async () => {
      const collected: string[] = [];
      for await (const event of stream) {
        collected.push(event.type);
      }
      return collected;
    })();

    // Give the prompt a moment to set up
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await triggerSetMode?.();

    const events = await eventsP;
    expect(events).toContain("mode-changed");
  });

  test("setMode throws CapabilityNotSupportedError when modeId is not in availableModes", async () => {
    await using ctx = await connectMockHost({
      initialModes: {
        currentModeId: "auto",
        availableModes: AVAILABLE_MODES,
      },
    });
    const sessionId = await ctx.host.newSession();
    await expect(ctx.host.setMode(sessionId, "nonexistent")).rejects.toBeInstanceOf(CapabilityNotSupportedError);
  });

  test("setMode throws CapabilityNotSupportedError when session has no modeState", async () => {
    // No initialModes - modeState is undefined
    await using ctx = await connectMockHost({});
    const sessionId = await ctx.host.newSession();
    await expect(ctx.host.setMode(sessionId, "plan")).rejects.toBeInstanceOf(CapabilityNotSupportedError);
  });

  test("setMode throws WireError(stream-error) for unknown sessionId", async () => {
    await using ctx = await connectMockHost({});
    const err = await ctx.host.setMode("nonexistent-session" as never, "plan").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WireError);
    expect((err as WireError).code).toBe("stream-error");
  });

  test("CapabilityNotSupportedError contains the modeId in the capability field", async () => {
    await using ctx = await connectMockHost({
      initialModes: {
        currentModeId: "auto",
        availableModes: AVAILABLE_MODES,
      },
    });
    const sessionId = await ctx.host.newSession();
    const err = await ctx.host.setMode(sessionId, "nonexistent").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CapabilityNotSupportedError);
    expect((err as CapabilityNotSupportedError).capability).toBe("mode:nonexistent");
  });
});
