// Aligned with the Standard Schema v1 spec (https://standardschema.dev/).
// PropertyKey covers string | number | symbol so Zod / Valibot / ArkType
// schemas type-check as drop-in IStandardSchema instances.

export interface IStandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export interface IStandardSchemaSuccess<T> {
  readonly value: T;
  readonly issues?: undefined;
}

export interface IStandardSchemaFailure {
  readonly issues: ReadonlyArray<IStandardSchemaIssue>;
}

export type TStandardSchemaResult<T> = IStandardSchemaSuccess<T> | IStandardSchemaFailure;

export interface IStandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => TStandardSchemaResult<Output> | Promise<TStandardSchemaResult<Output>>;
    readonly types?:
      | {
          readonly input: Input;
          readonly output: Output;
        }
      | undefined;
  };
}

export type TInferOutput<S> = S extends IStandardSchema<infer _, infer U> ? U : never;

export type TSchemaInput<T> = IStandardSchema<unknown, T> | string;

export const isStandardSchema = (value: unknown): value is IStandardSchema => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { "~standard"?: unknown };
  if (!candidate["~standard"] || typeof candidate["~standard"] !== "object") {
    return false;
  }
  const props = candidate["~standard"] as { version?: unknown; validate?: unknown; vendor?: unknown };
  return props.version === 1 && typeof props.validate === "function" && typeof props.vendor === "string" && props.vendor.length > 0;
};
