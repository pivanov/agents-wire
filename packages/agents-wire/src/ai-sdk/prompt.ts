import type { LanguageModelV3Prompt, SharedV3Warning } from "@ai-sdk/provider";

export interface IConvertedPrompt {
  readonly userText: string;
  readonly systemPrompt: string | undefined;
  readonly warnings: readonly SharedV3Warning[];
}

const extractText = (parts: ReadonlyArray<{ type: string; text?: string }>): string => {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
};

export const promptToText = (prompt: LanguageModelV3Prompt): IConvertedPrompt => {
  const systemSegments: string[] = [];
  const userSegments: string[] = [];
  const warnings: SharedV3Warning[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system": {
        if (typeof message.content === "string") {
          systemSegments.push(message.content);
        }
        break;
      }
      case "user": {
        userSegments.push(extractText(message.content));
        break;
      }
      case "assistant": {
        const text = extractText(message.content);
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

  return {
    userText: userSegments.join("\n\n"),
    systemPrompt: systemSegments.length > 0 ? systemSegments.join("\n\n") : undefined,
    warnings,
  };
};
