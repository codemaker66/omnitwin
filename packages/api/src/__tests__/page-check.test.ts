import { describe, expect, it } from "vitest";
import {
  PAGE_CHECK_PRODUCT_TOKEN,
  PAGE_CHECK_USER_AGENT,
  checkPage,
  createHttpsPageFetcher,
  guardedLookup,
  isPublicAddress,
  nextCheckAfter,
  pageText,
  pageTextHash,
  robotsAllows,
  type FetchAnswer,
  type PageFetcher,
} from "../services/page-check.js";

// ---------------------------------------------------------------------------
// The competitor watch's page-change check. The network is never touched:
// every answer comes from a fake fetcher, and the real fetcher is only asked
// to reach addresses it must refuse before connecting.
// ---------------------------------------------------------------------------

const SITE = "https://grandcentral.vocohotels.com";
const PAGE = "https://grandcentral.vocohotels.com/wedding-packages/";

function page(body: string): FetchAnswer {
  return { kind: "response", status: 200, body, location: null };
}
function status(code: number, location: string | null = null): FetchAnswer {
  return { kind: "response", status: code, body: "", location };
}

/** A fetcher answering from a table of URLs, recording what was asked. */
function fakeFetcher(answers: Readonly<Record<string, FetchAnswer>>): PageFetcher & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get(url: URL): Promise<FetchAnswer> {
      asked.push(url.href);
      return Promise.resolve(answers[url.href] ?? status(404));
    },
  };
}

const HTML = (price: string): string => `<!doctype html><html><head><title>Weddings</title><script>var t=${String(Date.now())}</script></head>
  <body><header>Book now</header><nav>Home · Rooms</nav><main><h1>Wedding packages</h1><p>Grand Central Package ${price} per person</p></main>
  <footer>© 2026</footer></body></html>`;

describe("robots.txt (RFC 9309)", () => {
  it("reads the check's own group before the * group", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: VenviewerPageCheck\nAllow: /wedding-packages/\nDisallow: /";
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/wedding-packages/")).toBe(true);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/rooms/")).toBe(false);
  });

  it("falls back to *, the longest rule winning and Allow taking a tie", () => {
    const robots = "User-agent: *\nDisallow: /wp-admin/\nDisallow: /*?\nAllow: /wp-admin/admin-ajax.php";
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/weddings/")).toBe(true);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/wp-admin/x")).toBe(false);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/wp-admin/admin-ajax.php")).toBe(true);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/weddings/?date=1")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a", PAGE_CHECK_PRODUCT_TOKEN, "/a")).toBe(true);
  });

  it("honours $ anchors, comments, empty Disallow and grouped agents", () => {
    const robots = "# hi\nUser-agent: other\nUser-agent: *\nDisallow: /*.pdf$ # brochures\nDisallow:\n";
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/brochure.pdf")).toBe(false);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/brochure.pdf?x")).toBe(true);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/weddings/")).toBe(true);
    expect(robotsAllows("", PAGE_CHECK_PRODUCT_TOKEN, "/anything")).toBe(true);
  });

  it("matches the product token whatever its case", () => {
    expect(robotsAllows("User-agent: venviewerpagecheck\nDisallow: /", PAGE_CHECK_PRODUCT_TOKEN, "/weddings/")).toBe(false);
  });
});

describe("the page's text and its hash", () => {
  it("keeps the main block and drops scripts, navigation, header and footer", () => {
    expect(pageText(HTML("£130"))).toBe("Wedding packages Grand Central Package £130 per person");
  });

  it("is unchanged by a script or a footer that differs, and changed by the figure", () => {
    const first = pageTextHash(HTML("£130"));
    expect(pageTextHash(HTML("£130").replace("© 2026", "© 2027"))).toBe(first);
    expect(pageTextHash(HTML("£135"))).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("decodes entities the same however a page writes them", () => {
    expect(pageText("<body><p>&pound;130&nbsp;&amp;&#163;5&#xA3;</p></body>")).toBe("£130 &£5£");
  });
});

describe("only the public internet", () => {
  it("refuses loopback, private, link-local, metadata and documentation addresses", () => {
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fd00::1", "fc00::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2001:db8::1", "not-an-address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses at connection time a name that resolves inside", async () => {
    const lookup = guardedLookup(() => Promise.resolve([{ address: "169.254.169.254", family: 4 }]));
    const error = await new Promise<Error | null>((resolve) => {
      lookup("example.org", {}, (err) => { resolve(err); });
    });
    expect(error?.message).toContain("not on the public internet");
  });

  it("the real fetcher never connects to a refused address, an IP literal or plain http", async () => {
    const fetcher = createHttpsPageFetcher({ resolver: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]) });
    await expect(fetcher.get(new URL("https://competitor.example/weddings"))).resolves.toEqual({ kind: "failure", failure: "blocked_address" });
    await expect(fetcher.get(new URL("https://10.0.0.1/x"))).resolves.toEqual({ kind: "failure", failure: "blocked_address" });
    await expect(fetcher.get(new URL("http://competitor.example/x"))).resolves.toEqual({ kind: "failure", failure: "blocked_address" });
  });

  it("names itself plainly", () => {
    expect(PAGE_CHECK_USER_AGENT).toMatch(/^VenviewerPageCheck\/1\.0 \(\+https:\/\/venviewer\.com; /u);
    expect(PAGE_CHECK_USER_AGENT).toContain("keeps a hash, never the content");
  });
});

describe("one check", () => {
  const robotsOk = { [`${SITE}/robots.txt`]: page("User-agent: *\nDisallow: /wp-admin/") };

  it("reads robots.txt first, then the page, and keeps only a hash", async () => {
    const fetcher = fakeFetcher({ ...robotsOk, [PAGE]: page(HTML("£130")) });
    const first = await checkPage({ fetcher, pageUrl: PAGE, website: SITE, previousHash: null });
    expect(fetcher.asked).toEqual([`${SITE}/robots.txt`, PAGE]);
    expect(first).toEqual({ outcome: "first_seen", robots: "allowed", httpStatus: 200, hash: pageTextHash(HTML("£130")) });
    const again = await checkPage({ fetcher, pageUrl: PAGE, website: SITE, previousHash: first.hash });
    expect(again.outcome).toBe("unchanged");
    const changed = await checkPage({ fetcher: fakeFetcher({ ...robotsOk, [PAGE]: page(HTML("£135")) }), pageUrl: PAGE, website: SITE, previousHash: first.hash });
    expect(changed.outcome).toBe("changed");
  });

  it("does not read a page robots.txt disallows", async () => {
    const fetcher = fakeFetcher({ [`${SITE}/robots.txt`]: page("User-agent: *\nDisallow: /wedding-packages/"), [PAGE]: page(HTML("£130")) });
    expect(await checkPage({ fetcher, pageUrl: PAGE, website: SITE, previousHash: null }))
      .toEqual({ outcome: "robots_disallowed", robots: "disallowed", httpStatus: null, hash: null });
    expect(fetcher.asked).toEqual([`${SITE}/robots.txt`]);
  });

  it("reads the page when there is no robots.txt, and stops when it cannot read one", async () => {
    const none = fakeFetcher({ [`${SITE}/robots.txt`]: status(404), [PAGE]: page(HTML("£130")) });
    expect((await checkPage({ fetcher: none, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("first_seen");
    const down = fakeFetcher({ [`${SITE}/robots.txt`]: status(503), [PAGE]: page(HTML("£130")) });
    expect((await checkPage({ fetcher: down, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("failed");
    expect(down.asked).toEqual([`${SITE}/robots.txt`]);
    const network: PageFetcher = { get: () => Promise.resolve({ kind: "failure", failure: "timeout" }) };
    expect((await checkPage({ fetcher: network, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("failed");
  });

  it("stops on 401, 403 and 429, from robots.txt or the page, and waits four weeks", async () => {
    for (const code of [401, 403, 429]) {
      const robots = fakeFetcher({ [`${SITE}/robots.txt`]: status(code) });
      expect((await checkPage({ fetcher: robots, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("refused");
      const pageRefused = fakeFetcher({ ...robotsOk, [PAGE]: status(code) });
      expect(await checkPage({ fetcher: pageRefused, pageUrl: PAGE, website: SITE, previousHash: "a".repeat(64) }))
        .toEqual({ outcome: "refused", robots: "allowed", httpStatus: code, hash: null });
    }
    const now = new Date("2026-10-17T09:00:00Z");
    expect(nextCheckAfter(now, "refused").toISOString()).toBe("2026-11-14T09:00:00.000Z");
    expect(nextCheckAfter(now, "changed").toISOString()).toBe("2026-10-24T09:00:00.000Z");
  });

  it("follows a redirect on the venue's own site, and calls one elsewhere a move", async () => {
    const moved = `${SITE}/weddings-2027/`;
    const inside = fakeFetcher({ ...robotsOk, [PAGE]: status(301, "/weddings-2027/"), [moved]: page(HTML("£130")) });
    expect((await checkPage({ fetcher: inside, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("first_seen");
    const away = fakeFetcher({ ...robotsOk, [PAGE]: status(302, "https://www.bridebook.com/venue") });
    expect(await checkPage({ fetcher: away, pageUrl: PAGE, website: SITE, previousHash: null }))
      .toEqual({ outcome: "moved", robots: "allowed", httpStatus: 302, hash: null });
    expect(away.asked).not.toContain("https://www.bridebook.com/venue");
    const insecure = fakeFetcher({ ...robotsOk, [PAGE]: status(301, "http://grandcentral.vocohotels.com/x") });
    expect((await checkPage({ fetcher: insecure, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("moved");
  });

  it("keeps to robots.txt where a redirect lands", async () => {
    const fetcher = fakeFetcher({
      [`${SITE}/robots.txt`]: page("User-agent: *\nDisallow: /private/"),
      [PAGE]: status(301, "/private/prices"),
      [`${SITE}/private/prices`]: page(HTML("£130")),
    });
    expect((await checkPage({ fetcher, pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("robots_disallowed");
  });

  it("says a page has gone, and fails plainly on anything else", async () => {
    expect((await checkPage({ fetcher: fakeFetcher({ ...robotsOk, [PAGE]: status(410) }), pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("not_found");
    expect((await checkPage({ fetcher: fakeFetcher({ ...robotsOk, [PAGE]: status(500) }), pageUrl: PAGE, website: SITE, previousHash: null })).outcome).toBe("failed");
  });
});
