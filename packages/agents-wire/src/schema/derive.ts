import type { IStandardSchema } from "./standard";

const stringify = (value: unknown): string => JSON.stringify(value);

const tryZodDerive = async (schema: unknown): Promise<string | undefined> => {
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

export const standardSchemaToJsonSchema = async <T>(schema: IStandardSchema<T>): Promise<string | undefined> => {
  const vendor = schema["~standard"].vendor.toLowerCase();
  if (vendor === "zod") {
    return tryZodDerive(schema);
  }
  if (vendor === "valibot") {
    return tryValibotDerive(schema);
  }
  if (vendor === "arktype") {
    return tryArkTypeDerive(schema);
  }
  return undefined;
};
