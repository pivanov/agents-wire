import { describe, expect, test } from "bun:test";
import { createSession, type ISessionOptionsInternal } from "@/api/session";
import type { IStandardSchema } from "@/schema/standard";
import { connectMockHost } from "@/testing/mock-host";

const okSchema: IStandardSchema<{ ok: boolean }> = {
  "~standard": {
    version: 1,
    vendor: "unknown-test",
    validate: (value) => {
      if (typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true) {
        return { value: value as { ok: boolean } };
      }
      return { issues: [{ message: "expected { ok: true }" }] };
    },
  },
};

describe("session askJson", () => {
  test("uses per-call onWarning while deriving Standard Schema guidance", async () => {
    await using ctx = await connectMockHost({
      onPrompt: async function* () {
        yield { type: "text-delta", text: '{"ok":true}', messageId: undefined };
      },
    });
    const session = await createSession("mock", {
      _hostFactory: async () => ctx.host,
    } as ISessionOptionsInternal);
    const warnings: string[] = [];
    try {
      const result = await session.askJson("return ok", okSchema, {
        onWarning: (message) => warnings.push(message),
      });

      expect(result.data.ok).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Unknown Standard Schema vendor "unknown-test"');
    } finally {
      await session.close();
    }
  });
});
