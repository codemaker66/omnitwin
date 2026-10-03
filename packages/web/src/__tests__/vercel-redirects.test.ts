import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// vercel.json is routing too, and it can go stale without a compiler noticing:
// on 2026-09-03 the front door's own "Walkable tour" link went to /tour, which
// Vercel redirected to /#walk, an anchor the homepage had not had for months,
// so the link looped back to where it started. Every internal redirect target
// must be a route the app declares or an exact rewrite to a real public HTML
// entry. The SPA catch-all alone cannot prove a destination exists.
// ---------------------------------------------------------------------------

interface VercelRedirect {
  readonly source: string;
  readonly destination: string;
  readonly permanent?: boolean;
  readonly has?: readonly unknown[];
}

interface VercelRewrite {
  readonly source: string;
  readonly destination: string;
  readonly has?: readonly unknown[];
  readonly missing?: readonly unknown[];
}

const root = join(import.meta.dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  readonly redirects: readonly VercelRedirect[];
  readonly rewrites: readonly VercelRewrite[];
};
const routerSource = readFileSync(join(root, "src", "router.tsx"), "utf8");
// Parse source only. Link tags must not start CSS/network loads during a unit test.
const parserWindow = new Window({ settings: {
  disableCSSFileLoading: true,
  disableJavaScriptFileLoading: true,
  enableJavaScriptEvaluation: false,
} });
afterAll(async () => { await parserWindow.happyDOM.close(); });

/** Whether the router declares a path that matches this concrete destination. */
function routerDeclares(path: string): boolean {
  const [pathname] = path.split("#");
  if (pathname === undefined || pathname === "/") return true;
  const segments = pathname.split("/").filter((s) => s.length > 0);
  const declared = [...routerSource.matchAll(/path:\s*"([^"]+)"/gu)].map((m) => m[1] ?? "");
  return declared.some((candidate) => {
    const parts = candidate.split("/").filter((s) => s.length > 0);
    if (parts.length !== segments.length) return false;
    return parts.every((part, i) => part.startsWith(":") || part === segments[i]);
  });
}

/** An exact static entry, never a wildcard SPA fallback or conditional rule. */
function publicHtmlDeclares(
  path: string,
  rewrites: readonly VercelRewrite[],
  readPublicFile: (path: string) => string = (path) => readFileSync(join(root, "public", path), "utf8"),
): boolean {
  if (path.startsWith("/#")) return false;
  const rewrite = rewrites.find((rule) => rule.source === path && rule.has === undefined && rule.missing === undefined);
  // Literal public HTML paths only: no interpolation, traversal or external URL.
  if (rewrite === undefined || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html$/u.test(rewrite.destination)) return false;
  try {
    const document = new parserWindow.DOMParser().parseFromString(readPublicFile(rewrite.destination), "text/html");
    if (document.doctype?.name.toLowerCase() !== "html" || document.title.trim() === "" || document.body.children.length === 0) return false;
    // A standalone module app must have its actual entry too, not just an HTML
    // shell pointing at a missing bundle. Ordinary static HTML needs no module.
    const base = new URL(rewrite.destination, "https://public.invalid");
    return [...document.querySelectorAll('script[type="module"][src]')].every((script) => {
      const entry = new URL(script.getAttribute("src") ?? "", base);
      return entry.origin === base.origin && readPublicFile(entry.pathname).trim().length > 0;
    });
  } catch {
    return false;
  }
}

describe("exact public HTML redirect destinations", () => {
  const html = '<!doctype html><html><head><title>A standalone story</title><script type="module" src="./assets/story.js"></script></head><body><main id="story"></main></body></html>';
  const files: Readonly<Record<string, string>> = {
    "/story/index.html": html,
    "/story/assets/story.js": 'document.querySelector("#story").textContent = "Begin";',
    "/broken.html": "This is not an HTML document.",
    "/empty.html": "<!doctype html><html><head><title>Empty</title></head><body></body></html>",
    "/missing-module.html": html,
  };
  const readFixture = (path: string): string => {
    const file = files[path];
    if (file === undefined) throw new Error(`Missing public file: ${path}`);
    return file;
  };

  it("accepts an exact rewrite only when its HTML document and module entry exist", () => {
    expect(publicHtmlDeclares("/story/", [{ source: "/story/", destination: "/story/index.html" }], readFixture)).toBe(true);
  });

  it.each(["/absent.html", "/broken.html", "/empty.html", "/missing-module.html", "/../index.html"])(
    "rejects an invalid public entry at %s",
    (destination) => {
      expect(publicHtmlDeclares("/story/", [{ source: "/story/", destination }], readFixture)).toBe(false);
    },
  );

  it("does not treat a catch-all, another exact path or a conditional rewrite as a destination", () => {
    for (const rule of [
      { source: "/(.*)", destination: "/story/index.html" },
      { source: "/other/", destination: "/story/index.html" },
      { source: "/story/", destination: "/story/index.html", has: [{ type: "header" }] },
      { source: "/story/", destination: "/story/index.html", missing: [{ type: "header" }] },
    ]) expect(publicHtmlDeclares("/story/", [rule], readFixture)).toBe(false);
  });

  it("cannot legitimize a homepage anchor with an HTML rewrite", () => {
    expect(publicHtmlDeclares("/#walk", [{ source: "/#walk", destination: "/story/index.html" }], readFixture)).toBe(false);
  });
});

describe("vercel.json redirects", () => {
  const internal = vercel.redirects.filter((r) => r.destination.startsWith("/") && r.has === undefined);

  it("sends /tour to the whole-building twin, not to a homepage anchor", () => {
    const tour = internal.find((r) => r.source === "/tour");
    expect(tour?.destination).toBe("/venues/trades-hall/twin");
  });

  it("never points an internal redirect at an anchor on the homepage", () => {
    for (const redirect of internal) {
      expect(redirect.destination, redirect.source).not.toMatch(/^\/#/u);
    }
  });

  // T-616: the older home pages left public addresses. The app redirects
  // them too, but at the edge a stale link skips loading the app first.
  // Temporary, because a browser keeps a permanent redirect indefinitely,
  // and robots.txt already keeps crawlers off these paths.
  it.each(["/landing", "/welcome", "/living-hall", "/editor", "/venues/:venueSlug/rooms/:roomSlug"])(
    "sends the retired %s to the front door at the edge, temporarily",
    (source) => {
      const redirect = internal.find((r) => r.source === source);
      expect(redirect?.destination).toBe("/");
      expect(redirect?.permanent).toBe(false);
    },
  );

  it("only redirects to declared routes or verified exact public HTML entries", () => {
    for (const redirect of internal) {
      expect(
        routerDeclares(redirect.destination) || publicHtmlDeclares(redirect.destination, vercel.rewrites),
        `${redirect.source} -> ${redirect.destination}`,
      ).toBe(true);
    }
  });
});
