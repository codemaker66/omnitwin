// Resolves meshoptimizer the way tools/grand-hall-survey/modules.mjs does: from the workspace
// package that already depends on it (packages/reconstruction-foundry), so the build needs no
// install of its own. SURVEYED_ROOMS_NODE_ROOT names another checkout to resolve from (tests
// borrow an installed one when this worktree has no node_modules); build-room.py records it in
// the ledger (gate B22) and refuses it together with --publish, and nodeRecord() says which
// meshoptimizer a GHR1 file was simplified with.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.env.SURVEYED_ROOMS_NODE_ROOT;
const foundryPackage = root
  ? pathToFileURL(join(resolve(root), "packages", "reconstruction-foundry", "package.json"))
  : new URL("../../packages/reconstruction-foundry/package.json", import.meta.url);
const foundry = createRequire(foundryPackage);

/** meshoptimizer's ES module, resolved by the foundry package. */
export const meshoptimizer = () => import(pathToFileURL(foundry.resolve("meshoptimizer")).href);
/** Where meshoptimizer resolved from (for the build record). */
export const meshoptimizerPath = () => foundry.resolve("meshoptimizer");

/** The build record's node entry: whether the override was set, and meshoptimizer's version (from
 *  the nearest package.json named meshoptimizer above its entry point) and entry point, relative
 *  to this checkout (null when it resolved outside it), so a published record names no local path. */
export function nodeRecord() {
  const entry = meshoptimizerPath();
  let version = null;
  for (let dir = dirname(entry); version === null && dirname(dir) !== dir; dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.name === "meshoptimizer") version = json.version;
    }
  }
  const inCheckout = relative(fileURLToPath(new URL("../../", import.meta.url)), entry);
  const local = inCheckout.startsWith("..") || isAbsolute(inCheckout) ? null : inCheckout.split(sep).join("/");
  return { nodeRoot: root ? "set" : null, node: process.version, meshoptimizer: { version, entry: local } };
}
