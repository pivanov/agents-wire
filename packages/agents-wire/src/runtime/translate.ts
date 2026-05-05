import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { IAsyncQueue } from "@/internal/async-queue";
import type { IAvailableCommand, IPlanEntry, IToolCallLocation, TAgentEvent } from "@/types/events";
import type { IUsageReport } from "@/types/results";

export interface ISessionStreamState {
  textBuffer: string;
  thinkingBuffer: string;
  lastUsage: IUsageReport | undefined;
  inFlightToolCalls: Map<string, { tool: string }>;
  lastActivityAt: number;
}

export const createStreamState = (now: number): ISessionStreamState => ({
  textBuffer: "",
  thinkingBuffer: "",
  lastUsage: undefined,
  inFlightToolCalls: new Map(),
  lastActivityAt: now,
});

const isMeaningfulActivity = (kind: SessionUpdate["sessionUpdate"]): boolean =>
  kind === "agent_message_chunk" || kind === "agent_thought_chunk" || kind === "tool_call" || kind === "tool_call_update" || kind === "plan";

const toLocations = (raw: ReadonlyArray<{ path: string; line?: number | null }> | null | undefined): readonly IToolCallLocation[] | undefined => {
  if (!raw || raw.length === 0) {
    return undefined;
  }
  return raw.map((entry) => (entry.line != null ? { path: entry.path, line: entry.line } : { path: entry.path }));
};

const toPlanEntries = (
  raw: ReadonlyArray<{ id?: string | null; title?: string; content?: string; status?: string | null; priority?: string | null }>,
): readonly IPlanEntry[] => {
  return raw.map((entry) => ({
    ...(entry.id ? { id: entry.id } : {}),
    title: entry.title ?? entry.content ?? "",
    status: (entry.status as IPlanEntry["status"]) ?? "pending",
    ...(entry.priority ? { priority: entry.priority } : {}),
  }));
};

export const toAvailableCommands = (raw: ReadonlyArray<{ name: string; description?: string | null }>): readonly IAvailableCommand[] => {
  return raw.map((entry) => (entry.description ? { name: entry.name, description: entry.description } : { name: entry.name }));
};

const toUsageReport = (update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>): IUsageReport => {
  const report: IUsageReport = {
    contextSize: update.size,
    contextUsed: update.used,
  };
  if (update.cost?.amount !== undefined && update.cost.currency.toUpperCase() === "USD") {
    return { ...report, costUsd: update.cost.amount };
  }
  return report;
};

interface ITranslateContext {
  readonly state: ISessionStreamState;
  readonly queue: IAsyncQueue<TAgentEvent>;
  readonly clock: () => number;
}

export const translate = (update: SessionUpdate, ctx: ITranslateContext): void => {
  if (isMeaningfulActivity(update.sessionUpdate)) {
    ctx.state.lastActivityAt = ctx.clock();
  }
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      if (update.content.type === "text") {
        ctx.state.textBuffer += update.content.text;
        ctx.queue.push({
          type: "text-delta",
          text: update.content.text,
          messageId: update.messageId ?? undefined,
        });
        return;
      }
      ctx.queue.push({ type: "raw", update });
      return;
    }
    case "agent_thought_chunk": {
      if (update.content.type === "text") {
        ctx.state.thinkingBuffer += update.content.text;
        ctx.queue.push({
          type: "thinking-delta",
          text: update.content.text,
          messageId: update.messageId ?? undefined,
        });
        return;
      }
      ctx.queue.push({ type: "raw", update });
      return;
    }
    case "tool_call": {
      ctx.state.inFlightToolCalls.set(update.toolCallId, { tool: update.title });
      ctx.queue.push({
        type: "tool-call",
        toolCallId: update.toolCallId,
        tool: update.title,
        kind: update.kind ?? undefined,
        status: update.status ?? undefined,
        input: update.rawInput,
        locations: toLocations(update.locations),
      });
      return;
    }
    case "tool_call_update": {
      if (update.status === "completed" || update.status === "failed") {
        ctx.state.inFlightToolCalls.delete(update.toolCallId);
      }
      ctx.queue.push({
        type: "tool-call-update",
        toolCallId: update.toolCallId,
        title: update.title ?? undefined,
        status: update.status ?? undefined,
        input: update.rawInput,
        output: update.rawOutput,
        locations: toLocations(update.locations),
      });
      return;
    }
    case "plan": {
      ctx.queue.push({ type: "plan", entries: toPlanEntries(update.entries) });
      return;
    }
    case "current_mode_update": {
      ctx.queue.push({ type: "mode-changed", modeId: update.currentModeId });
      return;
    }
    case "available_commands_update": {
      ctx.queue.push({
        type: "available-commands",
        commands: toAvailableCommands(update.availableCommands),
      });
      return;
    }
    case "config_option_update": {
      ctx.queue.push({ type: "config-options", options: update.configOptions });
      return;
    }
    case "session_info_update": {
      ctx.queue.push({
        type: "session-info",
        title: update.title ?? undefined,
        updatedAt: update.updatedAt ?? undefined,
      });
      return;
    }
    case "usage_update": {
      const usage = toUsageReport(update);
      ctx.state.lastUsage = usage;
      ctx.queue.push({ type: "usage", usage });
      return;
    }
    default: {
      ctx.queue.push({ type: "raw", update });
    }
  }
};
