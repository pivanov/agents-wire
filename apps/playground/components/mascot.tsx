// Owl wordmark, sourced from logo.txt at the repo root. The file holds
// multiple variants separated by blank lines.
//
// Colour scheme: an interpolated gradient over a fixed palette
// (amber → green → sky → indigo → purple). Each character of the
// mascot computes its own colour from its (x, y) position projected
// onto a direction vector. The vector rotates by +90° each time the
// caller increments `bumpKey`, and the variant gets re-picked too -
// so on every user submit the owl swaps and the gradient direction
// rotates (top→bottom → left→right → bottom→top → right→left → ...).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Box } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemedText as Text } from "@app/theme/themed-text";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(MODULE_DIR, "..", "..", "..", "logo.txt");

const LOGO_TEXT = (() => {
  try {
    return readFileSync(LOGO_PATH, "utf-8").replace(/\n+$/, "");
  } catch {
    return "";
  }
})();

// Split on blank lines (one or more consecutive empty lines). Each block
// is one mascot variant. Filter to non-empty blocks of at least one line.
const VARIANTS: readonly (readonly string[])[] = (() => {
  if (LOGO_TEXT.length === 0) {
    return [];
  }
  const blocks = LOGO_TEXT.split(/\n\s*\n+/);
  return blocks
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((l) => l.trim().length > 0));
})();

// Gradient palette. Stops are evenly spaced along t in [0, 1]. Wraps
// (last stop matches first conceptually) so a 360° rotation lands on
// the same colour at the same position.
type TRgb = readonly [number, number, number];
const PALETTE: readonly TRgb[] = [
  [252, 211, 77], // amber
  [74, 222, 128], // green
  [56, 189, 248], // sky
  [99, 102, 241], // indigo
  [168, 85, 247], // purple
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpRgb = (a: TRgb, b: TRgb, t: number): TRgb => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];

// Sample the palette at t in [0, 1]. Piecewise linear over the palette
// stops; t < 0 clamps to first stop, t > 1 to last.
const colorAt = (t: number): string => {
  if (PALETTE.length === 0) {
    return "rgb(255,255,255)";
  }
  if (t <= 0) {
    const c = PALETTE[0] ?? [255, 255, 255];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  if (t >= 1) {
    const c = PALETTE[PALETTE.length - 1] ?? [255, 255, 255];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const segCount = PALETTE.length - 1;
  const scaled = t * segCount;
  const idx = Math.floor(scaled);
  const local = scaled - idx;
  const a = PALETTE[idx] ?? [255, 255, 255];
  const b = PALETTE[idx + 1] ?? a;
  const c = lerpRgb(a, b, local);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

// Map (x, y) in the mascot bounding box → t in [0, 1] given an angle
// in degrees. 0°: top→bottom, 90°: left→right, 180°: bottom→top,
// 270°: right→left. Other angles use the full direction vector.
const tForPosition = (x: number, y: number, w: number, h: number, angleDeg: number): number => {
  if (w <= 1 && h <= 1) {
    return 0;
  }
  // Normalize to centre-origin coords in [-1, +1] on each axis. Each
  // axis independently spans -1..+1 so aspect ratio doesn't skew the
  // gradient.
  const nx = w > 1 ? (x / (w - 1)) * 2 - 1 : 0;
  const ny = h > 1 ? (y / (h - 1)) * 2 - 1 : 0;
  // 0° points DOWN (top→bottom gradient), 90° points RIGHT, etc.
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad);
  const dot = nx * dx + ny * dy;
  // dot is in [-sqrt(2), +sqrt(2)] with full diagonal extremes; for
  // axis-aligned angles (0/90/180/270) it's in [-1, +1]. Map to [0, 1]
  // with clamping so off-axis pixels don't wrap.
  return Math.max(0, Math.min(1, (dot + 1) / 2));
};

const widthOf = (lines: readonly string[]): number => lines.reduce((max, line) => Math.max(max, line.length), 0);

// Avoid repeating the same variant twice in a row. The recent history
// is in-process only - no persistence - because the mascot now changes
// per submit, so cross-session history would saturate fast.
const HISTORY_KEEP = (() => {
  if (VARIANTS.length === 0) {
    return 0;
  }
  return Math.max(1, Math.floor(VARIANTS.length / 2));
})();

const pickFreshVariant = (recent: readonly number[]): number => {
  if (VARIANTS.length === 0) {
    return -1;
  }
  if (VARIANTS.length === 1) {
    return 0;
  }
  const seen = new Set(recent);
  const fresh: number[] = [];
  for (let i = 0; i < VARIANTS.length; i += 1) {
    if (!seen.has(i)) {
      fresh.push(i);
    }
  }
  const pool = fresh.length > 0 ? fresh : Array.from({ length: VARIANTS.length }, (_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)] ?? 0;
};

export const mascotWidth = (): number => {
  if (VARIANTS.length === 0) {
    return 0;
  }
  // Pin to the widest variant so the info column doesn't shift if today's
  // owl is narrower than yesterday's.
  return VARIANTS.reduce((max, v) => Math.max(max, widthOf(v)), 0);
};

// Height pinned to the tallest variant. Shorter variants get padded
// with empty rows at the TOP so the wing line always sits at the
// bottom row, aligned with the last row of the footer's info column.
const MASCOT_HEIGHT = VARIANTS.reduce((max, v) => Math.max(max, v.length), 0);

export const mascotHeight = (): number => MASCOT_HEIGHT;

interface IProps {
  readonly compact?: boolean;
  // Kept for backward compat with older banner call sites - ignored now,
  // because the variant is chosen per submit, not per agent.
  readonly agent?: string;
  /**
   * Caller-controlled bump counter. Each unique value picks a new
   * (non-repeating) variant and rotates the gradient angle by +90°.
   * App.tsx increments this on every user-input emit.
   */
  readonly bumpKey?: number;
}

interface ISpan {
  readonly text: string;
  readonly color: string;
}

// Render a single line as a list of contiguous spans. Adjacent
// characters with the same colour merge into one <Text>, so the render
// emits ~5-15 spans per row instead of one per character. Empty
// lines (used for vertical padding) emit one transparent space so
// Ink reserves a row of vertical space rather than collapsing the
// Box to zero height.
const lineToSpans = (line: string, y: number, w: number, h: number, angle: number): readonly ISpan[] => {
  if (line.length === 0) {
    return [{ text: " ", color: "transparent" }];
  }
  const spans: ISpan[] = [];
  let runText = "";
  let runColor = "";
  for (let x = 0; x < line.length; x += 1) {
    const ch = line[x] ?? "";
    if (ch === " ") {
      // Spaces have no visible glyph; keep them transparent (no colour
      // change costs an extra ANSI sequence we can avoid).
      if (runColor === "transparent") {
        runText += ch;
        continue;
      }
      if (runText.length > 0) {
        spans.push({ text: runText, color: runColor });
      }
      runText = ch;
      runColor = "transparent";
      continue;
    }
    const t = tForPosition(x, y, w, h, angle);
    const color = colorAt(t);
    if (color === runColor) {
      runText += ch;
      continue;
    }
    if (runText.length > 0) {
      spans.push({ text: runText, color: runColor });
    }
    runText = ch;
    runColor = color;
  }
  if (runText.length > 0) {
    spans.push({ text: runText, color: runColor });
  }
  return spans;
};

export const Mascot = ({ bumpKey = 0 }: IProps = {}) => {
  // Variant selection: roll on the FIRST mount, then re-roll any time
  // bumpKey changes. We track the recent set in a ref so successive
  // bumps don't repeat the same owl twice in a row.
  const recentRef = useRef<number[]>([]);
  const [variantIdx, setVariantIdx] = useState<number>(() => {
    const picked = pickFreshVariant([]);
    recentRef.current = [picked];
    return picked;
  });
  const lastSeenBump = useRef<number>(bumpKey);
  useEffect(() => {
    if (bumpKey === lastSeenBump.current) {
      return;
    }
    lastSeenBump.current = bumpKey;
    const picked = pickFreshVariant(recentRef.current);
    recentRef.current = [...recentRef.current, picked].slice(-HISTORY_KEEP);
    setVariantIdx(picked);
  }, [bumpKey]);

  // Gradient angle is deterministic from bumpKey: 0 → 0°, 1 → 90°,
  // 2 → 180°, 3 → 270°, 4 → 0°, ... Cycles every four submits.
  const angle = useMemo(() => ((bumpKey % 4) + 4) % 4 * 90, [bumpKey]);

  if (VARIANTS.length === 0) {
    return null;
  }
  const rawLines = VARIANTS[variantIdx] ?? VARIANTS[0] ?? [];
  // Pad short variants with empty rows on TOP so the wing always sits
  // on the last row. Keeps the footer's vertical layout uniform across
  // owl swaps.
  const padCount = Math.max(0, MASCOT_HEIGHT - rawLines.length);
  const lines = padCount === 0 ? rawLines : [...Array.from({ length: padCount }, () => ""), ...rawLines];
  const width = widthOf(lines);
  const height = lines.length;
  return (
    <Box flexDirection="column">
      {lines.map((line, lineIdx) => {
        const spans = lineToSpans(line, lineIdx, width, height, angle);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless static text
          <Box key={`logo-${lineIdx}`} flexDirection="row">
            {spans.map((seg, segIdx) => {
              if (seg.color === "transparent") {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stateless static text
                  <Text key={`seg-${segIdx}`}>{seg.text}</Text>
                );
              }
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: stateless static text
                <Text key={`seg-${segIdx}`} color={seg.color}>
                  {seg.text}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
};
