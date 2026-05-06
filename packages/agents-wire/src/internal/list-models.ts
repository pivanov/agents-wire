import { spawn } from "node:child_process";
import type { IAgentModelOption } from "@/types/agent";

const LIST_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB cap so a runaway CLI cannot OOM the SDK
const KILL_GRACE_MS = 500; // SIGTERM grace period before SIGKILL escalation

interface ICaptureOptions {
  /** Surfaces spawn / exit-code / stderr-only failures so model-list bugs aren't invisible. */
  readonly onWarning?: (message: string) => void;
}

/** Spawn a CLI and capture its stdout. Returns "" on any failure. */
const captureStdout = (binary: string, args: readonly string[], opts: ICaptureOptions = {}): Promise<string> =>
  new Promise((resolve) => {
    let spawned: ReturnType<typeof spawn>;
    try {
      // Pipe stderr (was "ignore") so a CLI that writes diagnostics to
      // stderr-only on auth/login failure surfaces something actionable
      // via onWarning rather than silently returning an empty list.
      spawned = spawn(binary, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (cause) {
      opts.onWarning?.(`spawn ${binary} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      resolve("");
      return;
    }
    let out = "";
    let stderrTail = "";
    let truncated = false;
    spawned.stdout?.setEncoding("utf-8");
    spawned.stdout?.on("data", (chunk: string) => {
      if (truncated) {
        return;
      }
      out += chunk;
      if (out.length >= MAX_OUTPUT_BYTES) {
        out = out.slice(0, MAX_OUTPUT_BYTES);
        truncated = true;
        // Stop reading; the kill in finish() handles the rest.
        finish(out);
      }
    });
    spawned.stderr?.setEncoding("utf-8");
    spawned.stderr?.on("data", (chunk: string) => {
      // Cap stderr buffering so a chatty CLI can't OOM us; the warning is
      // diagnostic, not a transcript.
      if (stderrTail.length < 4096) {
        stderrTail += chunk;
      }
    });
    let settled = false;
    let killEscalation: ReturnType<typeof setTimeout> | undefined;
    // `kill` controls whether finish() proactively SIGTERMs and arms a
    // SIGKILL escalation timer. Only the timeout / truncation paths need
    // it; the natural-exit path skips both so we don't pin the loop on a
    // 500 ms timer waiting to kill an already-dead pid.
    const finish = (value: string, kill: boolean = true): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (kill) {
        try {
          spawned.kill(); // SIGTERM
        } catch {
          /* swallow */
        }
        killEscalation = setTimeout(() => {
          try {
            spawned.kill("SIGKILL");
          } catch {
            /* already exited */
          }
        }, KILL_GRACE_MS);
        killEscalation.unref?.();
      }
      resolve(value);
    };
    const handle = setTimeout(() => {
      opts.onWarning?.(`${binary} ${args.join(" ")} timed out after ${LIST_TIMEOUT_MS}ms`);
      finish("");
    }, LIST_TIMEOUT_MS);
    spawned.once("error", (err) => {
      clearTimeout(handle);
      opts.onWarning?.(`${binary} ${args.join(" ")} errored: ${err.message}`);
      finish("", false);
    });
    spawned.once("exit", (code) => {
      clearTimeout(handle);
      if (killEscalation) {
        clearTimeout(killEscalation);
      }
      if (code !== 0 && stderrTail.trim().length > 0) {
        opts.onWarning?.(`${binary} ${args.join(" ")} exited ${code}: ${stderrTail.trim().slice(0, 256)}`);
      }
      finish(code === 0 ? out : "", false);
    });
  });

/**
 * Strip ANSI escape sequences and terminal cursor control codes that some
 * CLIs (notably cursor-agent) print while loading.
 */
const stripAnsi = (s: string): string => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal control codes is the goal
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
};

/**
 * Parse `cursor-agent --list-models` output. Format per line:
 *   "<id> - <label>" with optional " (current, default)" suffix.
 * Skips the "Available models" header and the loading line.
 */
export const parseCursorModels = (raw: string): readonly IAgentModelOption[] => {
  const out: IAgentModelOption[] = [];
  const lines = stripAnsi(raw).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed === "Available models" || trimmed.startsWith("Loading")) {
      continue;
    }
    const match = trimmed.match(/^([\w.-]+)\s+-\s+(.+?)(?:\s*\([^)]*\))?$/);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    out.push({ id: match[1], label: match[2].trim() });
  }
  return out;
};

/**
 * Parse `opencode models` output. Format: one `<provider/model>` per line.
 * The id and label are the same string.
 */
export const parseOpencodeModels = (raw: string): readonly IAgentModelOption[] => {
  const out: IAgentModelOption[] = [];
  const lines = stripAnsi(raw).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("Loading") || !trimmed.includes("/")) {
      continue;
    }
    out.push({ id: trimmed, label: trimmed });
  }
  return out;
};

export const listCursorModels = async (binary = "agent"): Promise<readonly IAgentModelOption[]> => {
  const raw = await captureStdout(binary, ["--list-models"]);
  return parseCursorModels(raw);
};

export const listOpencodeModels = async (binary = "opencode"): Promise<readonly IAgentModelOption[]> => {
  const raw = await captureStdout(binary, ["models"]);
  return parseOpencodeModels(raw);
};

/**
 * Parse `kilo models` output. Each non-blank line is a `<provider>/<model>`
 * id (mirrors models.dev keys). Defensive: skip header / empty / lines
 * without a slash.
 */
export const parseKiloModels = (raw: string): readonly IAgentModelOption[] => {
  const out: IAgentModelOption[] = [];
  const lines = stripAnsi(raw).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.toLowerCase().startsWith("loading") || !trimmed.includes("/")) {
      continue;
    }
    // Defensive: take just the first whitespace-separated token in case
    // Kilo decorates output with descriptions or status flags.
    const id = trimmed.split(/\s+/)[0] ?? trimmed;
    out.push({ id, label: id });
  }
  return out;
};

export const listKiloModels = async (binary = "kilo"): Promise<readonly IAgentModelOption[]> => {
  const raw = await captureStdout(binary, ["models"]);
  return parseKiloModels(raw);
};

/**
 * Parse `auggie model list` output. Format unverified (requires login to see).
 * Defensive: tolerates leading hyphens / bullets, skips header/blank/login-prompt
 * lines, takes the first whitespace-separated token as the id. Returns `[]` if
 * the user isn't authenticated (auggie's login-required message has no model
 * lines, so the result is naturally empty).
 */
export const parseAuggieModels = (raw: string): readonly IAgentModelOption[] => {
  const out: IAgentModelOption[] = [];
  const lines = stripAnsi(raw).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*•]\s*/, "");
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("loading") ||
      lower.startsWith("available") ||
      lower.includes("not currently logged in") ||
      lower.includes("auggie login") ||
      lower.startsWith("model")
    ) {
      continue;
    }
    const id = trimmed.split(/\s+/)[0];
    if (!id || id.length > 80) {
      continue;
    }
    out.push({ id, label: id });
  }
  return out;
};

export const listAuggieModels = async (binary = "auggie"): Promise<readonly IAgentModelOption[]> => {
  const raw = await captureStdout(binary, ["model", "list"]);
  return parseAuggieModels(raw);
};
