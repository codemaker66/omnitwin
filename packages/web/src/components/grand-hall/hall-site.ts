// ---------------------------------------------------------------------------
// Where the Grand Hall stands on the earth, and which way it faces
//
// The hall is on the first floor of Trades Hall, 85 Glassford Street, Glasgow,
// with its five windows in the Glassford Street front. To light it with the
// real sun and moon the planner needs the site and the true bearing of its
// axes.
//
// Site: the one agreed with the relit hall and the venue sky (T-639, T-647;
// packages/api/src/lib/venue-site.ts TRADES_HALL_SITE).
//
// Bearing: the Glassford Street front fitted to the Scottish LiDAR Phase 5
// 50 cm DSM (2020): the front runs at grid bearing 12.96° (12.46–13.44°), so
// its outward normal is 102.96° grid; the meridian convergence at the site is
// −1.861°, giving 101.1° true, ±1°. OS and street-centreline checks agree to
// about a degree. (D:/claude/orbit-lookdev-20260923/spec/facade/facade.json,
// research notes 16 October 2026.) The relight tools of T-639 used 104.3°
// from an unrecorded source; the LiDAR fit is the measured one.
//
// Frame: the planner's (hall-spec.ts). The window wall is z < 0, so the
// outward normal −z points to 101.1° (east-south-east); +x points to 191.1°
// (south-south-west, along Glassford Street) and +z to 281.1°.
// ---------------------------------------------------------------------------

import type { Observer } from "../../lib/sky/ephemeris.js";

/** Trades Hall's site (TRADES_HALL_SITE in the API). */
export const HALL_OBSERVER: Observer = Object.freeze({ latitude: 55.8593, longitude: -4.2491 });

/** True bearing of the window wall's outward normal (the planner's −z), degrees. */
export const HALL_WINDOW_BEARING = 101.1;

/** True bearing of the planner's +x axis, degrees. */
const X_BEARING = HALL_WINDOW_BEARING + 90;

/**
 * The pavement of Glassford Street at the foot of the front, relative to the
 * hall's floor, metres: the arched windows' sills (0.915 m above the floor)
 * stand 4.7 m above the pavement in the LiDAR facade fit.
 */
export const HALL_PAVEMENT_Y = -3.79;

const DEG = Math.PI / 180;

/**
 * The unit vector in the hall's frame pointing toward a body at a compass
 * `bearing` and `altitude` (degrees), written into `out`.
 */
export function hallDirection(bearing: number, altitude: number, out: [number, number, number]): [number, number, number] {
  const horizontal = Math.cos(altitude * DEG);
  const angle = (bearing - X_BEARING) * DEG;
  out[0] = horizontal * Math.cos(angle);
  out[1] = Math.sin(altitude * DEG);
  out[2] = horizontal * Math.sin(angle);
  return out;
}

/** The compass bearing (degrees, [0, 360)) of a horizontal direction in the hall's frame. */
export function hallBearing(x: number, z: number): number {
  const bearing = Math.atan2(z, x) / DEG + X_BEARING;
  return ((bearing % 360) + 360) % 360;
}

const POINTS = ["north", "north-north-east", "north-east", "east-north-east", "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west", "west", "west-north-west", "north-west", "north-north-west"] as const;

/** A bearing as one of the sixteen compass points, in words ("east-south-east"). */
export function compassPoint(bearing: number): (typeof POINTS)[number] {
  const index = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[index] ?? "north";
}
