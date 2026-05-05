export const DEFAULT_JSON_SYSTEM_PROMPT = [
  "You are a JSON-only response endpoint.",
  "Return a single valid JSON document that matches the provided schema and nothing else.",
  "Do not wrap the JSON in markdown code fences. Do not prepend or append explanatory prose.",
  "If a value cannot be determined, return null in that position rather than omitting the field.",
].join(" ");

export const buildJsonGuidance = (schemaSummary?: string): string => {
  if (!schemaSummary) {
    return DEFAULT_JSON_SYSTEM_PROMPT;
  }
  return `${DEFAULT_JSON_SYSTEM_PROMPT}\n\nSchema:\n${schemaSummary}`;
};
