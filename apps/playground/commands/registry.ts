export interface ICommandSpec {
  readonly name: string;
  readonly args: string;
  readonly description: string;
  readonly requiresArgs: boolean;
}

export const COMMANDS: readonly ICommandSpec[] = [
  { name: "agent", args: "[id|n]", description: "switch agent · open picker if no arg", requiresArgs: false },
  { name: "mode", args: "[mode]", description: "switch turn mode · picker if no arg", requiresArgs: false },
  { name: "permission", args: "[policy]", description: "auto-allow | auto-allow-once | auto-reject | stream", requiresArgs: false },
  { name: "budget", args: "[usd|off]", description: "set or disable max cost · picker if no arg", requiresArgs: false },
  { name: "detect", args: "", description: "list installed agents", requiresArgs: false },
  { name: "reset", args: "", description: "reset cost tracker", requiresArgs: false },
  { name: "theme", args: "", description: "open theme picker with live preview", requiresArgs: false },
  { name: "race", args: "[<prompt>]", description: "race agents in parallel · multi-agent picker if no arg", requiresArgs: false },
  { name: "failover", args: "[<prompt>]", description: "try in order · multi-agent picker if no arg", requiresArgs: false },
  { name: "cascade", args: "[<prompt>]", description: "escalation chain · multi-agent picker if no arg", requiresArgs: false },
  { name: "pool", args: "[n|close|status]", description: "warm subprocess pool · picker if no arg", requiresArgs: false },
  { name: "session", args: "[start|close]", description: "open or close a multi-turn session", requiresArgs: false },
  { name: "clear", args: "", description: "clear transcript", requiresArgs: false },
  { name: "help", args: "", description: "show all commands", requiresArgs: false },
  { name: "quit", args: "", description: "exit playground", requiresArgs: false },
  { name: "exit", args: "", description: "exit playground (alias of /quit)", requiresArgs: false },
];

export const COMMAND_BY_NAME: Readonly<Record<string, ICommandSpec | undefined>> = Object.fromEntries(COMMANDS.map((cmd) => [cmd.name, cmd]));

export const findCommand = (name: string): ICommandSpec | undefined => COMMAND_BY_NAME[name];

export const matchCommands = (line: string): readonly ICommandSpec[] => {
  if (!line.startsWith("/") || line.includes(" ")) {
    return [];
  }
  const stripped = line.slice(1);
  return COMMANDS.filter((cmd) => cmd.name.startsWith(stripped));
};
