import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isOnWebsite, type PageCheckOutcome } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The competitor watch's page-change check: one public page, read the way a
// polite crawler reads it, reduced to a hash.
//
//   - It runs only for a page a person has recorded as allowed (the site's
//     terms and robots.txt read), on the competitor's own website, over
//     https. Listing sites and marketplaces are refused before this file is
//     reached (pricePageRefusal in @omnitwin/types).
//   - It reads robots.txt first and obeys it (RFC 9309), naming itself by a
//     clear user agent. A robots.txt it cannot read stops the check.
//   - It stores only a SHA-256 of the page's text and the date. It never
//     keeps the page, never parses a price out of it, and cannot create a
//     capture: it tells a person "Page changed: re-capture".
//   - It stops on 401, 403 and 429 and waits four weeks before asking again;
//     otherwise a page is read at most once a week.
//   - It refuses to connect to any address that is not on the public
//     internet (loopback, private ranges, link-local, cloud metadata), at
//     the moment of connecting, so a name that changes its answer between
//     the check and the connection cannot reach inside.
//
// The network is behind PageFetcher so tests never touch it.
// ---------------------------------------------------------------------------

/** The robots.txt product token the check answers to. */
export const PAGE_CHECK_PRODUCT_TOKEN = "VenviewerPageCheck";
export const PAGE_CHECK_USER_AGENT =
  `${PAGE_CHECK_PRODUCT_TOKEN}/1.0 (+https://venviewer.com; reads one public page at most weekly for a venue's own change alert; keeps a hash, never the content)`;

export const PAGE_CHECK_INTERVAL_MS = 7 * 86_400_000;
export const PAGE_CHECK_BACKOFF_MS = 28 * 86_400_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// ---------------------------------------------------------------------------
// The network, behind an interface
// ---------------------------------------------------------------------------

export type FetchFailure = "timeout" | "network" | "too_large" | "blocked_address";

export type FetchAnswer =
  | { readonly kind: "response"; readonly status: number; readonly body: string; readonly location: string | null }
  | { readonly kind: "failure"; readonly failure: FetchFailure };

/** One GET, redirects not followed. */
export interface PageFetcher {
  get(url: URL): Promise<FetchAnswer>;
}

// ---------------------------------------------------------------------------
// Public addresses only
// ---------------------------------------------------------------------------

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** [network, prefix length] blocks that are not the public internet. */
const IPV4_BLOCKED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function ipv4IsPublic(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  return !IPV4_BLOCKED.some(([network, bits]) => {
    const base = ipv4Number(network) ?? 0;
    const size = 2 ** (32 - bits);
    return value >= base && value < base + size;
  });
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing dotted IPv4 (::ffff:10.0.0.1) becomes two groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(text);
  if (dotted?.[1] !== undefined) {
    const v4 = ipv4Number(dotted[1]);
    if (v4 === null) return null;
    text = `${text.slice(0, -dotted[1].length)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : (halves[1] ?? "").split(":")) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const values = groups.map((group) => (/^[0-9a-f]{1,4}$/u.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return values.some(Number.isNaN) ? null : values;
}

function ipv6IsPublic(address: string): boolean {
  const groups = ipv6Groups(address);
  if (groups === null) return false;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = groups;
  if (groups.every((value) => value === 0)) return false; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g === 0 && h === 1) return false; // ::1
  // IPv4-mapped and IPv4-compatible: judge the IPv4 inside.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return ipv4IsPublic(`${String(g >> 8)}.${String(g & 255)}.${String(h >> 8)}.${String(h & 255)}`);
  }
  if (a === 0x64 && b === 0xff9b) return false; // NAT64
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return false; // discard-only
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if ((a & 0xfe00) === 0xfc00) return false; // unique local
  if ((a & 0xffc0) === 0xfe80) return false; // link-local
  if ((a & 0xff00) === 0xff00) return false; // multicast
  return true;
}

/** Whether a resolved address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family === 6) return ipv6IsPublic(address);
  return false;
}

class BlockedAddressError extends Error {
  readonly code = "VV_BLOCKED_ADDRESS";
  constructor() {
    super("The page's address is not on the public internet");
  }
}

export type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolver: Resolver = (hostname) => new Promise((resolve, reject) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error !== null) reject(error);
    else resolve(addresses);
  });
});

/** A lookup for node:https that answers only public addresses; it runs at
 *  connection time, so what is checked is what is connected to. */
export function guardedLookup(resolver: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then((addresses) => {
      const wanted = options.family === 4 || options.family === 6 ? addresses.filter((entry) => entry.family === options.family) : addresses;
      if (wanted.length === 0 || wanted.some((entry) => !isPublicAddress(entry.address))) {
        callback(new BlockedAddressError(), "", 4);
        return;
      }
      if (options.all === true) {
        callback(null, [...wanted]);
        return;
      }
      const first = wanted[0];
      if (first === undefined) callback(new BlockedAddressError(), "", 4);
      else callback(null, first.address, first.family);
    }, (error: unknown) => {
      callback(error instanceof Error ? error : new Error(String(error)), "", 4);
    });
  };
}

function isBlocked(error: unknown): boolean {
  if (error instanceof BlockedAddressError) return true;
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "VV_BLOCKED_ADDRESS";
}

/** The real fetcher: https only, a public address only, at most 2 MB, ten
 *  seconds, the check's own user agent, redirects returned not followed. */
export function createHttpsPageFetcher(options: { readonly resolver?: Resolver } = {}): PageFetcher {
  const lookup = guardedLookup(options.resolver);
  return {
    get(url: URL): Promise<FetchAnswer> {
      if (url.protocol !== "https:" || isIP(url.hostname.replace(/^\[|\]$/gu, "")) !== 0) {
        return Promise.resolve({ kind: "failure", failure: "blocked_address" });
      }
      return new Promise<FetchAnswer>((resolve) => {
        let settled = false;
        const finish = (answer: FetchAnswer): void => {
          if (settled) return;
          settled = true;
          resolve(answer);
        };
        const req = request(url, {
          method: "GET",
          lookup,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            "user-agent": PAGE_CHECK_USER_AGENT,
            accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
            "accept-encoding": "identity",
          },
        }, (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              res.destroy();
              finish({ kind: "failure", failure: "too_large" });
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const location = res.headers.location;
            finish({
              kind: "response",
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              location: typeof location === "string" ? location : null,
            });
          });
          res.on("error", () => { finish({ kind: "failure", failure: "network" }); });
        });
        req.on("timeout", () => {
          req.destroy();
          finish({ kind: "failure", failure: "timeout" });
        });
        req.on("error", (error) => { finish({ kind: "failure", failure: isBlocked(error) ? "blocked_address" : "network" }); });
        req.end();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

interface RobotsGroup {
  readonly agents: string[];
  readonly rules: { readonly allow: boolean; readonly pattern: string }[];
}

function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRule = false;
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    const line = raw.replace(/#.*$/u, "").trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (current === null || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current !== null) {
      sawRule = true;
      // An empty Disallow allows everything: it is no rule at all.
      if (value !== "") current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`, "u").test(path);
}

/**
 * Whether robots.txt lets `productToken` read `path` (the path and query).
 * The groups naming the token apply, else those for "*"; the longest
 * matching rule wins, and Allow wins a tie.
 */
export function robotsAllows(robotsTxt: string, productToken: string, path: string): boolean {
  if (path === "/robots.txt") return true;
  const groups = parseRobots(robotsTxt);
  const token = productToken.toLowerCase();
  const named = groups.filter((group) => group.agents.includes(token));
  const applying = named.length > 0 ? named : groups.filter((group) => group.agents.includes("*"));
  let best: { readonly allow: boolean; readonly length: number } | null = null;
  for (const rule of applying.flatMap((group) => group.rules)) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (best === null || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best === null ? true : best.allow;
}

// ---------------------------------------------------------------------------
// The page's text, reduced to a hash
// ---------------------------------------------------------------------------

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", pound: "£" };

function codePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/** The page's readable text, the main block where it has one, without its
 *  scripts, styles, navigation, header, footer and forms, so a rotating
 *  banner or a cookie script does not read as a change. */
export function pageText(html: string): string {
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
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
  return text.replace(/\s+/gu, " ").trim();
}

export function pageTextHash(html: string): string {
  return createHash("sha256").update(pageText(html), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// One check
// ---------------------------------------------------------------------------

export type RobotsAnswer = "allowed" | "disallowed" | "unreadable";

export interface PageCheckAnswer {
  readonly outcome: PageCheckOutcome;
  readonly robots: RobotsAnswer;
  readonly httpStatus: number | null;
  /** The text's hash when the page was read; null otherwise. */
  readonly hash: string | null;
}

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 429]);

/** Follows redirects that stay on the venue's website over https. */
async function getFollowing(fetcher: PageFetcher, start: URL, website: string): Promise<
  | { readonly kind: "response"; readonly status: number; readonly body: string; readonly url: URL }
  | { readonly kind: "moved"; readonly status: number }
  | { readonly kind: "failure"; readonly failure: FetchFailure }
> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const answer = await fetcher.get(url);
    if (answer.kind === "failure") return answer;
    if (!REDIRECTS.has(answer.status) || answer.location === null) {
      return { kind: "response", status: answer.status, body: answer.body, url };
    }
    let next: URL;
    try { next = new URL(answer.location, url); } catch { return { kind: "moved", status: answer.status }; }
    if (next.protocol !== "https:" || !isOnWebsite(next.href, website)) return { kind: "moved", status: answer.status };
    url = next;
  }
  return { kind: "moved", status: 310 };
}

/**
 * Reads robots.txt, then the page if robots.txt allows it, and compares the
 * text's hash with the last one. Never throws for anything the network or
 * the site does.
 */
export async function checkPage(input: {
  readonly fetcher: PageFetcher;
  readonly pageUrl: string;
  readonly website: string;
  readonly previousHash: string | null;
}): Promise<PageCheckAnswer> {
  let page: URL;
  try { page = new URL(input.pageUrl); } catch { return { outcome: "failed", robots: "unreadable", httpStatus: null, hash: null }; }

  const robots = await getFollowing(input.fetcher, new URL("/robots.txt", page.origin), input.website);
  if (robots.kind === "failure") return { outcome: "failed", robots: "unreadable", httpStatus: null, hash: null };
  if (robots.kind === "moved") return { outcome: "failed", robots: "unreadable", httpStatus: robots.status, hash: null };
  if (REFUSALS.has(robots.status)) return { outcome: "refused", robots: "unreadable", httpStatus: robots.status, hash: null };
  let robotsText = "";
  if (robots.status >= 200 && robots.status < 300) robotsText = robots.body;
  else if (robots.status !== 404 && robots.status !== 410) {
    // Unreachable or unexplained: RFC 9309 says assume everything is disallowed.
    return { outcome: "failed", robots: "unreadable", httpStatus: robots.status, hash: null };
  }

  const path = `${page.pathname}${page.search}`;
  if (!robotsAllows(robotsText, PAGE_CHECK_PRODUCT_TOKEN, path)) {
    return { outcome: "robots_disallowed", robots: "disallowed", httpStatus: null, hash: null };
  }

  const read = await getFollowing(input.fetcher, page, input.website);
  if (read.kind === "failure") return { outcome: "failed", robots: "allowed", httpStatus: null, hash: null };
  if (read.kind === "moved") return { outcome: "moved", robots: "allowed", httpStatus: read.status, hash: null };
  // A redirect inside the site lands on a path robots.txt must also allow.
  const landed = `${read.url.pathname}${read.url.search}`;
  if (landed !== path && !robotsAllows(robotsText, PAGE_CHECK_PRODUCT_TOKEN, landed)) {
    return { outcome: "robots_disallowed", robots: "disallowed", httpStatus: null, hash: null };
  }
  if (REFUSALS.has(read.status)) return { outcome: "refused", robots: "allowed", httpStatus: read.status, hash: null };
  if (read.status === 404 || read.status === 410) return { outcome: "not_found", robots: "allowed", httpStatus: read.status, hash: null };
  if (read.status < 200 || read.status >= 300) return { outcome: "failed", robots: "allowed", httpStatus: read.status, hash: null };

  const hash = pageTextHash(read.body);
  const outcome: PageCheckOutcome = input.previousHash === null ? "first_seen" : input.previousHash === hash ? "unchanged" : "changed";
  return { outcome, robots: "allowed", httpStatus: read.status, hash };
}

/** When the next check may run: a week on, four weeks after a refusal. */
export function nextCheckAfter(now: Date, outcome: PageCheckOutcome): Date {
  return new Date(now.getTime() + (outcome === "refused" ? PAGE_CHECK_BACKOFF_MS : PAGE_CHECK_INTERVAL_MS));
}
