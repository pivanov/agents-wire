import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import type { TAgentId } from "./agent";
import type { IPendingPermission } from "./events";
import type { ICostSnapshot, IUsageReport } from "./results";

export type TPermissionPolicy =
  | "auto-allow"
  | "auto-allow-once"
  | "auto-reject"
  | "stream"
  | ((request: IPendingPermission) => Promise<{ id: string } | "cancel">);

/**
 * Handlers for file system operations requested by an agent.
 *
 * NOTE: These signatures are aligned with the ACP SDK schema types.
 * This is a BREAKING CHANGE from the previous simplified interface
 * (`readTextFile(path: string)` / `writeTextFile(path, content)`).
 * Callers must update to accept the full request object and return
 * the full response object.
 */
export interface IFileSystemHandlers {
  readTextFile?: (params: ReadTextFileRequest) => Promise<ReadTextFileResponse>;
  writeTextFile?: (params: WriteTextFileRequest) => Promise<WriteTextFileResponse>;
}

/**
 * Handlers for terminal (HITL) operations requested by an agent.
 *
 * NOTE: These signatures are aligned with the ACP SDK schema types.
 * This is a BREAKING CHANGE from the previous simplified interface.
 * Callers must accept/return ACP request/response objects.
 */
export interface ITerminalHandlers {
  createTerminal?: (params: CreateTerminalRequest) => Promise<CreateTerminalResponse>;
  terminalOutput?: (params: TerminalOutputRequest) => Promise<TerminalOutputResponse>;
  releaseTerminal?: (params: ReleaseTerminalRequest) => Promise<ReleaseTerminalResponse | undefined>;
  waitForTerminalExit?: (params: WaitForTerminalExitRequest) => Promise<WaitForTerminalExitResponse>;
  killTerminal?: (params: KillTerminalRequest) => Promise<KillTerminalResponse | undefined>;
}

export interface IMcpServer {
  readonly type: "stdio" | "http" | "sse";
  readonly name: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ISlashCommand {
  readonly name: string;
  readonly input?: string;
}

export type TToolName = string;

export type TToolDecision =
  | "allow"
  | "deny"
  | { readonly decision: "allow" | "deny"; readonly reason?: string }
  | { readonly decision: "rewrite-input"; readonly input: unknown };

export interface IToolUseEvent {
  readonly toolCallId: string;
  readonly tool: string;
  readonly input: unknown;
  readonly agent: TAgentId;
  readonly sessionId: string;
}

export interface IToolHandler {
  readonly allowed?: readonly TToolName[];
  readonly blocked?: readonly TToolName[];
  readonly onToolUse?: (event: IToolUseEvent) => Promise<TToolDecision> | TToolDecision;
  readonly onError?: (error: unknown, event: IToolUseEvent) => Promise<TToolDecision> | TToolDecision;
}

export type TWarn = (message: string, meta?: Record<string, unknown>) => void;

export type TRecycleReason = "turn-limit" | "fatal-error" | (string & {});

export interface IAgentOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly envFilter?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  /** Pass the host's full process.env to the agent. Default false (allowlist + `env`). */
  readonly passFullEnv?: boolean;
  readonly additionalDirectories?: readonly string[];

  readonly systemPrompt?: string;
  readonly model?: string;
  /**
   * Reasoning effort hint (commonly "low" | "medium" | "high"). Translated to:
   *  - a CLI flag for agents that take one (codex: `-c model_reasoning_effort="X"`)
   *  - ACP `setSessionConfigOption({ configId: "reasoning_effort", value })` after `newSession` for agents that read it
   * If a `modelPreference` with `configId: "reasoning_effort"` is also passed, that wins.
   */
  readonly effort?: string;
  /**
   * Lower-level escape hatch: send a single ACP config option after `newSession`.
   * Prefer `effort` for the common reasoning-effort case; use this for other configIds an agent advertises.
   */
  readonly modelPreference?: { readonly configId: string; readonly value: string | boolean };
  readonly command?: ISlashCommand;

  readonly mcpServers?: readonly IMcpServer[];
  readonly fileSystem?: IFileSystemHandlers;
  readonly terminal?: ITerminalHandlers;

  readonly permission?: TPermissionPolicy;
  readonly toolHandler?: IToolHandler;

  readonly maxCostUsd?: number;
  readonly costEstimator?: (usage: IUsageReport, agent: TAgentId, model?: string) => number;
  readonly onCostUpdate?: (cost: ICostSnapshot) => void;

  readonly signal?: AbortSignal;
  readonly inactivityTimeoutMs?: number;
  readonly initializeTimeoutMs?: number;
  /**
   * When `permission: "stream"` is in effect, how long to wait for the
   * consumer to call `respond()` / `cancel()` on a permission-request
   * event before failing the stream loudly. Prevents a silent deadlock
   * when the consumer iterates only the text stream and forgets to
   * handle permission events.
   *
   * - `undefined` (default): no deadline; the agent's tool call hangs
   *   indefinitely until the consumer responds. Preserves prior
   *   behavior.
   * - `> 0`: deadline in milliseconds. On expiry the active stream
   *   fails with a `WireError("stream-error", ...)` and the agent's
   *   pending request resolves as cancelled.
   */
  readonly permissionTimeoutMs?: number;

  readonly onAuthRequired?: (methods: readonly { id: string; name: string }[]) => Promise<string | undefined>;
  readonly onWarning?: TWarn;
  readonly onTrace?: (direction: "out" | "in" | "stderr", payload: unknown) => void;
  readonly onStderr?: (line: string) => void;

  readonly meta?: Record<string, unknown>;
  readonly traceContext?: () => Record<string, string>;
}

export interface IAskOptions extends IAgentOptions {}

export interface ISessionOptions extends IAgentOptions {
  readonly onRetry?: (attempt: number, error: unknown) => void;
  readonly onRecycle?: (reason: TRecycleReason) => void;
  /** Set to false to disable automatic respawn on transient failures. Defaults to true. */
  readonly autoRespawn?: boolean;
  /** Recycle (respawn) the host after this many turns to bound memory growth. Defaults to 100. Set to 0 to disable. */
  readonly maxTurnsBeforeRecycle?: number;
  /**
   * Resume an existing session by id instead of creating a new one. Requires
   * the agent to advertise the `loadSession` capability (Claude Code, Cursor,
   * OpenCode, Droid). Throws `CapabilityNotSupportedError` otherwise.
   *
   * On respawn / recycle, the SDK re-issues `loadSession` with the same id
   * so conversation context survives transient failures (the agent's
   * persistent storage is what backs the resume).
   */
  readonly loadSessionId?: string;
}
