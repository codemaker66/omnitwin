import { createReadStream, realpathSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { Plugin } from "vite";

// ---------------------------------------------------------------------------
// Dev-only static serving for staged splat tiles and room packages.
//
// Roughly a gigabyte of captured tiles across the eight Trades Hall rooms is
// staged outside the repository, so it cannot live in `public/`. A room's
// floor-skin package (T-639) is staged alongside them. In development this
// middleware serves both from the staging root; preview builds read the same
// tile and package names from the public R2 bucket via VITE_SPLAT_BASE_URL,
// and production stays on its own held "/splats" path (see vite.config.ts).
//
// It is a dev server middleware only. It never runs in a build, and it refuses
// any path that escapes the staging root.
// ---------------------------------------------------------------------------

/** URL prefix the web app requests tiles under. */
const SPLAT_URL_PREFIX = "/splats/";

/**
 * Splat tile extensions this middleware will serve anywhere under the
 * staging root. `.rad` is Spark's prebuilt level-of-detail tree and `.radc`
 * its streamed chunk; both are staged next to the tiles they were built from.
 * See PACKAGE_EXTENSIONS below for the floor-skin package's file types, which
 * are only served inside a `floor-skin` directory.
 */
const SERVABLE_EXTENSIONS = [".sog", ".spz", ".ply", ".splat", ".ksplat", ".rad", ".radc"] as const;

const CONTENT_TYPE = "application/octet-stream";

/**
 * A room's floor-skin package (T-639) is staged beside its tiles as
 * `<venue>/<room>/floor-skin/<version>/`, and these are its only file types.
 */
const PACKAGE_DIRECTORY = "floor-skin";
const PACKAGE_EXTENSIONS = [".json", ".webp", ".i16", ".u8"] as const;

/** Whether `filePath` has one of the floor-skin package's extensions. Shared
 * by the resolver's directory gate below and the middleware's Cache-Control
 * choice, so the extension list is tested in exactly one place. */
function hasPackageExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return PACKAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Resolves a request path to a file inside the staging root, or null.
 *
 * Rejects traversal, null bytes, and anything that normalises to outside the
 * root. Exported so the containment rule is testable without standing up a dev
 * server.
 */
export function resolveStagedSplatPath(root: string, urlPath: string): string | null {
  if (!urlPath.startsWith(SPLAT_URL_PREFIX)) return null;

  let relative: string;
  try {
    relative = decodeURIComponent(urlPath.slice(SPLAT_URL_PREFIX.length));
  } catch {
    return null;
  }
  if (relative.length === 0) return null;
  if (relative.includes("\0")) return null;

  const resolvedRoot = normalize(root);
  const candidate = normalize(join(resolvedRoot, relative));

  // Containment check with the separator appended, so a sibling directory
  // named like the root ("/rootEvil" against "/root") cannot pass as a child.
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (!candidate.startsWith(rootWithSep)) return null;

  const lower = candidate.toLowerCase();
  if (SERVABLE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return candidate;

  // A package extension is accepted only inside a floor-skin directory, and
  // only judged after normalisation above: "floor-skin/../x.json" collapses
  // to a sibling of floor-skin/ before this check ever sees it, so a dot
  // segment cannot borrow the directory's permission.
  if (hasPackageExtension(candidate)) {
    const relativeToRoot = candidate.slice(rootWithSep.length);
    const directorySegments = relativeToRoot.split(sep).slice(0, -1);
    if (directorySegments.includes(PACKAGE_DIRECTORY)) return candidate;
  }

  return null;
}

/**
 * Whether `candidate` is still inside `root` once links are resolved.
 *
 * The lexical check in `resolveStagedSplatPath` compares strings, which a
 * directory junction defeats: `mklink /J` needs no administrator rights on
 * Windows, and a junction placed inside the staging root makes
 * `<root>/link/loot.ply` look contained while actually resolving elsewhere on
 * disk. So the real path is resolved and the containment re-checked before any
 * bytes are read.
 *
 * Returns false when either path cannot be resolved — a tile that is not there
 * is not served, and an unresolvable path is never given the benefit of doubt.
 */
export function isRealPathContained(root: string, candidate: string): boolean {
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = realpathSync(root);
    realCandidate = realpathSync(candidate);
  } catch {
    return false;
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  return realCandidate.startsWith(rootWithSep);
}

/**
 * The Content-Type header for a resolved staged path. A splat tile has no
 * meaningful MIME type beyond "opaque bytes Spark decodes itself", but the
 * floor-skin package's `.json` and `.webp` files must be labelled correctly
 * for `fetch()` and the browser to decode them as what they are.
 */
export function stagedContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".webp")) return "image/webp";
  return CONTENT_TYPE;
}

/**
 * Serves staged splat tiles in development.
 *
 * `stagingRoot` normally comes from the SPLAT_STAGING_ROOT environment
 * variable. When it is absent the plugin does nothing at all, so a checkout
 * with no staged tiles still starts — the app falls back to its procedural
 * scene rather than failing to boot.
 */
export function splatStagingPlugin(stagingRoot: string | undefined): Plugin | null {
  const root = stagingRoot?.trim() ?? "";
  if (root.length === 0) return null;

  return {
    name: "omnitwin-splat-staging",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = (req.url ?? "").split("?")[0] ?? "";
        const filePath = resolveStagedSplatPath(root, urlPath);
        if (filePath === null) {
          next();
          return;
        }

        // Lexical containment is not enough: re-check after resolving links.
        if (!isRealPathContained(root, filePath)) {
          next();
          return;
        }

        let size: number;
        try {
          const stats = statSync(filePath);
          if (!stats.isFile()) {
            next();
            return;
          }
          size = stats.size;
        } catch {
          // Not staged. Fall through to the normal 404 rather than inventing an
          // empty tile, which Spark would fail to parse in a confusing way.
          next();
          return;
        }

        res.setHeader("Content-Type", stagedContentType(filePath));
        res.setHeader("Content-Length", String(size));
        // A tile is fixed by the capture it came from; it never changes in
        // place, so the browser may cache it for an hour. A rebuilt
        // floor-skin package keeps its file names, so the same caching would
        // show the old floor during the Task 9 comparison — package files get
        // no-cache instead.
        res.setHeader(
          "Cache-Control",
          hasPackageExtension(filePath) ? "no-cache" : "public, max-age=3600",
        );
        createReadStream(filePath).pipe(res);
      });
    },
  };
}
