import { JsonValidationError } from "@/errors";
import { type IStandardSchema, isStandardSchema, type TSchemaInput } from "./standard";

// `\r?\n` so CRLF-line-ending agents (Windows / older Codex builds) still
// match — was `\n` literal which fell through to the prefix-scan path.
const FENCE_PATTERN = /^\s*```(?:json|JSON|jsonc|JSON5|json5)?\s*\r?\n([\s\S]*?)\r?\n\s*```\s*$/;

// Hard cap on agent JSON output before we try to parse — keeps a runaway
// agent from blocking the event loop on a multi-megabyte JSON.parse.
const MAX_JSON_BYTES = 5 * 1024 * 1024;

export const stripFences = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  // Bound regex work — apply size cap BEFORE FENCE_PATTERN so a crafted
  // unclosed-fence input can't trigger pathological backtracking. Throw
  // a clear cap error rather than fall through to a misleading JSON.parse failure.
  if (trimmed.length > MAX_JSON_BYTES) {
    throw new JsonValidationError(
      `Response exceeds ${MAX_JSON_BYTES} byte cap (${trimmed.length} bytes); refusing to parse.`,
      trimmed.slice(0, 1024),
      [{ message: "response too large" }],
    );
  }
  // Cheap prefix probe so we only run the lazy regex on plausibly-fenced input.
  const looksFenced = trimmed.startsWith("```");
  if (looksFenced) {
    const match = trimmed.match(FENCE_PATTERN);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  // Slice to the matching close-brace/bracket so trailing prose ("here's
  // the JSON: {…} let me know if…") doesn't end up in JSON.parse and
  // surface as a misleading "Failed to parse JSON" error.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const sliced = sliceToMatchingClose(trimmed, 0);
    return sliced ?? trimmed;
  }
  const startBrace = trimmed.indexOf("{");
  const startBracket = trimmed.indexOf("[");
  const candidates = [startBrace, startBracket].filter((index) => index >= 0);
  if (candidates.length === 0) {
    return trimmed;
  }
  const firstStart = Math.min(...candidates);
  const sliced = sliceToMatchingClose(trimmed, firstStart);
  return sliced ?? trimmed.slice(firstStart);
};

// Walk the string from `start`, tracking `{...}` / `[...]` depth and
// string-context, and return the substring that ends at the matching
// close. Returns undefined on unbalanced input — callers fall back to
// the previous slice so JSON.parse can still surface its own error.
const sliceToMatchingClose = (input: string, start: number): string | undefined => {
  const open = input[start];
  if (open !== "{" && open !== "[") {
    return undefined;
  }
  const closeOf: Record<string, string> = { "{": "}", "[": "]" };
  const stack: string[] = [open];
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const top = stack.pop();
      if (!top || closeOf[top] !== ch) {
        return undefined;
      }
      if (stack.length === 0) {
        return input.slice(start, i + 1);
      }
    }
  }
  return undefined;
};

const flattenIssuePath = (path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>): readonly (string | number)[] | undefined => {
  if (!path) {
    return undefined;
  }
  return (
    path
      .map((segment) => (typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment))
      // Drop symbol keys — JsonValidationError reports paths as string|number, never symbol.
      .filter((k): k is string | number => typeof k === "string" || typeof k === "number")
  );
};

const validateAgainstStandardSchema = async <T>(value: unknown, schema: IStandardSchema<unknown, T>): Promise<T> => {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    throw new JsonValidationError(
      `Standard Schema validation failed (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"})`,
      JSON.stringify(value),
      result.issues.map((issue) => {
        const path = flattenIssuePath(issue.path);
        return path ? { message: issue.message, path } : { message: issue.message };
      }),
    );
  }
  return result.value;
};

export const parseAndValidate = async <T>(text: string, schema: TSchemaInput<T>): Promise<T> => {
  const cleaned = stripFences(text);
  if (cleaned.length === 0) {
    throw new JsonValidationError("Empty response from agent", text, [{ message: "no JSON content" }]);
  }
  // (size cap is now enforced inside stripFences for both the raw and the cleaned input)
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (cause) {
    throw new JsonValidationError(`Failed to parse JSON: ${(cause as Error).message}`, text, [{ message: (cause as Error).message }], { cause });
  }
  if (typeof schema === "string") {
    // String schemas (raw JSON Schema) steer the prompt but cannot be
    // validated without bringing in a JSON Schema engine. Refuse loudly
    // rather than return unvalidated `as T`.
    throw new JsonValidationError(
      "String JSON Schema is prompt-only and cannot validate output. Pass a Standard Schema instance (Zod / Valibot / ArkType) instead.",
      text,
      [{ message: "string schema is not a validator" }],
    );
  }
  if (!isStandardSchema(schema)) {
    throw new JsonValidationError("Schema is not a Standard Schema or JSON Schema string", text, [{ message: "invalid schema input" }]);
  }
  return validateAgainstStandardSchema(parsed, schema as IStandardSchema<T>);
};
