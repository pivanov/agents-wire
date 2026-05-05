import { useStdin } from "ink";
import { useEffect } from "react";

// Terminal-mode escape sequences. ENABLE_* turns on extended key
// encodings; the matching DISABLE_* must run on app exit so the user's
// shell isn't left in raw mode.
const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";
const ENABLE_MODIFY_OTHER_KEYS = "\x1b[>4;2m";
const DISABLE_MODIFY_OTHER_KEYS = "\x1b[>4;0m";
const ENABLE_KITTY_KEYBOARD = "\x1b[>1u";
const DISABLE_KITTY_KEYBOARD = "\x1b[<u";

/**
 * Owns the terminal raw-mode + extended-key-encoding setup for the
 * lifetime of the app. Mount this hook ONCE at the App root.
 *
 * Why not in PromptBox? Each `process.stdout.write(...)` here bypasses
 * Ink's render pipeline. Ink tracks how much it has written to stdout
 * so its next render can cursor-up by that amount and overwrite
 * in place. When stdout is touched outside Ink, that tracking goes
 * stale and the next render lands at the wrong position - leaving
 * stranded "orphan" frames stacked in the terminal. PromptBox unmounts
 * and remounts on every dialog open/close, so doing the setup there
 * means an orphan per dialog cycle (visible as multiple `❯ ┃ █`
 * lines stacked). Hoisted to the App, the writes happen exactly twice
 * per session (boot + cleanup) and never during a dialog flow.
 */
export const useTerminalRawMode = (): void => {
  const { setRawMode, isRawModeSupported } = useStdin();
  useEffect(() => {
    if (!isRawModeSupported) {
      return;
    }
    setRawMode(true);
    process.stdout.write(ENABLE_BRACKETED_PASTE);
    process.stdout.write(ENABLE_MODIFY_OTHER_KEYS);
    process.stdout.write(ENABLE_KITTY_KEYBOARD);
    return (): void => {
      process.stdout.write(DISABLE_KITTY_KEYBOARD);
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdout.write(DISABLE_MODIFY_OTHER_KEYS);
      setRawMode(false);
    };
  }, [setRawMode, isRawModeSupported]);
};
