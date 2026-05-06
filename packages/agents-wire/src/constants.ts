export const PACKAGE_NAME = "@pivanov/agents-wire";
export const PACKAGE_TITLE = "agents-wire";
// Replaced at build time by tsup `define` from package.json#version. The
// `typeof` guard keeps this safe in tests / dev that import src directly.
declare const __PKG_VERSION__: string | undefined;
export const PACKAGE_VERSION: string = typeof __PKG_VERSION__ !== "undefined" ? __PKG_VERSION__ : "0.0.0-dev";

export const ACP_PROTOCOL_VERSION = 1;

export const DEFAULT_INACTIVITY_TIMEOUT_MS = 180_000;
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000;
export const DEFAULT_DISPOSE_GRACE_MS = 250;
export const DEFAULT_STDERR_TAIL_LIMIT = 64;
// Backstop deadline for cancelStream when inactivityTimeoutMs <= 0.
// A non-compliant agent that acks cancel but never finishes the stream
// triggers a forceFail after this window so the consumer can't hang.
export const CANCEL_DEADLINE_MS = 30_000;

export const AUTH_FAILURE_PATTERNS = [
  "authentication required",
  "invalid api key",
  "invalid_api_key",
  "unauthorized",
  "401",
  "please run `claude login`",
  "please run `claude /login`",
  "credentials are invalid",
  "session expired",
] as const;

export const USAGE_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit exceeded",
  "quota exceeded",
  "monthly limit",
  "billing",
  "upgrade your plan",
  "429",
] as const;

export const AI_SDK_PROVIDER_OPTIONS_KEY = "agentsWire";

export const RESPAWN_BACKOFF_MS = [500, 1_000, 2_000] as const;
export const MAX_RESPAWN_ATTEMPTS = 3;

export const DEFAULT_MAX_TURNS_BEFORE_RECYCLE = 100;

export const TRANSIENT_ERROR_PATTERNS = [
  "econnreset",
  "etimedout",
  "epipe",
  "socket hang up",
  "fetch failed",
  "ai_apicallerror",
  "overloaded_error",
  "internal_server_error",
  "service_unavailable",
] as const;
