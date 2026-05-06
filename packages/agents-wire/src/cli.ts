#!/usr/bin/env node
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { agents } from "@/api/agents";
import { definitionFor, listDefinitions } from "@/catalog/index";
import { PACKAGE_VERSION } from "@/constants";
import { isKnownError } from "@/errors";
import { stripTerminalEscapes } from "@/internal/strip-terminal-escapes";
import type { TAgentId } from "@/types/agent";
import type { IAskOptions } from "@/types/options";

const VALID_PERMISSIONS = ["auto-allow", "auto-allow-once", "auto-reject", "stream"] as const;
type TCliPermission = (typeof VALID_PERMISSIONS)[number];

const isValidPermission = (value: string): value is TCliPermission => (VALID_PERMISSIONS as readonly string[]).includes(value);

interface IFlagSpec {
  readonly long: string;
  readonly short?: string;
  readonly hasValue: boolean;
}

const PARSED_FLAGS: readonly IFlagSpec[] = [
  { long: "--prompt", short: "-p", hasValue: true },
  { long: "--prompt-file", hasValue: true },
  { long: "--schema", hasValue: true },
  { long: "--schema-file", hasValue: true },
  { long: "--cwd", hasValue: true },
  { long: "--model", hasValue: true },
  { long: "--system-prompt", hasValue: true },
  { long: "--max-cost-usd", hasValue: true },
  { long: "--permission", hasValue: true },
  { long: "--json", hasValue: false },
  { long: "--help", short: "-h", hasValue: false },
  { long: "--version", short: "-v", hasValue: false },
];

interface IParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const parseArgs = (argv: readonly string[]): IParsedArgs => {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  // If argv[0] is a flag (e.g. `--version`, `-h`), there's no subcommand —
  // start parsing from index 0 and let the post-loop remap pick the command.
  const firstIsFlag = argv[0]?.startsWith("-") ?? false;
  let command = firstIsFlag ? "help" : (argv[0] ?? "help");

  for (let index = firstIsFlag ? 0 : 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    const matched = PARSED_FLAGS.find((flag) => flag.long === token || flag.short === token);
    if (matched) {
      if (matched.hasValue) {
        const next = argv[index + 1];
        if (next === undefined) {
          throw new Error(`Flag ${matched.long} requires a value`);
        }
        flags[matched.long] = next;
        index += 1;
      } else {
        flags[matched.long] = true;
      }
      continue;
    }
    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      if (equalsIndex > 0) {
        flags[token.slice(0, equalsIndex)] = token.slice(equalsIndex + 1);
        continue;
      }
      flags[token] = true;
      continue;
    }
    positional.push(token);
  }

  if (positional.length === 0 && (flags["--help"] || flags["--version"])) {
    command = flags["--help"] ? "help" : "version";
  }

  return { command, positional, flags };
};

const printHelp = (): void => {
  const usage = [
    "agents-wire - drive any local coding agent over ACP",
    "",
    "Usage:",
    "  agents-wire ask <agent> [--prompt <text>] [--cwd <path>] [--max-cost-usd <num>]",
    "  agents-wire ask-json <agent> --schema <json> | --schema-file <path>",
    "  agents-wire stream <agent> [--prompt <text>]",
    "  agents-wire detect",
    "  agents-wire agents",
    "  agents-wire --version",
    "",
    "Common flags:",
    "  --prompt, -p     Prompt text (or pipe via stdin)",
    "  --prompt-file    Read prompt from a file",
    "  --schema         Inline JSON Schema string",
    "  --schema-file    Path to JSON Schema",
    "  --cwd            Working directory passed to the agent",
    "  --model          Model hint",
    "  --system-prompt  System prompt prepended to user input",
    "  --max-cost-usd   SDK-side budget; aborts when exceeded",
    "  --permission     auto-allow | auto-allow-once | auto-reject | stream",
    "  --json           Emit JSON-formatted result",
    "",
    "Built-in agents:",
    ...listDefinitions().map((def) => `  ${def.id.padEnd(10)} ${def.label}`),
  ].join("\n");
  process.stdout.write(`${usage}\n`);
};

const printVersion = (): void => {
  // PACKAGE_VERSION is build-baked from package.json#version via tsup
  // `define`. Avoids the dynamic import that would fail under Node
  // versions without import-attribute support and that resolves
  // unpredictably when the bin is symlinked into a global root.
  process.stdout.write(`${PACKAGE_VERSION}\n`);
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
};

const resolvePrompt = async (flags: IParsedArgs["flags"]): Promise<string> => {
  if (typeof flags["--prompt"] === "string") {
    return flags["--prompt"];
  }
  if (typeof flags["--prompt-file"] === "string") {
    return (await fs.readFile(flags["--prompt-file"], "utf-8")).trim();
  }
  if (!process.stdin.isTTY) {
    return readStdin();
  }
  throw new Error("No prompt provided. Pass --prompt, --prompt-file, or pipe stdin.");
};

const resolveSchema = async (flags: IParsedArgs["flags"]): Promise<string> => {
  if (typeof flags["--schema"] === "string") {
    return flags["--schema"];
  }
  if (typeof flags["--schema-file"] === "string") {
    return (await fs.readFile(flags["--schema-file"], "utf-8")).trim();
  }
  throw new Error("No schema provided. Pass --schema or --schema-file.");
};

const buildOptionsFromFlags = (flags: IParsedArgs["flags"]): IAskOptions => {
  const options: { -readonly [K in keyof IAskOptions]: IAskOptions[K] } = {};
  if (typeof flags["--cwd"] === "string") {
    const cwd = flags["--cwd"];
    if (!path.isAbsolute(cwd)) {
      throw new Error(`--cwd must be an absolute path: ${cwd}`);
    }
    if (!fsSync.existsSync(cwd) || !fsSync.statSync(cwd).isDirectory()) {
      throw new Error(`--cwd does not exist or is not a directory: ${cwd}`);
    }
    options.cwd = cwd;
  }
  if (typeof flags["--model"] === "string") {
    options.model = flags["--model"];
  }
  if (typeof flags["--system-prompt"] === "string") {
    options.systemPrompt = flags["--system-prompt"];
  }
  if (typeof flags["--max-cost-usd"] === "string") {
    const value = Number(flags["--max-cost-usd"]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`--max-cost-usd must be a positive number: ${flags["--max-cost-usd"]}`);
    }
    options.maxCostUsd = value;
  }
  if (typeof flags["--permission"] === "string") {
    if (!isValidPermission(flags["--permission"])) {
      throw new Error(`--permission must be one of ${VALID_PERMISSIONS.join(", ")}; got "${flags["--permission"]}"`);
    }
    options.permission = flags["--permission"];
  }
  return options;
};

const ensureKnownAgent = (raw: string | undefined): TAgentId => {
  if (!raw) {
    throw new Error("Missing agent id. Run `agents-wire agents` to list available ids.");
  }
  definitionFor(raw);
  return raw;
};

const runAsk = async (parsed: IParsedArgs): Promise<void> => {
  const agent = ensureKnownAgent(parsed.positional[0]);
  const prompt = await resolvePrompt(parsed.flags);
  const options = buildOptionsFromFlags(parsed.flags);
  const result = await agents.ask(agent, prompt, options);
  if (parsed.flags["--json"]) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.text.length > 0) {
    process.stdout.write(`${result.text}\n`);
  }
};

const runAskJson = async (parsed: IParsedArgs): Promise<void> => {
  const agent = ensureKnownAgent(parsed.positional[0]);
  const prompt = await resolvePrompt(parsed.flags);
  const schema = await resolveSchema(parsed.flags);
  const options = buildOptionsFromFlags(parsed.flags);
  const result = await agents.askJson(agent, prompt, schema, options);
  process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
};

const runStream = async (parsed: IParsedArgs): Promise<void> => {
  const agent = ensureKnownAgent(parsed.positional[0]);
  const prompt = await resolvePrompt(parsed.flags);
  const options = buildOptionsFromFlags(parsed.flags);
  const stream = agents.stream(agent, prompt, options);
  for await (const event of stream) {
    if (event.type === "text-delta") {
      process.stdout.write(event.text);
    }
  }
  process.stdout.write("\n");
};

const runDetect = async (): Promise<void> => {
  const entries = await agents.detect();
  for (const entry of entries) {
    const status = entry.available ? "ready" : "missing";
    process.stdout.write(`${entry.id.padEnd(10)} ${entry.label.padEnd(20)} ${status}${entry.reason ? ` (${entry.reason})` : ""}\n`);
  }
};

const runAgents = (): void => {
  for (const def of listDefinitions()) {
    process.stdout.write(`${def.id.padEnd(10)} ${def.label.padEnd(20)} ${def.transport}\n`);
  }
};

const main = async (): Promise<number> => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags["--help"]) {
    printHelp();
    return 0;
  }
  if (parsed.flags["--version"]) {
    printVersion();
    return 0;
  }
  switch (parsed.command) {
    case "ask":
      await runAsk(parsed);
      return 0;
    case "ask-json":
      await runAskJson(parsed);
      return 0;
    case "stream":
      await runStream(parsed);
      return 0;
    case "detect":
      await runDetect();
      return 0;
    case "agents":
      runAgents();
      return 0;
    case "help":
      printHelp();
      return 0;
    case "version":
      printVersion();
      return 0;
    default:
      printHelp();
      return 1;
  }
};

// Surface stack traces when AGENTS_WIRE_DEBUG=1 — debugging cli failures
// without a stack is needlessly hard. Default stays terse for end users.
const includeStack = process.env.AGENTS_WIRE_DEBUG === "1";

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (isKnownError(error)) {
      const payload: Record<string, unknown> = { error: error.message, code: error.code, agent: error.agent };
      if (includeStack && error.stack) {
        payload.stack = error.stack;
      }
      process.stderr.write(`${stripTerminalEscapes(JSON.stringify(payload))}\n`);
      process.exit(2);
    }
    if (error instanceof Error) {
      process.stderr.write(`${stripTerminalEscapes(error.message)}\n`);
      if (includeStack && error.stack) {
        process.stderr.write(`${stripTerminalEscapes(error.stack)}\n`);
      }
      process.exit(1);
    }
    process.stderr.write(`${stripTerminalEscapes(String(error))}\n`);
    process.exit(1);
  },
);
