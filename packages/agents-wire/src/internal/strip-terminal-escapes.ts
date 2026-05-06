// Strip ANSI / OSC / DCS / C1 / control sequences from untrusted
// subprocess output before it lands in display strings (error messages,
// CLI passthrough). Defends against CVE-2003-0063-class terminal-emulator
// parser bugs and OSC-52 clipboard hijacking. ACP wire data is never
// sanitized — only display strings.
//
// All regexes intentionally contain control characters (that's the whole
// point of the module); biome's noControlCharactersInRegex is suppressed
// per-line.

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches OSC by design
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches DCS/PM/APC by design
const DCS_PM_APC_RE = /\x1b[P^_][\s\S]*?(?:\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches CSI by design
const CSI_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches simple ESC by design
const SIMPLE_ESC_RE = /\x1b[\x20-\x7e]/g;
const C1_RE = /[\x80-\x9f]/g;
// 0x09 (TAB) and 0x0a (LF) preserved so multiline log shapes survive.
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips C0 controls except TAB/LF by design
const CONTROL_RE = /[\x00-\x06\x07\x08\x0b\x0c\x0d-\x1a\x1c-\x1f\x7f]/g;

export const stripTerminalEscapes = (input: string): string =>
  input.replace(OSC_RE, "").replace(DCS_PM_APC_RE, "").replace(CSI_RE, "").replace(SIMPLE_ESC_RE, "").replace(C1_RE, "").replace(CONTROL_RE, "");
