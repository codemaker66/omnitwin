import {
  GENERATED_DEVICE_DAY_BUNDLES,
  type GeneratedDeviceDayBundle,
} from "./generated/device-day-splat-bundles.js";
import { roomSplatBundle, splatBaseUrl } from "./room-splat-bundles.js";
import type { RuntimeAssetViewTransform } from "../lib/runtime-package-resolution.js";

// ---------------------------------------------------------------------------
// Device day (Wednesday 28 October 2026): timing-only Grand Hall splat cuts.
//
// Blake times each cut on his own phones, iPads and office PC on
// venviewer.com, reading p95 frame time from `?profiler=1` while the
// planner's Showcase flies its fixed path. The largest splat count that holds
// p95 <= 16.7 ms after warm-up becomes that device's budget.
//
// `/plan/<layout>?splatBundle=<id>` swaps the Grand Hall's captured layer for
// one cut. Only the ids below are honoured, and only in the room they were cut
// from: there is no way to name a URL, so production's refusal of manual
// splat URLs (`?splatUrl=`) stands. An unknown id, or one for another room,
// is ignored and the room behaves as it always does.
//
// The general production hold on Gaussian splats (lib/splat-access.ts) is the
// release lead's to lift. These cuts are exempt from it on Blake's word of
// 26 October 2026: "no hold, we are meant to be building this as a full
// release". In every non-development build the tiles come from the public R2
// bucket by absolute URL, because the app's own `/splats` path redirects to
// the work-in-progress page in production (vercel.json).
// ---------------------------------------------------------------------------

export type DeviceDayBundle = GeneratedDeviceDayBundle;

/** The query parameter that names a cut. */
export const DEVICE_DAY_QUERY_PARAM = "splatBundle";

/**
 * The public bucket every non-development build reads the cuts from: the same
 * bucket and base as the shipped tiles (`PREVIEW_SPLAT_BASE_URL` in
 * lib/production-env.ts, which the browser cannot import because it loads
 * Vite; a test holds the two equal).
 */
export const DEVICE_DAY_SPLAT_BASE_URL = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats";

/** Where the cuts sit under a splat base: `<base>/trades-hall/device-day/<id>/<file>`. */
export const DEVICE_DAY_PATH = "trades-hall/device-day";

/** The allowlisted ids, in the order the cuts were made. */
export const DEVICE_DAY_BUNDLE_IDS: readonly string[] = GENERATED_DEVICE_DAY_BUNDLES.map((bundle) => bundle.id);

/** An allowlisted cut by exact id; null for anything else. */
export function deviceDayBundleById(id: string | null | undefined): DeviceDayBundle | null {
  if (id === null || id === undefined) return null;
  return GENERATED_DEVICE_DAY_BUNDLES.find((bundle) => bundle.id === id) ?? null;
}

/** The cut a page's query names, when the name is allowlisted. */
export function requestedDeviceDayBundle(search: string): DeviceDayBundle | null {
  return deviceDayBundleById(new URLSearchParams(search).get(DEVICE_DAY_QUERY_PARAM));
}

/** The cut to draw in `roomSlug`: allowlisted, and cut from that room. */
export function deviceDayBundleForRoom(search: string, roomSlug: string | null): DeviceDayBundle | null {
  const bundle = requestedDeviceDayBundle(search);
  return bundle !== null && roomSlug !== null && bundle.roomSlug === roomSlug ? bundle : null;
}

/** The current page's query; empty outside a browser. */
export function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export interface DeviceDayEnv {
  readonly DEV: boolean;
  /** The build's configured splat base; only development consults it. */
  readonly VITE_SPLAT_BASE_URL?: string | undefined;
}

function buildEnv(): DeviceDayEnv {
  return { DEV: import.meta.env.DEV, VITE_SPLAT_BASE_URL: import.meta.env.VITE_SPLAT_BASE_URL };
}

/**
 * The splat base the cuts are read from. Development follows the configured
 * base like the shipped tiles do (empty means the dev server's `/splats`,
 * served from SPLAT_STAGING_ROOT); every other build reads the public bucket.
 */
export function deviceDayBaseUrl(env: DeviceDayEnv = buildEnv()): string {
  return env.DEV ? splatBaseUrl(env.VITE_SPLAT_BASE_URL) : DEVICE_DAY_SPLAT_BASE_URL;
}

/** The cut's tile URLs, in tile order. */
export function deviceDayTileUrls(bundle: DeviceDayBundle, env: DeviceDayEnv = buildEnv()): readonly string[] {
  const base = `${deviceDayBaseUrl(env)}/${DEVICE_DAY_PATH}/${bundle.id}`;
  return bundle.tiles.map((tile) => `${base}/${tile.file}`);
}

/**
 * Whether `url` is a tile of the cut this page asked for. The native splat
 * layer's final render boundary admits exactly these URLs past the hold, and
 * nothing a caller could name for itself.
 */
export function deviceDayTileRequested(url: string, search: string = currentSearch(), env: DeviceDayEnv = buildEnv()): boolean {
  const bundle = requestedDeviceDayBundle(search);
  return bundle !== null && deviceDayTileUrls(bundle, env).includes(url);
}

/**
 * Whether to time without the frame-rate governor. A slow device otherwise
 * gives up resolution (lib/render-governor.ts) and the p95 it shows is of a
 * smaller picture. `?governor=off` already does this in development; with an
 * allowlisted cut named it does so in any build, and nowhere else.
 */
export function deviceDayGovernorOff(search: string = currentSearch()): boolean {
  return requestedDeviceDayBundle(search) !== null && new URLSearchParams(search).get("governor") === "off";
}

/** What the planner's status line says while a cut is drawn. */
export function deviceDayRuntimeLabel(bundle: DeviceDayBundle): string {
  const millions = (bundle.totalSplats / 1_000_000).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  return `Device-day timing cut ${bundle.id} · ${millions} M splats · SH${String(bundle.shDegree)} · not a look candidate`;
}


// ---------------------------------------------------------------------------
// Where a cut is drawn: the shipped Grand Hall capture's frame.
//
// A cut arrives with L2's plannerTransform P, T-658's planner_from_json. P
// puts the cut in the drawn hall's frame (components/grand-hall/hall-spec.ts):
// origin at the centre of the floor, y up, x along the hall (fireplace < 0),
// z across it (window wall < 0).
//
// The planner's captured layer does not use that frame. The shipped GH_2
// tiles are drawn under their own bundle transform T (rotation [-pi/2, 0, 0]),
// which leaves the hall centred with x ACROSS it and z ALONG it, and every
// capture-mode camera is authored there: the arrival (GRAND_HALL_ARRIVAL), the
// walk bounds and Showcase's glide (lib/planner-showcase.ts). A cut must stand
// where the shipped capture stands, or those cameras would look at it from
// outside its walls.
//
// So a cut is drawn at S * P, where S takes the hall-spec frame to the
// shipped capture's frame. S follows from the reference below: the panorama
// model the cuts come from was trained in the shipped tiles' own frame
// (pano-splat build_dataset.py, "Output frame: HallFrame (metres, z up) =
// native frame of the vendor splat tiles"), and T-658 measured that frame's P
// to the hall. A point in that frame is at P * v in the hall and at T * v in
// the capture, so
//
//   S = T * P_ref^-1,  and a cut drawn at S * P_ref stands exactly at T.
//
// S is a quarter turn about y (+90.96 degrees: x along the hall becomes z),
// T-658's 0.24-degree level correction, and an offset of (+0.46, 0.00,
// +0.05) m. Checked against the bytes rather than the paperwork, by decoding
// both captures' SOG tiles as native-splat-sog.ts does (l2-2m, 2.0 M splats,
// against the shipped finest level, 6.0 M; scripts and results in
// D:/claude/device-day-20261028/switch-proof):
//
// - A blind registration from P alone (yaw and floor-plan offset searched,
//   nothing taken from T) lands on S's yaw to 0.04 degrees (+91.0) and its
//   offset to 1.6 cm (0.45, -0.01, 0.04); it searched no tilt. The quarter
//   turn's sign is settled by the wall elevations (windows, doors, fireplace,
//   pilasters), which correlate 1.48 summed over four walls for +90 against
//   1.02, 0.64 and 0.54 for -90 and the two mirrors, and by colour (luminance
//   of paired splats 0.43 against 0.20 for -90).
// - Drawn at S * P, 78.5% of the cut's opaque splats inside the room lie
//   within 5 cm of a shipped splat (97.1% within 10 cm, median 2.5 cm).
// - The hall's walls land on the shipped capture's measured planes, its floor
//   at y = 0 and its long axis along z (device-day-splat-bundles.test.ts).
// ---------------------------------------------------------------------------

export interface RigidPlacement {
  readonly position: readonly [number, number, number];
  /** three.js Euler order "XYZ", radians. */
  readonly rotation: readonly [number, number, number];
}

/** T-658's planner_from_json for the shipped tiles' frame (every cut's plannerTransform). */
export const PLANNER_FROM_SHIPPED_TILES: RigidPlacement = {
  position: [8.539502995813681, 2.2591773724935433, 4.598301677239281],
  rotation: [-1.570712744423652, -0.004209191595129369, -1.587598973761236],
};

type Vector3 = readonly [number, number, number];
type Matrix3 = readonly [Vector3, Vector3, Vector3];

/** three.js Euler order "XYZ": R = Rx(a) * Ry(b) * Rz(c). */
export function matrixFromEulerXyz([a, b, c]: Vector3): Matrix3 {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** Euler XYZ of a rotation matrix, as three's Euler.setFromRotationMatrix. */
export function eulerXyzFromMatrix(m: Matrix3): [number, number, number] {
  const m13 = m[0][2];
  const b = Math.asin(Math.min(Math.max(m13, -1), 1));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), b, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), b, 0];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const cell = (row: 0 | 1 | 2, col: 0 | 1 | 2): number => a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ];
}

function transpose(m: Matrix3): Matrix3 {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}

function apply(m: Matrix3, [x, y, z]: Vector3): [number, number, number] {
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z,
  ];
}

interface Rigid { readonly r: Matrix3; readonly t: Vector3 }

function rigid(placement: RigidPlacement): Rigid {
  return { r: matrixFromEulerXyz(placement.rotation), t: placement.position };
}

function compose(a: Rigid, b: Rigid): Rigid {
  const t = apply(a.r, b.t);
  return { r: multiply(a.r, b.r), t: [t[0] + a.t[0], t[1] + a.t[1], t[2] + a.t[2]] };
}

function invert(a: Rigid): Rigid {
  const r = transpose(a.r);
  const t = apply(r, a.t);
  return { r, t: [-t[0], -t[1], -t[2]] };
}

/**
 * S: the hall-spec frame to the shipped capture's frame, as T * P_ref^-1.
 * Null for a room without a shipped capture to stand in.
 */
export function servedFromHallPlacement(roomSlug: string): { readonly rotation: Matrix3; readonly position: Vector3 } | null {
  const shipped = roomSplatBundle(roomSlug);
  if (shipped === null) return null;
  const s = compose(rigid(shipped.transform), invert(rigid(PLANNER_FROM_SHIPPED_TILES)));
  return { rotation: s.r, position: s.t };
}

/** A hall-spec point in the shipped capture's frame. */
export function servedFromHall(roomSlug: string, point: Vector3): [number, number, number] | null {
  const s = servedFromHallPlacement(roomSlug);
  if (s === null) return null;
  const p = apply(s.rotation, point);
  return [p[0] + s.position[0], p[1] + s.position[1], p[2] + s.position[2]];
}

/** The cut's transform in the shipped capture's frame: S * P. Null without one. */
export function deviceDayViewTransform(bundle: DeviceDayBundle): RuntimeAssetViewTransform | null {
  const s = servedFromHallPlacement(bundle.roomSlug);
  if (s === null) return null;
  const placed = compose({ r: s.rotation, t: s.position }, rigid(bundle.plannerTransform));
  return {
    position: placed.t,
    rotation: eulerXyzFromMatrix(placed.r),
    scale: 1,
    note: `Device-day timing cut ${bundle.id}, a timing-only cut: L2's planner_from_json taken into the shipped `
      + "Grand Hall capture's frame (T * P_ref^-1), checked against the shipped tiles.",
  };
}
