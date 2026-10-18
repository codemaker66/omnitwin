// -----------------------------------------------------------------------------
// ephemeris — where the sun and the moon are, seen from a place on Earth.
//
// Low-precision positions from Jean Meeus, "Astronomical Algorithms" (2nd ed.):
// the sun from chapter 25 (about 0.01°), the moon from chapter 47 with the
// larger terms of its tables (about 0.02° here), sidereal time from chapter
// 12, the moon's phase from chapter 48. Altitudes are topocentric (the moon's
// parallax is nearly a degree) and include standard atmospheric refraction,
// so a body sits where an observer would see it. Azimuths are compass
// bearings: degrees clockwise from true north.
//
// Pure and allocation-light: the planner calls these every frame while the
// sun is being dragged.
// -----------------------------------------------------------------------------

const DEG = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
/** Julian day of the Unix epoch. */
const JD_UNIX_EPOCH = 2_440_587.5;
const J2000 = 2_451_545.0;
const EARTH_RADIUS_KM = 6378.14;
const AU_KM = 149_597_870.7;

export interface Observer {
  /** Degrees north. */
  readonly latitude: number;
  /** Degrees east (west is negative). */
  readonly longitude: number;
}

export interface Horizontal {
  /** Compass bearing, degrees clockwise from true north, in [0, 360). */
  readonly azimuth: number;
  /** Degrees above the horizon as seen (refraction included). */
  readonly altitude: number;
  /** Degrees above the horizon without the atmosphere's lift (twilights use this). */
  readonly trueAltitude: number;
}

export interface SunPosition extends Horizontal {
  /** Earth–sun distance, astronomical units. */
  readonly distanceAu: number;
  /** Apparent ecliptic longitude, degrees. */
  readonly longitude: number;
}

export interface MoonPosition extends Horizontal {
  /** Earth–moon distance, kilometres (centre to centre). */
  readonly distanceKm: number;
  /** Share of the disc that is lit, 0 (new) to 1 (full). */
  readonly illuminated: number;
  /** True while the lit share grows (new moon to full). */
  readonly waxing: boolean;
}

function normalise360(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Julian day (UT) of an instant. */
export function julianDay(date: Date | number): number {
  const ms = typeof date === "number" ? date : date.getTime();
  return ms / MS_PER_DAY + JD_UNIX_EPOCH;
}

/**
 * TT − UT in seconds. Measured at 69.1–69.4 s through 2020–2026 (IERS); the
 * drift since is a few tenths of a second a year. Its whole effect on these
 * positions is under 0.003°.
 */
export function deltaTSeconds(year: number): number {
  return 69.2 + 0.15 * (year - 2025);
}

function julianEphemerisDay(date: Date | number): number {
  const ms = typeof date === "number" ? date : date.getTime();
  const year = new Date(ms).getUTCFullYear();
  return julianDay(ms) + deltaTSeconds(year) / 86_400;
}

/** Mean obliquity of the ecliptic (Meeus 22.2), degrees. */
function meanObliquity(T: number): number {
  return 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
}

/** Longitude of the moon's ascending node (Meeus ch. 22), degrees. */
function nodeLongitude(T: number): number {
  return 125.04452 - 1934.136261 * T;
}

/** Nutation in longitude, degrees (Meeus ch. 22, the two largest terms). */
function nutationInLongitude(T: number): number {
  const omega = nodeLongitude(T) * DEG;
  const sunMean = (280.4665 + 36000.7698 * T) * DEG;
  return (-17.2 * Math.sin(omega) - 1.32 * Math.sin(2 * sunMean)) / 3600;
}

/** Nutation in obliquity, degrees (the two largest terms). */
function nutationInObliquity(T: number): number {
  const omega = nodeLongitude(T) * DEG;
  const sunMean = (280.4665 + 36000.7698 * T) * DEG;
  return (9.2 * Math.cos(omega) + 0.57 * Math.cos(2 * sunMean)) / 3600;
}

/**
 * Apparent Greenwich sidereal time (Meeus 12.4 with the equation of the
 * equinoxes), degrees.
 */
function greenwichSiderealTime(jd: number, T: number, obliquity: number): number {
  const D = jd - J2000;
  const mean = 280.46061837 + 360.98564736629 * D + T * T * (0.000387933 - T / 38_710_000);
  return normalise360(mean + nutationInLongitude(T) * Math.cos(obliquity * DEG));
}

/**
 * Refraction for a true (airless) altitude, degrees: Sæmundsson's formula
 * (Meeus 16.4) at 1010 hPa and 10 °C. Below the horizon the formula has no
 * meaning (nothing there is seen through the air), so the lift tapers from its
 * horizon value at −1° to nothing at −2°, keeping the apparent altitude
 * continuous and rising with the true one.
 */
export function refraction(trueAltitude: number): number {
  const at = (h: number) => Math.max(0, 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG)) / 60;
  if (trueAltitude >= -1) return at(trueAltitude);
  if (trueAltitude <= -2) return 0;
  return at(-1) * (trueAltitude + 2);
}

/** Equatorial (right ascension, declination) to horizontal, both in degrees. */
function toHorizontal(rightAscension: number, declination: number, siderealDeg: number, observer: Observer): { azimuth: number; altitude: number } {
  const hourAngle = (siderealDeg + observer.longitude - rightAscension) * DEG;
  const phi = observer.latitude * DEG;
  const delta = declination * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  // Meeus 13.5 measures from the south, westward; a bearing adds 180°.
  const fromSouth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi)) / DEG;
  return { azimuth: normalise360(fromSouth + 180), altitude };
}

function eclipticToEquatorial(longitude: number, latitude: number, obliquity: number): { rightAscension: number; declination: number } {
  const l = longitude * DEG;
  const b = latitude * DEG;
  const e = obliquity * DEG;
  const rightAscension = normalise360(Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) / DEG);
  const declination = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / DEG;
  return { rightAscension, declination };
}

interface SunEcliptic {
  /** Apparent longitude, degrees. */
  readonly longitude: number;
  readonly distanceAu: number;
  /** True obliquity, degrees. */
  readonly obliquity: number;
}

/** The sun's apparent ecliptic position at a Julian ephemeris day (Meeus ch. 25). */
function sunEcliptic(jde: number): SunEcliptic {
  const T = (jde - J2000) / 36525;
  const L0 = normalise360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = normalise360(357.52911 + T * (35999.05029 - T * 0.0001537));
  const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
  const m = M * DEG;
  const centre = (1.914602 - T * (0.004817 + T * 0.000014)) * Math.sin(m)
    + (0.019993 - T * 0.000101) * Math.sin(2 * m)
    + 0.000289 * Math.sin(3 * m);
  const trueLongitude = L0 + centre;
  const anomaly = (M + centre) * DEG;
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(anomaly));
  const omega = (125.04 - 1934.136 * T) * DEG;
  const longitude = normalise360(trueLongitude - 0.00569 - 0.00478 * Math.sin(omega));
  const obliquity = meanObliquity(T) + 0.00256 * Math.cos(omega);
  return { longitude, distanceAu, obliquity };
}

/** The sun's apparent right ascension and declination, degrees (for tests). */
export function sunEquatorial(date: Date | number): { rightAscension: number; declination: number; longitude: number; distanceAu: number } {
  const sun = sunEcliptic(julianEphemerisDay(date));
  return { ...eclipticToEquatorial(sun.longitude, 0, sun.obliquity), longitude: sun.longitude, distanceAu: sun.distanceAu };
}

/** Where the sun is seen from `observer` at `date`. */
export function sunPosition(date: Date | number, observer: Observer): SunPosition {
  const jd = julianDay(date);
  const sun = sunEcliptic(julianEphemerisDay(date));
  const { rightAscension, declination } = eclipticToEquatorial(sun.longitude, 0, sun.obliquity);
  const T = (jd - J2000) / 36525;
  const geometric = toHorizontal(rightAscension, declination, greenwichSiderealTime(jd, T, sun.obliquity), observer);
  // The sun's parallax (8.8″) is below this model's accuracy.
  return {
    azimuth: geometric.azimuth,
    altitude: geometric.altitude + refraction(geometric.altitude),
    trueAltitude: geometric.altitude,
    distanceAu: sun.distanceAu,
    longitude: sun.longitude,
  };
}

// ---------------------------------------------------------------------------
// The moon (Meeus ch. 47). Each row gives multiples of D, M, M′ and F, then the
// coefficient in millionths of a degree (longitude, latitude) or thousandths of
// a kilometre (distance). Terms with M carry the eccentricity factor E per
// power of M.
// ---------------------------------------------------------------------------

const MOON_LONGITUDE_DISTANCE: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
];

const MOON_LATITUDE: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
];

interface MoonGeocentric {
  /** Apparent ecliptic longitude and latitude, degrees. */
  readonly longitude: number;
  readonly latitude: number;
  readonly distanceKm: number;
  readonly obliquity: number;
}

/** The moon's apparent geocentric position at a Julian ephemeris day. */
function moonGeocentric(jde: number): MoonGeocentric {
  const T = (jde - J2000) / 36525;
  const Lp = normalise360(218.3164477 + T * (481267.88123421 + T * (-0.0015786 + T * (1 / 538841 - T / 65194000))));
  const D = normalise360(297.8501921 + T * (445267.1114034 + T * (-0.0018819 + T * (1 / 545868 - T / 113065000))));
  const M = normalise360(357.5291092 + T * (35999.0502909 + T * (-0.0001536 + T / 24490000)));
  const Mp = normalise360(134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000))));
  const F = normalise360(93.272095 + T * (483202.0175233 + T * (-0.0036539 + T * (-1 / 3526000 + T / 863310000))));
  const A1 = normalise360(119.75 + 131.849 * T) * DEG;
  const A2 = normalise360(53.09 + 479264.29 * T) * DEG;
  const A3 = normalise360(313.45 + 481266.484 * T) * DEG;
  const E = 1 - T * (0.002516 + T * 0.0000074);

  let sumL = 0;
  let sumR = 0;
  for (const [d, m, mp, f, l, r] of MOON_LONGITUDE_DISTANCE) {
    const argument = (d * D + m * M + mp * Mp + f * F) * DEG;
    const scale = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumL += l * scale * Math.sin(argument);
    sumR += r * scale * Math.cos(argument);
  }
  let sumB = 0;
  for (const [d, m, mp, f, b] of MOON_LATITUDE) {
    const argument = (d * D + m * M + mp * Mp + f * F) * DEG;
    const scale = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumB += b * scale * Math.sin(argument);
  }
  const lp = Lp * DEG;
  const f = F * DEG;
  const mp = Mp * DEG;
  sumL += 3958 * Math.sin(A1) + 1962 * Math.sin(lp - f) + 318 * Math.sin(A2);
  sumB += -2235 * Math.sin(lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - f) + 175 * Math.sin(A1 + f) + 127 * Math.sin(lp - mp) - 115 * Math.sin(lp + mp);

  return {
    longitude: normalise360(Lp + sumL / 1_000_000 + nutationInLongitude(T)),
    latitude: sumB / 1_000_000,
    distanceKm: 385000.56 + sumR / 1000,
    obliquity: meanObliquity(T) + nutationInObliquity(T),
  };
}

/** The moon's apparent geocentric coordinates, degrees and kilometres (for tests). */
export function moonEcliptic(date: Date | number): { longitude: number; latitude: number; distanceKm: number; rightAscension: number; declination: number } {
  const moon = moonGeocentric(julianEphemerisDay(date));
  return { ...moon, ...eclipticToEquatorial(moon.longitude, moon.latitude, moon.obliquity) };
}

/**
 * The lit share of the moon's disc and whether it is waxing (Meeus ch. 48),
 * from the geocentric positions of the two bodies.
 */
function moonPhase(moon: MoonGeocentric, sun: SunEcliptic): { illuminated: number; waxing: boolean } {
  const elongation = Math.acos(Math.max(-1, Math.min(1,
    Math.cos(moon.latitude * DEG) * Math.cos((moon.longitude - sun.longitude) * DEG))));
  const sunKm = sun.distanceAu * AU_KM;
  const phaseAngle = Math.atan2(sunKm * Math.sin(elongation), moon.distanceKm - sunKm * Math.cos(elongation));
  return {
    illuminated: (1 + Math.cos(phaseAngle)) / 2,
    waxing: normalise360(moon.longitude - sun.longitude) < 180,
  };
}

/** The moon's lit share at `date` (geocentric; the same for any observer). */
export function moonIllumination(date: Date | number): { illuminated: number; waxing: boolean } {
  const jde = julianEphemerisDay(date);
  return moonPhase(moonGeocentric(jde), sunEcliptic(jde));
}

/** Where the moon is seen from `observer` at `date`, and how much of it is lit. */
export function moonPosition(date: Date | number, observer: Observer): MoonPosition {
  const jd = julianDay(date);
  const jde = julianEphemerisDay(date);
  const moon = moonGeocentric(jde);
  const { rightAscension, declination } = eclipticToEquatorial(moon.longitude, moon.latitude, moon.obliquity);
  const T = (jd - J2000) / 36525;
  const geocentric = toHorizontal(rightAscension, declination, greenwichSiderealTime(jd, T, moon.obliquity), observer);
  // Seen from the surface the moon sits lower by its parallax (about 1°).
  const parallax = Math.asin(EARTH_RADIUS_KM / moon.distanceKm) / DEG;
  const topocentric = geocentric.altitude - parallax * Math.cos(geocentric.altitude * DEG);
  const phase = moonPhase(moon, sunEcliptic(jde));
  return {
    azimuth: geocentric.azimuth,
    altitude: topocentric + refraction(topocentric),
    trueAltitude: topocentric,
    distanceKm: moon.distanceKm,
    illuminated: phase.illuminated,
    waxing: phase.waxing,
  };
}

// ---------------------------------------------------------------------------
// Sun times
// ---------------------------------------------------------------------------

/**
 * True (geometric) altitudes of the sun's centre that name the day's moments,
 * degrees, as almanacs define them.
 */
export const SUN_EVENT_ALTITUDE = {
  /** Upper limb on the horizon: 34′ of refraction plus the 16′ semidiameter. */
  horizon: -0.8333,
  /** Golden hour runs while the sun is below this. */
  golden: 6,
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

/**
 * Instants as epoch milliseconds, or null where the sun does not cross. The
 * morning's crossings are the ones since the solar midnight before the day's
 * noon, the evening's those up to the solar midnight after it: in a short
 * summer night an evening twilight can end after the clock's midnight, and it
 * is still that evening's.
 */
export interface SunTimes {
  readonly sunrise: number | null;
  readonly sunset: number | null;
  readonly solarNoon: number;
  readonly civilDawn: number | null;
  readonly civilDusk: number | null;
  readonly nauticalDawn: number | null;
  readonly nauticalDusk: number | null;
  readonly astronomicalDawn: number | null;
  readonly astronomicalDusk: number | null;
  /** The sun climbs past 6° in the morning, and sinks below it in the evening. */
  readonly goldenMorningEnd: number | null;
  readonly goldenEveningStart: number | null;
  /** The sun's highest apparent altitude in the day, degrees. */
  readonly noonAltitude: number;
}

/**
 * The first instant in [start, end] at which the sun's true altitude crosses
 * `altitude` upward (or downward): stepped every ten minutes and bisected to
 * a second. Null where it does not cross that way.
 */
function crossing(start: number, end: number, altitude: number, upward: boolean, observer: Observer): number | null {
  const step = 10 * 60_000;
  let previousTime = start;
  let previous = sunPosition(start, observer).trueAltitude - altitude;
  for (let time = start + step; time <= end; time += step) {
    const current = sunPosition(time, observer).trueAltitude - altitude;
    if ((previous < 0) === upward && (current < 0) !== upward) {
      let low = previousTime;
      let high = time;
      while (high - low > 1000) {
        const middle = (low + high) / 2;
        const value = sunPosition(middle, observer).trueAltitude - altitude;
        if ((value < 0) === upward) low = middle; else high = middle;
      }
      return (low + high) / 2;
    }
    previousTime = time;
    previous = current;
  }
  return null;
}

/**
 * The sun's day from `dayStart` (epoch ms, the local midnight that begins it)
 * for `observer`: noon, then rise and set, the three twilights and golden
 * hour around it (see SunTimes for which night's twilights these are).
 */
export function sunTimes(dayStart: number, observer: Observer): SunTimes {
  const end = dayStart + MS_PER_DAY;
  // Solar noon is the highest point: golden-section search over the day.
  const ratio = (Math.sqrt(5) - 1) / 2;
  let low = dayStart;
  let high = end;
  let a = high - ratio * (high - low);
  let b = low + ratio * (high - low);
  let fa = sunPosition(a, observer).altitude;
  let fb = sunPosition(b, observer).altitude;
  while (high - low > 1000) {
    if (fa > fb) {
      high = b; b = a; fb = fa;
      a = high - ratio * (high - low); fa = sunPosition(a, observer).altitude;
    } else {
      low = a; a = b; fa = fb;
      b = low + ratio * (high - low); fb = sunPosition(b, observer).altitude;
    }
  }
  const solarNoon = (low + high) / 2;
  // Mornings are searched from the solar midnight before noon, evenings to the
  // one after it, not across the clock's day: at Glasgow from late April to
  // mid August a twilight can end after midnight, and the clock's day would
  // take the previous evening's for this one and lose this evening's.
  const halfDay = MS_PER_DAY / 2;
  const rises = (altitude: number) => crossing(solarNoon - halfDay, solarNoon, altitude, true, observer);
  const sets = (altitude: number) => crossing(solarNoon, solarNoon + halfDay, altitude, false, observer);
  return {
    sunrise: rises(SUN_EVENT_ALTITUDE.horizon),
    sunset: sets(SUN_EVENT_ALTITUDE.horizon),
    solarNoon,
    civilDawn: rises(SUN_EVENT_ALTITUDE.civil),
    civilDusk: sets(SUN_EVENT_ALTITUDE.civil),
    nauticalDawn: rises(SUN_EVENT_ALTITUDE.nautical),
    nauticalDusk: sets(SUN_EVENT_ALTITUDE.nautical),
    astronomicalDawn: rises(SUN_EVENT_ALTITUDE.astronomical),
    astronomicalDusk: sets(SUN_EVENT_ALTITUDE.astronomical),
    goldenMorningEnd: rises(SUN_EVENT_ALTITUDE.golden),
    goldenEveningStart: sets(SUN_EVENT_ALTITUDE.golden),
    noonAltitude: sunPosition(solarNoon, observer).altitude,
  };
}
