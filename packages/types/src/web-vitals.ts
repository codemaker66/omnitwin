import { z } from "zod";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07: Core Web Vitals at the 75th percentile on
// production, by device class: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1).
//
// A sampled page load reports its four vitals once, as Google's web-vitals
// library measures them, with only what p75 by page and device needs: the
// route's pattern ("/proposal-share/:token", never the address the visitor
// opened, so a share token or a layout's id cannot travel), a device class
// from the viewport and pointer, the value, its rating and how the page was
// reached. Nothing names or follows the visitor: no address, no identifier,
// no user agent, nothing stored on the device. Whether to report at all is the
// server's switch and the page's sample rate (docs/engineering/web-vitals.md).
// ---------------------------------------------------------------------------

export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export const WEB_VITAL_DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type WebVitalDeviceClass = (typeof WEB_VITAL_DEVICE_CLASSES)[number];

export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;

/** How the page was reached, as web-vitals reports it. */
export const WEB_VITAL_NAVIGATION_TYPES = ["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore", "soft-navigation"] as const;

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
 * A route's pattern: "/", or segments that are words in lowercase and
 * hyphens, a `:param` or `*`. No digits, so neither an id, a share token nor
 * a date can pass as a page, whatever a browser sends.
 */
export const WEB_VITAL_PAGE_PATTERN = /^\/$|^(?:\/(?:[a-z][a-z-]{0,39}|:[A-Za-z]{1,40}|\*))+$/u;

// Zod 4's number refuses NaN and the infinities.
const ValueSchema = z.number().nonnegative();

export const WebVitalSampleSchema = z.object({
  name: z.enum(WEB_VITAL_NAMES),
  /** Milliseconds; CLS is a unitless score. */
  value: ValueSchema,
  rating: z.enum(WEB_VITAL_RATINGS),
  navigationType: z.enum(WEB_VITAL_NAVIGATION_TYPES),
}).strict().refine((sample) => sample.value <= (sample.name === "CLS" ? 100 : 600_000), {
  message: "Beyond any value a page load can report",
  path: ["value"],
});
export type WebVitalSample = z.infer<typeof WebVitalSampleSchema>;

export const WebVitalsReportSchema = z.object({
  /** The report's own version, so a later shape is told apart. */
  v: z.literal(1),
  page: z.string().max(160).regex(WEB_VITAL_PAGE_PATTERN),
  device: z.enum(WEB_VITAL_DEVICE_CLASSES),
  metrics: z.array(WebVitalSampleSchema).min(1).max(WEB_VITAL_NAMES.length)
    .refine((metrics) => new Set(metrics.map((metric) => metric.name)).size === metrics.length, { message: "Each vital once" }),
}).strict();
export type WebVitalsReport = z.infer<typeof WebVitalsReportSchema>;
