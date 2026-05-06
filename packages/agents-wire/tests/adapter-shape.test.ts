import { describe, expect, test } from "bun:test";
import type { IAgentAdapter, IAgentDefinition } from "@/types/agent";

/**
 * IAgentAdapter is a public-facing subset of IAgentDefinition. When a new
 * field is added to IAgentDefinition, the maintainer has to decide whether
 * adapter consumers should also expose it. This compile-time check forces
 * that decision: add the new key either to ADAPTER_FIELDS (so adapters can
 * supply it and `adapterToDefinition` should forward it) or to
 * DEFINITION_ONLY_FIELDS (and document why).
 */
type AdapterFields = "id" | "label" | "launch" | "probe" | "installNotice" | "homepage" | "models" | "listAvailableModels";
type DefinitionOnlyFields =
  | "transport"
  | "authFailurePatterns"
  | "usageLimitPatterns"
  | "acpCompatible"
  | "nativeSystemPrompt"
  | "quickCheck"
  | "legacyDirs"
  | "aliases"
  | "translateUsage";

type ExtraInDefinition = Exclude<keyof IAgentDefinition, AdapterFields>;
type ExtraInAdapter = Exclude<keyof IAgentAdapter, AdapterFields>;

type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

const _definitionExhaustive: Equals<ExtraInDefinition, DefinitionOnlyFields> = true;
const _adapterExhaustive: Equals<ExtraInAdapter, never> = true;
void _definitionExhaustive;
void _adapterExhaustive;

describe("adapter shape", () => {
  test("adapter and definition field sets are catalogued exhaustively", () => {
    // The compile-time `Equals<...>` assertions above are the real test;
    // this runtime case keeps the file alive in the test runner and
    // documents intent for anyone reading the suite.
    expect(true).toBe(true);
  });
});
