import { describe, expect, it } from "vitest";
import {
  WEB_VITALS_REPORT_BYTES, WEB_VITAL_NAMES, WEB_VITAL_PAGES, WEB_VITAL_PAGE_PATTERN, WEB_VITAL_RATING_BOUNDS, WebVitalsReportSchema,
  isWebVitalPage, padWebVitalsReport, rateWebVital, stepWebVitalSample, stepWebVitalValue,
} from "../web-vitals.js";

// ---------------------------------------------------------------------------
// A field-vitals report carries a route's pattern and four numbers, and
// nothing that could name, follow or open anything.
// ---------------------------------------------------------------------------

const report = {
  v: 1,
  page: "/proposal-share/:token",
  device: "phone",
  metrics: [
    { name: "LCP", value: 5_234.5, rating: "poor" },
    { name: "INP", value: 184, rating: "good" },
    { name: "CLS", value: 0.04, rating: "good" },
    { name: "TTFB", value: 412.3, rating: "good" },
  ],
};

describe("a web vitals report", () => {
  it("accepts a route pattern, a device class and the four vitals", () => {
    expect(WebVitalsReportSchema.parse(report)).toEqual(report);
  });

  it("takes each of the router's pages, every one of which the database's shape check also takes", () => {
    for (const page of WEB_VITAL_PAGES) {
      expect(WEB_VITAL_PAGE_PATTERN.test(page), page).toBe(true);
      expect(WebVitalsReportSchema.safeParse({ ...report, page }).success, page).toBe(true);
    }
  });

  it.each([
    "/proposal-share/tok_SECRET123",
    "/plan/2b9f1c3e-5d8a-4c1b-9e7f-0a1b2c3d4e5f",
    "/proposal/AB12CD",
    // About 1 plan code in 6 has no digit: the shape of a page, but not one.
    "/plan/kxbmtq",
    "/proposal-share/qwertyuiopasdf",
    "/jo-smith/elm-street-flat",
    "/diary?date=2026-10-28",
    "/plan-view/abcdefABCDEF0123456789",
    "https://venviewer.com/",
    "/Diary",
    "",
    "diary",
    "/diary/",
    "/amissing-book",
    `/${"a".repeat(41)}`,
  ])("refuses %j as a page: an address, an id, a code or a name is never one", (page) => {
    expect(isWebVitalPage(page)).toBe(false);
    expect(WebVitalsReportSchema.safeParse({ ...report, page }).success).toBe(false);
  });

  it("refuses anything beyond the four vitals, a second of one, an impossible value or another field", () => {
    const refused = [
      { ...report, metrics: [] },
      // Five is past the four; two of one vital within four is the uniqueness rule's.
      { ...report, metrics: [...report.metrics, report.metrics[0]] },
      { ...report, metrics: [report.metrics[0], report.metrics[0]] },
      { ...report, metrics: [{ ...report.metrics[0], name: "FID" }] },
      { ...report, metrics: [{ ...report.metrics[0], value: -1 }] },
      { ...report, metrics: [{ ...report.metrics[0], value: 700_000 }] },
      { ...report, metrics: [{ name: "CLS", value: 101, rating: "poor" }] },
      { ...report, metrics: [{ ...report.metrics[0], value: Number.NaN }] },
      { ...report, device: "watch" },
      { ...report, v: 2 },
      { ...report, url: "https://venviewer.com/proposal-share/tok_SECRET123" },
      { ...report, metrics: [{ ...report.metrics[0], id: "v5-1690000000000-123" }] },
    ];
    for (const body of refused) expect(WebVitalsReportSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it("refuses how the page was reached: the privacy page names no such field (12 November 2026)", () => {
    const withNavigation = { ...report, metrics: [{ ...report.metrics[0], navigationType: "reload" }] };
    expect(WebVitalsReportSchema.safeParse(withNavigation).success).toBe(false);
  });
});

// The release lead's B1 (13 November 2026): a value's precision is its
// browser's clock, so it is kept to a step every engine shares.
describe("a vital's step", () => {
  it("puts every engine's clock on one 10 ms grid", () => {
    // Chromium (a tenth of a millisecond), WebKit and Gecko (a millisecond),
    // and a fingerprint-resisting 1/60 s clock: one grid, nothing fractional.
    const ttfbs = [312.30000001192093, 314, 316.6666666666667, 305.4, 309.9999999];
    expect(ttfbs.map((value) => stepWebVitalValue("TTFB", value))).toEqual([310, 310, 320, 310, 310]);
    for (const name of ["LCP", "INP", "TTFB"] as const) {
      for (const value of [0, 0.04, 4.9, 5, 96, 412.25, 5_234.5, 599_999.9]) {
        const stepped = stepWebVitalValue(name, value);
        expect(Number.isInteger(stepped / 10), `${name} ${String(value)}`).toBe(true);
        expect(Math.abs(stepped - value), `${name} ${String(value)}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps CLS in hundredths, the same number for every value of one step", () => {
    // One shift's score on screens of different sizes (#309's second round-4
    // review): at a thousandth each would keep its own, in hundredths they meet.
    expect([0.0384615, 0.03807, 0.04167, 0.0432].map((value) => stepWebVitalValue("CLS", value))).toEqual([0.04, 0.04, 0.04, 0.04]);
    expect(stepWebVitalValue("CLS", 0.004)).toBe(0);
    expect(stepWebVitalValue("CLS", 0.25)).toBe(0.25);
  });

  it("keeps the 1/60 s clock's values off any step of their own", () => {
    // Its ticks land on 0, 20 and 30 ms past each 50: three of the five
    // residues every ordinary value lands on too.
    const residues = new Set(Array.from({ length: 300 }, (_, tick) => stepWebVitalValue("TTFB", (tick * 1_000) / 60) % 50));
    expect([...residues].sort((a, b) => a - b)).toEqual([0, 20, 30]);
  });

  it("rates a value as web-vitals does, from the stepped value alone", () => {
    for (const name of WEB_VITAL_NAMES) {
      const [good, poor] = WEB_VITAL_RATING_BOUNDS[name];
      expect(rateWebVital(name, good)).toBe("good");
      expect(rateWebVital(name, poor)).toBe("needs-improvement");
      expect(rateWebVital(name, poor * 2)).toBe("poor");
    }
    // A browser's own rating of 2,504.9 ms is "needs-improvement"; kept as
    // 2,500 ms it earns "good", so the rating says nothing below the step.
    expect(stepWebVitalSample({ name: "LCP", value: 2_504.9 })).toEqual({ name: "LCP", value: 2_500, rating: "good" });
    expect(stepWebVitalSample({ name: "CLS", value: 0.10049 })).toEqual({ name: "CLS", value: 0.1, rating: "good" });
    expect(stepWebVitalSample({ name: "INP", value: 504 })).toEqual({ name: "INP", value: 500, rating: "needs-improvement" });
    // A stepped sample is still a report's: the schema takes it.
    const parsed = WebVitalsReportSchema.parse(report);
    const stepped = { ...parsed, metrics: parsed.metrics.map(stepWebVitalSample) };
    expect(WebVitalsReportSchema.safeParse(stepped).success).toBe(true);
  });
});

// #309's round-4 review (13 November 2026): the host's request log records
// each request's size, so every report crosses the wire at one size.
describe("a report on the wire", () => {
  it("is always the same number of bytes, whatever it carries, and reads back as itself", () => {
    const longestPage = [...WEB_VITAL_PAGES].sort((a, b) => b.length - a.length)[0] ?? "/";
    const largest = { v: 1, page: longestPage, device: "desktop", metrics: [
      { name: "LCP", value: 600_000, rating: "needs-improvement" },
      { name: "INP", value: 600_000, rating: "needs-improvement" },
      { name: "CLS", value: 99.999, rating: "needs-improvement" },
      { name: "TTFB", value: 600_000, rating: "needs-improvement" },
    ] };
    expect(WebVitalsReportSchema.safeParse(largest).success).toBe(true);
    const smallest = { v: 1, page: "/", device: "phone", metrics: [{ name: "CLS", value: 0, rating: "good" }] };
    for (const body of [largest, smallest, report]) {
      const padded = padWebVitalsReport(JSON.stringify(body)) ?? "";
      expect(padded.length).toBe(WEB_VITALS_REPORT_BYTES);
      expect(new TextEncoder().encode(padded).length).toBe(WEB_VITALS_REPORT_BYTES);
      expect(JSON.parse(padded)).toEqual(body);
    }
    // Room to spare: nothing the schema takes is too long to pad.
    expect(JSON.stringify(largest).length).toBeLessThan(WEB_VITALS_REPORT_BYTES - 100);
  });

  it("refuses to pad what is too long, or anything but printable ASCII", () => {
    expect(padWebVitalsReport("x".repeat(WEB_VITALS_REPORT_BYTES + 1))).toBeNull();
    expect(padWebVitalsReport("{\"page\":\"/café\"}")).toBeNull();
    expect(padWebVitalsReport("{}\n")).toBeNull();
    expect(padWebVitalsReport("x".repeat(WEB_VITALS_REPORT_BYTES))).toBe("x".repeat(WEB_VITALS_REPORT_BYTES));
  });
});
