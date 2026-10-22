import type { Plugin, Rollup } from "vite";

// ---------------------------------------------------------------------------
// Starts the home route's downloads with the entry's, not after it.
//
// "/" is a lazy route: the entry script has to download, parse and run before
// the router asks for RoomsHomePage, so that route's chunks were requested
// about 600 ms after the entry's own on a cold load (measured 16 October). The
// browser could have fetched them in parallel had it known their names, and
// only the build does: file names carry content hashes.
//
// This reads the finished chunk graph and writes the home route's static import
// closure, less what the entry already loads, into index.html as modulepreload
// links (and its stylesheets as preloads), gated on the path so no other route
// pays for it. The same pattern as the hero image preload in index.html.
//
// The script sits at HOME_ROUTE_PRELOAD_MARKER in index.html, before any
// stylesheet link: a parser-inserted script waits for the stylesheets above it,
// so one injected at the end of <head> would start a CSS round trip late.
//
// Fonts are deliberately NOT preloaded: Chrome holds rendering for font
// preloads in <head>, and on the front door they delayed first paint and the
// app's own download more than they saved (measured 2026-09-24).
//
// The same graph walk guards the front door's weight: the build fails if the
// entry or the home route reaches Clerk or the splat manifest, which an
// innocent-looking static import anywhere in their graph would otherwise bring
// back (it did, until 20 October: ProtectedRoute imported Clerk's useClerk).
// ---------------------------------------------------------------------------

export const HOME_ROUTE_SOURCE = "/src/pages/RoomsHomePage.tsx";
export const HOME_ROUTE_PRELOAD_MARKER = "<!-- home-route-preload -->";

/** Modules the front door must never load: sign-in and the 215 KB tile manifest. */
const FORBIDDEN_ON_FRONT_DOOR: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\/node_modules\/@clerk\//u, why: "Clerk is for signed-in routes; load it behind a lazy import" },
  { pattern: /\/data\/generated\/trades-hall-splat-bundles\.ts$/u, why: "the splat tile manifest is for the walk and the planner; read data/room-card-facts.ts" },
  { pattern: /\/data\/room-splat-bundles\.ts$/u, why: "it re-exports the splat tile manifest; read data/room-card-facts.ts" },
];

export interface HomeRoutePreload {
  /** Chunk files (relative to the build root) the home route needs beyond the entry's. */
  readonly modules: readonly string[];
  /** Their stylesheets, same basis. */
  readonly styles: readonly string[];
}

type Chunk = Rollup.OutputChunk;

function closure(start: Chunk, chunks: ReadonlyMap<string, Chunk>): readonly Chunk[] {
  const seen = new Map<string, Chunk>();
  const visit = (chunk: Chunk): void => {
    if (seen.has(chunk.fileName)) return;
    seen.set(chunk.fileName, chunk);
    for (const imported of chunk.imports) {
      const next = chunks.get(imported);
      if (next !== undefined) visit(next);
    }
  };
  visit(start);
  return [...seen.values()];
}

function assertFrontDoorLight(chunks: readonly Chunk[], where: string): void {
  for (const chunk of chunks) {
    for (const id of chunk.moduleIds) {
      const normalised = id.replace(/\\/gu, "/");
      const hit = FORBIDDEN_ON_FRONT_DOOR.find(({ pattern }) => pattern.test(normalised));
      if (hit !== undefined) {
        throw new Error(
          `home-route-preload: ${where} loads ${chunk.fileName}, which contains ${normalised}. ${hit.why}.`,
        );
      }
    }
  }
}

/** The home route's chunks and stylesheets beyond those the entry loads itself. */
export function homeRoutePreload(
  bundle: Rollup.OutputBundle,
  entry: Chunk,
  routeSource: string = HOME_ROUTE_SOURCE,
): HomeRoutePreload {
  const chunks = new Map<string, Chunk>();
  for (const output of Object.values(bundle)) if (output.type === "chunk") chunks.set(output.fileName, output);
  const route = [...chunks.values()].find((chunk) =>
    chunk.facadeModuleId?.replace(/\\/gu, "/").endsWith(routeSource) === true);
  if (route === undefined) {
    // A silent miss would ship a front door with no preload and no signal.
    throw new Error(`home-route-preload: no chunk for ${routeSource}; was the page renamed or inlined?`);
  }
  const loadedByEntry = closure(entry, chunks);
  const loadedByRoute = closure(route, chunks);
  assertFrontDoorLight(loadedByEntry, "the entry");
  assertFrontDoorLight(loadedByRoute, "the home route");
  const entryFiles = new Set(loadedByEntry.map((chunk) => chunk.fileName));
  const needed = loadedByRoute.filter((chunk) => !entryFiles.has(chunk.fileName));
  const entryStyles = new Set(loadedByEntry.flatMap((chunk) => [...(chunk.viteMetadata?.importedCss ?? [])]));
  const styles = [...new Set(needed.flatMap((chunk) => [...(chunk.viteMetadata?.importedCss ?? [])]))]
    .filter((style) => !entryStyles.has(style));
  return { modules: needed.map((chunk) => chunk.fileName), styles };
}

/**
 * The inline script: runs on "/" only, so no other route fetches these.
 *
 * Where the browser has no modulepreload (Safari before 17, Firefox before 115)
 * it falls back to preload as=script, as Vite's own helper does. A modulepreload
 * link such a browser ignores would still make Vite believe the chunk was
 * requested and skip its fallback.
 */
export function homeRoutePreloadScript(preload: HomeRoutePreload, base: string): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const links = (names: readonly string[]): string => JSON.stringify(names.map((name) => `${prefix}${name}`));
  return [
    'if (location.pathname === "/") {',
    `  var modules = ${links(preload.modules)}, styles = ${links(preload.styles)}, i, link;`,
    '  var relList = document.createElement("link").relList;',
    '  var modulepreload = !!(relList && relList.supports && relList.supports("modulepreload"));',
    "  for (i = 0; i < modules.length; i++) {",
    '    link = document.createElement("link"); link.rel = modulepreload ? "modulepreload" : "preload";',
    '    if (!modulepreload) link.as = "script";',
    '    link.crossOrigin = ""; link.href = modules[i];',
    "    document.head.appendChild(link);",
    "  }",
    "  for (i = 0; i < styles.length; i++) {",
    '    link = document.createElement("link"); link.rel = "preload"; link.as = "style"; link.crossOrigin = ""; link.href = styles[i];',
    "    document.head.appendChild(link);",
    "  }",
    "}",
  ].join("\n");
}

/** Writes the script at the marker; a page without the marker is an error, not a silent skip. */
export function injectHomeRoutePreload(html: string, preload: HomeRoutePreload, base: string): string {
  if (!html.includes(HOME_ROUTE_PRELOAD_MARKER)) {
    throw new Error(`home-route-preload: index.html has no ${HOME_ROUTE_PRELOAD_MARKER} to write the preload at`);
  }
  return html.replace(HOME_ROUTE_PRELOAD_MARKER, `<script>\n${homeRoutePreloadScript(preload, base)}\n</script>`);
}

export function homeRoutePreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "venviewer-home-route-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        if (context.bundle === undefined || context.chunk === undefined) return html;
        return injectHomeRoutePreload(html, homeRoutePreload(context.bundle, context.chunk), base);
      },
    },
  };
}
