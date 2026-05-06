import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { IUsageReport } from "./results";

export type TBuiltInAgentId =
  | "claude"
  | "codex"
  | "cursor"
  | "copilot"
  | "gemini"
  | "opencode"
  | "droid"
  | "pi"
  | "cline"
  | "kilo"
  | "qwen"
  | "auggie";

export type TAgentId = TBuiltInAgentId | (string & {});

export const BUILT_IN_AGENT_IDS: readonly TBuiltInAgentId[] = [
  "claude",
  "codex",
  "cursor",
  "copilot",
  "gemini",
  "opencode",
  "droid",
  "pi",
  "cline",
  "kilo",
  "qwen",
  "auggie",
];

export interface IWireLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface IWireLaunchOptions {
  readonly binaryOverride?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Model identifier to pass to the agent CLI (agent-specific flag). */
  readonly model?: string;
  /** Reasoning effort level (e.g. "low" | "medium" | "high") for models that support it. */
  readonly effort?: string;
}

export interface IProbeOutcome {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Discriminated description of how a model exposes a "reasoning effort"
 * knob:
 *
 *   - `none`    — model accepts no effort selector at all.
 *   - `enum`    — finite set of named tiers (e.g. low/medium/high/xhigh/max).
 *                 The strings here are forwarded as
 *                 `IAgentOptions.modelPreference` with the agent's
 *                 declared `configId` (typically `reasoning_effort` or
 *                 `thought_level`).
 *   - `budget`  — numeric thinking-token budget with min/max bounds
 *                 (Claude's `thinking_budget` is the canonical example).
 *   - `variant` — effort is baked into the model id itself (e.g. cursor's
 *                 `gpt-5.3-codex-high` vs `gpt-5.3-codex-extra-high`).
 *                 No separate effort UI; the user picks a model variant.
 */
export type IModelEffort =
  | { readonly kind: "none" }
  | { readonly kind: "enum"; readonly values: readonly string[]; readonly default?: string }
  | { readonly kind: "budget"; readonly min: number; readonly max: number; readonly default?: number }
  | { readonly kind: "variant" };

/**
 * Descriptor for a model the agent can be asked to use. Hosts forward
 * `id` to ACP; the agent decides what to do with it. Pickers (like the
 * playground's) read this declaratively so they stay generic across
 * agents.
 *
 * Static `def.models` is a cold-start placeholder; the real list comes
 * from `session.configOptions` post-init (see `resolveModels`). Don't
 * invent IDs here — list "Default" only and let the probe populate.
 */
export interface IAgentModelOption {
  /** Identifier passed verbatim to the agent via `IAgentOptions.model`. */
  readonly id: string;
  /** Human-friendly display name (e.g. "Sonnet 4.6"). */
  readonly label: string;
  /** One-line description for the picker. */
  readonly description?: string;
  /** Reasoning-effort axis declaration; omit for `{ kind: "none" }`. */
  readonly effort?: IModelEffort;
}

export interface IAgentDefinition {
  readonly id: TAgentId;
  readonly label: string;
  readonly transport: "native-acp" | "node-bridge";
  readonly launch: (options?: IWireLaunchOptions) => IWireLaunchSpec;
  readonly probe?: () => Promise<IProbeOutcome>;
  readonly installNotice: string;
  readonly homepage?: string;
  readonly authFailurePatterns?: readonly string[];
  readonly usageLimitPatterns?: readonly string[];
  /**
   * Set to `false` for CLIs that don't actually implement the Agent
   * Client Protocol (e.g. Pi v0.73, whose `--mode rpc` uses a
   * different JSON dialect). resolveModels will skip the session
   * probe for these and go straight to listAvailableModels / static
   * catalog, avoiding the "Invalid message" log spam and the
   * connection-hang that ACP spawn-and-initialize produces against
   * an incompatible CLI. Defaults to `true` (assume ACP).
   */
  readonly acpCompatible?: boolean;
  /**
   * Set to `true` for agents that consume the `systemPrompt` field of an ACP
   * `prompt` request natively (Claude does this via its `system` field). For
   * everyone else the host has to prepend the system prompt to the user
   * message because ACP `prompt` doesn't carry a separate system slot.
   */
  readonly nativeSystemPrompt?: boolean;
  /**
   * Selectable models. Empty / omitted means the agent picks its own
   * default and exposes no choice. UI surfaces (pickers) read this
   * declaratively so they stay generic across agents.
   */
  readonly models?: readonly IAgentModelOption[];
  /**
   * Optional: spawn the agent's `--list-models` (or equivalent) command
   * to fetch a live model list. Returns an empty array if the CLI is
   * unavailable or the call fails. UI pickers should call this lazily
   * and fall back to the static `models` field.
   */
  readonly listAvailableModels?: () => Promise<readonly IAgentModelOption[]>;
  /**
   * Cheap synchronous pre-check. If supplied and returns `false`, `detect`
   * skips the (subprocess-spawning) `probe` and returns unavailable.
   * Typical use: `existsSync(<config dir>)` to filter false-positives like
   * a generic "agent" binary on PATH belonging to an unrelated tool.
   */
  readonly quickCheck?: () => boolean;
  /**
   * Config dirs from prior product names. Surfaces in detection output so
   * a user with a legacy install of the same agent under an old name still
   * shows as available.
   */
  readonly legacyDirs?: readonly string[];
  /**
   * Alternative ids users might pass (e.g. "claude-code" → "claude",
   * "gpt-5" → "codex"). Resolved by `resolveAgentAlias` and consulted by
   * the AI SDK provider so common misspellings don't throw.
   */
  readonly aliases?: readonly string[];
  /**
   * Vendor-specific usage extraction. The argument is the ACP
   * `usage_update` payload; return value is shallow-merged on top of
   * the stock fields (`contextSize`, `contextUsed`, USD-checked
   * `costUsd`). Use this only for fields the stock translator doesn't
   * read (e.g. tokens piggybacking on `_meta`) — don't re-extract
   * `cost.amount`, the stock path already does it correctly with
   * currency validation.
   */
  readonly translateUsage?: (raw: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>) => Partial<IUsageReport>;
}

export interface IAgentAdapter {
  readonly id: TAgentId;
  readonly label: string;
  readonly launch: (options?: IWireLaunchOptions) => IWireLaunchSpec;
  readonly probe?: () => Promise<IProbeOutcome>;
  readonly installNotice?: string;
  readonly homepage?: string;
  readonly models?: readonly IAgentModelOption[];
  readonly listAvailableModels?: () => Promise<readonly IAgentModelOption[]>;
}

export interface IAgentCapabilities {
  readonly loadSession: boolean;
  readonly forkSession: boolean;
  readonly resumeSession: boolean;
  readonly closeSession: boolean;
  readonly listSessions: boolean;
  readonly additionalDirectories: boolean;
  readonly mcp: {
    readonly stdio: boolean;
    readonly http: boolean;
    readonly sse: boolean;
  };
  readonly prompt: {
    readonly text: boolean;
    readonly image: boolean;
    readonly audio: boolean;
    readonly embeddedContext: boolean;
  };
}
