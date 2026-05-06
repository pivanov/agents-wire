import { normalize, resolve, sep } from "node:path";

/**
 * @public
 * Containment check: returns true iff `targetPath` is `basePath` itself or
 * a path under it. Both arguments are normalized + resolved so `../`
 * traversals and relative paths are handled correctly.
 *
 * Forward-compat infra for features that persist files keyed by
 * agent-supplied paths (transcript directory, model-list cache, MCP
 * server `cwd` whitelist). No production caller today; the export is
 * marked `@public` so knip doesn't flag it as dead.
 */
export const isPathSafe = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
};
