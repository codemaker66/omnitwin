import { createReadStream, realpathSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { Plugin } from "vite";

// ---------------------------------------------------------------------------
// Dev-only static serving for staged splat tiles.
//
// Roughly a gigabyte of captured tiles across the eight Trades Hall rooms is
// staged outside the repository, so it cannot live in `public/`. In production
// the same tile names are served from R2 via VITE_SPLAT_BASE_URL; in
// development this middleware serves them from the staging root instead.
//
// It is a dev server middleware only. It never runs in a build, and it refuses
// any path that escapes the staging root.
// ---------------------------------------------------------------------------

/** URL prefix the web app requests tiles under. */
const SPLAT_URL_PREFIX = "/splats/";

/** Extensions this middleware will serve. Nothing else is readable through it. */
const SERVABLE_EXTENSIONS = [".sog", ".spz", ".ply", ".splat", ".ksplat"] as const;

const CONTENT_TYPE = "application/octet-stream";

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

  const lower = relative.toLowerCase();
  if (!SERVABLE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return null;

  const resolvedRoot = normalize(root);
  const candidate = normalize(join(resolvedRoot, relative));

  // Containment check with the separator appended, so a sibling directory
  // named like the root ("/rootEvil" against "/root") cannot pass as a child.
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (!candidate.startsWith(rootWithSep)) return null;

  return candidate;
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

        res.setHeader("Content-Type", CONTENT_TYPE);
        res.setHeader("Content-Length", String(size));
        // A tile is fixed by the capture it came from; it never changes in place.
        res.setHeader("Cache-Control", "public, max-age=3600");
        createReadStream(filePath).pipe(res);
      });
    },
  };
}
