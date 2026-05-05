export interface IStandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<string | number | { readonly key: string | number }>;
}

export interface IStandardSchemaSuccess<T> {
  readonly value: T;
  readonly issues?: undefined;
}

export interface IStandardSchemaFailure {
  readonly issues: ReadonlyArray<IStandardSchemaIssue>;
}

export type TStandardSchemaResult<T> = IStandardSchemaSuccess<T> | IStandardSchemaFailure;

export interface IStandardSchema<T = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => TStandardSchemaResult<T> | Promise<TStandardSchemaResult<T>>;
    readonly types?: {
      readonly input: unknown;
      readonly output: T;
    };
  };
}

export type TInferOutput<S> = S extends IStandardSchema<infer U> ? U : never;

export type TSchemaInput<T> = IStandardSchema<T> | string;

export const isStandardSchema = (value: unknown): value is IStandardSchema => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { "~standard"?: unknown };
  if (!candidate["~standard"] || typeof candidate["~standard"] !== "object") {
    return false;
  }
  const props = candidate["~standard"] as { version?: unknown; validate?: unknown; vendor?: unknown };
  return props.version === 1 && typeof props.validate === "function" && typeof props.vendor === "string";
};
