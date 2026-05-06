/**
 * Spawn failure tests: non-existent binary path, ENOENT propagation.
 * No mock-host harness needed - tests the real launchAgent path.
 */

import { describe, expect, test } from "bun:test";
import { AgentConnectionClosedError } from "@/errors";
import { createWireHost } from "@/runtime/host";
import type { IAgentDefinition } from "@/types/agent";

const makeDefinition = (command: string): IAgentDefinition => ({
  id: "test-spawn" as never,
  label: "Test Spawn Agent",
  transport: "native-acp",
  launch: () => ({ command, args: [] }),
  installNotice: "",
});

describe("spawn failures", () => {
  test("createWireHost with nonexistent binary throws AgentConnectionClosedError", async () => {
    const definition = makeDefinition("/nonexistent/path/binary-that-does-not-exist");
    let caught: unknown;
    try {
      await createWireHost(definition, { agentId: "test-spawn" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentConnectionClosedError);
  });

  test("error message references the agent id", async () => {
    const definition = makeDefinition("/nonexistent/does-not-exist");
    let caught: unknown;
    try {
      await createWireHost(definition, { agentId: "test-spawn" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentConnectionClosedError);
    expect((caught as AgentConnectionClosedError).agent).toBe("test-spawn");
  });

  test("exit code is null and cause is set for ENOENT", async () => {
    const definition = makeDefinition("/nonexistent/binary");
    let caught: unknown;
    try {
      await createWireHost(definition, { agentId: "test-spawn" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AgentConnectionClosedError);
    const err = caught as AgentConnectionClosedError;
    // ENOENT path: the child process never spawned, so exitCode is null
    expect(err.exitCode).toBeNull();
    expect(err.signal).toBeNull();
    expect(err.cause).toBeDefined();
  });
});
