/**
 * connectMockHost - in-process ACP transport harness for testing createWireHost.
 *
 * Builds two TransformStream pairs to form a fully in-process bidirectional ACP
 * Stream. One side is handed to AgentSideConnection (the scripted mock agent),
 * the other to createWireHost via the `_connection` testing hook. No subprocess
 * is spawned.
 *
 * @internal Testing only. The leading underscore on `_connection` signals this.
 */

import {
  type Stream as AcpStream,
  type AgentCapabilities,
  AgentSideConnection,
  type AuthMethod,
  type ContentBlock,
  type PromptResponse,
  type SessionModeState,
  type StopReason,
} from "@agentclientprotocol/sdk";
import type { ISpawnedConnection } from "@/internal/spawn";
import { createWireHost, type IWireHost, type IWireHostOptions } from "@/runtime/host";
import type { IAgentDefinition, TAgentId } from "@/types/agent";
import type { TAgentEvent } from "@/types/events";

export interface IMockHostScript {
  /** Capabilities the mock agent reports during initialize. */
  readonly capabilities?: AgentCapabilities;
  /** Protocol version returned in initialize (default: 1). */
  readonly protocolVersion?: number;
  /** Auth methods returned in initialize. */
  readonly authMethods?: readonly AuthMethod[];
  /**
   * Per-prompt callback: receives session ID, prompt blocks, and a cancellation signal.
   * The signal is aborted when the client sends a cancel notification. Return events to
   * emit (via sessionUpdate notifications) before the prompt resolves.
   */
  readonly onPrompt?: (
    sessionId: string,
    blocks: readonly ContentBlock[],
    signal?: AbortSignal,
  ) => AsyncIterable<TAgentEvent> | Iterable<TAgentEvent>;
  /** Default stop reason when onPrompt is not provided. Defaults to "end_turn". */
  readonly stopReason?: StopReason;
  /** Throw during initialize to simulate init failure. */
  readonly initializeError?: Error;
  /** Throw during newSession to simulate session creation failure. */
  readonly newSessionError?: Error;
  /** Throw during prompt to simulate prompt failure. */
  readonly promptError?: Error;
  /**
   * Called when the client sends a setSessionMode request.
   * Default behavior: succeed silently.
   * Throw to simulate failure.
   */
  readonly onSetMode?: (sessionId: string, modeId: string) => void | Promise<void>;
  /**
   * Initial mode state to return in newSession responses.
   * When set, all new sessions will advertise these modes.
   */
  readonly initialModes?: SessionModeState;
}

export interface IConnectedMockHost {
  readonly host: IWireHost;
  readonly definition: IAgentDefinition;
  /** Append a line to the stderr tail buffer. */
  pushStderr: (line: string) => void;
  /** Resolve the `closed` promise with a given exit code / signal. */
  triggerExit: (exitCode: number, signal?: NodeJS.Signals) => void;
  close: () => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
}

/** Build a cross-connected in-process ACP Stream pair. */
const makeInProcessStreamPair = (): { agentStream: AcpStream; clientStream: AcpStream } => {
  const clientToAgent = new TransformStream<unknown, unknown>();
  const agentToClient = new TransformStream<unknown, unknown>();

  const agentStream: AcpStream = {
    readable: clientToAgent.readable as ReadableStream<never>,
    writable: agentToClient.writable as WritableStream<never>,
  };

  const clientStream: AcpStream = {
    readable: agentToClient.readable as ReadableStream<never>,
    writable: clientToAgent.writable as WritableStream<never>,
  };

  return { agentStream, clientStream };
};

const agentEventToUpdatePayload = (event: TAgentEvent): Record<string, unknown> | undefined => {
  switch (event.type) {
    case "text-delta":
      return {
        sessionUpdate: "agent_message_chunk",
        ...(event.messageId !== undefined ? { messageId: event.messageId } : {}),
        content: { type: "text", text: event.text },
      };
    case "thinking-delta":
      return {
        sessionUpdate: "agent_thought_chunk",
        ...(event.messageId !== undefined ? { messageId: event.messageId } : {}),
        content: { type: "text", text: event.text },
      };
    case "tool-call":
      return {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: event.tool,
        ...(event.kind !== undefined ? { kind: event.kind } : {}),
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.input !== undefined ? { rawInput: event.input } : {}),
        ...(event.locations !== undefined ? { locations: [...event.locations] } : {}),
      };
    case "tool-call-update":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.input !== undefined ? { rawInput: event.input } : {}),
        ...(event.output !== undefined ? { rawOutput: event.output } : {}),
        ...(event.locations !== undefined ? { locations: [...event.locations] } : {}),
      };
    case "plan":
      return {
        sessionUpdate: "plan",
        entries: event.entries.map((e) => ({
          // ACP SDK PlanEntry uses 'content' (required) and 'priority' (required)
          content: e.title,
          status: e.status || "pending",
          priority: (e.priority as "high" | "medium" | "low") ?? "medium",
        })),
      };
    case "mode-changed":
      return { sessionUpdate: "current_mode_update", currentModeId: event.modeId };
    case "available-commands":
      return {
        sessionUpdate: "available_commands_update",
        availableCommands: event.commands.map((c) => ({
          name: c.name,
          ...(c.description !== undefined ? { description: c.description } : {}),
        })),
      };
    case "config-options":
      return { sessionUpdate: "config_option_update", configOptions: event.options };
    case "session-info":
      return {
        sessionUpdate: "session_info_update",
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.updatedAt !== undefined ? { updatedAt: event.updatedAt } : {}),
      };
    case "usage":
      return {
        sessionUpdate: "usage_update",
        size: event.usage.contextSize,
        used: event.usage.contextUsed,
        ...(event.usage.costUsd !== undefined ? { cost: { amount: event.usage.costUsd, currency: "USD" } } : {}),
      };
    default:
      // raw, permission-request - not meaningful on the agent side
      return undefined;
  }
};

const DEFAULT_MOCK_DEFINITION: IAgentDefinition = {
  id: "mock" as TAgentId,
  label: "Mock Agent",
  transport: "native-acp",
  launch: () => {
    throw new Error("mock-host: should never call launch()");
  },
  installNotice: "",
};

/**
 * Creates an in-process mock host for integration testing.
 *
 * The harness wires an AgentSideConnection driven by the `script` argument,
 * then calls createWireHost with a fake ISpawnedConnection that wraps the
 * in-process streams. No subprocess is spawned.
 *
 * @param script - Optional scripted behaviour for the mock agent.
 * @param overrides - Optional definition / options overrides.
 */
export const connectMockHost = async (
  script: IMockHostScript = {},
  overrides: {
    definition?: Partial<IAgentDefinition>;
    options?: Partial<Omit<IWireHostOptions, "agentId">>;
  } = {},
): Promise<IConnectedMockHost> => {
  const definition: IAgentDefinition = {
    ...DEFAULT_MOCK_DEFINITION,
    ...overrides.definition,
  };

  const { agentStream, clientStream } = makeInProcessStreamPair();

  const stderrTailLines: string[] = [];
  let exitResolve: ((value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const closedPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    exitResolve = resolve;
  });

  let sessionCounter = 0;

  // Per-session cancel controllers so cancel() can interrupt in-flight prompt generators
  const sessionCancelControllers = new Map<string, AbortController>();

  const _agentConn = new AgentSideConnection((conn) => {
    return {
      initialize: async (params) => {
        if (script.initializeError) {
          throw script.initializeError;
        }
        return {
          protocolVersion: script.protocolVersion ?? params.protocolVersion,
          agentCapabilities: (script.capabilities ?? {}) as AgentCapabilities,
          authMethods: script.authMethods ? [...script.authMethods] : [],
        };
      },

      newSession: async (_params) => {
        if (script.newSessionError) {
          throw script.newSessionError;
        }
        sessionCounter += 1;
        return {
          sessionId: `mock-session-${sessionCounter}`,
          ...(script.initialModes ? { modes: script.initialModes } : {}),
        };
      },

      loadSession: async (_params) => {
        if (script.newSessionError) {
          throw script.newSessionError;
        }
        return {
          ...(script.initialModes ? { modes: script.initialModes } : {}),
        };
      },

      authenticate: async (_params) => {
        return {};
      },

      prompt: async (params): Promise<PromptResponse> => {
        if (script.promptError) {
          throw script.promptError;
        }
        const { sessionId } = params;
        const blocks = params.prompt;

        // Set up a per-prompt cancel controller
        const cancelCtrl = new AbortController();
        sessionCancelControllers.set(sessionId, cancelCtrl);

        try {
          if (script.onPrompt) {
            const iter = script.onPrompt(sessionId, blocks, cancelCtrl.signal);
            for await (const event of iter) {
              if (cancelCtrl.signal.aborted) {
                break;
              }
              const payload = agentEventToUpdatePayload(event);
              if (payload) {
                await conn.sessionUpdate({
                  sessionId,
                  update: payload as Parameters<typeof conn.sessionUpdate>[0]["update"],
                });
              }
            }
          }
        } finally {
          sessionCancelControllers.delete(sessionId);
        }

        const stopReason = cancelCtrl.signal.aborted ? "cancelled" : (script.stopReason ?? "end_turn");
        return { stopReason };
      },

      cancel: async (params) => {
        const { sessionId } = params;
        sessionCancelControllers.get(sessionId)?.abort();
        return;
      },

      setSessionMode: async (params) => {
        if (script.onSetMode) {
          await script.onSetMode(params.sessionId, params.modeId);
        }
        return {};
      },

      // Quiet no-op so tests that exercise the model/effort prefs path
      // (host.ts finalizeSession → acp.setSessionConfigOption) don't
      // produce "Method not found" stderr noise. Real agents either
      // implement this or return -32601, which the host already swallows.
      setSessionConfigOption: async (_params) => {
        return { configOptions: [] };
      },
    };
  }, agentStream);

  // Suppress unused variable - agentConn is kept alive by the stream reference
  void _agentConn;

  const fakeConnection: ISpawnedConnection = {
    definition,
    stream: clientStream,
    stderrTail: () => [...stderrTailLines],
    closed: closedPromise,
    dispose: async () => {
      exitResolve?.({ exitCode: 0, signal: null });
    },
  };

  const hostOptions: IWireHostOptions = {
    agentId: definition.id,
    ...overrides.options,
    // Testing hook: bypass launchAgent and use fakeConnection directly.
    _connection: fakeConnection,
  };

  const host = await createWireHost(definition, hostOptions);

  const close = async (): Promise<void> => {
    await host.close();
  };

  return {
    host,
    definition,
    pushStderr: (line) => {
      stderrTailLines.push(line);
    },
    triggerExit: (exitCode, signal) => {
      exitResolve?.({ exitCode, signal: signal ?? null });
    },
    close,
    [Symbol.asyncDispose]: close,
  };
};
