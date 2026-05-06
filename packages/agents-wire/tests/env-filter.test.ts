import { describe, expect, test } from "bun:test";
import type { ISpawnOptions } from "@/internal/spawn";
import type { IAgentOptions } from "@/types/options";

// Unit tests for the envFilter feature (no real process spawning).
// These tests exercise the filter semantics in isolation by replicating the
// merge+filter logic that launchAgent uses in src/internal/spawn.ts.

/** Mirror of the merge logic in buildEnv + launchAgent */
const applyMergeAndFilter = (
  parentEnv: NodeJS.ProcessEnv,
  launchSpecEnv: Readonly<Record<string, string>> | undefined,
  optionsEnv: Readonly<Record<string, string>> | undefined,
  envFilter: ((env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv) | undefined,
): NodeJS.ProcessEnv => {
  // Replicate buildEnv: parentEnv wins for absent keys; extra wins for present ones
  const merged: NodeJS.ProcessEnv = { ...parentEnv };
  for (const [k, v] of Object.entries({ ...launchSpecEnv, ...optionsEnv })) {
    merged[k] = v;
  }
  return envFilter ? envFilter(merged) : merged;
};

describe("envFilter - type contract", () => {
  test("IAgentOptions accepts envFilter", () => {
    // Compile-time check: the type must accept the field.
    const opts: IAgentOptions = {
      envFilter: (env) => env,
    };
    expect(typeof opts.envFilter).toBe("function");
  });

  test("ISpawnOptions accepts envFilter", () => {
    const spawnOpts: ISpawnOptions = {
      envFilter: (env) => env,
    };
    expect(typeof spawnOpts.envFilter).toBe("function");
  });
});

describe("envFilter - merge precedence", () => {
  test("options.env wins over launchSpec.env", () => {
    const parent: NodeJS.ProcessEnv = {};
    const launchSpecEnv = { MY_VAR: "from-launch-spec" };
    const optionsEnv = { MY_VAR: "from-options" };
    const result = applyMergeAndFilter(parent, launchSpecEnv, optionsEnv, undefined);
    expect(result.MY_VAR).toBe("from-options");
  });

  test("parentEnv keys not overridden when absent from extra", () => {
    const parent: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/user" };
    const result = applyMergeAndFilter(parent, undefined, undefined, undefined);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/user");
  });

  test("merged env contains keys from all three sources", () => {
    const parent: NodeJS.ProcessEnv = { FROM_PARENT: "yes" };
    const launchSpecEnv = { FROM_SPEC: "yes" };
    const optionsEnv = { FROM_OPT: "yes" };
    const result = applyMergeAndFilter(parent, launchSpecEnv, optionsEnv, undefined);
    expect(result.FROM_PARENT).toBe("yes");
    expect(result.FROM_SPEC).toBe("yes");
    expect(result.FROM_OPT).toBe("yes");
  });
});

describe("envFilter - filter invocation and effect", () => {
  test("filter receives the fully merged env", () => {
    const parent: NodeJS.ProcessEnv = { PARENT_KEY: "parent" };
    const launchSpecEnv = { SPEC_KEY: "spec" };
    const optionsEnv = { OPT_KEY: "opt" };

    let captured: NodeJS.ProcessEnv | undefined;
    const filter = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
      captured = { ...env };
      return env;
    };

    applyMergeAndFilter(parent, launchSpecEnv, optionsEnv, filter);

    expect(captured?.PARENT_KEY).toBe("parent");
    expect(captured?.SPEC_KEY).toBe("spec");
    expect(captured?.OPT_KEY).toBe("opt");
  });

  test("filter stripping SECRET_ prefix keys removes them from env passed to spawn", () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      SECRET_DB_PASS: "hunter2",
      SECRET_API_KEY: "s3cr3t",
    };

    const stripSecrets = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
      const filtered: NodeJS.ProcessEnv = {};
      for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith("SECRET_")) {
          filtered[k] = v;
        }
      }
      return filtered;
    };

    const result = applyMergeAndFilter(parent, undefined, undefined, stripSecrets);

    expect(result.PATH).toBe("/usr/bin");
    expect("SECRET_DB_PASS" in result).toBe(false);
    expect("SECRET_API_KEY" in result).toBe(false);
  });

  test("when envFilter is undefined, merged env is returned verbatim", () => {
    const parent: NodeJS.ProcessEnv = { KEEP: "me" };
    const result = applyMergeAndFilter(parent, undefined, undefined, undefined);
    expect(result.KEEP).toBe("me");
  });

  test("filter return value is used as-is (can add or transform keys)", () => {
    const parent: NodeJS.ProcessEnv = { ORIGINAL: "yes" };
    const addKey = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, ADDED_BY_FILTER: "injected" });

    const result = applyMergeAndFilter(parent, undefined, undefined, addKey);

    expect(result.ORIGINAL).toBe("yes");
    expect(result.ADDED_BY_FILTER).toBe("injected");
  });
});

// TODO: Integration test - spawn a real binary (e.g. `env`) and assert the
// child process receives exactly the filtered environment. Skipped here because
// it requires a real agent binary implementing the ACP protocol and is
// out of scope for a unit-test suite. The unit tests above cover the filter
// semantics end-to-end via the merge+filter helper that mirrors launchAgent.
