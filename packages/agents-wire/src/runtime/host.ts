import {
  type AgentCapabilities,
  type AuthMethod,
  type Client,
  ClientSideConnection,
  type ContentBlock,
  type Implementation,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionId,
  type SessionModeState,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  ACP_PROTOCOL_VERSION,
  AUTH_FAILURE_PATTERNS,
  CANCEL_DEADLINE_MS,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  PACKAGE_NAME,
  PACKAGE_TITLE,
  PACKAGE_VERSION,
  USAGE_LIMIT_PATTERNS,
} from "@/constants";
import {
  AgentConnectionClosedError,
  AgentInactivityError,
  AgentInitTimeoutError,
  AgentUnauthenticatedError,
  AgentUsageLimitError,
  CapabilityNotSupportedError,
  errorMessage,
  ProtocolVersionMismatchError,
  WireError,
} from "@/errors";
import { createAsyncQueue, type IAsyncQueue } from "@/internal/async-queue";
import { classifyRpcError, extractRpcMessage } from "@/internal/extract-rpc-error";
import { type ISpawnedConnection, type ISpawnOptions, launchAgent } from "@/internal/spawn";
import { createToolHandler, type IResolvedDecision } from "@/tools/handler";
import type { IAgentCapabilities, IAgentDefinition, TAgentId } from "@/types/agent";
import type { IAvailableCommand, TAgentEvent } from "@/types/events";
import type { IAgentOptions, IMcpServer, ISlashCommand } from "@/types/options";
import type { IAskResult, ISessionInfo, ISessionListPage, TStopReason } from "@/types/results";
import { policyToResolver, toPendingPermission } from "./permissions";
import { createStreamState, type ISessionStreamState, toAvailableCommands, translate } from "./translate";

interface ISessionRecord {
  readonly id: SessionId;
  readonly cwd: string;
  readonly mcpServers: readonly McpServer[];
  modeState: SessionModeState | undefined;
  configOptions: readonly SessionConfigOption[] | undefined;
  availableCommands: readonly IAvailableCommand[] | undefined;
  active: IActiveStream | undefined;
}

interface IActiveStream {
  readonly queue: IAsyncQueue<TAgentEvent>;
  readonly state: ISessionStreamState;
  readonly inactivityTimer: { handle: ReturnType<typeof setTimeout> | undefined };
  /**
   * Pending permission requests waiting for the consumer to call
   * `respond()` / `cancel()`. Each entry resolves the agent-facing
   * `Promise<RequestPermissionResponse>` as cancelled — used to drain
   * the queue on close / forceFail / queue.fail so the ACP RPC layer
   * doesn't hold dangling resolvers.
   */
  readonly pendingPermissionCancels: Set<() => void>;
  cancelled: boolean;
  forceFail: ((error: Error) => void) | undefined;
}

interface IHostPromptInput {
  readonly prompt: string | readonly ContentBlock[];
  readonly systemPrompt?: string;
  readonly command?: ISlashCommand;
  readonly signal?: AbortSignal;
  readonly meta?: Record<string, unknown>;
}

export interface IHostStream extends AsyncIterable<TAgentEvent> {
  readonly sessionId: SessionId;
  readonly completion: Promise<IAskResult>;
  cancel: () => Promise<void>;
}

export interface IWireHost {
  readonly definition: IAgentDefinition;
  readonly capabilities: IAgentCapabilities;
  readonly authMethods: readonly AuthMethod[];
  readonly agentInfo: Implementation | undefined;
  newSession: (input?: { cwd?: string; mcpServers?: readonly IMcpServer[]; meta?: Record<string, unknown> }) => Promise<SessionId>;
  /**
   * Load (resume) an existing session by id. Requires the agent to advertise
   * `loadSession` capability, otherwise throws `CapabilityNotSupportedError`.
   * The agent restores conversation history from its own persistent storage;
   * the SDK only re-registers the session locally and reapplies model / effort
   * preferences via `setSessionConfigOption`.
   */
  loadSession: (input: { sessionId: string; cwd?: string; mcpServers?: readonly IMcpServer[]; meta?: Record<string, unknown> }) => Promise<SessionId>;
  prompt: (sessionId: SessionId, input: IHostPromptInput) => IHostStream;
  cancel: (sessionId: SessionId) => Promise<void>;
  close: () => Promise<void>;
  listSessions: (input?: { cwd?: string; cursor?: string }) => Promise<ISessionListPage>;
  streamAllSessions: (input?: { cwd?: string }) => AsyncIterable<ISessionInfo>;
  getModeState: (sessionId: SessionId) => SessionModeState | undefined;
  setMode: (sessionId: SessionId, modeId: string) => Promise<void>;
  /**
   * Config options the agent declared for the session via the ACP `newSession`
   * response. Each entry tells the client what the agent accepts (model
   * selection, reasoning effort, etc.) including the valid values for `select`
   * options. Returns `undefined` if the agent advertised no options.
   */
  getConfigOptions: (sessionId: SessionId) => readonly SessionConfigOption[] | undefined;
  [Symbol.asyncDispose]: () => Promise<void>;
}

export interface IWireHostOptions extends IAgentOptions {
  readonly agentId: TAgentId;
  /**
   * @internal Testing only - inject a pre-built ISpawnedConnection to bypass launchAgent.
   * When present, `launchAgent` is skipped entirely. The leading underscore signals this
   * is not part of the public API.
   */
  readonly _connection?: ISpawnedConnection;
  /**
   * @internal Testing only - injectable clock for controlling inactivity timers in tests.
   * Defaults to `Date.now`. The leading underscore signals this is not part of the public API.
   */
  readonly _clock?: () => number;
}

const toContentBlocks = (input: IHostPromptInput["prompt"]): ContentBlock[] => {
  if (typeof input === "string") {
    return [{ type: "text", text: input }];
  }
  return [...input];
};

const formatSlashCommand = (command: ISlashCommand): string =>
  command.input && command.input.length > 0 ? `/${command.name} ${command.input}` : `/${command.name}`;

export const validateSlashCommand = (
  command: ISlashCommand | undefined,
  availableCommands: readonly IAvailableCommand[] | undefined,
  agentId: TAgentId,
): void => {
  if (!command) {
    return;
  }
  if (!availableCommands || availableCommands.length === 0) {
    return;
  }
  const known = availableCommands.some((c) => c.name === command.name);
  if (!known) {
    throw new WireError("stream-error", `Slash command "${command.name}" is not advertised by agent "${agentId}"`, { agent: agentId });
  }
};

const buildPromptBlocks = (
  prompt: IHostPromptInput["prompt"],
  systemPrompt: string | undefined,
  command: ISlashCommand | undefined,
  agentId: TAgentId,
  availableCommands: readonly IAvailableCommand[] | undefined,
  nativeSystemPrompt: boolean,
): ContentBlock[] => {
  validateSlashCommand(command, availableCommands, agentId);
  const blocks = toContentBlocks(prompt);
  if (command) {
    const commandText = formatSlashCommand(command);
    if (blocks.length > 0 && blocks[0]?.type === "text") {
      const firstBlock = blocks[0];
      blocks.splice(0, 1, { type: "text", text: `${commandText} ${firstBlock.text}` });
    } else {
      blocks.unshift({ type: "text", text: commandText });
    }
  }
  if (systemPrompt && !nativeSystemPrompt) {
    if (blocks.length > 0 && blocks[0]?.type === "text") {
      const firstBlock = blocks[0];
      blocks.splice(0, 1, { type: "text", text: `${systemPrompt}\n\n${firstBlock.text}` });
    } else {
      blocks.unshift({ type: "text", text: systemPrompt });
    }
  }
  return blocks;
};

const deriveCapabilities = (acp: AgentCapabilities): IAgentCapabilities => ({
  loadSession: Boolean(acp.loadSession),
  forkSession: Boolean(acp.sessionCapabilities?.fork),
  resumeSession: Boolean(acp.sessionCapabilities?.resume),
  closeSession: Boolean(acp.sessionCapabilities?.close),
  listSessions: Boolean(acp.sessionCapabilities?.list),
  additionalDirectories: Boolean(acp.sessionCapabilities?.additionalDirectories),
  mcp: {
    // ACP spec mandates stdio MCP support — there is no opt-out flag in McpCapabilities.
    stdio: true,
    http: Boolean(acp.mcpCapabilities?.http),
    sse: Boolean(acp.mcpCapabilities?.sse),
  },
  prompt: {
    text: true,
    image: Boolean(acp.promptCapabilities?.image),
    audio: Boolean(acp.promptCapabilities?.audio),
    embeddedContext: Boolean(acp.promptCapabilities?.embeddedContext),
  },
});

const adaptMcpServer = (server: IMcpServer): McpServer => {
  if (server.type === "http") {
    return {
      type: "http",
      name: server.name,
      url: server.url ?? "",
      ...(server.headers ? { headers: Object.entries(server.headers).map(([k, v]) => ({ name: k, value: v })) } : {}),
    } as McpServer;
  }
  if (server.type === "sse") {
    return { type: "sse", name: server.name, url: server.url ?? "" } as McpServer;
  }
  return {
    type: "stdio",
    name: server.name,
    command: server.command ?? "",
    args: server.args ? [...server.args] : [],
    env: server.env ? Object.entries(server.env).map(([name, value]) => ({ name, value })) : [],
  } as McpServer;
};

export const validateMcpServersWithCapabilities = (agentId: TAgentId, capabilities: IAgentCapabilities, servers: readonly IMcpServer[]): void => {
  for (const s of servers) {
    if (s.type === "http" && !capabilities.mcp.http) {
      throw new CapabilityNotSupportedError(agentId, "mcpCapabilities.http");
    }
    if (s.type === "sse" && !capabilities.mcp.sse) {
      throw new CapabilityNotSupportedError(agentId, "mcpCapabilities.sse");
    }
  }
};

const raceTimeout = <T>(promise: Promise<T>, timeoutMs: number, buildError: () => Error): Promise<T> => {
  if (timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(buildError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
};

export interface IStderrFatalMatch {
  readonly kind: "auth" | "usage";
  readonly line: string;
}

export const classifyStderrFatal = (
  line: string,
  authPatterns: readonly string[],
  usagePatterns: readonly string[],
): IStderrFatalMatch | undefined => {
  const lower = line.toLowerCase();
  for (const pattern of usagePatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return { kind: "usage", line };
    }
  }
  for (const pattern of authPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return { kind: "auth", line };
    }
  }
  return undefined;
};

export const createWireHost = async (definition: IAgentDefinition, options: IWireHostOptions): Promise<IWireHost> => {
  const sessions = new Map<SessionId, ISessionRecord>();
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
  const permissionTimeoutMs = options.permissionTimeoutMs ?? 0;
  const clock = options._clock ?? (() => Date.now());
  const policyResolver = policyToResolver(options.permission);
  const toolGate = createToolHandler(options.toolHandler);

  let rewriteInputWarned = false;

  const drainPendingPermissions = (active: IActiveStream): void => {
    for (const settle of [...active.pendingPermissionCancels]) {
      settle();
    }
  };

  const failActive = (active: IActiveStream, error: Error): void => {
    active.queue.fail(error);
    active.forceFail?.(error);
    drainPendingPermissions(active);
  };

  const handlePermission = async (request: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    const sessionId = request.sessionId as SessionId;
    const record = sessions.get(sessionId);
    if (record && options.toolHandler) {
      const decision: IResolvedDecision = await toolGate.resolve({
        toolCallId: request.toolCall.toolCallId,
        tool: request.toolCall.title ?? "",
        input: request.toolCall.rawInput,
        agent: definition.id,
        sessionId,
      });
      if (decision.decision === "deny") {
        const reject = request.options.find((option) => option.kind === "reject_once" || option.kind === "reject_always");
        if (reject) {
          return { outcome: { outcome: "selected", optionId: reject.optionId } };
        }
        return { outcome: { outcome: "cancelled" } };
      }
      if (decision.decision === "rewrite-input" && !rewriteInputWarned) {
        // ACP RequestPermissionResponse has no input-rewrite outcome — the
        // rewrite is applied locally to the tool-use event log only and the
        // *original* input still flows to the agent. Surface this once so a
        // user wiring up a sanitizer notices their rewrite isn't enforced.
        rewriteInputWarned = true;
        options.onWarning?.(
          `Tool decision "rewrite-input" is not enforceable over ACP — the original input flows to the agent unchanged. Use "deny" + a follow-up prompt edit instead.`,
        );
      }
    }
    if (!record?.active || options.permission !== "stream") {
      return policyResolver(request);
    }
    const active = record.active;
    return new Promise<RequestPermissionResponse>((resolveRequest) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const settleAsCancelled = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (deadline) {
          clearTimeout(deadline);
        }
        active.pendingPermissionCancels.delete(settleAsCancelled);
        resolveRequest({ outcome: { outcome: "cancelled" } });
      };
      const respond = (optionId: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (deadline) {
          clearTimeout(deadline);
        }
        active.pendingPermissionCancels.delete(settleAsCancelled);
        resolveRequest({ outcome: { outcome: "selected", optionId } });
      };
      const cancel = (): void => settleAsCancelled();
      active.pendingPermissionCancels.add(settleAsCancelled);
      // Optional deadline: when the consumer streams `permission-request`
      // events but never responds, the agent's tool call would otherwise
      // hang forever. Fail the stream loudly so the bug surfaces.
      if (permissionTimeoutMs > 0) {
        deadline = setTimeout(() => {
          if (settled) {
            return;
          }
          const err = new WireError(
            "stream-error",
            `Permission request for tool "${request.toolCall.title ?? request.toolCall.toolCallId}" was not answered within ${permissionTimeoutMs}ms. Either iterate permission-request events and call respond()/cancel(), or pick a non-stream permission policy.`,
            { agent: definition.id },
          );
          settleAsCancelled();
          active.queue.fail(err);
          active.forceFail?.(err);
        }, permissionTimeoutMs);
      }
      active.queue.push({ type: "permission-request", request: toPendingPermission(request, respond, cancel) });
    });
  };

  const handleSessionUpdate = (notification: SessionNotification): void => {
    const sessionId = notification.sessionId as SessionId;
    const record = sessions.get(sessionId);
    if (!record) {
      return;
    }
    const update = notification.update;
    if (update.sessionUpdate === "available_commands_update") {
      record.availableCommands = toAvailableCommands(update.availableCommands);
    }
    if (update.sessionUpdate === "config_option_update") {
      const configOptions = update.configOptions ?? [];
      record.configOptions = configOptions.length > 0 ? configOptions : undefined;
    }
    if (update.sessionUpdate === "current_mode_update") {
      // Dedupe: setMode() pushes a mode-changed event eagerly when its
      // RPC returns. Some agents also acknowledge by sending a
      // current_mode_update notification immediately after — without
      // this guard the consumer would observe the same logical change
      // twice. Skip the translate() push when the modeId already matches
      // what we last applied.
      if (!record.modeState) {
        record.modeState = { availableModes: [], currentModeId: update.currentModeId };
      } else if (record.modeState.currentModeId === update.currentModeId) {
        record.modeState = { ...record.modeState, currentModeId: update.currentModeId };
        return;
      } else {
        record.modeState = { ...record.modeState, currentModeId: update.currentModeId };
      }
    }
    if (!record.active) {
      return;
    }
    translate(update, {
      state: record.active.state,
      queue: record.active.queue,
      clock,
      definition,
    });
  };

  let stderrFatalEnabled = false;
  let fatalError: WireError | undefined;

  const authPatterns = definition.authFailurePatterns ?? [...AUTH_FAILURE_PATTERNS];
  const usagePatterns = definition.usageLimitPatterns ?? [...USAGE_LIMIT_PATTERNS];

  const wrappedOnStderr = (line: string): void => {
    options.onStderr?.(line);
    if (!stderrFatalEnabled || fatalError) {
      return;
    }
    const match = classifyStderrFatal(line, authPatterns, usagePatterns);
    if (!match) {
      return;
    }
    if (match.kind === "usage") {
      fatalError = new AgentUsageLimitError(definition.id, line);
    } else {
      fatalError = new AgentUnauthenticatedError(definition.id, line);
    }
    const err = fatalError;
    for (const record of sessions.values()) {
      if (record.active) {
        failActive(record.active, err);
      }
    }
  };

  let connection: ISpawnedConnection | undefined;
  if (options._connection) {
    // Testing-only: use the injected connection directly, bypassing launchAgent.
    connection = options._connection;
  } else {
    // modelPreference with configId "reasoning_effort" wins over top-level `effort` for back-compat.
    const effortValue =
      options.modelPreference?.configId === "reasoning_effort" && typeof options.modelPreference.value === "string"
        ? options.modelPreference.value
        : options.effort;
    const spawnOptions: ISpawnOptions = {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.envFilter ? { envFilter: options.envFilter } : {}),
      onStderr: wrappedOnStderr,
      ...(options.model ? { model: options.model } : {}),
      ...(effortValue ? { effort: effortValue } : {}),
    };
    connection = await launchAgent(definition, spawnOptions);
  }

  const clientHandlers: Client = {
    requestPermission: handlePermission,
    sessionUpdate: async (notification) => handleSessionUpdate(notification),
    // Feature 4: Terminal (HITL) handler wiring
    ...(options.terminal?.createTerminal ? { createTerminal: options.terminal.createTerminal } : {}),
    ...(options.terminal?.terminalOutput ? { terminalOutput: options.terminal.terminalOutput } : {}),
    ...(options.terminal?.releaseTerminal ? { releaseTerminal: options.terminal.releaseTerminal } : {}),
    ...(options.terminal?.waitForTerminalExit ? { waitForTerminalExit: options.terminal.waitForTerminalExit } : {}),
    ...(options.terminal?.killTerminal ? { killTerminal: options.terminal.killTerminal } : {}),
    // Feature 5: FileSystem handler wiring
    ...(options.fileSystem?.readTextFile ? { readTextFile: options.fileSystem.readTextFile } : {}),
    ...(options.fileSystem?.writeTextFile ? { writeTextFile: options.fileSystem.writeTextFile } : {}),
  };

  const acp = new ClientSideConnection(() => clientHandlers, connection.stream);

  // Enable stderr-fatal classification BEFORE acp.initialize so that
  // auth/usage-limit failures emitted on stderr during the handshake set
  // fatalError and become AgentUnauthenticatedError / AgentUsageLimitError
  // instead of being swallowed as a generic init-failed / init-timeout.
  stderrFatalEnabled = true;

  const initializeTimeoutMs = options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
  let initializeResponse: Awaited<ReturnType<typeof acp.initialize>>;
  try {
    initializeResponse = await raceTimeout(
      acp.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: PACKAGE_NAME, title: PACKAGE_TITLE, version: PACKAGE_VERSION },
      }),
      initializeTimeoutMs,
      () => new AgentInitTimeoutError(definition.id, initializeTimeoutMs),
    );
  } catch (cause) {
    await connection.dispose();
    // Prefer the stderr-classified fatal (auth/usage) over a generic
    // init-failed wrapper — the underlying root cause is more actionable.
    if (fatalError) {
      throw fatalError;
    }
    if (cause instanceof WireError) {
      throw cause;
    }
    throw new WireError("init-failed", `Failed to initialize ${definition.label}: ${errorMessage(cause)}`, {
      agent: definition.id,
      cause,
    });
  }

  const agentProto = initializeResponse.protocolVersion;
  if (typeof agentProto === "number" && agentProto > ACP_PROTOCOL_VERSION) {
    await connection.dispose();
    throw new ProtocolVersionMismatchError(definition.id, ACP_PROTOCOL_VERSION, agentProto);
  }

  const capabilities = deriveCapabilities(initializeResponse.agentCapabilities ?? {});
  const authMethods: readonly AuthMethod[] = initializeResponse.authMethods ?? [];

  let closed = false;
  void connection.closed.then((exit) => {
    try {
      if (closed) {
        return;
      }
      // Set the flag BEFORE invoking failActive — consumer hooks inside it
      // can throw, and we don't want other gates seeing closed=false after
      // the connection is gone.
      closed = true;
      const error = new AgentConnectionClosedError(definition.id, exit.exitCode, exit.signal, connection?.stderrTail() ?? []);
      for (const record of sessions.values()) {
        if (record.active) {
          failActive(record.active, error);
        }
      }
    } catch (cause) {
      // Surface consumer-callback errors via onWarning rather than swallow —
      // genuine bugs in failActive shouldn't be invisible.
      options.onWarning?.(`session-fail handler threw: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  });

  const validateMcpServers = (servers: readonly IMcpServer[]): void => {
    validateMcpServersWithCapabilities(definition.id, capabilities, servers);
  };

  /**
   * Apply model / effort / modelPreference to a freshly-created or freshly-
   * loaded session and register it locally. Shared by newSession + loadSession.
   * The `response` shape is the union of NewSessionResponse and LoadSessionResponse:
   * both expose configOptions / modes (loadSession also has models, ignored for now).
   */
  const finalizeSession = async (
    sessionId: SessionId,
    cwd: string,
    mcpServers: readonly McpServer[],
    response: { configOptions?: readonly SessionConfigOption[] | null; modes?: SessionModeState | null },
  ): Promise<SessionId> => {
    // Apply config options via setSessionConfigOption after session creation so
    // the agent receives them with the correct ACP shape (configId + value).
    //
    // Three sources of preferences, in order:
    //
    //   1. `options.model` — top-level model selector. Discover the
    //      agent's declared configId from `response.configOptions`
    //      (categories `model` / id `model` / fuzzy match). This is
    //      the path Claude / Codex / Copilot use; their CLI launch
    //      flags ignore --model, so without this call the agent
    //      silently uses its default model.
    //   2. `options.effort` — convenience top-level effort. Maps to
    //      `reasoning_effort` unless the caller already supplied an
    //      explicit modelPreference with that configId.
    //   3. `options.modelPreference` — explicit { configId, value }
    //      from the caller. Echoed verbatim.
    //
    // Each call is best-effort: agents without setSessionConfigOption
    // return -32601 (Method not found), which we swallow.
    // Register the session locally BEFORE applying preferences. If any
    // setSessionConfigOption hangs or close() runs mid-call, we still know
    // the agent-side session exists so we can clean it up rather than
    // leaking it forever.
    sessions.set(sessionId, {
      id: sessionId,
      cwd,
      mcpServers,
      modeState: response.modes ?? undefined,
      configOptions: response.configOptions && response.configOptions.length > 0 ? response.configOptions : undefined,
      availableCommands: undefined,
      active: undefined,
    });

    const prefs: { configId: string; value: string | boolean }[] = [];
    if (options.model) {
      const declaredConfigOptions = response.configOptions ?? [];
      const modelOpt = declaredConfigOptions.find(
        // M2 fix: also match hyphenated variants (e.g. "code-model-v2").
        (o) => o.type === "select" && (o.category === "model" || o.id === "model" || /(^|[_-])model([_-]|$)/i.test(o.id)),
      );
      const modelConfigId = modelOpt?.id ?? "model";
      prefs.push({ configId: modelConfigId, value: options.model });
    }
    if (options.effort && options.modelPreference?.configId !== "reasoning_effort") {
      prefs.push({ configId: "reasoning_effort", value: options.effort });
    }
    if (options.modelPreference) {
      prefs.push({ configId: options.modelPreference.configId, value: options.modelPreference.value });
    }
    for (const pref of prefs) {
      try {
        await acp.setSessionConfigOption({
          sessionId,
          configId: pref.configId,
          ...(typeof pref.value === "boolean" ? { type: "boolean" as const, value: pref.value } : { value: pref.value }),
        });
      } catch (cause) {
        const code = (cause as { code?: number } | null | undefined)?.code;
        if (code === -32601) {
          continue;
        }
        options.onWarning?.(`setSessionConfigOption(${pref.configId}) failed: ${errorMessage(cause)}`, {
          agent: definition.id,
          configId: pref.configId,
          ...(typeof code === "number" ? { code } : {}),
        });
      }
    }
    return sessionId;
  };

  // Resolve additionalDirectories from session-level options (NOT per-call —
  // newSession/loadSession deliberately don't accept it; the option lives on
  // ISessionOptions). Loose handling: gate by capability, warn-once-per-host
  // when the caller passed a list but the agent doesn't advertise the
  // capability. additionalDirectories is purely additive context, so silent
  // degradation produces a working session with reduced scope vs. a hard
  // failure. Documented in the CHANGELOG.
  let additionalDirectoriesWarned = false;
  const resolveAdditionalDirectories = (): readonly string[] | undefined => {
    const list = options.additionalDirectories;
    if (!list || list.length === 0) {
      return undefined;
    }
    if (!capabilities.additionalDirectories) {
      if (!additionalDirectoriesWarned) {
        additionalDirectoriesWarned = true;
        options.onWarning?.(
          `Agent "${definition.id}" does not advertise additionalDirectories capability — ignoring ${list.length} entr${list.length === 1 ? "y" : "ies"}.`,
        );
      }
      return undefined;
    }
    return list;
  };

  const newSession: IWireHost["newSession"] = async (input = {}) => {
    if (fatalError) {
      throw fatalError;
    }
    const cwd = input.cwd ?? options.cwd ?? process.cwd();
    const inputServers = input.mcpServers ?? options.mcpServers ?? [];
    validateMcpServers(inputServers);
    const mcpServers = inputServers.map(adaptMcpServer);
    const additionalDirectories = resolveAdditionalDirectories();
    const response = await acp.newSession({
      cwd,
      mcpServers,
      ...(additionalDirectories ? { additionalDirectories: [...additionalDirectories] } : {}),
      ...(input.meta ? { _meta: input.meta } : {}),
    });
    return finalizeSession(response.sessionId as SessionId, cwd, mcpServers, response);
  };

  const loadSession: IWireHost["loadSession"] = async (input) => {
    if (fatalError) {
      throw fatalError;
    }
    if (!capabilities.loadSession) {
      throw new CapabilityNotSupportedError(definition.id, "loadSession");
    }
    const cwd = input.cwd ?? options.cwd ?? process.cwd();
    const inputServers = input.mcpServers ?? options.mcpServers ?? [];
    validateMcpServers(inputServers);
    const mcpServers = inputServers.map(adaptMcpServer);
    const additionalDirectories = resolveAdditionalDirectories();
    const response = await acp.loadSession({
      sessionId: input.sessionId,
      cwd,
      mcpServers,
      ...(additionalDirectories ? { additionalDirectories: [...additionalDirectories] } : {}),
      ...(input.meta ? { _meta: input.meta } : {}),
    });
    return finalizeSession(input.sessionId as SessionId, cwd, mcpServers, response);
  };

  const scheduleInactivity = (record: ISessionRecord, active: IActiveStream): void => {
    if (inactivityTimeoutMs <= 0) {
      return;
    }
    const tick = (): void => {
      if (record.active !== active) {
        return;
      }
      const elapsed = clock() - active.state.lastActivityAt;
      if (elapsed >= inactivityTimeoutMs) {
        const error = new AgentInactivityError(definition.id, record.id, elapsed);
        failActive(active, error);
        record.active = undefined;
        return;
      }
      active.inactivityTimer.handle = setTimeout(tick, inactivityTimeoutMs - elapsed);
    };
    active.inactivityTimer.handle = setTimeout(tick, inactivityTimeoutMs);
  };

  const cancelStream = async (record: ISessionRecord): Promise<void> => {
    if (!record.active || record.active.cancelled) {
      return;
    }
    const active = record.active;
    active.cancelled = true;
    // Backstop: if inactivityTimeoutMs <= 0 (consumer opted out), arm a
    // dedicated cancel-deadline so a non-compliant agent that ignores
    // acp.cancel can't hang the consumer forever. With inactivityTimeoutMs
    // > 0, the inactivity timer is the backstop and we leave it running.
    let cancelDeadline: ReturnType<typeof setTimeout> | undefined;
    if (inactivityTimeoutMs <= 0) {
      cancelDeadline = setTimeout(() => {
        const err = new WireError("cancelled", `Session ${record.id} did not respond to cancel within ${CANCEL_DEADLINE_MS}ms`, {
          agent: definition.id,
        });
        active.queue.fail(err);
        active.forceFail?.(err);
      }, CANCEL_DEADLINE_MS);
      cancelDeadline.unref?.();
    }
    try {
      await acp.cancel({ sessionId: record.id });
    } catch (cause) {
      // Cancel-RPC failures are usually transient framing issues, but
      // discarding them silently makes diagnosis impossible. Surface via
      // the consumer's onWarning hook if one is set.
      options.onWarning?.(`cancel RPC failed for session ${record.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      // RPC failed — no point waiting for the deadline.
      if (cancelDeadline) {
        clearTimeout(cancelDeadline);
      }
    }
    // NOTE: when acp.cancel succeeds we deliberately leave cancelDeadline
    // armed (.unref()-ed). It only fires if the agent acknowledged cancel
    // but never finishes the stream within CANCEL_DEADLINE_MS — exactly
    // the hang scenario this backstop guards against. Idempotent fail/
    // forceFail means a late firing on an already-settled stream is a no-op.
  };

  const prompt: IWireHost["prompt"] = (sessionId, input) => {
    if (closed) {
      throw new WireError("connection-closed", `Host for ${definition.id} is closed`, { agent: definition.id });
    }
    if (fatalError) {
      throw fatalError;
    }
    const record = sessions.get(sessionId);
    if (!record) {
      throw new WireError("stream-error", `Unknown session ${sessionId}`, { agent: definition.id });
    }
    if (record.active) {
      throw new WireError("stream-error", `Session ${sessionId} already has an active prompt`, { agent: definition.id });
    }

    const queue = createAsyncQueue<TAgentEvent>();
    const state = createStreamState(clock());
    const active: IActiveStream = {
      queue,
      state,
      inactivityTimer: { handle: undefined },
      pendingPermissionCancels: new Set(),
      cancelled: false,
      forceFail: undefined,
    };
    record.active = active;
    scheduleInactivity(record, active);

    let promptBlocks: ContentBlock[];
    try {
      promptBlocks = buildPromptBlocks(
        input.prompt,
        input.systemPrompt,
        input.command,
        definition.id,
        record.availableCommands,
        definition.nativeSystemPrompt === true,
      );
    } catch (cause) {
      if (active.inactivityTimer.handle) {
        clearTimeout(active.inactivityTimer.handle);
      }
      queue.fail(cause);
      record.active = undefined;
      const failed = Promise.reject<IAskResult>(cause);
      failed.catch(() => {});
      return wrapStream(sessionId, queue, failed, async () => {});
    }

    if (input.signal?.aborted) {
      // Clear the inactivity timer scheduled above — without this, a
      // pre-aborted prompt pins one timer per call for the full
      // inactivityTimeoutMs window even though the stream is already done.
      if (active.inactivityTimer.handle) {
        clearTimeout(active.inactivityTimer.handle);
      }
      queue.push({ type: "finish", stopReason: "cancelled", usage: undefined, cost: undefined });
      queue.end();
      record.active = undefined;
      return wrapStream(
        sessionId,
        queue,
        Promise.resolve<IAskResult>({
          text: "",
          thinking: "",
          stopReason: "cancelled",
          usage: undefined,
          cost: undefined,
          sessionId,
          agent: definition.id,
          durationMs: 0,
        }),
        async () => {},
      );
    }

    let abortListener: (() => void) | undefined;
    const startedAt = clock();

    // Wire forceFail / forceResolve BEFORE the IIFE — the previous shape
    // ran the Promise<never> constructor inside the IIFE, which means a
    // close() landing in the same tick (e.g. controller pre-aborted)
    // could call failActive on an active whose forceFail was still
    // undefined, falling back to the acp.prompt rejection path and
    // mis-classifying the cancellation as stream-error.
    let forceResolve: (() => void) | undefined;
    const forcePromise = new Promise<never>((resolveForce, rejectForce) => {
      // resolveForce typed as <never> via cast — Promise.race ignores
      // the resolved value of a never-typed racer at runtime.
      forceResolve = () => (resolveForce as unknown as () => void)();
      active.forceFail = rejectForce;
    });

    const completion = (async (): Promise<IAskResult> => {
      try {
        const promptPromise = acp.prompt({
          sessionId,
          prompt: promptBlocks,
          ...(input.meta ? { _meta: input.meta } : {}),
        });
        const response = await Promise.race([promptPromise, forcePromise]);
        const stopReason: TStopReason = response.stopReason ?? "end_turn";
        queue.push({
          type: "finish",
          stopReason,
          usage: state.lastUsage,
          cost: undefined,
        });
        queue.end();
        return {
          text: state.textBuffer,
          thinking: state.thinkingBuffer,
          stopReason,
          usage: state.lastUsage,
          cost: undefined,
          sessionId,
          agent: definition.id,
          durationMs: clock() - startedAt,
        };
      } catch (cause) {
        if (active.cancelled) {
          const cancelResult: IAskResult = {
            text: state.textBuffer,
            thinking: state.thinkingBuffer,
            stopReason: "cancelled",
            usage: state.lastUsage,
            cost: undefined,
            sessionId,
            agent: definition.id,
            durationMs: clock() - startedAt,
          };
          queue.end();
          return cancelResult;
        }
        let wrapped: WireError;
        if (cause instanceof WireError) {
          wrapped = cause;
        } else {
          const code = classifyRpcError(cause);
          const message = extractRpcMessage(cause) ?? errorMessage(cause);
          wrapped = new WireError(code, message, { agent: definition.id, cause });
        }
        queue.fail(wrapped);
        throw wrapped;
      } finally {
        // Settle the dangling forcePromise so Promise.race releases its
        // internal handler chain; otherwise the rejectForce closure
        // (which captured `active`) stays reachable until the IIFE itself
        // is GC'd.
        forceResolve?.();
        if (active.inactivityTimer.handle) {
          clearTimeout(active.inactivityTimer.handle);
        }
        // Drain any permission requests still parked on the queue. After
        // the prompt resolves/rejects, the agent will not respond to a
        // permission anymore, so a dangling resolver would leak.
        drainPendingPermissions(active);
        record.active = undefined;
        if (input.signal && abortListener) {
          input.signal.removeEventListener("abort", abortListener);
        }
      }
    })();

    if (input.signal) {
      abortListener = () => {
        void cancelStream(record);
      };
      input.signal.addEventListener("abort", abortListener, { once: true });
    }

    return wrapStream(sessionId, queue, completion, () => cancelStream(record));
  };

  const cancel: IWireHost["cancel"] = async (sessionId) => {
    const record = sessions.get(sessionId);
    if (record) {
      await cancelStream(record);
    }
  };

  const close: IWireHost["close"] = async () => {
    if (closed) {
      return;
    }
    closed = true;
    const aborted = new WireError("connection-closed", `Host for ${definition.id} closed mid-stream`, { agent: definition.id });
    for (const record of sessions.values()) {
      if (record.active) {
        // Mark cancelled BEFORE failing so the completion coroutine's
        // catch branch returns a stopReason: "cancelled" result instead
        // of either swallowing the close as end_turn or wrapping it as
        // a generic stream error.
        record.active.cancelled = true;
        if (record.active.inactivityTimer.handle) {
          clearTimeout(record.active.inactivityTimer.handle);
        }
        // failActive drains pending permission resolvers too, so the
        // ACP RPC layer doesn't hold dangling Promise<RequestPermissionResponse>
        // references after teardown.
        failActive(record.active, aborted);
        record.active = undefined;
      }
    }
    sessions.clear();
    await connection?.dispose();
  };

  const listSessions: IWireHost["listSessions"] = async (input = {}) => {
    if (!capabilities.listSessions) {
      throw new CapabilityNotSupportedError(definition.id, "sessionCapabilities.list");
    }
    const response = await acp.listSessions({
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    return {
      sessions: response.sessions.map((s) => ({
        sessionId: s.sessionId,
        ...(s.title ? { title: s.title } : {}),
        ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
        cwd: s.cwd,
      })),
      ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
    };
  };

  async function* streamAllSessions(input: { cwd?: string } = {}): AsyncIterable<ISessionInfo> {
    let cursor: string | undefined;
    do {
      const page = await listSessions({ ...input, ...(cursor ? { cursor } : {}) });
      for (const session of page.sessions) {
        yield session;
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  const getModeState: IWireHost["getModeState"] = (sessionId) => {
    return sessions.get(sessionId)?.modeState;
  };

  const getConfigOptions: IWireHost["getConfigOptions"] = (sessionId) => {
    return sessions.get(sessionId)?.configOptions;
  };

  const setMode: IWireHost["setMode"] = async (sessionId, modeId) => {
    const record = sessions.get(sessionId);
    if (!record) {
      throw new WireError("stream-error", `Unknown session ${sessionId}`, { agent: definition.id });
    }
    const modeState = record.modeState;
    if (!modeState?.availableModes.some((m) => m.id === modeId)) {
      throw new CapabilityNotSupportedError(definition.id, `mode:${modeId}`);
    }
    try {
      await acp.setSessionMode({ sessionId, modeId });
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === -32601) {
        throw new CapabilityNotSupportedError(definition.id, "setSessionMode");
      }
      throw new WireError("stream-error", `setMode failed: ${errorMessage(cause)}`, { agent: definition.id, cause });
    }
    record.modeState = { ...modeState, currentModeId: modeId };
    if (record.active) {
      record.active.queue.push({ type: "mode-changed", modeId });
    }
  };

  return {
    definition,
    capabilities,
    authMethods,
    agentInfo: initializeResponse.agentInfo ?? undefined,
    newSession,
    loadSession,
    prompt,
    cancel,
    close,
    listSessions,
    streamAllSessions,
    getModeState,
    setMode,
    getConfigOptions,
    [Symbol.asyncDispose]: close,
  };
};

const wrapStream = (
  sessionId: SessionId,
  queue: IAsyncQueue<TAgentEvent>,
  completion: Promise<IAskResult>,
  cancel: () => Promise<void>,
): IHostStream => ({
  sessionId,
  completion,
  cancel,
  [Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
});
