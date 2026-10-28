import type { Metric } from "web-vitals";
import {
  WEB_VITAL_NAMES,
  WEB_VITAL_PAGE_PATTERN,
  WebVitalsReportSchema,
  type WebVitalDeviceClass,
  type WebVitalName,
  type WebVitalSample,
  type WebVitalsReport,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import type { LandingRoute } from "./landing-route.js";
import { webVitalsSampleRate, type WebVitalsEnv } from "./web-vitals-rate.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07): a sampled page load reports the LCP, INP, CLS
// and TTFB of the page it landed on, as Google's web-vitals library measures
// them, to POST /public/web-vitals: each vital once, when the page is first
// hidden, and again only for a page restored from the back/forward cache.
//
// What leaves the browser is the landing route's pattern (the router's own
// "/proposal-share/:token", never the address, so a share token or a layout's
// id cannot travel), a device class and the four numbers. The vitals stop at
// the first move to another page in the app, so a room walk's interactions are
// never credited to the front door. No cookie or credential rides with it,
// nothing is stored on the device, and nothing identifies or follows the
// visitor. It is off unless the build sets VITE_WEB_VITALS_SAMPLE_RATE above
// 0, off in tests and under automation, off where the browser asks not to be
// tracked (Global Privacy Control, Do Not Track), and the server keeps nothing
// unless WEB_VITALS_COLLECTION=on, which waits for the privacy page
// (docs/engineering/web-vitals.md).
// ---------------------------------------------------------------------------

/** What a browser says of its visitor's wishes and its own driver. */
export interface ReportingBrowser {
  readonly webdriver?: boolean;
  readonly doNotTrack?: string | null;
  readonly globalPrivacyControl?: boolean;
}

/** Whether this page load reports: sampled in, not automated, not objected to. */
export function shouldReportWebVitals(rate: number, browser: ReportingBrowser, random: () => number = Math.random): boolean {
  if (rate <= 0) return false;
  // Playwright and other drivers measure the test machine, not a visitor.
  if (browser.webdriver === true) return false;
  if (browser.globalPrivacyControl === true || browser.doNotTrack === "1") return false;
  return random() < rate;
}

/** A page whose pattern cannot be reported (a path the rule refuses). */
const UNREPORTABLE_PAGE = "/*";

/**
 * The route pattern a page load landed on, from the router's matched routes'
 * paths, outermost first: "/venues/:venueSlug/twin". An optional parameter
 * keeps its name; a path the page rule refuses reads as "/*".
 */
export function routePattern(paths: readonly (string | undefined)[]): string {
  let pattern = "";
  for (const raw of paths) {
    if (raw === undefined || raw === "") continue;
    const path = raw.replace(/\?(?=\/|$)/gu, "");
    pattern = path.startsWith("/") ? path : `${pattern.replace(/\/+$/u, "")}/${path}`;
  }
  const trimmed = pattern.replace(/\/+$/u, "");
  const page = trimmed === "" ? "/" : trimmed;
  return WEB_VITAL_PAGE_PATTERN.test(page) ? page : UNREPORTABLE_PAGE;
}

/** The hardware, not the window: a touch-first device is a phone when its
 *  screen's shorter side is under 600 CSS px and a tablet otherwise (however
 *  it is held or split); a mouse or trackpad first is a desktop, however
 *  narrow its window. */
export function deviceClass(screenShortSide: number, coarsePointer: boolean): WebVitalDeviceClass {
  if (!coarsePointer) return "desktop";
  return screenShortSide < 600 ? "phone" : "tablet";
}

function isReported(name: Metric["name"]): name is WebVitalName {
  return (WEB_VITAL_NAMES as readonly string[]).includes(name);
}

export interface WebVitalsReporter {
  readonly add: (metric: Metric) => void;
  /** The landing page turned out to be a redirect: report under its target. */
  readonly relabel: (page: string) => void;
  /** The visitor moved to another page in the app: the landing page's
   *  vitals stop at their values now (only its TTFB may still arrive). */
  readonly leave: () => void;
  /** Sends what is held, once, and holds nothing after. */
  readonly flush: () => void;
}

/**
 * Holds each vital's latest value and sends them together when flushed. Each
 * measurement (the library's metric id) is sent once: the library reports CLS
 * and INP again after a page is shown and hidden again, and a second row for
 * one page load would weigh that visitor twice in the p75. A page restored
 * from the back/forward cache is a new measurement with new ids.
 */
export function createWebVitalsReporter(landingPage: string, device: WebVitalDeviceClass, send: (body: string) => void): WebVitalsReporter {
  const held = new Map<WebVitalName, { readonly id: string; readonly sample: WebVitalSample }>();
  const sent = new Set<string>();
  let page = landingPage;
  let left = false;
  return {
    add: (metric) => {
      if (!isReported(metric.name) || sent.has(metric.id)) return;
      if (left && metric.name !== "TTFB") return;
      held.set(metric.name, {
        id: metric.id,
        sample: { name: metric.name, value: metric.value, rating: metric.rating, navigationType: metric.navigationType },
      });
    },
    relabel: (target) => { page = target; },
    leave: () => { left = true; },
    flush: () => {
      if (held.size === 0) return;
      const entries = [...held.values()];
      held.clear();
      for (const entry of entries) sent.add(entry.id);
      const report: WebVitalsReport = { v: 1, page, device, metrics: entries.map((entry) => entry.sample) };
      // Never send what the server would refuse.
      if (!WebVitalsReportSchema.safeParse(report).success) return;
      send(JSON.stringify(report));
    },
  };
}

/**
 * Keeps the reporter on the page the visitor landed on. A redirect (a
 * replace) before the visitor has touched or typed anything moves the label
 * to its target, since the source was never seen; any other move to another
 * route ends the landing page's vitals. A move that keeps the route's
 * pattern (another room's walk, a search parameter) is the same page.
 */
export function followLandingPage(landing: LandingRoute, reporter: WebVitalsReporter): void {
  let page = routePattern(landing.paths);
  landing.follow((change) => {
    const next = routePattern(change.paths);
    if (next === page) return;
    if (change.replace && !change.interacted) {
      page = next;
      reporter.relabel(next);
      return;
    }
    reporter.leave();
    landing.stop();
  });
}

/** Sends a report as plain text (no preflight), without cookies or credentials,
 *  and lets it outlive the page. */
export function sendWebVitals(body: string, endpoint: string = `${API_URL}/public/web-vitals`): void {
  void fetch(endpoint, {
    method: "POST",
    body,
    keepalive: true,
    credentials: "omit",
    headers: { "content-type": "text/plain;charset=UTF-8" },
  }).catch(() => undefined);
}

export interface StartWebVitalsOptions {
  readonly env: WebVitalsEnv;
  /** The landing route and every move from it, recorded since boot. */
  readonly landing: LandingRoute;
  readonly random?: () => number;
  readonly send?: (body: string) => void;
}

/** Starts measuring this page load if it reports at all. Returns whether it does. */
export async function startWebVitals(options: StartWebVitalsOptions): Promise<boolean> {
  const browser = navigator as Navigator & ReportingBrowser;
  if (!shouldReportWebVitals(webVitalsSampleRate(options.env), browser, options.random)) {
    options.landing.stop();
    return false;
  }
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const reporter = createWebVitalsReporter(
    routePattern(options.landing.paths),
    deviceClass(Math.min(window.screen.width, window.screen.height), coarse),
    options.send ?? ((body) => { sendWebVitals(body); }),
  );
  followLandingPage(options.landing, reporter);
  const { onCLS, onINP, onLCP, onTTFB } = await import("web-vitals");
  // Every change, so the values held are current when the visitor moves on.
  onLCP(reporter.add, { reportAllChanges: true });
  onINP(reporter.add, { reportAllChanges: true });
  onCLS(reporter.add, { reportAllChanges: true });
  onTTFB(reporter.add);
  // The library settles its vitals when the page is hidden, which is also the
  // last moment a phone reliably runs anything; send then.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") reporter.flush(); });
  return true;
}
