import { Box } from "ink";
import type { ReactNode } from "react";
import { agents, BUILT_IN_AGENT_IDS, type TAgentId, type TPermissionPolicy } from "@pivanov/agents-wire";
import { findModel } from "@app/config/models";
import { AgentPicker } from "@app/pickers/agent-picker";
import { HelpDialog } from "@app/pickers/help-dialog";
import { ModelPicker } from "@app/pickers/model-picker";
import { MultiAgentPicker } from "@app/pickers/multi-agent-picker";
import { type ISelectOption, SelectPicker } from "@app/pickers/select-picker";
import { ThemePicker } from "@app/pickers/theme-picker";
import { getStoredEffort, getStoredModel } from "@app/config/store";
import { saveStoredTheme } from "@app/theme/store";
import { isThemeId, type TThemeId } from "@app/theme/palette";
import { ThemedText as Text } from "@app/theme/themed-text";
import type { IAppController, TPlaygroundMode } from "./types";

const VALID_MODES: readonly TPlaygroundMode[] = ["ask", "stream", "session"];
const VALID_POLICIES: readonly string[] = ["auto-allow", "auto-allow-once", "auto-reject", "stream"];

const MODE_OPTIONS: readonly ISelectOption<TPlaygroundMode>[] = [
  { id: "ask", label: "ask", description: "single round-trip · streams replies live" },
  { id: "stream", label: "stream", description: "explicit streaming with tool events" },
  { id: "session", label: "session", description: "multi-turn (open via /session start)" },
];

const PERMISSION_OPTIONS: readonly ISelectOption<string>[] = [
  { id: "auto-allow", label: "auto-allow", description: "approve every tool request" },
  { id: "auto-allow-once", label: "auto-allow-once", description: "approve once per tool, prompt thereafter" },
  { id: "auto-reject", label: "auto-reject", description: "deny every tool request" },
  { id: "stream", label: "stream", description: "surface every prompt as a permission-request event" },
];

const SESSION_OPTIONS: readonly ISelectOption<"start" | "close">[] = [
  { id: "start", label: "start", description: "open a multi-turn session for the current agent" },
  { id: "close", label: "close", description: "close the open session (if any)" },
];

const BUDGET_OPTIONS: readonly ISelectOption<string>[] = [
  { id: "0.10", label: "$0.10", description: "tight cap - quick smoke test" },
  { id: "0.50", label: "$0.50", description: "low budget" },
  { id: "2.00", label: "$2.00", description: "default playground budget" },
  { id: "10.00", label: "$10.00", description: "extended exploration" },
  { id: "off", label: "off", description: "no cap - billing applies" },
];

const POOL_OPTIONS: readonly ISelectOption<string>[] = [
  { id: "1", label: "1 worker", description: "warm a single subprocess" },
  { id: "2", label: "2 workers", description: "small parallel pool" },
  { id: "4", label: "4 workers", description: "moderate parallel pool" },
  { id: "8", label: "8 workers", description: "high concurrency" },
  { id: "status", label: "status", description: "show current pool state" },
  { id: "close", label: "close", description: "tear down the open pool" },
];

const openSelector = <T extends string>(
  app: IAppController,
  args: {
    readonly title: string;
    readonly subtitle?: string;
    readonly options: readonly ISelectOption<T>[];
    readonly current?: T;
    readonly onPick: (id: T) => void | Promise<void>;
  },
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const node: ReactNode = (
      <SelectPicker<T>
        title={args.title}
        {...(args.subtitle !== undefined ? { subtitle: args.subtitle } : {})}
        options={args.options}
        {...(args.current !== undefined ? { current: args.current } : {})}
        onResolve={(picked) => {
          app.closeDialog();
          if (picked !== undefined) {
            void Promise.resolve(args.onPick(picked)).then(resolve, reject);
            return;
          }
          resolve();
        }}
      />
    );
    app.showDialog(node);
  });

interface IParsedAgentsAndPrompt {
  readonly ids: readonly TAgentId[];
  readonly prompt: string;
}

const parseIdsAndPrompt = (raw: string): IParsedAgentsAndPrompt => {
  const trimmed = raw.trim();
  const firstSpace = trimmed.indexOf(" ");
  const idsPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const promptPart = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const ids = idsPart
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { ids, prompt: promptPart };
};

const ensureKnownAgents = (ids: readonly string[]): readonly TAgentId[] => {
  for (const id of ids) {
    if (!(BUILT_IN_AGENT_IDS as readonly string[]).includes(id)) {
      throw new Error(`unknown agent "${id}". built-ins: ${BUILT_IN_AGENT_IDS.join(", ")}`);
    }
  }
  return ids as readonly TAgentId[];
};

interface IHandler {
  (app: IAppController, args: string): void | Promise<void>;
}

interface IPickedModel {
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

// Open the ModelPicker for a given agent. Returns the user's pick
// (model + optional effort), or undefined if they pressed Esc. Does
// NOT commit — caller decides what to do with the result. This lets
// the `/agent` flow stage agent + model atomically: nothing is
// applied until the user finishes both stages.
const openModelPicker = (
  app: IAppController,
  agent: TAgentId,
  current: { model?: string | undefined; effort?: string | undefined } = {},
): Promise<IPickedModel | undefined> =>
  new Promise<IPickedModel | undefined>((resolve) => {
    const node: ReactNode = (
      <ModelPicker
        agent={agent}
        {...(current.model !== undefined ? { currentModel: current.model } : {})}
        {...(current.effort !== undefined ? { currentEffort: current.effort } : {})}
        onResolve={(picked) => {
          app.closeDialog();
          resolve(picked);
        }}
      />
    );
    app.showDialog(node);
  });

const pickAgent = (app: IAppController, highlight?: TAgentId): Promise<TAgentId | undefined> => {
  return new Promise<TAgentId | undefined>((resolve) => {
    const node: ReactNode = (
      <AgentPicker
        current={highlight ?? app.getState().agent}
        onResolve={(picked) => {
          app.closeDialog();
          resolve(picked);
        }}
      />
    );
    app.showDialog(node);
  });
};

const handleAgent: IHandler = async (app, args) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    // Two-stage atomic flow: pick agent, then pick model. Nothing is
    // committed until both are chosen. Esc on the model picker bounces
    // back to the agent picker (re-highlighting whichever agent the
    // user was about to pick) so they can change their mind without
    // having to re-enter `/agent`. Esc on the agent picker exits.
    let highlight: TAgentId | undefined;
    while (true) {
      const pickedAgent = await pickAgent(app, highlight);
      if (pickedAgent === undefined) {
        return;
      }
      const pickedModel = await openModelPicker(app, pickedAgent, {
        model: getStoredModel(pickedAgent),
        effort: getStoredEffort(pickedAgent),
      });
      if (pickedModel === undefined) {
        // Bounce back to agent picker, remembering this row.
        highlight = pickedAgent;
        continue;
      }
      // Commit both atomically. setAgent first so setModel writes the
      // model under the right per-agent slot in the persisted config.
      app.setAgent(pickedAgent);
      app.setModel(pickedModel.model, pickedModel.effort);
      const modelLabel = pickedModel.model ?? "default";
      const effortLabel = pickedModel.effort ? ` · ${pickedModel.effort} effort` : "";
      app.emit({ kind: "info", text: `agent → ${pickedAgent} · model → ${modelLabel}${effortLabel}` });
      return;
    }
  }
  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= BUILT_IN_AGENT_IDS.length) {
    const picked = BUILT_IN_AGENT_IDS[numeric - 1];
    if (picked) {
      app.setAgent(picked);
      app.emit({ kind: "info", text: `agent → ${picked}` });
      return;
    }
  }
  const [validated] = ensureKnownAgents([trimmed]);
  if (validated) {
    app.setAgent(validated);
    app.emit({ kind: "info", text: `agent → ${validated}` });
  }
};

const applyMode = async (app: IAppController, mode: TPlaygroundMode): Promise<void> => {
  const state = app.getState();
  if (mode === "session") {
    if (state.session) {
      app.setMode("session");
      app.emit({ kind: "info", text: `mode → session · existing ${state.session.sessionId.slice(0, 8)}` });
      return;
    }
    await app.openSession();
    const reopened = app.getState().session;
    if (reopened) {
      app.emit({ kind: "info", text: `mode → session · opened ${reopened.sessionId.slice(0, 8)}` });
    } else {
      app.emit({ kind: "info", text: `mode → session` });
    }
    return;
  }
  if (state.session) {
    await app.closeSession();
    app.emit({ kind: "info", text: "session closed" });
  }
  app.setMode(mode);
  app.emit({ kind: "info", text: `mode → ${mode}` });
};

const handleMode: IHandler = (app, args) => {
  const trimmed = args.trim() as TPlaygroundMode;
  if (trimmed.length === 0) {
    return openSelector<TPlaygroundMode>(app, {
      title: "Mode",
      options: MODE_OPTIONS,
      current: app.getState().mode,
      onPick: (id) => applyMode(app, id),
    });
  }
  if (!VALID_MODES.includes(trimmed)) {
    throw new Error(`usage: /mode <${VALID_MODES.join("|")}>`);
  }
  return applyMode(app, trimmed);
};

const applyPermission = (app: IAppController, value: string): void => {
  app.setPermission(value as TPermissionPolicy);
  app.emit({ kind: "info", text: `permission → ${value}` });
};

const handlePermission: IHandler = (app, args) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    const cur = app.getState().permission;
    const currentId = typeof cur === "string" ? cur : undefined;
    return openSelector<string>(app, {
      title: "Permission policy",
      options: PERMISSION_OPTIONS,
      ...(currentId !== undefined ? { current: currentId } : {}),
      onPick: (id) => applyPermission(app, id),
    });
  }
  if (!VALID_POLICIES.includes(trimmed)) {
    throw new Error(`usage: /permission <${VALID_POLICIES.join("|")}>`);
  }
  applyPermission(app, trimmed);
};

const applyBudget = (app: IAppController, raw: string): void => {
  if (raw === "off") {
    app.setBudget(undefined);
    app.emit({ kind: "info", text: "budget → off" });
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("usage: /budget <usd> | /budget off");
  }
  app.setBudget(value);
  app.emit({ kind: "info", text: `budget → $${value.toFixed(2)}` });
};

const handleBudget: IHandler = (app, args) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    const cur = app.getState().budget;
    const currentId = cur === undefined ? "off" : cur.toFixed(2);
    return openSelector<string>(app, {
      title: "Budget",
      subtitle: "max cost across all turns this session",
      options: BUDGET_OPTIONS,
      current: currentId,
      onPick: (id) => applyBudget(app, id),
    });
  }
  applyBudget(app, trimmed);
};

const handleDetect: IHandler = async (app) => {
  app.emit({ kind: "info", text: "detecting installed agents…" });
  const entries = await agents.detect();
  for (const entry of entries) {
    const status = entry.available ? "✓" : "✗";
    const tail = entry.reason ? `  (${entry.reason})` : "";
    app.emit({ kind: "info", text: `${status} ${entry.id.padEnd(10)} ${entry.label}${tail}` });
  }
};

const handleReset: IHandler = (app) => {
  app.resetCost();
  app.emit({ kind: "info", text: "cost tracker reset" });
};

const handleTheme: IHandler = (app) => {
  return new Promise<void>((resolve) => {
    const node: ReactNode = (
      <ThemePicker
        onResolve={(saved) => {
          app.closeDialog();
          if (saved && isThemeId(saved)) {
            app.setTheme(saved as TThemeId);
            saveStoredTheme(saved as TThemeId);
            app.emit({ kind: "info", text: `theme → ${saved}` });
          }
          resolve();
        }}
      />
    );
    app.showDialog(node);
  });
};

const runOrchestrated = async (
  app: IAppController,
  kind: "race" | "failover" | "cascade",
  rawIds: readonly string[],
  prompt: string,
): Promise<void> => {
  const ids = ensureKnownAgents(rawIds);
  if (ids.length === 0) {
    throw new Error(`/${kind}: no agents selected`);
  }
  if (prompt.length === 0) {
    throw new Error(`/${kind}: prompt is empty`);
  }
  const { permission, budget } = app.getState();
  const baseOptions = {
    permission,
    ...(budget !== undefined ? { maxCostUsd: budget } : {}),
  };
  app.emit({ kind: "user-input", text: `[${kind}] ${ids.join(", ")} :: ${prompt}` });
  const startedAt = Date.now();
  try {
    if (kind === "race") {
      const result = await agents.race(prompt, ids, baseOptions);
      app.emit({ kind: "text-delta", text: result.text });
      app.emit({ kind: "turn-ended", meta: `race won by ${result.winner} in ${((Date.now() - startedAt) / 1000).toFixed(2)}s` });
    } else if (kind === "failover") {
      const result = await agents.failover(prompt, ids, { ...baseOptions, shouldRetry: () => true });
      app.emit({ kind: "text-delta", text: result.text });
      app.emit({
        kind: "turn-ended",
        meta: `failover won by ${result.winner} after ${result.attempted.length} attempt(s) in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      });
    } else {
      const stages = ids.map((agentId, index) => ({
        agent: agentId,
        ...(index < ids.length - 1 ? { accept: (r: { text: string }) => r.text.trim().length > 0 } : {}),
      }));
      const result = await agents.cascade(prompt, stages, baseOptions);
      app.emit({ kind: "text-delta", text: result.text });
      app.emit({
        kind: "turn-ended",
        meta: `cascade won at stage ${result.winningStageIndex} (${result.winningAgent}) in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      });
    }
  } catch (cause) {
    app.emit({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
  }
};

// Open the multi-agent picker for orchestration commands. On confirm
// (Enter with one or more rows toggled), seed the prompt input with
// the picker's command form so the user just types the message:
//   `/failover claude,codex `
// This sidesteps the previous comma-separated string parsing UX -
// users now select agents from a list with a live API-shape preview.
const openMultiAgentPicker = (app: IAppController, kind: "race" | "failover" | "cascade"): Promise<readonly TAgentId[] | undefined> =>
  new Promise<readonly TAgentId[] | undefined>((resolve) => {
    const node: ReactNode = (
      <MultiAgentPicker
        kind={kind}
        onResolve={(picked) => {
          app.closeDialog();
          resolve(picked);
        }}
      />
    );
    app.showDialog(node);
  });

const orchestrationHandler =
  (kind: "race" | "failover" | "cascade"): IHandler =>
  async (app, args) => {
    const trimmed = args.trim();
    // Path A: user typed `/<kind> <prompt>` directly (rare power-user
    // shortcut). Pick agents via the multi-picker, then run with the
    // already-typed prompt.
    if (trimmed.length > 0) {
      const parsed = parseIdsAndPrompt(trimmed);
      // Legacy compat: `/<kind> claude,codex hello world` still works.
      if (parsed.ids.length > 0 && parsed.prompt.length > 0) {
        await runOrchestrated(app, kind, parsed.ids, parsed.prompt);
        return;
      }
      // No ids in the input - open the picker, then run with the typed prompt.
      const picked = await openMultiAgentPicker(app, kind);
      if (!picked || picked.length === 0) {
        return;
      }
      await runOrchestrated(app, kind, picked, trimmed);
      return;
    }
    // Path B: no args. Open picker, then seed the input with
    // `/<kind> <ids> ` so the user just types the prompt.
    const picked = await openMultiAgentPicker(app, kind);
    if (!picked || picked.length === 0) {
      return;
    }
    app.setInputDraft(`/${kind} ${picked.join(",")} `);
  };

const handleRace = orchestrationHandler("race");
const handleFailover = orchestrationHandler("failover");
const handleCascade = orchestrationHandler("cascade");

const printPoolStatus = (app: IAppController): void => {
  const state = app.getState();
  if (state.pool) {
    const snap = state.pool.cost.snapshot;
    app.emit({ kind: "info", text: `pool open · ${state.pool.size} workers · turns=${snap.turns} · cost=$${snap.totalUsd.toFixed(4)}` });
  } else {
    app.emit({ kind: "info", text: "no pool open" });
  }
};

const applyPool = async (app: IAppController, raw: string): Promise<void> => {
  if (raw === "status") {
    printPoolStatus(app);
    return;
  }
  if (raw === "close") {
    const state = app.getState();
    if (state.pool) {
      await app.closePool();
      app.emit({ kind: "info", text: "pool closed" });
    } else {
      app.emit({ kind: "info", text: "no pool open" });
    }
    return;
  }
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 1) {
    throw new Error("usage: /pool <n> | /pool close | /pool status");
  }
  await app.openPool(size);
  app.emit({ kind: "info", text: `pool opened: ${size} workers of ${app.getState().agent}` });
};

const handlePool: IHandler = (app, args) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    const cur = app.getState().pool;
    const currentId = cur ? String(cur.size) : "status";
    return openSelector<string>(app, {
      title: "Pool",
      subtitle: cur ? `currently ${cur.size} worker${cur.size === 1 ? "" : "s"}` : "warm parallel workers for the current agent",
      options: POOL_OPTIONS,
      current: currentId,
      onPick: (id) => applyPool(app, id),
    });
  }
  return applyPool(app, trimmed);
};

const applySession = async (app: IAppController, action: "start" | "close"): Promise<void> => {
  const state = app.getState();
  if (action === "close") {
    if (state.session) {
      await app.closeSession();
      app.emit({ kind: "info", text: "session closed" });
    } else {
      app.emit({ kind: "info", text: "no session open" });
    }
    return;
  }
  if (state.session) {
    app.emit({ kind: "info", text: `session already open · ${state.session.sessionId}` });
    return;
  }
  await app.openSession();
  const reopened = app.getState().session;
  if (reopened) {
    app.emit({ kind: "info", text: `session opened · ${reopened.sessionId.slice(0, 8)}` });
  }
};

const handleSession: IHandler = (app, args) => {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    const cur = app.getState().session;
    return openSelector<"start" | "close">(app, {
      title: "Session",
      subtitle: cur ? `open · ${cur.sessionId.slice(0, 8)}` : "no session open",
      options: SESSION_OPTIONS,
      current: cur ? "start" : "start",
      onPick: (id) => applySession(app, id),
    });
  }
  if (trimmed === "start" || trimmed === "close") {
    return applySession(app, trimmed);
  }
  throw new Error("usage: /session [start|close]");
};

const handleClear: IHandler = (app) => {
  app.clearLog();
};

const handleHelp: IHandler = (app) => {
  return new Promise<void>((resolve) => {
    const node: ReactNode = (
      <Box flexDirection="column">
        <HelpDialog
          onClose={() => {
            app.closeDialog();
            resolve();
          }}
        />
        <Text> </Text>
      </Box>
    );
    app.showDialog(node);
  });
};

const handleQuit: IHandler = (app) => {
  app.exit();
};

const HANDLERS: Readonly<Record<string, IHandler>> = {
  agent: handleAgent,
  mode: handleMode,
  permission: handlePermission,
  budget: handleBudget,
  detect: handleDetect,
  reset: handleReset,
  theme: handleTheme,
  race: handleRace,
  failover: handleFailover,
  cascade: handleCascade,
  pool: handlePool,
  session: handleSession,
  clear: handleClear,
  help: handleHelp,
  quit: handleQuit,
  exit: handleQuit,
};

export const dispatchCommand = async (app: IAppController, name: string, args: string): Promise<void> => {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new Error(`unknown command: /${name}`);
  }
  await handler(app, args);
};
