import type { IToolHandler, IToolUseEvent, TToolDecision } from "@/types/options";

export interface IResolvedDecision {
  readonly decision: "allow" | "deny" | "rewrite-input";
  readonly reason?: string;
  readonly input?: unknown;
}

const normalizeDecision = (raw: TToolDecision): IResolvedDecision => {
  if (raw === "allow") {
    return { decision: "allow" };
  }
  if (raw === "deny") {
    return { decision: "deny" };
  }
  if (raw.decision === "rewrite-input") {
    return { decision: "rewrite-input", input: raw.input };
  }
  return raw.reason !== undefined ? { decision: raw.decision, reason: raw.reason } : { decision: raw.decision };
};

// Tool names land here as the agent emits them, which can vary in case
// across agents/sessions. Match case-insensitively so a "Bash" blocklist
// catches a "bash" event.
const isInList = (name: string, list: readonly string[]): boolean => {
  const lower = name.toLowerCase();
  return list.some((entry) => entry.toLowerCase() === lower);
};

export interface IToolHandlerInstance {
  resolve: (event: IToolUseEvent) => Promise<IResolvedDecision>;
}

export const createToolHandler = (handler?: IToolHandler): IToolHandlerInstance => {
  const allowed = handler?.allowed;
  const blocked = handler?.blocked;
  const callback = handler?.onToolUse;
  const errorFallback = handler?.onError;

  const resolve = async (event: IToolUseEvent): Promise<IResolvedDecision> => {
    if (allowed && allowed.length > 0 && !isInList(event.tool, allowed)) {
      return { decision: "deny", reason: `Tool "${event.tool}" not in allowed list` };
    }
    if (blocked && isInList(event.tool, blocked)) {
      return { decision: "deny", reason: `Tool "${event.tool}" is blocked` };
    }
    if (!callback) {
      return { decision: "allow" };
    }
    try {
      const raw = await callback(event);
      return normalizeDecision(raw);
    } catch (cause) {
      if (errorFallback) {
        const recovery = await errorFallback(cause, event);
        return normalizeDecision(recovery);
      }
      return { decision: "deny", reason: "onToolUse threw" };
    }
  };

  return { resolve };
};
