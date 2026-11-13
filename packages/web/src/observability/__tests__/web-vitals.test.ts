import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric } from "web-vitals";
import { WEB_VITALS_REPORT_BYTES, WEB_VITAL_RATING_BOUNDS } from "@omnitwin/types";
import { webVitalsSampleRate } from "../web-vitals-rate.js";
import { recordLandingRoute, type AppRoutes, type LandingRoute } from "../landing-route.js";
import { MEASUREMENT_DECLINED_KEY, setMeasurementDeclined } from "../measurement-choice.js";
import {
  createWebVitalsReporter, deviceClass, followLandingPage, routePattern, sendWebVitals, shouldReportWebVitals, startWebVitals,
} from "../web-vitals.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07) from the browser: a route's pattern, a device
// class and four numbers leave a sampled page load, each measurement once and
// only for the page it landed on, and nothing else ever does. Off unless
// sampled; off in tests, under automation and where the browser asks not to
// be tracked.
// ---------------------------------------------------------------------------

interface Registered { readonly callback: (metric: Metric) => void; readonly reportAllChanges: boolean }
const { vitals } = vi.hoisted(() => ({
  vitals: { callbacks: new Map<string, Registered>() },
}));
function register(name: string) {
  return (callback: (metric: Metric) => void, options?: { reportAllChanges?: boolean }): void => {
    vitals.callbacks.set(name, { callback, reportAllChanges: options?.reportAllChanges === true });
  };
}
vi.mock("web-vitals", () => ({ onLCP: register("LCP"), onINP: register("INP"), onCLS: register("CLS"), onTTFB: register("TTFB") }));

/** One measurement of a vital; a page restored from the back/forward cache
 *  measures again under a new id. */
function metric(name: Metric["name"], value: number, rating: Metric["rating"] = "good", id = `v6-1761650000000-${name}`, navigationType: Metric["navigationType"] = "navigate"): Metric {
  return {
    name, value, rating, delta: value, id, navigationId: 1, entries: [], navigationType,
    // The library may name the address a metric belongs to; it never travels.
    navigationURL: "https://venviewer.com/proposal-share/tok_SECRET123",
  } as Metric;
}

function sentReports(send: { mock: { calls: string[][] } }): { page: string; device: string; metrics: { name: string; value: number; rating: string }[] }[] {
  return send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}") as { page: string; device: string; metrics: { name: string; value: number; rating: string }[] });
}

/** A router that moves when told, as React Router's data router reports. */
function fakeRouter(paths: readonly (string | undefined)[]): AppRoutes & { move: (to: readonly (string | undefined)[], action: string) => void; listeners: number } {
  const listeners = new Set<(state: AppRoutes["state"]) => void>();
  const router = {
    state: { matches: paths.map((path) => ({ route: { path } })), historyAction: "POP" },
    subscribe: (listener: (state: AppRoutes["state"]) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    move: (to: readonly (string | undefined)[], action: string) => {
      router.state = { matches: to.map((path) => ({ route: { path } })), historyAction: action };
      for (const listener of listeners) listener(router.state);
    },
    get listeners() { return listeners.size; },
  };
  return router;
}

/** An ordinary visitor's browser (happy-dom's says it is driven). */
function ordinaryBrowser(overrides: { globalPrivacyControl?: boolean; webdriver?: boolean } = {}): void {
  vi.stubGlobal("navigator", { webdriver: false, doNotTrack: null, globalPrivacyControl: false, ...overrides });
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
  it("is off unless a build sets a decimal share below 1, and always off in tests", () => {
    expect(webVitalsSampleRate({})).toBe(0);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "" })).toBe(0);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "0" })).toBe(0);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: "0.25" })).toBe(0.25);
    expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: " .5 " })).toBe(0.5);
    // Never every page load: the privacy page says the browser "may" measure one.
    for (const raw of ["1", "1.0", "2", "0.99999999999999999", "-0.1", "half", "NaN", "Infinity", "0x1", "1e-1", "0.5.1"]) {
      expect(webVitalsSampleRate({ VITE_WEB_VITALS_SAMPLE_RATE: raw }), raw).toBe(0);
    }
    expect(webVitalsSampleRate({ MODE: "test", VITE_WEB_VITALS_SAMPLE_RATE: "0.5" })).toBe(0);
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
    // A pattern outside the list of pages is never sent as itself: a dev
    // fixture, or a path with the shape of a page that is not one.
    [["/dev/fixture-v2"], "/*"],
    [["/dev/planner-lab"], "/*"],
    [["/plan/kxbmtq"], "/*"],
  ] as const)("reads %j as %s", (paths, expected) => {
    expect(routePattern(paths)).toBe(expected);
  });

  it("classes the hardware, not the window: touch-first by its screen's shorter side, mouse-first as a desktop", () => {
    // A phone, upright or on its side (the shorter side is the same).
    expect(deviceClass(390, true)).toBe("phone");
    expect(deviceClass(430, true)).toBe("phone");
    // Tablets from a small Android to a large iPad, whole or split.
    expect(deviceClass(600, true)).toBe("tablet");
    expect(deviceClass(744, true)).toBe("tablet");
    expect(deviceClass(1024, true)).toBe("tablet");
    // A laptop's window snapped to half its screen is still a desktop.
    expect(deviceClass(768, false)).toBe("desktop");
    expect(deviceClass(1440, false)).toBe("desktop");
    // Mouse-first is a desktop whatever its screen.
    expect(deviceClass(540, false)).toBe("desktop");
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
      // Each on its vital's step: 10 ms, CLS in hundredths.
      metrics: [
        { name: "TTFB", value: 410, rating: "good" },
        { name: "LCP", value: 5_230, rating: "poor" },
        { name: "CLS", value: 0.04, rating: "good" },
      ],
    });
    // The library's metric id, its entries, the address and how the page was
    // reached never travel: the privacy page names none of them.
    expect(send.mock.calls[0]?.[0]).not.toMatch(/v6-|entries|http|tok_SECRET123|navigationURL|navigationType/u);
  });

  // The release lead's B1 (13 November 2026): a value's precision is its
  // browser's clock, so the request carries none of it.
  it("sends each value on its vital's step, rated from that value, whatever the browser's clock", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/", "phone", send);
    // Chromium's clock (a tenth of a millisecond), and a browser's own rating
    // of a value the step moves across a bound.
    reporter.add(metric("TTFB", 312.30000001192093));
    reporter.add(metric("LCP", 2_504.9, "needs-improvement"));
    reporter.add(metric("CLS", 0.0384615));
    reporter.flush();
    expect(sentReports(send)[0]?.metrics).toEqual([
      { name: "TTFB", value: 310, rating: "good" },
      { name: "LCP", value: 2_500, rating: "good" },
      { name: "CLS", value: 0.04, rating: "good" },
    ]);
  });

  it("sends each measurement once: a page shown and hidden again adds no second row", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/", "phone", send);
    reporter.add(metric("TTFB", 300));
    reporter.add(metric("LCP", 1_800));
    reporter.add(metric("CLS", 0.093));
    reporter.flush();
    // Back to the tab: the library reports the same CLS and INP again as they grow.
    reporter.add(metric("CLS", 0.221));
    reporter.add(metric("LCP", 1_800));
    reporter.flush();
    expect(sentReports(send).map((report) => report.metrics.map((sample) => [sample.name, sample.value]))).toEqual([
      [["TTFB", 300], ["LCP", 1_800], ["CLS", 0.09]],
    ]);
    // INP first measured after the first hide is still that load's only INP.
    reporter.add(metric("INP", 96));
    reporter.flush();
    expect(sentReports(send)[1]?.metrics).toEqual([{ name: "INP", value: 100, rating: "good" }]);
  });

  // #309's round-4 review (13 November 2026): a restored or prerendered load's
  // TTFB of 0 and LCP of a frame or two are values no ordinary load has, which
  // would tie its rows to each other and to its request.
  it("does not measure a page restored from the back/forward cache, prerendered, or restored", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/", "desktop", send);
    reporter.add(metric("LCP", 1_200));
    reporter.flush();
    reporter.add(metric("LCP", 40, "good", "v6-1761650009999-LCP", "back-forward-cache"));
    reporter.add(metric("TTFB", 0, "good", "v6-1761650009999-TTFB", "back-forward-cache"));
    reporter.flush();
    reporter.add(metric("TTFB", 0, "good", "v6-1761650019999-TTFB", "prerender"));
    reporter.add(metric("LCP", 30, "good", "v6-1761650029999-LCP", "restore"));
    reporter.flush();
    expect(sentReports(send).map((report) => report.metrics)).toEqual([
      [{ name: "LCP", value: 1_200, rating: "good" }],
    ]);
  });

  it("sends every report at one size, whatever it carries", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/venues/:venueSlug/captures/:roomSlug", "desktop", send);
    reporter.add(metric("TTFB", 40));
    reporter.flush();
    reporter.add(metric("LCP", 6_000, "poor", "v6-1761650000001-LCP"));
    reporter.add(metric("INP", 300, "needs-improvement", "v6-1761650000001-INP"));
    reporter.add(metric("CLS", 0.3, "poor", "v6-1761650000001-CLS"));
    reporter.flush();
    expect(send.mock.calls.map((call) => call[0]?.length)).toEqual([WEB_VITALS_REPORT_BYTES, WEB_VITALS_REPORT_BYTES]);
  });

  it("rates each vital by the very bounds web-vitals uses", async () => {
    const actual = await vi.importActual<typeof import("web-vitals")>("web-vitals");
    expect(WEB_VITAL_RATING_BOUNDS).toEqual({
      LCP: actual.LCPThresholds,
      INP: actual.INPThresholds,
      CLS: actual.CLSThresholds,
      TTFB: actual.TTFBThresholds,
    });
  });

  it("stops the landing page's vitals when the visitor moves on, keeping its first byte", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/", "phone", send);
    reporter.add(metric("LCP", 2_400));
    reporter.add(metric("INP", 120));
    reporter.add(metric("CLS", 0.01));
    reporter.leave();
    // What the room walk does after the move belongs to the walk, not the front door.
    reporter.add(metric("INP", 900, "poor"));
    reporter.add(metric("CLS", 0.4, "poor"));
    reporter.add(metric("LCP", 6_000, "poor"));
    reporter.add(metric("TTFB", 350));
    reporter.flush();
    expect(sentReports(send)[0]?.metrics.map((sample) => [sample.name, sample.value])).toEqual([
      ["LCP", 2_400], ["INP", 120], ["CLS", 0.01], ["TTFB", 350],
    ]);
    expect(sentReports(send)[0]?.page).toBe("/");
  });

  it("reports under a redirect's target once relabelled", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/hallkeeper", "tablet", send);
    reporter.relabel("/hallkeeper/today");
    reporter.add(metric("LCP", 900));
    reporter.flush();
    expect(sentReports(send)[0]?.page).toBe("/hallkeeper/today");
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
      referrerPolicy: "no-referrer",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  });
});

describe("the landing page", () => {
  function follow(landing: LandingRoute): { send: ReturnType<typeof vi.fn<(body: string) => void>>; reporter: ReturnType<typeof createWebVitalsReporter> } {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter(routePattern(landing.paths), "phone", send);
    followLandingPage(landing, reporter);
    return { send, reporter };
  }

  it("follows a redirect made before the visitor did anything", () => {
    const router = fakeRouter([undefined, "/hallkeeper"]);
    const { send, reporter } = follow(recordLandingRoute(router, new EventTarget()));
    router.move([undefined, "/hallkeeper/today"], "REPLACE");
    reporter.add(metric("LCP", 700));
    reporter.flush();
    expect(sentReports(send)[0]?.page).toBe("/hallkeeper/today");
  });

  it("ends the landing page's vitals at a move the visitor made, and stops following", () => {
    const router = fakeRouter(["/"]);
    const target = new EventTarget();
    const { send, reporter } = follow(recordLandingRoute(router, target));
    reporter.add(metric("INP", 110));
    target.dispatchEvent(new Event("pointerdown"));
    // A replace after a tap is the visitor's own move too.
    router.move(["/room/:roomSlug"], "REPLACE");
    reporter.add(metric("INP", 640, "poor"));
    reporter.flush();
    expect(sentReports(send)[0]).toMatchObject({ page: "/", metrics: [{ name: "INP", value: 110 }] });
    expect(router.listeners).toBe(0);
  });

  it("keeps the page through a move that keeps its route, and ends it at a pushed move", () => {
    const router = fakeRouter([undefined, "/venues/:venueSlug/twin"]);
    const { send, reporter } = follow(recordLandingRoute(router, new EventTarget()));
    // Loading and revalidation report the same routes; another venue's walk is the same page.
    router.move([undefined, "/venues/:venueSlug/twin"], "POP");
    router.move([undefined, "/venues/:venueSlug/twin"], "PUSH");
    reporter.add(metric("CLS", 0.02));
    router.move(["/plan"], "PUSH");
    reporter.add(metric("CLS", 0.3, "poor"));
    reporter.flush();
    expect(sentReports(send)[0]).toMatchObject({ page: "/venues/:venueSlug/twin", metrics: [{ name: "CLS", value: 0.02 }] });
  });

  it("replays the moves made before the reporter loaded", () => {
    const router = fakeRouter(["/"]);
    const target = new EventTarget();
    const landing = recordLandingRoute(router, target);
    // A quick tap while the reporter's chunk is still on its way.
    target.dispatchEvent(new Event("keydown"));
    router.move(["/fresh"], "PUSH");
    router.move(["/room/:roomSlug"], "PUSH");
    const { send, reporter } = follow(landing);
    reporter.add(metric("LCP", 2_000));
    reporter.add(metric("TTFB", 200));
    reporter.flush();
    expect(sentReports(send)[0]).toMatchObject({ page: "/", metrics: [{ name: "TTFB", value: 200 }] });
    expect(router.listeners).toBe(0);
  });
});

describe("starting on a page load", () => {
  it("measures a sampled load and sends its landing route's vitals when the page is hidden", async () => {
    const send = vi.fn<(body: string) => void>();
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: query === "(pointer: coarse)" } as MediaQueryList));
    vi.spyOn(window.screen, "width", "get").mockReturnValue(390);
    vi.spyOn(window.screen, "height", "get").mockReturnValue(844);
    ordinaryBrowser();
    const started = await startWebVitals({
      env: { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" },
      landing: recordLandingRoute(fakeRouter([undefined, "/proposal-share/:token"]), new EventTarget()),
      random: () => 0,
      send,
    });
    expect(started).toBe(true);
    // Every change of the three that settle late, so the values held are current when the visitor moves on.
    expect(Object.fromEntries([...vitals.callbacks].map(([name, entry]) => [name, entry.reportAllChanges]))).toEqual({
      LCP: true, INP: true, CLS: true, TTFB: false,
    });
    for (const [name, entry] of vitals.callbacks) entry.callback(metric(name as Metric["name"], name === "CLS" ? 0.02 : 300));
    expect(send).not.toHaveBeenCalled();
    // A page being closed is hidden: one report, whichever events the browser fires.
    window.dispatchEvent(new Event("pagehide"));
    expect(send).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(send).toHaveBeenCalledTimes(1);
    const report = sentReports(send)[0];
    expect(report?.page).toBe("/proposal-share/:token");
    expect(report?.device).toBe("phone");
    expect(report?.metrics.map((sample) => sample.name).sort()).toEqual(["CLS", "INP", "LCP", "TTFB"]);
    setVisibility("visible");
  });

  it.each([
    ["in tests", { MODE: "test", VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, 0, {}],
    ["unsampled", { VITE_WEB_VITALS_SAMPLE_RATE: "0.1" }, 0.5, {}],
    ["where the browser objects", { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, 0, { globalPrivacyControl: true }],
    ["under a driver", { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, 0, { webdriver: true }],
  ] as const)("measures nothing %s, and stops recording the route", async (_case, env, draw, browser) => {
    const send = vi.fn<(body: string) => void>();
    ordinaryBrowser(browser);
    const router = fakeRouter(["/"]);
    expect(await startWebVitals({ env, landing: recordLandingRoute(router, new EventTarget()), random: () => draw, send })).toBe(false);
    expect(vitals.callbacks.size).toBe(0);
    expect(router.listeners).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  // T-685: Safari sends neither signal above, so the privacy page's switch is
  // the way to object that works on every browser.
  it("measures nothing for a visitor who chose \"Don't measure my visits\", and stops recording the route", async () => {
    const send = vi.fn<(body: string) => void>();
    ordinaryBrowser();
    setMeasurementDeclined(true);
    try {
      const router = fakeRouter(["/"]);
      expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, landing: recordLandingRoute(router, new EventTarget()), random: () => 0, send })).toBe(false);
      expect(vitals.callbacks.size).toBe(0);
      expect(router.listeners).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(shouldReportWebVitals(1, { measurementDeclined: true }, () => 0)).toBe(false);
    } finally {
      setMeasurementDeclined(false);
    }
  });

  // The switch lives on the privacy page, which is itself measured: a visitor
  // who presses it there must not send that very page load (12 November 2026).
  it("sends nothing once the visitor chooses \"Don't measure my visits\" while the load is measured", async () => {
    const send = vi.fn<(body: string) => void>();
    ordinaryBrowser();
    const router = fakeRouter(["/privacy"]);
    try {
      expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, landing: recordLandingRoute(router, new EventTarget()), random: () => 0, send })).toBe(true);
      for (const [name, entry] of vitals.callbacks) entry.callback(metric(name as Metric["name"], name === "CLS" ? 0.02 : 300));
      setMeasurementDeclined(true);
      setVisibility("hidden");
      expect(send).not.toHaveBeenCalled();
      // It stops following the route, and a later hide sends nothing either.
      expect(router.listeners).toBe(0);
      setVisibility("visible");
      for (const [name, entry] of vitals.callbacks) entry.callback(metric(name as Metric["name"], 500, "good", `v6-1761650099999-${name}`));
      setVisibility("hidden");
      expect(send).not.toHaveBeenCalled();
    } finally {
      setVisibility("visible");
      setMeasurementDeclined(false);
    }
  });

  it("sends nothing once another tab has chosen \"Don't measure my visits\" before this one is hidden", async () => {
    const send = vi.fn<(body: string) => void>();
    ordinaryBrowser();
    const router = fakeRouter(["/"]);
    try {
      expect(await startWebVitals({ env: { VITE_WEB_VITALS_SAMPLE_RATE: "0.5" }, landing: recordLandingRoute(router, new EventTarget()), random: () => 0, send })).toBe(true);
      for (const [name, entry] of vitals.callbacks) entry.callback(metric(name as Metric["name"], name === "CLS" ? 0.02 : 300));
      // Another tab writes the choice; this module's own flag never changes.
      window.localStorage.setItem(MEASUREMENT_DECLINED_KEY, "1");
      setVisibility("hidden");
      expect(send).not.toHaveBeenCalled();
    } finally {
      setVisibility("visible");
      window.localStorage.removeItem(MEASUREMENT_DECLINED_KEY);
    }
  });

  it("is in no build that does not sample: the entry's condition is one the bundler can decide", () => {
    // That the entry never imports the reporter itself is bundle-splitting.test.ts's.
    const main = readFileSync(resolve("src/main.tsx"), "utf8");
    // Vite writes an unset VITE_ variable as `undefined`, so the bundler drops
    // the branch and everything only it uses. A call such as
    // webVitalsSampleRate(import.meta.env) would keep them in every build.
    // \r?: a Windows checkout with core.autocrlf reads the file with CRLF.
    expect(main).toMatch(/^if \(import\.meta\.env\.VITE_WEB_VITALS_SAMPLE_RATE !== undefined\) \{\r?$/mu);
    expect(main).toContain("await import(\"./observability/web-vitals.js\")");
    // Optional code: a chunk that fails to load stops the recording, raises
    // nothing and reloads nothing (route-error-boundary.test.tsx).
    expect(main).toContain("void loadOptional(async () => {");
    expect(main).toContain("}).catch(() => { landing.stop(); });");
  });
});
