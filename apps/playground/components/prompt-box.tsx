import { Box, useApp, useStdin } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POINTER } from "./figures";
import { chipEndingAt, chipStartingAt, chipText, collectChipIds, expandChips, nextChipId, snapOutOfChip } from "./image-chip";
import { ThemedText as Text } from "@app/theme/themed-text";

interface IExitMessage {
  readonly show: boolean;
  readonly key?: string;
}

export type TPasteResult = { readonly kind: "text"; readonly text: string } | { readonly kind: "images"; readonly paths: readonly string[] };

interface IProps {
  readonly cols: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly softDisabled?: boolean;
  readonly onSubmit: (value: string) => void;
  readonly onCancel?: () => void;
  readonly onExit?: () => void;
  readonly onExitMessage?: (msg: IExitMessage) => void;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly onSlashNavigate?: (dir: -1 | 1) => boolean;
  readonly onSlashComplete?: () => void;
  readonly onSlashSubmit?: () => string | null;
  readonly onAtNavigate?: (dir: -1 | 1) => boolean;
  readonly onAtComplete?: () => void;
  readonly onAtSubmit?: () => string | null;
  readonly transformPaste?: (text: string) => TPasteResult | Promise<TPasteResult>;
  readonly onPasteError?: (error: unknown) => void;
}

// Terminal raw mode + extended-key escapes are owned by the App via
// `useTerminalRawMode()` - they must be set exactly once for the
// lifetime of the session, since each `process.stdout.write(...)`
// outside Ink's pipeline corrupts cursor tracking.
const PASTE_END_SEQ = "\x1b[201~";
const POINTER_CELL_WIDTH = 2;

const isWordChar = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch);

const prevWordBoundary = (val: string, from: number): number => {
  let i = from;
  while (i > 0 && !isWordChar(val[i - 1] ?? "")) {
    i -= 1;
  }
  while (i > 0 && isWordChar(val[i - 1] ?? "")) {
    i -= 1;
  }
  return i;
};

const nextWordBoundary = (val: string, from: number): number => {
  let i = from;
  while (i < val.length && !isWordChar(val[i] ?? "")) {
    i += 1;
  }
  while (i < val.length && isWordChar(val[i] ?? "")) {
    i += 1;
  }
  return i;
};

type TParsedKey =
  | { kind: "char"; value: string }
  | { kind: "newline" }
  | { kind: "submit" }
  | { kind: "backspace" }
  | { kind: "delete" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "ctrlC" }
  | { kind: "ctrlD" }
  | { kind: "escape" }
  | { kind: "tab" }
  | { kind: "wordLeft" }
  | { kind: "wordRight" }
  | { kind: "deleteWordBack" }
  | { kind: "deleteToLineStart" }
  | { kind: "deleteToLineEnd" }
  | { kind: "paste"; text: string };

interface IParseResult {
  readonly events: TParsedKey[];
  readonly remainder: string;
}

const ctrlByteToEvent = (b: number): TParsedKey | null => {
  switch (b) {
    case 0x01:
      return { kind: "home" };
    case 0x02:
      return { kind: "left" };
    case 0x03:
      return { kind: "ctrlC" };
    case 0x04:
      return { kind: "ctrlD" };
    case 0x05:
      return { kind: "end" };
    case 0x06:
      return { kind: "right" };
    case 0x08:
      return { kind: "backspace" };
    case 0x0b:
      return { kind: "deleteToLineEnd" };
    case 0x15:
      return { kind: "deleteToLineStart" };
    case 0x16:
      // Ctrl+V → empty paste event. transformPaste sees text === "" and
      // probes the system clipboard for an image. macOS terminals also
      // emit empty bracketed paste on Cmd+V with image data; this is
      // the keyboard-shortcut equivalent for users who don't have (or
      // don't want to use) the terminal's Cmd+V binding.
      return { kind: "paste", text: "" };
    case 0x17:
      return { kind: "deleteWordBack" };
    default:
      return null;
  }
};

const parseInput = (raw: string): IParseResult => {
  const events: TParsedKey[] = [];
  let i = 0;
  while (i < raw.length) {
    const code = raw.charCodeAt(i);
    const ctrlEv = ctrlByteToEvent(code);
    if (ctrlEv !== null) {
      events.push(ctrlEv);
      i += 1;
      continue;
    }
    if (code === 0x7f) {
      events.push({ kind: "backspace" });
      i += 1;
      continue;
    }
    if (code === 0x0d || code === 0x0a) {
      events.push({ kind: "submit" });
      i += 1;
      continue;
    }
    if (code === 0x1b) {
      if (i + 1 >= raw.length) {
        events.push({ kind: "escape" });
        i += 1;
        continue;
      }
      const next = raw[i + 1];
      // Swallow terminal-response control strings (DCS / OSC / SOS / PM / APC)
      // so OSC 11 color queries and similar don't leak as typed text.
      if (next === "P" || next === "]" || next === "X" || next === "^" || next === "_") {
        const stIdx = raw.indexOf("\x1b\\", i + 2);
        const belIdx = next === "]" ? raw.indexOf("\x07", i + 2) : -1;
        let endIdx: number;
        if (stIdx !== -1 && belIdx !== -1) {
          endIdx = Math.min(stIdx, belIdx);
        } else if (stIdx !== -1) {
          endIdx = stIdx;
        } else if (belIdx !== -1) {
          endIdx = belIdx;
        } else {
          return { events, remainder: raw.slice(i) };
        }
        i = endIdx + (raw[endIdx] === "\x07" ? 1 : 2);
        continue;
      }
      if (next === "\r" || next === "\n") {
        events.push({ kind: "newline" });
        i += 2;
        continue;
      }
      if (next !== undefined && next.charCodeAt(0) === 0x7f) {
        events.push({ kind: "deleteWordBack" });
        i += 2;
        continue;
      }
      if (next === "b" || next === "B") {
        events.push({ kind: "wordLeft" });
        i += 2;
        continue;
      }
      if (next === "f" || next === "F") {
        events.push({ kind: "wordRight" });
        i += 2;
        continue;
      }
      if (next === "O") {
        if (i + 2 >= raw.length) {
          return { events, remainder: raw.slice(i) };
        }
        if (raw[i + 2] === "M") {
          events.push({ kind: "newline" });
          i += 3;
          continue;
        }
        i += 3;
        continue;
      }
      if (next !== "[") {
        events.push({ kind: "escape" });
        i += 1;
        continue;
      }
      const tail = raw.slice(i + 2);
      const m = tail.match(/^([0-9;:?<>=]*)([~A-Za-z])/);
      if (!m) {
        return { events, remainder: raw.slice(i) };
      }
      const params = m[1] ?? "";
      const final = m[2];
      const seqLen = 2 + (m[0]?.length ?? 0);
      if (final === "u" && params.startsWith("13;")) {
        events.push({ kind: "newline" });
        i += seqLen;
        continue;
      }
      if (final === "~" && params === "27;2;13") {
        events.push({ kind: "newline" });
        i += seqLen;
        continue;
      }
      // Kitty keyboard protocol re-encodes plain unmodified keys as
      // `\x1b[<keycode>u` once we push `\x1b[>1u`. Without these
      // explicit cases, plain Esc / Tab / Enter / Backspace land in
      // the silent fallthrough at the bottom of the CSI handler - Esc
      // never reaches handleEvents and onCancel never fires, which is
      // exactly the "Esc doesn't work" symptom.
      if (final === "u" && (params === "27" || params.startsWith("27;"))) {
        events.push({ kind: "escape" });
        i += seqLen;
        continue;
      }
      if (final === "u" && (params === "9" || params.startsWith("9;"))) {
        events.push({ kind: "tab" });
        i += seqLen;
        continue;
      }
      if (final === "u" && params === "13") {
        events.push({ kind: "submit" });
        i += seqLen;
        continue;
      }
      if (final === "u" && (params === "127" || params.startsWith("127;"))) {
        events.push({ kind: "backspace" });
        i += seqLen;
        continue;
      }
      if (final === "~" && params.startsWith("27;5;")) {
        const letterCode = parseInt(params.slice(5), 10);
        if (letterCode >= 97 && letterCode <= 122) {
          const ev = ctrlByteToEvent(letterCode - 96);
          if (ev !== null) {
            events.push(ev);
            i += seqLen;
            continue;
          }
        }
      }
      if (final === "u" && params.endsWith(";5")) {
        const letterCode = parseInt(params.slice(0, params.length - 2), 10);
        if (letterCode >= 97 && letterCode <= 122) {
          const ev = ctrlByteToEvent(letterCode - 96);
          if (ev !== null) {
            events.push(ev);
            i += seqLen;
            continue;
          }
        }
      }
      if (final === "~" && params === "200") {
        const endIdx = raw.indexOf(PASTE_END_SEQ, i + seqLen);
        if (endIdx === -1) {
          return { events, remainder: raw.slice(i) };
        }
        const pasted = raw.slice(i + seqLen, endIdx);
        events.push({ kind: "paste", text: pasted });
        i = endIdx + PASTE_END_SEQ.length;
        continue;
      }
      if (final === "A") {
        events.push({ kind: "up" });
        i += seqLen;
        continue;
      }
      if (final === "B") {
        events.push({ kind: "down" });
        i += seqLen;
        continue;
      }
      if (final === "C") {
        if (params === "1;3" || params === "1;5") {
          events.push({ kind: "wordRight" });
        } else {
          events.push({ kind: "right" });
        }
        i += seqLen;
        continue;
      }
      if (final === "D") {
        if (params === "1;3" || params === "1;5") {
          events.push({ kind: "wordLeft" });
        } else {
          events.push({ kind: "left" });
        }
        i += seqLen;
        continue;
      }
      if (final === "H" || (final === "~" && params === "1")) {
        events.push({ kind: "home" });
        i += seqLen;
        continue;
      }
      if (final === "F" || (final === "~" && params === "4")) {
        events.push({ kind: "end" });
        i += seqLen;
        continue;
      }
      if (final === "~" && params === "3") {
        events.push({ kind: "delete" });
        i += seqLen;
        continue;
      }
      i += seqLen;
      continue;
    }
    if (code === 0x09) {
      events.push({ kind: "tab" });
      i += 1;
      continue;
    }
    if (code < 0x20) {
      i += 1;
      continue;
    }
    events.push({ kind: "char", value: raw[i] ?? "" });
    i += 1;
  }
  return { events, remainder: "" };
};

interface IVisualLayout {
  readonly rows: string[];
  readonly rowStartOffsets: number[];
  readonly cursorRow: number;
  readonly cursorCol: number;
}

const computeLayout = (value: string, cursor: number, contentWidth: number): IVisualLayout => {
  const rows: string[] = [""];
  const rowStartOffsets: number[] = [0];
  let row = 0;
  let col = 0;
  let cursorRow = 0;
  let cursorCol = 0;
  for (let i = 0; i <= value.length; i += 1) {
    if (i === cursor) {
      cursorRow = row;
      cursorCol = col;
    }
    if (i === value.length) {
      break;
    }
    const ch = value[i] ?? "";
    if (ch === "\n") {
      rows.push("");
      rowStartOffsets.push(i + 1);
      row += 1;
      col = 0;
      continue;
    }
    rows[row] = (rows[row] ?? "") + ch;
    col += 1;
    if (col >= contentWidth && i + 1 < value.length && value[i + 1] !== "\n") {
      rows.push("");
      rowStartOffsets.push(i + 1);
      row += 1;
      col = 0;
    }
  }
  return { rows, rowStartOffsets, cursorRow, cursorCol };
};


export const PromptBox = (props: IProps) => {
  const {
    cols,
    placeholder,
    disabled,
    softDisabled,
    onSubmit,
    onCancel,
    onExit,
    onExitMessage,
    value: controlledValue,
    onChange,
    onSlashNavigate,
    onSlashComplete,
    onSlashSubmit,
    onAtNavigate,
    onAtComplete,
    onAtSubmit,
    transformPaste,
    onPasteError,
  } = props;

  const refRawBuffer = useRef<string>("");
  const refHistory = useRef<string[]>([]);
  const refHistoryIndex = useRef<number>(0);
  const refDraft = useRef<string>("");
  const refValueAndCursor = useRef<{ value: string; cursor: number }>({ value: "", cursor: 0 });
  const refLastCtrlCAt = useRef<number>(0);
  const refLastEscAt = useRef<number>(0);
  const refExitTimer = useRef<NodeJS.Timeout | null>(null);
  const refMounted = useRef<boolean>(true);
  // Chip side-table: `[Image #N]` placeholders in the buffer point to
  // these absolute paths. Cleared on submit; orphan entries get evicted
  // when the user backspaces a chip so we never leak stale paths into
  // the next prompt.
  const refImageChips = useRef<Map<number, string>>(new Map());

  const [value, setValue] = useState<string>("");
  const [cursor, setCursor] = useState<number>(0);

  const { stdin, isRawModeSupported } = useStdin();
  const { exit } = useApp();

  const contentWidth = useMemo<number>(() => Math.max(1, cols - POINTER_CELL_WIDTH), [cols]);

  const setBoth = useCallback(
    (next: string, nextCursor: number): void => {
      refValueAndCursor.current.value = next;
      refValueAndCursor.current.cursor = nextCursor;
      setValue(next);
      setCursor(nextCursor);
      onChange?.(next);
      const chips = refImageChips.current;
      if (chips.size > 0) {
        const live = collectChipIds(next);
        for (const id of chips.keys()) {
          if (!live.has(id)) {
            chips.delete(id);
          }
        }
      }
    },
    [onChange],
  );

  // Controlled-mode mirror: parent-driven sets only (slash completion writes
  // "/help", history restore). Skip when controlledValue equals our latest
  // local commit so per-keystroke round-trips don't reset the cursor.
  useEffect(() => {
    if (controlledValue === undefined) {
      return;
    }
    if (controlledValue === refValueAndCursor.current.value) {
      return;
    }
    refValueAndCursor.current.value = controlledValue;
    refValueAndCursor.current.cursor = controlledValue.length;
    setValue(controlledValue);
    setCursor(controlledValue.length);
  }, [controlledValue]);

  const showExitHint = useCallback(
    (key: string): void => {
      if (onExitMessage) {
        onExitMessage({ show: true, key });
      }
      if (refExitTimer.current !== null) {
        clearTimeout(refExitTimer.current);
      }
      refExitTimer.current = setTimeout(() => {
        refExitTimer.current = null;
        if (onExitMessage) {
          onExitMessage({ show: false });
        }
      }, 1500);
    },
    [onExitMessage],
  );

  const handleEvents = useCallback(
    (events: TParsedKey[]): void => {
      for (const ev of events) {
        const cur = refValueAndCursor.current.cursor;
        const val = refValueAndCursor.current.value;
        if (ev.kind === "ctrlC") {
          if (softDisabled) {
            if (onCancel) {
              onCancel();
            }
            continue;
          }
          if (val.length > 0) {
            setBoth("", 0);
            continue;
          }
          const now = Date.now();
          if (now - refLastCtrlCAt.current < 1500) {
            if (onCancel) {
              onCancel();
            }
            if (onExit) {
              onExit();
            } else {
              exit();
            }
            continue;
          }
          refLastCtrlCAt.current = now;
          showExitHint("Ctrl+C");
          continue;
        }
        if (ev.kind === "ctrlD") {
          if (val.length === 0) {
            if (onExit) {
              onExit();
            } else {
              exit();
            }
            continue;
          }
          if (cur >= val.length) {
            continue;
          }
          const next = `${val.slice(0, cur)}${val.slice(cur + 1)}`;
          setBoth(next, cur);
          continue;
        }
        if (ev.kind === "escape") {
          if (softDisabled) {
            if (onCancel) {
              onCancel();
            }
            continue;
          }
          if (val.length === 0) {
            refLastEscAt.current = 0;
            continue;
          }
          const now = Date.now();
          if (now - refLastEscAt.current < 500) {
            setBoth("", 0);
            refLastEscAt.current = 0;
            continue;
          }
          refLastEscAt.current = now;
          continue;
        }
        if (ev.kind === "submit") {
          if (cur > 0 && val[cur - 1] === "\\") {
            const next = `${val.slice(0, cur - 1)}\n${val.slice(cur)}`;
            setBoth(next, cur);
            continue;
          }
          let toSubmit = val;
          if (val.startsWith("/") && onSlashSubmit) {
            const picked = onSlashSubmit();
            if (picked !== null) {
              toSubmit = picked;
            }
          } else if (onAtSubmit) {
            const picked = onAtSubmit();
            if (picked !== null) {
              toSubmit = picked;
            }
          }
          toSubmit = toSubmit.replace(/[\s\n]+$/, "");
          if (toSubmit.length === 0) {
            continue;
          }
          // Expand `[Image #N]` chips to `@image:<path>` so the agent sees
          // the path inline. Per-prompt scope - clear after use.
          const expanded = expandChips(toSubmit, refImageChips.current);
          refImageChips.current.clear();
          refHistory.current.push(expanded);
          refHistoryIndex.current = refHistory.current.length;
          refDraft.current = "";
          setBoth("", 0);
          onSubmit(expanded);
          continue;
        }
        if (ev.kind === "newline") {
          const next = `${val.slice(0, cur)}\n${val.slice(cur)}`;
          setBoth(next, cur + 1);
          continue;
        }
        if (ev.kind === "char") {
          const next = `${val.slice(0, cur)}${ev.value}${val.slice(cur)}`;
          setBoth(next, cur + 1);
          continue;
        }
        if (ev.kind === "paste") {
          const insertText = (text: string): void => {
            const v = refValueAndCursor.current.value;
            const c = refValueAndCursor.current.cursor;
            const next = `${v.slice(0, c)}${text}${v.slice(c)}`;
            setBoth(next, c + text.length);
          };
          const insertImages = (paths: readonly string[]): void => {
            if (paths.length === 0) {
              return;
            }
            const v = refValueAndCursor.current.value;
            let id = nextChipId(v);
            const chips: string[] = [];
            for (const p of paths) {
              refImageChips.current.set(id, p);
              chips.push(chipText(id));
              id += 1;
            }
            insertText(`${chips.join(" ")} `);
          };
          const apply = (result: TPasteResult): void => {
            if (result.kind === "text") {
              insertText(result.text);
              return;
            }
            insertImages(result.paths);
          };
          if (transformPaste === undefined) {
            insertText(ev.text);
            continue;
          }
          const transformed = transformPaste(ev.text);
          if (transformed instanceof Promise) {
            transformed
              .then((result) => {
                if (refMounted.current) {
                  apply(result);
                }
              })
              .catch((cause: unknown) => {
                if (refMounted.current) {
                  onPasteError?.(cause);
                }
              });
            continue;
          }
          apply(transformed);
          continue;
        }
        if (ev.kind === "backspace") {
          if (cur === 0) {
            continue;
          }
          const chip = chipEndingAt(val, cur);
          if (chip !== null) {
            refImageChips.current.delete(chip.id);
            const next = `${val.slice(0, chip.start)}${val.slice(chip.end)}`;
            setBoth(next, chip.start);
            continue;
          }
          const next = `${val.slice(0, cur - 1)}${val.slice(cur)}`;
          setBoth(next, cur - 1);
          continue;
        }
        if (ev.kind === "delete") {
          if (cur >= val.length) {
            continue;
          }
          const next = `${val.slice(0, cur)}${val.slice(cur + 1)}`;
          setBoth(next, cur);
          continue;
        }
        if (ev.kind === "wordLeft") {
          if (cur === 0) {
            continue;
          }
          setBoth(val, snapOutOfChip(val, prevWordBoundary(val, cur), "start"));
          continue;
        }
        if (ev.kind === "wordRight") {
          if (cur >= val.length) {
            continue;
          }
          setBoth(val, snapOutOfChip(val, nextWordBoundary(val, cur), "end"));
          continue;
        }
        if (ev.kind === "deleteWordBack") {
          if (cur === 0) {
            continue;
          }
          const start = snapOutOfChip(val, prevWordBoundary(val, cur), "start");
          const next = `${val.slice(0, start)}${val.slice(cur)}`;
          setBoth(next, start);
          continue;
        }
        if (ev.kind === "deleteToLineStart") {
          if (cur === 0) {
            continue;
          }
          const lineStart = val.lastIndexOf("\n", cur - 1) + 1;
          const next = `${val.slice(0, lineStart)}${val.slice(cur)}`;
          setBoth(next, lineStart);
          continue;
        }
        if (ev.kind === "deleteToLineEnd") {
          if (cur >= val.length) {
            continue;
          }
          const nlIdx = val.indexOf("\n", cur);
          const lineEnd = nlIdx === -1 ? val.length : nlIdx;
          const next = `${val.slice(0, cur)}${val.slice(lineEnd)}`;
          setBoth(next, cur);
          continue;
        }
        if (ev.kind === "left") {
          if (cur > 0) {
            const chip = chipEndingAt(val, cur);
            setBoth(val, chip !== null ? chip.start : cur - 1);
          }
          continue;
        }
        if (ev.kind === "right") {
          if (cur < val.length) {
            const chip = chipStartingAt(val, cur);
            setBoth(val, chip !== null ? chip.end : cur + 1);
          }
          continue;
        }
        if (ev.kind === "home") {
          setBoth(val, 0);
          continue;
        }
        if (ev.kind === "end") {
          setBoth(val, val.length);
          continue;
        }
        if (ev.kind === "up") {
          if (val.startsWith("/") && onSlashNavigate?.(-1)) {
            continue;
          }
          if (onAtNavigate?.(-1)) {
            continue;
          }
          const layout = computeLayout(val, cur, contentWidth);
          if (layout.cursorRow > 0) {
            const targetRow = layout.cursorRow - 1;
            const targetCol = Math.min(layout.cursorCol, layout.rows[targetRow]?.length ?? 0);
            const targetOffset = (layout.rowStartOffsets[targetRow] ?? 0) + targetCol;
            setBoth(val, targetOffset);
            continue;
          }
          if (refHistoryIndex.current === refHistory.current.length) {
            refDraft.current = val;
          }
          if (refHistoryIndex.current > 0) {
            refHistoryIndex.current -= 1;
            const item = refHistory.current[refHistoryIndex.current] ?? "";
            setBoth(item, item.length);
          }
          continue;
        }
        if (ev.kind === "tab") {
          if (val.startsWith("/") && onSlashComplete) {
            onSlashComplete();
            continue;
          }
          if (onAtComplete) {
            onAtComplete();
          }
          continue;
        }
        if (ev.kind === "down") {
          if (val.startsWith("/") && onSlashNavigate?.(1)) {
            continue;
          }
          if (onAtNavigate?.(1)) {
            continue;
          }
          const layout = computeLayout(val, cur, contentWidth);
          if (layout.cursorRow < layout.rows.length - 1) {
            const targetRow = layout.cursorRow + 1;
            const targetCol = Math.min(layout.cursorCol, layout.rows[targetRow]?.length ?? 0);
            const targetOffset = (layout.rowStartOffsets[targetRow] ?? 0) + targetCol;
            setBoth(val, targetOffset);
            continue;
          }
          if (refHistoryIndex.current < refHistory.current.length) {
            refHistoryIndex.current += 1;
            const item =
              refHistoryIndex.current === refHistory.current.length
                ? refDraft.current
                : (refHistory.current[refHistoryIndex.current] ?? "");
            setBoth(item, item.length);
          }
        }
      }
    },
    [
      contentWidth,
      exit,
      onCancel,
      onExit,
      onSubmit,
      onSlashNavigate,
      onSlashComplete,
      onSlashSubmit,
      onAtNavigate,
      onAtComplete,
      onAtSubmit,
      transformPaste,
      onPasteError,
      setBoth,
      showExitHint,
      softDisabled,
    ],
  );

  // Stable refs so the stdin subscription sets up exactly once per stdin /
  // raw-mode change. handleEvents identity churns on every keystroke
  // (slash hooks depend on inputValue) - without this, the cleanup writes
  // DISABLE_BRACKETED_PASTE and re-setup writes ENABLE_BRACKETED_PASTE
  // on every keystroke and the terminal flickers.
  const refHandleEvents = useRef(handleEvents);
  const refDisabled = useRef(disabled);
  const refOnCancel = useRef(onCancel);
  useEffect(() => {
    refHandleEvents.current = handleEvents;
    refDisabled.current = disabled;
    refOnCancel.current = onCancel;
  });

  useEffect(() => {
    if (!isRawModeSupported) {
      return;
    }
    // Raw mode + terminal-mode escape sequences (bracketed paste,
    // modify-other-keys, kitty keyboard) are managed at the App level
    // via useTerminalRawMode() - those write directly to stdout, which
    // bypasses Ink's render pipeline and corrupts cursor tracking if
    // it happens after the first mount. We only manage the per-mount
    // stdin DATA listener here, no mode toggling.
    const onData = (chunk: Buffer): void => {
      const incoming = refRawBuffer.current + chunk.toString("utf8");
      const { events, remainder } = parseInput(incoming);
      refRawBuffer.current = remainder;
      if (refDisabled.current) {
        const cancel = refOnCancel.current;
        for (const ev of events) {
          if (ev.kind === "ctrlC" && cancel) {
            cancel();
          }
        }
        return;
      }
      refHandleEvents.current(events);
    };
    stdin.on("data", onData);
    return (): void => {
      stdin.off("data", onData);
    };
  }, [stdin, isRawModeSupported]);

  useEffect(() => {
    return (): void => {
      refMounted.current = false;
      if (refExitTimer.current !== null) {
        clearTimeout(refExitTimer.current);
        refExitTimer.current = null;
      }
    };
  }, []);

  const layout = useMemo<IVisualLayout>(() => computeLayout(value, cursor, contentWidth), [value, cursor, contentWidth]);

  const showPlaceholder = value.length === 0;
  const placeholderText = placeholder ?? "";

  const visibleRowCount = showPlaceholder ? 1 : Math.max(layout.rows.length, 1);
  const textColWidth = Math.max(1, cols - 3);

  return (
    <Box alignItems="flex-start" flexDirection="row" marginTop={1} marginRight={1} width="100%">
      <Box flexDirection="column" flexShrink={0} width={2}>
        {Array.from({ length: visibleRowCount }, (_, i) => (
          <Text key={`pre-${i}`} color="accent" dimColor={disabled}>
            {i === 0 ? `${POINTER} ` : "  "}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        {Array.from({ length: visibleRowCount }, (_, i) => (
          <Text key={`div-${i}`} bold color="accent">
            ┃
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={0} width={textColWidth}>
        {showPlaceholder ? (
          // Background colours only the text cells, not a wide bar
          // across `textColWidth`. The wide-bar look is impossible
          // without a resize artefact: any bg-coloured cells beyond
          // the actual text wrap when the terminal shrinks, leaving
          // a stranded coloured strip below the new prompt. Both the
          // padded-text approach and `<ThemedBox width={...}>` produce
          // the same output (bg-coloured spaces filling the width).
          <Text backgroundColor="userMessageBg" color="inactive" wrap="truncate-end">
            {` ${placeholderText}`}
          </Text>
        ) : (
          layout.rows.map((rowText, idx) => {
            const isCursorRow = idx === layout.cursorRow;
            const rowKey = layout.rowStartOffsets[idx];
            if (!isCursorRow) {
              const body = rowText.length === 0 ? " " : rowText;
              return (
                <Text key={String(rowKey)} backgroundColor="userMessageBg" color="text" wrap="truncate-end">
                  {` ${body}`}
                </Text>
              );
            }
            const before = rowText.slice(0, layout.cursorCol);
            const cursorChar = rowText[layout.cursorCol] ?? " ";
            const after = rowText.slice(layout.cursorCol + 1);
            return (
              <Text key={String(rowKey)} backgroundColor="userMessageBg" color="text" wrap="truncate-end">
                {` ${before}`}
                <Text backgroundColor="userMessageBg" color="text" inverse>
                  {cursorChar}
                </Text>
                {after}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
};
