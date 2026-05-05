import type { ReactNode } from "react";
import { ThemedText as Text } from "@app/theme/themed-text";
import { CodeBlock } from "./code-block";

// Minimal inline markdown:
//   **bold**             → bold
//   *italic* / _italic_  → italic
//   `code`               → accent color (no bg, terminal-friendly)
//   [text](url)          → underlined text (url is rendered separately, dim)
// Block-level handling:
//   ``` fences           → CodeBlock (Shiki-highlighted, theme-aware)
//   # ## ### headings    → bold + accent
//   - / * list items     → preserved bullet, content goes through inline
//   blank lines          → preserved
//   everything else      → inline-rendered paragraph
//
// Not a full CommonMark - covers the common cases agents emit.

type TStyle = "plain" | "bold" | "italic" | "code" | "link";

interface ISegment {
  readonly text: string;
  readonly style: TStyle;
  readonly url?: string;
}

const pushPlain = (segs: ISegment[], text: string): void => {
  if (text.length === 0) {
    return;
  }
  const last = segs[segs.length - 1];
  if (last && last.style === "plain") {
    segs[segs.length - 1] = { text: last.text + text, style: "plain" };
    return;
  }
  segs.push({ text, style: "plain" });
};

const parseInline = (line: string): readonly ISegment[] => {
  const segs: ISegment[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const nx = line[i + 1];
    // `code`
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      if (end !== -1) {
        segs.push({ text: line.slice(i + 1, end), style: "code" });
        i = end + 1;
        continue;
      }
    }
    // **bold**
    if (ch === "*" && nx === "*") {
      const end = line.indexOf("**", i + 2);
      if (end !== -1) {
        segs.push({ text: line.slice(i + 2, end), style: "bold" });
        i = end + 2;
        continue;
      }
    }
    // *italic*
    if (ch === "*" && nx !== "*" && nx !== " ") {
      const end = line.indexOf("*", i + 1);
      if (end !== -1 && line[end - 1] !== " ") {
        segs.push({ text: line.slice(i + 1, end), style: "italic" });
        i = end + 1;
        continue;
      }
    }
    // _italic_
    if (ch === "_" && nx !== "_" && nx !== " ") {
      const end = line.indexOf("_", i + 1);
      if (end !== -1 && line[end - 1] !== " ") {
        segs.push({ text: line.slice(i + 1, end), style: "italic" });
        i = end + 1;
        continue;
      }
    }
    // [text](url)
    if (ch === "[") {
      const close = line.indexOf("]", i + 1);
      if (close !== -1 && line[close + 1] === "(") {
        const urlEnd = line.indexOf(")", close + 2);
        if (urlEnd !== -1) {
          segs.push({ text: line.slice(i + 1, close), style: "link", url: line.slice(close + 2, urlEnd) });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    pushPlain(segs, ch ?? "");
    i += 1;
  }
  return segs;
};

interface IMdProps {
  readonly text: string;
  readonly baseColor?: string;
}

const renderSegments = (segs: readonly ISegment[], baseColor: string): ReactNode => {
  return segs.map((seg, idx) => {
    if (seg.style === "code") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable inline render
        <Text key={`md-${idx}`} color="suggestion">
          {seg.text}
        </Text>
      );
    }
    if (seg.style === "bold") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable inline render
        <Text key={`md-${idx}`} color={baseColor} bold>
          {seg.text}
        </Text>
      );
    }
    if (seg.style === "italic") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable inline render
        <Text key={`md-${idx}`} color={baseColor} italic>
          {seg.text}
        </Text>
      );
    }
    if (seg.style === "link") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable inline render
        <Text key={`md-${idx}`} color="suggestion" underline>
          {seg.text}
        </Text>
      );
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: stable inline render
      <Text key={`md-${idx}`} color={baseColor}>
        {seg.text}
      </Text>
    );
  });
};

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)([-*])\s+(.*)$/;
const FENCE_RE = /^```(\w*)\s*$/;

type TBlock =
  | { readonly kind: "line"; readonly text: string }
  | { readonly kind: "code"; readonly lang: string; readonly code: string };

// Walk lines collecting fenced code blocks into atomic ``code`` blocks
// and leaving everything else as ``line`` blocks. Streaming partial
// markdown — where the closing fence hasn't arrived yet — falls into
// the unterminated branch and renders as plain code (no language
// guessing, no half-tokenized output flickering as more chars stream).
const collectBlocks = (text: string): readonly TBlock[] => {
  const lines = text.split("\n");
  const blocks: TBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const inner = lines[j] ?? "";
        if (FENCE_RE.test(inner) && inner.trim() === "```") {
          closed = true;
          break;
        }
        buf.push(inner);
        j += 1;
      }
      if (closed) {
        blocks.push({ kind: "code", lang, code: buf.join("\n") });
        i = j + 1;
        continue;
      }
      // Unterminated fence — show as plain code without highlighting so
      // it doesn't flicker on every streaming token.
      blocks.push({ kind: "code", lang: "", code: buf.join("\n") });
      i = lines.length;
      continue;
    }
    blocks.push({ kind: "line", text: line });
    i += 1;
  }
  return blocks;
};

interface IBlockProps {
  readonly children?: ReactNode;
}

const BlockRow = ({ children }: IBlockProps) => (
  <Text wrap="wrap">{children}</Text>
);

export const Markdown = ({ text, baseColor = "text" }: IMdProps) => {
  const blocks = collectBlocks(text);
  return (
    <>
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable for a given render
            <CodeBlock key={`md-block-${idx}`} code={block.code} language={block.lang} />
          );
        }
        const line = block.text;
        const headMatch = HEADING_RE.exec(line);
        if (headMatch) {
          const body = headMatch[2] ?? "";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable for a given render
            <BlockRow key={`md-block-${idx}`}>
              <Text color="accent" bold>
                {body}
              </Text>
            </BlockRow>
          );
        }
        const listMatch = LIST_RE.exec(line);
        if (listMatch) {
          const indent = listMatch[1] ?? "";
          const body = listMatch[3] ?? "";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable for a given render
            <BlockRow key={`md-block-${idx}`}>
              <Text color={baseColor}>{`${indent}• `}</Text>
              {renderSegments(parseInline(body), baseColor)}
            </BlockRow>
          );
        }
        if (line.length === 0) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable for a given render
            <Text key={`md-block-${idx}`}>{" "}</Text>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: block order is stable for a given render
          <BlockRow key={`md-block-${idx}`}>{renderSegments(parseInline(line), baseColor)}</BlockRow>
        );
      })}
    </>
  );
};
