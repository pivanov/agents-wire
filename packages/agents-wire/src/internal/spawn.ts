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
  readonly stderrTailLimit?: number;
  readonly disposeGraceMs?: number;
  readonly onStderr?: (line: string) => void;
  /** Model identifier forwarded to definition.launch() as a CLI flag (agent-specific). */
  readonly model?: string;
  /** Reasoning effort level forwarded to definition.launch() (agent-specific). */
  readonly effort?: string;
}

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
  // Catalog-mandated env (launchSpec.env) wins over caller env so flags like
  // AUGMENT_DISABLE_AUTO_UPDATE can't be silently nuked by user-supplied env.
  const merged = buildEnv(process.env, { ...options.env, ...launchSpec.env });
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
    let settled = false;
    const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolveClosed({ exitCode: code, signal });
    };
    child.once("exit", (code, signal) => settle(code, signal));
    // Backstop: if the child emits `error` after spawn (EPIPE, ECHILD,
    // OS-level reclaim) without firing `exit`, resolve the closed promise
    // anyway so dispose() / await connection.closed cannot hang forever.
    child.once("error", () => settle(null, null));
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
      // Mirror the first race's boolean-result pattern so we can tell
      // "closed naturally" (true) from "second timeout elapsed" (false).
      // The previous code threw away the result and relied on a follow-up
      // exitCode/signalCode check that races with Node's exit-event
      // processing on slow platforms — sending duplicate SIGKILL after
      // the child already exited cleanly.
      const secondSettled = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((settle) => {
          timeout2 = setTimeout(() => settle(false), grace);
        }),
      ]);
      if (timeout2) {
        clearTimeout(timeout2);
      }
      if (!secondSettled && child.exitCode === null && child.signalCode === null) {
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
