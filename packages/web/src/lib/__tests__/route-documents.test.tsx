import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LegalPage } from "../../pages/LegalPage.js";
import {
  ROUTE_DOCUMENTS,
  SITE_ORIGIN,
  routeDocumentFile,
  routeDocumentFor,
  routeDocumentHtml,
} from "../route-documents.js";
import { routeDocumentsPlugin, writeRouteDocuments } from "../route-documents-plugin.js";

// ---------------------------------------------------------------------------
// Titled copies of index.html for crawlers that do not run JavaScript
// (fix-first item 19). The route inventory test proves vercel.json serves
// each path its copy; these prove each copy says what its page is.
// ---------------------------------------------------------------------------

const INDEX_HTML = readFileSync(join(import.meta.dirname, "..", "..", "..", "index.html"), "utf8");
const ROBOTS_TXT = readFileSync(join(import.meta.dirname, "..", "..", "..", "public", "robots.txt"), "utf8");
const LISTED = ROUTE_DOCUMENTS.filter((document) => document.unlisted !== true);
const UNLISTED = ROUTE_DOCUMENTS.filter((document) => document.unlisted === true);

function only(html: string, pattern: RegExp): string {
  const found = [...html.matchAll(new RegExp(pattern.source, "gu"))];
  expect(found).toHaveLength(1);
  return found[0]?.[1] ?? "";
}

afterEach(() => { cleanup(); });

describe("route documents", () => {
  it.each(LISTED.map((document) => [document.name, document] as const))(
    "gives %s its own title, description and canonical address, and changes nothing else",
    (_name, document) => {
      const html = routeDocumentHtml(INDEX_HTML, document);
      const url = `${SITE_ORIGIN}${document.paths[0]}`;
      expect(only(html, /<title>([^<]*)<\/title>/u)).toBe(document.title.replace(/&/gu, "&amp;"));
      expect(only(html, /<meta name="description" content="([^"]*)" \/>/u)).toBe(document.description.replace(/&/gu, "&amp;"));
      expect(only(html, /<link rel="canonical" href="([^"]*)" \/>/u)).toBe(url);
      expect(only(html, /<meta property="og:url" content="([^"]*)" \/>/u)).toBe(url);
      expect(only(html, /<meta property="og:title" content="([^"]*)" \/>/u)).toBe(document.title);
      expect(html).not.toMatch(/<meta name="robots"/u);
      expect(html).not.toContain("Trades Hall of Glasgow — weddings and events");
      // The app itself is the same document.
      expect(html).toContain('<script type="module" src="/src/main.tsx"');
      expect(html).toContain("<!-- venue-structured-data -->");
      expect(html.length - INDEX_HTML.length).toBeLessThan(600);
    },
  );

  it.each(UNLISTED.map((document) => [document.name, document] as const))(
    "gives the %s link its own card, with no address of its own and noindex",
    (_name, document) => {
      const html = routeDocumentHtml(INDEX_HTML, document);
      expect(only(html, /<title>([^<]*)<\/title>/u)).toBe(document.title.replace(/&/gu, "&amp;"));
      expect(only(html, /<meta name="description" content="([^"]*)" \/>/u)).toBe(document.description.replace(/&/gu, "&amp;"));
      expect(only(html, /<meta property="og:title" content="([^"]*)" \/>/u)).toBe(document.title);
      expect(only(html, /<meta property="og:description" content="([^"]*)" \/>/u)).toBe(document.description.replace(/&/gu, "&amp;"));
      // One card stands for many links, so it names none of them.
      expect(html).not.toMatch(/<link rel="canonical"/u);
      expect(html).not.toMatch(/<meta property="og:url"/u);
      expect(only(html, /<meta name="robots" content="([^"]*)" \/>/u)).toBe("noindex, nofollow");
      // The card image and the app are the front door's own.
      expect(only(html, /<meta property="og:image" content="([^"]*)" \/>/u)).toBe("https://venviewer.com/images/venue/trades-hall-exterior-og.jpg");
      expect(html).not.toContain("Trades Hall of Glasgow — weddings and events");
      expect(html).toContain('<script type="module" src="/src/main.tsx"');
      expect(html.length - INDEX_HTML.length).toBeLessThan(600);
    },
  );

  it("gives every kind of link staff and guests send its own card", () => {
    const card = (path: string): string | undefined => routeDocumentFor(path)?.name;
    expect(card("/proposal-share/:token")).toBe("proposal");
    expect(card("/proposal/:shareCode")).toBe("proposal");
    expect(card("/supplier-share/:token")).toBe("supplier-pass");
    expect(card("/plan-view/:token")).toBe("plan-view");
    expect(card("/plan/:code")).toBe("layout");
    expect(card("/plan")).toBe("planner");
  });

  it.each(UNLISTED.flatMap((document) => document.paths.map((path) => [path] as const)))(
    "keeps %s out of search in robots.txt as well",
    (path) => {
      // The path up to its first parameter, as robots.txt writes prefixes.
      const prefix = path.split("/:")[0] ?? path;
      const disallowed = [...ROBOTS_TXT.matchAll(/^Disallow: (\S+)$/gmu)].map((match) => match[1] ?? "");
      expect(disallowed.some((rule) => prefix.startsWith(rule.replace(/\/$/u, "")) && `${prefix}/`.startsWith(rule)), prefix).toBe(true);
    },
  );

  it("never names an event, a person or a token in a shared card", () => {
    for (const document of UNLISTED) {
      for (const text of [document.title, document.description]) {
        // No parameter marker, markup or id-like number ("3D" is fine).
        expect(text).not.toMatch(/[{}<>:]|\d{2,}/u);
      }
      expect(document.paths.every((path) => path === "/plan" || /\/:[A-Za-z]+$/u.test(path))).toBe(true);
    }
  });

  it("says plainly that subscriptions are not public, to a reader that runs no script", () => {
    const pricing = routeDocumentFor("/pricing");
    expect(pricing?.title).toBe("Venviewer subscriptions — not yet public");
    expect(pricing?.description).toContain("blake@venviewer.com");
  });

  it("names each legal page as the page itself does", () => {
    for (const type of ["privacy", "terms", "accessibility"] as const) {
      const document = ROUTE_DOCUMENTS.find((entry) => entry.name === type);
      const { container } = render(<LegalPage type={type} />);
      const heading = container.querySelector("h1")?.textContent ?? "";
      expect(document?.title.startsWith(`${heading} — `)).toBe(true);
      expect(container.querySelector(".lg-standfirst")?.textContent).toBe(document?.description);
      expect(window.document.title).toBe(document?.title);
      cleanup();
    }
  });

  it("refuses to build from an index.html it cannot retitle, rather than ship the front door's title", () => {
    const [first] = ROUTE_DOCUMENTS;
    const [shared] = UNLISTED;
    if (first === undefined || shared === undefined) throw new Error("No route documents");
    expect(() => routeDocumentHtml(INDEX_HTML.replace(/<link rel="canonical"[^>]*>/u, ""), first)).toThrow(/canonical/u);
    expect(() => routeDocumentHtml(`${INDEX_HTML}<title>Second</title>`, first)).toThrow(/exactly one <title>/u);
    // An unlisted card removes the canonical link and og:url, so each must be there to remove.
    expect(() => routeDocumentHtml(INDEX_HTML.replace(/<link rel="canonical"[^>]*>/u, ""), shared)).toThrow(/canonical/u);
    expect(() => routeDocumentHtml(INDEX_HTML.replace(/<meta property="og:url"[^>]*>/u, ""), shared)).toThrow(/og:url/u);
  });

  it("escapes what it writes into attributes", () => {
    const html = routeDocumentHtml(INDEX_HTML, {
      name: "probe", paths: ["/probe"], title: "A \"quoted\" <title>", description: "Fish & chips \"here\"",
    });
    expect(html).toContain("<title>A \"quoted\" &lt;title&gt;</title>");
    expect(html).toContain('content="Fish &amp; chips &quot;here&quot;"');
  });

  it("has one file per document and distinct paths", () => {
    const files = ROUTE_DOCUMENTS.map(routeDocumentFile);
    expect(new Set(files).size).toBe(files.length);
    const paths = ROUTE_DOCUMENTS.flatMap((document) => [...document.paths]);
    expect(new Set(paths).size).toBe(paths.length);
    expect(files).toContain("/route-documents/pricing.html");
  });
});

describe("route documents plugin", () => {
  let directory: string | null = null;
  afterEach(async () => {
    if (directory !== null) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("writes every document beside the build", async () => {
    directory = await mkdtemp(join(tmpdir(), "route-documents-"));
    await writeRouteDocuments(directory, INDEX_HTML);
    const written = (await readdir(join(directory, "route-documents"))).sort();
    expect(written).toEqual(ROUTE_DOCUMENTS.map((document) => `${document.name}.html`).sort());
    const privacy = await readFile(join(directory, "route-documents", "privacy.html"), "utf8");
    expect(privacy).toContain("<title>Privacy Policy — The Trades House of Glasgow</title>");
  });

  it("runs on builds only", () => {
    const plugin = routeDocumentsPlugin();
    expect(plugin.apply).toBe("build");
    expect(plugin.name).toBe("venviewer-route-documents");
  });
});
