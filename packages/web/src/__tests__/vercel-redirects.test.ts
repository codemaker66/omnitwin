import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// vercel.json is routing too, and it can go stale without a compiler noticing:
// on 2026-09-03 the front door's own "Walkable tour" link went to /tour, which
// Vercel redirected to /#walk, an anchor the homepage had not had for months,
// so the link looped back to where it started. Every internal redirect target
// must be a route the app declares.
// ---------------------------------------------------------------------------

interface VercelRedirect {
  readonly source: string;
  readonly destination: string;
  readonly permanent?: boolean;
  readonly has?: readonly unknown[];
}

const root = join(import.meta.dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  readonly redirects: readonly VercelRedirect[];
};
const routerSource = readFileSync(join(root, "src", "router.tsx"), "utf8");

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

  it("only redirects to routes the router declares", () => {
    for (const redirect of internal) {
      expect(routerDeclares(redirect.destination), `${redirect.source} -> ${redirect.destination}`).toBe(true);
    }
  });
});
