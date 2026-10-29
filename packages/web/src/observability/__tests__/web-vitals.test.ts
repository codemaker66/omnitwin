import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric } from "web-vitals";
import { webVitalsSampleRate } from "../web-vitals-rate.js";
import { recordLandingRoute, type AppRoutes, type LandingRoute } from "../landing-route.js";
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

function sentReports(send: { mock: { calls: string[][] } }): { page: string; device: string; metrics: { name: string; value: number; navigationType: string }[] }[] {
  return send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}") as { page: string; device: string; metrics: { name: string; value: number; navigationType: string }[] });
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
      metrics: [
        { name: "TTFB", value: 412.25, rating: "good", navigationType: "navigate" },
        { name: "LCP", value: 5_234.5, rating: "poor", navigationType: "navigate" },
        { name: "CLS", value: 0.04, rating: "good", navigationType: "navigate" },
      ],
    });
    // The library's metric id, its entries and the address never travel.
    expect(send.mock.calls[0]?.[0]).not.toMatch(/v6-|entries|http|tok_SECRET123|navigationURL/u);
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
      [["TTFB", 300], ["LCP", 1_800], ["CLS", 0.093]],
    ]);
    // INP first measured after the first hide is still that load's only INP.
    reporter.add(metric("INP", 96));
    reporter.flush();
    expect(sentReports(send)[1]?.metrics).toEqual([{ name: "INP", value: 96, rating: "good", navigationType: "navigate" }]);
  });

  it("measures a page restored from the back/forward cache as a new page load", () => {
    const send = vi.fn<(body: string) => void>();
    const reporter = createWebVitalsReporter("/", "desktop", send);
    reporter.add(metric("LCP", 1_200));
    reporter.flush();
    reporter.add(metric("LCP", 40, "good", "v6-1761650009999-LCP", "back-forward-cache"));
    reporter.flush();
    expect(sentReports(send).map((report) => report.metrics)).toEqual([
      [{ name: "LCP", value: 1_200, rating: "good", navigationType: "navigate" }],
      [{ name: "LCP", value: 40, rating: "good", navigationType: "back-forward-cache" }],
    ]);
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
      env: { VITE_WEB_VITALS_SAMPLE_RATE: "1" },
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
    ["in tests", { MODE: "test", VITE_WEB_VITALS_SAMPLE_RATE: "1" }, 0, {}],
    ["unsampled", { VITE_WEB_VITALS_SAMPLE_RATE: "0.1" }, 0.5, {}],
    ["where the browser objects", { VITE_WEB_VITALS_SAMPLE_RATE: "1" }, 0, { globalPrivacyControl: true }],
    ["under a driver", { VITE_WEB_VITALS_SAMPLE_RATE: "1" }, 0, { webdriver: true }],
  ] as const)("measures nothing %s, and stops recording the route", async (_case, env, draw, browser) => {
    const send = vi.fn<(body: string) => void>();
    ordinaryBrowser(browser);
    const router = fakeRouter(["/"]);
    expect(await startWebVitals({ env, landing: recordLandingRoute(router, new EventTarget()), random: () => draw, send })).toBe(false);
    expect(vitals.callbacks.size).toBe(0);
    expect(router.listeners).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("is loaded only by a build that samples: the entry module never imports the reporter itself", () => {
    const main = readFileSync(resolve("src/main.tsx"), "utf8");
    expect(main).not.toMatch(/^import .*observability\/web-vitals\.js/mu);
    expect(main).toContain("import(\"./observability/web-vitals.js\")");
    expect(main).toMatch(/if \(webVitalsSampleRate\(import\.meta\.env\) > 0\) \{\n {2}const landing = recordLandingRoute\(router\);/u);
    // A chunk that fails to load stops the recording and raises nothing.
    expect(main).toContain(".catch(() => { landing.stop(); })");
  });
});
