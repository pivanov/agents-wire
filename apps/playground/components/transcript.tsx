import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { Box, Static, useInput, useStdin } from "ink";
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CodeBlock } from "./code-block";
import { BLACK_CIRCLE } from "./figures";
import { createPlainHyperlink } from "./hyperlink";
import { segmentMessage } from "./image-chip";
import { Markdown } from "./markdown";
import { Spinner } from "./spinner";
import { ToolUseLoader } from "./tool-use-loader";
import { ThemedBox } from "@app/theme/themed-box";
import { ThemedText as Text } from "@app/theme/themed-text";

// Streaming-text flush cadence. Higher = less terminal redraw churn,
// which matters because most terminals auto-scroll-to-bottom on output -
// every redraw fights any scroll gesture. 250ms still feels live.
const LIVE_DEBOUNCE_MS = 250;
const THINKING_LABEL = "Thinking";
const VERBOSE_HINT = "(Ctrl+O to toggle verbose)";
// Hard cap on retained committed rows so memory doesn't grow without
// bound across long sessions. Older rows fall off the top of the
// dynamic frame and are gone (no <Static> scrollback - see header below).
const MAX_COMMITTED_ROWS = 1000;

export type TToolStatus = "running" | "ok" | "error" | "unknown";

export interface IToolLocationLite {
  readonly path: string;
  readonly line?: number;
}

export type TCommittedRow =
  | { readonly id: number; readonly kind: "user"; readonly text: string }
  | { readonly id: number; readonly kind: "assistant"; readonly text: string }
  | { readonly id: number; readonly kind: "thinking-done"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "tool";
      readonly toolId: string;
      readonly name: string;
      readonly summary: string;
      readonly input: unknown;
      readonly locations: readonly IToolLocationLite[] | undefined;
    }
  | { readonly id: number; readonly kind: "info"; readonly text: string }
  | { readonly id: number; readonly kind: "error"; readonly message: string }
  | { readonly id: number; readonly kind: "turn"; readonly meta: string };

// Frozen rows are immutable history rendered via <Static>. Ink writes
// each item ONCE to stdout and never tracks/redraws it. The terminal
// owns the row from that point — resize triggers natural reflow,
// scrollback works as expected. Rows that mutate (in-flight tool
// spinner, verbose-toggle status) stay in the dynamic `committed`
// array until they finalize, then migrate here with state baked in.
type TFrozenRow =
  | { readonly id: number; readonly kind: "user"; readonly text: string }
  | { readonly id: number; readonly kind: "assistant"; readonly text: string }
  | { readonly id: number; readonly kind: "thinking-done"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "tool";
      readonly toolId: string;
      readonly name: string;
      readonly summary: string;
      readonly input: unknown;
      readonly locations: readonly IToolLocationLite[] | undefined;
      readonly bakedStatus: "ok" | "error" | "unknown";
      readonly bakedOutput?: unknown;
      readonly bakedVerbose: boolean;
    }
  | { readonly id: number; readonly kind: "info"; readonly text: string }
  | { readonly id: number; readonly kind: "error"; readonly message: string }
  | { readonly id: number; readonly kind: "turn"; readonly meta: string };

export type TTranscriptEvent =
  | { readonly kind: "user-input"; readonly text: string }
  | { readonly kind: "text-delta"; readonly text: string }
  | { readonly kind: "thinking-delta"; readonly text: string }
  | { readonly kind: "thinking-completed" }
  | {
      readonly kind: "tool-call-started";
      readonly id: string;
      readonly name: string;
      readonly summary: string;
      readonly input: unknown;
      readonly locations?: readonly IToolLocationLite[];
    }
  | { readonly kind: "tool-call-completed"; readonly id: string; readonly status: "ok" | "error" | "unknown"; readonly output?: unknown }
  | { readonly kind: "turn-ended"; readonly meta: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "info"; readonly text: string }
  | { readonly kind: "reset" };

export interface ITranscriptHandle {
  readonly emit: (event: TTranscriptEvent) => void;
}

interface IProps {
  readonly cols: number;
  readonly handleRef: { current: ITranscriptHandle | null };
  readonly cancelling?: boolean;
}

interface IFormattedDetail {
  readonly text: string;
  readonly language: string;
}

// File extension → Shiki language. Covers what Read-tool outputs
// typically contain. Anything not in this map falls back to content
// sniffing or plain text.
const EXT_TO_LANG: Readonly<Record<string, string>> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  md: "md",
  markdown: "md",
  mdx: "md",
  py: "py",
  go: "go",
  rs: "rs",
  sql: "sql",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  diff: "diff",
  patch: "diff",
};

const langFromPath = (s: string): string | undefined => {
  // Cheap path-shape check: contains a slash, or looks like a bare
  // filename with an extension. Avoids false positives on prose.
  if (!/[/\\]|^\.{1,2}\//.test(s) && !/^\w[\w.-]*\.\w+$/.test(s)) {
    return undefined;
  }
  const dot = s.lastIndexOf(".");
  if (dot < 0 || dot === s.length - 1) {
    return undefined;
  }
  const ext = s.slice(dot + 1).toLowerCase().replace(/[?#].*$/, "");
  return EXT_TO_LANG[ext];
};

// Find a language hint from a tool's metadata. Priority:
//   1. ACP `locations` (canonical structured field — what well-behaved
//      agents like Claude Code populate for read/write tools, even
//      when their `rawInput` is sparse).
//   2. Path-like strings inside `rawInput` ({path}, {filePath},
//      {abs_path}, {uri}, ...) — covers agents that don't populate
//      locations.
const guessLanguageFromTool = (
  input: unknown,
  locations?: readonly IToolLocationLite[],
): string | undefined => {
  if (locations) {
    for (const loc of locations) {
      const lang = langFromPath(loc.path);
      if (lang) {
        return lang;
      }
    }
  }
  if (input === null || input === undefined) {
    return undefined;
  }
  if (typeof input === "string") {
    return langFromPath(input);
  }
  if (typeof input !== "object") {
    return undefined;
  }
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      const lang = langFromPath(value);
      if (lang) {
        return lang;
      }
    }
  }
  return undefined;
};

// Many Read-style tools prepend "<lineNo>\t" or "<lineNo><spaces>" to
// every line (cat -n style). The original payload is then "1\t# foo\n
// 2\t\n3\t..." which defeats every sniff regex (none of them start
// with `#`). Strip the prefix per line so sniffing sees the real file.
const stripLineNumberPrefix = (text: string): string => {
  // Don't pay the cost unless the very first line looks numbered.
  if (!/^\s*\d+[ \t]+\S/.test(text)) {
    return text;
  }
  return text.replace(/^[ \t]*\d+[ \t]+/gm, "");
};

// Content sniffer for opaque tool outputs (no input hint available).
// Catches the structurally obvious cases: diff, JSON, XML/HTML,
// shebang scripts, markdown. Everything else stays plain.
const sniffLanguage = (text: string): string => {
  const stripped = stripLineNumberPrefix(text);
  const trimmed = stripped.trimStart();
  if (trimmed.length === 0) {
    return "";
  }
  const head = trimmed[0];
  if (head === "{" || head === "[") {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (
    /^diff --git /m.test(stripped) ||
    /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(stripped) ||
    (/^--- /m.test(stripped) && /^\+\+\+ /m.test(stripped))
  ) {
    return "diff";
  }
  if (head === "<" && trimmed.includes(">")) {
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return "html";
    }
    return "xml";
  }
  if (trimmed.startsWith("#!")) {
    return "sh";
  }
  // Markdown: ATX heading at the very start (`# `, `## `, …) followed
  // by a non-space char. Conservative on purpose — `#` alone is also
  // a comment in many shell-ish languages.
  if (/^#{1,6} \S/.test(trimmed)) {
    return "md";
  }
  return "";
};

// Strings get a best-effort language: caller-supplied hint wins
// (extracted from the tool's input — file extension for Read-style
// tools), then content sniffing, then plain. Objects always pretty-
// print as JSON.
const formatToolDetail = (input: unknown, languageHint?: string): IFormattedDetail | null => {
  if (input === null || input === undefined) {
    return null;
  }
  try {
    if (typeof input === "string") {
      if (input.length === 0) {
        return null;
      }
      const language = languageHint && languageHint.length > 0 ? languageHint : sniffLanguage(input);
      return { text: input, language };
    }
    if (typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined);
      if (entries.length === 0) {
        return null;
      }
      return { text: JSON.stringify(Object.fromEntries(entries), null, 2), language: "json" };
    }
    return { text: JSON.stringify(input, null, 2), language: "json" };
  } catch {
    return { text: String(input), language: "" };
  }
};

// SPLIT FRAME: Static (frozen, immutable) + Dynamic (committed, in-flight).
//
//   - Stable rows (user, assistant, thinking-done, info, error,
//     turn-meta) emit to <Static> immediately. Ink writes once,
//     terminal owns them, resize reflows naturally, no orphan frames
//     even with wide bg blocks (the user-message ThemedBox spanning
//     `cols`).
//   - Tool rows stay in `committed` (dynamic) until they finalize -
//     their status / output / verbose state mutate via Ctrl+O while
//     they're still relevant. On the NEXT user-input event, prior
//     turn's tool rows migrate to <Static> with state baked in.
//   - Live-streaming text, the Thinking spinner, and the cancelling
//     indicator are dynamic-only - they appear at the bottom of the
//     dynamic frame and disappear when the turn ends.
//
// Why split: wide background-coloured boxes (the user message
// `<ThemedBox bg width={cols}>`) cause stranded artefacts on resize
// in the dynamic frame. Ink redraws at the new width; the OLD wider
// bg row already sits in the terminal's row buffer and the terminal
// reflows it into multiple visual lines that Ink's cursor-up math
// can't reach. <Static> sidesteps this entirely - the row is written
// once, owned by the terminal, naturally reflowed.
//
// MAX_COMMITTED_ROWS caps memory in the dynamic array; <Static>
// items live in terminal scrollback (already capped by the user's
// terminal config).
const TranscriptImpl = ({ cols, handleRef, cancelling = false }: IProps) => {
  const baseDir = process.cwd();
  // Predicate used by `segmentMessage` to decide whether `@<token>` is a
  // real file (chip) or just an at-mention / email (plain text). Cheap
  // sync stat - only runs at render time on already-committed rows.
  const isFile = useCallback(
    (path: string): boolean => {
      try {
        const abs = isAbsolute(path) ? path : resolve(baseDir, path);
        return existsSync(abs) && statSync(abs).isFile();
      } catch {
        return false;
      }
    },
    [baseDir],
  );
  const refLiveText = useRef<string>("");
  const refLiveThinking = useRef<string>("");
  const refThinkingActive = useRef<boolean>(false);
  const refDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const refRowId = useRef<number>(0);
  const refRunningTools = useRef<Set<string>>(new Set());
  const refCommitted = useRef<TCommittedRow[]>([]);

  const [frozen, setFrozen] = useState<TFrozenRow[]>([]);
  const [committed, setCommitted] = useState<TCommittedRow[]>([]);
  const [liveText, setLiveText] = useState<string>("");
  const [thinkingActive, setThinkingActive] = useState<boolean>(false);
  const [runPending, setRunPending] = useState<boolean>(false);
  const [toolStatuses, setToolStatuses] = useState<Map<string, "ok" | "error" | "unknown">>(new Map());
  const [toolOutputs, setToolOutputs] = useState<Map<string, unknown>>(new Map());
  const [verbose, setVerbose] = useState<boolean>(false);

  // Mirror tool maps + verbose into refs so the `flushPendingToFrozen`
  // batch (which fires synchronously inside the user-input handler)
  // can read the latest values without depending on stale closures.
  const refToolStatuses = useRef<Map<string, "ok" | "error" | "unknown">>(new Map());
  const refToolOutputs = useRef<Map<string, unknown>>(new Map());
  const refVerbose = useRef<boolean>(false);
  useEffect(() => {
    refToolStatuses.current = toolStatuses;
  }, [toolStatuses]);
  useEffect(() => {
    refToolOutputs.current = toolOutputs;
  }, [toolOutputs]);
  useEffect(() => {
    refVerbose.current = verbose;
  }, [verbose]);

  const { isRawModeSupported } = useStdin();
  useInput(
    (input, key) => {
      if (key.ctrl && input === "o") {
        setVerbose((v) => !v);
      }
    },
    { isActive: Boolean(isRawModeSupported) },
  );

  const nextId = useCallback((): number => {
    refRowId.current += 1;
    return refRowId.current;
  }, []);

  const updateCommitted = useCallback((updater: (prev: TCommittedRow[]) => TCommittedRow[]): void => {
    const next = updater(refCommitted.current);
    refCommitted.current = next;
    setCommitted(next);
  }, []);

  const appendFrozen = useCallback((row: TFrozenRow): void => {
    setFrozen((prev) => [...prev, row]);
  }, []);

  // Tool rows mutate (status / output update via Ctrl+O verbose
  // toggle), so they live in the dynamic `committed` array until
  // they finalize. Everything else goes straight to <Static> via
  // `frozen`.
  const appendCommitted = useCallback(
    (row: TCommittedRow): void => {
      if (row.kind === "tool") {
        updateCommitted((prev) => {
          if (prev.length < MAX_COMMITTED_ROWS) {
            return [...prev, row];
          }
          return [...prev.slice(prev.length + 1 - MAX_COMMITTED_ROWS), row];
        });
        return;
      }
      // Stable kinds skip the dynamic array entirely.
      appendFrozen(row as TFrozenRow);
    },
    [appendFrozen, updateCommitted],
  );

  // Migrate any tool rows still sitting in `committed` into <Static>
  // with their current status / output / verbose state baked in. Run
  // on user-input so the user can keep toggling Ctrl+O on the just-
  // finished turn's tools until they start a new prompt.
  const flushPendingToFrozen = useCallback((): void => {
    const prev = refCommitted.current;
    if (prev.length === 0) {
      return;
    }
    const tools = prev.filter((r): r is Extract<TCommittedRow, { kind: "tool" }> => r.kind === "tool");
    if (tools.length === 0) {
      return;
    }
    const baked: TFrozenRow[] = tools.map((row) => {
      const status = refToolStatuses.current.get(row.toolId) ?? "unknown";
      const output = refToolOutputs.current.get(row.toolId);
      return output !== undefined
        ? { ...row, bakedStatus: status, bakedOutput: output, bakedVerbose: refVerbose.current }
        : { ...row, bakedStatus: status, bakedVerbose: refVerbose.current };
    });
    const nextCommitted = prev.filter((r) => r.kind !== "tool");
    refCommitted.current = nextCommitted;
    setCommitted(nextCommitted);
    setFrozen((f) => [...f, ...baked]);
    // Drop the migrated tool ids from the live status / output maps
    // so they don't leak.
    setToolStatuses((m) => {
      let n: Map<string, "ok" | "error" | "unknown"> | null = null;
      for (const t of tools) {
        if (m.has(t.toolId)) {
          if (n === null) {
            n = new Map(m);
          }
          n.delete(t.toolId);
        }
      }
      return n ?? m;
    });
    setToolOutputs((m) => {
      let n: Map<string, unknown> | null = null;
      for (const t of tools) {
        if (m.has(t.toolId)) {
          if (n === null) {
            n = new Map(m);
          }
          n.delete(t.toolId);
        }
      }
      return n ?? m;
    });
  }, []);

  // Progressive flush: every debounce tick, if the live buffer has a
  // paragraph boundary (\n\n), commit everything up to the LAST one
  // as an assistant row, keep only the trailing partial paragraph as
  // live preview. Bounds the dynamic-frame growth during streaming.
  const scheduleLiveFlush = useCallback((): void => {
    if (refDebounceTimer.current !== null) {
      return;
    }
    refDebounceTimer.current = setTimeout(() => {
      refDebounceTimer.current = null;
      const buf = refLiveText.current;
      const breakAt = buf.lastIndexOf("\n\n");
      if (breakAt > 0) {
        const completed = buf.slice(0, breakAt);
        const remaining = buf.slice(breakAt + 2);
        refLiveText.current = remaining;
        appendCommitted({ id: nextId(), kind: "assistant", text: completed });
        setLiveText(remaining);
        return;
      }
      setLiveText(buf);
    }, LIVE_DEBOUNCE_MS);
  }, [appendCommitted, nextId]);

  const commitLiveText = useCallback((): void => {
    if (refDebounceTimer.current !== null) {
      clearTimeout(refDebounceTimer.current);
      refDebounceTimer.current = null;
    }
    const buf = refLiveText.current;
    refLiveText.current = "";
    setLiveText("");
    if (buf.length === 0) {
      return;
    }
    appendCommitted({ id: nextId(), kind: "assistant", text: buf });
  }, [nextId, appendCommitted]);

  const sweepDanglingTools = useCallback((): void => {
    if (refRunningTools.current.size === 0) {
      return;
    }
    const snapshot = new Set(refRunningTools.current);
    refRunningTools.current.clear();
    // Mark dangling tools as "unknown" so their spinner stops. Rows
    // stay in `committed` for visual continuity.
    setToolStatuses((prev) => {
      let next: Map<string, "ok" | "error" | "unknown"> | null = null;
      for (const id of snapshot) {
        if (!prev.has(id)) {
          if (next === null) {
            next = new Map(prev);
          }
          next.set(id, "unknown");
        }
      }
      return next ?? prev;
    });
  }, []);

  useEffect(() => {
    handleRef.current = {
      emit: (event: TTranscriptEvent): void => {
        switch (event.kind) {
          case "user-input": {
            // Flush prior turn's pending tool rows into <Static>
            // BEFORE appending the new user row. This is the moment
            // they lock - their Ctrl+O state is baked. Until now the
            // user could still expand/collapse them.
            flushPendingToFrozen();
            appendCommitted({ id: nextId(), kind: "user", text: event.text });
            setRunPending(true);
            return;
          }
          case "text-delta": {
            setRunPending(false);
            // Some agents stream `agent_message_chunk` without ever
            // emitting `thinking-completed`, so the Thinking spinner
            // would otherwise hang above the live response. The first
            // text delta is an implicit end-of-thinking - flush any
            // buffered thinking text into a finalized row, drop the
            // spinner, then append text.
            if (refThinkingActive.current) {
              const text = refLiveThinking.current;
              refLiveThinking.current = "";
              refThinkingActive.current = false;
              setThinkingActive(false);
              if (text.length > 0) {
                appendCommitted({ id: nextId(), kind: "thinking-done", text });
              }
            }
            refLiveText.current += event.text;
            scheduleLiveFlush();
            return;
          }
          case "thinking-delta": {
            setRunPending(false);
            if (!refThinkingActive.current) {
              refThinkingActive.current = true;
              setThinkingActive(true);
            }
            refLiveThinking.current += event.text;
            return;
          }
          case "thinking-completed": {
            if (!refThinkingActive.current && refLiveThinking.current.length === 0) {
              return;
            }
            const text = refLiveThinking.current;
            refLiveThinking.current = "";
            refThinkingActive.current = false;
            setThinkingActive(false);
            appendCommitted({ id: nextId(), kind: "thinking-done", text });
            return;
          }
          case "tool-call-started": {
            setRunPending(false);
            refRunningTools.current.add(event.id);
            appendCommitted({
              id: nextId(),
              kind: "tool",
              toolId: event.id,
              name: event.name,
              summary: event.summary,
              input: event.input,
              locations: event.locations,
            });
            return;
          }
          case "tool-call-completed": {
            refRunningTools.current.delete(event.id);
            setToolStatuses((prev) => new Map(prev).set(event.id, event.status));
            if (event.output !== undefined) {
              setToolOutputs((prev) => new Map(prev).set(event.id, event.output));
            }
            return;
          }
          case "turn-ended": {
            commitLiveText();
            setRunPending(false);
            // Cancellation can cut off thinking mid-stream - no
            // thinking-completed will fire, so we reset here too.
            // Otherwise the "Thinking" spinner stays on after busy
            // flips back to idle.
            if (refThinkingActive.current) {
              refLiveThinking.current = "";
              refThinkingActive.current = false;
              setThinkingActive(false);
            }
            sweepDanglingTools();
            if (event.meta.length > 0) {
              appendCommitted({ id: nextId(), kind: "turn", meta: event.meta });
            }
            return;
          }
          case "error": {
            commitLiveText();
            setRunPending(false);
            if (refThinkingActive.current) {
              refLiveThinking.current = "";
              refThinkingActive.current = false;
              setThinkingActive(false);
            }
            sweepDanglingTools();
            appendCommitted({ id: nextId(), kind: "error", message: event.message });
            return;
          }
          case "info": {
            appendCommitted({ id: nextId(), kind: "info", text: event.text });
            return;
          }
          case "reset": {
            if (refDebounceTimer.current !== null) {
              clearTimeout(refDebounceTimer.current);
              refDebounceTimer.current = null;
            }
            refLiveText.current = "";
            refLiveThinking.current = "";
            refThinkingActive.current = false;
            refRunningTools.current.clear();
            setLiveText("");
            setThinkingActive(false);
            setRunPending(false);
            setToolStatuses(new Map());
            setToolOutputs(new Map());
            refCommitted.current = [];
            setCommitted([]);
            // Reset frozen too. Past <Static> rows already in terminal
            // scrollback stay there - we can't unwind them and don't
            // try. The visual effect of /clear is "advance to a fresh
            // dynamic frame"; previous content remains scrollable above.
            setFrozen([]);
            return;
          }
        }
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [appendCommitted, commitLiveText, flushPendingToFrozen, nextId, scheduleLiveFlush, sweepDanglingTools, handleRef]);

  useEffect(() => {
    return (): void => {
      if (refDebounceTimer.current !== null) {
        clearTimeout(refDebounceTimer.current);
        refDebounceTimer.current = null;
      }
    };
  }, []);

  const dotColumn = (color: string) => (
    <Box paddingLeft={1} paddingRight={1}>
      <Text color={color}>{BLACK_CIRCLE}</Text>
    </Box>
  );

  // Static path: render once, terminal owns it. Wide-bg user message
  // blocks live here without resize artefacts because Ink doesn't
  // try to redraw the row after emit.
  const renderFrozen = (row: TFrozenRow): ReactNode => {
    if (row.kind === "user") {
      // Two-stage rendering:
      //  1. Inline: `@image:<path>` and `@<file>` runs collapse to
      //     `[Image #N]` / `[basename]` chips so long absolute paths
      //     don't blow out the message line.
      //  2. Below: one dim `└ <chip>` row per attachment, wrapped in
      //     createPlainHyperlink so terminals that support OSC 8 give
      //     a click affordance.
      const segments = segmentMessage(row.text, isFile);
      const inline: string[] = [];
      const attachments: { kind: "image" | "file"; label: string; path: string }[] = [];
      let imageCount = 0;
      for (const seg of segments) {
        if (seg.kind === "text") {
          inline.push(seg.text);
          continue;
        }
        if (seg.kind === "image") {
          imageCount += 1;
          const label = `[Image #${imageCount}]`;
          attachments.push({ kind: "image", label, path: seg.path });
          inline.push(label);
          continue;
        }
        const label = `[${basename(seg.path)}]`;
        attachments.push({ kind: "file", label, path: seg.path });
        inline.push(label);
      }
      // Bg hugs only the text content (no wide bar across `cols`).
      // Even in <Static> the terminal reflows wide bg-coloured rows
      // in a way that strands cells when the user resizes smaller
      // (cells were emitted at the original width and terminal
      // reflow doesn't always cleanly wrap them with the text).
      // Hugging the text gives a visual distinction from assistant
      // rows without the stranded-block artefact.
      return (
        <Box flexDirection="column" key={row.id} marginTop={1} paddingLeft={1} width="100%">
          <Box flexDirection="row">
            <Text dimColor>{BLACK_CIRCLE}</Text>
            <Text> </Text>
            <Text backgroundColor="userMessageBg" color="text" wrap="wrap">
              {inline.join("")}
            </Text>
          </Box>
          {attachments.map((a, attIdx) => {
            const abs = a.kind === "image" || isAbsolute(a.path) ? a.path : resolve(baseDir, a.path);
            const display = abs.length > 0 ? createPlainHyperlink(`file://${abs}`, a.label) : a.label;
            return (
              <Box key={`${row.id}:att:${attIdx}:${a.path}`} paddingLeft={2}>
                <Text dimColor>{`└ ${display}`}</Text>
              </Box>
            );
          })}
        </Box>
      );
    }
    if (row.kind === "assistant") {
      return (
        <Box alignItems="flex-start" flexDirection="row" justifyContent="space-between" key={row.id} marginTop={1} width="100%">
          <Box flexDirection="row">
            {dotColumn("accent")}
            <Box flexDirection="column">
              <Markdown text={row.text} baseColor="text" />
            </Box>
          </Box>
        </Box>
      );
    }
    if (row.kind === "thinking-done") {
      // Frozen thinking trace is verbose-baked at emit time; once in
      // <Static> the verbose state can't change, so always render
      // the header. The text body is rendered if it exists.
      return (
        <Box flexDirection="column" key={row.id} marginTop={1}>
          <Box flexDirection="row">
            {dotColumn("accent")}
            <Text color="accent">
              {THINKING_LABEL} <Text dimColor>{VERBOSE_HINT}</Text>
            </Text>
          </Box>
          {row.text.length > 0 ? (
            <Box paddingLeft={2}>
              <Text dimColor wrap="wrap">
                {row.text}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
    }
    if (row.kind === "tool") {
      // Tool rows in <Static> render with their baked status / output
      // / verbose state. Ctrl+O after the row was frozen does not
      // affect this rendering (the row already lives in scrollback).
      const inProgress = false;
      const isError = row.bakedStatus === "error";
      const detail = row.bakedVerbose ? formatToolDetail(row.input) : null;
      const inputLang = row.bakedVerbose ? guessLanguageFromTool(row.input, row.locations) : undefined;
      const outputDetail = row.bakedVerbose && row.bakedOutput !== undefined ? formatToolDetail(row.bakedOutput, inputLang) : null;
      return (
        <Box flexDirection="column" key={row.id} marginTop={1}>
          <Box flexDirection="row" paddingLeft={1}>
            <ToolUseLoader inProgress={inProgress} isError={isError} />
            <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
              <Text color={isError ? "error" : "text"} bold>
                {row.name}
              </Text>
              {row.summary.length > 0 ? (
                <Text dimColor wrap="truncate-end">
                  {row.summary}
                </Text>
              ) : null}
            </Box>
          </Box>
          {detail ? (
            <Box paddingLeft={3}>
              <CodeBlock code={detail.text} language={detail.language} />
            </Box>
          ) : null}
          {outputDetail ? (
            <Box paddingLeft={3} marginTop={1}>
              <CodeBlock code={outputDetail.text} language={outputDetail.language} />
            </Box>
          ) : null}
        </Box>
      );
    }
    if (row.kind === "error") {
      return (
        <Box flexDirection="row" key={row.id} marginTop={1}>
          {dotColumn("error")}
          <Box flexGrow={1} flexShrink={1}>
            <Text color="error" wrap="wrap">
              {row.message}
            </Text>
          </Box>
        </Box>
      );
    }
    if (row.kind === "info") {
      return (
        <Box flexDirection="row" key={row.id} paddingLeft={1}>
          <Box width={2} flexShrink={0}>
            <Text dimColor>{BLACK_CIRCLE}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text dimColor wrap="wrap">
              {row.text}
            </Text>
          </Box>
        </Box>
      );
    }
    if (row.kind === "turn") {
      // Frozen turn meta always renders (no verbose gate); past meta
      // belongs in scrollback for review.
      return (
        <Box flexDirection="row" key={row.id} paddingLeft={3}>
          <Text dimColor>{row.meta}</Text>
        </Box>
      );
    }
    return null;
  };

  return (
    <Box flexDirection="column" width={cols}>
      <Static items={frozen}>
        {(row) => (
          <Box key={row.id} paddingLeft={2}>
            {renderFrozen(row)}
          </Box>
        )}
      </Static>
      {committed.map((row, idx) => {
        // Only tool rows live in `committed` now (stable kinds skip
        // straight to <Static> via appendCommitted). The dynamic loop
        // is just the in-flight tool list.
        if (row.kind !== "tool") {
          return null;
        }
        const prev = idx > 0 ? committed[idx - 1] : undefined;
        const precededByNonTool = prev === undefined || prev.kind !== "tool";
        const status = toolStatuses.get(row.toolId);
        const output = toolOutputs.get(row.toolId);
        const inProgress = status === undefined;
        const isError = status === "error";
        const detail = verbose ? formatToolDetail(row.input) : null;
        const inputLang = verbose ? guessLanguageFromTool(row.input, row.locations) : undefined;
        const outputDetail = verbose && output !== undefined ? formatToolDetail(output, inputLang) : null;
        const hint = verbose ? "(Ctrl+O to collapse)" : "(Ctrl+O to expand)";
        return (
          <Box flexDirection="column" key={row.id} marginTop={precededByNonTool ? 1 : 0}>
            <Box flexDirection="row" paddingLeft={1}>
              <ToolUseLoader inProgress={inProgress} isError={isError} />
              <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
                <Text color={isError ? "error" : "text"} bold>
                  {row.name}
                </Text>
                {row.summary.length > 0 ? (
                  <Text dimColor wrap="truncate-end">
                    {row.summary}
                  </Text>
                ) : null}
                <Text color="subtle">{hint}</Text>
              </Box>
            </Box>
            {detail ? (
              <Box paddingLeft={3}>
                <CodeBlock code={detail.text} language={detail.language} />
              </Box>
            ) : null}
            {outputDetail ? (
              <Box paddingLeft={3} marginTop={1}>
                <CodeBlock code={outputDetail.text} language={outputDetail.language} />
              </Box>
            ) : null}
            {verbose && inProgress && output === undefined ? (
              <Box paddingLeft={5} marginTop={1}>
                <Text dimColor italic>
                  {"(awaiting output…)"}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {cancelling ? (
        // Persistent indicator while a Ctrl+C / Esc abort is in flight.
        // Shown regardless of runPending / thinkingActive / liveText so
        // the user always sees acknowledgement until busy resolves -
        // ACP cancellation can take 100ms-1s to actually unwind.
        <Box flexDirection="row" marginTop={1} paddingLeft={1}>
          <Spinner color="warning" />
          <Text color="warning">{` Cancelling…`}</Text>
        </Box>
      ) : runPending && !thinkingActive && liveText.length === 0 ? (
        <Box flexDirection="row" marginTop={1} paddingLeft={1}>
          <Spinner />
          <Text color="accent">{` ${THINKING_LABEL}`}</Text>
        </Box>
      ) : thinkingActive ? (
        <Box flexDirection="row" marginTop={1} paddingLeft={1}>
          <Spinner />
          <Text color="accent">{` ${THINKING_LABEL}`}</Text>
        </Box>
      ) : null}
      {liveText.length > 0 ? (
        <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
          <Box flexDirection="row">
            {dotColumn("accent")}
            <Box flexDirection="column">
              <Markdown text={liveText} baseColor="text" />
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};

export const Transcript = memo(TranscriptImpl);
Transcript.displayName = "Transcript";
