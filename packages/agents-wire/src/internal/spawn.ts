import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { type Stream as AcpStream, ndJsonStream } from "@agentclientprotocol/sdk";
import { DEFAULT_DISPOSE_GRACE_MS, DEFAULT_STDERR_TAIL_LIMIT } from "@/constants";
import { AgentConnectionClosedError } from "@/errors";
import type { IAgentDefinition, IWireLaunchSpec } from "@/types/agent";

export interface ISpawnOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly envFilter?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  /** Pass the host's full process.env to the child. Defaults to false (allowlist only). */
  readonly passFullEnv?: boolean;
  readonly stderrTailLimit?: number;
  readonly disposeGraceMs?: number;
  readonly onStderr?: (line: string) => void;
  /** Model identifier forwarded to definition.launch() as a CLI flag (agent-specific). */
  readonly model?: string;
  /** Reasoning effort level forwarded to definition.launch() (agent-specific). */
  readonly effort?: string;
}

const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "TERMINFO",
  "TERM_PROGRAM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "LANG",
  "LANGUAGE",
  "PWD",
  "OLDPWD",
  "SystemRoot",
  "ProgramFiles",
  "APPDATA",
  "LOCALAPPDATA",
]);

const SAFE_ENV_PREFIXES = ["LC_", "NODE_", "BUN_"] as const;

const isSafeKey = (key: string): boolean => {
  if (SAFE_ENV_KEYS.has(key)) {
    return true;
  }
  for (const prefix of SAFE_ENV_PREFIXES) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

const filterToAllowlist = (parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (isSafeKey(key)) {
      next[key] = value;
    }
  }
  return next;
};

export interface ISpawnedConnection {
  readonly definition: IAgentDefinition;
  readonly stream: AcpStream;
  readonly stderrTail: () => readonly string[];
  readonly closed: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  readonly dispose: () => Promise<void>;
}

const buildEnv = (parentEnv: NodeJS.ProcessEnv, extra?: Readonly<Record<string, string>>): NodeJS.ProcessEnv => {
  if (!extra) {
    return parentEnv;
  }
  const next = { ...parentEnv };
  for (const [key, value] of Object.entries(extra)) {
    next[key] = value;
  }
  return next;
};

const toAcpStream = (child: ChildProcessWithoutNullStreams): AcpStream => {
  const writable = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const readable = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
  return ndJsonStream(writable, readable);
};

const wireStderr = (child: ChildProcessWithoutNullStreams, tail: string[], limit: number, onStderr: ISpawnOptions["onStderr"]): void => {
  child.stderr.setEncoding("utf-8");
  let leftover = "";
  child.stderr.on("data", (chunk: string) => {
    const combined = leftover + chunk;
    const lines = combined.split(/\r?\n/);
    leftover = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      tail.push(line);
      if (tail.length > limit) {
        tail.shift();
      }
      onStderr?.(line);
    }
  });
};

export const launchAgent = async (definition: IAgentDefinition, options: ISpawnOptions = {}): Promise<ISpawnedConnection> => {
  const launchSpec: IWireLaunchSpec = definition.launch({
    ...(options.env ? { env: options.env } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
  });
  const baseEnv = options.passFullEnv ? process.env : filterToAllowlist(process.env);
  const merged = buildEnv(baseEnv, { ...launchSpec.env, ...options.env });
  const env = options.envFilter ? options.envFilter(merged) : merged;
  const child = spawn(launchSpec.command, [...launchSpec.args], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderrLimit = options.stderrTailLimit ?? DEFAULT_STDERR_TAIL_LIMIT;
  const tail: string[] = [];
  wireStderr(child, tail, stderrLimit, options.onStderr);

  const closed = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveClosed) => {
    child.once("exit", (code, signal) => resolveClosed({ exitCode: code, signal }));
  });

  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    const onError = (cause: Error): void => {
      child.removeListener("spawn", onSpawn);
      rejectSpawn(new AgentConnectionClosedError(definition.id, null, null, tail, { cause }));
    };
    const onSpawn = (): void => {
      child.removeListener("error", onError);
      resolveSpawn();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });

  const dispose = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      child.stdin.end();
    } catch {
      /* stdin already closed */
    }
    const grace = options.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS;
    let timeout1: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((settle) => {
        timeout1 = setTimeout(() => settle(false), grace);
      }),
    ]);
    if (timeout1) {
      clearTimeout(timeout1);
    }
    if (!settled) {
      child.kill("SIGTERM");
      let timeout2: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        closed,
        new Promise<void>((settle) => {
          timeout2 = setTimeout(settle, grace);
        }),
      ]);
      if (timeout2) {
        clearTimeout(timeout2);
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  };

  return {
    definition,
    stream: toAcpStream(child),
    stderrTail: () => [...tail],
    closed,
    dispose,
  };
};
