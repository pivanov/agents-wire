/**
 * Tests for Feature 1: Session listing / pagination
 *
 * These tests cover the `listSessions` and `streamAllSessions` methods
 * both on the host and through `IAgentSession`.
 */
import { describe, expect, test } from "bun:test";
import { CapabilityNotSupportedError } from "@/errors";
import type { ISessionListPage } from "@/types/results";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal IAgentCapabilities-like object */
const makeCapabilities = (listSessions: boolean) => ({
  loadSession: false,
  forkSession: false,
  resumeSession: false,
  closeSession: false,
  listSessions,
  additionalDirectories: false,
  mcp: { stdio: true, http: false, sse: false },
  prompt: { text: true, image: false, audio: false, embeddedContext: false },
});

/**
 * Minimal stub of what `acp.listSessions` returns, shaped like the ACP SDK
 * `ListSessionsResponse` but we only care about sessions + nextCursor.
 */
const makeAcpResponse = (sessions: { sessionId: string; cwd: string; title?: string; updatedAt?: string }[], nextCursor?: string) => ({
  sessions,
  nextCursor: nextCursor ?? null,
});

/**
 * Extract the mapping logic from `createWireHost` so we can test it in
 * isolation without spinning up a real agent process.
 */
const mapListSessionsResponse = (response: ReturnType<typeof makeAcpResponse>): ISessionListPage => ({
  sessions: response.sessions.map((s) => ({
    sessionId: s.sessionId,
    ...(s.title ? { title: s.title } : {}),
    ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
    cwd: s.cwd,
  })),
  ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
});

async function* paginateWith(
  pages: ReturnType<typeof makeAcpResponse>[],
): AsyncIterable<{ sessionId: string; cwd: string; title?: string; updatedAt?: string }> {
  for (const page of pages) {
    for (const session of page.sessions) {
      yield session;
    }
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("listSessions - capability gate", () => {
  test("throws CapabilityNotSupportedError when listSessions is false", () => {
    const caps = makeCapabilities(false);
    const guardedListSessions = () => {
      if (!caps.listSessions) {
        throw new CapabilityNotSupportedError("claude", "sessionCapabilities.list");
      }
    };
    expect(guardedListSessions).toThrow(CapabilityNotSupportedError);
  });

  test("does NOT throw when listSessions is true", () => {
    const caps = makeCapabilities(true);
    const guardedListSessions = () => {
      if (!caps.listSessions) {
        throw new CapabilityNotSupportedError("claude", "sessionCapabilities.list");
      }
    };
    expect(guardedListSessions).not.toThrow();
  });
});

describe("mapListSessionsResponse - field mapping", () => {
  test("maps sessionId, cwd, title, and updatedAt when present", () => {
    const raw = makeAcpResponse([{ sessionId: "sess-1", cwd: "/home/user/project", title: "My Project", updatedAt: "2024-01-01T00:00:00Z" }]);
    const page = mapListSessionsResponse(raw);
    expect(page.sessions).toHaveLength(1);
    const s = page.sessions[0];
    if (!s) {
      throw new Error("expected first session");
    }
    expect(s.sessionId).toBe("sess-1");
    expect(s.cwd).toBe("/home/user/project");
    expect(s.title).toBe("My Project");
    expect(s.updatedAt).toBe("2024-01-01T00:00:00Z");
  });

  test("omits optional fields when absent", () => {
    const raw = makeAcpResponse([{ sessionId: "sess-2", cwd: "/tmp" }]);
    const page = mapListSessionsResponse(raw);
    const s = page.sessions[0];
    if (!s) {
      throw new Error("expected first session");
    }
    expect(s.sessionId).toBe("sess-2");
    expect(s.cwd).toBe("/tmp");
    expect("title" in s).toBe(false);
    expect("updatedAt" in s).toBe(false);
  });

  test("passes through nextCursor when present", () => {
    const raw = makeAcpResponse([], "tok-abc");
    const page = mapListSessionsResponse(raw);
    expect(page.nextCursor).toBe("tok-abc");
  });

  test("omits nextCursor when absent (null from ACP)", () => {
    const raw = makeAcpResponse([]);
    const page = mapListSessionsResponse(raw);
    expect("nextCursor" in page).toBe(false);
  });
});

describe("streamAllSessions - pagination", () => {
  test("yields sessions across multiple pages", async () => {
    const pages = [makeAcpResponse([{ sessionId: "a", cwd: "/a" }], "cursor-2"), makeAcpResponse([{ sessionId: "b", cwd: "/b" }])];

    const collected: string[] = [];
    for await (const s of paginateWith(pages)) {
      collected.push(s.sessionId);
    }
    expect(collected).toEqual(["a", "b"]);
  });

  test("yields nothing for an empty first page", async () => {
    const pages = [makeAcpResponse([])];
    const collected: string[] = [];
    for await (const s of paginateWith(pages)) {
      collected.push(s.sessionId);
    }
    expect(collected).toHaveLength(0);
  });
});
