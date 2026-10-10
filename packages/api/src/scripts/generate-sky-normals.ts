import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TRADES_HALL_SITE, haversineDistanceM, type GeoPoint } from "../lib/venue-site.js";
import { SkyNormalsFileSchema, type SkyNormalsFile, type SkyNormalsMonth } from "../services/sky/normals.js";
import { Hdf5File, type Hdf5Dataset, type Hdf5Group } from "./sky-normals/hdf5.js";
import { osgb36ToWgs84, project, unproject, wgs84ToOsgb36, type TransverseMercator } from "./sky-normals/osgb.js";

// ---------------------------------------------------------------------------
// Monthly sky normals from HadUK-Grid (T-647).
//
//   pnpm --filter @omnitwin/api sky:normals -- --inputs <directory>
//        [--latitude 55.8593 --longitude -4.2491] [--out <file.json>]
//
// Reads the five Met Office HadUK-Grid v1.3.2.ceda 1 km "mon-30y"
// (1991-2020) climatologies listed in HADUK_INPUTS from a local directory,
// checks each against its pinned sha256 and stops on any mismatch, finds
// the 1 km British National Grid cell containing the site (default: the
// Trades Hall site agreed with T-639) from the files' own grid-mapping and
// coordinate variables, reads that cell's twelve monthly values, and writes
// the normals JSON the API serves (SkyNormalsFileSchema), with provenance.
//
// The files are not downloaded here: the CEDA Archive serves them only to a
// signed-in user ("Access to these data is available to any registered CEDA
// user"; a CEDA account is free). Download the URLs below while signed in,
// then point --inputs at the directory. The data are Open Government
// Licence v3.0 and must be cited as the CEDA catalogue record says
// (HADUK_GRID.citation).
//
// Values are written as the files hold them, once each file's declared
// units and CF standard name have been checked against what the contract
// expects (a different unit is converted only where the conversion is exact,
// e.g. knots to m/s; anything unexpected stops the generator). Nothing is
// rounded, smoothed or filled in; a missing value stays null.
// ---------------------------------------------------------------------------

export const GENERATOR = { name: "packages/api/src/scripts/generate-sky-normals.ts", version: "1.0.0" } as const;

export const HADUK_GRID = {
  version: "v1.3.2.ceda",
  versionDirectory: "v20260512",
  period: "1991-2020",
  resolutionKm: 1,
  catalogueUrl: "https://catalogue.ceda.ac.uk/uuid/789b3065d74a4c948ab05d33556c86d0/",
  doi: "10.5285/789b3065d74a4c948ab05d33556c86d0",
  // The citation on the CEDA catalogue record (read 8 October 2026).
  citation: "Met Office; Hollis, D.; Carlisle, E.; Kendon, M.; Packman, S.; Doherty, A. (2026): HadUK-Grid Gridded Climate Observations on a 1km grid over the UK, v1.3.2.ceda (1836-2025). NERC EDS Centre for Environmental Data Analysis, 23 June 2026. doi:10.5285/789b3065d74a4c948ab05d33556c86d0.",
  licence: "Open Government Licence v3.0",
} as const;

export type HadukVariable = "raindays1mm" | "sfcWind" | "snowLying" | "sun" | "tas";

/** The pinned inputs: sha256 of each file as published on the CEDA Archive
 *  (version directory v20260512), verified on 8 October 2026. */
export const HADUK_INPUTS: readonly { readonly variable: HadukVariable; readonly sha256: string }[] = [
  { variable: "raindays1mm", sha256: "7cc522b1875e07314ceb4ae2df95fc332e7060dd31f71f25f1a5941117bb5c01" },
  { variable: "sfcWind", sha256: "c64bcb33922c95215354b0507d54fe1ff56bc279f6685b88bbb39307050efacc" },
  { variable: "snowLying", sha256: "920bc0c79fe8eb90e9768a65d937a30a49b29ed8fbfe1db178d9fd377b5f992e" },
  { variable: "sun", sha256: "d1cda0d700368a29f61dc26a51e3ebb427ee3a866402c0976412b731cd3109a0" },
  { variable: "tas", sha256: "a68aa595f8a05e63ce904e7025377758d3c056a280fe87d0b6d29e9b0fba6876" },
];

export function hadukFileName(variable: HadukVariable): string {
  return `${variable}_hadukgrid_uk_1km_mon-30y_199101-202012.nc`;
}

export function hadukUrl(variable: HadukVariable): string {
  return `https://dap.ceda.ac.uk/badc/ukmo-hadobs/data/insitu/MOHC/HadOBS/HadUK-Grid/${HADUK_GRID.version}/1km/${variable}/mon-30y/${HADUK_GRID.versionDirectory}/${hadukFileName(variable)}`;
}

export class SkyNormalsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkyNormalsInputError";
  }
}

function fail(message: string): never {
  throw new SkyNormalsInputError(message);
}

// --- units --------------------------------------------------------------

const KNOT_MS = 1852 / 3600;

/** The contract's unit for each variable, and how the file's declared unit
 *  converts to it. An undeclared or unexpected unit stops the generator. */
export function convertUnits(variable: HadukVariable, units: string | null): (value: number) => number {
  const u = (units ?? "").trim();
  switch (variable) {
    case "tas":
      if (["degC", "Celsius", "celsius", "degrees_Celsius", "deg_C"].includes(u)) return (v) => v;
      if (u === "K") return (v) => v - 273.15;
      break;
    case "sfcWind":
      if (["knots", "knot", "kt", "kn"].includes(u)) return (v) => v * KNOT_MS;
      if (["m s-1", "m/s", "m.s-1"].includes(u)) return (v) => v;
      break;
    case "sun":
      if (["hour", "hours", "h", "hr"].includes(u)) return (v) => v;
      break;
    case "raindays1mm":
    case "snowLying":
      // A count of days: CF writes it dimensionless ("1"; HadUK-Grid "1.0").
      if (["1", "1.0", "day", "days"].includes(u)) return (v) => v;
      break;
  }
  fail(`${variable}: unexpected units "${u}"`);
}

/** The CF standard name each variable must carry, and the scalar coordinate
 *  that fixes its meaning where there is one (HadUK-Grid file metadata). */
export const HADUK_MEANING: Record<HadukVariable, { readonly standardName: string; readonly scalar?: { readonly name: string; readonly value: number; readonly units: string } }> = {
  raindays1mm: {
    standardName: "number_of_days_with_lwe_thickness_of_precipitation_amount_above_threshold",
    scalar: { name: "lwe_thickness_of_precipitation_amount", value: 1, units: "mm" },
  },
  snowLying: {
    standardName: "surface_snow_binary_mask",
    scalar: { name: "surface_snow_area_fraction", value: 0.5, units: "1" },
  },
  sun: { standardName: "duration_of_sunshine" },
  tas: { standardName: "air_temperature" },
  sfcWind: { standardName: "wind_speed" },
};

function checkMeaning(root: Hdf5Group, data: Hdf5Dataset, variable: HadukVariable): void {
  const meaning = HADUK_MEANING[variable];
  const standardName = data.stringAttribute("standard_name");
  if (standardName !== meaning.standardName) fail(`${variable}: standard_name is "${String(standardName)}", expected "${meaning.standardName}"`);
  if (meaning.scalar !== undefined) {
    const { name, value, units } = meaning.scalar;
    if (!root.has(name)) fail(`${variable}: scalar coordinate ${name} is missing`);
    const scalar = root.dataset(name);
    if (scalar.shape.length !== 0 || scalar.read([]) !== value || scalar.stringAttribute("units") !== units) {
      fail(`${variable}: ${name} is not ${String(value)} ${units}`);
    }
  }
  const source = root.stringAttribute("source");
  const version = root.stringAttribute("version");
  if (source === null || !source.startsWith("HadUK-Grid_v1.3.2") || version !== HADUK_GRID.versionDirectory) {
    fail(`${variable}: file is ${String(source)} ${String(version)}, expected HadUK-Grid v1.3.2 ${HADUK_GRID.versionDirectory}`);
  }
}

// --- cell selection -----------------------------------------------------

export interface GridAxis {
  readonly centres: readonly number[];
  readonly bounds: readonly (readonly [number, number])[];
}

/** The index whose bounds contain `value` (lower bound inclusive). */
export function cellIndex(axis: GridAxis, value: number): number {
  const index = axis.bounds.findIndex(([a, b]) => Math.min(a, b) <= value && value < Math.max(a, b));
  if (index < 0) fail(`coordinate ${String(value)} is outside the grid`);
  return index;
}

/** Bounds from the file's bounds variable, or, when it has none, from a
 *  uniform spacing that the centres must show. */
export function axisFrom(centres: readonly number[], bounds: readonly (readonly [number, number])[] | null): GridAxis {
  if (centres.length < 2) fail("a coordinate axis needs at least two cells");
  if (bounds !== null) {
    if (bounds.length !== centres.length) fail("coordinate bounds do not match the centres");
    return { centres, bounds };
  }
  const step = (centres[1] ?? 0) - (centres[0] ?? 0);
  centres.forEach((value, i) => {
    if (i > 0 && Math.abs(value - (centres[i - 1] ?? 0) - step) > 1e-6) fail("coordinate spacing is not uniform and no bounds are given");
  });
  return { centres, bounds: centres.map((c) => [c - step / 2, c + step / 2] as const) };
}

// --- reading one file ---------------------------------------------------

interface FileGrid {
  readonly projection: TransverseMercator;
  readonly x: GridAxis;
  readonly y: GridAxis;
  readonly latitude: Hdf5Dataset | null;
  readonly longitude: Hdf5Dataset | null;
}

function numberAttr(dataset: Hdf5Dataset, name: string): number {
  const value = dataset.numberAttribute(name);
  if (value === null) fail(`${dataset.path}: attribute ${name} is missing`);
  return value;
}

function readProjection(root: Hdf5Group, data: Hdf5Dataset): TransverseMercator {
  const mappingName = data.stringAttribute("grid_mapping");
  if (mappingName === null) fail(`${data.path} names no grid mapping`);
  const mapping = root.dataset(mappingName);
  if (mapping.stringAttribute("grid_mapping_name") !== "transverse_mercator") fail(`${mappingName} is not a transverse Mercator grid mapping`);
  const a = numberAttr(mapping, "semi_major_axis");
  const inverseFlattening = mapping.numberAttribute("inverse_flattening");
  const b = mapping.numberAttribute("semi_minor_axis") ?? (inverseFlattening === null ? null : a * (1 - 1 / inverseFlattening));
  if (b === null) fail(`${mappingName} gives neither semi_minor_axis nor inverse_flattening`);
  // The OSGB36 datum shift is only known for the Airy 1830 ellipsoid.
  if (Math.abs(a - 6_377_563.396) > 0.01 || Math.abs(b - 6_356_256.909) > 0.01) fail(`${mappingName} is not on the Airy 1830 ellipsoid (a=${String(a)}, b=${String(b)})`);
  return {
    ellipsoid: { a, b },
    scaleFactor: numberAttr(mapping, "scale_factor_at_central_meridian"),
    originLatitude: numberAttr(mapping, "latitude_of_projection_origin"),
    originLongitude: numberAttr(mapping, "longitude_of_central_meridian"),
    falseEasting: numberAttr(mapping, "false_easting"),
    falseNorthing: numberAttr(mapping, "false_northing"),
  };
}

function readAxis(root: Hdf5Group, name: string): GridAxis {
  const coordinate = root.dataset(name);
  const units = coordinate.stringAttribute("units");
  if (units !== "m") fail(`${name} is in "${String(units)}", not metres`);
  const centres = coordinate.readVector().map((value, i) => {
    if (value === null) fail(`${name}[${String(i)}] is missing`);
    return value;
  });
  const boundsName = coordinate.stringAttribute("bounds");
  let bounds: [number, number][] | null = null;
  if (boundsName !== null && root.has(boundsName)) {
    const variable = root.dataset(boundsName);
    if (variable.shape.length !== 2 || variable.shape[1] !== 2) fail(`${boundsName} is not an (n, 2) bounds variable`);
    bounds = centres.map((_, i) => {
      const lower = variable.read([i, 0]);
      const upper = variable.read([i, 1]);
      if (lower === null || upper === null) fail(`${boundsName}[${String(i)}] is missing`);
      return [lower, upper];
    });
  }
  return axisFrom(centres, bounds);
}

function readGrid(root: Hdf5Group, data: Hdf5Dataset): FileGrid {
  return {
    projection: readProjection(root, data),
    x: readAxis(root, "projection_x_coordinate"),
    y: readAxis(root, "projection_y_coordinate"),
    latitude: root.has("latitude") ? root.dataset("latitude") : null,
    longitude: root.has("longitude") ? root.dataset("longitude") : null,
  };
}

/** Calendar month (1-12) of each time step, from the CF time coordinate. */
export function monthsFromTime(values: readonly number[], units: string, calendar: string | null): number[] {
  if (calendar !== null && !["gregorian", "standard", "proleptic_gregorian"].includes(calendar)) fail(`unsupported calendar ${calendar}`);
  const match = /^(seconds|minutes|hours|days) since (\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/u.exec(units.trim());
  if (match === null) fail(`unsupported time units "${units}"`);
  const scale = { seconds: 1_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[match[1] as "seconds" | "minutes" | "hours" | "days"];
  const epoch = Date.UTC(Number(match[2]), Number(match[3]) - 1, Number(match[4]), Number(match[5] ?? 0), Number(match[6] ?? 0), Number(match[7] ?? 0));
  return values.map((value) => new Date(epoch + value * scale).getUTCMonth() + 1);
}

function monthIndex(root: Hdf5Group, data: Hdf5Dataset): number[] {
  const time = root.dataset("time");
  const values = time.readVector().map((value, i) => {
    if (value === null) fail(`time[${String(i)}] is missing`);
    return value;
  });
  const units = time.stringAttribute("units");
  if (units === null) fail("time has no units");
  const months = monthsFromTime(values, units, time.stringAttribute("calendar"));
  if (data.shape[0] !== months.length) fail(`${data.path} does not have one step per time value`);
  const sorted = [...months].sort((a, b) => a - b);
  if (months.length !== 12 || sorted.some((month, i) => month !== i + 1)) fail(`time does not hold each calendar month once (${months.join(",")})`);
  return months;
}

export interface CellReport {
  readonly site: GeoPoint;
  readonly siteOsgb36: GeoPoint;
  readonly siteEastingM: number;
  readonly siteNorthingM: number;
  readonly gridIndex: { readonly x: number; readonly y: number };
  readonly centreEastingM: number;
  readonly centreNorthingM: number;
  readonly centreWgs84: GeoPoint;
  readonly centreOsgb36: GeoPoint;
  readonly siteDistanceM: number;
  /** Distance from the site to the nearest cell edge, in grid metres. */
  readonly edgeMarginM: number;
  /** The file's own latitude/longitude at the cell, and which datum they
   *  agree with. */
  readonly fileLatLon: GeoPoint | null;
  readonly fileLatLonDatum: "WGS84" | "OSGB36" | null;
  readonly fileLatLonOffsetM: number | null;
}

/** The cell containing `site`, found by projecting the site with the file's
 *  own transverse Mercator parameters (after the OSGB36 datum shift) and
 *  locating it in the file's coordinate bounds; cross-checked against the
 *  file's latitude/longitude variables. */
export function locateCell(grid: FileGrid, site: GeoPoint): CellReport {
  const siteOsgb = wgs84ToOsgb36(site.latitude, site.longitude);
  const { easting, northing } = project(siteOsgb.latitude, siteOsgb.longitude, grid.projection);
  const i = cellIndex(grid.x, easting);
  const j = cellIndex(grid.y, northing);
  const centreE = grid.x.centres[i] ?? fail("x centre missing");
  const centreN = grid.y.centres[j] ?? fail("y centre missing");
  const [xLo, xHi] = grid.x.bounds[i] ?? fail("x bounds missing");
  const [yLo, yHi] = grid.y.bounds[j] ?? fail("y bounds missing");
  const edgeMarginM = Math.min(easting - Math.min(xLo, xHi), Math.max(xLo, xHi) - easting, northing - Math.min(yLo, yHi), Math.max(yLo, yHi) - northing);
  const centreOsgb = unproject(centreE, centreN, grid.projection);
  const centreWgs = osgb36ToWgs84(centreOsgb.latitude, centreOsgb.longitude);
  const centreWgs84 = { latitude: centreWgs.latitude, longitude: centreWgs.longitude };
  let fileLatLon: GeoPoint | null = null;
  let fileLatLonDatum: "WGS84" | "OSGB36" | null = null;
  let fileLatLonOffsetM: number | null = null;
  if (grid.latitude !== null && grid.longitude !== null) {
    const latitude = grid.latitude.read([j, i]);
    const longitude = grid.longitude.read([j, i]);
    if (latitude !== null && longitude !== null) {
      fileLatLon = { latitude, longitude };
      const toWgs = haversineDistanceM(fileLatLon, centreWgs84);
      const toOsgb = haversineDistanceM(fileLatLon, { latitude: centreOsgb.latitude, longitude: centreOsgb.longitude });
      fileLatLonDatum = toWgs <= toOsgb ? "WGS84" : "OSGB36";
      fileLatLonOffsetM = Math.min(toWgs, toOsgb);
      // The file's own latitude/longitude must describe this same cell
      // centre; anything else means the grid was misread.
      if (fileLatLonOffsetM > 25) fail(`the file's latitude/longitude at the cell is ${fileLatLonOffsetM.toFixed(1)} m from the computed centre`);
    }
  }
  return {
    site,
    siteOsgb36: { latitude: siteOsgb.latitude, longitude: siteOsgb.longitude },
    siteEastingM: easting,
    siteNorthingM: northing,
    gridIndex: { x: i, y: j },
    centreEastingM: centreE,
    centreNorthingM: centreN,
    centreWgs84,
    centreOsgb36: { latitude: centreOsgb.latitude, longitude: centreOsgb.longitude },
    siteDistanceM: haversineDistanceM(site, centreWgs84),
    edgeMarginM,
    fileLatLon,
    fileLatLonDatum,
    fileLatLonOffsetM,
  };
}

// --- sanity checks ------------------------------------------------------

export interface SanityFinding {
  readonly check: string;
  readonly plausible: boolean;
  readonly detail: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function argMax(values: readonly (number | null)[]): number {
  let best = -1;
  values.forEach((value, i) => {
    if (value !== null && (best < 0 || value > (values[best] ?? Number.NEGATIVE_INFINITY))) best = i;
  });
  return best;
}

function argMin(values: readonly (number | null)[]): number {
  let best = -1;
  values.forEach((value, i) => {
    if (value !== null && (best < 0 || value < (values[best] ?? Number.POSITIVE_INFINITY))) best = i;
  });
  return best;
}

function mean(values: readonly (number | null)[], months: readonly number[]): number | null {
  const picked = months.map((m) => values[m - 1] ?? null).filter((v): v is number => v !== null);
  return picked.length === 0 ? null : picked.reduce((s, v) => s + v, 0) / picked.length;
}

/** Plausibility against Glasgow's known climate. Findings are reported,
 *  never used to change a value. */
export function sanityCheck(months: readonly SkyNormalsMonth[]): SanityFinding[] {
  const series = (pick: (m: SkyNormalsMonth) => number | null): (number | null)[] => months.map(pick);
  const tas = series((m) => m.meanTemperatureC);
  const sun = series((m) => m.sunshineHours);
  const rain = series((m) => m.rainDaysAtLeast1mm);
  const snow = series((m) => m.snowLyingDays);
  const wind = series((m) => m.meanWindSpeedMs);
  const name = (index: number): string => MONTH_NAMES[index] ?? "?";
  const findings: SanityFinding[] = [];
  const missing = months.flatMap((m) => Object.entries(m).filter(([, v]) => v === null).map(([k]) => `${name(m.month - 1)} ${k}`));
  findings.push({ check: "no missing values", plausible: missing.length === 0, detail: missing.length === 0 ? "all 60 values present" : missing.join(", ") });

  const tasMin = argMin(tas);
  const tasMax = argMax(tas);
  findings.push({
    check: "mean temperature about 4-16 °C, coldest Dec-Feb, warmest Jun-Aug",
    plausible: [11, 0, 1].includes(tasMin) && [5, 6, 7].includes(tasMax) && (tas[tasMin] ?? 99) >= 1 && (tas[tasMin] ?? 99) <= 7 && (tas[tasMax] ?? -99) >= 13 && (tas[tasMax] ?? -99) <= 19,
    detail: `coldest ${name(tasMin)} ${String(tas[tasMin])}, warmest ${name(tasMax)} ${String(tas[tasMax])}`,
  });
  const sunMax = argMax(sun);
  const sunMin = argMin(sun);
  const sunTotal = sun.reduce<number>((s, v) => s + (v ?? 0), 0);
  findings.push({
    check: "sunshine peaks in May or June, least in Nov-Jan, 900-1600 h a year",
    plausible: [4, 5].includes(sunMax) && [10, 11, 0].includes(sunMin) && sunTotal >= 900 && sunTotal <= 1600,
    detail: `peak ${name(sunMax)} ${String(sun[sunMax])} h, least ${name(sunMin)} ${String(sun[sunMin])} h, year ${sunTotal.toFixed(1)} h`,
  });
  const rainWinter = mean(rain, [12, 1, 2]);
  const rainSpring = mean(rain, [4, 5, 6]);
  const rainOverfull = rain.flatMap((v, i) => (v !== null && v > (DAYS_IN_MONTH[i] ?? 31) ? [name(i)] : []));
  findings.push({
    check: "more rain days in winter than late spring, none above the days in the month",
    plausible: rainWinter !== null && rainSpring !== null && rainWinter > rainSpring && rainOverfull.length === 0,
    detail: `Dec-Feb ${rainWinter?.toFixed(2) ?? "?"} a month, Apr-Jun ${rainSpring?.toFixed(2) ?? "?"}; over-full: ${rainOverfull.join(", ") || "none"}`,
  });
  const snowTotal = snow.reduce<number>((s, v) => s + (v ?? 0), 0);
  const snowWinter = [11, 0, 1].reduce((s, i) => s + (snow[i] ?? 0), 0);
  const snowSummer = [5, 6, 7, 8].reduce((s, i) => s + (snow[i] ?? 0), 0);
  findings.push({
    check: "snow lying mostly Dec-Feb, none in Jun-Sep",
    plausible: snowTotal === 0 || (snowWinter / snowTotal >= 0.6 && snowSummer < 0.1),
    detail: `year ${snowTotal.toFixed(2)} days, Dec-Feb ${snowWinter.toFixed(2)}, Jun-Sep ${snowSummer.toFixed(2)}`,
  });
  const windWinter = mean(wind, [12, 1, 2]);
  const windSummer = mean(wind, [6, 7, 8]);
  findings.push({
    check: "windier in winter than summer, 1-12 m/s",
    plausible: windWinter !== null && windSummer !== null && windWinter > windSummer && wind.every((v) => v === null || (v >= 1 && v <= 12)),
    detail: `Dec-Feb ${windWinter?.toFixed(2) ?? "?"} m/s, Jun-Aug ${windSummer?.toFixed(2) ?? "?"} m/s`,
  });
  return findings;
}

// --- the generator ------------------------------------------------------

export interface GeneratedNormals {
  readonly file: SkyNormalsFile;
  readonly cell: CellReport;
  readonly findings: readonly SanityFinding[];
}

const FIELD: Record<HadukVariable, keyof Omit<SkyNormalsMonth, "month">> = {
  raindays1mm: "rainDaysAtLeast1mm",
  sfcWind: "meanWindSpeedMs",
  snowLying: "snowLyingDays",
  sun: "sunshineHours",
  tas: "meanTemperatureC",
};

export async function generateSkyNormals(inputsDirectory: string, site: GeoPoint, now: Date): Promise<GeneratedNormals> {
  const months: { -readonly [K in keyof SkyNormalsMonth]: SkyNormalsMonth[K] }[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    rainDaysAtLeast1mm: null,
    snowLyingDays: null,
    sunshineHours: null,
    meanTemperatureC: null,
    meanWindSpeedMs: null,
  }));
  const inputs: SkyNormalsFile["inputs"][number][] = [];
  let reference: { grid: FileGrid; cell: CellReport } | null = null;

  for (const input of HADUK_INPUTS) {
    const path = join(inputsDirectory, hadukFileName(input.variable));
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== input.sha256) fail(`${hadukFileName(input.variable)}: sha256 ${sha256} does not match the pinned ${input.sha256}`);
    const root = new Hdf5File(bytes).root();
    const data = root.dataset(input.variable);
    const grid = readGrid(root, data);
    if (data.shape.length !== 3 || data.shape[1] !== grid.y.centres.length || data.shape[2] !== grid.x.centres.length) {
      fail(`${input.variable} is not shaped (time, projection_y_coordinate, projection_x_coordinate)`);
    }
    if (grid.x.centres.length === grid.y.centres.length) fail("square grid: cannot tell x from y by length");
    const cell = locateCell(grid, site);
    if (reference === null) {
      reference = { grid, cell };
    } else if (
      cell.gridIndex.x !== reference.cell.gridIndex.x || cell.gridIndex.y !== reference.cell.gridIndex.y
      || grid.x.centres.some((v, k) => v !== reference?.grid.x.centres[k]) || grid.y.centres.some((v, k) => v !== reference?.grid.y.centres[k])
    ) {
      fail(`${input.variable} is not on the same grid as ${HADUK_INPUTS[0]?.variable ?? "the first input"}`);
    }
    checkMeaning(root, data, input.variable);
    const monthOfStep = monthIndex(root, data);
    const units = data.stringAttribute("units");
    const convert = convertUnits(input.variable, units);
    const fill = data.numberAttribute("_FillValue") ?? data.numberAttribute("missing_value");
    // CF packing, if the file uses it: value = stored * scale_factor + add_offset.
    const scale = data.numberAttribute("scale_factor") ?? 1;
    const offset = data.numberAttribute("add_offset") ?? 0;
    monthOfStep.forEach((month, t) => {
      const raw = data.read([t, cell.gridIndex.y, cell.gridIndex.x]);
      const isMissing = raw === null || !Number.isFinite(raw) || (fill !== null && raw === fill) || Math.abs(raw) >= 1e19;
      const target = months[month - 1];
      if (target !== undefined) target[FIELD[input.variable]] = isMissing ? null : convert(raw * scale + offset);
    });
    inputs.push({
      variable: input.variable,
      url: hadukUrl(input.variable),
      sha256,
      bytes: bytes.length,
      units: units ?? fail(`${input.variable} has no units`),
      standardName: data.stringAttribute("standard_name"),
      longName: data.stringAttribute("long_name"),
      cellMethods: data.stringAttribute("cell_methods"),
    });
  }
  if (reference === null) fail("no inputs");
  const cell = reference.cell;
  const file = SkyNormalsFileSchema.parse({
    schemaVersion: 1,
    dataset: {
      name: "HadUK-Grid",
      version: HADUK_GRID.version,
      period: HADUK_GRID.period,
      resolutionKm: HADUK_GRID.resolutionKm,
      licence: HADUK_GRID.licence,
      citation: HADUK_GRID.citation,
      catalogueUrl: HADUK_GRID.catalogueUrl,
      doi: HADUK_GRID.doi,
    },
    generatedAt: now.toISOString(),
    generator: GENERATOR,
    inputs,
    cell: {
      latitude: cell.centreWgs84.latitude,
      longitude: cell.centreWgs84.longitude,
      eastingM: cell.centreEastingM,
      northingM: cell.centreNorthingM,
      gridIndex: cell.gridIndex,
      site: { latitude: site.latitude, longitude: site.longitude },
      siteDistanceM: cell.siteDistanceM,
    },
    months,
  });
  return { file, cell, findings: sanityCheck(file.months) };
}

export function defaultOutputPath(cell: CellReport): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../services/sky/normals", `haduk-grid-1km-1991-2020-e${String(cell.centreEastingM)}-n${String(cell.centreNorthingM)}.json`);
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<void> {
  const inputs = argument(argv, "--inputs");
  if (inputs === undefined) fail("Usage: sky:normals -- --inputs <directory> [--latitude <deg> --longitude <deg>] [--out <file>]");
  const latitude = argument(argv, "--latitude");
  const longitude = argument(argv, "--longitude");
  const site: GeoPoint = latitude === undefined && longitude === undefined
    ? TRADES_HALL_SITE
    : { latitude: Number(latitude), longitude: Number(longitude) };
  if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) fail("--latitude and --longitude must be numbers");
  const generated = await generateSkyNormals(resolve(inputs), site, new Date());
  const out = resolve(argument(argv, "--out") ?? defaultOutputPath(generated.cell));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(generated.file, null, 2)}\n`, "utf8");
  const c = generated.cell;
  const lines = [
    `wrote ${out}`,
    `site ${String(c.site.latitude)}, ${String(c.site.longitude)} (WGS84) -> OSGB36 ${c.siteOsgb36.latitude.toFixed(6)}, ${c.siteOsgb36.longitude.toFixed(6)} -> E ${c.siteEastingM.toFixed(1)} N ${c.siteNorthingM.toFixed(1)}`,
    `cell x=${String(c.gridIndex.x)} y=${String(c.gridIndex.y)}, centre E ${String(c.centreEastingM)} N ${String(c.centreNorthingM)} = ${c.centreWgs84.latitude.toFixed(6)}, ${c.centreWgs84.longitude.toFixed(6)} (WGS84)`,
    `site to centre ${c.siteDistanceM.toFixed(1)} m; nearest cell edge ${c.edgeMarginM.toFixed(1)} m`,
    `file latitude/longitude at the cell: ${c.fileLatLon === null ? "none" : `${c.fileLatLon.latitude.toFixed(6)}, ${c.fileLatLon.longitude.toFixed(6)} (${String(c.fileLatLonDatum)}, ${c.fileLatLonOffsetM?.toFixed(2) ?? "?"} m from the computed centre)`}`,
    "month  rain>=1mm  snowLying  sunshine_h  tas_C   wind_m/s",
    ...generated.file.months.map((m) => [
      (MONTH_NAMES[m.month - 1] ?? "?").padEnd(6),
      (m.rainDaysAtLeast1mm?.toFixed(2) ?? "null").padStart(9),
      (m.snowLyingDays?.toFixed(2) ?? "null").padStart(10),
      (m.sunshineHours?.toFixed(1) ?? "null").padStart(11),
      (m.meanTemperatureC?.toFixed(2) ?? "null").padStart(6),
      (m.meanWindSpeedMs?.toFixed(2) ?? "null").padStart(9),
    ].join("  ")),
    ...generated.findings.map((f) => `${f.plausible ? "plausible  " : "IMPLAUSIBLE"} ${f.check}: ${f.detail}`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : "generation failed"}\n`);
    process.exitCode = 1;
  });
}
