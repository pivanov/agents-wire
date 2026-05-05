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
      return { unified: "stop", raw };
    case "refusal":
      return { unified: "content-filter", raw };
    default:
      return { unified: "other", raw };
  }
};

const buildUsage = (state: { tokensIn: number; tokensOut: number }): LanguageModelV3Usage => ({
  inputTokens: {
    total: state.tokensIn,
    noCache: state.tokensIn,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: state.tokensOut,
    text: state.tokensOut,
    reasoning: undefined,
  },
});

const usageDelta = (
  prev: { tokensIn: number; tokensOut: number },
  next: { contextUsed?: number; tokensIn?: number; tokensOut?: number },
): { tokensIn: number; tokensOut: number } => ({
  tokensIn: next.tokensIn ?? prev.tokensIn,
  tokensOut: next.tokensOut ?? prev.tokensOut,
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
    let usageState = { tokensIn: 0, tokensOut: 0 };
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
    let usageState = { tokensIn: 0, tokensOut: 0 };
    let textOpen = false;
    let reasoningOpen = false;

    void (async () => {
      let host: IWireHost | undefined;
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
        partQueue.push({ type: "error", error: cause });
        partQueue.end();
      } finally {
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
  updateUsage: (next: { tokensIn?: number; tokensOut?: number }) => void;
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
      if (event.status === "completed" && event.output !== undefined) {
        queue.push({
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName: event.title ?? event.toolCallId,
          result: event.output as NonNullable<unknown>,
        });
      } else if (event.status === "failed") {
        queue.push({
          type: "tool-result",
          toolCallId: event.toolCallId,
          toolName: event.title ?? event.toolCallId,
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
      });
      return;
    }
    default: {
      queue.push({ type: "raw", rawValue: event });
    }
  }
};
