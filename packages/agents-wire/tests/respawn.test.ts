import { describe, expect, test } from "bun:test";
import { computeBackoffMs, createSession, type ISessionOptionsInternal } from "@/api/session";
import { MAX_RESPAWN_ATTEMPTS, RESPAWN_BACKOFF_MS } from "@/constants";
import { AgentConnectionClosedError, isTransientError, WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import type { IHostStream, IWireHost } from "@/runtime/host";
import { connectMockHost } from "@/testing/mock-host";
import type { TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";
import type { ISessionOptions } from "@/types/options";

describe("respawn constants", () => {
  test("RESPAWN_BACKOFF_MS has 3 entries with expected values", () => {
    expect(RESPAWN_BACKOFF_MS).toEqual([500, 1_000, 2_000]);
  });

  test("MAX_RESPAWN_ATTEMPTS is 3", () => {
    expect(MAX_RESPAWN_ATTEMPTS).toBe(3);
  });
});

describe("computeBackoffMs", () => {
  test("attempt 1 returns 500ms", () => {
    expect(computeBackoffMs(1)).toBe(500);
  });

  test("attempt 2 returns 1000ms", () => {
    expect(computeBackoffMs(2)).toBe(1_000);
  });

  test("attempt 3 returns 2000ms", () => {
    expect(computeBackoffMs(3)).toBe(2_000);
  });

  test("attempt beyond RESPAWN_BACKOFF_MS length clamps to last entry", () => {
    expect(computeBackoffMs(10)).toBe(2_000);
  });

  test("backoff values are strictly non-decreasing", () => {
    const values = [1, 2, 3, 4].map(computeBackoffMs);
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1];
      const curr = values[i];
      if (prev === undefined || curr === undefined) {
        throw new Error("unexpected undefined backoff");
      }
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

describe("isTransientError", () => {
  test("AgentConnectionClosedError is transient", () => {
    const err = new AgentConnectionClosedError("claude", 1, null, []);
    expect(isTransientError(err)).toBe(true);
  });

  test("WireError with code 'overloaded' is transient", () => {
    const err = new WireError("overloaded", "overloaded");
    expect(isTransientError(err)).toBe(true);
  });

  test("WireError with code 'rate-limit' is transient", () => {
    const err = new WireError("rate-limit", "rate limit");
    expect(isTransientError(err)).toBe(true);
  });

  test("WireError with code 'budget-exceeded' is NOT transient", () => {
    const err = new WireError("budget-exceeded", "budget exceeded");
    expect(isTransientError(err)).toBe(false);
  });

  test("generic Error with 'econnreset' message is transient", () => {
    const err = new Error("ECONNRESET socket error");
    expect(isTransientError(err)).toBe(true);
  });

  test("generic non-transient Error is not transient", () => {
    const err = new Error("something unexpected");
    expect(isTransientError(err)).toBe(false);
  });
});

// End-to-end respawn integration tests via _hostFactory injection

/** Build a host whose prompt() always fails with AgentConnectionClosedError. */
const buildFailingHost = (): IWireHost => {
  const newSessionId = `failing-session-${Math.random().toString(36).slice(2, 8)}`;
  return {
    definition: { id: "claude", label: "mock", transport: "native-acp", launch: () => ({ command: "", args: [] }), installNotice: "" },
    capabilities: {} as never,
    authMethods: [],
    agentInfo: undefined,
    newSession: async () => newSessionId as never,
    loadSession: async () => newSessionId as never,
    prompt: (sid) => {
      const queue = createAsyncQueue<TAgentEvent>();
      const err = new AgentConnectionClosedError("claude", 1, null, []);
      queue.fail(err);
      const completion = Promise.reject(err);
      completion.catch(() => {});
      const stream: IHostStream = {
        sessionId: sid,
        completion,
        cancel: async () => {},
        [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
      };
      return stream;
    },
    cancel: async () => {},
    close: async () => {},
    listSessions: async () => ({ sessions: [] }),
    streamAllSessions: async function* () {},
    getModeState: () => undefined,
    setMode: async () => {},
    getConfigOptions: () => undefined,
    [Symbol.asyncDispose]: async () => {},
  };
};

describe("respawn integration (via _hostFactory)", () => {
  test("ask() retries on transient failure and calls onRetry with increasing attempt numbers", async () => {
    let factoryCallCount = 0;
    const retries: Array<{ attempt: number; isTransient: boolean }> = [];

    const factory = async (_agent: TAgentId, _opts: ISessionOptions): Promise<IWireHost> => {
      factoryCallCount += 1;
      if (factoryCallCount <= 2) {
        return buildFailingHost();
      }
      const ctx = await connectMockHost({
        onPrompt: function* () {
          yield { type: "text-delta", text: "ok", messageId: undefined };
        },
      });
      return ctx.host;
    };

    const session = await createSession("claude", {
      _hostFactory: factory,
      onRetry: (attempt, err) => retries.push({ attempt, isTransient: err instanceof AgentConnectionClosedError }),
    } as ISessionOptionsInternal);

    const result = await session.ask("hello");
    expect(result.text).toBe("ok");
    expect(retries.map((r) => r.attempt)).toEqual([1, 2]);
    expect(retries.every((r) => r.isTransient)).toBe(true);
    expect(factoryCallCount).toBe(3);
    await session.close();
  });

  test("ask() throws immediately when autoRespawn: false and a transient error occurs", async () => {
    const retries: number[] = [];
    let factoryCallCount = 0;
    const factory = async (): Promise<IWireHost> => {
      factoryCallCount += 1;
      return buildFailingHost();
    };

    const session = await createSession("claude", {
      _hostFactory: factory,
      autoRespawn: false,
      onRetry: (a) => retries.push(a),
    } as ISessionOptionsInternal);

    const err = await session.ask("hello").catch((e) => e);
    expect(err).toBeInstanceOf(AgentConnectionClosedError);
    expect(retries).toEqual([]);
    expect(factoryCallCount).toBe(1);
    await session.close();
  });

  test("ask() throws WireError('retry-exhausted') after MAX_RESPAWN_ATTEMPTS failures", async () => {
    const factory = async (): Promise<IWireHost> => buildFailingHost();
    const session = await createSession("claude", {
      _hostFactory: factory,
    } as ISessionOptionsInternal);

    const err = (await session.ask("hello").catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(WireError);
    expect((err as WireError).code).toBe("retry-exhausted");
    await session.close();
  });

  test("cost.snapshot.totalUsd is monotonically increasing across respawns (fork() semantics)", async () => {
    let factoryCallCount = 0;
    const factory = async (): Promise<IWireHost> => {
      factoryCallCount += 1;
      const ctx = await connectMockHost({
        onPrompt: function* () {
          yield { type: "usage", usage: { contextSize: 1000, contextUsed: 100, costUsd: 0.05 } };
          yield { type: "text-delta", text: "ok", messageId: undefined };
        },
      });
      // Wrap host so the SECOND prompt call (after a successful first) fails, triggering respawn.
      let promptCallCount = 0;
      const wrapped: IWireHost = {
        ...ctx.host,
        prompt: (sid, input) => {
          promptCallCount += 1;
          if (factoryCallCount === 1 && promptCallCount === 2) {
            const queue = createAsyncQueue<TAgentEvent>();
            const err = new AgentConnectionClosedError("claude", 1, null, []);
            queue.fail(err);
            const completion = Promise.reject(err);
            completion.catch(() => {});
            return {
              sessionId: sid,
              completion,
              cancel: async () => {},
              [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
            };
          }
          return ctx.host.prompt(sid, input);
        },
      };
      return wrapped;
    };

    const session = await createSession("claude", { _hostFactory: factory } as ISessionOptionsInternal);

    await session.ask("first");
    const costAfterFirst = session.cost.snapshot.totalUsd;
    expect(costAfterFirst).toBeCloseTo(0.05, 5);

    await session.ask("second");
    const costAfterSecond = session.cost.snapshot.totalUsd;
    expect(costAfterSecond).toBeGreaterThan(costAfterFirst);

    await session.close();
  });
});

// Lightweight behavioural tests using a thin fake that side-steps the catalog
// These test the respawn loop semantics directly by building a tiny shim around
// the retry logic without going through createSession (which needs the catalog).

describe("retry loop semantics (pure logic)", () => {
  /**
   * Simulate the core of the respawn ask() retry loop in isolation.
   * Returns { attempts, result } or throws the final error.
   */
  const runRetryLoop = async (
    opts: { failCount: number; autoRespawn?: boolean; maxAttempts?: number },
    onRetry?: (attempt: number, err: Error) => void,
  ): Promise<{ attempts: number; success: boolean }> => {
    const maxAttempts = opts.maxAttempts ?? MAX_RESPAWN_ATTEMPTS;
    const autoRespawn = opts.autoRespawn !== false;
    let attempt = 0;
    let callCount = 0;

    while (true) {
      try {
        callCount += 1;
        if (callCount <= opts.failCount) {
          throw new AgentConnectionClosedError("claude", 1, null, []);
        }
        return { attempts: attempt, success: true };
      } catch (err) {
        attempt += 1;
        const transient = err instanceof AgentConnectionClosedError || isTransientError(err as Error);

        if (!autoRespawn || !transient || attempt > maxAttempts) {
          if (attempt > maxAttempts) {
            throw new WireError("retry-exhausted", `Exhausted ${maxAttempts} respawn attempts`, { agent: "claude", cause: err });
          }
          throw err;
        }

        onRetry?.(attempt, err as Error);
        // Backoff is skipped in unit tests for speed.
      }
    }
  };

  test("succeeds on first try when no failures", async () => {
    const result = await runRetryLoop({ failCount: 0 });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(0);
  });

  test("retries once after 1 transient failure and succeeds", async () => {
    const retries: number[] = [];
    const result = await runRetryLoop({ failCount: 1 }, (a) => retries.push(a));
    expect(result.success).toBe(true);
    expect(retries).toEqual([1]);
  });

  test("onRetry is called with attempt numbers starting at 1", async () => {
    const retries: number[] = [];
    await runRetryLoop({ failCount: 2 }, (a) => retries.push(a));
    expect(retries).toEqual([1, 2]);
  });

  test("throws retry-exhausted after MAX_RESPAWN_ATTEMPTS failures", async () => {
    const err = await runRetryLoop({ failCount: MAX_RESPAWN_ATTEMPTS + 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(WireError);
    expect((err as WireError).code).toBe("retry-exhausted");
  });

  test("autoRespawn: false propagates the error immediately without retrying", async () => {
    const retries: number[] = [];
    const err = await runRetryLoop({ failCount: 1, autoRespawn: false }, (a) => retries.push(a)).catch((e) => e);
    expect(err).toBeInstanceOf(AgentConnectionClosedError);
    expect(retries).toEqual([]); // onRetry never called
  });

  test("non-transient errors propagate immediately even with autoRespawn: true", async () => {
    // Simulate a non-transient error path directly
    const autoRespawn = true;
    let attempt = 0;
    const nonTransientErr = new WireError("auth-required", "auth required");

    const runOnce = async (): Promise<never> => {
      try {
        throw nonTransientErr;
      } catch (err) {
        attempt += 1;
        const transient = isTransientError(err as Error);
        if (!autoRespawn || !transient || attempt > MAX_RESPAWN_ATTEMPTS) {
          throw err;
        }
        throw new Error("should not reach here");
      }
    };

    const caught = await runOnce().catch((e) => e);
    expect(caught).toBe(nonTransientErr);
    expect(attempt).toBe(1);
  });
});
