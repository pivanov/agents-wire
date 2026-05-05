import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Search PATH for an executable; return the first absolute path that
 * exists and is a file, or undefined. Used as a last-resort fallback
 * for globally-installed CLIs whose package manager (pnpm, bun, Volta,
 * fnm, asdf) puts a bin shim on PATH but stores the package itself in
 * a private global root we can't enumerate via `npm root -g` or the
 * conventional system paths in resolve-package.ts.
 *
 * On Windows, also probes common extensions (.cmd, .exe, .bat) since
 * the on-disk file rarely matches the bare name.
 */
export const whichBin = (name: string): string | undefined => {
  const pathEnv = process.env.PATH ?? "";
  if (pathEnv.length === 0) {
    return undefined;
  }
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        /* skip unreadable entry */
      }
    }
  }
  return undefined;
};
