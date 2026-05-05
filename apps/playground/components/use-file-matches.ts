import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { useEffect, useState } from "react";

const MAX_DEPTH = 3;
const MAX_RESULTS = 20;
const ALWAYS_EXCLUDE = new Set<string>(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

interface ICache {
  cwd: string;
  paths: string[];
}

let cache: ICache | null = null;
let inflight: Promise<string[]> | null = null;

const readGitignoreSegments = async (cwd: string): Promise<Set<string>> => {
  try {
    const text = await readFile(join(cwd, ".gitignore"), "utf8");
    const out = new Set<string>();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#")) {
        continue;
      }
      if (line.startsWith("!") || line.includes("*") || line.includes("?")) {
        continue;
      }
      const stripped = line.replace(/^\/+/, "").replace(/\/+$/, "");
      if (stripped.length > 0 && !stripped.includes("/")) {
        out.add(stripped);
      }
    }
    return out;
  } catch {
    return new Set<string>();
  }
};

const walk = async (root: string, dir: string, depth: number, exclude: Set<string>, out: string[]): Promise<void> => {
  if (depth > MAX_DEPTH) {
    return;
  }
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") && name !== ".gitignore" && name !== ".env.example") {
      if (exclude.has(name)) {
        continue;
      }
    }
    if (exclude.has(name)) {
      continue;
    }
    const full = join(dir, name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        const s = await stat(full);
        isDir = s.isDirectory();
      } catch {
        continue;
      }
    }
    const rel = relative(root, full).split(sep).join("/");
    out.push(isDir ? `${rel}/` : rel);
    if (isDir) {
      await walk(root, full, depth + 1, exclude, out);
    }
  }
};

const loadPaths = async (cwd: string): Promise<string[]> => {
  if (cache !== null && cache.cwd === cwd) {
    return cache.paths;
  }
  if (inflight !== null) {
    return inflight;
  }
  inflight = (async (): Promise<string[]> => {
    const gitignored = await readGitignoreSegments(cwd);
    const exclude = new Set<string>([...ALWAYS_EXCLUDE, ...gitignored]);
    const collected: string[] = [];
    await walk(cwd, cwd, 0, exclude, collected);
    cache = { cwd, paths: collected };
    return collected;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};

const rankMatches = (paths: readonly string[], query: string): string[] => {
  const q = query.toLowerCase();
  const filtered: string[] = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (q.length === 0 || lower.includes(q)) {
      filtered.push(p);
    }
  }
  filtered.sort((a, b) => {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    const aStarts = q.length > 0 && al.startsWith(q) ? 0 : 1;
    const bStarts = q.length > 0 && bl.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) {
      return aStarts - bStarts;
    }
    return al.localeCompare(bl);
  });
  return filtered.slice(0, MAX_RESULTS);
};

interface IUseFileMatchesResult {
  readonly matches: readonly string[];
  readonly loading: boolean;
}

export const useFileMatches = (active: boolean, query: string, cwd: string): IUseFileMatchesResult => {
  const [paths, setPaths] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (cache !== null && cache.cwd === cwd) {
      setPaths(cache.paths);
      return;
    }
    let cancelled = false;
    void loadPaths(cwd).then((next) => {
      if (!cancelled) {
        setPaths(next);
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, [active, cwd]);

  if (!active || paths === null) {
    return { matches: [], loading: active };
  }
  return { matches: rankMatches(paths, query), loading: false };
};
