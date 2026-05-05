import { enforceBudget } from "@/budget/guard";
import { createCostTracker, type ICostTracker } from "@/budget/tracker";
import { definitionFor } from "@/catalog/index";
import { WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
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
  return merged;
};

const buildSchemaSystemPrompt = async <T>(schema: TSchemaInput<T>, base?: string): Promise<string> => {
  const guidance = base ?? DEFAULT_JSON_SYSTEM_PROMPT;
  if (typeof schema === "string") {
    return `${guidance}\n\nJSON Schema:\n${schema}`;
  }
  if (isStandardSchema(schema)) {
    const derived = await standardSchemaToJsonSchema(schema);
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
  });
  const stream = host.prompt(sessionId, {
    prompt,
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
  stream.completion.catch(() => {});
  for await (const event of stream) {
    if (event.type === "usage") {
      cost.record(event.usage, agent, options.model);
      enforceBudget({ tracker: cost, agent, ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}) });
    }
  }
  const result = await stream.completion;
  options.onCostUpdate?.(cost.snapshot);
  return { result: { ...result, cost: cost.snapshot }, cost };
};

export const createClient = (agent: TAgentId, defaults: IAskOptions = {}): IAgentClient => {
  const ask = async (prompt: string, options: IAskOptions = {}): Promise<IAskResult> => {
    const merged = mergeOptions(defaults, options);
    const { result } = await runOneShot(agent, prompt, merged);
    return result;
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, options: IAskOptions = {}): Promise<IJsonResult<T>> => {
    const merged = mergeOptions(defaults, options);
    const systemPrompt = await buildSchemaSystemPrompt(schema, merged.systemPrompt);
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
        });
        const raw = host.prompt(sessionId, {
          prompt,
          ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
          ...(merged.command ? { command: merged.command } : {}),
          ...(merged.signal ? { signal: merged.signal } : {}),
        });
        upstreamCancel = raw.cancel;
        if (cancelRequested) {
          await raw.cancel();
        }
        for await (const event of raw) {
          if (event.type === "usage") {
            cost.record(event.usage, agent, merged.model);
            enforceBudget({
              tracker: cost,
              agent,
              ...(merged.maxCostUsd !== undefined ? { maxCostUsd: merged.maxCostUsd } : {}),
            });
          }
          eventQueue.push(event);
        }
        const result = await raw.completion;
        eventQueue.end();
        return { ...result, cost: cost.snapshot };
      } catch (cause) {
        eventQueue.fail(cause);
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
