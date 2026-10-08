// ---------------------------------------------------------------------------
// British National Grid coordinates for the sky normals generator (T-647).
//
// Formulae from Ordnance Survey, "A guide to coordinate systems in Great
// Britain" (v3.6): Annex B (geodetic <-> Cartesian), Annex C (transverse
// Mercator projection and its inverse), and section 6.6 (the 7-parameter
// Helmert transformation from ETRS89 to OSGB36, about 5 m accurate, which
// for a 1 km grid cell is far within what matters). WGS84 is taken as
// ETRS89, which differs from it by well under a metre in Britain at this
// accuracy.
//
// The projection constants are not assumed: the generator reads them from
// each NetCDF file's grid-mapping variable and passes them in.
// ---------------------------------------------------------------------------

export interface Ellipsoid {
  readonly a: number;
  readonly b: number;
}

export interface TransverseMercator {
  readonly ellipsoid: Ellipsoid;
  /** Scale factor on the central meridian, F0. */
  readonly scaleFactor: number;
  /** True origin latitude and longitude, degrees. */
  readonly originLatitude: number;
  readonly originLongitude: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
}

export const GRS80: Ellipsoid = { a: 6_378_137.0, b: 6_356_752.314140 };
export const AIRY_1830: Ellipsoid = { a: 6_377_563.396, b: 6_356_256.909 };

/** ETRS89 -> OSGB36 Helmert parameters (OS guide, section 6.6). */
export const ETRS89_TO_OSGB36 = {
  tx: -446.448,
  ty: 125.157,
  tz: -542.060,
  sPpm: 20.4894,
  rxArcsec: -0.1502,
  ryArcsec: -0.2470,
  rzArcsec: -0.8421,
} as const;

const RAD = Math.PI / 180;

export interface Cartesian {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Geodetic {
  /** Degrees. */
  readonly latitude: number;
  readonly longitude: number;
  /** Metres above the ellipsoid. */
  readonly height: number;
}

export function geodeticToCartesian(point: Geodetic, ellipsoid: Ellipsoid): Cartesian {
  const { a, b } = ellipsoid;
  const e2 = (a * a - b * b) / (a * a);
  const phi = point.latitude * RAD;
  const lambda = point.longitude * RAD;
  const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return {
    x: (nu + point.height) * Math.cos(phi) * Math.cos(lambda),
    y: (nu + point.height) * Math.cos(phi) * Math.sin(lambda),
    z: ((1 - e2) * nu + point.height) * Math.sin(phi),
  };
}

export function cartesianToGeodetic(point: Cartesian, ellipsoid: Ellipsoid): Geodetic {
  const { a, b } = ellipsoid;
  const e2 = (a * a - b * b) / (a * a);
  const p = Math.hypot(point.x, point.y);
  let phi = Math.atan2(point.z, p * (1 - e2));
  for (let i = 0; i < 20; i += 1) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const next = Math.atan2(point.z + e2 * nu * Math.sin(phi), p);
    if (Math.abs(next - phi) < 1e-14) {
      phi = next;
      break;
    }
    phi = next;
  }
  const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return {
    latitude: phi / RAD,
    longitude: Math.atan2(point.y, point.x) / RAD,
    height: p / Math.cos(phi) - nu,
  };
}

/** The small-angle Helmert transformation; `inverse` applies the negated
 *  parameters (the OS guide's reverse transformation). */
export function helmert(point: Cartesian, inverse = false): Cartesian {
  const sign = inverse ? -1 : 1;
  const p = ETRS89_TO_OSGB36;
  const s = 1 + sign * p.sPpm * 1e-6;
  const arcsec = RAD / 3600;
  const rx = sign * p.rxArcsec * arcsec;
  const ry = sign * p.ryArcsec * arcsec;
  const rz = sign * p.rzArcsec * arcsec;
  return {
    x: sign * p.tx + s * point.x - rz * point.y + ry * point.z,
    y: sign * p.ty + rz * point.x + s * point.y - rx * point.z,
    z: sign * p.tz - ry * point.x + rx * point.y + s * point.z,
  };
}

/** WGS84 (taken as ETRS89) latitude/longitude to OSGB36 on Airy 1830. */
export function wgs84ToOsgb36(latitude: number, longitude: number): Geodetic {
  return cartesianToGeodetic(helmert(geodeticToCartesian({ latitude, longitude, height: 0 }, GRS80)), AIRY_1830);
}

/** OSGB36 on Airy 1830 back to WGS84 (taken as ETRS89). */
export function osgb36ToWgs84(latitude: number, longitude: number): Geodetic {
  return cartesianToGeodetic(helmert(geodeticToCartesian({ latitude, longitude, height: 0 }, AIRY_1830), true), GRS80);
}

function meridionalArc(phi: number, projection: TransverseMercator): number {
  const { a, b } = projection.ellipsoid;
  const n = (a - b) / (a + b);
  const phi0 = projection.originLatitude * RAD;
  const d = phi - phi0;
  const s = phi + phi0;
  return b * projection.scaleFactor * (
    (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * d
    - (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(d) * Math.cos(s)
    + ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * d) * Math.cos(2 * s)
    - (35 / 24) * n ** 3 * Math.sin(3 * d) * Math.cos(3 * s)
  );
}

/** Latitude/longitude (on the projection's ellipsoid) to easting/northing. */
export function project(latitude: number, longitude: number, projection: TransverseMercator): { easting: number; northing: number } {
  const { a, b } = projection.ellipsoid;
  const F0 = projection.scaleFactor;
  const e2 = (a * a - b * b) / (a * a);
  const phi = latitude * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinPhi ** 2);
  const rho = a * F0 * (1 - e2) * (1 - e2 * sinPhi ** 2) ** -1.5;
  const eta2 = nu / rho - 1;
  const M = meridionalArc(phi, projection);
  const I = M + projection.falseNorthing;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cosPhi ** 3 * (5 - tanPhi ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cosPhi ** 5 * (61 - 58 * tanPhi ** 2 + tanPhi ** 4);
  const IV = nu * cosPhi;
  const V = (nu / 6) * cosPhi ** 3 * (nu / rho - tanPhi ** 2);
  const VI = (nu / 120) * cosPhi ** 5 * (5 - 18 * tanPhi ** 2 + tanPhi ** 4 + 14 * eta2 - 58 * tanPhi ** 2 * eta2);
  const dl = (longitude - projection.originLongitude) * RAD;
  return {
    northing: I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6,
    easting: projection.falseEasting + IV * dl + V * dl ** 3 + VI * dl ** 5,
  };
}

/** Easting/northing to latitude/longitude (on the projection's ellipsoid). */
export function unproject(easting: number, northing: number, projection: TransverseMercator): { latitude: number; longitude: number } {
  const { a, b } = projection.ellipsoid;
  const F0 = projection.scaleFactor;
  const e2 = (a * a - b * b) / (a * a);
  let phi = projection.originLatitude * RAD;
  let M = 0;
  for (let i = 0; i < 100; i += 1) {
    phi = (northing - projection.falseNorthing - M) / (a * F0) + phi;
    M = meridionalArc(phi, projection);
    if (Math.abs(northing - projection.falseNorthing - M) < 1e-5) break;
  }
  const sinPhi = Math.sin(phi);
  const tanPhi = Math.tan(phi);
  const secPhi = 1 / Math.cos(phi);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinPhi ** 2);
  const rho = a * F0 * (1 - e2) * (1 - e2 * sinPhi ** 2) ** -1.5;
  const eta2 = nu / rho - 1;
  const VII = tanPhi / (2 * rho * nu);
  const VIII = tanPhi / (24 * rho * nu ** 3) * (5 + 3 * tanPhi ** 2 + eta2 - 9 * tanPhi ** 2 * eta2);
  const IX = tanPhi / (720 * rho * nu ** 5) * (61 + 90 * tanPhi ** 2 + 45 * tanPhi ** 4);
  const X = secPhi / nu;
  const XI = secPhi / (6 * nu ** 3) * (nu / rho + 2 * tanPhi ** 2);
  const XII = secPhi / (120 * nu ** 5) * (5 + 28 * tanPhi ** 2 + 24 * tanPhi ** 4);
  const XIIA = secPhi / (5040 * nu ** 7) * (61 + 662 * tanPhi ** 2 + 1320 * tanPhi ** 4 + 720 * tanPhi ** 6);
  const dE = easting - projection.falseEasting;
  return {
    latitude: (phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6) / RAD,
    longitude: projection.originLongitude + (X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7) / RAD,
  };
}
