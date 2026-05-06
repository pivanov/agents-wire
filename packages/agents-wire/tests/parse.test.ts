import { describe, expect, test } from "bun:test";
import { JsonValidationError } from "@/errors";
import { parseAndValidate, stripFences } from "@/schema/parse";
import type { IStandardSchema } from "@/schema/standard";

const stringSchema: IStandardSchema<string> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      if (typeof value === "string") {
        return { value };
      }
      return { issues: [{ message: "expected string" }] };
    },
  },
};

describe("stripFences", () => {
  test("removes ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("removes plain ``` fences", () => {
    expect(stripFences("```\n[1,2]\n```")).toBe("[1,2]");
  });

  test("trims leading prose before {", () => {
    expect(stripFences('Here you go: {"x":true}')).toBe('{"x":true}');
  });

  test("returns input unchanged if already JSON-shaped", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseAndValidate", () => {
  test("string JSON Schema is prompt-only and rejects with JsonValidationError", async () => {
    await expect(parseAndValidate<{ a: number }>('{"a":42}', "{}")).rejects.toBeInstanceOf(JsonValidationError);
  });

  test("validates against a Standard Schema", async () => {
    const result = await parseAndValidate('"hello"', stringSchema);
    expect(result).toBe("hello");
  });

  test("throws JsonValidationError on schema mismatch", async () => {
    await expect(parseAndValidate("{}", stringSchema)).rejects.toBeInstanceOf(JsonValidationError);
  });

  test("throws JsonValidationError on malformed JSON", async () => {
    await expect(parseAndValidate("{not json", stringSchema)).rejects.toBeInstanceOf(JsonValidationError);
  });

  test("throws JsonValidationError on empty input", async () => {
    await expect(parseAndValidate("   ", stringSchema)).rejects.toBeInstanceOf(JsonValidationError);
  });
});
