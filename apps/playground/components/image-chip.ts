// `[Image #N]` chip placeholders. The buffer carries chip text; the side-
// table keeps the absolute path. On submit, chips expand to `@image:<path>`
// so the agent receives the path inline. Backspace at chip-end deletes the
// whole chip; arrows hop over it; word-motion snaps out of partial landings.

const CHIP_RE = /\[Image #(\d+)\]/g;
const CHIP_END_RE = /\[Image #(\d+)\]$/;
const CHIP_START_RE = /^\[Image #(\d+)\]/;

interface IChipBounds {
  readonly start: number;
  readonly end: number;
  readonly id: number;
}

export const chipText = (id: number): string => `[Image #${id}]`;

export const collectChipIds = (text: string): Set<number> => {
  const out = new Set<number>();
  for (const m of text.matchAll(CHIP_RE)) {
    const id = Number.parseInt(m[1] ?? "", 10);
    if (Number.isFinite(id)) {
      out.add(id);
    }
  }
  return out;
};

export const nextChipId = (text: string): number => {
  let max = 0;
  for (const m of text.matchAll(CHIP_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
};

export const chipEndingAt = (text: string, offset: number): IChipBounds | null => {
  const m = CHIP_END_RE.exec(text.slice(0, offset));
  if (m === null) {
    return null;
  }
  const start = offset - m[0].length;
  return { start, end: offset, id: Number(m[1]) };
};

export const chipStartingAt = (text: string, offset: number): IChipBounds | null => {
  const m = CHIP_START_RE.exec(text.slice(offset));
  if (m === null) {
    return null;
  }
  return { start: offset, end: offset + m[0].length, id: Number(m[1]) };
};

export const snapOutOfChip = (text: string, offset: number, toward: "start" | "end"): number => {
  for (const m of text.matchAll(CHIP_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (offset > start && offset < end) {
      return toward === "start" ? start : end;
    }
  }
  return offset;
};

export const expandChips = (text: string, paths: ReadonlyMap<number, string>): string => {
  return text.replace(CHIP_RE, (full, idStr: string) => {
    const id = Number(idStr);
    const path = paths.get(id);
    return path !== undefined ? `@image:${path}` : full;
  });
};

/**
 * Pure render helper for transcripts: walk a string, identifying tokens
 * that should render as inline chips with a clickable footer below.
 *
 * Matches:
 *   `@image:<path>` always a chip (image attach pipeline owns it)
 *   `@<path>`       chip ONLY when `isFile(path)` returns true. Otherwise
 *                    left as plain text (avoids false positives on
 *                    "email@host", "@mention", etc).
 *
 * The `isFile` predicate is supplied by the caller because resolving a
 * token to a real file requires cwd context this module doesn't have.
 */
export type TMessageSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly text: string; readonly path: string }
  | { readonly kind: "file"; readonly text: string; readonly path: string };

// Single regex with alternation so we never match "@image:foo" twice.
// Group 1 captures the `image:` prefix when present so the caller can
// distinguish image from file. `\S+` matches any non-whitespace, which
// covers most posix and windows paths in the prompt.
const TOKEN_RE = /@(image:)?(\S+)/g;

export const segmentMessage = (text: string, isFile?: (path: string) => boolean): TMessageSegment[] => {
  const segments: TMessageSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const isImage = m[1] !== undefined;
    const path = m[2] ?? "";
    if (!isImage && (isFile === undefined || !isFile(path))) {
      continue;
    }
    if (m.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, m.index) });
    }
    segments.push({ kind: isImage ? "image" : "file", text: m[0], path });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  if (segments.length === 0) {
    segments.push({ kind: "text", text });
  }
  return segments;
};
