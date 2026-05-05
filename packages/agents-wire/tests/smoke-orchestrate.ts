import { agents } from "@/api/agents";
import { registerDefinition } from "@/catalog/index";

registerDefinition({
  id: "dud",
  label: "Dud (always fails)",
  transport: "native-acp",
  installNotice: "synthetic agent for tests",
  launch() {
    return { command: "/bin/false", args: [] };
  },
});

const log = (label: string, value: unknown): void => {
  console.log(`[${label}]`, value);
};

const checkFailover = async (): Promise<void> => {
  console.log("\n=== failover (dud → claude) ===");
  const startedAt = Date.now();
  const result = await agents.failover(
    "Reply with exactly the four characters: pong",
    ["dud", "claude"],
    {
      permission: "auto-allow",
      maxCostUsd: 0.5,
      shouldRetry: () => true,
      onAttempt: ({ agent, attempt }) => console.log(`  trying #${attempt}: ${agent}`),
    },
  );
  log("failover.elapsedMs", Date.now() - startedAt);
  log("failover.winner", result.winner);
  log("failover.attemptedCount", result.attempted.length);
  log("failover.text", result.text);
  log("failover.cost.totalUsd", result.cost?.totalUsd);
};

const checkRace = async (): Promise<void> => {
  console.log("\n=== race (dud vs claude) ===");
  const startedAt = Date.now();
  const result = await agents.race(
    "Reply with exactly the four characters: pong",
    ["dud", "claude"],
    {
      permission: "auto-allow",
      maxCostUsd: 0.5,
    },
  );
  log("race.elapsedMs", Date.now() - startedAt);
  log("race.winner", result.winner);
  log("race.losersCount", result.losers.length);
  log("race.text", result.text);
};

const checkCascade = async (): Promise<void> => {
  console.log("\n=== cascade (haiku → opus) ===");
  const startedAt = Date.now();
  const result = await agents.cascade(
    "Reply with exactly the four characters: pong",
    [
      { agent: "claude", options: { model: "haiku" }, accept: (r) => r.text.trim() === "pong" },
      { agent: "claude", options: { model: "opus" } },
    ],
    { permission: "auto-allow", maxCostUsd: 0.5 },
  );
  log("cascade.elapsedMs", Date.now() - startedAt);
  log("cascade.winningStageIndex", result.winningStageIndex);
  log("cascade.text", result.text);
  log("cascade.rejectedCount", result.rejected.length);
};

const checkPool = async (): Promise<void> => {
  console.log("\n=== pool (capacity=2, three concurrent prompts) ===");
  const startedAt = Date.now();
  await using pool = await agents.pool({
    agents: ["claude"],
    capacity: 2,
    permission: "auto-allow",
    maxCostUsd: 1.0,
  });
  const prompts = ["Say: one.", "Say: two.", "Say: three."];
  const results = await Promise.all(prompts.map((p) => pool.ask(p)));
  log("pool.elapsedMs", Date.now() - startedAt);
  log("pool.size", pool.size);
  log("pool.replies", results.map((r) => r.text.trim()));
  log("pool.cost.totalUsd", pool.cost.snapshot.totalUsd);
  log("pool.cost.turns", pool.cost.snapshot.turns);
};

const main = async (): Promise<void> => {
  await checkFailover();
  await checkRace();
  await checkCascade();
  await checkPool();
  console.log("\n[smoke-orchestrate] all checks passed");
};

main().catch((cause: unknown) => {
  console.error("[smoke-orchestrate] failed:", cause);
  process.exit(1);
});
