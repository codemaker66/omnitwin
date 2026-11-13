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
 * The shape the database checks a page against (0108's page_shape): "/", or
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
