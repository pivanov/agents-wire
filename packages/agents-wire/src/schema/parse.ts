import { JsonValidationError } from "@/errors";
import { type IStandardSchema, isStandardSchema, type TSchemaInput } from "./standard";

const FENCE_PATTERN = /^\s*```(?:json|JSON|jsonc|JSON5|json5)?\s*\n([\s\S]*?)\n\s*```\s*$/;

// Hard cap on agent JSON output before we try to parse — keeps a runaway
// agent from blocking the event loop on a multi-megabyte JSON.parse.
const MAX_JSON_BYTES = 5 * 1024 * 1024;

export const stripFences = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const match = trimmed.match(FENCE_PATTERN);
  if (match?.[1]) {
    return match[1].trim();
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }
  const startBrace = trimmed.indexOf("{");
  const startBracket = trimmed.indexOf("[");
  const candidates = [startBrace, startBracket].filter((index) => index >= 0);
  if (candidates.length === 0) {
    return trimmed;
  }
  const firstStart = Math.min(...candidates);
  return trimmed.slice(firstStart);
};

const flattenIssuePath = (path?: ReadonlyArray<string | number | { readonly key: string | number }>): readonly (string | number)[] | undefined => {
  if (!path) {
    return undefined;
  }
  return path.map((segment) => (typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment));
};

const validateAgainstStandardSchema = async <T>(value: unknown, schema: IStandardSchema<T>): Promise<T> => {
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
  if (cleaned.length > MAX_JSON_BYTES) {
    throw new JsonValidationError(`Response exceeds ${MAX_JSON_BYTES} byte cap (${cleaned.length} bytes); refusing to parse.`, text.slice(0, 1024), [
      { message: "response too large" },
    ]);
  }
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
