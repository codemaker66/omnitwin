import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchPath } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ROUTE_DOCUMENTS, routeDocumentFile } from "../lib/route-documents.js";
import {
  NOT_FOUND_BODY,
  NOT_FOUND_CALL_LABEL,
  NOT_FOUND_ENQUIRE,
  NOT_FOUND_HOME,
  NOT_FOUND_META_TITLE,
  NOT_FOUND_TITLE,
} from "../pages/NotFoundPage.js";
import { FRESH_CONTACT_PHONE_DISPLAY, FRESH_CONTACT_PHONE_HREF } from "../pages/fresh/fresh-copy.js";

// ---------------------------------------------------------------------------
// Honest routing (fix-first item 19, 16 October 2026).
//
// vercel.json used to rewrite every address to index.html, so a missing page
// answered 200 with the app: crawlers and AI assistants could not tell a real
// page from a mistyped one (/.well-known/mcp.json "existed"). It now serves the
// app only at an allowlist of the routes src/router.tsx declares, and Vercel
// answers anything else with a real 404 and public/404.html.
//
// An allowlist can drop a real page without a compiler noticing, so this
// inventory is derived from router.tsx itself and proves, both ways, that the
// two lists agree: every production route (the share and planner links people
// hold, above all) still opens, and nothing outside the router is served.
// ---------------------------------------------------------------------------

interface VercelRule {
  readonly source: string;
  readonly destination: string;
  readonly has?: readonly unknown[];
  readonly missing?: readonly unknown[];
}

const root = join(import.meta.dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  readonly redirects: readonly VercelRule[];
  readonly rewrites: readonly VercelRule[];
};
const routerSource = readFileSync(join(root, "src", "router.tsx"), "utf8").replace(/\r\n/gu, "\n");

function devFixtureBounds(): { readonly start: number; readonly end: number } {
  const start = routerSource.indexOf("function devFixtureRoutes()");
  const end = routerSource.indexOf("\n}\n", start);
  if (start === -1 || end === -1) throw new Error("router.tsx: devFixtureRoutes() not found");
  return { start, end };
}

/** Production routes: every `path: "..."` and `staffPage("...")` in the
 *  router, minus the dev-only fixtures (absent from production builds) and
 *  the `*` fallback. */
function productionRouterPaths(): string[] {
  const { start, end } = devFixtureBounds();
  const production = routerSource.slice(0, start) + routerSource.slice(end);
  const paths = [
    ...[...production.matchAll(/\bpath:\s*"([^"]+)"/gu)].map((match) => match[1] ?? ""),
    ...[...production.matchAll(/\bstaffPage\(\s*"([^"]+)"/gu)].map((match) => match[1] ?? ""),
  ];
  return [...new Set(paths)].filter((path) => path !== "*");
}

function devOnlyRouterPaths(): string[] {
  const { start, end } = devFixtureBounds();
  return [...routerSource.slice(start, end).matchAll(/\bpath:\s*"([^"]+)"/gu)].map((match) => match[1] ?? "");
}

const ROUTER_PATHS = productionRouterPaths();

// --- Vercel's source syntax --------------------------------------------------
// Vercel matches `source` with path-to-regexp 6 (strict, case-sensitive). The
// rules here use only this subset, and anything else fails the test rather
// than be guessed at: literal segments, and `:name` with an optional `?`, `*`
// or `+` (the `/` before it is its prefix). A trailing slash is its own rule
// (`/plan/:code` and `/plan/:code/`), the form this file already used before
// the allowlist, rather than a `{/}?` group whose handling by Vercel nobody
// here has seen on a deploy.
const SEGMENT = "[^/#?]+?";

function sourcePattern(source: string): RegExp {
  let pattern = "";
  let rest = source;
  while (rest.length > 0) {
    const named = /^\/:([A-Za-z_]\w*)([?*+]?)/u.exec(rest);
    if (named !== null) {
      const modifier = named[2] ?? "";
      if (modifier === "") pattern += `/(${SEGMENT})`;
      else if (modifier === "?") pattern += `(?:/(${SEGMENT}))?`;
      else pattern += `(?:/((?:${SEGMENT})(?:/(?:${SEGMENT}))*))${modifier === "*" ? "?" : ""}`;
      rest = rest.slice(named[0].length);
      continue;
    }
    const literal = /^[A-Za-z0-9/_.-]/u.exec(rest);
    if (literal === null) throw new Error(`vercel.json source uses syntax this test does not model: ${source}`);
    pattern += literal[0].replace(/[.]/gu, "\\.");
    rest = rest.slice(1);
  }
  return new RegExp(`^${pattern}$`, "u");
}

const unconditional = (rule: VercelRule): boolean => rule.has === undefined && rule.missing === undefined;
const REDIRECTS = vercel.redirects.filter(unconditional);
const REWRITES = vercel.rewrites.filter(unconditional);
const ROUTE_DOCUMENT_FILES = new Set(ROUTE_DOCUMENTS.map(routeDocumentFile));
const APP_DESTINATIONS = new Set(["/index.html", ...ROUTE_DOCUMENT_FILES]);

function publicFileExists(path: string): boolean {
  if (path === "/" || path.endsWith("/")) return false;
  const file = join(root, "public", ...path.split("/").filter((part) => part.length > 0));
  // A folder of assets (public/demo/) is not a page: only a file is served.
  return existsSync(file) && statSync(file).isFile();
}

type Served =
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "file" }
  | { readonly kind: "rewrite"; readonly to: string }
  | { readonly kind: "404" };

/** What Vercel does with a path: redirects first, then the filesystem, then
 *  the first matching rewrite; anything else is a 404. */
function serve(path: string): Served {
  const redirect = REDIRECTS.find((rule) => sourcePattern(rule.source).test(path));
  if (redirect !== undefined) return { kind: "redirect", to: redirect.destination };
  if (publicFileExists(path)) return { kind: "file" };
  const rewrite = REWRITES.find((rule) => sourcePattern(rule.source).test(path));
  return rewrite === undefined ? { kind: "404" } : { kind: "rewrite", to: rewrite.destination };
}

/** Whether a path ends in the app (or a titled copy of it), following one redirect. */
function opensTheApp(path: string): boolean {
  const first = serve(path);
  if (first.kind === "rewrite") return APP_DESTINATIONS.has(first.to);
  if (first.kind !== "redirect") return false;
  // A redirect lands on the app, or on a standalone public page such as the
  // Amissing Book (whose exact rewrite vercel-redirects.test.ts verifies).
  return first.to.startsWith("/") && serve(first.to.split("#")[0] ?? "/").kind !== "404";
}

/** Concrete addresses for a router path: each `:param` filled, an optional
 *  one both present and absent, a splat given two segments. */
function examples(routerPath: string): string[] {
  let variants = [""];
  for (const segment of routerPath.split("/").filter((part) => part.length > 0)) {
    if (segment === "*") variants = variants.map((variant) => `${variant}/a/b`);
    else if (segment.startsWith(":") && segment.endsWith("?")) variants = variants.flatMap((variant) => [variant, `${variant}/x1Y2`]);
    else if (segment.startsWith(":")) variants = variants.map((variant) => `${variant}/x1Y2`);
    else variants = variants.map((variant) => `${variant}/${segment}`);
  }
  return variants.map((variant) => (variant === "" ? "/" : variant));
}

function routerDeclares(path: string): boolean {
  return ROUTER_PATHS.some((routerPath) => matchPath({ path: routerPath, end: true }, path) !== null);
}

describe("the route inventory, read from router.tsx", () => {
  it("finds the router's real routes, including every share and planner link", () => {
    expect(ROUTER_PATHS.length).toBeGreaterThan(50);
    for (const path of ["/", "/proposal-share/:token", "/plan/:code", "/supplier-share/:token", "/proposal/:shareCode", "/pricing"]) {
      expect(ROUTER_PATHS).toContain(path);
    }
    // The dev-only fixtures are not production routes.
    expect(devOnlyRouterPaths()).toContain("/dev/splat-fixture");
    for (const path of devOnlyRouterPaths()) expect(ROUTER_PATHS).not.toContain(path);
  });

  it.each(ROUTER_PATHS)("opens %s at the edge, with or without a trailing slash", (routerPath) => {
    for (const path of examples(routerPath)) {
      expect(opensTheApp(path), path).toBe(true);
      if (path !== "/") expect(opensTheApp(`${path}/`), `${path}/`).toBe(true);
    }
  });

  it.each([
    "/proposal-share/9f2c4e1a-share-token",
    "/plan/TH-4K2Q",
    "/plan/0b9a6a52-61f4-4a0e-9f0c-0d6a2f1c6e11",
    "/supplier-share/sup-7Hq2",
    "/proposal/PRP-2026-118",
    "/room/grand-hall",
    "/captures",
    "/captures/saloon",
    "/venues/trades-hall/twin",
    "/hallkeeper/today",
    "/v/trades-hall-glasgow/plan",
  ])("keeps the link %s working", (path) => {
    expect(opensTheApp(path)).toBe(true);
    expect(routerDeclares(path)).toBe(true);
  });
});

describe("nothing outside the router is served the app", () => {
  it("has no catch-all", () => {
    for (const rule of vercel.rewrites) {
      expect(rule.source).not.toMatch(/^\/(?:\(\.\*\)|:[A-Za-z_]\w*[*+])$/u);
    }
  });

  it.each(REWRITES.filter((rule) => APP_DESTINATIONS.has(rule.destination)).map((rule) => [rule.source] as const))(
    "rewrites %s only because the router declares it",
    (source) => {
      const example = source
        .replace(/:[A-Za-z_]\w*\*/gu, "a/b")
        .replace(/:[A-Za-z_]\w*\??/gu, "x1Y2");
      expect(routerDeclares(example), example).toBe(true);
    },
  );

  it.each([
    "/.well-known/mcp.json",
    "/.well-known/ai-plugin.json",
    "/no-such-page",
    "/wp-login.php",
    "/pricing/plans",
    "/plan/TH-4K2Q/extra",
    "/proposal-share",
    "/dev/splat-fixture",
    "/dev/evidence-chips",
    "/twin/manifest.json",
    "/assets/index-missing.js",
  ])("answers %s with a real 404", (path) => {
    expect(serve(path)).toEqual({ kind: "404" });
  });
});

describe("titled documents for crawlers", () => {
  it.each(ROUTE_DOCUMENTS.flatMap((document) => document.paths.map((path) => [path, document.name] as const)))(
    "serves %s its own document (%s)",
    (path, name) => {
      const file = `/route-documents/${name}.html`;
      expect(ROUTER_PATHS).toContain(path);
      expect(serve(path)).toEqual({ kind: "rewrite", to: file });
      expect(serve(`${path}/`)).toEqual({ kind: "rewrite", to: file });
    },
  );

  it("rewrites only to documents the build writes", () => {
    for (const rule of vercel.rewrites.filter((entry) => entry.destination.startsWith("/route-documents/"))) {
      expect(ROUTE_DOCUMENT_FILES.has(rule.destination), rule.destination).toBe(true);
    }
  });
});

describe("the edge's 404 page", () => {
  const html = readFileSync(join(root, "public", "404.html"), "utf8");

  it("says what the app's own page says, with the same ways on", () => {
    expect(html).toContain(`<title>${NOT_FOUND_META_TITLE}</title>`);
    for (const words of [NOT_FOUND_TITLE, NOT_FOUND_BODY, NOT_FOUND_ENQUIRE, NOT_FOUND_HOME, NOT_FOUND_CALL_LABEL, FRESH_CONTACT_PHONE_DISPLAY]) {
      expect(html).toContain(words);
    }
    expect(html).toContain(`href="${FRESH_CONTACT_PHONE_HREF}"`);
    expect(html).toContain('href="/#enquire"');
    expect(html).toContain('href="/"');
  });

  it("works without JavaScript and asks not to be indexed", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script/iu);
    // Only fonts this site already publishes.
    for (const font of html.matchAll(/url\("([^"]+)"\)/gu)) {
      expect(existsSync(join(root, "public", ...(font[1] ?? "").split("/").filter(Boolean))), font[1]).toBe(true);
    }
  });
});
