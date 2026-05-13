import { describe, expect, test } from "bun:test";
import { detectAvailableAgents } from "@/api/detect";
import { registerDefinition, unregisterDefinition } from "@/catalog/index";
import type { IAgentDefinition } from "@/types/agent";

const stubDefinition = (id: string, overrides: Partial<IAgentDefinition> = {}): IAgentDefinition => ({
  id,
  label: id,
  transport: "native-acp",
  installNotice: "",
  launch: () => ({ command: "false", args: [] }),
  ...overrides,
});

describe("detectAvailableAgents", () => {
  test("isolates a throwing probe to that agent entry", async () => {
    const def = stubDefinition("throwing-probe", {
      probe: async () => {
        throw new Error("probe exploded");
      },
    });
    registerDefinition(def);
    try {
      const entries = await detectAvailableAgents();
      const entry = entries.find((e) => e.id === def.id);

      expect(entry).toBeDefined();
      expect(entry?.available).toBe(false);
      expect(entry?.reason).toBe("probe exploded");
    } finally {
      unregisterDefinition(def.id);
    }
  });
});
