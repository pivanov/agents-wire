import type { TKnownErrorCode } from "@/errors";

interface IRpcLike {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly data?: {
    readonly message?: unknown;
    readonly codex_error_info?: unknown;
    readonly type?: unknown;
    readonly [key: string]: unknown;
  };
}

const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

export const extractRpcMessage = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }
  const candidate = cause as IRpcLike;
  return asString(candidate.data?.message) ?? asString(candidate.data?.codex_error_info) ?? asString(candidate.message);
};

const USAGE_PATTERNS = ["usage_limit", "quota", "usage limit", "rate limit", "billing", "monthly limit"];
const AUTH_PATTERNS = ["unauthorized", "auth required", "authentication", "invalid api key", "session expired", "token expired"];
const CONTEXT_PATTERNS = ["context length", "context window", "max tokens"];
const OVERLOAD_PATTERNS = ["overloaded", "service_unavailable", "internal_server_error"];

const matchesAny = (text: string, patterns: readonly string[]): boolean => patterns.some((pattern) => text.includes(pattern));

export const classifyRpcError = (cause: unknown): TKnownErrorCode => {
  if (typeof cause !== "object" || cause === null) {
    return "stream-error";
  }
  const candidate = cause as IRpcLike;
  const haystack =
    `${candidate.data?.codex_error_info ?? ""} ${candidate.data?.type ?? ""} ${candidate.data?.message ?? ""} ${candidate.message ?? ""}`.toLowerCase();
  if (matchesAny(haystack, USAGE_PATTERNS)) {
    return "usage-limit";
  }
  if (candidate.code === -32000 || matchesAny(haystack, AUTH_PATTERNS)) {
    return "auth-required";
  }
  if (matchesAny(haystack, CONTEXT_PATTERNS)) {
    return "context-length";
  }
  if (matchesAny(haystack, OVERLOAD_PATTERNS)) {
    return "overloaded";
  }
  return "stream-error";
};
