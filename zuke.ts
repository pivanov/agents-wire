/**
 * The agents-wire build, as code.
 *
 * Every check this repository runs — install, Biome, tsc, knip, `bun test`,
 * the tsup bundle — is a typed target below, and `.github/workflows/ci.yml`
 * is generated from the same graph, so CI cannot drift from what `./zuke`
 * runs locally. Deno runs the build; nothing is added to package.json and the
 * SDK keeps its Bun toolchain untouched.
 *
 *   ./zuke                 # the whole gate: install → checks → test → build
 *   ./zuke test            # one target, with its prerequisites
 *   ./zuke --list          # every target, its description and dependencies
 *   ./zuke graph           # the dependency graph
 *   ./zuke ci --dry-run    # the plan, without running anything
 *   ./zuke generate-ci     # rewrite the workflow from this file
 *
 * Windows: `.\zuke.ps1` with the same arguments.
 */
import { Build, cicd, group, run, target } from "@zuke/core";
import { BiomeTasks } from "@zuke/biome";
import { BunTasks } from "@zuke/bun";
import { KnipTasks } from "@zuke/knip";
import { TscTasks } from "@zuke/tsc";
import { TsupTasks } from "@zuke/tsup";

/** The published package: where tsc, knip, tsup and `bun test` run. */
const SDK = "packages/agents-wire";

class AgentsWire extends Build {
  install = target()
    .description("Install workspace dependencies from bun.lock (bun install --frozen-lockfile)")
    .executes(() => BunTasks.install((s) => s.frozenLockfile()));

  /** The static checks are independent of each other, so they run concurrently. */
  checks = group();

  lint = target()
    .description("Lint and format-check every workspace with Biome (biome check .)")
    .dependsOn(this.install)
    .partOf(this.checks)
    .executes(() => BiomeTasks.check((s) => s.paths(".")));

  typecheck = target()
    .description("Type-check the SDK (tsc --noEmit)")
    .dependsOn(this.install)
    .partOf(this.checks)
    .executes(() => TscTasks.tsc((s) => s.noEmit().cwd(SDK)));

  knip = target()
    .description("Report unused files, dependencies and exports in the SDK (knip)")
    .dependsOn(this.install)
    .partOf(this.checks)
    .executes(() => KnipTasks.run((s) => s.cwd(SDK)));

  test = target()
    .description("Run the SDK test suite (bun test)")
    .dependsOn(this.install)
    .executes(() => BunTasks.test((s) => s.cwd(SDK)));

  build = target()
    .description("Bundle the SDK with tsup and emit its declarations with tsc")
    .dependsOn(this.install)
    .executes(async () => {
      await TsupTasks.build((s) => s.cwd(SDK));
      await TscTasks.tsc((s) => s.project("tsconfig.build.json").emitDeclarationOnly().cwd(SDK));
      // The package's `bin` entries must be executable; chmod is a POSIX notion.
      if (Deno.build.os !== "windows") {
        for (const cli of ["dist/cli.cjs", "dist/cli.mjs"]) {
          await Deno.chmod(`${SDK}/${cli}`, 0o755);
        }
      }
    });

  docs = target()
    .description("Build the VitePress documentation site (apps/docs)")
    .dependsOn(this.install)
    .executes(() => BunTasks.run((s) => s.script("build").cwd("apps/docs")));

  ci = target()
    .description("The full gate CI runs: static checks, tests and the bundle")
    .dependsOn(this.checks, this.test, this.build)
    .executes(() => {});

  // Convention: `default` runs when no target is named.
  default = target()
    .description("Default: the full gate")
    .dependsOn(this.ci)
    .executes(() => {});

  // `.github/workflows/ci.yml`, derived from the graph above — the job id, its
  // name and the `./zuke ci` step all come from the target it invokes. Running
  // any target regenerates the file locally; on CI the run verifies the
  // committed copy and fails if it has drifted.
  ciWorkflow = cicd({
    provider: "github",
    pipeline: {
      name: "CI",
      triggers: { push: ["main"], pullRequest: ["main"] },
      concurrency: { group: "ci-${{ github.ref }}", cancelInProgress: true },
      // The prelude action hardens the runner and checks out. Deno comes from
      // the launcher itself, which installs a pinned, checksum-verified release
      // when none is on PATH; only Bun needs setting up.
    },
    invokes: [
      {
        target: this.ci,
        name: "lint + typecheck + knip + test + build",
        before: [{ name: "Set up Bun", uses: "oven-sh/setup-bun@v2", with: { "bun-version": "latest" } }],
      },
    ],
  });
}

await run(AgentsWire);
