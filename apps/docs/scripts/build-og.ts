/**
 * Build script: generates apps/docs/public/og.png (1200x630)
 * Run: bun apps/docs/scripts/build-og.ts
 *
 * Layout is fixed (do not restructure). This file controls only the
 * colour palette + styling. OG previews render at thumbnail size in
 * social feeds, so contrast is non-negotiable: every text element
 * must read at 240px wide.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../public/og.png");

const W = 1200;
const H = 630;

const OG_SITE_HOST = "agents-wire.dev";

// Lucide-style heart path; avoids emoji metric drift in resvg.
const HEART_PATH =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z";

const OG_STATS_GROUP_Y = 394;
const OG_AGENT_LIST_Y = OG_STATS_GROUP_Y;
const OG_AGENT_LIST_LEADING = 36;
const OG_AGENT_LIST_FONT_SIZE = 26;

const OG_FOOTER_X = 116;
const OG_FOOTER_Y = H - 72;
const OG_FOOTER_HEART_SCALE = 1.95;
const OG_FOOTER_HEART_PIVOT_X = 21;
const OG_FOOTER_LABEL_X = 54;
const OG_FOOTER_LABEL_SIZE = 30;

const ORB_CX = W - 80;
const ORB_CY = H - 67;

const INNER_X = 32;
const INNER_Y = 32;
const INNER_W = W - 64;
const INNER_H = H - 64;
const INNER_PAD_TOP_H = 20;

// Palette: punched up for OG legibility.
//   - Wordmark: pure white, no off-white drift.
//   - Tagline: bright lavender (#dbeafe → #e0e7ff family) instead of
//     muddy gray-mauve so it doesn't disappear at thumbnail scale.
//   - Stat numerals: high-saturation indigo→fuchsia gradient.
//   - Agent list: light periwinkle for readability against the dark bg.
//   - Eyebrow URL: bright accent so it carries weight at the top.
const COLOR_WORDMARK = "#ffffff";
const COLOR_EYEBROW = "#a5b4fc";
const COLOR_TAGLINE = "#e0e7ff";
const COLOR_STAT_LABEL = "#ddd6fe";
const COLOR_STAT_SUB = "#a5b4fc";
const COLOR_AGENT_LIST = "#64748b"; // darker slate or add opacity (slate-500)
const COLOR_FOOTER_LABEL = "#e2e8f0";
const COLOR_HEART = "#f43f5e";

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Background: deeper base so coloured text pops harder. -->
    <linearGradient id="bgBase" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0" stop-color="#020108"/>
      <stop offset="0.42" stop-color="#0d0a22"/>
      <stop offset="1" stop-color="#040217"/>
    </linearGradient>
    <radialGradient id="bgWashTL" cx="22%" cy="18%" r="58%">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.55"/>
      <stop offset="0.42" stop-color="#6366f1" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgWashBR" cx="88%" cy="82%" r="52%">
      <stop offset="0" stop-color="#d946ef" stop-opacity="0.34"/>
      <stop offset="0.52" stop-color="#c084fc" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#c084fc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgVignette" cx="50%" cy="46%" r="74%">
      <stop offset="0.52" stop-color="#020617" stop-opacity="0"/>
      <stop offset="1" stop-color="#020617" stop-opacity="0.78"/>
    </radialGradient>

    <!-- Frame: full-perimeter gradient. Indigo top-left, deeper violet -->
    <!-- bottom-right, with a fuchsia kiss in the corners so the rounded -->
    <!-- border carries the whole visual accent (no separate top ribbon). -->
    <linearGradient id="frameStroke" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="0.28" stop-color="#6366f1"/>
      <stop offset="0.62" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#d946ef"/>
    </linearGradient>

    <!-- Soft outer halo so the gradient border feels lit, not pasted on. -->
    <filter id="frameGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>

    <!-- Stat numeral gradient: more saturated. -->
    <linearGradient id="numberGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c7d2fe"/>
      <stop offset="0.55" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#e879f9"/>
    </linearGradient>

    <!-- Orb -->
    <radialGradient id="orbJewel" cx="34%" cy="30%" r="70%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.26" stop-color="#ddd6fe"/>
      <stop offset="0.58" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#3b1075"/>
    </radialGradient>
    <linearGradient id="orbRing" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0" stop-color="#fae8ff"/>
      <stop offset="0.45" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
    <filter id="orbBloom" x="-90%" y="-90%" width="280%" height="280%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="16"/>
    </filter>
  </defs>

  <!-- Background stack -->
  <rect width="${W}" height="${H}" fill="url(#bgBase)"/>
  <rect width="${W}" height="${H}" fill="url(#bgWashTL)"/>
  <rect width="${W}" height="${H}" fill="url(#bgWashBR)"/>
  <rect width="${W}" height="${H}" fill="url(#bgVignette)"/>

  <!-- Outer halo: soft bloom under the frame so the gradient border -->
  <!-- looks lit instead of stuck on. Drawn first, behind the crisp stroke. -->
  <rect
    x="${INNER_X}"
    y="${INNER_Y}"
    width="${INNER_W}"
    height="${INNER_H}"
    rx="22"
    fill="none"
    stroke="url(#frameStroke)"
    stroke-width="6"
    stroke-opacity="0.35"
    filter="url(#frameGlow)"
  />

  <!-- Crisp gradient border (the only accent now; no top ribbon). -->
  <rect
    x="${INNER_X}"
    y="${INNER_Y}"
    width="${INNER_W}"
    height="${INNER_H}"
    rx="22"
    fill="none"
    stroke="url(#frameStroke)"
    stroke-width="2.25"
  />

  <!-- Eyebrow URL -->
  <text
    x="80"
    y="120"
    font-family="${SANS}"
    font-size="36"
    font-weight="600"
    letter-spacing="0.02em"
    fill="${COLOR_EYEBROW}"
  >${OG_SITE_HOST}</text>

  <!-- Wordmark -->
  <text
    x="80"
    y="240"
    font-family="${SANS}"
    font-size="100"
    font-weight="800"
    letter-spacing="-5"
    fill="${COLOR_WORDMARK}"
  >@pivanov/agents-wire</text>

  <!-- Tagline -->
  <text
    x="80"
    y="320"
    font-family="${SANS}"
    font-size="40"
    font-weight="500"
    fill="${COLOR_TAGLINE}"
    letter-spacing="0"
  >One SDK for every local coding agent.</text>

  <!-- Number block: 12 agents / one TypeScript API -->
  <g transform="translate(80, ${OG_STATS_GROUP_Y})">
    <text
      x="0"
      y="100"
      font-family="${SANS}"
      font-size="180"
      font-weight="800"
      letter-spacing="-8"
      fill="url(#numberGrad)"
    >12</text>
    <text
      x="220"
      y="0"
      font-family="${SANS}"
      font-size="26"
      font-weight="700"
      fill="${COLOR_STAT_LABEL}"
      letter-spacing="0"
    >agents</text>
    <text
      x="220"
      y="40"
      font-family="${SANS}"
      font-size="26"
      font-weight="500"
      fill="${COLOR_STAT_SUB}"
      letter-spacing="0"
    >one TypeScript API</text>
  </g>

  <!-- Right-side agent list: 4 rows of 3 -->
  <text x="${W - 80}" y="${OG_AGENT_LIST_Y}" text-anchor="end" font-family="${MONO}" font-size="${OG_AGENT_LIST_FONT_SIZE}" fill="${COLOR_AGENT_LIST}" font-weight="500" letter-spacing="0.5">claude  ·  codex  ·  cursor</text>
  <text x="${W - 80}" y="${OG_AGENT_LIST_Y + OG_AGENT_LIST_LEADING}" text-anchor="end" font-family="${MONO}" font-size="${OG_AGENT_LIST_FONT_SIZE}" fill="${COLOR_AGENT_LIST}" font-weight="500" letter-spacing="0.5">copilot  ·  gemini  ·  opencode</text>
  <text x="${W - 80}" y="${OG_AGENT_LIST_Y + OG_AGENT_LIST_LEADING * 2}" text-anchor="end" font-family="${MONO}" font-size="${OG_AGENT_LIST_FONT_SIZE}" fill="${COLOR_AGENT_LIST}" font-weight="500" letter-spacing="0.5">droid  ·  pi  ·  cline</text>
  <text x="${W - 80}" y="${OG_AGENT_LIST_Y + OG_AGENT_LIST_LEADING * 3}" text-anchor="end" font-family="${MONO}" font-size="${OG_AGENT_LIST_FONT_SIZE}" fill="${COLOR_AGENT_LIST}" font-weight="500" letter-spacing="0.5">kilo  ·  qwen  ·  auggie</text>

  <!-- Footer -->
  <g transform="translate(${OG_FOOTER_X}, ${OG_FOOTER_Y})">
    <g transform="translate(${OG_FOOTER_HEART_PIVOT_X}, 0) scale(${OG_FOOTER_HEART_SCALE}) translate(-12, -12)">
      <path fill="${COLOR_HEART}" d="${HEART_PATH}"/>
    </g>
    <text
      x="${OG_FOOTER_LABEL_X}"
      y="0"
      dominant-baseline="middle"
      font-family="${SANS}"
      font-size="${OG_FOOTER_LABEL_SIZE}"
      font-weight="600"
      fill="${COLOR_FOOTER_LABEL}"
      letter-spacing="0.5"
    >Supported by LogicStar AI</text>
  </g>

  <!-- Accent orb -->
  <circle cx="${ORB_CX}" cy="${ORB_CY}" r="32" fill="url(#orbJewel)" opacity="0.22" filter="url(#orbBloom)"/>
  <circle cx="${ORB_CX}" cy="${ORB_CY}" r="11.5" fill="none" stroke="url(#orbRing)" stroke-width="1.4" opacity="0.85"/>
  <circle cx="${ORB_CX}" cy="${ORB_CY}" r="6.5" fill="url(#orbJewel)"/>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
});

const pngRaw = resvg.render().asPng();
const pngBuffer = await sharp(Buffer.from(pngRaw))
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

writeFileSync(OUT_PATH, pngBuffer);
console.log(`OG image written to ${OUT_PATH} (${pngBuffer.byteLength} bytes)`);
