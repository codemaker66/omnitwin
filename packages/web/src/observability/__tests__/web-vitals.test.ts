import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric } from "web-vitals";
import { webVitalsSampleRate } from "../web-vitals-rate.js";
import {
  createWebVitalsReporter, deviceClass, routePattern, sendWebVitals, shouldReportWebVitals, startWebVitals,
} from "../web-vitals.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07) from the browser: a route's pattern, a device
// class and four numbers leave a sampled page load once, and nothing else
// ever does. Off unless sampled; off in tests, under automation and where the
// browser asks not to be tracked.
// ---------------------------------------------------------------------------

const { vitals } = vi.hoisted(() => ({
  vitals: { callbacks: new Map<string, (metric: Metric) => void>() },
}));
vi.mock("web-vitals", () => ({
  onLCP: (callback: (metric: Metric) => void) => { vitals.callbacks.set("LCP", callback); },
  onINP: (callback: (metric: Metric) => void) => { vitals.callbacks.set("INP", callback); },
  onCLS: (callback: (metric: Metric) => void) => { vitals.callbacks.set("CLS", callback); },
  onTTFB: (callback: (metric: Metric) => void) => { vitals.callbacks.set("TTFB", callback); },
}));

function metric(name: Metric["name"], value: number, rating: Metric["rating"] = "good"): Metric {
  return {
    name, value, rating, delta: value, id: "v6-1761650000000-1234567890", navigationId: 1, entries: [], navigationType: "navigate",
    // The library may name the address a metric belongs to; it never travels.
    navigationURL: "https://venviewer.com/proposal-share/tok_SECRET123",
  } as Metric;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vitals.callbacks.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the sample rate", () => {
  it("is off unless a build sets a share from 0 to 1, and always off in tests", () => {
    expect(webVitalsSampleRate({})).toBe(0);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "" })).toBe(0);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "0.25" })).toBe(0.25);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "1" })).toBe(1);
    for (const raw of ["2", "-0.1", "half", "NaN"]) expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: raw }), raw).toBe(0);
    expect(webVitalsSampleRate({ MODE: "test", VITE_WEB_VITALS_SAMPLE_RATE: "1" })).toBe(0);
  });

  it("reports a page load only when sampled in, never under a driver or against the browser's wish", () => {
    expect(shouldReportWebVitals(0, {}, () => 0)).toBe(false);
    expect(shouldReportWebVitals(0.5, {}, () => 0.49)).toBe(true);
    expect(shouldReportWebVitals(0.5, {}, () => 0.5)).toBe(false);
    expect(shouldReportWebVitals(1, { webdriver: true }, () => 0)).toBe(false);
    expect(shouldReportWebVitals(1, { globalPrivacyControl: true }, () => 0)).toBe(false);
    expect(shouldReportWebVitals(1, { doNotTrack: "1" }, () => 0)).toBe(false);
    expect(shouldReportWebVitals(1, { doNotTrack: "0", globalPrivacyControl: false, webdriver: false }, () => 0)).toBe(true);
  });
});

describe("what a report says of the page and the device", () => {
  it.each([
    [[undefined, "/proposal-share/:token"], "/proposal-share/:token"],
    [["/venues/:venueSlug", "twin"], "/venues/:venueSlug/twin"],
    [[undefined, "/captures/:roomSlug?"], "/captures/:roomSlug"],
    [["/"], "/"],
    [[], "/"],
    [["*"], "/*"],
    [["/plan/:code", ""], "/plan/:code"],
    // A pattern the page rule refuses is never sent as itself.
    [["/dev/fixture-v2"], "/*"],
  ] as const)("reads %j as %s", (paths, expected) => {
    expect(routePattern(paths)).toBe(expected);
  });

  it("calls a narrow screen a phone, a coarse pointer up to a large tablet a tablet, and the rest desktops", () => {
    expect(deviceClass(390, true)).toBe("phone");
    expect(deviceClass(767, false)).toBe("phone");
    expect(deviceClass(820, true)).toBe("tablet");
    expect(deviceClass(1366, true)).toBe("tablet");
    expect(deviceClass(1440, true)).toBe("desktop");
    expect(deviceClass(1024, false)).toBe("desktop");
  });
});

describe("the reporter", () => {
  it("sends each vital's latest value once, together, and nothing but the four", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/plan/:code", "phone", send);
    reporter.add(metric("TTFB", 412.25));
    reporter.add(metric("FCP", 900));
    reporter.add(metric("LCP", 2_100));
    reporter.add(metric("LCP", 5_234.5, "poor"));
    reporter.add(metric("CLS", 0.04));
    reporter.flush();
    reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]?.[0] ?? "{}")).toEqual({
      v: 1,
      page: "/plan/:code",
      device: "phone",
      metrics: [
        { name: "TTFB", value: 412.25, rating: "good", navigationType: "navigate" },
        { name: "LCP", value: 5_234.5, rating: "poor", navigationType: "navigate" },
        { name: "CLS", value: 0.04, rating: "good", navigationType: "navigate" },
      ],
    });
    // The library's metric id, its entries and the address never travel.
    expect(send.mock.calls[0]?.[0]).not.toMatch(/v6-|entries|http|tok_SECRET123|navigationURL/u);
  });

  it("sends nothing it holds nothing of, and nothing the server would refuse", () => {
    const send = vi.fn<(body: string) => void>();
    createWebVitalsReporter("/", "desktop", send).flush();
    const broken = createWebVitalsReporter("/", "desktop", send);
    broken.add(metric("LCP", Number.NaN));
    broken.flush();
    const unpatterned = createWebVitalsReporter("/proposal-share/tok_SECRET123", "desktop", send);
    unpatterned.add(metric("LCP", 1_000));
    unpatterned.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("posts as plain text with no cookie or credential, outliving the page", () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    sendWebVitals("{\"v\":1}", "https://api.example.test/public/web-vitals");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/public/web-vitals", {
      method: "POST",
      body: "{\"v\":1}",
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  });
});

describe("starting on a page load", () => {
  it("measures a sampled load and sends its landing route's vitals when the page is hidden", async () => {
    const send = vi.fn<(body: string) => void>();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: query === "(pointer: coarse)" } as MediaQueryList));
    vi.stubGlobal("innerWidth", 390);
    // An ordinary visitor's browser (jsdom's says it is driven).
    vi.stubGlobal("navigator", { webdriver: false, doNotTrack: null, globalPrivacyControl: false });
    const started = await startWebVitals({
      env: { VITE_WEB_VITALS_SAMPLE_RATE: "1" },
      routePaths: [undefined, "/proposal-share/:token"],
      random: () => 0,
      send,
    });
    expect(started).toBe(true);
    for (const [name, callback] of vitals.callbacks) callback(metric(name as Metric["name"], name === "CLS" ? 0.02 : 300));
    expect(send).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(send).toHaveBeenCalledTimes(1);
    const report = JSON.parse(send.mock.calls[0]?.[0] ?? "{}") as { page: string; device: string; metrics: { name: string }[] };
    expect(report.page).toBe("/proposal-share/:token");
    expect(report.device).toBe("phone");
    expect(report.metrics.map((sample) => sample.name).sort()).toEqual(["CLS", "INP", "LCP", "TTFB"]);
    setVisibility("visible");
  });

  it("measures nothing in tests, unsampled, under a driver or where the browser objects", async () => {
    const send = vi.fn<(body: string) => void>();
    expect(await startWebVitals({ env: { MODE: "test", VITE_WEB_VITALS_SAMPLE_RATE: "1" }, routePaths: ["/"], random: () => 0, send })).toBe(false);
    expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "0.1" }, routePaths: ["/"], random: () => 0.5, send })).toBe(false);
    vi.stubGlobal("navigator", { webdriver: false, doNotTrack: null, globalPrivacyControl: true });
    expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "1" }, routePaths: ["/"], random: () => 0, send })).toBe(false);
    vi.stubGlobal("navigator", { webdriver: true, doNotTrack: null, globalPrivacyControl: false });
    expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "1" }, routePaths: ["/"], random: () => 0, send })).toBe(false);
    expect(vitals.callbacks.size).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("is loaded only by a build that samples: the entry module never imports the reporter itself", () => {
    const main = readFileSync(resolve("src/main.tsx"), "utf8");
    expect(main).not.toMatch(/^import .*observability\/web-vitals\.js/mu);
    expect(main).toContain("import(\"./observability/web-vitals.js\")");
    expect(main).toMatch(/if \(webVitalsSampleRate\(import\.meta\.env\) > 0\)/u);
  });
});
