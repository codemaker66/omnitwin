import { describe, expect, it } from "vitest";
import { WEB_VITAL_PAGES, WEB_VITAL_PAGE_PATTERN, WebVitalsReportSchema, isWebVitalPage } from "../web-vitals.js";

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
