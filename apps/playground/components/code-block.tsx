import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import { type BundledLanguage, type BundledTheme, createHighlighter, type Highlighter } from "shiki";
import { useColumns } from "./use-columns";
import { useThemeControl } from "@app/theme/context";
import type { TThemeId } from "@app/theme/palette";
import { ThemedText } from "@app/theme/themed-text";

// Curated set covers what agents emit in code fences and what tool
// payloads look like (JSON dominant). Anything outside this list
// renders as plain text — Shiki's full grammar set is multi-MB and
// most of it is dead weight here.
const SUPPORTED_LANGS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "bash",
  "sh",
  "shell",
  "python",
  "py",
  "go",
  "rust",
  "rs",
  "sql",
  "css",
  "html",
  "markdown",
  "md",
  "yaml",
  "yml",
  "toml",
  "diff",
  "xml",
] as const satisfies readonly BundledLanguage[];

type TSupportedLang = (typeof SUPPORTED_LANGS)[number];

const SUPPORTED_THEMES = [
  "one-dark-pro",
  "github-light-default",
  "github-dark-high-contrast",
  "github-light-high-contrast",
] as const satisfies readonly BundledTheme[];

type TShikiTheme = (typeof SUPPORTED_THEMES)[number];

// Per-CLI-theme Shiki theme. ANSI-only modes get "plain" because the
// user explicitly opted out of truecolor; rendering Shiki on top would
// emit \x1b[38;2;... sequences they don't want.
const themeForId = (themeId: TThemeId): TShikiTheme | "plain" => {
  switch (themeId) {
    case "dark":
      return "one-dark-pro";
    case "light":
      return "github-light-default";
    case "dark-daltonized":
      return "github-dark-high-contrast";
    case "light-daltonized":
      return "github-light-high-contrast";
    default:
      return "plain";
  }
};

const RESET = "\x1b[0m";
const ansiFg = (hex: string): string => {
  // Shiki gives us "#rrggbb" — convert to a 24-bit truecolor escape.
  const n = Number.parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) {
    return "";
  }
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `\x1b[38;2;${r};${g};${b}m`;
};

const ALIAS_MAP: Readonly<Record<string, TSupportedLang>> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  shell: "sh",
  bash: "sh",
  zsh: "sh",
  markdown: "md",
  yml: "yaml",
};

const normalizeLang = (raw?: string): TSupportedLang | "text" => {
  if (!raw) {
    return "text";
  }
  const lower = raw.toLowerCase();
  if ((SUPPORTED_LANGS as readonly string[]).includes(lower)) {
    return lower as TSupportedLang;
  }
  const aliased = ALIAS_MAP[lower];
  if (aliased) {
    return aliased;
  }
  return "text";
};

let highlighterPromise: Promise<Highlighter> | undefined;
const getHighlighter = (): Promise<Highlighter> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...SUPPORTED_THEMES],
      langs: [...SUPPORTED_LANGS],
    });
  }
  return highlighterPromise;
};

// Tokenized output is pure derivation of (theme, lang, code). Cache by
// the tuple — re-renders during streaming hit this hot path constantly
// and re-tokenizing is the only thing that's actually expensive.
const lineCache = new Map<string, readonly string[]>();
const MAX_CACHE_ENTRIES = 256;

const cacheKey = (theme: TShikiTheme | "plain", lang: TSupportedLang | "text", code: string): string =>
  `${theme}::${lang}::${code}`;

const cacheStore = (key: string, lines: readonly string[]): void => {
  if (lineCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = lineCache.keys().next().value;
    if (firstKey !== undefined) {
      lineCache.delete(firstKey);
    }
  }
  lineCache.set(key, lines);
};

const tokenize = (
  highlighter: Highlighter | undefined,
  code: string,
  lang: TSupportedLang | "text",
  theme: TShikiTheme | "plain",
): readonly string[] => {
  // Stable plain outcomes (theme opt-out, unknown language) — safe to
  // cache because the result will never change for this input.
  if (theme === "plain" || lang === "text") {
    const key = cacheKey(theme, lang, code);
    const cached = lineCache.get(key);
    if (cached) {
      return cached;
    }
    const lines = code.split("\n");
    cacheStore(key, lines);
    return lines;
  }
  // Shiki not loaded yet — return plain WITHOUT caching. Otherwise the
  // next render (after Shiki resolves) would hit the same cache key
  // and keep returning the stale plain version forever. Only the
  // first-mounted blocks would ever be affected, but in this app
  // that's most of them, since Shiki's async-init usually loses the
  // race against the first transcript render.
  if (!highlighter) {
    return code.split("\n");
  }
  const key = cacheKey(theme, lang, code);
  const cached = lineCache.get(key);
  if (cached) {
    return cached;
  }
  let lines: string[];
  try {
    const result = highlighter.codeToTokens(code, { lang, theme });
    lines = result.tokens.map((line) =>
      line
        .map((token) => (token.color ? `${ansiFg(token.color)}${token.content}${RESET}` : token.content))
        .join(""),
    );
  } catch {
    // Grammar load failure for an edge-case lang shouldn't blow up
    // the transcript — fall back to plain, but DON'T cache (so a
    // later recovery still has a chance).
    return code.split("\n");
  }
  cacheStore(key, lines);
  return lines;
};

// Match a single SGR escape (CSI ... m). We only emit colour escapes
// from `ansiFg` + RESET, so the [0-9;]* body is sufficient.
const SGR_RE = /^\x1b\[[0-9;]*m/;
const TAB_WIDTH = 8;

// Expand tabs to spaces against an 8-column tab stop, preserving any
// ANSI escapes verbatim. We do this before truncation so visible-cell
// math matches what the terminal will actually render. Without it,
// agent tool outputs that align line numbers with `\t` (and many other
// tab-aligned formats) blow past the terminal width because we count
// each `\t` as one cell while the terminal expands it to up to 8.
const expandTabs = (line: string): string => {
  if (!line.includes("\t")) {
    return line;
  }
  let out = "";
  let col = 0;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      const match = SGR_RE.exec(line.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    const ch = line[i];
    if (ch === "\t") {
      const stop = TAB_WIDTH - (col % TAB_WIDTH);
      out += " ".repeat(stop);
      col += stop;
    } else {
      out += ch ?? "";
      col += 1;
    }
    i += 1;
  }
  return out;
};

// Truncate while preserving embedded ANSI escapes. We do this manually
// rather than leaning on Ink's `wrap="truncate-end"` because the flex
// chain in the playground (no ancestor pins a width that cleanly
// propagates through the dot-gutter columns) sometimes lets the raw
// escape-bearing string reach the terminal, which then hard-wraps it.
// Walking the bytes ourselves: count visible cells only, pass SGR
// escapes through verbatim, append "…\x1b[0m" to close any open
// attribute when we cut.
const truncateAnsi = (line: string, maxVisible: number): string => {
  if (maxVisible <= 0) {
    return "";
  }
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      const match = SGR_RE.exec(line.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (visible >= maxVisible) {
      return `${out}${RESET}…`;
    }
    if (visible === maxVisible - 1 && i < line.length - 1) {
      // Reserve the last cell for "…" so the indicator never gets
      // clipped by terminal wrap.
      const remaining = line.slice(i).replace(/\x1b\[[0-9;]*m/g, "");
      if (remaining.length > 1) {
        return `${out}${RESET}…`;
      }
    }
    out += line[i];
    visible += 1;
    i += 1;
  }
  return out;
};

interface ICodeBlockProps {
  readonly code: string;
  readonly language?: string;
  /** Hard cap on rendered lines. Anything past this becomes a "… N more lines (truncated)" footer. */
  readonly maxLines?: number;
  /** Indent in columns from the surrounding box. Defaults to 2. */
  readonly indent?: number;
  /**
   * Columns reserved by ancestors (gutters, padding, scrollbar fudge,
   * etc.) that the code block cannot use. Defaults to 8 — generous
   * enough to cover the dot column + container padding in both the
   * assistant and tool-row layouts, with margin to spare for any
   * character-width miscount (wide chars, pre-expansion tabs, etc.).
   */
  readonly reservedCols?: number;
}

export const CodeBlock = ({ code, language, maxLines = 40, indent = 2, reservedCols = 8 }: ICodeBlockProps) => {
  const { committedId } = useThemeControl();
  const targetTheme = themeForId(committedId);
  const lang = normalizeLang(language);
  const [highlighter, setHighlighter] = useState<Highlighter | undefined>(undefined);
  const cols = useColumns();
  // Reserve indent + ancestor padding. Floor at 20 so we always show
  // something readable on absurdly narrow terminals.
  const availableWidth = Math.max(20, cols - indent - reservedCols);

  useEffect(() => {
    if (targetTheme === "plain" || lang === "text") {
      return;
    }
    let active = true;
    void getHighlighter().then((h) => {
      if (active) {
        setHighlighter(h);
      }
    });
    return (): void => {
      active = false;
    };
  }, [targetTheme, lang]);

  const lines = useMemo(
    () => tokenize(highlighter, code, lang, targetTheme),
    [highlighter, code, lang, targetTheme],
  );

  const total = lines.length;
  const visible = total > maxLines ? lines.slice(0, maxLines) : lines;
  const truncatedCount = total - visible.length;

  return (
    <Box flexDirection="column" paddingLeft={indent}>
      {visible.map((line, idx) => {
        const expanded = expandTabs(line);
        const rendered = truncateAnsi(expanded, availableWidth);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: line index is stable for a given render
          <Text key={`code-${idx}`} wrap="truncate-end">
            {rendered.length > 0 ? rendered : " "}
          </Text>
        );
      })}
      {truncatedCount > 0 ? (
        <ThemedText color="subtle">{`… ${truncatedCount} more lines (truncated)`}</ThemedText>
      ) : null}
    </Box>
  );
};
