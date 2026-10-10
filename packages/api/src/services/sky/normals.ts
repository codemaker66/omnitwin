import { z } from "zod";
import type { SkyAttribution, SkyClimatology, SkyDegradedReason, VenueSky } from "@omnitwin/types";
import { haversineDistanceM, type GeoPoint } from "../../lib/venue-site.js";
import { monthDaylightHours, sunshineFraction } from "./daylength.js";

// ---------------------------------------------------------------------------
// Monthly normals: the typical weather of a calendar month (T-647).
//
// Source: Met Office HadUK-Grid 1991-2020 monthly climatologies ("mon-30y"),
// Open Government Licence v3.0, from the CEDA Archive. One committed JSON
// per grid cell holds the twelve months for the cell a venue stands in:
// days of rain >= 1 mm (raindays1mm), days of snow lying (snowLying),
// bright sunshine hours (sun), mean air temperature (tas) and mean wind
// speed (sfcWind), with the dataset version, input URLs and their sha256.
//
// The files are written by scripts/generate-sky-normals.ts from the
// sha256-pinned CEDA inputs (the CEDA Archive serves them to signed-in
// users; an account is free) and loaded by normals-data.ts. A venue whose
// cell has no file gets 503 SKY_UNAVAILABLE when it needs normals, never
// invented values.
//
// Derived values:
// - precipitation.probability = rainDaysAtLeast1mm / days in the month
//   (definition "share_of_days_with_at_least_1_mm").
// - sunshineFraction = sunshineHours / the month's summed astronomical day
//   length at the cell latitude (daylength.ts), for the month in the year
//   asked about.
// - The month is the calendar month of `at` in the venue's time zone, and
//   validFrom/validTo are that month's bounds there.
// ---------------------------------------------------------------------------

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/u);
const NullableNonNegative = z.number().nonnegative().nullable();

export const SkyNormalsMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  rainDaysAtLeast1mm: NullableNonNegative,
  snowLyingDays: NullableNonNegative,
  sunshineHours: NullableNonNegative,
  meanTemperatureC: z.number().min(-60).max(60).nullable(),
  meanWindSpeedMs: NullableNonNegative,
}).strict();
export type SkyNormalsMonth = z.infer<typeof SkyNormalsMonthSchema>;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

export const SkyNormalsFileSchema = z.object({
  schemaVersion: z.literal(1),
  dataset: z.object({
    name: z.literal("HadUK-Grid"),
    version: z.string().min(1),
    period: z.literal("1991-2020"),
    resolutionKm: z.number().positive(),
    licence: z.literal("Open Government Licence v3.0"),
    /** The citation the CEDA catalogue record requires. */
    citation: z.string().min(1),
    catalogueUrl: z.string().url(),
    doi: z.string().min(1),
  }).strict(),
  generatedAt: z.string().datetime(),
  generator: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
  inputs: z.array(z.object({
    variable: z.enum(["raindays1mm", "snowLying", "sun", "tas", "sfcWind"]),
    url: z.string().url(),
    sha256: Hex64,
    bytes: z.number().int().positive(),
    /** As the file declares them (wind is converted to m/s on reading). */
    units: z.string().min(1),
    standardName: z.string().nullable(),
    longName: z.string().nullable(),
    cellMethods: z.string().nullable(),
  }).strict()).min(1),
  /** The British National Grid cell the values belong to: its centre in
   *  WGS84 and in grid metres, its index in the files, and the site it was
   *  chosen for. */
  cell: z.object({
    latitude: Latitude,
    longitude: Longitude,
    eastingM: z.number(),
    northingM: z.number(),
    gridIndex: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict(),
    site: z.object({ latitude: Latitude, longitude: Longitude }).strict(),
    siteDistanceM: z.number().nonnegative(),
  }).strict(),
  months: z.array(SkyNormalsMonthSchema).length(12),
}).strict().superRefine((file, ctx) => {
  file.months.forEach((entry, index) => {
    if (entry.month !== index + 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["months", index, "month"], message: "months must run 1..12 in order" });
    }
  });
});
export type SkyNormalsFile = z.infer<typeof SkyNormalsFileSchema>;

export const OGL_V3_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
/** The attribution statement the Open Government Licence v3.0 asks for. */
export const OGL_V3_STATEMENT = "Contains public sector information licensed under the Open Government Licence v3.0.";

/** The normals file whose grid cell contains the venue: its centre within
 *  half the cell diagonal. Null when none does. */
export function normalsFor(files: readonly SkyNormalsFile[], venue: GeoPoint): SkyNormalsFile | null {
  let best: { file: SkyNormalsFile; distanceM: number } | null = null;
  for (const file of files) {
    const distanceM = haversineDistanceM(venue, file.cell);
    const halfDiagonalM = (file.dataset.resolutionKm * 1000 * Math.SQRT2) / 2;
    if (distanceM <= halfDiagonalM && (best === null || distanceM < best.distanceM)) best = { file, distanceM };
  }
  return best?.file ?? null;
}

function wallClock(at: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function zoneOffsetMs(at: number, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of local midnight starting `month` of `year` in a zone. */
export function zonedMonthStart(year: number, month: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, 1);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** The calendar month of `at` in a zone, and its bounds as UTC instants. */
export function zonedMonth(at: number, timeZone: string): { year: number; month: number; start: number; end: number } {
  const { year, month } = wallClock(at, timeZone);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { year, month, start: zonedMonthStart(year, month, timeZone), end: zonedMonthStart(next.year, next.month, timeZone) };
}

export function normalsAttribution(file: SkyNormalsFile): SkyAttribution {
  return {
    source: `Met Office HadUK-Grid ${file.dataset.version}, ${file.dataset.period} monthly climatology (CEDA Archive)`,
    credit: `${OGL_V3_STATEMENT} ${file.dataset.citation}`,
    licence: file.dataset.licence,
    licenceUrl: OGL_V3_URL,
  };
}

export interface NormalsSkyInput {
  readonly venueId: string;
  readonly timeZone: string;
  readonly at: number;
  readonly reason: SkyDegradedReason;
}

/** A normals answer for `at`, from the venue's cell file. */
export function buildNormalsSky(file: SkyNormalsFile, input: NormalsSkyInput): VenueSky {
  const { year, month, start, end } = zonedMonth(input.at, input.timeZone);
  const normals = file.months[month - 1];
  if (normals === undefined) throw new Error(`normals file has no month ${String(month)}`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daylightHours = monthDaylightHours(year, month, file.cell.latitude);
  const rainShare = normals.rainDaysAtLeast1mm === null ? null : Math.min(1, normals.rainDaysAtLeast1mm / daysInMonth);
  const climatology: SkyClimatology = {
    period: file.dataset.period,
    month,
    daysInMonth,
    rainDaysAtLeast1mm: normals.rainDaysAtLeast1mm,
    snowLyingDays: normals.snowLyingDays,
    sunshineHours: normals.sunshineHours,
    meanTemperatureC: normals.meanTemperatureC,
    meanWindSpeedMs: normals.meanWindSpeedMs,
    astronomicalDaylightHours: daylightHours,
    dataset: `${file.dataset.name} ${file.dataset.version} ${String(file.dataset.resolutionKm)} km mon-30y`,
    cell: { latitude: file.cell.latitude, longitude: file.cell.longitude, resolutionKm: file.dataset.resolutionKm },
  };
  return {
    venueId: input.venueId,
    kind: "normals",
    source: `Met Office HadUK-Grid ${file.dataset.version} ${file.dataset.period} monthly normals for the venue's ${String(file.dataset.resolutionKm)} km cell`,
    issuedAt: null,
    validFrom: new Date(start).toISOString(),
    validTo: new Date(end).toISOString(),
    at: new Date(input.at).toISOString(),
    cloud: { total: null, low: null, mid: null, high: null },
    visibilityM: null,
    fog: null,
    precipitation: {
      type: null,
      probability: rainShare,
      probabilityDefinition: rainShare === null ? null : "share_of_days_with_at_least_1_mm",
      rateMmH: null,
    },
    windMs: normals.meanWindSpeedMs,
    temperatureC: normals.meanTemperatureC,
    sunshineFraction: sunshineFraction(normals.sunshineHours, daylightHours),
    weather: null,
    presetHint: null,
    climatology,
    degraded: { reason: input.reason },
    attribution: [normalsAttribution(file)],
    provenance: { upstreamRequestedAt: null, cacheAgeSeconds: null, forecastSite: null },
  };
}
