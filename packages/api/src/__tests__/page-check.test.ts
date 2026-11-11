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

  /** robotsAllows on one Disallow rule, with how long it took. */
  function timedDisallow(pattern: string, path: string): { readonly allowed: boolean; readonly ms: number } {
    const robots = `User-agent: *\nDisallow: ${pattern}`;
    const started = performance.now();
    const allowed = robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, path);
    return { allowed, ms: performance.now() - started };
  }

  it("answers a rule full of stars at once, without backtracking", () => {
    // A competitor's robots.txt can hold such a value. A backtracking regex
    // takes combinatorial time on it when the path has no Z, stalling the
    // event loop for every venue. Eight stars already take seconds there, so
    // that case is checked first: it fails promptly instead of hanging on 32.
    const short = timedDisallow(`/${"*".repeat(8)}Z`, "/wedding-packages/grand-central/2026-xyz");
    expect(short.allowed).toBe(true);
    expect(short.ms).toBeLessThan(50);

    const path = "/wedding-packages/grand-central-hall/2026/summer-menus?page=2";
    expect(path.length).toBeGreaterThanOrEqual(40);
    expect(path).not.toContain("Z");
    const long = timedDisallow(`/${"*".repeat(32)}Z`, path);
    expect(long.allowed).toBe(true);
    expect(long.ms).toBeLessThan(50);
    // And the same rule still matches a path that has the Z.
    expect(timedDisallow(`/${"*".repeat(32)}Z`, `${path}Z`).allowed).toBe(false);
  });

  it.each([
    // * at the start, in the middle and at the end, matching any run including none
    ["*/private", "/a/private", true],
    ["*/private", "/a/public", false],
    ["/a*c", "/abc", true],
    ["/a*c", "/ac", true],
    ["/a*c", "/ab", false],
    ["/a*c", "/xabc", false],
    ["/a*", "/a", true],
    ["/a*", "/abc", true],
    ["/a*", "/b", false],
    // adjacent stars
    ["/a**c", "/ac", true],
    ["/a**c", "/a-b-c", true],
    ["/a***", "/a", true],
    ["/a**c", "/a", false],
    // without the end anchor a prefix is enough
    ["/rooms", "/rooms/suite", true],
    ["/rooms", "/room", false],
    // the end anchor, without stars
    ["/a$", "/a", true],
    ["/a$", "/ab", false],
    ["/a$", "/a?x", false],
    ["/$", "/", true],
    ["/$", "/a", false],
    // the end anchor, with stars
    ["/*.pdf$", "/x.pdf", true],
    ["/*.pdf$", "/x.pdf.pdf", true],
    ["/*.pdf$", "/x.pdf?y", false],
    ["/a*b$", "/ab", true],
    ["/a*b$", "/abab", true],
    ["/a*b$", "/aba", false],
    ["/ab*b$", "/ab", false],
    ["/ab*b$", "/abb", true],
    ["/a*$", "/a", true],
    ["/a*$", "/abc", true],
    // a $ anywhere but the very end is an ordinary character
    ["/a$b", "/a$b", true],
    ["/a$b", "/a$bc", true],
    ["/a$b", "/a", false],
    ["/a$b", "/ab", false],
    ["/a$$", "/a$", true],
    ["/a$$", "/a$x", false],
    ["/price$*/list", "/price$9/list", true],
    // regex metacharacters are literals
    ["/a.b", "/a.b", true],
    ["/a.b", "/axb", false],
    ["/.*", "/abc", false],
    ["/.*", "/.abc", true],
    ["/a?b", "/a?b", true],
    ["/a?b", "/ab", false],
    ["/a+", "/a+", true],
    ["/a+", "/aa", false],
    ["/(x)", "/(x)", true],
    ["/(x)", "/x", false],
    ["/[ab]", "/[ab]", true],
    ["/[ab]", "/a", false],
    ["/a|b", "/b", false],
    ["/a|b", "/a|b", true],
    ["/^a", "/^a", true],
    ["/a{2}", "/aa", false],
    ["/a{2}", "/a{2}", true],
    ["/a\\d", "/a\\d", true],
    ["/a\\d", "/a1", false],
    // the query string is part of the path
    ["/*?", "/weddings/?date=1", true],
    ["/*?", "/weddings/", false],
    ["/search?q=*&page=2", "/search?q=hall&page=2", true],
    ["/search?q=*&page=2", "/search?q=hall", false],
    ["/*?sort=$", "/list?sort=", true],
    ["/*?sort=$", "/list?sort=asc", false],
  ] as const)("Disallow: %s %s matches: %s", (pattern, path, matches) => {
    expect(robotsAllows(`User-agent: *\nDisallow: ${pattern}`, PAGE_CHECK_PRODUCT_TOKEN, path)).toBe(!matches);
  });

  it("still lets the longest matching rule win, and Allow take a tie, with wildcards", () => {
    const robots = "User-agent: *\nDisallow: /*.php\nAllow: /public/*";
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/public/x.php")).toBe(true);
    expect(robotsAllows(robots, PAGE_CHECK_PRODUCT_TOKEN, "/x.php")).toBe(false);
    expect(robotsAllows("User-agent: *\nAllow: /*.php\nDisallow: /public/*", PAGE_CHECK_PRODUCT_TOKEN, "/public/x.php")).toBe(false);
    expect(robotsAllows("User-agent: *\nAllow: /a*c\nDisallow: /ab*", PAGE_CHECK_PRODUCT_TOKEN, "/abc")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /ab*\nAllow: /a*c", PAGE_CHECK_PRODUCT_TOKEN, "/abc")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /ab*\nAllow: /a*c", PAGE_CHECK_PRODUCT_TOKEN, "/abd")).toBe(false);
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

  /** A body of `unit` repeated to exactly `size` characters. */
  function filled(unit: string, size: number): string {
    return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  }

  /** pageTextHash on a body, with how long it took. */
  function timedHash(body: string): { readonly hash: string; readonly ms: number } {
    const started = performance.now();
    const hash = pageTextHash(body);
    return { hash, ms: performance.now() - started };
  }

  it.each([
    ["nothing but <", "<"],
    ["comments never closed", "<!--"],
    ["script tags never ended", "<script"],
    ["scripts never closed", "<script>"],
    ["a main block never closed", "<main>"],
    ["a body never closed", "<body>"],
    ["navigation never closed", "<nav>"],
    ["every kind of opener at once", "<!--<script><style><svg><head><main><body><nav><form><"],
    ["tags never ended", "<a"],
    ["tags beginning beyond ASCII", "<é"],
    ["entities never ended", "&#x0"],
  ] as const)("reads 2 MB of %s in linear time", (_shape, unit) => {
    // The page comes from a site the check does not control, and 2 MB is the
    // most the fetcher accepts. A pass that rescans the rest of the page from
    // every opener takes minutes to an hour on it, with the API's event loop
    // stalled for every venue. Such a pass already takes from half a second
    // to ten seconds on 128 KB, so that size is checked first: it fails
    // promptly there instead of hanging on 2 MB.
    const small = timedHash(filled(unit, 128 * 1024));
    expect(small.ms).toBeLessThan(100);
    const large = timedHash(filled(unit, 2 * 1024 * 1024));
    expect(large.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(large.ms).toBeLessThan(1000);
  });

  // A watched page must read exactly as it did before the text was taken
  // without regular expressions: a different reading of the same page would
  // report every watched competitor page as changed on its next check.
  const VENUE_PAGE = [
    "<!DOCTYPE html>",
    "<html lang=\"en-GB\">",
    "<head>",
    "<meta charset=\"UTF-8\">",
    "<title>Weddings at The Grand Central &#8211; Glasgow</title>",
    "<link rel=\"stylesheet\" href=\"/wp-content/themes/hotel/style.css?ver=6.4\">",
    "<script>window.dataLayer = window.dataLayer || []; if (a < b && b > c) { document.write(\"</div>\"); }</script>",
    "<style>.hero > h1 { color: #333; } /* <main> */</style>",
    "<!--[if lt IE 9]><script src=\"/html5shiv.js\"></script><![endif]-->",
    "</head>",
    "<body class=\"page-template-default page page-id-42\">",
    "<div id=\"cookie-notice\" role=\"dialog\">We use cookies. <a href=\"/privacy\">Read more</a></div>",
    "<header class=\"site-header\"><a class=\"logo\" href=\"/\"><svg viewBox=\"0 0 10 10\"><title>Logo</title><path d=\"M0 0h10v10z\"/></svg></a>",
    "<nav aria-label=\"Primary\"><ul><li><a href=\"/rooms/\">Rooms</a></li><li><a href=\"/weddings/\" aria-current=\"page\">Weddings</a></li></ul></nav></header>",
    "<main id=\"content\" class=\"site-main\">",
    "<!-- wp:heading -->",
    "<h1 class=\"entry-title\">Wedding Packages</h1>",
    "<p>Our Grand Central Package is &pound;130&nbsp;per person, including a drinks reception &amp; three-course meal.</p>",
    "<p>Evening buffet from &#163;18.50 &#x2013; minimum 80 guests.</p>",
    "<ul><li>Exclusive use of the Champagne Bar</li><li>Overnight suite for the couple</li></ul>",
    "<noscript><iframe src=\"https://www.googletagmanager.com/ns.html?id=GTM-TEST\" height=\"0\" width=\"0\"></iframe></noscript>",
    "<form class=\"enquiry\" action=\"/enquire\" method=\"post\"><label>Date <input type=\"date\" name=\"date\"></label><button>Enquire</button></form>",
    "<template id=\"row\"><tr><td>Hidden template row</td></tr></template>",
    "</main>",
    "<footer class=\"site-footer\"><p>&copy; 2026 Grand Central Hotel. All rights reserved.</p></footer>",
    "<script type=\"text/javascript\" src=\"/wp-includes/js/jquery.min.js\"></script>",
    "</body>",
    "</html>",
  ].join("\n");
  const OLD_CMS_PAGE = [
    "<HTML><HEAD><TITLE>Function Rooms</TITLE>",
    "<SCRIPT TYPE=\"text/javascript\">var x = \"<b>\"; </SCRIPT >",
    "</HEAD>",
    "<BODY BGCOLOR=\"#FFFFFF\">",
    "<Nav><A HREF=\"/\">Home</A> | <A HREF=\"/contact\">Contact</A></Nav>",
    "<TABLE><TR><TD><FONT FACE=\"Arial\"><B>Function Room Hire</B></FONT></TD></TR>",
    "<TR><TD>Day delegate rate: &pound;45 + VAT<BR>Room hire from &#xA3;250 &mdash; prices < &pound;300 for charities</TD></TR>",
    "<TR><TD><A HREF=\"/menu.pdf\" TITLE=\"Menus > Download\">Download our menus</A></TD></TR></TABLE>",
    "<Header>not really a header</Header>",
    "<P>Call 0141 000 0000 &amp; ask for events.",
    "</BODY></HTML>",
    "<!-- generated by an old CMS",
  ].join("\n");
  const FRAGMENT = [
    "<div class=\"widget\"><main-menu data-x=\"1\"><a href=\"/\">Home</a></main-menu>",
    "<p>Packages from &pound;95.</p></div>",
    "<nav><nav>Inner</nav>Outer tail</nav>",
    "<p>Contact &lt;events@example.com&gt; &#39;today&#39;</p>",
    "<header><h2>Gallery</h2></header><headline>Kept headline</headline>",
    "<scripted>Kept scripted</scripted>",
  ].join("\n");

  it.each([
    [
      "a venue's page",
      VENUE_PAGE,
      "Wedding Packages Our Grand Central Package is £130 per person, including a drinks reception & three-course meal. Evening buffet from £18.50 – minimum 80 guests. Exclusive use of the Champagne Bar Overnight suite for the couple",
      "f0635551d0014565960b74dfcb1f83946d61e9929e8d3ab7e97e542263ddb1c3",
    ],
    [
      "an old CMS page with capitals, a stray < and a > inside an attribute",
      OLD_CMS_PAGE,
      "Function Room Hire Day delegate rate: £45 + VAT Room hire from £250 &mdash; prices Download\">Download our menus Call 0141 000 0000 & ask for events.",
      "df30e03731756ba98ffb652e05b89616bcb6a4c58bb899688f45a82da39000f7",
    ],
    [
      "a fragment with nested navigation and look-alike tag names",
      FRAGMENT,
      "Home Packages from £95. Outer tail Contact <events@example.com> 'today' Kept headline Kept scripted",
      "ab0ed11fc7ad297cbf54cc37561146ed2aed09f2e1dbe7d8fd4c869f6393e38a",
    ],
  ] as const)("reads %s exactly as before", (_page, html, text, hash) => {
    expect(pageText(html)).toBe(text);
    expect(pageTextHash(html)).toBe(hash);
  });

  /** How pageText read a page with regular expressions until November 2026,
   *  kept as the reference the linear reading must agree with. Only ever
   *  given short inputs here, where its quadratic cost does not matter. */
  function regexPageText(html: string): string {
    const entities: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", pound: "£" };
    const codePoint = (code: number): string => (Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ");
    let text = html.replace(/<!--[\s\S]*?-->/gu, " ");
    text = text.replace(/<(script|style|noscript|template|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ");
    const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/iu.exec(text);
    const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/iu.exec(text);
    text = main?.[1] ?? body?.[1] ?? text;
    text = text.replace(/<(nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ");
    text = text.replace(/<[^>]*>/gu, " ");
    text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, name: string) => {
      if (/^#x/iu.test(name)) return codePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith("#")) return codePoint(Number.parseInt(name.slice(1), 10));
      return entities[name.toLowerCase()] ?? whole;
    });
    return text.replace(/\s+/gu, " ").trim();
  }

  it("reads any page exactly as the regular expressions it replaced did", () => {
    // Random pages built from the pieces each step reacts to: openers and
    // closers in every case, unclosed and nested ones, look-alike names
    // (<headline>, <main-menu>), the long s and Kelvin sign that a
    // case-insensitive match folds to s and k, odd spacing in closers, and
    // entities. A fixed seed keeps every run the same.
    const pieces = [
      "<", ">", "/", "!", "-", " ", "\n", "\t", " ", "a", "£130", "&", ";", "\"",
      "<!--", "-->", "<!-->", "--", "</",
      "<script", "<script>", "</script>", "</script >", "</SCRIPT\n>", "<SCRIPT type=\"x\">", "<ſcript>", "</ſcript>", "<scripted>",
      "<style>", "</style>", "<svg", "</svg>", "<iframe>", "</iframe>", "<noscript>", "</noscript>", "<template>", "</template>",
      "<head>", "</head>", "<headline>", "<head-x>",
      "<main>", "</main>", "</main >", "<MAIN class=a>", "<main-menu>", "<mainx>",
      "<body>", "</body>", "<BODY x>", "</Body>",
      "<nav>", "</nav>", "<NAV>", "<navy>", "<header>", "</header>", "<footer>", "</footer>", "<form", "</form\t>", "<formal>",
      "K", "&amp;", "&pound;", "&#163;", "&#xA3;", "&#x110000;", "&bogus;", "&AMP;",
    ];
    let seed = 0x5eed;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const differing: string[] = [];
    for (let page = 0; page < 5000; page += 1) {
      let html = "";
      const length = Math.floor(random() * 40);
      for (let piece = 0; piece < length; piece += 1) html += pieces[Math.floor(random() * pieces.length)] ?? "";
      if (pageText(html) !== regexPageText(html)) differing.push(html);
    }
    expect(differing.slice(0, 5)).toEqual([]);
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
