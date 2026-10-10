import type { SkyPrecipitationType } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Met Office significant-weather codes (T-647).
//
// Source: Weather DataHub "Definition of Codes",
// https://datahub.metoffice.gov.uk/definition-of-codes (read 2026-10-08).
// The descriptions are the Met Office's words. The precipitation type is
// this API's reading of each description onto the sky contract's closed set:
// showers and thunder are rain unless the description names sleet, hail or
// snow; trace rain is rain; mist and fog carry no precipitation. Code 4 is
// "Not used" and is treated as no code at all. Fog itself is reported as a
// probability from the visibility forecast, not from this table; a fog code
// is visible to clients through `weather`.
// ---------------------------------------------------------------------------

export interface WeatherCodeEntry {
  readonly description: string;
  readonly precipitation: SkyPrecipitationType;
}

export const MET_OFFICE_WEATHER_CODES: ReadonlyMap<number, WeatherCodeEntry> = new Map([
  [-1, { description: "Trace rain", precipitation: "rain" }],
  [0, { description: "Clear night", precipitation: "none" }],
  [1, { description: "Sunny day", precipitation: "none" }],
  [2, { description: "Partly cloudy (night)", precipitation: "none" }],
  [3, { description: "Partly cloudy (day)", precipitation: "none" }],
  [5, { description: "Mist", precipitation: "none" }],
  [6, { description: "Fog", precipitation: "none" }],
  [7, { description: "Cloudy", precipitation: "none" }],
  [8, { description: "Overcast", precipitation: "none" }],
  [9, { description: "Light rain shower (night)", precipitation: "rain" }],
  [10, { description: "Light rain shower (day)", precipitation: "rain" }],
  [11, { description: "Drizzle", precipitation: "drizzle" }],
  [12, { description: "Light rain", precipitation: "rain" }],
  [13, { description: "Heavy rain shower (night)", precipitation: "rain" }],
  [14, { description: "Heavy rain shower (day)", precipitation: "rain" }],
  [15, { description: "Heavy rain", precipitation: "rain" }],
  [16, { description: "Sleet shower (night)", precipitation: "sleet" }],
  [17, { description: "Sleet shower (day)", precipitation: "sleet" }],
  [18, { description: "Sleet", precipitation: "sleet" }],
  [19, { description: "Hail shower (night)", precipitation: "hail" }],
  [20, { description: "Hail shower (day)", precipitation: "hail" }],
  [21, { description: "Hail", precipitation: "hail" }],
  [22, { description: "Light snow shower (night)", precipitation: "snow" }],
  [23, { description: "Light snow shower (day)", precipitation: "snow" }],
  [24, { description: "Light snow", precipitation: "snow" }],
  [25, { description: "Heavy snow shower (night)", precipitation: "snow" }],
  [26, { description: "Heavy snow shower (day)", precipitation: "snow" }],
  [27, { description: "Heavy snow", precipitation: "snow" }],
  [28, { description: "Thunder shower (night)", precipitation: "rain" }],
  [29, { description: "Thunder shower (day)", precipitation: "rain" }],
  [30, { description: "Thunder", precipitation: "rain" }],
]);

/** The entry for a code as delivered (a number), or null for a missing,
 *  fractional, unused or unknown code. */
export function weatherCodeEntry(code: number | null): (WeatherCodeEntry & { readonly code: number }) | null {
  if (code === null || !Number.isInteger(code)) return null;
  const entry = MET_OFFICE_WEATHER_CODES.get(code);
  return entry === undefined ? null : { code, ...entry };
}
