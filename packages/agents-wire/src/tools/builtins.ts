export const BUILT_IN_TOOL_NAMES = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "LS",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "Task",
  "NotebookEdit",
  "execute_command",
  "read_file",
  "write_file",
  "edit_file",
  "search_files",
  "list_dir",
] as const;

export type TBuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

export const isBuiltInTool = (name: string): name is TBuiltInToolName => (BUILT_IN_TOOL_NAMES as readonly string[]).includes(name);
