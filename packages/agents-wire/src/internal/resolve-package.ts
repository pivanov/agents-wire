import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

// Build a require() rooted at THIS module at runtime. tsup's `shims: true`
// polyfills `import.meta.url` in CJS via `pathToFileURL(__filename)`, so this
// single line works in both ESM and CJS bundles. Avoid `typeof require` —
// tsup rewrites bare `require` in ESM into a broken Proxy shim.
const localRequire = createRequire(import.meta.url);

// Probe candidate directories for the npm "global" root the user
// installed packages into. Order matters: explicit env override
// first, then `npm root -g`, then a derived path under the running
// node binary (works for nvm / Volta / asdf), then conventional
// system locations. We cache the resolved value because shelling
// out to npm is slow (200-500ms) and runs at every probe otherwise.
let cachedGlobalRoot: string | null | undefined;

const tryNpmRootGlobal = (): string | undefined => {
  try {
    const out = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 })
      .toString()
      .trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
};

const tryDerivedFromExec = (): string | undefined => {
  // process.execPath is e.g. /Users/x/.nvm/versions/node/v22/bin/node
  // (or /opt/homebrew/bin/bun under Bun). The global node_modules
  // directory lives at <prefix>/lib/node_modules where prefix is two
  // levels up from the executable. Bun re-uses the user's npm prefix,
  // so this still works under `bun playground`.
  const exec = process.execPath;
  if (!exec) {
    return undefined;
  }
  const candidate = path.resolve(path.dirname(exec), "..", "lib", "node_modules");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return undefined;
};

const trySystemDefaults = (): readonly string[] => {
  const home = os.homedir();
  const candidates = [
    path.join("/usr", "local", "lib", "node_modules"),
    path.join("/opt", "homebrew", "lib", "node_modules"),
    path.join(home, ".npm-global", "lib", "node_modules"),
    path.join(home, ".local", "lib", "node_modules"),
  ];
  return candidates.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
};

const getGlobalRoots = (): readonly string[] => {
  if (cachedGlobalRoot !== undefined) {
    return cachedGlobalRoot === null ? [] : [cachedGlobalRoot];
  }
  const env = process.env.AGENTS_WIRE_GLOBAL_NODE_MODULES;
  if (env && env.length > 0 && fs.existsSync(env)) {
    cachedGlobalRoot = env;
    return [env];
  }
  const npm = tryNpmRootGlobal();
  if (npm && fs.existsSync(npm)) {
    cachedGlobalRoot = npm;
    return [npm];
  }
  const derived = tryDerivedFromExec();
  if (derived) {
    cachedGlobalRoot = derived;
    return [derived];
  }
  const fallbacks = trySystemDefaults();
  if (fallbacks.length > 0) {
    cachedGlobalRoot = fallbacks[0] ?? null;
    return fallbacks;
  }
  cachedGlobalRoot = null;
  return [];
};

const verifyResolvedPackage = (resolved: string, specifier: string): boolean => {
  // Walk up from the resolved entry file until we hit a package.json
  // whose name matches the requested specifier (or its scope/name root).
  // This guards against AGENTS_WIRE_GLOBAL_NODE_MODULES pointing at an
  // arbitrary directory that happens to contain a same-named file.
  const expectedName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : (specifier.split("/")[0] ?? specifier);
  let dir = path.dirname(resolved);
  for (let depth = 0; depth < 12; depth += 1) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { name?: unknown };
        if (parsed.name === expectedName) {
          return true;
        }
      } catch {
        /* malformed package.json; keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
  return false;
};

const tryResolveFromRoots = (roots: readonly string[], specifier: string): string | undefined => {
  for (const root of roots) {
    try {
      const fromGlobal = createRequire(path.join(root, "_"));
      const resolved = fromGlobal.resolve(specifier);
      if (verifyResolvedPackage(resolved, specifier)) {
        return resolved;
      }
    } catch {
      /* try next root */
    }
  }
  return undefined;
};

const resolveFromGlobal = (specifier: string): string => {
  const cached = tryResolveFromRoots(getGlobalRoots(), specifier);
  if (cached) {
    return cached;
  }
  // The cached global root may be stale (e.g. user just ran `npm i -g`
  // after we resolved the previous root). Invalidate and retry once
  // before declaring defeat.
  cachedGlobalRoot = undefined;
  const fresh = tryResolveFromRoots(getGlobalRoots(), specifier);
  if (fresh) {
    return fresh;
  }
  throw new Error(`global package not found: ${specifier}`);
};

export const resolvePackageEntry = (specifier: string): string => {
  // Don't add an `import.meta.resolve(specifier)` fast path here: bun's
  // CJS bundler can rewrite `import.meta.url` (static) but not a
  // runtime `import.meta.resolve()` call — the latter survives into
  // dist/cli.cjs and Node's CJS parser rejects the file with a
  // SyntaxError. localRequire.resolve covers both ESM and CJS.
  try {
    return localRequire.resolve(specifier);
  } catch {
    /* fall through to global lookup */
  }
  return resolveFromGlobal(specifier);
};

const resolveFromCwd = (specifier: string): string => {
  const fromCwd = createRequire(`${process.cwd()}/`);
  return fromCwd.resolve(specifier);
};

interface IPackageManifest {
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly main?: string;
}

const readManifest = (manifestPath: string): IPackageManifest => {
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw) as IPackageManifest;
};

export const resolvePackageBin = (packageName: string, binName?: string): string => {
  const manifestSpecifier = `${packageName}/package.json`;
  let manifestPath: string;
  try {
    manifestPath = resolveFromCwd(manifestSpecifier);
  } catch {
    // resolveFromCwd → resolvePackageEntry → resolveFromGlobal chain
    // covers local-workspace, SDK-bundled, and globally-installed
    // packages. Any thrown error here means the package truly isn't
    // reachable; the catalog probe surfaces that as `available: false`.
    manifestPath = resolvePackageEntry(manifestSpecifier);
  }
  const manifest = readManifest(manifestPath);
  const bin = manifest.bin;
  const packageDir = path.dirname(manifestPath);
  if (!bin) {
    throw new Error(`Package "${packageName}" has no bin field in package.json`);
  }
  if (typeof bin === "string") {
    return path.resolve(packageDir, bin);
  }
  const desired = binName ?? Object.keys(bin)[0];
  if (!desired) {
    throw new Error(`Package "${packageName}" has empty bin map`);
  }
  const relative = bin[desired];
  if (!relative) {
    throw new Error(`Package "${packageName}" has no bin entry for "${desired}"`);
  }
  return path.resolve(packageDir, relative);
};
