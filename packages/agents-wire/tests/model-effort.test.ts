/**
 * Tests for model/effort end-to-end wiring.
 *
 * Covers:
 *  - Per-catalog launch() flag injection (codex, gemini, claude)
 *  - launchAgent forwarding model/effort into definition.launch()
 *  - createWireHost building spawnOptions with model/effort from IAgentOptions
 *  - modelPreference wired via setSessionConfigOption after newSession (via mock host)
 */

import { describe, expect, test } from "bun:test";
import { claude } from "@/catalog/claude";
import { codex } from "@/catalog/codex";
import { gemini } from "@/catalog/gemini";
import { launchAgent } from "@/internal/spawn";
import { createWireHost } from "@/runtime/host";
import { connectMockHost } from "@/testing/mock-host";
import type { IAgentDefinition, IWireLaunchOptions, IWireLaunchSpec } from "@/types/agent";

// Codex catalog: model/effort injected as -c key=value config overrides
// (codex-acp bridge accepts TOML config overrides, not raw --model/--effort flags)
describe("codex.launch()", () => {
  test('injects -c model="X" when model is set (codex-acp bridge takes -c key=value)', () => {
    const spec = codex.launch({ model: "gpt-5" });
    expect(spec.args).toContain("-c");
    expect(spec.args).toContain('model="gpt-5"');
  });

  test('injects -c model_reasoning_effort="X" when effort is set', () => {
    const spec = codex.launch({ model: "gpt-5", effort: "high" });
    expect(spec.args).toContain('model_reasoning_effort="high"');
  });

  test("omits -c overrides when model and effort are not set", () => {
    const spec = codex.launch({});
    expect(spec.args).not.toContain("-c");
  });
});

// Gemini catalog: model selection via ACP modelPreference (not a CLI flag)
describe("gemini.launch()", () => {
  test("args include --acp flag", () => {
    const spec = gemini.launch({ binaryOverride: "/usr/bin/env" });
    expect(spec.args).toContain("--acp");
  });

  test("model is not passed as a CLI flag (gemini --acp mode does not accept --model)", () => {
    const spec = gemini.launch({ model: "gemini-2.5-pro", binaryOverride: "/usr/bin/env" });
    // Gemini CLI --acp mode routes model selection through ACP modelPreference,
    // so the model identifier should NOT appear as a CLI flag.
    expect(spec.args).not.toContain("--model");
  });
});

// Claude catalog: model NOT passed as CLI flag (ACP-only via modelPreference)
describe("claude.launch()", () => {
  test("does not include any model flag even when model is set", () => {
    const spec = claude.launch({ model: "claude-sonnet-4-6" });
    expect(spec.args).not.toContain("--model");
    expect(spec.args).not.toContain("claude-sonnet-4-6");
  });
});

// Spawn integration: launchAgent forwards model/effort into definition.launch()
describe("launchAgent spawn integration", () => {
  test("passes model and effort into definition.launch()", async () => {
    const received: IWireLaunchOptions[] = [];

    const stubDefinition: IAgentDefinition = {
      id: "stub" as IAgentDefinition["id"],
      label: "Stub",
      transport: "native-acp",
      installNotice: "",
      launch(opts = {}): IWireLaunchSpec {
        received.push(opts);
        // Return a real executable so spawn does not fail
        return { command: process.execPath, args: ["--version"] };
      },
    };

    const connection = await launchAgent(stubDefinition, {
      model: "test-model",
      effort: "low",
    });
    await connection.dispose();

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.model).toBe("test-model");
    expect(received[0]?.effort).toBe("low");
  });
});

// Host integration: createWireHost builds spawnOptions with model/effort
describe("createWireHost model/effort wiring", () => {
  const buildStub = (received: IWireLaunchOptions[]): IAgentDefinition => ({
    id: "stub" as IAgentDefinition["id"],
    label: "Stub",
    transport: "native-acp",
    installNotice: "",
    launch(opts = {}): IWireLaunchSpec {
      received.push(opts);
      return { command: process.execPath, args: ["--version"] };
    },
  });

  test("forwards model + effort from modelPreference (legacy path) to definition.launch()", async () => {
    const received: IWireLaunchOptions[] = [];
    try {
      await createWireHost(buildStub(received), {
        agentId: "stub" as IAgentDefinition["id"],
        model: "x",
        modelPreference: { configId: "reasoning_effort", value: "high" },
      });
    } catch {
      /* expected ACP init failure */
    }
    expect(received[0]?.model).toBe("x");
    expect(received[0]?.effort).toBe("high");
  });

  test("forwards top-level effort to definition.launch()", async () => {
    const received: IWireLaunchOptions[] = [];
    try {
      await createWireHost(buildStub(received), {
        agentId: "stub" as IAgentDefinition["id"],
        model: "y",
        effort: "medium",
      });
    } catch {
      /* expected */
    }
    expect(received[0]?.model).toBe("y");
    expect(received[0]?.effort).toBe("medium");
  });

  test("modelPreference reasoning_effort wins over top-level effort", async () => {
    const received: IWireLaunchOptions[] = [];
    try {
      await createWireHost(buildStub(received), {
        agentId: "stub" as IAgentDefinition["id"],
        effort: "low",
        modelPreference: { configId: "reasoning_effort", value: "high" },
      });
    } catch {
      /* expected */
    }
    expect(received[0]?.effort).toBe("high");
  });
});

// modelPreference on newSession: setSessionConfigOption is called best-effort
describe("modelPreference -> setSessionConfigOption after newSession", () => {
  test("host opens a session without throwing when modelPreference is set", async () => {
    // TODO: Full verification that setSessionConfigOption is called requires
    // extending connectMockHost to expose an onSetSessionConfigOption hook.
    // The mock agent returns -32601 (method not found) which the host swallows,
    // and the session still opens successfully.
    await using ctx = await connectMockHost(
      {},
      {
        options: {
          modelPreference: { configId: "reasoning_effort", value: "high" },
        },
      },
    );
    const sessionId = await ctx.host.newSession();
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);
  });
});
