// ---------------------------------------------------------------------------
// Astronomical day length, the denominator of sunshineFraction (T-647).
//
// sunshineFraction = bright-sunshine hours / hours the sun is above the
// horizon. The day length is geometric (the sun's centre on a flat horizon,
// no refraction, no terrain):
//
//   declination δ = 23.45° × sin(360° × (284 + n) / 365)      (Cooper 1969)
//   cos ω₀       = −tan φ × tan δ, clamped to [−1, 1]
//   day length   = 2 ω₀ / 15 hours (ω₀ in degrees)
//
// with n the day of the year (1–366) and φ the latitude. At Glasgow this
// gives about 17.3 h at midsummer and 6.7 h at midwinter; refraction would
// add a few minutes each end, which the fraction does not need. This is not
// a sun position for rendering (T-639 keeps its own ephemeris); it only
// normalises sunshine durations.
// ---------------------------------------------------------------------------

const DEGREE = Math.PI / 180;
const DAY_MS = 86_400_000;

/** Day of the year (1–366) of a UTC instant. */
export function utcDayOfYear(at: number): number {
  const date = new Date(at);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
}

/** Hours from sunrise to sunset on day `dayOfYear` at `latitude`. */
export function dayLengthHours(dayOfYear: number, latitude: number): number {
  const declination = 23.45 * Math.sin(((284 + dayOfYear) / 365) * 2 * Math.PI) * DEGREE;
  const cosHourAngle = -Math.tan(latitude * DEGREE) * Math.tan(declination);
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosHourAngle))) / DEGREE;
  return (2 * hourAngle) / 15;
}

/** Hours of daylight summed over every day of a calendar month. */
export function monthDaylightHours(year: number, month: number, latitude: number): number {
  const first = Date.UTC(year, month - 1, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0;
  for (let day = 0; day < days; day += 1) {
    total += dayLengthHours(utcDayOfYear(first + day * DAY_MS), latitude);
  }
  return total;
}

/** Sunshine as a fraction of the daylight it could have filled. Null when
 *  either is unknown, or when the ratio is impossible (above 1 beyond
 *  rounding), which would mean the inputs disagree. */
export function sunshineFraction(sunshineHours: number | null, daylightHours: number): number | null {
  if (sunshineHours === null || sunshineHours < 0 || daylightHours <= 0) return null;
  const fraction = sunshineHours / daylightHours;
  if (fraction > 1.01) return null;
  return Math.min(1, fraction);
}
