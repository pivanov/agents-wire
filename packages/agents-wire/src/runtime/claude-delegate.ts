/**
 * Claude delegate: routes `agents.askJson("claude", …)` and the equivalent
 * session form through `@pivanov/claude-wire` 0.2.0 instead of agents-wire's
 * generic ACP-bridge soft path.
 *
 * Why a delegate at all: the parity harness in `internal/parity-harness/`
 * proved the soft path (prompt-injected JSON guidance + post-hoc validate)
 * is 0% reliable on real Haiku enrichment prompts (model returns thinking-
 * only turns or prose, never JSON). claude-wire's CLI-level strict mode
 * (`--tools StructuredOutput` + `--json-schema`) is ~100%. We delegate so
 * Claude's strict channel is engaged whenever an `askJson` lands here.
 *
 * Routing strategy is systemPrompt-aware:
 *   - With systemPrompt → pooled strict session keyed by
 *     (systemPrompt, schemaFingerprint). The systemPrompt is Anthropic-prompt-
 *     cached across calls in that session; per-call cost drops to the diff.
 *     Catalog-style enrichments (TL;DR, triage, rerank with a project
 *     catalog) are exactly this case.
 *   - Without systemPrompt → claude-wire stateless `claude.askJson`.
 *     Sessions accumulate conversation context per turn so there's no
 *     amortization win and per-call cost grows with the pool's history.
 *     Stateless cold-spawn is cheaper.
 *
 * All paths go through claude-wire's strict CLI channel. The soft path is
 * never used for Claude.
 */
import {
  AbortError as ClaudeAbortError,
  JsonValidationError as ClaudeJsonValidationError,
  KnownError as ClaudeKnownError,
  claude as claudeClient,
  createSession as createClaudeSession,
  standardSchemaToJsonSchema as deriveJsonSchema,
  type IClaudeSession,
  type IStandardSchema as IClaudeStandardSchema,
  isKnownError,
} from "@pivanov/claude-wire";

import { AbortError, JsonValidationError, type TKnownErrorCode, WireError } from "@/errors";
import type { TSchemaInput } from "@/schema/standard";
import type { IAskOptions } from "@/types/options";
import type { IAskResult, ICostSnapshot, IJsonResult } from "@/types/results";

const fingerprintSchema = async <T>(schema: TSchemaInput<T>): Promise<string> => {
  if (typeof schema === "string") {
    return `s:${hash(schema)}`;
  }
  const derived = await deriveJsonSchema(schema as IClaudeStandardSchema<T>);
  return `s:${hash(derived ?? "")}`;
};

const hash = (s: string): string => {
  // Cheap stable hash; doesn't need to be cryptographic, just collision-resistant
  // enough that two distinct schemas don't share a session.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
};

const buildAskOpts = (options: IAskOptions): Record<string, unknown> => {
  const opts: Record<string, unknown> = {
    cwd: options.cwd ?? "/tmp",
    settingSources: "",
    allowedTools: [],
    disableSlashCommands: true,
    permissionMode: "bypassPermissions",
  };
  if (options.model !== undefined) {
    opts.model = options.model;
  }
  if (options.signal !== undefined) {
    opts.signal = options.signal;
  }
  if (options.maxCostUsd !== undefined) {
    opts.maxCostUsd = options.maxCostUsd;
  }
  return opts;
};

const translateKnownCode = (code: string): TKnownErrorCode => {
  switch (code) {
    case "not-authenticated":
    case "permission-denied":
      return "auth-required";
    case "retry-exhausted":
      return "retry-exhausted";
    case "rate-limit":
      return "rate-limit";
    case "overloaded":
      return "overloaded";
    case "context-length-exceeded":
      return "context-length";
    case "binary-not-found":
      return "agent-not-installed";
    default:
      return "stream-error";
  }
};

const translateError = (err: unknown): never => {
  if (err instanceof ClaudeJsonValidationError) {
    const issues = err.issues.map((iss) => ({
      message: iss.message ?? "validation issue",
      ...(iss.path !== undefined ? { path: iss.path } : {}),
    }));
    throw new JsonValidationError(err.message, err.rawText, issues, { agent: "claude", cause: err });
  }
  if (err instanceof ClaudeAbortError || (err instanceof Error && err.name === "AbortError")) {
    throw new AbortError(err instanceof Error ? err.message : "aborted", { agent: "claude", cause: err });
  }
  if (err instanceof ClaudeKnownError || (err instanceof Error && isKnownError(err))) {
    const code = translateKnownCode((err as ClaudeKnownError).code);
    throw new WireError(code, err.message, { agent: "claude", cause: err });
  }
  throw err;
};

const adaptResult = <T>(
  data: T,
  raw: {
    text: string;
    thinking: string;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    tokensCacheRead: number;
    tokensCacheCreation: number;
    duration: number | undefined;
    sessionId?: string;
  },
): IJsonResult<T> => {
  const bucket = {
    totalUsd: raw.costUsd,
    tokensIn: raw.tokensIn,
    tokensOut: raw.tokensOut,
    tokensCacheRead: raw.tokensCacheRead,
    tokensCacheWrite: raw.tokensCacheCreation,
    turns: 1,
  };
  const cost: ICostSnapshot = {
    ...bucket,
    byAgent: { claude: bucket } as ICostSnapshot["byAgent"],
  };
  const result: IAskResult = {
    text: raw.text,
    thinking: raw.thinking,
    stopReason: "end_turn",
    usage: {
      tokensIn: raw.tokensIn,
      tokensOut: raw.tokensOut,
      tokensCacheRead: raw.tokensCacheRead,
      tokensCacheWrite: raw.tokensCacheCreation,
      costUsd: raw.costUsd,
    },
    cost,
    sessionId: raw.sessionId ?? "",
    agent: "claude",
    durationMs: raw.duration ?? 0,
  };
  return { data, raw: result };
};

const askStateless = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions): Promise<IJsonResult<T>> => {
  try {
    const result = await claudeClient.askJson(prompt, schema as IClaudeStandardSchema<T>, buildAskOpts(options));
    return adaptResult(result.data, result.raw);
  } catch (err) {
    translateError(err);
    throw err;
  }
};

/**
 * A pool of strict claude-wire sessions, keyed by schema fingerprint within
 * a single (systemPrompt) scope. Created once per agents-wire session that
 * targets Claude; closed when that session closes.
 */
export interface IClaudeDelegatePool {
  askJson: <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions, systemPrompt: string) => Promise<IJsonResult<T>>;
  close: () => Promise<void>;
}

export const createClaudeDelegatePool = (): IClaudeDelegatePool => {
  const sessions = new Map<string, IClaudeSession>();
  const inflight = new Map<string, Promise<IClaudeSession>>();
  let closed = false;

  const acquire = async <T>(schema: TSchemaInput<T>, options: IAskOptions, systemPrompt: string): Promise<IClaudeSession> => {
    if (closed) {
      throw new WireError("connection-closed", "Claude delegate pool is closed", { agent: "claude" });
    }
    const fp = await fingerprintSchema(schema);
    const key = hash(JSON.stringify([systemPrompt, fp, options.cwd ?? "", options.model ?? ""]));
    const existing = sessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = inflight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const pendingSession = (async (): Promise<IClaudeSession> => {
      const jsonSchema = typeof schema === "string" ? schema : await deriveJsonSchema(schema as IClaudeStandardSchema<T>);
      if (jsonSchema === undefined) {
        throw new WireError("stream-error", "Could not derive JSON Schema from input", { agent: "claude" });
      }
      const session = createClaudeSession({
        ...buildAskOpts(options),
        jsonSchema,
        systemPrompt,
      });
      if (closed) {
        await session.close();
        throw new WireError("connection-closed", "Claude delegate pool is closed", { agent: "claude" });
      }
      sessions.set(key, session);
      return session;
    })();
    inflight.set(key, pendingSession);
    try {
      return await pendingSession;
    } catch (err) {
      inflight.delete(key);
      throw err;
    } finally {
      if (inflight.get(key) === pendingSession) {
        inflight.delete(key);
      }
    }
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions, systemPrompt: string): Promise<IJsonResult<T>> => {
    const session = await acquire(schema, options, systemPrompt);
    try {
      const result = await session.askJson(
        prompt,
        schema as IClaudeStandardSchema<T>,
        options.signal !== undefined ? { signal: options.signal } : {},
      );
      return adaptResult(result.data, result.raw);
    } catch (err) {
      translateError(err);
      throw err;
    }
  };

  const close = async (): Promise<void> => {
    closed = true;
    const pending = Array.from(inflight.values());
    inflight.clear();
    const settled = await Promise.allSettled(pending);
    const all = new Set<IClaudeSession>(sessions.values());
    sessions.clear();
    for (const result of settled) {
      if (result.status === "fulfilled") {
        all.add(result.value);
      }
    }
    for (const session of all) {
      try {
        await session.close();
      } catch {
        // best-effort
      }
    }
  };

  return { askJson, close };
};

/**
 * One-shot delegate entrypoint for `client.askJson("claude", …)`. Branches
 * on systemPrompt presence: pooled strict session if set, stateless if not.
 * Keeps a process-level pool so multiple one-shot askJson calls with the
 * same (systemPrompt, schema) reuse one warm CLI process.
 */
const sharedPool = createClaudeDelegatePool();

export const delegateAskJson = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions): Promise<IJsonResult<T>> => {
  if (options.systemPrompt !== undefined && options.systemPrompt.length > 0) {
    return sharedPool.askJson(prompt, schema, options, options.systemPrompt);
  }
  return askStateless(prompt, schema, options);
};

export const closeSharedDelegatePool = async (): Promise<void> => {
  await sharedPool.close();
};
