// Recognize image file paths inside pasted text - Finder drag-drop deposits
// `/abs/path.png` (sometimes shell-escaped, sometimes quoted, sometimes
// space-separated for multiple files). We rewrite each detected image
// path as `@image:<path>`.
import { randomBytes } from "node:crypto";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const ABS_PATH_BOUNDARY_RE = / (?=\/|[A-Za-z]:\\)/;

const stripOuterQuotes = (s: string): string => {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
};

const stripShellEscapes = (s: string): string => {
  if (process.platform === "win32") {
    return s;
  }
  const salt = randomBytes(8).toString("hex");
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`;
  const withPlaceholder = s.replace(/\\\\/g, placeholder);
  const noEscapes = withPlaceholder.replace(/\\(.)/g, "$1");
  return noEscapes.replaceAll(placeholder, "\\");
};

const cleanCandidate = (raw: string): string => stripShellEscapes(stripOuterQuotes(raw.trim()));

export const extractImagePaths = (pastedText: string): string[] => {
  if (pastedText.length === 0) {
    return [];
  }
  const lines = pastedText
    .split(ABS_PATH_BOUNDARY_RE)
    .flatMap((part) => part.split("\n"))
    .map((line) => cleanCandidate(line))
    .filter((line) => line.length > 0);
  return lines.filter((line) => IMAGE_EXT_RE.test(line));
};
