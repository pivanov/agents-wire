import { TRANSIENT_ERROR_PATTERNS } from "./constants";
import { stripTerminalEscapes } from "./internal/strip-terminal-escapes";
import type { TAgentId } from "./types/agent";

export const KNOWN_ERROR_CODES = [
  "rate-limit",
  "overloaded",
  "context-length",
  "auth-required",
  "usage-limit",
  "capability-not-supported",
  "budget-exceeded",
  "retry-exhausted",
  "agent-not-installed",
  "spawn-failed",
  "init-timeout",
  "init-failed",
  "inactivity-timeout",
  "session-create-failed",
  "session-load-failed",
  "stream-error",
  "cancelled",
  "protocol-mismatch",
  "invalid-prompt-content",
  "json-validation",
  "connection-closed",
  "stdin-closed",
  "abort",
] as const;

export type TKnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

export interface IWireErrorOptions {
  agent?: TAgentId;
  cause?: unknown;
}

export class WireError extends Error {
  readonly code: TKnownErrorCode;
  readonly agent: TAgentId | undefined;

  constructor(code: TKnownErrorCode, message: string, options: IWireErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WireError";
    this.code = code;
    this.agent = options.agent;
  }

  // Without toJSON, JSON.stringify(err) returns "{}" — Error's enumerable
  // fields are zero. Logging pipelines that JSON-serialize errors lose the
  // code / agent fields. Custom toJSON keeps them.
  toJSON(): { name: string; message: string; code: TKnownErrorCode; agent: TAgentId | undefined; stack?: string } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      agent: this.agent,
      ...(this.stack ? { stack: this.stack } : {}),
    };
  }
}

export class BudgetExceededError extends WireError {
  readonly spentUsd: number;
  readonly budgetUsd: number;

  constructor(spentUsd: number, budgetUsd: number, options: IWireErrorOptions = {}) {
    super("budget-exceeded", `Budget exceeded: spent $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(4)} budget`, options);
    this.name = "BudgetExceededError";
    this.spentUsd = spentUsd;
    this.budgetUsd = budgetUsd;
  }
}

export interface IJsonValidationIssue {
  message: string;
  path?: readonly (string | number)[];
}

export class JsonValidationError extends WireError {
  readonly text: string;
  readonly issues: readonly IJsonValidationIssue[];

  constructor(message: string, text: string, issues: readonly IJsonValidationIssue[], options: IWireErrorOptions = {}) {
    super("json-validation", message, options);
    this.name = "JsonValidationError";
    this.text = text;
    this.issues = issues;
  }
}

export class AbortError extends WireError {
  constructor(message = "Operation aborted", options: IWireErrorOptions = {}) {
    super("abort", message, options);
    this.name = "AbortError";
  }
}

export class CapabilityNotSupportedError extends WireError {
  readonly capability: string;

  constructor(agent: TAgentId, capability: string, options: IWireErrorOptions = {}) {
    super("capability-not-supported", `Agent "${agent}" does not support capability: ${capability}`, { ...options, agent });
    this.name = "CapabilityNotSupportedError";
    this.capability = capability;
  }
}

export class AgentNotInstalledError extends WireError {
  readonly installHint: string;

  constructor(agent: TAgentId, installHint: string, options: IWireErrorOptions = {}) {
    super("agent-not-installed", `Agent "${agent}" is not installed. ${installHint}`, {
      ...options,
      agent,
    });
    this.name = "AgentNotInstalledError";
    this.installHint = installHint;
  }
}

export class AgentInactivityError extends WireError {
  readonly elapsedMs: number;

  constructor(agent: TAgentId, sessionId: string, elapsedMs: number, options: IWireErrorOptions = {}) {
    super("inactivity-timeout", `Agent "${agent}" session "${sessionId}" inactive for ${elapsedMs}ms`, { ...options, agent });
    this.name = "AgentInactivityError";
    this.elapsedMs = elapsedMs;
  }
}

export class AgentUnauthenticatedError extends WireError {
  readonly loginCommand: string | undefined;

  constructor(agent: TAgentId, message: string, loginCommand?: string, options: IWireErrorOptions = {}) {
    super("auth-required", redactSecrets(message), { ...options, agent });
    this.name = "AgentUnauthenticatedError";
    this.loginCommand = loginCommand;
  }
}

export class AgentUsageLimitError extends WireError {
  constructor(agent: TAgentId, message: string, options: IWireErrorOptions = {}) {
    super("usage-limit", message, { ...options, agent });
    this.name = "AgentUsageLimitError";
  }
}

export class ProtocolVersionMismatchError extends WireError {
  readonly clientVersion: number;
  readonly agentVersion: number;

  constructor(agent: TAgentId, clientVersion: number, agentVersion: number, options: IWireErrorOptions = {}) {
    super("protocol-mismatch", `Agent "${agent}" requires protocol version ${agentVersion} but client supports up to ${clientVersion}`, {
      ...options,
      agent,
    });
    this.name = "ProtocolVersionMismatchError";
    this.clientVersion = clientVersion;
    this.agentVersion = agentVersion;
  }
}

export class AgentInitTimeoutError extends WireError {
  readonly timeoutMs: number;

  constructor(agent: TAgentId, timeoutMs: number, options: IWireErrorOptions = {}) {
    super("init-timeout", `Agent "${agent}" failed to initialize within ${timeoutMs}ms`, {
      ...options,
      agent,
    });
    this.name = "AgentInitTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// Patterns for secret-bearing tokens that some agents print on auth errors.
// Anything matching is replaced with `[REDACTED]` before the line lands on a WireError.
//
// The hex pattern is bounded {40,80} (not {40,}) and requires a token-bearing
// prefix word boundary so we don't redact bare git SHAs / ETags / SRI hashes
// that operators rely on when triaging stderr tails.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:Bearer|Token)\s+[A-Za-z0-9._-]+/gi,
  /\bsk-[A-Za-z0-9._-]{16,}/g,
  /\bxox[bopa]-[A-Za-z0-9-]{10,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgho_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:secret|token|key|password|api[_-]?key)["':=\s]+[A-Fa-f0-9]{40,80}\b/gi,
];

// Key=value redaction. Catches `password=abc123`, `api_key: shorthex`,
// `auth_token = "..."` shapes regardless of value length / charset.
// Captures the key + the original separator so the redacted output
// preserves the input shape (`password: <REDACTED>` vs `password=...`).
const KEY_VALUE_SECRET = /\b(password|secret|api[_-]?key|auth[_-]?token|access[_-]?token)(\s*[=:]\s*)["']?([A-Za-z0-9._-]+)["']?/gi;

// Auth-context heuristic: when the line names a sensitivity word
// ("auth", "unauthorized", "forbidden", "invalid token", …) we widen
// redaction to bare 40+-char hex tokens too. Many CLIs print
// `error: invalid token: 9c8a…` without a key=value shape, which the
// strict patterns above miss; the context word makes the redaction safe.
const AUTH_CONTEXT = /\b(?:auth|unauthorized|forbidden|invalid[-_ ]?(?:token|key|credential|api[_-]?key)|access[-_ ]?denied|expired)\b/i;
const BARE_HEX_TOKEN = /\b[A-Fa-f0-9]{40,80}\b/g;

export const redactSecrets = (line: string): string => {
  // Strip terminal-control escapes BEFORE secret redaction so a token
  // hidden inside an OSC sequence still gets caught by the patterns.
  // Order matters: escape removal first, then secret matching.
  let out = stripTerminalEscapes(line);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  // Key=value form runs after the strict patterns so a prefixed token
  // (e.g. `password="Bearer xxx"`) doesn't double-replace.
  out = out.replace(KEY_VALUE_SECRET, (_, key: string, sep: string) => `${key}${sep}[REDACTED]`);
  if (AUTH_CONTEXT.test(out)) {
    out = out.replace(BARE_HEX_TOKEN, "[REDACTED]");
  }
  return out;
};

const redactTail = (tail: readonly string[]): readonly string[] => tail.map(redactSecrets);

export class AgentConnectionClosedError extends WireError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderrTail: readonly string[];

  constructor(
    agent: TAgentId,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderrTail: readonly string[] = [],
    options: IWireErrorOptions = {},
  ) {
    const detail = exitCode !== null ? `exit code ${exitCode}` : signal !== null ? `signal ${signal}` : "unknown reason";
    super("connection-closed", `Agent "${agent}" connection closed: ${detail}`, {
      ...options,
      agent,
    });
    this.name = "AgentConnectionClosedError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = redactTail(stderrTail);
  }
}

export const isKnownError = (error: unknown): error is WireError => {
  return error instanceof WireError;
};

export const isTransientError = (error: unknown): boolean => {
  if (error instanceof WireError) {
    return (
      error.code === "overloaded" ||
      error.code === "rate-limit" ||
      error.code === "connection-closed" ||
      // EPIPE on a long stream is recoverable via respawn; previously fell
      // through to false and burned an attempt instead of retrying.
      error.code === "stdin-closed"
    );
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const haystack = `${error.message} ${error.name}`.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
