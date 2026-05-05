import { agents, detectAvailableAgents, WireError } from "@pivanov/agents-wire";
import { z } from "zod";

const text = process.argv[2] ?? "We need to refund this customer ASAP, they're furious.";

const available = await detectAvailableAgents();
const availableIds = new Set(available.filter((e) => e.available).map((e) => e.id));

if (availableIds.size === 0) {
  console.error("No agents are available. Install at least one:");
  for (const entry of available) {
    console.error(`  ${entry.id}: ${entry.reason ?? "unavailable"}`);
  }
  process.exit(1);
}

const PREFERRED = ["claude", "codex", "gemini"] as const;
const candidates = PREFERRED.filter((id) => availableIds.has(id));

if (candidates.length === 0) {
  console.error(`None of the preferred agents (${PREFERRED.join(", ")}) are installed.`);
  console.error(`Available: ${[...availableIds].join(", ") || "none"}`);
  process.exit(1);
}

const schema = z.object({
  category: z.enum(["bug", "feature-request", "billing", "complaint", "praise", "other"]),
  urgency: z.enum(["low", "medium", "high"]),
  reasoning: z.string(),
});

const prompt = `Classify this support ticket and return JSON with:
- category: "bug" | "feature-request" | "billing" | "complaint" | "praise" | "other"
- urgency: "low" | "medium" | "high"
- reasoning: one sentence explaining your choice

Ticket: "${text}"`;

const ASK_OPTIONS = { permission: "auto-allow", maxCostUsd: 0.25 } as const;

let lastError: unknown;
let winner: (typeof PREFERRED)[number] | undefined;

console.error(`Classifying with failover: ${candidates.join(" -> ")}\n`);

for (let i = 0; i < candidates.length; i++) {
  const agent = candidates[i];
  if (agent === undefined) {
    continue;
  }
  console.error(`[attempt ${i + 1}] trying ${agent}...`);
  try {
    const { data } = await agents.askJson(agent, prompt, schema, ASK_OPTIONS);
    winner = agent;
    console.log(JSON.stringify({ ...data, agent }, null, 2));
    process.exit(0);
  } catch (err) {
    lastError = err;
    const isRetryable =
      err instanceof WireError &&
      (err.code === "agent-not-installed" ||
        err.code === "auth-required" ||
        err.code === "usage-limit" ||
        err.code === "overloaded" ||
        err.code === "rate-limit");

    if (!isRetryable || i === candidates.length - 1) {
      break;
    }
    console.error(`  failed (${err instanceof WireError ? err.code : "unknown"}), trying next agent...`);
  }
}

console.error(winner === undefined ? "All agents failed." : "Classification failed.");
console.error(lastError instanceof Error ? lastError.message : String(lastError));
process.exit(1);
