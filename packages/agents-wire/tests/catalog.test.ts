import { afterEach, describe, expect, test } from "bun:test";
import { definitionFor, listDefinitions, registerDefinition, unregisterDefinition } from "@/catalog/index";
import { BUILT_IN_AGENT_IDS } from "@/types/agent";

afterEach(() => {
  unregisterDefinition("__test__");
});

describe("catalog", () => {
  test("definitionFor returns each built-in", () => {
    for (const id of BUILT_IN_AGENT_IDS) {
      const def = definitionFor(id);
      expect(def.id).toBe(id);
      expect(typeof def.label).toBe("string");
      expect(["native-acp", "node-bridge"]).toContain(def.transport);
    }
  });

  test("definitionFor throws on unknown id", () => {
    expect(() => definitionFor("not-a-real-agent")).toThrow(/Unknown agent/);
  });

  test("registerDefinition makes a custom agent resolvable", () => {
    registerDefinition({
      id: "__test__",
      label: "Test",
      transport: "native-acp",
      installNotice: "test",
      launch: () => ({ command: "/bin/true", args: [] }),
    });
    const def = definitionFor("__test__");
    expect(def.id).toBe("__test__");
    expect(def.label).toBe("Test");
  });

  test("registerDefinition refuses to overwrite a built-in", () => {
    expect(() =>
      registerDefinition({
        id: "claude",
        label: "Hijack",
        transport: "native-acp",
        installNotice: "no",
        launch: () => ({ command: "/bin/true", args: [] }),
      }),
    ).toThrow(/built-in/);
  });

  test("listDefinitions includes all 8 built-ins by default", () => {
    const all = listDefinitions();
    expect(all.length).toBeGreaterThanOrEqual(BUILT_IN_AGENT_IDS.length);
  });
});
