import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TradesHouseLeafletPage } from "../pages/TradesHouseLeafletPage.js";

// ---------------------------------------------------------------------------
// The Trades House leaflet page frames a document from this site, and the
// site's own headers must let it (public-claims-3).
//
// vercel.json sends X-Frame-Options: DENY on every path, which forbids framing
// by any page, this site's included. /trades-house/leaflet shows the leaflet
// only inside an <iframe> of /trades-house-media/leaflet.html, so in a browser
// its whole body was a refused frame and only "Open printable leaflet" worked
// (measured on venviewer.com on 12 November 2026: the leaflet answered DENY).
//
// The exception is as narrow as it can be: that one static document may be
// framed by this site only (SAMEORIGIN, and CSP frame-ancestors 'self', the
// standard control, which decides wherever a browser supports it); every
// other path keeps DENY. No other rule sends a CSP on that path.
//
// Vercel applies every matching header rule in order, and a later rule's
// value for a key replaces an earlier one. That is measured, not assumed: on
// 12 November 2026 /amissing-book/ answered with only its own rule's
// Permissions-Policy and /trades-hall/cards/ with only its own Referrer-Policy,
// each set after the site-wide rule. This suite resolves headers the same way.
// ---------------------------------------------------------------------------

interface VercelHeaderRule {
  readonly source: string;
  readonly has?: unknown;
  readonly missing?: unknown;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

const root = join(import.meta.dirname, "..", "..");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  readonly headers: readonly VercelHeaderRule[];
};

function readGroup(source: string, start: number): { readonly body: string; readonly end: number } {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(start + 1, index), end: index + 1 };
    }
  }
  throw new Error(`Unbalanced group in ${source}`);
}

/** The subset of Vercel's path-to-regexp syntax these rules use (as in vercel-cache-headers.test.ts). */
function sourcePattern(source: string): RegExp {
  let pattern = "";
  for (let index = 0; index < source.length;) {
    const named = /^:[A-Za-z_]\w*/u.exec(source.slice(index));
    if (named !== null) {
      index += named[0].length;
      if (source[index] === "(") {
        const group = readGroup(source, index);
        pattern += `(${group.body})`;
        index = group.end;
      } else if (source[index] === "*") {
        pattern += "(.*)";
        index += 1;
      } else {
        pattern += "([^/]+)";
      }
    } else if (source[index] === "(") {
      const group = readGroup(source, index);
      pattern += `(${group.body})`;
      index = group.end;
    } else {
      pattern += (source[index] ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${pattern}$`, "u");
}

/** The response headers vercel.json gives a path: matching rules in order, later values replacing earlier ones. */
function responseHeaders(path: string): ReadonlyMap<string, string> {
  const headers = new Map<string, string>();
  for (const rule of vercel.headers) {
    if (rule.has !== undefined || rule.missing !== undefined) throw new Error(`Conditional rule ${rule.source} is not modelled here`);
    if (!sourcePattern(rule.source).test(path)) continue;
    for (const header of rule.headers) headers.set(header.key.toLowerCase(), header.value);
  }
  return headers;
}

/** The sources a path's CSP frame-ancestors names, or undefined when it sends none. */
function frameAncestors(path: string): readonly string[] | undefined {
  const policy = responseHeaders(path).get("content-security-policy") ?? "";
  return /(?:^|;)\s*frame-ancestors\s+([^;]*)/iu.exec(policy)?.[1]?.trim().split(/\s+/u);
}

/** Whether a page of this site may show `path` in a frame, by X-Frame-Options and CSP frame-ancestors. */
function sameOriginMayFrame(path: string): boolean {
  const frameOptions = responseHeaders(path).get("x-frame-options")?.trim().toUpperCase();
  const ancestors = frameAncestors(path);
  const byFrameOptions = frameOptions === undefined || frameOptions === "SAMEORIGIN";
  const byPolicy = ancestors === undefined || ancestors.includes("'self'");
  return byFrameOptions && byPolicy;
}

function publicFiles(directory = join(root, "public")): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? publicFiles(join(directory, entry.name))
    : [`/${relative(join(root, "public"), join(directory, entry.name)).replace(/\\/gu, "/")}`]);
}

afterEach(() => {
  cleanup();
});

describe("the Trades House leaflet page's frame", () => {
  it("frames a document the site's headers let this site frame", () => {
    render(<TradesHouseLeafletPage />);
    const frame = screen.getByTitle("Trades House Glasgow two-sided leaflet");
    const src = frame.getAttribute("src") ?? "";
    expect(src.startsWith("/"), "the leaflet is this site's own document").toBe(true);
    // What a browser receives for that path once every matching rule has
    // applied: the legacy header and the standard one (review of #405, H1),
    // which decides wherever it is supported and names only this site.
    const sent = responseHeaders(src);
    expect({
      "x-frame-options": sent.get("x-frame-options"),
      "content-security-policy": sent.get("content-security-policy"),
    }, src).toEqual({
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "frame-ancestors 'self'",
    });
    expect(frameAncestors(src), src).toEqual(["'self'"]);
    expect(sameOriginMayFrame(src), src).toBe(true);
  });

  it("keeps every other page and file unframeable", () => {
    render(<TradesHouseLeafletPage />);
    const leaflet = screen.getByTitle("Trades House Glasgow two-sided leaflet").getAttribute("src") ?? "";
    const others = [
      "/",
      "/trades-house/leaflet",
      "/plan/abc",
      "/trades-house-media/leaflet",
      "/trades-house-media/leaflet.html/",
      "/trades-house-media/leaflet.htm",
      ...publicFiles().filter((path) => path !== leaflet),
    ];
    expect(others.length).toBeGreaterThan(100);
    for (const path of others) {
      expect(responseHeaders(path).get("x-frame-options"), path).toBe("DENY");
      expect(frameAncestors(path) ?? [], path).not.toContain("'self'");
    }
  });
});
