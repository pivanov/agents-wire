// OSC 8 hyperlinks - wraps text so supporting terminals render it as a
// clickable link. The wrapper text is just `<ESC>]8;;<url><BEL><text>
// <ESC>]8;;<BEL>`, which non-supporting terminals print as plain text
// (the ANSI sequence chars are non-printable). We allowlist known-good
// terminals to avoid leaking junk into older ones.

const OSC8_START = "\x1b]8;;";
const OSC8_END = "\x07";

const detectSupport = (): boolean => {
  if (process.env.FORCE_HYPERLINK === "1") {
    return true;
  }
  if (process.env.NO_HYPERLINK === "1") {
    return false;
  }
  const term = process.env.TERM_PROGRAM ?? "";
  if (term === "iTerm.app" || term === "WezTerm" || term === "vscode" || term === "ghostty" || term === "Apple_Terminal") {
    return true;
  }
  if (process.env.WT_SESSION) {
    return true;
  }
  return false;
};

let cached: boolean | null = null;
const supportsHyperlinks = (): boolean => {
  if (cached === null) {
    cached = detectSupport();
  }
  return cached;
};

/**
 * Wraps `content` (or `url` if not given) in an OSC 8 hyperlink so the
 * terminal renders it clickable. Color/styling is left to the caller -
 * combine with Ink's `<Text>` props.
 */
export const createPlainHyperlink = (url: string, content?: string): string => {
  if (!supportsHyperlinks()) {
    return content ?? url;
  }
  const display = content ?? url;
  return `${OSC8_START}${url}${OSC8_END}${display}${OSC8_START}${OSC8_END}`;
};
