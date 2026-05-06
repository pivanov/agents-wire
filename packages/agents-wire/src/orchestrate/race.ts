import { createClient } from "@/api/client";
import { WireError } from "@/errors";
import type { TAgentId } from "@/types/agent";
import type { IAskOptions } from "@/types/options";
import type { IAskResult } from "@/types/results";

export interface IRaceLoser {
  readonly agent: TAgentId;
  readonly durationMs: number;
  readonly error: unknown;
}

export interface IRaceResult extends IAskResult {
  readonly winner: TAgentId;
  readonly losers: readonly IRaceLoser[];
}

export interface IRaceOptions extends IAskOptions {
  readonly perAgent?: Readonly<Partial<Record<TAgentId, IAskOptions>>>;
  readonly cancelLosers?: boolean;
}

const optionsForAgent = (base: IAskOptions, perAgent: IRaceOptions["perAgent"], agent: TAgentId): IAskOptions => {
  const overrides = perAgent?.[agent];
  if (!overrides) {
    return base;
  }
  return { ...base, ...overrides };
};

export const race = async (prompt: string, candidates: readonly TAgentId[], options: IRaceOptions = {}): Promise<IRaceResult> => {
  if (candidates.length === 0) {
    throw new WireError("retry-exhausted", "race called with no candidates");
  }
  const cancelLosers = options.cancelLosers ?? true;
  const controllers = candidates.map(() => new AbortController());
  const externalSignal = options.signal;
  let removeExternalListener: (() => void) | undefined;
  if (externalSignal) {
    const propagate = (): void => {
      for (const controller of controllers) {
        controller.abort();
      }
    };
    if (externalSignal.aborted) {
      propagate();
    } else {
      externalSignal.addEventListener("abort", propagate, { once: true });
      removeExternalListener = () => externalSignal.removeEventListener("abort", propagate);
    }
  }

  const startedAt = Date.now();
  const racers = candidates.map((agent, index) => {
    const askOptions = optionsForAgent(options, options.perAgent, agent);
    const signal = controllers[index]?.signal;
    return createClient(agent, signal ? { ...askOptions, signal } : askOptions)
      .ask(prompt)
      .then((result) => ({ kind: "win" as const, agent, result, index }))
      .catch((error: unknown) => ({ kind: "loss" as const, agent, error, index, durationMs: Date.now() - startedAt }));
  });

  let winner: { agent: TAgentId; result: IAskResult; index: number } | undefined;
  const losers: IRaceLoser[] = [];

  try {
    while (racers.length > 0 && !winner) {
      const settled = await Promise.race(racers.map((p) => p.then((value) => ({ value, p }))));
      const remainingIndex = racers.indexOf(settled.p);
      if (remainingIndex >= 0) {
        racers.splice(remainingIndex, 1);
      }
      if (settled.value.kind === "win") {
        winner = { agent: settled.value.agent, result: settled.value.result, index: settled.value.index };
        break;
      }
      losers.push({
        agent: settled.value.agent,
        durationMs: settled.value.durationMs,
        error: settled.value.error,
      });
    }

    if (!winner) {
      throw new WireError("retry-exhausted", `All ${candidates.length} candidates lost the race`, {
        cause: losers[losers.length - 1]?.error,
      });
    }

    if (cancelLosers) {
      for (let index = 0; index < controllers.length; index += 1) {
        if (index !== winner.index) {
          controllers[index]?.abort();
        }
      }
    }

    // Drain remaining racers before returning so `losers` is final at the
    // time the caller observes it. Without this, callers reading
    // `result.losers` immediately would see an array that grows under them
    // as late settlers push in.
    const lateResults = await Promise.allSettled(racers);
    for (const settled of lateResults) {
      if (settled.status !== "fulfilled") {
        continue;
      }
      if (settled.value.kind === "loss") {
        losers.push({
          agent: settled.value.agent,
          durationMs: settled.value.durationMs,
          error: settled.value.error,
        });
      } else {
        // Second-place winner: arrived after the first winner. With
        // cancelLosers: false this is reachable (loser racers were not
        // aborted, so they may still complete successfully). Surface as
        // a loser-with-superseded-marker rather than dropping silently.
        losers.push({
          agent: settled.value.agent,
          durationMs: Date.now() - startedAt,
          error: new Error("superseded — first winner already returned"),
        });
      }
    }

    return { ...winner.result, winner: winner.agent, losers };
  } finally {
    // Always release the external-signal listener — the cancel-losers /
    // late-drain blocks above can throw, so a try/finally is the only way
    // to guarantee no leaked listener on a long-lived shared signal.
    removeExternalListener?.();
  }
};
