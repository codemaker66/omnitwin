import { z } from "zod";

// ---------------------------------------------------------------------------
// Venue sky — the weather over a venue at one instant (T-647).
//
// `GET /venues/:venueId/sky?at=<ISO>` answers with this body. The relit hall
// (T-639) reads it to light the room by the real sky: live weather now, each
// event's date in the planner, a forecast when the date is near and the
// typical weather of that month beyond. This contract carries weather only:
// no sun or moon positions (T-639 keeps its own ephemeris) and no lighting
// settings (T-639 owns the mapping from weather to light).
//
// Rules the schema enforces:
// - Every value the source does not provide is null. Nothing is defaulted.
// - Fractions and probabilities are 0..1. Instants are ISO 8601 UTC ("Z").
// - `at` lies inside [validFrom, validTo].
// - A forecast is never degraded; normals always say why they were served.
// - A precipitation probability states what it measures, and the definition
//   matches the kind: a forecast's is the chance the rate reaches 0.1 mm/h at
//   that hour; a normal's is the share of the month's days with at least
//   1 mm of rain (HadUK-Grid "raindays1mm" over days in the month).
// - Climatology (the monthly normals behind a normals answer) appears only
//   with kind "normals".
// ---------------------------------------------------------------------------

/** "observation" is reserved for a later observed-weather source; nothing
 *  produces it yet. */
export const SKY_KINDS = ["observation", "forecast", "normals"] as const;
export const SkyKindSchema = z.enum(SKY_KINDS);
export type SkyKind = z.infer<typeof SkyKindSchema>;

/**
 * Why a normals answer was served instead of a forecast. Closed set:
 * - forecast_not_configured: the API has no Met Office key.
 * - forecast_key_rejected: the Met Office refused the key (401/403), e.g. a
 *   key subscribed to a different DataHub product.
 * - forecast_quota_exhausted: the daily call budget is spent (the Met
 *   Office answered 429, or this server's own cap was reached first).
 * - upstream_unavailable: the forecast could not be fetched or did not
 *   validate (network, 5xx, timeout, empty or malformed response).
 * - beyond_forecast_horizon: `at` is later than the forecast reaches.
 * - before_forecast_window: `at` is earlier than the forecast starts (the
 *   past; observations are not served yet).
 */
export const SKY_DEGRADED_REASONS = [
  "forecast_not_configured",
  "forecast_key_rejected",
  "forecast_quota_exhausted",
  "upstream_unavailable",
  "beyond_forecast_horizon",
  "before_forecast_window",
] as const;
export const SkyDegradedReasonSchema = z.enum(SKY_DEGRADED_REASONS);
export type SkyDegradedReason = z.infer<typeof SkyDegradedReasonSchema>;

export const SKY_PRECIPITATION_TYPES = ["none", "rain", "drizzle", "snow", "sleet", "hail"] as const;
export const SkyPrecipitationTypeSchema = z.enum(SKY_PRECIPITATION_TYPES);
export type SkyPrecipitationType = z.infer<typeof SkyPrecipitationTypeSchema>;

export const SKY_PRECIPITATION_PROBABILITY_DEFINITIONS = [
  /** Forecast: probability that the precipitation rate is at least 0.1 mm/h. */
  "rate_at_least_0_1_mm_per_hour",
  /** Normals: days with at least 1 mm of rain divided by days in the month. */
  "share_of_days_with_at_least_1_mm",
] as const;
export const SkyPrecipitationProbabilityDefinitionSchema = z.enum(SKY_PRECIPITATION_PROBABILITY_DEFINITIONS);
export type SkyPrecipitationProbabilityDefinition = z.infer<typeof SkyPrecipitationProbabilityDefinitionSchema>;

/**
 * A weather-only hint from total cloud cover, not a lighting decision:
 * "sunny" at or below 2 oktas (0.25), "overcast" at or above 6 oktas (0.75),
 * otherwise null. Null whenever total cloud is unknown.
 */
export const SKY_PRESET_HINTS = ["sunny", "overcast"] as const;
export const SkyPresetHintSchema = z.enum(SKY_PRESET_HINTS);
export type SkyPresetHint = z.infer<typeof SkyPresetHintSchema>;
export const SKY_PRESET_SUNNY_MAX_CLOUD = 2 / 8;
export const SKY_PRESET_OVERCAST_MIN_CLOUD = 6 / 8;

const IsoUtcSchema = z.string().datetime();
const FractionSchema = z.number().min(0).max(1).nullable();

export const SkyCloudSchema = z.object({
  total: FractionSchema,
  low: FractionSchema,
  mid: FractionSchema,
  high: FractionSchema,
}).strict();

export const SkyPrecipitationSchema = z.object({
  type: SkyPrecipitationTypeSchema.nullable(),
  probability: FractionSchema,
  probabilityDefinition: SkyPrecipitationProbabilityDefinitionSchema.nullable(),
  rateMmH: z.number().nonnegative().nullable(),
}).strict();

/** The Met Office significant-weather code for the hour and its published
 *  description (https://datahub.metoffice.gov.uk/definition-of-codes). */
export const SkyWeatherCodeSchema = z.object({
  code: z.number().int().min(-1).max(30),
  description: z.string().min(1),
}).strict();

/** The monthly normals behind a normals answer, as the dataset states them. */
export const SkyClimatologySchema = z.object({
  period: z.literal("1991-2020"),
  month: z.number().int().min(1).max(12),
  daysInMonth: z.number().int().min(28).max(31),
  rainDaysAtLeast1mm: z.number().nonnegative().nullable(),
  snowLyingDays: z.number().nonnegative().nullable(),
  sunshineHours: z.number().nonnegative().nullable(),
  meanTemperatureC: z.number().min(-60).max(60).nullable(),
  meanWindSpeedMs: z.number().nonnegative().nullable(),
  /** Sum over the month of sunrise-to-sunset hours at the cell's latitude
   *  (geometric day length, no refraction): the denominator of
   *  sunshineFraction. */
  astronomicalDaylightHours: z.number().positive(),
  dataset: z.string().min(1),
  cell: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    resolutionKm: z.number().positive(),
  }).strict(),
}).strict();
export type SkyClimatology = z.infer<typeof SkyClimatologySchema>;

export const SkyAttributionSchema = z.object({
  source: z.string().min(1),
  /** The credit line the source requires to be shown. */
  credit: z.string().min(1),
  licence: z.string().min(1),
  licenceUrl: z.string().url(),
}).strict();
export type SkyAttribution = z.infer<typeof SkyAttributionSchema>;

export const SkyProvenanceSchema = z.object({
  /** When this server last requested the forecast from the upstream source;
   *  null for normals, which are a committed dataset. */
  upstreamRequestedAt: IsoUtcSchema.nullable(),
  /** Seconds between that request and this answer; null for normals. */
  cacheAgeSeconds: z.number().int().nonnegative().nullable(),
  /** The forecast site the upstream answered for (its nearest site to the
   *  venue) and its distance from the venue. */
  forecastSite: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    distanceM: z.number().nonnegative(),
  }).strict().nullable(),
}).strict();

export const VenueSkySchema = z.object({
  venueId: z.string().uuid(),
  kind: SkyKindSchema,
  /** Human-readable source and product, e.g. the Met Office product and
   *  statistic used. */
  source: z.string().min(1),
  /** When the source issued this data (forecast run time); null when the
   *  source does not state it. */
  issuedAt: IsoUtcSchema.nullable(),
  /** The interval the values describe: for a forecast, the span its time
   *  step stands for; for normals, the calendar month in the venue's time
   *  zone. */
  validFrom: IsoUtcSchema,
  validTo: IsoUtcSchema,
  /** The instant asked about. */
  at: IsoUtcSchema,
  cloud: SkyCloudSchema,
  visibilityM: z.number().nonnegative().nullable(),
  /** Probability (0..1) that visibility at 1.5 m is below 1000 m, the WMO
   *  definition of fog. */
  fog: FractionSchema,
  precipitation: SkyPrecipitationSchema,
  windMs: z.number().nonnegative().nullable(),
  temperatureC: z.number().min(-100).max(70).nullable(),
  /** Bright sunshine as a fraction of the astronomical day (sunrise to
   *  sunset) for that day (forecast) or month (normals). */
  sunshineFraction: FractionSchema,
  weather: SkyWeatherCodeSchema.nullable(),
  presetHint: SkyPresetHintSchema.nullable(),
  climatology: SkyClimatologySchema.nullable(),
  degraded: z.object({ reason: SkyDegradedReasonSchema }).strict().nullable(),
  attribution: z.array(SkyAttributionSchema).min(1),
  provenance: SkyProvenanceSchema,
}).strict().superRefine((sky, ctx) => {
  const at = Date.parse(sky.at);
  const validFrom = Date.parse(sky.validFrom);
  const validTo = Date.parse(sky.validTo);
  if (!(validFrom <= at && at <= validTo)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["at"], message: "at must lie inside [validFrom, validTo]" });
  }
  if (sky.kind === "forecast" && sky.degraded !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["degraded"], message: "A forecast is never degraded" });
  }
  if (sky.kind === "normals" && sky.degraded === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["degraded"], message: "Normals must state why a forecast was not served" });
  }
  if ((sky.kind === "normals") !== (sky.climatology !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["climatology"], message: "Climatology appears with normals and only with normals" });
  }
  const { probability, probabilityDefinition } = sky.precipitation;
  if (probability !== null) {
    const expected: SkyPrecipitationProbabilityDefinition | null = sky.kind === "forecast"
      ? "rate_at_least_0_1_mm_per_hour"
      : sky.kind === "normals" ? "share_of_days_with_at_least_1_mm" : null;
    if (probabilityDefinition === null || probabilityDefinition !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["precipitation", "probabilityDefinition"],
        message: "A precipitation probability must state the definition that matches its kind",
      });
    }
  }
});
export type VenueSky = z.infer<typeof VenueSkySchema>;

/** Query for `GET /venues/:venueId/sky`. `at` is an ISO 8601 date-time with
 *  a zone designator; absent means now. */
export const VenueSkyQuerySchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
});
export type VenueSkyQuery = z.infer<typeof VenueSkyQuerySchema>;
