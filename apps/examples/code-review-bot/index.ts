import { agents, detectAvailableAgents, AgentNotInstalledError } from "@pivanov/agents-wire";
import { z } from "zod";

if (process.stdin.isTTY) {
  console.error("Usage: git diff main | bun run example:code-review");
  console.error("       git diff HEAD~1 | bun run example:code-review");
  process.exit(1);
}

const diff = await Bun.stdin.text();

if (!diff.trim()) {
  console.error("No diff received on stdin. Pipe `git diff` in.");
  process.exit(1);
}

const available = await detectAvailableAgents();
const claude = available.find((e) => e.id === "claude");

if (!claude?.available) {
  console.error(`Agent "claude" is not available: ${claude?.reason ?? "not installed"}`);
  console.error("Install Claude Code: https://claude.ai/download");
  process.exit(1);
}

const schema = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(["info", "warn", "blocker"]),
      file: z.string(),
      line: z.number().optional(),
      message: z.string(),
    }),
  ),
  summary: z.string(),
});

const SEVERITY_ICON: Record<string, string> = {
  info: "ℹ",
  warn: "⚠",
  blocker: "✖",
};

try {
  console.error("Reviewing diff...\n");

  const { data } = await agents.askJson(
    "claude",
    `Review this git diff for bugs, security issues, and style problems.
Return a JSON object with:
- findings: array of { severity ("info"|"warn"|"blocker"), file, line (optional), message }
- summary: one-sentence overall assessment

Diff:
\`\`\`diff
${diff.slice(0, 60_000)}
\`\`\``,
    schema,
    { permission: "auto-allow", maxCostUsd: 0.5 },
  );

  for (const finding of data.findings) {
    const icon = SEVERITY_ICON[finding.severity] ?? "?";
    const loc = finding.line !== undefined ? `:${finding.line}` : "";
    console.log(`[${finding.severity}] ${icon} ${finding.file}${loc}`);
    console.log(`       ${finding.message}`);
  }

  if (data.findings.length === 0) {
    console.log("No findings - looks clean.");
  }

  console.log(`\nSummary: ${data.summary}`);
} catch (err) {
  if (err instanceof AgentNotInstalledError) {
    console.error(`Agent not installed: ${err.message}`);
    process.exit(1);
  }
  console.error("Review failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
