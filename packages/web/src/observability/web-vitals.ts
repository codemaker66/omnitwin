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
import { webVitalsSampleRate, type WebVitalsEnv } from "./web-vitals-rate.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07): a sampled page load reports its LCP, INP, CLS
// and TTFB once, as Google's web-vitals library measures them, to
// POST /public/web-vitals.
//
// What leaves the browser is the landing route's pattern (the router's own
// "/proposal-share/:token", never the address, so a share token or a layout's
// id cannot travel), a device class and the four numbers. No cookie or
// credential rides with it, nothing is stored on the device, and nothing
// identifies or follows the visitor. It is off unless the build sets
// VITE_WEB_VITALS_SAMPLE_RATE above 0, off in tests and under automation, off
// where the browser asks not to be tracked (Global Privacy Control, Do Not
// Track), and the server keeps nothing unless WEB_VITALS_COLLECTION=on, which
// waits for the privacy page (docs/engineering/web-vitals.md).
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

/** Phones by width; tablets by a coarse pointer up to a large tablet's width. */
export function deviceClass(width: number, coarsePointer: boolean): WebVitalDeviceClass {
  if (width < 768) return "phone";
  if (coarsePointer && width <= 1366) return "tablet";
  return "desktop";
}

function isReported(name: Metric["name"]): name is WebVitalName {
  return (WEB_VITAL_NAMES as readonly string[]).includes(name);
}

export interface WebVitalsReporter {
  readonly add: (metric: Metric) => void;
  /** Sends what is held, once, and holds nothing after. */
  readonly flush: () => void;
}

/** Holds each vital's latest value and sends them together when flushed. */
export function createWebVitalsReporter(page: string, device: WebVitalDeviceClass, send: (body: string) => void): WebVitalsReporter {
  const held = new Map<WebVitalName, WebVitalSample>();
  return {
    add: (metric) => {
      if (!isReported(metric.name)) return;
      held.set(metric.name, { name: metric.name, value: metric.value, rating: metric.rating, navigationType: metric.navigationType });
    },
    flush: () => {
      if (held.size === 0) return;
      const report: WebVitalsReport = { v: 1, page, device, metrics: [...held.values()] };
      held.clear();
      // Never send what the server would refuse.
      if (!WebVitalsReportSchema.safeParse(report).success) return;
      send(JSON.stringify(report));
    },
  };
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
  /** The landing route's matched paths, outermost first. */
  readonly routePaths: readonly (string | undefined)[];
  readonly random?: () => number;
  readonly send?: (body: string) => void;
}

/** Starts measuring this page load if it reports at all. Returns whether it does. */
export async function startWebVitals(options: StartWebVitalsOptions): Promise<boolean> {
  const browser = navigator as Navigator & ReportingBrowser;
  if (!shouldReportWebVitals(webVitalsSampleRate(options.env), browser, options.random)) return false;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const reporter = createWebVitalsReporter(routePattern(options.routePaths), deviceClass(window.innerWidth, coarse), options.send ?? ((body) => { sendWebVitals(body); }));
  const { onCLS, onINP, onLCP, onTTFB } = await import("web-vitals");
  onLCP(reporter.add);
  onINP(reporter.add);
  onCLS(reporter.add);
  onTTFB(reporter.add);
  // The library reports LCP, INP and CLS when the page is hidden; send then.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") reporter.flush(); });
  window.addEventListener("pagehide", reporter.flush);
  return true;
}
