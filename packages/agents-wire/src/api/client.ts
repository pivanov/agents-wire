import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { definitionFor } from "@/catalog/index";
import { WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import { delegateAskJson } from "@/runtime/claude-delegate";
import { createWireHost } from "@/runtime/host";
import { standardSchemaToJsonSchema } from "@/schema/derive";
import { parseAndValidate } from "@/schema/parse";
import { DEFAULT_JSON_SYSTEM_PROMPT } from "@/schema/prompts";
import type { TSchemaInput } from "@/schema/standard";
import { isStandardSchema } from "@/schema/standard";
import type { IAgentCapabilities, TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";
import type { IAskOptions, ISessionOptions } from "@/types/options";
import type { IAskResult, IJsonResult } from "@/types/results";
import { createSession, type IAgentSession } from "./session";
import { type IAgentStream, wrapStream } from "./stream";

export interface IAgentClient {
  readonly agent: TAgentId;
  ask: (prompt: string, options?: IAskOptions) => Promise<IAskResult>;
  askJson: <T>(prompt: string, schema: TSchemaInput<T>, options?: IAskOptions) => Promise<IJsonResult<T>>;
  stream: (prompt: string, options?: IAskOptions) => IAgentStream;
  session: (options?: ISessionOptions) => Promise<IAgentSession>;
  capabilities: () => Promise<IAgentCapabilities>;
  with: (defaults: IAskOptions) => IAgentClient;
}

const mergeOptions = (defaults: IAskOptions, overrides: IAskOptions = {}): IAskOptions => {
  const merged: { -readonly [K in keyof IAskOptions]: IAskOptions[K] } = { ...defaults, ...overrides };
  if (overrides.toolHandler !== undefined && defaults.toolHandler !== undefined) {
    merged.toolHandler = { ...defaults.toolHandler, ...overrides.toolHandler };
  }
  if (overrides.env !== undefined && defaults.env !== undefined) {
    merged.env = { ...defaults.env, ...overrides.env };
  }
  if (overrides.meta !== undefined && defaults.meta !== undefined) {
    merged.meta = { ...defaults.meta, ...overrides.meta };
  }
  if (overrides.mcpServers !== undefined && defaults.mcpServers !== undefined) {
    // Concat instead of replace so calling `client.with({ mcpServers: [extra] })`
    // adds servers on top of the provider defaults. Override wins on name clash.
    const byName = new Map(defaults.mcpServers.map((s) => [s.name, s]));
    for (const s of overrides.mcpServers) {
      byName.set(s.name, s);
    }
    merged.mcpServers = Array.from(byName.values());
  }
  return merged;
};

const buildSchemaSystemPrompt = async <T>(schema: TSchemaInput<T>, base?: string, onWarning?: (msg: string) => void): Promise<string> => {
  const guidance = base ?? DEFAULT_JSON_SYSTEM_PROMPT;
  if (typeof schema === "string") {
    return `${guidance}\n\nJSON Schema:\n${schema}`;
  }
  if (isStandardSchema(schema)) {
    const derived = await standardSchemaToJsonSchema(schema, onWarning);
    if (derived) {
      return `${guidance}\n\nJSON Schema:\n${derived}`;
    }
  }
  return guidance;
};

interface IOneShotResult {
  readonly result: IAskResult;
  readonly cost: ICostTracker;
}

const runOneShot = async (agent: TAgentId, prompt: string, options: IAskOptions): Promise<IOneShotResult> => {
  const definition = definitionFor(agent);
  await using host = await createWireHost(definition, { ...options, agentId: agent });
  const sessionId = await host.newSession({
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
  const cost = createCostTracker({
    ...(options.maxCostUsd !== undefined ? { budgetUsd: options.maxCostUsd } : {}),
    ...(options.costEstimator ? { estimator: options.costEstimator } : {}),
    ...(options.onCostUpdate ? { onUpdate: options.onCostUpdate } : {}),
    ...(options.onWarning ? { onWarning: options.onWarning } : {}),
  });
  const stream = host.prompt(sessionId, {
    prompt,
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
  stream.completion.catch(() => {});
  try {
    for await (const event of stream) {
      if (event.type === "usage") {
        // cost.record() throws BudgetExceededError when budgetUsd is set.
        cost.record(event.usage, agent, options.model);
      }
    }
    const result = await stream.completion;
    // Tracker's onUpdate already fired options.onCostUpdate per usage event.
    return { result: { ...result, cost: cost.snapshot }, cost };
  } catch (err) {
    try {
      await stream.cancel();
    } catch {
      /* swallow cancel-on-error */
    }
    throw err;
  }
};

export const createClient = (agent: TAgentId, defaults: IAskOptions = {}): IAgentClient => {
  const ask = async (prompt: string, options: IAskOptions = {}): Promise<IAskResult> => {
    const merged = mergeOptions(defaults, options);
    const { result } = await runOneShot(agent, prompt, merged);
    return result;
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions = {}): Promise<IJsonResult<T>> => {
    const merged = mergeOptions(defaults, options);
    // Claude routes through claude-wire's strict CLI channel
    // (--tools StructuredOutput + --json-schema). The generic ACP soft path
    // below is 0% reliable on real Haiku enrichment prompts; see the parity
    // harness in internal/parity-harness/ for numbers.
    if (agent === "claude") {
      return delegateAskJson(prompt, schema, merged);
    }
    // Always include DEFAULT_JSON_SYSTEM_PROMPT — caller's systemPrompt augments,
    // never replaces, the JSON-formatting guidance the parser depends on.
    const guidanceBase = merged.systemPrompt ? `${merged.systemPrompt}\n\n${DEFAULT_JSON_SYSTEM_PROMPT}` : DEFAULT_JSON_SYSTEM_PROMPT;
    const systemPrompt = await buildSchemaSystemPrompt(schema, guidanceBase, merged.onWarning);
    const raw = await ask(prompt, { ...merged, systemPrompt });
    const data = await parseAndValidate<T>(raw.text, schema);
    return { data, raw };
  };

  const stream = (prompt: string, options: IAskOptions = {}): IAgentStream => {
    const merged = mergeOptions(defaults, options);
    const eventQueue = createAsyncQueue<TAgentEvent>();
    const cost = createCostTracker({
      ...(merged.maxCostUsd !== undefined ? { budgetUsd: merged.maxCostUsd } : {}),
      ...(merged.costEstimator ? { estimator: merged.costEstimator } : {}),
      ...(merged.onCostUpdate ? { onUpdate: merged.onCostUpdate } : {}),
      ...(merged.onWarning ? { onWarning: merged.onWarning } : {}),
    });

    let upstreamCancel: () => Promise<void> = async () => {};
    let cancelRequested = false;

    const completion = (async (): Promise<IAskResult> => {
      // Short-circuit if cancel() landed before we even spawned the host.
      if (cancelRequested) {
        const err = new WireError("cancelled", "stream cancelled before start", { agent });
        eventQueue.fail(err);
        throw err;
      }
      const definition = definitionFor(agent);
      const host = await createWireHost(definition, { ...merged, agentId: agent });
      try {
        if (cancelRequested) {
          const err = new WireError("cancelled", "stream cancelled before session start", { agent });
          eventQueue.fail(err);
          throw err;
        }
        const sessionId = await host.newSession({
          ...(merged.cwd ? { cwd: merged.cwd } : {}),
          ...(merged.mcpServers ? { mcpServers: merged.mcpServers } : {}),
          ...(merged.meta ? { meta: merged.meta } : {}),
        });
        const raw = host.prompt(sessionId, {
          prompt,
          ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
          ...(merged.command ? { command: merged.command } : {}),
          ...(merged.signal ? { signal: merged.signal } : {}),
          ...(merged.meta ? { meta: merged.meta } : {}),
        });
        upstreamCancel = raw.cancel;
        if (cancelRequested) {
          await raw.cancel();
        }
        for await (const event of raw) {
          if (event.type === "usage") {
            cost.record(event.usage, agent, merged.model);
          }
          eventQueue.push(event);
        }
        const result = await raw.completion;
        eventQueue.end();
        return { ...result, cost: cost.snapshot };
      } catch (cause) {
        eventQueue.fail(cause);
        try {
          await upstreamCancel();
        } catch {
          /* swallow cancel-on-error */
        }
        throw cause;
      } finally {
        await host.close();
      }
    })();
    completion.catch(() => {});

    const cancel = async (): Promise<void> => {
      cancelRequested = true;
      try {
        await upstreamCancel();
      } catch {
        /* swallow cancel error */
      }
    };

    return wrapStream({
      sessionId: "",
      events: eventQueue,
      completion,
      cancel,
    });
  };

  const session = async (options: ISessionOptions = {}): Promise<IAgentSession> => {
    const merged = mergeOptions(defaults, options);
    return createSession(agent, merged);
  };

  const capabilities = async (): Promise<IAgentCapabilities> => {
    const definition = definitionFor(agent);
    await using host = await createWireHost(definition, { ...defaults, agentId: agent });
    return host.capabilities;
  };

  const withFn = (newDefaults: IAskOptions): IAgentClient => createClient(agent, mergeOptions(defaults, newDefaults));

  return { agent, ask, askJson, stream, session, capabilities, with: withFn };
};
