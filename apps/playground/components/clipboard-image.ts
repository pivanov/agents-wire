// macOS-only clipboard → temp PNG bridge. Bracketed paste with empty text
// is the signal that Cmd+V was pressed on a clipboard with image data.
// We probe via osascript and dump bytes to a temp PNG so the rest of the
// pipeline can treat it as a file path.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_SCRIPT = "the clipboard as «class PNGf»";

const buildSaveScript = (outPath: string): readonly string[] => [
  "-e",
  "set png_data to (the clipboard as «class PNGf»)",
  "-e",
  `set fp to open for access POSIX file "${outPath}" with write permission`,
  "-e",
  "write png_data to fp",
  "-e",
  "close access fp",
];

const tempImagePath = (): string => {
  const id = randomBytes(8).toString("hex");
  return join(tmpdir(), `agents-wire-clipboard-${id}.png`);
};

export const readClipboardImage = async (): Promise<string | null> => {
  if (process.platform !== "darwin") {
    return null;
  }
  const probe = spawnSync("osascript", ["-e", PROBE_SCRIPT], { encoding: "utf-8" });
  if (probe.status !== 0) {
    return null;
  }
  const outPath = tempImagePath();
  const save = spawnSync("osascript", buildSaveScript(outPath), { encoding: "utf-8" });
  if (save.status !== 0 || !existsSync(outPath)) {
    return null;
  }
  return outPath;
};
