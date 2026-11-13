import { z } from "zod";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07: Core Web Vitals at the 75th percentile on
// production, by device class: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1).
//
// A sampled page load reports its four vitals once, as Google's web-vitals
// library measures them, with only what p75 by page and device needs: the
// route's pattern ("/proposal-share/:token", never the address the visitor
// opened, so a share token or a layout's id cannot travel), a device class
// from the screen and pointer, the value and its rating: nothing the privacy
// page does not name, so not even how the page was reached (12 November 2026).
// Nothing names or follows the visitor: no address, no identifier, no user
// agent, nothing stored on the device. Whether to report at all is the
// server's switch and the page's sample rate (docs/engineering/web-vitals.md).
// ---------------------------------------------------------------------------

export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export const WEB_VITAL_DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type WebVitalDeviceClass = (typeof WEB_VITAL_DEVICE_CLASSES)[number];

export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;

/** Goal 07's p75 targets: milliseconds, except CLS, which has no unit. */
export const WEB_VITAL_P75_TARGETS: Readonly<Record<WebVitalName, number>> = {
  LCP: 2_500,
  INP: 200,
  CLS: 0.1,
  // Not one of goal 07's three; web.dev's "good" bound for the first byte.
  TTFB: 800,
};

/** How long the samples are kept: long enough for a 28-day p75 either side
 *  of a release, then gone (the nightly cleanup). */
export const WEB_VITAL_RETENTION_DAYS = 90;

export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number];

/**
 * The step each vital is kept to, in the browser before it is sent and on the
 * server before it is held (the release lead's B1, 13 November 2026). A
 * value's precision is its browser's clock: Chromium's is a tenth of a
 * millisecond, WebKit's and Gecko's a millisecond, and a browser resisting
 * fingerprinting (Firefox and Tor Browser since Firefox 103) clocks to 1/60 s.
 * Kept as sent, a fractional TTFB among whole ones would be the one Chromium
 * report of its batch. On a 10 ms step every engine's values share one grid,
 * and a 1/60 s clock's land on steps that most ordinary values share too.
 * Event timing is already rounded to 8 ms in every engine. CLS comes only from
 * Chromium and is a score of how far things moved, not a clock's reading, and
 * a shift's score follows the screen's own size, which an in-app browser's
 * user agent can name. In hundredths a shift gives about half as many
 * distinct values across screens as in thousandths; one whose score sits near
 * a step's edge still splits ordinary screens, so a CLS value can stand alone
 * in its group (docs/engineering/web-vitals.md names it among the residuals).
 * Each step is still far finer than goal 07's targets (CLS 0.1).
 */
export const WEB_VITAL_STEPS: Readonly<Record<WebVitalName, number>> = {
  LCP: 10,
  INP: 10,
  CLS: 0.01,
  TTFB: 10,
};

/** web-vitals' own rating bounds (6.2.3): "good" up to the first,
 *  "needs-improvement" up to the second, "poor" above it. */
export const WEB_VITAL_RATING_BOUNDS: Readonly<Record<WebVitalName, readonly [number, number]>> = {
  LCP: [2_500, 4_000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1_800],
};

/** A value on its vital's step (WEB_VITAL_STEPS). CLS is counted in
 *  hundredths, so equal steps are the same number exactly. */
export function stepWebVitalValue(name: WebVitalName, value: number): number {
  if (name === "CLS") return Math.round(value * 100) / 100;
  return Math.round(value / WEB_VITAL_STEPS[name]) * WEB_VITAL_STEPS[name];
}

/** The rating a value earns, as web-vitals rates it. */
export function rateWebVital(name: WebVitalName, value: number): WebVitalRating {
  const [good, poor] = WEB_VITAL_RATING_BOUNDS[name];
  if (value > poor) return "poor";
  return value > good ? "needs-improvement" : "good";
}

/** A sample as it may be sent and kept: its value on the vital's step, and
 *  the rating that value earns, so neither says more than the step does. */
export function stepWebVitalSample<Name extends WebVitalName>(
  sample: { readonly name: Name; readonly value: number },
): { readonly name: Name; readonly value: number; readonly rating: WebVitalRating } {
  const value = stepWebVitalValue(sample.name, sample.value);
  return { name: sample.name, value, rating: rateWebVital(sample.name, value) };
}

/**
 * The pages a report may name: the pattern of every route src/router.tsx
 * serves in production, and "/*" for any other (a dev fixture, the 404). A
 * list, not a rule, so nothing else can be stored as a page, whatever a
 * browser sends: no address, no share or plan code, no name typed in. The
 * web's route-inventory.test.ts holds this list and the router equal, so a
 * new route fails that test until it is added here.
 */
export const WEB_VITAL_PAGES = [
  "/",
  "/accessibility",
  "/account/allergy-notes",
  "/app",
  "/blueprint",
  "/blueprint/:configId",
  "/captures/:roomSlug",
  "/dashboard",
  "/demo",
  "/deposit-return",
  "/dev/assets/rooms",
  "/dev/capture-intake",
  "/dev/hallkeeper-walkthrough",
  "/dev/trades-hall-visual",
  "/diary",
  "/editor",
  "/event-architect",
  "/event-architect/runs/:runId",
  "/events",
  "/events/:eventId",
  "/fresh",
  "/hallkeeper",
  "/hallkeeper/:configId",
  "/hallkeeper/rooms",
  "/hallkeeper/today",
  "/hallkeeper/walkthrough",
  "/landing",
  "/legal/accessibility",
  "/legal/privacy",
  "/legal/terms",
  "/living-hall",
  "/login",
  "/oauth-consent",
  "/onboard",
  "/ops/events/:eventId",
  "/ops/handoff/:handoffPackId",
  "/plan",
  "/plan-view/:token",
  "/plan/:code",
  "/pricing",
  "/privacy",
  "/proposal-preview/:proposalId",
  "/proposal-share/:token",
  "/proposal/:shareCode",
  "/quiz",
  "/register",
  "/room/:roomSlug",
  "/sheet-check",
  "/splats/*",
  "/supplier-share/:token",
  "/terms",
  "/tour",
  "/trades-hall-leaflet",
  "/trades-house",
  "/trades-house/discover-your-craft",
  "/trades-house/leaflet",
  "/v/:venueSlug/plan",
  "/venues/:venueSlug/captures/:roomSlug",
  "/venues/:venueSlug/rooms/:roomSlug",
  "/venues/:venueSlug/twin",
  "/welcome",
  "/work-in-progress",
  "/*",
] as const;
export type WebVitalPage = (typeof WEB_VITAL_PAGES)[number];

/** Whether a page is one a report may name. */
export function isWebVitalPage(page: string): page is WebVitalPage {
  return (WEB_VITAL_PAGES as readonly string[]).includes(page);
}

/**
 * The shape the database checks a page against (0109's page_shape): "/", or
 * segments that are words in lowercase and hyphens, a `:param` or `*`. It
 * refuses digits (ids, dates, most codes) and long tokens, but not every
 * short code spelled in letters; the list above is what the API accepts.
 */
export const WEB_VITAL_PAGE_PATTERN = /^\/$|^(?:\/(?:[a-z][a-z-]{0,39}|:[A-Za-z]{1,40}|\*))+$/u;

// Zod 4's number refuses NaN and the infinities.
const ValueSchema = z.number().nonnegative();

export const WebVitalSampleSchema = z.object({
  name: z.enum(WEB_VITAL_NAMES),
  /** Milliseconds; CLS is a unitless score. */
  value: ValueSchema,
  rating: z.enum(WEB_VITAL_RATINGS),
}).strict().refine((sample) => sample.value <= (sample.name === "CLS" ? 100 : 600_000), {
  message: "Beyond any value a page load can report",
  path: ["value"],
});
export type WebVitalSample = z.infer<typeof WebVitalSampleSchema>;

export const WebVitalsReportSchema = z.object({
  /** The report's own version, so a later shape is told apart. */
  v: z.literal(1),
  page: z.enum(WEB_VITAL_PAGES),
  device: z.enum(WEB_VITAL_DEVICE_CLASSES),
  metrics: z.array(WebVitalSampleSchema).min(1).max(WEB_VITAL_NAMES.length)
    .refine((metrics) => new Set(metrics.map((metric) => metric.name)).size === metrics.length, { message: "Each vital once" }),
}).strict();
export type WebVitalsReport = z.infer<typeof WebVitalsReportSchema>;

/**
 * Every report crosses the wire at exactly this many bytes (#309's round-4
 * review, 13 November 2026). The host's request log records each request's
 * size, and a report's length would otherwise follow what it carries: how
 * many vitals, their digits and their ratings ("needs-improvement" is longer
 * than "good"), its page and its device class. The browser pads every report
 * with trailing spaces to this size, which JSON ignores, and the API refuses
 * any other. The longest report the browser sends is about 320 bytes, and any
 * the schema accepts stays under 400.
 */
export const WEB_VITALS_REPORT_BYTES = 512;

/** A report's JSON padded with spaces to WEB_VITALS_REPORT_BYTES, or null if
 *  it is longer, or holds anything but printable ASCII (one byte each). */
export function padWebVitalsReport(json: string): string | null {
  if (json.length > WEB_VITALS_REPORT_BYTES || !/^[\x20-\x7e]*$/u.test(json)) return null;
  return json + " ".repeat(WEB_VITALS_REPORT_BYTES - json.length);
}
