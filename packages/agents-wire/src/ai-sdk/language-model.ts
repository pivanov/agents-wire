import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { definitionFor } from "@/catalog/index";
import { AI_SDK_PROVIDER_OPTIONS_KEY, PACKAGE_NAME } from "@/constants";
import { AbortError, WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import { createWireHost, type IWireHost } from "@/runtime/host";
import type { IAgentAdapter, IAgentDefinition, TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";
import type { IAgentOptions, ISlashCommand } from "@/types/options";
import type { TStopReason } from "@/types/results";
import { promptToText } from "./prompt";

const TEXT_BLOCK_ID = "agents-wire-text";
const REASONING_BLOCK_ID = "agents-wire-reasoning";

const mapFinishReason = (reason: TStopReason): LanguageModelV3FinishReason => {
  const raw = String(reason);
  switch (reason) {
    case "end_turn":
      return { unified: "stop", raw };
    case "max_tokens":
      return { unified: "length", raw };
    case "cancelled":
      // AI SDK convention (Anthropic, OpenAI providers): aborts surface
      // through the AbortSignal path, not via finishReason — finish stays
      // "stop" so retry-on-error logic doesn't fire on user-initiated cancels.
      return { unified: "stop", raw };
    case "refusal":
      return { unified: "content-filter", raw };
    default:
      return { unified: "other", raw };
  }
};

interface IUsageState {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
}

const buildUsage = (state: IUsageState): LanguageModelV3Usage => ({
  inputTokens: {
    total: state.tokensIn,
    noCache: Math.max(0, state.tokensIn - state.tokensCacheRead),
    cacheRead: state.tokensCacheRead || undefined,
    cacheWrite: state.tokensCacheWrite || undefined,
  },
  outputTokens: {
    total: state.tokensOut,
    text: state.tokensOut,
    reasoning: undefined,
  },
});

const usageDelta = (
  prev: IUsageState,
  next: { contextUsed?: number; tokensIn?: number; tokensOut?: number; tokensCacheRead?: number; tokensCacheWrite?: number },
): IUsageState => ({
  tokensIn: next.tokensIn ?? prev.tokensIn,
  tokensOut: next.tokensOut ?? prev.tokensOut,
  tokensCacheRead: next.tokensCacheRead ?? prev.tokensCacheRead,
  tokensCacheWrite: next.tokensCacheWrite ?? prev.tokensCacheWrite,
});

const adapterToDefinition = (a: IAgentAdapter): IAgentDefinition => ({
  id: a.id,
  label: a.label,
  transport: "native-acp",
  launch: a.launch,
  ...(a.probe ? { probe: a.probe } : {}),
  installNotice: a.installNotice ?? "",
  ...(a.homepage ? { homepage: a.homepage } : {}),
});

const parseCommand = (cmd: ISlashCommand | string | undefined): ISlashCommand | undefined => {
  if (cmd === undefined) {
    return undefined;
  }
  if (typeof cmd === "object") {
    return cmd;
  }
  if (typeof cmd === "string" && cmd.startsWith("/")) {
    const spaceIdx = cmd.indexOf(" ");
    if (spaceIdx === -1) {
      return { name: cmd.slice(1) };
    }
    return { name: cmd.slice(1, spaceIdx), input: cmd.slice(spaceIdx + 1) };
  }
  return undefined;
};

const UNSUPPORTED_CALL_OPTIONS: ReadonlyArray<keyof LanguageModelV3CallOptions> = [
  "temperature",
  "topP",
  "frequencyPenalty",
  "presencePenalty",
  "stopSequences",
  "seed",
  "responseFormat",
  "tools",
  "toolChoice",
] as const;

const callOptionWarnings = (options: LanguageModelV3CallOptions): SharedV3Warning[] => {
  const warnings: SharedV3Warning[] = [];
  for (const key of UNSUPPORTED_CALL_OPTIONS) {
    if (options[key] !== undefined) {
      warnings.push({ type: "unsupported", feature: key as string });
    }
  }
  return warnings;
};

interface IBootstrapResult {
  readonly host: IWireHost;
  readonly sessionId: string;
}

/** @internal Testing only - override the host bootstrap (creating the wire host and opening a session). */
export interface IAgentSettingsInternal extends IAgentOptions {
  readonly _bootstrap?: (definition: IAgentDefinition, agentId: TAgentId, settings: IAgentOptions) => Promise<{ host: IWireHost; sessionId: string }>;
}

const defaultBootstrap = async (definition: IAgentDefinition, agentId: TAgentId, settings: IAgentOptions): Promise<IBootstrapResult> => {
  const host = await createWireHost(definition, { ...settings, agentId });
  const sessionId = await host.newSession({
    ...(settings.cwd ? { cwd: settings.cwd } : {}),
    ...(settings.mcpServers ? { mcpServers: settings.mcpServers } : {}),
    ...(settings.meta ? { meta: settings.meta } : {}),
  });
  return { host, sessionId };
};

export const createAgentLanguageModel = (agentId: TAgentId, settings: IAgentOptions = {}, adapter?: IAgentAdapter): LanguageModelV3 => {
  const bootstrap = (settings as IAgentSettingsInternal)._bootstrap ?? defaultBootstrap;
  const supportedUrls: Record<string, RegExp[]> = {};

  const resolveDefinition = (): IAgentDefinition => (adapter ? adapterToDefinition(adapter) : definitionFor(agentId));

  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    // Pre-abort short-circuit: doStream has the same check; doGenerate was
    // missing it and would spawn a CLI just to immediately tear it down.
    if (options.abortSignal?.aborted) {
      throw options.abortSignal.reason ?? new AbortError("call aborted before start");
    }
    const warnings = callOptionWarnings(options);
    const providerOpts = (options.providerOptions?.[AI_SDK_PROVIDER_OPTIONS_KEY] ?? {}) as { command?: ISlashCommand | string };
    const command = parseCommand(providerOpts.command ?? settings.command);

    const { userText, systemPrompt, warnings: promptWarnings } = promptToText(options.prompt);
    warnings.push(...promptWarnings);
    const merged: IAgentOptions = {
      ...settings,
      ...(systemPrompt ? { systemPrompt } : settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : {}),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      ...(command ? { command } : {}),
    };

    const definition = resolveDefinition();
    const { host, sessionId } = await bootstrap(definition, agentId, merged);
    let usageState: IUsageState = { tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0 };
    try {
      const stream = host.prompt(sessionId, {
        prompt: userText,
        ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
        ...(command ? { command } : {}),
      });
      stream.completion.catch(() => {});
      for await (const event of stream) {
        if (event.type === "usage") {
          usageState = usageDelta(usageState, event.usage);
        }
      }
      const result = await stream.completion;
      const content: LanguageModelV3Content[] = [];
      if (result.thinking.length > 0) {
        content.push({ type: "reasoning", text: result.thinking });
      }
      if (result.text.length > 0) {
        content.push({ type: "text", text: result.text });
      }
      return {
        content,
        finishReason: mapFinishReason(result.stopReason),
        usage: buildUsage(usageState),
        warnings,
        providerMetadata: { [AI_SDK_PROVIDER_OPTIONS_KEY]: { sessionId } },
      };
    } finally {
      await host.close();
    }
  };

  const doStream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    const warnings = callOptionWarnings(options);
    const providerOpts = (options.providerOptions?.[AI_SDK_PROVIDER_OPTIONS_KEY] ?? {}) as { command?: ISlashCommand | string };
    const command = parseCommand(providerOpts.command ?? settings.command);

    const { userText, systemPrompt, warnings: promptWarnings } = promptToText(options.prompt);
    warnings.push(...promptWarnings);
    const merged: IAgentOptions = {
      ...settings,
      ...(systemPrompt ? { systemPrompt } : settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : {}),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      ...(command ? { command } : {}),
    };
    const partQueue = createAsyncQueue<LanguageModelV3StreamPart>();
    let usageState: IUsageState = { tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0 };
    let textOpen = false;
    let reasoningOpen = false;
    const toolNameById = new Map<string, string>();

    void (async () => {
      let host: IWireHost | undefined;
      let cancelStream: (() => Promise<void>) | undefined;
      const onAbort = (): void => {
        partQueue.fail(options.abortSignal?.reason ?? new WireError("cancelled", "stream aborted"));
        // If abort fires before stream.cancel is wired, fall back to closing
        // the host so the spawned process doesn't outlive the consumer.
        if (cancelStream) {
          void cancelStream();
        } else {
          void host?.close();
        }
      };
      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          // Pre-aborted: fire onAbort and bail. We never reached
          // bootstrap, so host is undefined and the IIFE's finally won't
          // try to close it. removeEventListener in the finally is a
          // no-op for a never-attached listener.
          onAbort();
          return;
        }
        options.abortSignal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const definition = resolveDefinition();
        const setup = await bootstrap(definition, agentId, merged);
        host = setup.host;
        partQueue.push({ type: "stream-start", warnings });
        partQueue.push({ type: "response-metadata", id: setup.sessionId });
        const stream = host.prompt(setup.sessionId, {
          prompt: userText,
          ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
          ...(options.abortSignal ? { signal: options.abortSignal } : {}),
          ...(command ? { command } : {}),
        });
        cancelStream = stream.cancel;
        stream.completion.catch(() => {});
        for await (const event of stream) {
          dispatch(event, partQueue, {
            openText: () => {
              if (!textOpen) {
                partQueue.push({ type: "text-start", id: TEXT_BLOCK_ID });
                textOpen = true;
              }
            },
            openReasoning: () => {
              if (!reasoningOpen) {
                partQueue.push({ type: "reasoning-start", id: REASONING_BLOCK_ID });
                reasoningOpen = true;
              }
            },
            updateUsage: (next) => {
              usageState = usageDelta(usageState, next);
            },
            rememberToolName: (id, name) => toolNameById.set(id, name),
            lookupToolName: (id) => toolNameById.get(id),
          });
        }
        if (reasoningOpen) {
          partQueue.push({ type: "reasoning-end", id: REASONING_BLOCK_ID });
        }
        if (textOpen) {
          partQueue.push({ type: "text-end", id: TEXT_BLOCK_ID });
        }
        const result = await stream.completion;
        partQueue.push({
          type: "finish",
          finishReason: mapFinishReason(result.stopReason),
          usage: buildUsage(usageState),
        });
        partQueue.end();
      } catch (cause) {
        // Close any open blocks first so AI SDK middleware that tracks
        // block lifecycle (text-start without text-end, etc.) doesn't
        // observe an invalid stream shape on error.
        if (reasoningOpen) {
          partQueue.push({ type: "reasoning-end", id: REASONING_BLOCK_ID });
        }
        if (textOpen) {
          partQueue.push({ type: "text-end", id: TEXT_BLOCK_ID });
        }
        // Best-effort finish so consumers that key off finish for usage
        // stats still get the partial usage we accumulated. The error
        // part follows so middleware that re-throws on error still does.
        partQueue.push({
          type: "finish",
          finishReason: { unified: "error", raw: "error" },
          usage: buildUsage(usageState),
        });
        partQueue.push({ type: "error", error: cause });
        partQueue.end();
      } finally {
        if (options.abortSignal) {
          options.abortSignal.removeEventListener("abort", onAbort);
        }
        await host?.close();
      }
    })();

    const iterator = partQueue[Symbol.asyncIterator]();
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      },
    });

    return { stream };
  };

  return {
    specificationVersion: "v3",
    provider: PACKAGE_NAME,
    modelId: agentId,
    supportedUrls,
    doGenerate,
    doStream,
  };
};

interface IDispatchHooks {
  openText: () => void;
  openReasoning: () => void;
  updateUsage: (next: { tokensIn?: number; tokensOut?: number; tokensCacheRead?: number; tokensCacheWrite?: number }) => void;
  // Tracks tool-name per toolCallId so tool-result re-uses the original
  // tool-call name; AI SDK consumers correlate by name in some flows.
  rememberToolName: (toolCallId: string, name: string) => void;
  lookupToolName: (toolCallId: string) => string | undefined;
}

const dispatch = (event: TAgentEvent, queue: ReturnType<typeof createAsyncQueue<LanguageModelV3StreamPart>>, hooks: IDispatchHooks): void => {
  switch (event.type) {
    case "text-delta": {
      hooks.openText();
      queue.push({ type: "text-delta", id: TEXT_BLOCK_ID, delta: event.text });
      return;
    }
    case "thinking-delta": {
      hooks.openReasoning();
      queue.push({ type: "reasoning-delta", id: REASONING_BLOCK_ID, delta: event.text });
      return;
    }
    case "tool-call": {
      hooks.rememberToolName(event.toolCallId, event.tool);
      queue.push({
        type: "tool-call",
        toolCallId: event.toolCallId,
        toolName: event.tool,
        input: typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {}),
        providerExecuted: true,
      });
      return;
    }
    case "tool-call-update": {
      const toolName = hooks.lookupToolName(event.toolCallId) ?? event.title ?? event.toolCallId;
      if (event.status === "completed" && event.output !== undefined) {
        queue.push({
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName,
          result: event.output as NonNullable<unknown>,
        });
      } else if (event.status === "failed") {
        queue.push({
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName,
          result: (event.output ?? "Tool call failed") as NonNullable<unknown>,
          isError: true,
        });
      }
      return;
    }
    case "usage": {
      hooks.updateUsage({
        ...(event.usage.tokensIn !== undefined ? { tokensIn: event.usage.tokensIn } : {}),
        ...(event.usage.tokensOut !== undefined ? { tokensOut: event.usage.tokensOut } : {}),
        ...(event.usage.tokensCacheRead !== undefined ? { tokensCacheRead: event.usage.tokensCacheRead } : {}),
        ...(event.usage.tokensCacheWrite !== undefined ? { tokensCacheWrite: event.usage.tokensCacheWrite } : {}),
      });
      return;
    }
    default: {
      queue.push({ type: "raw", rawValue: event });
    }
  }
};
