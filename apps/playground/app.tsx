import { Box, useApp, useStdin, useStdout } from "ink";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agents,
  createCostTracker,
  type IAgentPool,
  type IAgentSession,
  type ICostTracker,
  isKnownError,
  type TAgentEvent,
  type TAgentId,
  type TPermissionPolicy,
} from "@pivanov/agents-wire";
import { createMockAgent, type IMockSession } from "@pivanov/agents-wire/testing";
import { Footer } from "@app/components/footer";
import { FileOverlay } from "@app/components/file-overlay";
import { readClipboardImage } from "@app/components/clipboard-image";
import { extractImagePaths } from "@app/components/image-paste";
import { PromptBox, type TPasteResult } from "@app/components/prompt-box";
import { Spinner } from "@app/components/spinner";
import { useStableInput } from "@app/components/use-stable-input";
import { useTerminalRawMode } from "@app/components/use-terminal-raw-mode";
import { PromptInputHelpMenu } from "@app/components/prompt-input-help-menu";
import { SlashOverlay } from "@app/components/slash-overlay";
import { useFileMatches } from "@app/components/use-file-matches";
import { type ITranscriptHandle, Transcript, type TTranscriptEvent } from "@app/components/transcript";
import { POINTER } from "@app/components/figures";
import { preloadDetections, useDetections } from "@app/components/use-detections";
import { COMMANDS, type ICommandSpec, matchCommands } from "@app/commands/registry";
import { dispatchCommand } from "@app/commands/handlers";
import type { IAppController, IAppState, TPlaygroundMode } from "@app/commands/types";
import { useThemeControl } from "@app/theme/context";
import type { TThemeId } from "@app/theme/palette";
import { ThemedText as Text } from "@app/theme/themed-text";
import {
  getStoredEffort,
  getStoredModel,
  isPermissionSerializable,
  loadConfig,
  saveConfig,
  setStoredEffort,
  setStoredModel,
} from "@app/config/store";
import { effortConfigIdForAgent } from "@app/config/models";

interface IExitMessage {
  readonly show: boolean;
  readonly key?: string;
}

interface IProps {
  readonly initialAgent?: TAgentId;
  readonly initialMode?: TPlaygroundMode;
  readonly initialPermission?: TPermissionPolicy;
  readonly initialBudget?: number;
}

const stableTracker = (budget: number | undefined): ICostTracker => {
  return createCostTracker(budget !== undefined ? { budgetUsd: budget } : {});
};

const EMPTY_MATCHES: readonly ICommandSpec[] = [];

// Match the trailing `@<frag>` token (preceded by start-of-string or
// whitespace). This is what triggers file typeahead - anything else is
// just text.
const FILE_TOKEN_RE = /(^|\s)@([^\s@]*)$/;

interface IFileToken {
  readonly start: number;
  readonly query: string;
}

const parseFileToken = (val: string): IFileToken | null => {
  const m = FILE_TOKEN_RE.exec(val);
  if (m === null) {
    return null;
  }
  const at = m.index + (m[1] ?? "").length;
  return { start: at, query: m[2] ?? "" };
};

const useColumns = (): number => {
  const { stdout } = useStdout();
  // No resize subscription. Ink listens to `stdout.on("resize")`
  // internally and re-renders the entire tree when columns change -
  // adding our own subscription on top of that produced *two* renders
  // per resize event, which doubled the chance of Ink's cursor-up
  // math racing with the new layout and leaving orphan frames.
  // Reading stdout.columns directly each render gives us the
  // up-to-date value without driving a separate re-render cycle.
  return stdout?.columns ?? 80;
};

const summarizeTool = (input: unknown): string => {
  if (input === null || input === undefined) {
    return "";
  }
  if (typeof input === "string") {
    return input.length > 80 ? `${input.slice(0, 79)}…` : input;
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const candidates: unknown[] = [
      obj.path,
      obj.file,
      obj.file_path,
      obj.filePath,
      obj.target,
      obj.abs_path,
      obj.absPath,
      obj.command,
      obj.cmd,
      obj.query,
      obj.pattern,
      obj.glob,
      obj.globPattern,
      obj.url,
      obj.description,
      obj.name,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) {
        const firstLine = c.includes("\n") ? c.slice(0, c.indexOf("\n")) : c;
        return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
      }
    }
    if (Array.isArray(obj.paths) && obj.paths.length > 0 && typeof obj.paths[0] === "string") {
      return (obj.paths as string[]).join(", ").slice(0, 80);
    }
  }
  return "";
};

const mapToolStatus = (status: string | undefined): "ok" | "error" | "unknown" => {
  if (status === "completed" || status === "success") {
    return "ok";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  return "unknown";
};

export const App = (props: IProps) => {
  const { initialAgent = "claude", initialMode = "ask", initialPermission = "auto-allow", initialBudget = 2 } = props;

  const ink = useApp();
  const cols = useColumns();
  const { stdout } = useStdout();
  const { isRawModeSupported: _isRawModeSupported } = useStdin();
  // Owns terminal raw mode + extended-key escape sequences for the
  // session lifetime. Hoisted out of PromptBox so the escapes don't
  // re-emit on every dialog open/close cycle (which would bypass
  // Ink's stdout tracking and leave orphan PromptBox frames stacked).
  useTerminalRawMode();
  const { committedId, setTheme: setThemeContext } = useThemeControl();

  // Hydrate from ~/.agents-wire/config.json on first render. Props win
  // over persisted values when both exist (props are typically explicit
  // CLI flags, persisted is "what I picked last time").
  const persisted = useRef<ReturnType<typeof loadConfig>>(loadConfig());
  const persistedAgent = persisted.current.agent ?? initialAgent;
  const persistedMode = persisted.current.mode ?? initialMode;
  const persistedPermission =
    typeof persisted.current.permission === "string" ? (persisted.current.permission as TPermissionPolicy) : initialPermission;
  const persistedBudget = persisted.current.budget === "off" ? undefined : persisted.current.budget ?? initialBudget;
  const persistedMock = persisted.current.mock ?? false;

  const [agent, setAgentState] = useState<TAgentId>(persistedAgent);
  const [mode, setModeState] = useState<TPlaygroundMode>(persistedMode);
  const [permission, setPermissionState] = useState<TPermissionPolicy>(persistedPermission);
  const [budget, setBudgetState] = useState<number | undefined>(persistedBudget);
  const [costTracker, setCostTracker] = useState<ICostTracker>(() => stableTracker(persistedBudget));
  const [costSnap, setCostSnap] = useState(() => costTracker.snapshot);
  const [session, setSession] = useState<IAgentSession | undefined>(undefined);
  const [pool, setPool] = useState<IAgentPool | undefined>(undefined);
  const [mock, setMockState] = useState(persistedMock);
  const [model, setModelState] = useState<string | undefined>(getStoredModel(persistedAgent));
  const [effort, setEffortState] = useState<string | undefined>(getStoredEffort(persistedAgent));
  const mockSessionRef = useRef<IMockSession | undefined>(undefined);

  // Persisting wrappers - write through to config.json on every set so
  // restart restores the user's last picks. Theme is handled by its own
  // ThemeProvider onCommit hook (already saves to the same config file).
  const setAgent = useCallback((id: TAgentId): void => {
    setAgentState(id);
    setModelState(getStoredModel(id));
    setEffortState(getStoredEffort(id));
    saveConfig({ agent: id });
  }, []);
  const setMode = useCallback((m: TPlaygroundMode): void => {
    setModeState(m);
    saveConfig({ mode: m });
  }, []);
  const setPermission = useCallback((p: TPermissionPolicy): void => {
    setPermissionState(p);
    if (isPermissionSerializable(p) && typeof p === "string") {
      saveConfig({ permission: p });
    }
  }, []);
  const setMock = useCallback((m: boolean): void => {
    setMockState(m);
    saveConfig({ mock: m });
  }, []);

  const [inputValue, setInputValue] = useState<string>("");
  const [slashIndex, setSlashIndex] = useState<number>(0);
  const [fileIndex, setFileIndex] = useState<number>(0);
  const [dialog, setDialog] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState<"idle" | "loading" | "cancelling">("idle");
  const [exitMessage, setExitMessage] = useState<IExitMessage>({ show: false });
  const [unknownCommand, setUnknownCommand] = useState<string | null>(null);
  // Counter threaded to <Mascot> via Footer. Increments on every user
  // submit so the owl variant swaps and the gradient angle rotates by
  // +90° each turn.
  const [mascotBumpKey, setMascotBumpKey] = useState<number>(0);

  const transcriptHandle = useRef<ITranscriptHandle | null>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const fileToken = useMemo<IFileToken | null>(
    () => (busy !== "loading" && dialog === null ? parseFileToken(inputValue) : null),
    [busy, dialog, inputValue],
  );
  const fileActive = fileToken !== null;

  const slashActive = !fileActive && inputValue.startsWith("/") && busy !== "loading" && dialog === null;
  const slashMatches = useMemo<readonly ICommandSpec[]>(
    () => (slashActive ? matchCommands(inputValue) : EMPTY_MATCHES),
    [slashActive, inputValue],
  );
  const safeSlashIndex = slashMatches.length === 0 ? 0 : Math.min(slashIndex, slashMatches.length - 1);

  const { matches: fileMatches } = useFileMatches(fileActive, fileToken?.query ?? "", process.cwd());
  const safeFileIndex = fileMatches.length === 0 ? 0 : Math.min(fileIndex, fileMatches.length - 1);

  const stateRef = useRef<IAppState>({} as IAppState);
  stateRef.current = {
    agent,
    mode,
    permission,
    budget,
    cost: costTracker,
    session,
    pool,
    mock,
    themeId: committedId,
    model,
    effort,
  };

  const emit = useCallback((event: TTranscriptEvent): void => {
    transcriptHandle.current?.emit(event);
  }, []);

  const recordCost = useCallback(
    (event: Extract<TAgentEvent, { type: "usage" }>, agentId: TAgentId): void => {
      costTracker.record(event.usage, agentId);
      setCostSnap(costTracker.snapshot);
    },
    [costTracker],
  );

  // Plain show/close - no version ref or microtask deferral. The
  // earlier deferral was added to avoid a one-frame flash of
  // `dialog === null` between `/agent` → ModelPicker swaps. With the
  // single-dynamic-frame transcript (no <Static>) Ink's cursor math
  // is stable enough that a brief flicker is preferable to fighting
  // React/Ink scheduling.
  const showDialog = useCallback((node: ReactNode): void => setDialog(node), []);
  const closeDialog = useCallback((): void => setDialog(null), []);

  const resetCost = useCallback((): void => {
    const next = stableTracker(budget);
    setCostTracker(next);
    setCostSnap(next.snapshot);
  }, [budget]);

  const clearTranscript = useCallback((): void => {
    // Wipe the terminal too, not just React state. Frozen rows already
    // emitted via <Static> live in real terminal scrollback - clearing
    // the array doesn't unwrite them. The ANSI sequence here clears
    // the visible screen (\x1b[2J), the scrollback buffer (\x1b[3J),
    // and homes the cursor (\x1b[H). Ink's next render paints from
    // the top of the now-empty buffer.
    stdout.write("\x1b[2J\x1b[3J\x1b[H");
    emit({ kind: "reset" });
  }, [emit, stdout]);

  const exit = useCallback((): void => {
    ink.exit();
  }, [ink]);

  useEffect(() => {
    if (mock) {
      mockSessionRef.current = createMockAgent({ defaultText: "[mock reply]", agent });
    } else {
      mockSessionRef.current = undefined;
    }
  }, [mock, agent]);

  // Warm the agent-detection cache in the background so /agent opens
  // without the spawn-each-binary flicker. Idempotent - safe to call
  // multiple times; only the first triggers actual probing.
  useEffect(() => {
    preloadDetections();
  }, []);

  // One-shot welcome line. Emits an `info` row that lands in the
  // transcript's <Static> frozen array (stays in scrollback, no
  // re-renders). The Transcript child's useEffect that sets
  // `transcriptHandle.current` fires before this parent effect, so
  // the handle is guaranteed to be ready.
  const greetedRef = useRef<boolean>(false);
  useEffect(() => {
    if (greetedRef.current) {
      return;
    }
    greetedRef.current = true;
    emit({
      kind: "info",
      text: "Welcome to agents-wire. Type a message · / for commands · @ for files · ? for shortcuts · Ctrl+C to exit",
    });
  }, [emit]);

  // Two-phase boot:
  //
  //   Phase 1 (gates the REPL):  agent detection — fast (~100-300ms).
  //     Just runs `--version` / package-resolve per built-in. Once
  //     this resolves, we drop the "Loading agents…" splash and the
  //     REPL is interactive.
  //
  //   Phase 2 (background, fire-and-forget):  per-agent configOptions
  //     probe via `preloadAgentConfigs`. Each probe spawns a throwaway
  //     ACP session per installed agent — ~1-4s individually, ~4s
  //     bounded in parallel. The model picker shows its own spinner
  //     (`loading agent options…`) when opened before the probe
  //     resolves, then swaps to live data when ready. Failures per
  //     agent fall back to the static-catalog placeholder.
  //
  // Splitting them this way means cold-start UX is bounded by
  // detection speed, not by the slowest ACP agent.
  const { entries: detectionEntries } = useDetections();
  // PRELOAD DISABLED FOR ORPHAN-FRAME DIAGNOSTIC.
  //
  // Background spawning of claude/codex/copilot/etc. opens ACP
  // sessions in parallel. Each session spawn writes to a piped child
  // stdio, but the ACP SDK itself emits console.error("Invalid
  // message", ...) when it can't parse certain payloads (we saw this
  // with pi). With patchConsole=false (current setting), those
  // stderr writes go directly to the terminal and corrupt Ink's
  // cursor tracking, leaving orphan frames stacked on subsequent
  // renders.
  //
  // First-open of /model for a given agent will pay the per-agent
  // probe latency (~500ms-2s) instead. If this proves to be the
  // orphan source, we can re-enable preload behind a per-agent
  // delayed schedule (e.g. only preload claude after first user
  // input) or change the SDK to route those errors via a callback
  // instead of console.error.
  const _preloadDisabledForDiagnostic = detectionEntries;
  void _preloadDisabledForDiagnostic;

  const openSession = useCallback(async (): Promise<void> => {
    if (session) {
      return;
    }
    // Model + reasoning effort are applied at session-create time -
    // they're forwarded as launch flags (codex `-c model=...`) and as
    // an ACP setSessionConfigOption("reasoning_effort"). Changing them
    // later does NOT respawn the agent; user must /session close +
    // reopen for new flags to take effect.
    const opts: {
      permission: TPermissionPolicy;
      maxCostUsd?: number;
      model?: string;
      modelPreference?: { configId: string; value: string };
    } = { permission };
    if (budget !== undefined) {
      opts.maxCostUsd = budget;
    }
    if (model !== undefined) {
      opts.model = model;
    }
    if (effort !== undefined) {
      // Echo the configId the agent declared via session.configOptions
      // (e.g. claude's "thinking_budget"). Falls back to "reasoning_effort"
      // for agents whose configOptions probe didn't yield one - covers
      // codex (whose bridge accepts -c model_reasoning_effort, surfaced
      // via launch flags) so the value is sent the same way.
      opts.modelPreference = { configId: effortConfigIdForAgent(agent) ?? "reasoning_effort", value: effort };
    }
    const next = await agents.session(agent, opts);
    setSession(next);
    setMode("session");
  }, [agent, budget, effort, model, permission, session]);

  const closeSession = useCallback(async (): Promise<void> => {
    if (!session) {
      return;
    }
    await session.close().catch(() => {});
    setSession(undefined);
  }, [session]);

  const openPool = useCallback(
    async (size: number): Promise<void> => {
      if (pool) {
        await pool.close().catch(() => {});
      }
      // Model + effort flow into the pool's worker spawn the same way
      // as a single session - all warm workers share the configured
      // model. To switch, /pool close then /pool <n> after picking a
      // new model.
      const opts: {
        agents: TAgentId[];
        capacity: number;
        permission: TPermissionPolicy;
        maxCostUsd?: number;
        model?: string;
        modelPreference?: { configId: string; value: string };
      } = {
        agents: [agent],
        capacity: size,
        permission,
      };
      if (budget !== undefined) {
        opts.maxCostUsd = budget;
      }
      if (model !== undefined) {
        opts.model = model;
      }
      if (effort !== undefined) {
        // Echo the configId the agent declared via session.configOptions
      // (e.g. claude's "thinking_budget"). Falls back to "reasoning_effort"
      // for agents whose configOptions probe didn't yield one - covers
      // codex (whose bridge accepts -c model_reasoning_effort, surfaced
      // via launch flags) so the value is sent the same way.
      opts.modelPreference = { configId: effortConfigIdForAgent(agent) ?? "reasoning_effort", value: effort };
      }
      const next = await agents.pool(opts);
      setPool(next);
    },
    [agent, budget, effort, model, permission, pool],
  );

  const closePool = useCallback(async (): Promise<void> => {
    if (!pool) {
      return;
    }
    await pool.close().catch(() => {});
    setPool(undefined);
  }, [pool]);

  const setThemeAll = useCallback(
    (id: TThemeId): void => {
      setThemeContext(id);
    },
    [setThemeContext],
  );

  const controllerRef = useRef<IAppController>({} as IAppController);
  controllerRef.current = {
    getState: () => stateRef.current,
    setAgent,
    setMode,
    setPermission,
    setBudget: (value) => {
      setBudgetState(value);
      saveConfig({ budget: value === undefined ? "off" : value });
      setCostTracker((prev) => {
        const fresh = stableTracker(value);
        const snap = prev.snapshot;
        if (snap.totalUsd > 0) {
          fresh.record({ tokensIn: snap.tokensIn, tokensOut: snap.tokensOut, costUsd: snap.totalUsd }, agent);
        }
        setCostSnap(fresh.snapshot);
        return fresh;
      });
    },
    setMock,
    setTheme: setThemeAll,
    setModel: (m, e) => {
      setModelState(m);
      setEffortState(e);
      setStoredModel(agent, m);
      setStoredEffort(agent, e);
      // Heads-up: model/effort are baked into the agent process at
      // session/pool spawn time. Toggling now affects future one-shot
      // calls but won't migrate an open session/pool to the new flags.
      if (session || pool) {
        emit({
          kind: "info",
          text: `note: ${session ? "open session" : "warm pool"} still using previous model/effort. /${session ? "session" : "pool"} close + reopen to apply.`,
        });
      }
    },
    openSession,
    closeSession,
    openPool,
    closePool,
    emit,
    clearLog: clearTranscript,
    showDialog,
    closeDialog,
    resetCost,
    setInputDraft: (text: string) => setInputValue(text),
    exit,
  };

  const runPrompt = useCallback(
    async (text: string): Promise<void> => {
      const baseAgent = stateRef.current.agent;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy("loading");
      const startedAt = Date.now();

      emit({ kind: "user-input", text });
      // Swap the mascot variant + rotate gradient on every prompt.
      setMascotBumpKey((k) => k + 1);

      try {
        if (stateRef.current.mock && mockSessionRef.current) {
          const result = await mockSessionRef.current.ask(text);
          emit({ kind: "text-delta", text: result.text });
          emit({ kind: "turn-ended", meta: `mock · ${((Date.now() - startedAt) / 1000).toFixed(2)}s` });
          return;
        }
        const opts: {
          permission: TPermissionPolicy;
          signal: AbortSignal;
          maxCostUsd?: number;
          model?: string;
          modelPreference?: { configId: string; value: string };
        } = {
          permission: stateRef.current.permission,
          signal: ctrl.signal,
        };
        if (stateRef.current.budget !== undefined) {
          opts.maxCostUsd = stateRef.current.budget;
        }
        if (stateRef.current.model !== undefined) {
          opts.model = stateRef.current.model;
        }
        if (stateRef.current.effort !== undefined) {
          opts.modelPreference = {
            configId: effortConfigIdForAgent(baseAgent) ?? "reasoning_effort",
            value: stateRef.current.effort,
          };
        }

        if (stateRef.current.pool) {
          const result = await stateRef.current.pool.ask(text);
          if (result.cost) {
            costTracker.record({ tokensIn: 0, tokensOut: 0, costUsd: result.cost.totalUsd }, baseAgent);
            setCostSnap(costTracker.snapshot);
          }
          emit({ kind: "text-delta", text: result.text });
          const costMeta = result.cost && result.cost.totalUsd > 0 ? ` · $${result.cost.totalUsd.toFixed(4)}` : "";
          emit({
            kind: "turn-ended",
            meta: `${result.worker}${costMeta} · ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
          });
          return;
        }

        const stream = stateRef.current.session
          ? stateRef.current.session.stream(text, { signal: ctrl.signal })
          : agents.stream(baseAgent, text, opts);
        const tag = stateRef.current.session ? "session · " : "";
        for await (const event of stream) {
          if (event.type === "text-delta") {
            emit({ kind: "text-delta", text: event.text });
            continue;
          }
          if (event.type === "thinking-delta") {
            emit({ kind: "thinking-delta", text: event.text });
            continue;
          }
          if (event.type === "tool-call") {
            emit({
              kind: "tool-call-started",
              id: event.toolCallId,
              name: event.tool,
              summary: summarizeTool(event.input),
              input: event.input,
              ...(event.locations ? { locations: event.locations } : {}),
            });
            continue;
          }
          if (event.type === "tool-call-update") {
            const status = mapToolStatus(event.status);
            if (status !== "unknown") {
              emit({ kind: "tool-call-completed", id: event.toolCallId, status, output: event.output });
            }
            continue;
          }
          if (event.type === "usage") {
            recordCost(event, baseAgent);
            continue;
          }
        }
        const result = await stream.result();
        if (result.cost && result.cost.totalUsd > 0) {
          costTracker.record({ tokensIn: 0, tokensOut: 0, costUsd: result.cost.totalUsd }, baseAgent);
          setCostSnap(costTracker.snapshot);
        }
        const costMeta = result.cost && result.cost.totalUsd > 0 ? `$${result.cost.totalUsd.toFixed(4)} · ` : "";
        emit({
          kind: "turn-ended",
          meta: `${tag}${costMeta}${((Date.now() - startedAt) / 1000).toFixed(2)}s · stop=${result.stopReason}`,
        });
      } catch (cause) {
        const message = isKnownError(cause)
          ? `${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : String(cause);
        emit({ kind: "error", message });
      } finally {
        abortRef.current = undefined;
        setBusy("idle");
      }
    },
    [costTracker, emit, recordCost],
  );

  const onSubmit = useCallback(
    async (raw: string): Promise<void> => {
      const value = raw.trim();
      if (value.length === 0) {
        return;
      }

      if (value.startsWith("/")) {
        const parts = value.slice(1).split(/\s+/);
        const bare = parts[0] ?? "";
        const args = parts.slice(1).join(" ");
        const exact = COMMANDS.find((c) => c.name === bare.toLowerCase());
        setInputValue("");
        setSlashIndex(0);
        if (!exact) {
          setUnknownCommand(`/${bare}`);
          return;
        }
        setUnknownCommand(null);
        try {
          await dispatchCommand(controllerRef.current, exact.name, args);
        } catch (cause) {
          emit({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
        }
        return;
      }

      if (busy === "loading") {
        return;
      }
      setInputValue("");
      setSlashIndex(0);
      setUnknownCommand(null);
      await runPrompt(value);
    },
    [busy, emit, runPrompt],
  );

  const onCancel = useCallback((): void => {
    if (dialog !== null) {
      closeDialog();
      return;
    }
    if (busy === "loading" && abortRef.current) {
      setBusy("cancelling");
      abortRef.current.abort();
      // Visible acknowledgement that the interrupt was received. ACP
      // cancellation can take 100ms-1s to actually unwind the agent -
      // without this the user sees buffered text-deltas keep arriving
      // and assumes Esc was ignored.
      emit({ kind: "info", text: "interrupting… (Esc again to force)" });
      return;
    }
    if (busy === "cancelling") {
      // Force path: cancellation is hung (agent didn't ack acp.cancel,
      // or the for-await-of in runPrompt is waiting on a queue that
      // will never end). Reset playground state so the user can keep
      // working - a stale agent may still be running in the background
      // until the next prompt or close.
      abortRef.current = undefined;
      setBusy("idle");
      emit({ kind: "error", message: "force-cancelled (agent may still be running)" });
    }
  }, [busy, closeDialog, dialog, emit]);

  // While a dialog (picker / help / etc.) is mounted, PromptBox is
  // unmounted so its raw-stdin parser is gone. Pickers use Ink's
  // useInput which respects `exitOnCtrlC: false` and ignores Ctrl+C
  // entirely. Catch Ctrl+C here so the user can always close a picker
  // (or trigger the standard cancel/exit flow) regardless of state.
  useStableInput(
    (input, key) => {
      if (key.ctrl && (input === "c" || input === "")) {
        onCancel();
      }
    },
    { isActive: dialog !== null },
  );

  const onPromptChange = useCallback((next: string): void => {
    setInputValue(next);
    setSlashIndex(0);
    setFileIndex(0);
    setUnknownCommand(null);
  }, []);

  const onSlashNavigate = useCallback(
    (dir: -1 | 1): boolean => {
      if (slashMatches.length === 0) {
        return false;
      }
      setSlashIndex((cur) => {
        const next = cur + dir;
        if (next < 0) {
          return slashMatches.length - 1;
        }
        if (next >= slashMatches.length) {
          return 0;
        }
        return next;
      });
      return true;
    },
    [slashMatches],
  );

  const onSlashComplete = useCallback((): void => {
    if (slashMatches.length === 0) {
      return;
    }
    const selected = slashMatches[safeSlashIndex];
    if (!selected) {
      return;
    }
    const trailing = selected.requiresArgs ? " " : "";
    setInputValue(`/${selected.name}${trailing}`);
    setSlashIndex(0);
  }, [slashMatches, safeSlashIndex]);

  const completeFileMatch = useCallback((): void => {
    if (!fileActive || fileToken === null || fileMatches.length === 0) {
      return;
    }
    const picked = fileMatches[safeFileIndex];
    if (picked === undefined) {
      return;
    }
    const before = inputValue.slice(0, fileToken.start);
    const tail = inputValue.slice(fileToken.start + 1 + fileToken.query.length);
    // Always end the token with a space so the @-overlay closes after
    // picking, even when the picked match string equals the current query
    // exactly (otherwise the inputValue is unchanged and the overlay
    // stays open forever).
    const trailing = tail.startsWith(" ") ? "" : " ";
    const next = `${before}@${picked}${trailing}${tail}`;
    setInputValue(next);
    setFileIndex(0);
  }, [fileActive, fileToken, fileMatches, safeFileIndex, inputValue]);

  const onAtNavigate = useCallback(
    (dir: -1 | 1): boolean => {
      if (!fileActive || fileMatches.length === 0) {
        return false;
      }
      setFileIndex((cur) => {
        const next = cur + dir;
        if (next < 0) {
          return fileMatches.length - 1;
        }
        if (next >= fileMatches.length) {
          return 0;
        }
        return next;
      });
      return true;
    },
    [fileActive, fileMatches],
  );

  const onAtComplete = useCallback((): void => {
    if (fileActive) {
      completeFileMatch();
    }
  }, [fileActive, completeFileMatch]);

  const onAtSubmit = useCallback((): string | null => {
    if (!fileActive || fileMatches.length === 0) {
      return null;
    }
    completeFileMatch();
    // Don't submit the prompt yet - Enter on the file overlay completes
    // the path and leaves the prompt for the user to keep typing.
    return "";
  }, [fileActive, fileMatches, completeFileMatch]);

  const transformPaste = useCallback(async (text: string): Promise<TPasteResult> => {
    if (text.length === 0) {
      const path = await readClipboardImage();
      if (path !== null) {
        return { kind: "images", paths: [path] };
      }
      return { kind: "text", text: "(no image on clipboard)" };
    }
    const paths = extractImagePaths(text);
    if (paths.length === 0) {
      return { kind: "text", text };
    }
    return { kind: "images", paths };
  }, []);

  const onSlashSubmit = useCallback((): string | null => {
    if (slashMatches.length === 0) {
      return null;
    }
    const selected = slashMatches[safeSlashIndex];
    if (!selected) {
      return null;
    }
    if (selected.requiresArgs) {
      // Don't submit a partial command; fill it in instead.
      const filled = `/${selected.name} `;
      setInputValue(filled);
      setSlashIndex(0);
      return "";
    }
    return `/${selected.name}`;
  }, [slashMatches, safeSlashIndex]);

  useEffect(() => {
    return () => {
      if (session) {
        void session.close().catch(() => {});
      }
      if (pool) {
        void pool.close().catch(() => {});
      }
    };
  }, [pool, session]);

  const currentBucket = costSnap.byAgent[agent];
  const costInfo = {
    totalUsd: costSnap.totalUsd,
    turns: costSnap.turns,
    currentAgentTurns: currentBucket?.turns ?? 0,
    currentAgentSpent: currentBucket?.totalUsd ?? 0,
  };

  // No boot splash - render the full UI immediately even while the
  // background detection / configOptions probe are in flight. Earlier
  // versions returned a `flexDirection="row"` splash here and swapped
  // to a `flexDirection="column"` full UI when ready, but that
  // tree-shape transition broke Ink's cursor-up math and left orphan
  // frames stacked in the terminal. The agent picker handles the
  // "still detecting" state gracefully (shows "probing…" rows until
  // detections land), and the model picker has its own per-agent
  // spinner, so users see appropriate feedback wherever they look.
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Transcript cols={Math.max(20, cols - 3)} handleRef={transcriptHandle} cancelling={busy === "cancelling"} />
      </Box>
      {dialog === null ? (
        <Box paddingLeft={1}>
          <PromptBox
            cols={cols}
            disabled={false}
            softDisabled={busy === "loading"}
            onSubmit={onSubmit}
            onCancel={onCancel}
            onExit={exit}
            onExitMessage={setExitMessage}
            value={inputValue}
            onChange={onPromptChange}
            onSlashNavigate={onSlashNavigate}
            onSlashComplete={onSlashComplete}
            onSlashSubmit={onSlashSubmit}
            onAtNavigate={onAtNavigate}
            onAtComplete={onAtComplete}
            onAtSubmit={onAtSubmit}
            transformPaste={transformPaste}
            placeholder="█"
          />
        </Box>
      ) : (
        <Box paddingLeft={1}>
          <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
            <Box flexShrink={0} width={2}>
              <Text color="accent">{`${POINTER} `}</Text>
            </Box>
            <Box flexShrink={0} width={1}>
              <Text bold color="accent">
                ┃
              </Text>
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              {dialog}
            </Box>
          </Box>
        </Box>
      )}
      {unknownCommand ? (
        <Box marginTop={1} paddingX={2}>
          <Text color="error">{`Unknown command: ${unknownCommand} (try /help)`}</Text>
        </Box>
      ) : null}
      <SlashOverlay matches={slashMatches} selectedIndex={safeSlashIndex} visible={slashActive} />
      <FileOverlay matches={fileMatches} selectedIndex={safeFileIndex} visible={fileActive} />
      {inputValue === "?" && dialog === null ? <PromptInputHelpMenu /> : null}
      {dialog === null && !slashActive && !fileActive && inputValue !== "?" ? (
        <Footer
          cols={cols}
          agent={agent}
          model={model}
          effort={effort}
          mode={mode}
          permission={permission}
          budget={budget}
          cost={costInfo}
          mock={mock}
          hasSession={session !== undefined}
          poolSize={pool?.size}
          state={busy}
          exitMessage={exitMessage}
          mascotBumpKey={mascotBumpKey}
        />
      ) : null}
      <Text> </Text>
    </Box>
  );
};
