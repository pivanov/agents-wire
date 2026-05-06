// Strip ANSI / OSC / DCS / C1 / control sequences from untrusted
// subprocess output before it lands in error messages or terminal-bound
// CLI output. Defense against the CVE-2003-0063 family: a buggy or
// malicious agent emitting OSC 2 / OSC 52 / DCS sequences can rewrite
// the operator's terminal title, set clipboard contents, or trigger
// terminal-emulator parser bugs. ACP wire data (the JSON-RPC stream
// proper) is never sanitized — only stderr tails / display strings are.

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal-control matchers MUST contain control chars by design.
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: same reason
const DCS_PM_APC_RE = /\x1b[P^_][\s\S]*?(?:\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: same reason
const CSI_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: same reason
const SIMPLE_ESC_RE = /\x1b[\x20-\x7e]/g;
const C1_RE = /[\x80-\x9f]/g;
// 0x09 (TAB) and 0x0a (LF) deliberately preserved so multiline log
// shapes and indentation survive sanitization.
// biome-ignore lint/suspicious/noControlCharactersInRegex: same reason
const CONTROL_RE = /[\x00-\x06\x07\x08\x0b\x0c\x0d-\x1a\x1c-\x1f\x7f]/g;

export const stripTerminalEscapes = (input: string): string =>
  input.replace(OSC_RE, "").replace(DCS_PM_APC_RE, "").replace(CSI_RE, "").replace(SIMPLE_ESC_RE, "").replace(C1_RE, "").replace(CONTROL_RE, "");
