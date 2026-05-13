import { isThemeId, type TThemeId } from "./palette";
import { loadStoredTheme } from "./store";

const OSC11_QUERY = "\x1b]11;?\x1b\\";
const OSC11_TIMEOUT_MS = 120;

const fromEnv = (): TThemeId | undefined => {
  const raw = process.env.AGENTS_WIRE_THEME;
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  return isThemeId(lower) ? lower : undefined;
};

const fromColorFgBg = (): TThemeId | undefined => {
  const raw = process.env.COLORFGBG;
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(";");
  const bgRaw = parts[parts.length - 1];
  if (!bgRaw) {
    return undefined;
  }
  const bg = Number.parseInt(bgRaw, 10);
  if (!Number.isFinite(bg)) {
    return undefined;
  }
  return bg <= 6 || bg === 8 ? "dark" : "light";
};

const luminanceFrom16Bit = (rHex: string, gHex: string, bHex: string): number => {
  const r = Number.parseInt(rHex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(gHex.slice(0, 2), 16) / 255;
  const b = Number.parseInt(bHex.slice(0, 2), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const queryOsc11 = (): Promise<TThemeId | undefined> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(undefined);
  }
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const cleanup = (): void => {
      stdin.removeListener("data", onData);
      try {
        if (!wasRaw) {
          stdin.setRawMode(false);
        }
      } catch {
        /* ignore */
      }
      if (wasPaused) {
        stdin.pause();
      }
    };
    const finish = (value: TThemeId | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("binary");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC byte is part of OSC framing
      const match = buffer.match(/\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/);
      if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
        const lum = luminanceFrom16Bit(match[1], match[2], match[3]);
        finish(lum < 0.5 ? "dark" : "light");
      }
    };
    try {
      stdin.setRawMode(true);
    } catch {
      resolve(undefined);
      return;
    }
    stdin.resume();
    stdin.on("data", onData);
    process.stdout.write(OSC11_QUERY);
    setTimeout(() => finish(undefined), OSC11_TIMEOUT_MS);
  });
};

export interface IThemeResolution {
  readonly theme: TThemeId;
  readonly source: "env" | "stored" | "auto" | "default";
}

export const resolveTheme = async (): Promise<IThemeResolution> => {
  const env = fromEnv();
  if (env) {
    return { theme: env, source: "env" };
  }
  const stored = loadStoredTheme();
  if (stored) {
    return { theme: stored, source: "stored" };
  }
  const fromBg = fromColorFgBg();
  if (fromBg) {
    return { theme: fromBg, source: "auto" };
  }
  const osc = await queryOsc11();
  if (osc) {
    return { theme: osc, source: "auto" };
  }
  return { theme: "dark", source: "default" };
};

export const resolveThemeSync = (): IThemeResolution => {
  const env = fromEnv();
  if (env) {
    return { theme: env, source: "env" };
  }
  const stored = loadStoredTheme();
  if (stored) {
    return { theme: stored, source: "stored" };
  }
  const fromBg = fromColorFgBg();
  if (fromBg) {
    return { theme: fromBg, source: "auto" };
  }
  return { theme: "dark", source: "default" };
};
