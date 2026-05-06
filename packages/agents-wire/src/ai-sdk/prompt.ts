import type { LanguageModelV3Prompt, SharedV3Warning } from "@ai-sdk/provider";

export interface IConvertedPrompt {
  readonly userText: string;
  readonly systemPrompt: string | undefined;
  readonly warnings: readonly SharedV3Warning[];
}

const extractText = (parts: ReadonlyArray<{ type: string; text?: string }>, droppedTypes: Set<string>): string => {
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      out.push(part.text);
    } else if (part.type !== "text") {
      droppedTypes.add(part.type);
    }
  }
  return out.join("");
};

export const promptToText = (prompt: LanguageModelV3Prompt): IConvertedPrompt => {
  const systemSegments: string[] = [];
  const userSegments: string[] = [];
  const warnings: SharedV3Warning[] = [];
  const droppedPartTypes = new Set<string>();

  for (const message of prompt) {
    switch (message.role) {
      case "system": {
        if (typeof message.content === "string") {
          systemSegments.push(message.content);
        }
        break;
      }
      case "user": {
        // Guard against an all-non-text user message producing an empty
        // segment that joins as a blank paragraph. The dropped-parts
        // warning still fires (extractText accumulated into
        // droppedPartTypes), but we don't ship a blank turn to the agent.
        const text = extractText(message.content, droppedPartTypes);
        if (text.length > 0) {
          userSegments.push(text);
        }
        break;
      }
      case "assistant": {
        const text = extractText(message.content, droppedPartTypes);
        if (text.length > 0) {
          userSegments.push(`[assistant said previously] ${text}`);
          warnings.push({
            type: "other",
            message: "assistant turn flattened to plain text — agents-wire drives stateful agents per-turn, not by replay.",
          });
        }
        break;
      }
      case "tool": {
        userSegments.push("[previous tool results are summarized in your context]");
        warnings.push({
          type: "other",
          message: "tool-result turn dropped — agents-wire surfaces tool results through its own event stream, not via prompt replay.",
        });
        break;
      }
    }
  }

  if (droppedPartTypes.size > 0) {
    // Surface lost non-text parts (image/file/etc.) so vision-prompt callers
    // notice their attachments never made it onto the wire.
    warnings.push({
      type: "other",
      message: `Non-text prompt parts dropped: ${[...droppedPartTypes].sort().join(", ")}. agents-wire only forwards text content over ACP today.`,
    });
  }

  return {
    userText: userSegments.join("\n\n"),
    systemPrompt: systemSegments.length > 0 ? systemSegments.join("\n\n") : undefined,
    warnings,
  };
};
