import { agents, detectAvailableAgents, AgentNotInstalledError } from "@pivanov/agents-wire";

const topic = process.argv[2] ?? "the public API surface";

const available = await detectAvailableAgents();
const claude = available.find((e) => e.id === "claude");

if (!claude?.available) {
  console.error(`Agent "claude" is not available: ${claude?.reason ?? "not installed"}`);
  console.error("Install Claude Code: https://claude.ai/download");
  process.exit(1);
}

console.error(`Researching: "${topic}"\n`);

const stream = agents.stream(
  "claude",
  `Read the codebase and write a one-paragraph summary of ${topic}.
Use your Read and Glob tools freely to explore source files.
After reading relevant files, write the summary directly - no preamble.`,
  { permission: "auto-allow", maxCostUsd: 1.0 },
);

let toolCount = 0;

try {
  for await (const event of stream) {
    if (event.type === "text-delta") {
      process.stdout.write(event.text);
    } else if (event.type === "tool-call") {
      toolCount += 1;
      process.stderr.write(`[tool #${toolCount}] ${event.tool}\n`);
    }
  }

  const result = await stream.result();
  const cost = result.cost?.totalUsd?.toFixed(4) ?? "0.0000";
  process.stderr.write(`\n\nDone. ${result.durationMs}ms | ${toolCount} tool calls | $${cost}\n`);
} catch (err) {
  if (err instanceof AgentNotInstalledError) {
    console.error(`Agent not installed: ${err.message}`);
    process.exit(1);
  }
  console.error("\nStream failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
