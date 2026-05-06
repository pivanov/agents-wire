import type { IStandardSchema } from "./standard";

const stringify = (value: unknown): string => JSON.stringify(value);

const tryZodDerive = async (schema: unknown, onWarning?: (msg: string) => void): Promise<string | undefined> => {
  try {
    const mod = await import("zod");
    const candidate = mod as { toJSONSchema?: (schema: unknown) => unknown };
    if (typeof candidate.toJSONSchema === "function") {
      return stringify(candidate.toJSONSchema(schema));
    }
    const zNamespace = (mod as { z?: { toJSONSchema?: (schema: unknown) => unknown } }).z;
    if (zNamespace && typeof zNamespace.toJSONSchema === "function") {
      return stringify(zNamespace.toJSONSchema(schema));
    }
    // Zod v3 has no toJSONSchema export — agent gets only the "JSON only"
    // guidance, which loses the schema body and degrades parse-rate.
    onWarning?.("Zod schema detected but `toJSONSchema` is unavailable (Zod v3?). Upgrade to Zod v4 to embed the schema in the JSON system prompt.");
    return undefined;
  } catch {
    return undefined;
  }
};

const VALIBOT_J2S_MODULE = ["@valibot", "to-json-schema"].join("/");

const tryValibotDerive = async (schema: unknown): Promise<string | undefined> => {
  try {
    const mod = (await import(VALIBOT_J2S_MODULE)) as { toJsonSchema?: (schema: unknown) => unknown };
    const fn = mod.toJsonSchema;
    if (typeof fn !== "function") {
      return undefined;
    }
    return stringify(fn(schema));
  } catch {
    return undefined;
  }
};

const tryArkTypeDerive = (schema: unknown): string | undefined => {
  const candidate = schema as { toJsonSchema?: () => unknown };
  if (typeof candidate.toJsonSchema !== "function") {
    return undefined;
  }
  try {
    return stringify(candidate.toJsonSchema());
  } catch {
    return undefined;
  }
};

export const standardSchemaToJsonSchema = async <T>(schema: IStandardSchema<T>, onWarning?: (msg: string) => void): Promise<string | undefined> => {
  const vendor = schema["~standard"].vendor.toLowerCase();
  if (vendor === "zod") {
    return tryZodDerive(schema, onWarning);
  }
  if (vendor === "valibot") {
    return tryValibotDerive(schema);
  }
  if (vendor === "arktype") {
    return tryArkTypeDerive(schema);
  }
  // Unknown vendor — caller falls back to "JSON only" guidance with no
  // schema body; warn so operators notice schema guidance was dropped.
  onWarning?.(
    `Unknown Standard Schema vendor "${vendor}"; JSON schema body could not be derived. Provide a JSON Schema string or use Zod / Valibot / ArkType.`,
  );
  return undefined;
};
