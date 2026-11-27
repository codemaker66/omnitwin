// ---------------------------------------------------------------------------
// The API's route table, read from Fastify's own tree, for the tests that
// walk every route (routes-inventory.test.ts, pricing-public-read-postgres).
// ---------------------------------------------------------------------------

/**
 * Parse the output of Fastify's `printRoutes({ commonPrefix: false })`.
 * The tree is indented in 4-character units per hierarchy level, with
 * `├──`/`└──`/`│  ` prefixing each line. A child line's full path is
 * the concatenation of every ancestor's path fragment plus its own. One
 * parameter known by two names across routes prints as `:id|:venueId`.
 */
export function extractRoutes(tree: string): ReadonlySet<string> {
  const routes = new Set<string>();
  const prefixStack: string[] = []; // prefixStack[depth] = accumulated path

  for (const rawLine of tree.split("\n")) {
    const methodMatch = /\(([A-Z, ]+)\)\s*$/.exec(rawLine);
    if (methodMatch === null) continue;

    // The tree characters precede a branch marker like "├── ". Find the
    // offset at which the actual path fragment begins.
    const branchMatch = /([├└]── )/.exec(rawLine);
    const pathStart = branchMatch !== null
      ? branchMatch.index + branchMatch[0].length
      : 0;
    // Depth inferred from the prefix width (4 chars per level in
    // Fastify's output).
    const depth = branchMatch !== null ? Math.floor(branchMatch.index / 4) : 0;

    const fragment = rawLine.slice(pathStart, methodMatch.index).trim();
    if (fragment.length === 0) continue;

    // Build full path by concatenating the fragment onto the parent
    // prefix. The root level (depth 0) uses no parent.
    const parent = depth > 0 ? (prefixStack[depth - 1] ?? "") : "";
    const fullPath = joinTreePath(parent, fragment);
    prefixStack[depth] = fullPath;
    // Truncate any stale deeper entries (we've moved back up the tree).
    prefixStack.length = depth + 1;

    // Skip the synthetic "/" lines Fastify emits between a parent and
    // its children — they represent the parent's own terminal route
    // which printRoutes has already emitted under the parent line.
    if (fragment === "/") continue;

    const methods = methodMatch[1]?.split(",").map((m) => m.trim()) ?? [];
    for (const method of methods) {
      routes.add(`${method} ${fullPath}`);
    }
  }
  return routes;
}

/** A child's fragment continues its parent's path as it stands: Fastify's
 *  radix tree carries every "/" itself, in a fragment or as a "/" node, and
 *  splits a segment where routes share a prefix ("/pricing" then "-desk"
 *  for /pricing-desk), so a separator added here would invent a path. */
function joinTreePath(parent: string, fragment: string): string {
  return parent + fragment;
}
