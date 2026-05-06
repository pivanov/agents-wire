# Structured JSON (`askJson`)

Get typed, validated JSON from any agent in a single call. Available on both the `agents` namespace and on sessions.

## `agents.askJson(agent, prompt, schema, options?)`

```ts
import { agents } from "@pivanov/agents-wire";
import { z } from "zod";

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

const { data, raw } = await agents.askJson(
  "claude",
  "Analyze sentiment: 'This library is great!'",
  schema,
  {
    permission: "auto-allow",
  },
);

console.log(data.sentiment);  // "positive"
console.log(data.confidence); // 0.95
console.log(raw.cost?.totalUsd);
```

## `session.askJson(prompt, schema, options?)`

Same API, but within a persistent session - conversation context is preserved.

```ts
const session = await agents.session(
  "gemini",
  {
    permission: "auto-allow",
  },
);

const { data } = await session.askJson(
  "List the exports of src/index.ts as JSON",
  z.object({ exports: z.array(z.string()) }),
);

console.log(data.exports);
await session.close();
```

## Schema Input

`askJson` accepts two kinds of schema:

### Standard Schema objects (recommended)

Any object implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol - Zod, Valibot, ArkType, and others. Provides full TypeScript inference and runtime validation.

```ts
import { z } from "zod";

// Zod
const { data } = await agents.askJson("claude", "...", z.object({ name: z.string() }));
//    ^? { name: string }
```

Auto-derivation to JSON Schema is supported for:

| Vendor | Requires |
|--------|----------|
| `zod` | Zod 4+ (`z.toJSONSchema` is a top-level export) |
| `valibot` | `@valibot/to-json-schema` package installed alongside `valibot` |
| `arktype` | No extra package; ArkType schemas carry `.toJsonSchema()` natively |

If your vendor isn't listed, or you're on older Zod, the schema still validates SDK-side. Pass a JSON Schema string explicitly to opt in:

```ts
const { data } = await agents.askJson(
  "claude",
  "...",
  myZodSchema,
  {
    jsonSchema: JSON.stringify(z.toJSONSchema(myZodSchema)),
  },
);
```

You can also call the helper directly:

```ts
import { standardSchemaToJsonSchema } from "@pivanov/agents-wire";

const derived = await standardSchemaToJsonSchema(myZodSchema);
// derived: '{"type":"object","properties":{...}}' or undefined
```

### Raw JSON Schema strings

Pass a JSON Schema string directly. No runtime validation is performed SDK-side - the model's compliance is trusted.

```ts
const schema = JSON.stringify({
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
});

const { data } = await agents.askJson<{ name: string }>("claude", "...", schema);
```

## Return Type

```ts
interface IJsonResult<T> {
  data: T;         // parsed and validated result
  raw: IAskResult; // full result with text, cost, events
}
```

## Error Handling

Throws `JsonValidationError` when parsing or validation fails:

```ts
import { JsonValidationError } from "@pivanov/agents-wire";

try {
  const { data } = await agents.askJson("claude", "...", schema);
} catch (error) {
  if (error instanceof JsonValidationError) {
    console.error("Raw response:", error.rawText);
    console.error("Issues:", error.issues);
    // issues: [{ message: "Expected string, received number", path: ["name"] }]
  }
}
```

**`JsonValidationError` properties:**
- `rawText: string` - the raw text that failed to parse or validate
- `issues: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>` - structured validation issues

## Per-vendor delivery

`askJson` always returns a parsed, validated value. *How* the JSON is coerced
out of the model differs by vendor:

| Vendor | Channel | Reliability |
|--------|---------|-------------|
| `claude` | Strict CLI channel via `@pivanov/claude-wire` (`--tools StructuredOutput` + `--json-schema`) | Output is token-constrained by the model. Validation rarely fails on real prompts. |
| All others | Prompt-injected JSON guidance + post-hoc parse + Standard Schema validate | Depends on the model. Fence stripping handles most markdown wrapping; non-conforming output throws `JsonValidationError`. |

The Claude path is also `systemPrompt`-aware: pooled strict sessions when a
`systemPrompt` is set (so it's prompt-cached across calls), stateless cold-spawn
otherwise. See [Claude agent docs](/agents/claude#structured-json-askjson).

## Fence Stripping

Agents sometimes wrap JSON in markdown fences (`` ```json ... ``` ``). `askJson` automatically strips these before parsing on the soft (non-Claude) path.

## Options

`askJson` accepts all the same options as `ask()` - `permission`, `cwd`, `maxCostUsd`, `signal`, etc. See [Client options](/api/client#iagent-options).

## Full Example

See [`apps/examples/code-review-bot/`](https://github.com/pivanov/agents-wire/tree/main/apps/examples/code-review-bot) for a complete code-review bot built on `askJson`.
