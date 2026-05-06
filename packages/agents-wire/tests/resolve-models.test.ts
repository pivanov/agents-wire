import { describe, expect, test } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { resolveModels } from "@/api/resolve-models";
import type { IAgentSession } from "@/api/session";
import { registerDefinition, unregisterDefinition } from "@/catalog/index";
import type { IAgentDefinition } from "@/types/agent";

// Build a minimal stub IAgentSession exposing only the fields
// resolveModels reads. resolveModels never calls ask/prompt/close/etc.
const fakeSession = (configOptions: readonly SessionConfigOption[] | undefined): IAgentSession => ({ configOptions }) as unknown as IAgentSession;

const stubDefinition = (id: string, overrides: Partial<IAgentDefinition> = {}): IAgentDefinition => ({
  id,
  label: id,
  transport: "native-acp",
  installNotice: "",
  launch: () => ({ command: "false", args: [] }),
  ...overrides,
});

describe("resolveModels", () => {
  test("session.configOptions with enum effort: source=session-config, models tagged kind:enum", async () => {
    const def = stubDefinition("test-agent-1", { models: [{ id: "default", label: "Default" }] });
    registerDefinition(def);
    try {
      const opts: readonly SessionConfigOption[] = [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "haiku",
          options: [
            { value: "default", name: "Default (recommended)" },
            { value: "haiku", name: "Haiku" },
          ],
        },
        {
          type: "select",
          id: "thought_level",
          name: "Effort",
          category: "thought_level",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ];

      const result = await resolveModels(def.id, { session: fakeSession(opts) });
      expect(result.source).toBe("session-config");
      expect(result.modelConfigId).toBe("model");
      expect(result.effortConfigId).toBe("thought_level");
      expect(result.models.map((m) => m.id)).toEqual(["default", "haiku"]);
      const haiku = result.models.find((m) => m.id === "haiku");
      expect(haiku?.effort?.kind).toBe("enum");
      if (haiku?.effort?.kind === "enum") {
        expect(haiku.effort.values).toEqual(["low", "medium", "high"]);
      }
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("session.configOptions with numeric values is recognised as kind:budget", async () => {
    const def = stubDefinition("test-agent-2");
    registerDefinition(def);
    try {
      const opts: readonly SessionConfigOption[] = [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "default",
          options: [{ value: "default", name: "Default" }],
        },
        {
          type: "select",
          id: "thinking_budget",
          name: "Thinking Budget",
          category: "thought_level",
          currentValue: "8000",
          options: [
            { value: "4000", name: "4000" },
            { value: "8000", name: "8000" },
            { value: "16000", name: "16000" },
          ],
        },
      ];

      const result = await resolveModels(def.id, { session: fakeSession(opts) });
      expect(result.source).toBe("session-config");
      const model = result.models.find((m) => m.id === "default");
      expect(model?.effort?.kind).toBe("budget");
      if (model?.effort?.kind === "budget") {
        expect(model.effort.min).toBe(4000);
        expect(model.effort.max).toBe(16000);
      }
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("session.configOptions with no effort selector: models default to undefined effort", async () => {
    const def = stubDefinition("test-agent-3");
    registerDefinition(def);
    try {
      const opts: readonly SessionConfigOption[] = [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "gpt-5",
          options: [
            { value: "gpt-5", name: "GPT-5" },
            { value: "gpt-5-codex", name: "GPT-5 Codex" },
          ],
        },
      ];

      const result = await resolveModels(def.id, { session: fakeSession(opts) });
      expect(result.source).toBe("session-config");
      expect(result.effortConfigId).toBeUndefined();
      for (const m of result.models) {
        expect(m.effort).toBeUndefined();
      }
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("no session, listAvailableModels populated: source=live-list", async () => {
    const def = stubDefinition("test-agent-4", {
      listAvailableModels: async () => [
        { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { id: "claude-opus-4-7", label: "Opus 4.7" },
      ],
    });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id);
      expect(result.source).toBe("live-list");
      expect(result.models.map((m) => m.id)).toEqual(["claude-sonnet-4-6", "claude-opus-4-7"]);
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("non-cursor live-list entries are NOT auto-tagged with effort", async () => {
    // Cursor (the built-in) gets `effort: { kind: "variant" }` tagged
    // by resolveModels because its effort axis is baked into the
    // model id. Other agents that ship listAvailableModels do not get
    // auto-tagged - their effort is left undefined unless declared
    // per-model. This test asserts the non-cursor path; the cursor
    // branch is exercised via the live integration probe.
    const def = stubDefinition("test-agent-non-cursor", {
      listAvailableModels: async () => [
        { id: "model-a", label: "Model A" },
        { id: "model-b", label: "Model B" },
      ],
    });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id);
      expect(result.source).toBe("live-list");
      for (const m of result.models) {
        expect(m.effort).toBeUndefined();
      }
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("no session, no listAvailableModels, static catalog populated: source=static", async () => {
    const def = stubDefinition("test-agent-6", { models: [{ id: "default", label: "Default" }] });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id);
      expect(result.source).toBe("static");
      expect(result.models.map((m) => m.id)).toEqual(["default"]);
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("nothing available anywhere: source=none, empty list", async () => {
    const def = stubDefinition("test-agent-7", { models: [] });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id);
      expect(result.source).toBe("none");
      expect(result.models).toEqual([]);
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("listAvailableModels failure falls through to static catalog", async () => {
    const def = stubDefinition("test-agent-8", {
      listAvailableModels: async () => {
        throw new Error("CLI not installed");
      },
      models: [{ id: "default", label: "Default" }],
    });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id);
      expect(result.source).toBe("static");
      expect(result.models.map((m) => m.id)).toEqual(["default"]);
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("session takes priority over live-list and static", async () => {
    const def = stubDefinition("test-agent-9", {
      listAvailableModels: async () => [{ id: "live-1", label: "Live 1" }],
      models: [{ id: "static-1", label: "Static 1" }],
    });
    registerDefinition(def);
    try {
      const opts: readonly SessionConfigOption[] = [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "session-only",
          options: [{ value: "session-only", name: "Session Only" }],
        },
      ];
      const result = await resolveModels(def.id, { session: fakeSession(opts) });
      expect(result.source).toBe("session-config");
      expect(result.models.map((m) => m.id)).toEqual(["session-only"]);
    } finally {
      unregisterDefinition(def.id);
    }
  });

  test("empty session.configOptions falls through to live-list", async () => {
    const def = stubDefinition("test-agent-10", {
      listAvailableModels: async () => [{ id: "live-1", label: "Live 1" }],
    });
    registerDefinition(def);
    try {
      const result = await resolveModels(def.id, { session: fakeSession([]) });
      expect(result.source).toBe("live-list");
      expect(result.models.map((m) => m.id)).toEqual(["live-1"]);
    } finally {
      unregisterDefinition(def.id);
    }
  });
});
