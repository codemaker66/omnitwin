// ---------------------------------------------------------------------------
// Where a venue stands on the earth (T-647).
//
// The venue sky reads a venue's latitude and longitude (migration 0086). The
// Trades Hall site is the one agreed with the relit hall (T-639), recorded in
// claude/real-hall:tools/relight/config/grand-hall.json at room.site
// (latitude 55.8593, longitude -4.2491), so the weather and the hall's own
// sun use one place. `siteAgreement` is the check that a stored location is
// that site: within 100 m, about the size of the building.
// ---------------------------------------------------------------------------

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** IUGG mean earth radius. The haversine error against the ellipsoid is
 *  under 0.5%, far inside a 100 m tolerance at these distances. */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;

/** The Trades Hall site agreed with T-639 (see the header). */
export const TRADES_HALL_SITE: GeoPoint = Object.freeze({ latitude: 55.8593, longitude: -4.2491 });

/** The DATABASE slug of Trades Hall (the asset slug is "trades-hall"). */
export const TRADES_HALL_VENUE_SLUG = "trades-hall-glasgow";

export const SITE_AGREEMENT_TOLERANCE_M = 100;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two points (haversine). */
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SiteAgreement =
  | { readonly agrees: true; readonly distanceM: number }
  | { readonly agrees: false; readonly distanceM: number | null; readonly reason: "not_located" | "too_far" };

/** Whether a stored location is the expected site, within the tolerance. A
 *  venue with no stored location never agrees. */
export function siteAgreement(
  stored: { readonly latitude: number | null; readonly longitude: number | null },
  expected: GeoPoint = TRADES_HALL_SITE,
  toleranceM: number = SITE_AGREEMENT_TOLERANCE_M,
): SiteAgreement {
  if (stored.latitude === null || stored.longitude === null) {
    return { agrees: false, distanceM: null, reason: "not_located" };
  }
  const distanceM = haversineDistanceM({ latitude: stored.latitude, longitude: stored.longitude }, expected);
  return distanceM <= toleranceM
    ? { agrees: true, distanceM }
    : { agrees: false, distanceM, reason: "too_far" };
}
