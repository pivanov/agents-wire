// Module-level cache for `agents.detect()` results so the agent picker
// opens instantly. App preloads at startup, picker reads from cache.
// `r` inside the picker triggers a refresh (TTL is permissive otherwise
// - the only common reason to refresh mid-session is "I just installed
// a new agent CLI in another terminal").

import { useEffect, useState } from "react";
import { agents, type IDetectionEntry } from "@pivanov/agents-wire";

let cached: readonly IDetectionEntry[] | undefined;
let inflight: Promise<readonly IDetectionEntry[]> | undefined;
const subscribers = new Set<() => void>();

const notify = (): void => {
  for (const cb of subscribers) {
    cb();
  }
};

const runDetect = (): Promise<readonly IDetectionEntry[]> => {
  if (inflight) {
    return inflight;
  }
  inflight = agents
    .detect()
    .then((entries) => {
      cached = entries;
      inflight = undefined;
      notify();
      return entries;
    })
    .catch((cause) => {
      inflight = undefined;
      throw cause;
    });
  return inflight;
};

/** Kick off detection if not already cached. Safe to call repeatedly. */
export const preloadDetections = (): void => {
  if (cached === undefined && inflight === undefined) {
    void runDetect().catch(() => {
      // Detection errors are handled per-call by callers via refresh.
      // Picker still renders with `cached = undefined`, showing "probing…".
    });
  }
};

/** Force a fresh detection run; returns the new entries. */
export const refreshDetections = async (): Promise<readonly IDetectionEntry[]> => {
  cached = undefined;
  inflight = undefined;
  return runDetect();
};

export const useDetections = (): { entries: readonly IDetectionEntry[] | undefined; refresh: () => void } => {
  const [, force] = useState(0);

  useEffect(() => {
    const cb = (): void => force((n) => n + 1);
    subscribers.add(cb);
    preloadDetections();
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  const refresh = (): void => {
    void refreshDetections().catch(() => {});
    force((n) => n + 1);
  };

  return { entries: cached, refresh };
};
