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
import type { IAgentSession } from "@/api/session";
import { createSession } from "@/api/session";
import { AI_SDK_PROVIDER_OPTIONS_KEY, PACKAGE_NAME } from "@/constants";
import { WireError } from "@/errors";
import { createAsyncQueue } from "@/internal/async-queue";
import type { TAgentId } from "@/types/agent";
import type { ISessionOptions, ISlashCommand } from "@/types/options";
import type { IUsageReport, TStopReason } from "@/types/results";
import { promptToText } from "./prompt";

const TEXT_BLOCK_ID = "agents-wire-session-text";
const REASONING_BLOCK_ID = "agents-wire-session-reasoning";

const buildUsage = (usage: IUsageReport | undefined): LanguageModelV3Usage => {
  const cacheRead = usage?.tokensCacheRead ?? 0;
  const cacheWrite = usage?.tokensCacheWrite ?? 0;
  const tokensIn = usage?.tokensIn ?? 0;
  return {
    inputTokens: {
      total: tokensIn,
      noCache: Math.max(0, tokensIn - cacheRead),
      cacheRead: cacheRead || undefined,
      cacheWrite: cacheWrite || undefined,
    },
    outputTokens: { total: usage?.tokensOut ?? 0, text: usage?.tokensOut ?? 0, reasoning: undefined },
  };
};

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

export interface IAgentSessionModel {
  readonly model: LanguageModelV3;
  readonly session: IAgentSession;
  readonly close: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

const buildSessionModel = (agent: TAgentId, session: IAgentSession, sessionOptions: ISessionOptions = {}): LanguageModelV3 => {
  const supportedUrls: Record<string, RegExp[]> = {};

  const doGenerate = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
    // Pre-abort short-circuit (matches doStream + language-model.doGenerate).
    if (options.abortSignal?.aborted) {
      throw options.abortSignal.reason ?? new WireError("cancelled", "call aborted before start", { agent });
    }
    const warnings = callOptionWarnings(options);
    const providerOpts = (options.providerOptions?.[AI_SDK_PROVIDER_OPTIONS_KEY] ?? {}) as { command?: ISlashCommand | string };
    const command = parseCommand(providerOpts.command ?? sessionOptions.command);

    const { userText, systemPrompt, warnings: promptWarnings } = promptToText(options.prompt);
    warnings.push(...promptWarnings);
    const result = await session.ask(userText, {
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      ...(command ? { command } : {}),
    });
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
      usage: buildUsage(result.usage),
      warnings,
      providerMetadata: { [AI_SDK_PROVIDER_OPTIONS_KEY]: { sessionId: result.sessionId } },
    };
  };

  const doStream = async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
    const warnings = callOptionWarnings(options);
    const providerOpts = (options.providerOptions?.[AI_SDK_PROVIDER_OPTIONS_KEY] ?? {}) as { command?: ISlashCommand | string };
    const command = parseCommand(providerOpts.command ?? sessionOptions.command);

    const { userText, systemPrompt, warnings: promptWarnings } = promptToText(options.prompt);
    warnings.push(...promptWarnings);
    const partQueue = createAsyncQueue<LanguageModelV3StreamPart>();
    let textOpen = false;
    let reasoningOpen = false;
    const toolNameById = new Map<string, string>();

    void (async () => {
      let cancelStream: (() => Promise<void>) | undefined;
      const onAbort = (): void => {
        partQueue.fail(options.abortSignal?.reason ?? new WireError("cancelled", "stream aborted"));
        if (cancelStream) {
          void cancelStream();
        }
      };
      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          onAbort();
          return;
        }
        options.abortSignal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        partQueue.push({ type: "stream-start", warnings });
        partQueue.push({ type: "response-metadata", id: session.sessionId });
        const stream = session.stream(userText, {
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(options.abortSignal ? { signal: options.abortSignal } : {}),
          ...(command ? { command } : {}),
        });
        cancelStream = stream.cancel;
        for await (const event of stream) {
          if (event.type === "text-delta") {
            if (!textOpen) {
              partQueue.push({ type: "text-start", id: TEXT_BLOCK_ID });
              textOpen = true;
            }
            partQueue.push({ type: "text-delta", id: TEXT_BLOCK_ID, delta: event.text });
            continue;
          }
          if (event.type === "thinking-delta") {
            if (!reasoningOpen) {
              partQueue.push({ type: "reasoning-start", id: REASONING_BLOCK_ID });
              reasoningOpen = true;
            }
            partQueue.push({ type: "reasoning-delta", id: REASONING_BLOCK_ID, delta: event.text });
            continue;
          }
          if (event.type === "tool-call") {
            toolNameById.set(event.toolCallId, event.tool);
            partQueue.push({
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.tool,
              input: typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {}),
              providerExecuted: true,
            });
            continue;
          }
          if (event.type === "tool-call-update") {
            const toolName = toolNameById.get(event.toolCallId) ?? event.title ?? event.toolCallId;
            if (event.status === "completed" && event.output !== undefined) {
              partQueue.push({
                type: "tool-result",
                toolCallId: event.toolCallId,
                toolName,
                result: event.output as NonNullable<unknown>,
              });
            } else if (event.status === "failed") {
              partQueue.push({
                type: "tool-result",
                toolCallId: event.toolCallId,
                toolName,
                result: (event.output ?? "Tool call failed") as NonNullable<unknown>,
                isError: true,
              });
            }
          }
        }
        if (reasoningOpen) {
          partQueue.push({ type: "reasoning-end", id: REASONING_BLOCK_ID });
        }
        if (textOpen) {
          partQueue.push({ type: "text-end", id: TEXT_BLOCK_ID });
        }
        const result = await stream.result();
        partQueue.push({
          type: "finish",
          finishReason: mapFinishReason(result.stopReason),
          usage: buildUsage(result.usage),
        });
        partQueue.end();
      } catch (cause) {
        // Close any open blocks first so AI SDK consumers don't see
        // text-start without text-end on error.
        if (reasoningOpen) {
          partQueue.push({ type: "reasoning-end", id: REASONING_BLOCK_ID });
        }
        if (textOpen) {
          partQueue.push({ type: "text-end", id: TEXT_BLOCK_ID });
        }
        partQueue.push({
          type: "finish",
          finishReason: { unified: "error", raw: "error" },
          usage: buildUsage(undefined),
        });
        partQueue.push({ type: "error", error: cause });
        partQueue.end();
      } finally {
        if (options.abortSignal) {
          options.abortSignal.removeEventListener("abort", onAbort);
        }
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
    modelId: agent,
    supportedUrls,
    doGenerate,
    doStream,
  };
};

export const createAgentModelSession = async (agent: TAgentId, options: ISessionOptions = {}): Promise<IAgentSessionModel> => {
  const session = await createSession(agent, options);
  const model = buildSessionModel(agent, session, options);
  const close = (): Promise<void> => session.close();
  return { model, session, close, [Symbol.asyncDispose]: close };
};
