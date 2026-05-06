import type { TAgentId } from "@/types/agent";

// Tool names emitted by each agent's built-in toolset. Used by the
// allowed/blocked filter and by callers wanting to distinguish a
// built-in vs an MCP-supplied tool. Names are case-sensitive within an
// agent but the handler matches case-insensitively for ergonomics.
const PER_AGENT_TOOLS: Readonly<Record<string, readonly string[]>> = {
  // Claude Code / Cursor / OpenCode use PascalCase canonical names.
  claude: ["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite", "Task", "NotebookEdit"],
  cursor: ["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "WebSearch", "WebFetch"],
  opencode: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "LS", "WebSearch", "WebFetch"],
  // Codex / Cline / Kilo / Qwen / Gemini / Auggie / Droid / Pi / Copilot
  // emit snake_case names. Lists are best-effort — agents add tools.
  codex: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  cline: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  kilo: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  qwen: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  gemini: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  auggie: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  droid: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  pi: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
  copilot: ["execute_command", "read_file", "write_file", "edit_file", "search_files", "list_dir"],
};

// Public flat list — backwards-compatible. Aggregated across every
// known agent for callers that don't have an agent context handy.
export const BUILT_IN_TOOL_NAMES = Array.from(new Set(Object.values(PER_AGENT_TOOLS).flat())) as readonly string[];

export type TBuiltInToolName = string;

/**
 * Check whether `name` is a built-in tool. Pass `agentId` to scope the
 * lookup to that agent's namespace (e.g. "Read" hits Claude/Cursor but
 * not Codex). Without `agentId`, returns true if any agent declares it.
 */
export const isBuiltInTool = (name: string, agentId?: TAgentId): name is TBuiltInToolName => {
  if (agentId) {
    const list = PER_AGENT_TOOLS[agentId];
    return list ? list.includes(name) : false;
  }
  return BUILT_IN_TOOL_NAMES.includes(name);
};
