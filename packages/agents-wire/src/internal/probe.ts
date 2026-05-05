import { spawn } from "node:child_process";
import { resolvePackageBin, resolvePackageEntry } from "@/internal/resolve-package";
import type { IProbeOutcome } from "@/types/agent";

type IProbeResult = IProbeOutcome;

const PROBE_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 500; // SIGTERM grace period before SIGKILL escalation

export const probeBinaryVersion = (binary: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<IProbeResult> =>
  new Promise((resolve) => {
    let spawned: ReturnType<typeof spawn>;
    try {
      spawned = spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (cause) {
      resolve({ available: false, reason: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    let settled = false;
    let killEscalation: ReturnType<typeof setTimeout> | undefined;
    const finish = (available: boolean, reason?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        spawned.kill(); // SIGTERM
      } catch {
        /* swallow */
      }
      // If the binary traps SIGTERM, escalate to SIGKILL so we don't leak
      // a zombie process for the lifetime of the SDK host.
      killEscalation = setTimeout(() => {
        try {
          spawned.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      }, KILL_GRACE_MS);
      resolve(reason !== undefined ? { available, reason } : { available });
    };
    const handle = setTimeout(() => finish(false, "timeout"), timeoutMs);
    spawned.once("error", (cause: NodeJS.ErrnoException) => {
      clearTimeout(handle);
      if (killEscalation) {
        clearTimeout(killEscalation);
      }
      const reason = cause.code === "ENOENT" ? `not found on PATH: ${binary}` : cause.message;
      finish(false, reason);
    });
    spawned.once("exit", (code) => {
      clearTimeout(handle);
      if (killEscalation) {
        clearTimeout(killEscalation);
      }
      if (code === 0) {
        finish(true);
        return;
      }
      finish(false, `exit code ${code}`);
    });
  });

// Derive the package name (everything up to the second `/` for scoped, first `/` for plain) from a deep specifier.
const packageNameFromSpecifier = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
};

export const probeNodeBridge = async (bridgeSpecifier: string, underlyingBinary: string): Promise<IProbeResult> => {
  try {
    resolvePackageEntry(bridgeSpecifier);
  } catch {
    const pkg = packageNameFromSpecifier(bridgeSpecifier);
    return {
      available: false,
      reason: `bridge package "${pkg}" not installed — run \`npm i ${pkg}\` (or \`-g\`) to enable this agent`,
    };
  }
  return probeBinaryVersion(underlyingBinary);
};

export const probePeerBridge = async (packageName: string, binName?: string): Promise<IProbeResult> => {
  try {
    if (binName !== undefined) {
      resolvePackageBin(packageName, binName);
    } else {
      resolvePackageBin(packageName);
    }
    return { available: true };
  } catch {
    return { available: false, reason: `${packageName} is not installed` };
  }
};
