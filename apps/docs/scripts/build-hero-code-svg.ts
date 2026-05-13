/**
 * Embeds logo.txt mascot variants into apps/docs/public/hero-code.svg.
 * Matches playground mascot.tsx: wing regex segments + bodyPalette by row.
 * Hero cycles variants → fixed-height slot (`maxLinesAcrossVariants`) mimics a stable Ink column so 3-row
 * variants do not jump when swapping with 4-row ones.
 * Logo only: monospace, top-right gutter. Hero SVG clips sample `<text>` (`hero-code-main-clip`)
 * so lines never paint under the mascot.
 * Inner column fills slot height and packs rows from the bottom so the wing row (last line) stays on the same baseline across 3- vs 4-line variants.
 * Run: bun apps/docs/scripts/build-hero-code-svg.ts
 *
 * Hero timeline (generated): each mascot step shares one slice of normalized time — mascot swaps instantly at the
 * slice boundary; code rows swap at the slice midpoint so the owl leads, then options snap with **no opacity
 * crossfade** (stacked tspans otherwise cause ghosting). Tail matches docs `console.log(result…)`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, "..", "..", "..", "logo.txt");
const HERO_PATH = join(__dirname, "..", "public", "hero-code.svg");
/** Quoted for CSS font-family inside foreignObject */
const MONO_STACK_CSS =
  'Menlo, Monaco, Consolas, ui-monospace, SFMono-Regular, monospace';

const VIEW_WIDTH = 680;
const FO_RIGHT_MARGIN = 30;
/** Seconds per mascot step on normalized [0,1] (one slice per logo variant). */
const HERO_STEP_SEC = 3.5;
/** First mascot row sits just under title chrome; aligns with import row (~y=68 baseline). */
const FO_TOP = 54;
/** Fixed mascot column origin; independent from code clip width. */
const FO_X = 386;
const MASCOT_FONT_PX = 18;
/** Match terminal row stride — mascot.tsx uses one Ink row per logo line */
const MASCOT_LINE_HEIGHT = MASCOT_FONT_PX;

/** Tallest variant height in rows — hero cycles variants; slot height matches Ink column stability (mascot.tsx `lines.map`). */
const maxLinesAcrossVariants = (variants: readonly (readonly string[])[]): number =>
  variants.reduce((m, lines) => Math.max(m, lines.length), 0);

const COLOR_TUFT = "#fcd34d";
const COLOR_HEAD = "#4ade80";
const COLOR_FACE = "#38bdf8";
const COLOR_LEFT_WING = "#38bdf8";
const COLOR_BODY = "#6366f1";
const COLOR_RIGHT_WING = "#a855f7";

const WING_RE = /^(\s*)(ooO)(--)(\(_\))(--)(Ooo)(-*)(\s*)$/;
const WING_ALT_RE = /^(-+)(\\__U_\/)(-+)(\s*)$/;

interface ISegment {
  readonly text: string;
  readonly color: string;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isWingLine = (line: string): boolean => WING_RE.test(line) || WING_ALT_RE.test(line);

const wingSegments = (line: string): readonly ISegment[] => {
  const match = line.match(WING_RE);
  if (match) {
    const [, leadPad, leftWing, leftBar, body, rightBar, rightWing, tailDash, trailPad] = match;
    return [
      { text: leadPad ?? "", color: COLOR_FACE },
      { text: leftWing ?? "", color: COLOR_LEFT_WING },
      { text: leftBar ?? "", color: COLOR_BODY },
      { text: body ?? "", color: COLOR_BODY },
      { text: rightBar ?? "", color: COLOR_BODY },
      { text: rightWing ?? "", color: COLOR_RIGHT_WING },
      { text: tailDash ?? "", color: COLOR_RIGHT_WING },
      { text: trailPad ?? "", color: COLOR_RIGHT_WING },
    ].filter((seg) => seg.text.length > 0);
  }
  const altMatch = line.match(WING_ALT_RE);
  if (altMatch) {
    const [, leftBar, body, rightBar, trailPad] = altMatch;
    return [
      { text: leftBar ?? "", color: COLOR_LEFT_WING },
      { text: body ?? "", color: COLOR_BODY },
      { text: rightBar ?? "", color: COLOR_RIGHT_WING },
      { text: trailPad ?? "", color: COLOR_RIGHT_WING },
    ].filter((seg) => seg.text.length > 0);
  }
  return [{ text: line, color: COLOR_BODY }];
};

const bodyPaletteHex = (idxFromTop: number, wingIdx: number): string => {
  const fromBottom = wingIdx - idxFromTop;
  if (fromBottom <= 1) {
    return COLOR_FACE;
  }
  if (fromBottom === 2) {
    return COLOR_HEAD;
  }
  return COLOR_TUFT;
};

const wingLineInnerHtml = (segments: readonly ISegment[]): string =>
  segments.map((s) => `<span style="color:${s.color}">${escapeXml(s.text)}</span>`).join("");

const ROW_LINE_STYLE =
  'display:block;white-space:pre;width:max-content;flex-shrink:0';

/** Outer fills FO width; stretches inner full height so rows can anchor to slot bottom. */
const mascotOuterStyle = (slotRows: number): string =>
  [
    'margin:0',
    'padding:0',
    'box-sizing:border-box',
    'width:100%',
    `height:${slotRows * MASCOT_LINE_HEIGHT}px`,
    'overflow:hidden',
    'display:flex',
    'flex-direction:row',
    'justify-content:flex-end',
    'align-items:stretch',
    `font-family:${MONO_STACK_CSS}`,
    `font-size:${MASCOT_FONT_PX}px`,
    'font-weight:400',
    `line-height:${MASCOT_LINE_HEIGHT}px`,
    'letter-spacing:0',
    '-webkit-font-smoothing:antialiased',
    'font-variant-ligatures:none',
    'color:#cdd6f4',
  ].join(';');

/** Ink-style shared left edge; justify-end pins last logo row to bottom of fixed slot (rows 1–3 stack above row 4). */
const MASCOT_COLUMN_STYLE =
  'margin:0;padding:0;height:100%;width:max-content;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start';

const parseVariants = (): readonly (readonly string[])[] => {
  let raw = "";
  try {
    raw = readFileSync(LOGO_PATH, "utf-8").replace(/\n+$/, "");
  } catch {
    return [];
  }
  if (raw.length === 0) {
    return [];
  }
  const blocks = raw.split(/\n\s*\n+/);
  return blocks
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((l) => l.trim().length > 0));
};

const hashString = (value: string): number => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const shuffleIndices = (variants: readonly (readonly string[])[]): number[] => {
  const idx = Array.from({ length: variants.length }, (_, i) => i);
  let seed = hashString(variants.map((lines) => lines.join("\n")).join("\n\n"));
  const nextRandom = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j]!;
    idx[j] = tmp!;
  }
  return idx;
};

/** Samples along normalized cycle u ∈ [0, 1]; compressed into SMIL keyTimes/values. */
const HERO_TIMELINE_SAMPLES = 240;

const clamp01ch = (x: number): number => Math.min(1, Math.max(0, x));

const masterDurSec = (numSteps: number): number =>
  HERO_STEP_SEC * Math.max(1, numSteps);

/** Mascot palette rotates +90deg at each step boundary (mascot-only filter). */
const buildMascotHueRotateAnimate = (numSteps: number): string => {
  const steps = Math.max(1, numSteps);
  const values: string[] = [];
  const keyTimes: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i * 90) % 360;
    values.push(`${angle}`);
    keyTimes.push((i / steps).toFixed(6));
  }
  return `          <animate attributeName="values" dur="${masterDurSec(numSteps).toFixed(4)}s" repeatCount="indefinite" values="${values.join(";")}" keyTimes="${keyTimes.join(";")}" calcMode="discrete"/>`;
};

/** Mascot slot `j`: one owl per step — discrete cuts only (no stacked semi-transparent frames). */
const mascotOpacityAt = (u: number, j: number, n: number): number => {
  const steps = Math.max(1, n);
  const slice = 1 / steps;
  const uSafe = Math.min(1 - 1e-12, Math.max(0, u));
  const i = Math.min(steps - 1, Math.floor(uSafe / slice + 1e-12));
  return j === i ? 1 : 0;
};

/**
 * Code agent slot `k`: within mascot step `i`, first half keeps prior snippet `(i−1)%slots`, second half snaps to
 * `i%slots`. Step 0 is a special case: start with slot 0 so the first frame is not a stale "previous" slot.
 */
const codeOpacityAt = (u: number, k: number, nSteps: number, numAgents: number): number => {
  const steps = Math.max(1, nSteps);
  const agents = Math.max(1, numAgents);
  const slice = 1 / steps;
  const uSafe = Math.min(1 - 1e-12, Math.max(0, u));
  let i = Math.floor(uSafe / slice + 1e-12);
  if (i >= steps) {
    i = steps - 1;
  }
  const stepStart = i * slice;
  const phase = slice > 0 ? (uSafe - stepStart) / slice : 0;
  const prevIdx = (i - 1 + agents) % agents;
  const currIdx = i % agents;
  let activeIdx = phase < 0.5 ? prevIdx : currIdx;
  if (i === 0 && phase < 0.5) {
    activeIdx = currIdx;
  }
  return k === activeIdx ? 1 : 0;
};

const compressOpacityKeyframes = (
  samples: readonly number[],
): { readonly values: string; readonly keyTimes: string } => {
  const lastIdx = samples.length - 1;
  const ktOut: number[] = [];
  const valOut: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const v = clamp01ch(samples[i] ?? 0);
    const rounded = Math.round(v * 100_000) / 100_000;
    const t = lastIdx === 0 ? 1 : i / lastIdx;
    const prevVal = valOut[valOut.length - 1];

    if (i === 0 || i === lastIdx || prevVal !== rounded) {
      ktOut.push(t);
      valOut.push(rounded);
    }
  }

  return {
    values: valOut.map((x) => x.toFixed(5)).join(";"),
    keyTimes: ktOut.map((x) => x.toFixed(6)).join(";"),
  };
};

const buildSvgOpacityAnimate = (samples: readonly number[], durSec: number): string => {
  const { values, keyTimes } = compressOpacityKeyframes(samples);
  return `<animate attributeName="opacity" dur="${durSec.toFixed(4)}s" repeatCount="indefinite" values="${values}" keyTimes="${keyTimes}" calcMode="discrete"/>`;
};

const sampleMascotOpacity = (slotIndex: number, numSteps: number): number[] => {
  const n = Math.max(1, numSteps);
  const out: number[] = [];
  for (let i = 0; i <= HERO_TIMELINE_SAMPLES; i++) {
    const u = i / HERO_TIMELINE_SAMPLES;
    out.push(mascotOpacityAt(u, slotIndex, n));
  }
  return out;
};

const sampleCodeOpacity = (agentSlot: number, numSteps: number, numAgents: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i <= HERO_TIMELINE_SAMPLES; i++) {
    const u = i / HERO_TIMELINE_SAMPLES;
    out.push(codeOpacityAt(u, agentSlot, numSteps, numAgents));
  }
  return out;
};

const buildMascotTimelineAnimate = (slotIndex: number, numSteps: number): string =>
  buildSvgOpacityAnimate(sampleMascotOpacity(slotIndex, numSteps), masterDurSec(numSteps));

const buildCodeTimelineAnimate = (
  agentSlot: number,
  numSteps: number,
  numAgents: number,
): string =>
  buildSvgOpacityAnimate(sampleCodeOpacity(agentSlot, numSteps, numAgents), masterDurSec(numSteps));

const CODE_Y = {
  agentId: 172,
  prompt: 194,
  optionsOpen: 216,
  model: 238,
  permission: 260,
  maxCostUsd: 282,
  logText: 370,
  logCost: 392,
  logDurationMs: 414,
} as const;

interface IHeroCodeAgentRow {
  /** `TAgentId` first argument to `agents.ask()` */
  readonly agentId: string;
  readonly prompt: string;
  /** Value for `options.model` (`IAskOptions`); include quotes like `"gpt-5-codex"`. */
  readonly modelValue: string;
  readonly permissionValue: string;
  readonly maxCost: string;
  /** Trail comment after `console.log(result.text)` — matches getting-started illustrative style. */
  readonly textTrail: string;
  /** Numeric USD sample for `// …` after totalUsd (no `$`, matches docs examples). */
  readonly costTrail: string;
  /** Milliseconds sample after durationMs log. */
  readonly msTrail: string;
}

/** Hero cycling slots — agent ids + model ids mirror packages/agents-wire docs/tests. */
const CODE_AGENT_ROWS: readonly IHeroCodeAgentRow[] = [
  {
    agentId: "codex",
    prompt: '"Refactor src/auth.ts"',
    modelValue: '"gpt-5-codex"',
    permissionValue: '"auto-allow"',
    maxCost: "0.50",
    textTrail: '"Auth guards."',
    costTrail: "0.042",
    msTrail: "18420",
  },
  {
    agentId: "claude",
    prompt: '"Fix flaky tests/e2e/smoke.spec.ts"',
    modelValue: '"claude-opus-4-7"',
    permissionValue: '"deny-write"',
    maxCost: "0.25",
    textTrail: '"Stable e2e."',
    costTrail: "0.031",
    msTrail: "9120",
  },
  {
    agentId: "gemini",
    prompt: '"Summarize PR #482"',
    modelValue: '"gemini-2.5-pro"',
    permissionValue: '"prompt-cache"',
    maxCost: "0.10",
    textTrail: '"PR risks."',
    costTrail: "0.009",
    msTrail: "4230",
  },
  {
    agentId: "cursor",
    prompt: '"Migrate lodash → native"',
    modelValue: '"composer-2"',
    permissionValue: '"auto-allow"',
    maxCost: "1.00",
    textTrail: '"Tree-shaken."',
    costTrail: "subscription (totalUsd stays 0)",
    msTrail: "22680",
  },
];

const NUM_CODE_AGENTS = CODE_AGENT_ROWS.length;

const pushAnimatedRows = (
  lines: string[],
  rows: readonly IHeroCodeAgentRow[],
  animBySlot: readonly string[],
  buildLine: (row: IHeroCodeAgentRow, anim: string) => string,
): void => {
  for (let a = 0; a < rows.length; a += 1) {
    const row = rows[a]!;
    const anim = animBySlot[a]!;
    lines.push(buildLine(row, anim));
  }
};

const buildCyclingLayersXml = (numSteps: number): string => {
  const dur = masterDurSec(numSteps);
  const agents = CODE_AGENT_ROWS;
  const animBySlot = agents.map((_, a) =>
    buildCodeTimelineAnimate(a, numSteps, NUM_CODE_AGENTS),
  );
  const lines: string[] = [];

  lines.push(`    <!-- Hero code overlays: opacity timelines sync with mascot (${dur}s loop). -->`);

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) => {
    const agentLit = escapeXml(`"${row.agentId}"`);
    return `    <tspan x="44" y="${CODE_Y.agentId}" opacity="0"><tspan fill="#a6e3a1">${agentLit}</tspan><tspan fill="#cdd6f4">,</tspan>${anim}</tspan>`;
  });
  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="44" y="${CODE_Y.prompt}" opacity="0"><tspan fill="#a6e3a1">${escapeXml(row.prompt)}</tspan><tspan fill="#cdd6f4">,</tspan>${anim}</tspan>`,
  );

  lines.push(`    <tspan x="44" y="${CODE_Y.optionsOpen}" fill="#cdd6f4">{</tspan>`);

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="64" y="${CODE_Y.model}" fill="#cdd6f4" opacity="0"><tspan fill="#89dceb">model</tspan>: <tspan fill="#a6e3a1">${escapeXml(row.modelValue)}</tspan>,${anim}</tspan>`,
  );

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="64" y="${CODE_Y.permission}" fill="#cdd6f4" opacity="0">permission: <tspan fill="#a6e3a1">${escapeXml(row.permissionValue)}</tspan>,${anim}</tspan>`,
  );

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="64" y="${CODE_Y.maxCostUsd}" fill="#cdd6f4" opacity="0">maxCostUsd: <tspan fill="#fab387">${escapeXml(row.maxCost)}</tspan>,${anim}</tspan>`,
  );

  return lines.join("\n");
};

/** After `agents.ask(...);` — matches apps/docs/getting-started.md console lines. */
const buildCyclingConsoleXml = (numSteps: number): string => {
  const agents = CODE_AGENT_ROWS;
  const animBySlot = agents.map((_, a) =>
    buildCodeTimelineAnimate(a, numSteps, NUM_CODE_AGENTS),
  );
  const lines: string[] = [];

  lines.push(`    <!-- Hero console lines: same timeline as ask() overlays (${masterDurSec(numSteps)}s). -->`);

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="24" y="${CODE_Y.logText}" fill="#cdd6f4" opacity="0"><tspan fill="#cba6f7">console</tspan><tspan fill="#cdd6f4">.log(result.</tspan><tspan fill="#89dceb">text</tspan><tspan fill="#cdd6f4">);</tspan> <tspan fill="#9399b2">// ${escapeXml(row.textTrail)}</tspan>${anim}</tspan>`,
  );

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="24" y="${CODE_Y.logCost}" fill="#cdd6f4" opacity="0"><tspan fill="#cba6f7">console</tspan><tspan fill="#cdd6f4">.log(result.</tspan><tspan fill="#89dceb">cost</tspan><tspan fill="#cdd6f4">?.</tspan><tspan fill="#89dceb">totalUsd</tspan><tspan fill="#cdd6f4">);</tspan> <tspan fill="#9399b2">// ${escapeXml(row.costTrail)}</tspan>${anim}</tspan>`,
  );

  pushAnimatedRows(lines, agents, animBySlot, (row, anim) =>
    `    <tspan x="24" y="${CODE_Y.logDurationMs}" fill="#cdd6f4" opacity="0"><tspan fill="#cba6f7">console</tspan><tspan fill="#cdd6f4">.log(result.</tspan><tspan fill="#89dceb">durationMs</tspan><tspan fill="#cdd6f4">);</tspan> <tspan fill="#9399b2">// ${escapeXml(row.msTrail)}</tspan>${anim}</tspan>`,
  );

  return lines.join("\n");
};

/** Mascot-only hue-rotate filter; keeps background/static UI unchanged. */
const buildMascotDefs = (numSteps: number): string => {
  const hueAnim = buildMascotHueRotateAnimate(numSteps);
  return [
    `    <filter id="mascot-hue" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">`,
    `      <feColorMatrix type="hueRotate" values="0">`,
    hueAnim,
    `      </feColorMatrix>`,
    `    </filter>`,
  ].join("\n");
};

const renderVariantGroup = (
  lines: readonly string[],
  groupInner: string,
  foPixelWidth: number,
  slotRows: number,
): string => {
  let wingIdx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isWingLine(lines[i] ?? "")) {
      wingIdx = i;
      break;
    }
  }
  if (wingIdx === -1) {
    wingIdx = lines.length - 1;
  }
  const rowSpans: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx] ?? "";
    if (lineIdx === wingIdx) {
      const segments = wingSegments(line);
      rowSpans.push(`<span style="${ROW_LINE_STYLE}">${wingLineInnerHtml(segments)}</span>`);
    } else {
      const fill = bodyPaletteHex(lineIdx, wingIdx);
      const body = line.length > 0 ? escapeXml(line) : " ";
      rowSpans.push(`<span style="${ROW_LINE_STYLE};color:${fill}">${body}</span>`);
    }
  }
  const foPad = 8;
  const foHeight = slotRows * MASCOT_LINE_HEIGHT + foPad;
  const innerHtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="${mascotOuterStyle(slotRows)}"><div style="${MASCOT_COLUMN_STYLE}">${rowSpans.join("")}</div></div>`;
  const fo = [
    `      <foreignObject x="${FO_X}" y="${FO_TOP}" width="${foPixelWidth}" height="${foHeight}" overflow="hidden">`,
    `        ${innerHtml}`,
    `      </foreignObject>`,
  ].join("\n");
  return [`    <g opacity="0">`, fo, `      ${groupInner}`, `    </g>`].join("\n");
};

const buildMascotGroup = (variants: readonly (readonly string[])[]): string => {
  if (variants.length === 0) {
    return "  <!-- logo.txt missing or empty: no mascots -->";
  }
  const slotRows = Math.max(1, maxLinesAcrossVariants(variants));
  const foPixelWidth = VIEW_WIDTH - FO_RIGHT_MARGIN - FO_X;
  const order = shuffleIndices(variants).map((i) => variants[i] ?? []);
  const numSteps = Math.max(1, order.length);
  const inner = order
    .map((lines, j) =>
      renderVariantGroup(lines, buildMascotTimelineAnimate(j, numSteps), foPixelWidth, slotRows),
    )
    .join("\n");
  return [`  <g filter="url(#mascot-hue)">`, inner, `  </g>`].join("\n");
};

const VARIANTS = parseVariants();
const heroNumSteps = Math.max(1, VARIANTS.length);
let svg = readFileSync(HERO_PATH, "utf-8");
const defsRe = /(<!--BUILD_HERO:mascot_defs-->)[\s\S]*?(<!--BUILD_HERO:mascot_defs_end-->)/;
const groupRe = /(<!--BUILD_HERO:mascot_group-->)[\s\S]*?(<!--BUILD_HERO:mascot_group_end-->)/;
const cyclingRe =
  /(<!--BUILD_HERO:cycling_layers-->)[\s\S]*?(<!--BUILD_HERO:cycling_layers_end-->)/;
const cyclingConsoleRe =
  /(<!--BUILD_HERO:cycling_console-->)[\s\S]*?(<!--BUILD_HERO:cycling_console_end-->)/;
if (!defsRe.test(svg) || !groupRe.test(svg)) {
  throw new Error("hero-code.svg: missing BUILD_HERO mascot markers");
}
if (!cyclingRe.test(svg)) {
  throw new Error("hero-code.svg: missing BUILD_HERO:cycling_layers markers");
}
if (!cyclingConsoleRe.test(svg)) {
  throw new Error("hero-code.svg: missing BUILD_HERO:cycling_console markers");
}
svg = svg.replace(defsRe, (_m, start: string, end: string) => `${start}\n${buildMascotDefs(heroNumSteps)}\n    ${end}`);
svg = svg.replace(groupRe, (_m, start: string, end: string) => `${start}\n${buildMascotGroup(VARIANTS)}\n  ${end}`);
svg = svg.replace(
  cyclingRe,
  (_m, start: string, end: string) => `${start}\n${buildCyclingLayersXml(heroNumSteps)}\n    ${end}`,
);
svg = svg.replace(
  cyclingConsoleRe,
  (_m, start: string, end: string) => `${start}\n${buildCyclingConsoleXml(heroNumSteps)}\n    ${end}`,
);
writeFileSync(HERO_PATH, svg);
console.log(
  `hero-code.svg updated (${VARIANTS.length} mascot variants, ${NUM_CODE_AGENTS} code slots, ${masterDurSec(heroNumSteps)}s loop)`,
);
