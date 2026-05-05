/**
 * Tests for sessionMaxTurnsBeforeRecycle.
 *
 * Uses a _hostFactory injection to create mock hosts without subprocess.
 */

import { describe, expect, test } from "bun:test";
import { createSession } from "@/api/session";
import type { ISessionOptionsInternal } from "@/api/session";
import { connectMockHost } from "@/testing/mock-host";
import type { IWireHost } from "@/runtime/host";
import type { ISessionOptions } from "@/types/options";
import type { TAgentId } from "@/types/agent";

// Factory helpers

/**
 * Create a host factory backed by connectMockHost.
 * Returns the factory plus a counter of how many hosts were created.
 */
const makeMockHostFactory = (script: Parameters<typeof connectMockHost>[0] = {}) => {
  let hostCount = 0;
  const createdHosts: IWireHost[] = [];

  const factory = async (_agent: TAgentId, _options: ISessionOptions): Promise<IWireHost> => {
    hostCount += 1;
    const ctx = await connectMockHost(script);
    createdHosts.push(ctx.host);
    return ctx.host;
  };

  return {
    factory,
    get hostCount() {
      return hostCount;
    },
    createdHosts,
  };
};

// Tests

describe("sessionMaxTurnsBeforeRecycle", () => {
  test("maxTurnsBeforeRecycle: 0 disables recycling - N turns on same host", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 0,
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // Do 5 turns
    for (let i = 0; i < 5; i++) {
      await session.ask("hello");
    }
    await session.close();

    // Only 1 host created (no recycling)
    expect(mock.hostCount).toBe(1);
  });

  test("maxTurnsBeforeRecycle: 3 triggers recycle on the 4th ask()", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 3,
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // 3 turns - no recycle yet
    for (let i = 0; i < 3; i++) {
      await session.ask("hello");
    }
    expect(mock.hostCount).toBe(1);

    // 4th turn - triggers recycle (new host created before this ask)
    await session.ask("hello");
    expect(mock.hostCount).toBe(2);

    await session.close();
  });

  test("onRecycle callback fires with 'turn-limit' reason", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const recycleReasons: string[] = [];
    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 2,
      onRecycle: (reason) => {
        recycleReasons.push(reason);
      },
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // 2 turns - hit the limit
    await session.ask("a");
    await session.ask("b");

    // 3rd turn - recycle fires
    await session.ask("c");
    await session.close();

    expect(recycleReasons).toEqual(["turn-limit"]);
  });

  test("cost is preserved across recycle - totalUsd continues climbing", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "usage" as const, usage: { contextSize: 1000, contextUsed: 100, costUsd: 0.01 } };
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 1,
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // First turn - records cost
    await session.ask("a");
    const costAfterFirstTurn = session.cost.snapshot.totalUsd;
    expect(costAfterFirstTurn).toBeGreaterThan(0);

    // Second turn - triggers recycle, cost should continue from previous total
    await session.ask("b");
    const costAfterSecondTurn = session.cost.snapshot.totalUsd;
    expect(costAfterSecondTurn).toBeGreaterThan(costAfterFirstTurn);

    await session.close();
  });

  test("sessionId getter returns the current session id and updates after recycle", async () => {
    // Track what session IDs are vended by each host
    const vendedIds: string[] = [];
    let hostIdx = 0;

    const factory = async (_agent: TAgentId, _options: ISessionOptions): Promise<IWireHost> => {
      hostIdx += 1;
      const thisHost = hostIdx;
      const ctx = await connectMockHost({
        onPrompt: function* () {
          yield { type: "text-delta" as const, text: "ok", messageId: undefined };
        },
      });
      // Wrap newSession to record the ID
      const originalNewSession = ctx.host.newSession.bind(ctx.host);
      const wrappedHost: IWireHost = {
        ...ctx.host,
        newSession: async (input) => {
          const id = await originalNewSession(input);
          vendedIds.push(`host-${thisHost}:${id}`);
          return id;
        },
      };
      return wrappedHost;
    };

    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 1,
      _hostFactory: factory,
    } as ISessionOptionsInternal);

    // session.sessionId comes from host 1
    const id0 = (vendedIds[0] ?? "").split(":")[1] ?? "";
    expect(session.sessionId).toBe(id0);

    // First turn - hits limit (pendingRecycle set)
    await session.ask("a");

    // Second turn - recycles (host 2 created)
    await session.ask("b");

    // session.sessionId now reflects host 2's session
    expect(vendedIds).toHaveLength(2);
    const id1 = (vendedIds[1] ?? "").split(":")[1] ?? "";
    expect(session.sessionId).toBe(id1);

    await session.close();
  });

  test("stream() calls do not trigger recycle", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "streaming", messageId: undefined };
      },
    });

    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 1,
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // Stream 3 times - should NOT trigger recycle (stream doesn't increment turnCount)
    for (let i = 0; i < 3; i++) {
      const s = session.stream("hello");
      for await (const _ of s) { /* drain */ }
      await s.result();
    }
    await session.close();

    // Only 1 host - no recycling from streams
    expect(mock.hostCount).toBe(1);
  });

  test("multiple recycles work correctly - hostCount increments each time", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const recycleCount = { n: 0 };
    const session = await createSession("claude", {
      maxTurnsBeforeRecycle: 2,
      onRecycle: () => {
        recycleCount.n += 1;
      },
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // 6 asks with limit=2: recycles at asks 3, 5 (before them)
    for (let i = 0; i < 6; i++) {
      await session.ask("hello");
    }
    await session.close();

    // Initial host + 2 recycles = 3 hosts
    expect(mock.hostCount).toBe(3);
    expect(recycleCount.n).toBe(2);
  });

  test("default maxTurnsBeforeRecycle is 100", async () => {
    const mock = makeMockHostFactory({
      onPrompt: function* () {
        yield { type: "text-delta" as const, text: "ok", messageId: undefined };
      },
    });

    const session = await createSession("claude", {
      _hostFactory: mock.factory,
    } as ISessionOptionsInternal);

    // 99 asks - no recycle yet
    for (let i = 0; i < 99; i++) {
      await session.ask("hello");
    }
    expect(mock.hostCount).toBe(1);

    // 100th ask - hits limit, no recycle yet (pending)
    await session.ask("hello");
    expect(mock.hostCount).toBe(1);

    // 101st ask - recycle fires before this ask
    await session.ask("hello");
    expect(mock.hostCount).toBe(2);

    await session.close();
  });
});
