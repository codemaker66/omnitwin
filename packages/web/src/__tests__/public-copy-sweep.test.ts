import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The public copy sweep (T-616, gate line 3).
//
// "Zero engineering, placeholder or construction copy on any route reachable
// without login." That is a claim about what a VISITOR reads, so this checks
// the two places a visitor's words come from:
//
//   1. the copy modules every public page renders from, and
//   2. the built `dist/` bundle, when one is present — the bytes actually
//      served, which catch a string that reached the page from somewhere no
//      module list knows about.
//
// It also pins the three things gate lines 1, 4 and 5 turn on which no
// rendering test can see: that no public surface offers a mailto instead of
// the composer, that /pricing and /demo are off the crawlable surface, and
// that the sitemap lists only pages that still exist.
//
// Deliberately NOT a Playwright spec. T-613 owns the browser suite; this runs
// in the unit job, so a lane that reintroduces one of these strings fails in
// two minutes rather than in the 26-minute e2e shards.
// ---------------------------------------------------------------------------

/**
 * The plan's list, verbatim (docs/plan/18 section 2, line 3), plus the two
 * phrases from the same family the front door was still printing when this was
 * written. Each entry carries the surface it was found on, so a failure names
 * the page rather than only the string.
 */
const FORBIDDEN: readonly { readonly text: string; readonly seenOn: string }[] = [
  { text: "alignment in review", seenOn: "front door room cards" },
  { text: "not yet registered", seenOn: "planner layers rail" },
  { text: "Runtime room visual is not currently available", seenOn: "room showcase" },
  { text: "being prepared", seenOn: "twin" },
  { text: "DEMO ONLY", seenOn: "approval flow" },
  { text: "Banquet Draft", seenOn: "mobile planner top bar" },
  { text: "Loading...", seenOn: "planner" },
  { text: "Example rates", seenOn: "pricing" },
  { text: "check dimensions", seenOn: "room cards" },
  { text: "final copy and image-rights review required", seenOn: "Trades House leaflet" },
  // Same vocabulary, same defect: our words for our problems, on their page.
  { text: "Dimensions under review", seenOn: "front door room cards" },
  { text: "Capture preview", seenOn: "front door room cards" },
];

/**
 * The copy every public route renders from. A page that hard-codes a string
 * outside these modules is caught by the dist sweep below instead.
 */
const PUBLIC_COPY_SOURCES: readonly string[] = [
  "src/pages/home-copy.ts",
  "src/pages/RoomsHomePage.tsx",
  "src/pages/RoomWalkPage.tsx",
  "src/pages/NotFoundPage.tsx",
  "src/pages/fresh/fresh-copy.ts",
  "src/pages/fresh/FreshPage.tsx",
  "src/pages/fresh/FreshEnquiry.tsx",
  "src/pages/fresh/enquiry-fit.ts",
  "src/pages/TradesHouseLeafletPage.tsx",
  "src/pages/TradesHouseCraftQuizPage.tsx",
  "src/pages/RoomShowcasePage.tsx",
  "src/lib/room-card-copy.ts",
  "src/lib/trades-hall-venue-truth.ts",
];

/** Public pages whose "Enquire" must reach the composer, never a mail client. */
const NO_MAILTO_SOURCES: readonly string[] = [
  "src/pages/home-copy.ts",
  "src/pages/RoomsHomePage.tsx",
  "src/pages/RoomWalkPage.tsx",
  "src/pages/NotFoundPage.tsx",
  "src/pages/fresh/FreshPage.tsx",
  "src/pages/fresh/FreshEnquiry.tsx",
  "src/pages/fresh/enquiry-fit.ts",
  "src/pages/fresh/fresh-copy.ts",
  "src/pages/landing/rite-copy.ts",
  "src/pages/landing/ReturnAct.tsx",
  "src/pages/landing/ContemplationAct.tsx",
  "src/pages/living-hall/LivingHallPage.tsx",
  "src/features/trades-house/craft-quiz-model.ts",
  "src/pages/TradesHouseCraftQuizPage.tsx",
];

async function read(relative: string): Promise<string> {
  return readFile(path.resolve(relative), "utf8");
}

/**
 * Strip comments before searching. A comment explaining why a phrase was
 * removed must not itself trip the guard — that is how a rule stops being
 * documentable and starts being folklore.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
}

async function distTextFiles(): Promise<readonly string[]> {
  const dist = path.resolve("dist");
  if (!existsSync(dist)) return [];
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(?:js|css|html|txt|xml|webmanifest)$/u.test(entry.name)) {
        found.push(full);
      }
    }
  };
  await walk(dist);
  return found;
}

describe("public copy sweep — no engineering vocabulary on a public route", () => {
  it.each(FORBIDDEN)("never says $text (it was on the $seenOn)", async ({ text }) => {
    const offenders: string[] = [];
    for (const relative of PUBLIC_COPY_SOURCES) {
      const body = withoutComments(await read(relative));
      if (body.includes(text)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it("draws the front door's every word from home-copy, and none of it is forbidden", async () => {
    const { allHomeCopy } = await import("../pages/home-copy.js");
    const words = allHomeCopy();
    expect(words.length).toBeGreaterThan(20);
    for (const line of words) {
      for (const { text } of FORBIDDEN) {
        expect(line, `"${line}" contains "${text}"`).not.toContain(text);
      }
    }
  });

  it("keeps the same guarantee over /fresh's copy", async () => {
    const { allFreshCopy } = await import("../pages/fresh/fresh-copy.js");
    for (const line of allFreshCopy()) {
      for (const { text } of FORBIDDEN) {
        expect(line, `"${line}" contains "${text}"`).not.toContain(text);
      }
    }
  });
});

describe("public copy sweep — every Enquire posts, none of them mails", () => {
  it.each(NO_MAILTO_SOURCES)("%s offers no mailto", async (relative) => {
    const body = withoutComments(await read(relative));
    expect(body).not.toContain("mailto:");
  });

  it("posts the venues.slug row, never the asset slug", async () => {
    const composer = await read("src/pages/fresh/FreshEnquiry.tsx");
    expect(composer).toContain("TRADES_HALL_ENQUIRY_VENUE_SLUG");
    const types = await import("@omnitwin/types");
    // The two-slug embarrassment: the asset namespace is "trades-hall" and the
    // database row is "trades-hall-glasgow". Posting the first 404s silently.
    expect(types.TRADES_HALL_ENQUIRY_VENUE_SLUG).toBe("trades-hall-glasgow");
    expect(types.TRADES_HALL_ENQUIRY_VENUE_SLUG).not.toBe(types.TRADES_HALL_ASSET_SLUG);
  });

  it("reaches the composer from the front door, the room walk and the not-found page", async () => {
    for (const relative of [
      "src/pages/RoomsHomePage.tsx",
      "src/pages/RoomWalkPage.tsx",
      "src/pages/NotFoundPage.tsx",
    ]) {
      expect(await read(relative), relative).toContain("#enquire");
    }
  });
});

describe("public copy sweep — the crawlable surface", () => {
  it("keeps /pricing and /demo out of robots and the sitemap", async () => {
    const robots = await read("public/robots.txt");
    const sitemap = await read("public/sitemap.xml");
    expect(robots).toContain("Disallow: /pricing");
    expect(robots).toContain("Disallow: /demo");
    expect(sitemap).not.toContain("venviewer.com/pricing");
    expect(sitemap).not.toContain("venviewer.com/demo");
  });

  it("lists no retired route in the sitemap", async () => {
    const sitemap = await read("public/sitemap.xml");
    for (const retired of ["/landing", "/welcome", "/living-hall", "/editor"]) {
      expect(sitemap, retired).not.toContain(`venviewer.com${retired}<`);
    }
  });

  it("serves an apple-touch-icon, a manifest and a security.txt on this domain", async () => {
    expect(existsSync(path.resolve("public/apple-touch-icon.png"))).toBe(true);
    const manifest: unknown = JSON.parse(await read("public/site.webmanifest"));
    expect(manifest).toMatchObject({ start_url: "/", display: "standalone" });
    const security = await read("public/.well-known/security.txt");
    // RFC 9116 section 2.5.3: Canonical must be the URI the file is published
    // at. Check the DIRECTIVE lines, not the whole file: the comment recording
    // why the old domain went has every right to name it.
    const directives = security
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(directives).toContain("Canonical: https://venviewer.com/.well-known/security.txt");
    for (const line of directives) {
      expect(line, line).not.toContain("omnitwin.com");
    }
  });

  it("asks for viewport-fit=cover, the icons and exactly one theme colour", async () => {
    const html = await read("index.html");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('rel="manifest"');
    // One value for both schemes: the page ground is ivory either way, and the
    // old pair painted the iOS status bar near-black over an ivory page.
    expect(html.match(/name="theme-color"/gu)).toHaveLength(1);
  });
});

describe("public copy sweep — the built bundle", () => {
  it("ships none of the forbidden strings in dist/", async () => {
    const files = await distTextFiles();
    if (files.length === 0) {
      // Vitest runs before `vite build` in CI's unit job. The build job greps
      // the same list; this branch says so rather than reporting a pass it did
      // not earn.
      expect(existsSync(path.resolve("dist"))).toBe(false);
      return;
    }
    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, "utf8");
      for (const { text } of FORBIDDEN) {
        if (body.includes(text)) offenders.push(`${path.relative(".", file)}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
