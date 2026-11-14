// ---------------------------------------------------------------------------
// The rooms as the offline ray tracer reads them (T-700, Task 7):
// tools/set-down-acoustics/rooms.json, built from rooms.ts and
// room-acoustics.ts. export-rooms.test.ts writes it (EXPORT=1) and, on every
// run, checks that the committed file still equals this export, so the trace
// cannot drift from the model it calibrates (ruling R38).
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { AIR_ATTENUATION_PER_M, SURFACE_ABSORPTION, type SurfaceMaterialId } from "../acoustic-data.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../bands.js";
import { reverberationTimes } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, ROOM_PLANS, UNCALIBRATED, domeGeometry, type RoomAcoustics, type RoomSlug } from "../rooms.js";
import { DRESSINGS, TRACED_ROOMS, TRACER_DIR, dressingContents, dressingItems, type Dressing } from "./tracer-results.js";

/** The committed export the tracer read. */
export const ROOMS_JSON = resolve(TRACER_DIR, "rooms.json");

/** Where a surface's absorption goes on the tracer's prism. */
export type PrismPart = "floor" | "ceiling" | "dome" | "walls";

type Surface = RoomAcoustics["surfaces"][number];

/**
 * Fabric hung in front of a wall. The model counts it on top of the wall's own
 * area, so it is left out of the walls' extent when a prism is sized to them.
 */
export const HUNG_FABRICS: ReadonlySet<SurfaceMaterialId> = new Set(["velour-drape", "sheer-curtain"]);

export interface Prism {
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly rule: string;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function areaOf(room: RoomAcoustics, keep: (surface: Surface) => boolean): number {
  return sum(room.surfaces.filter(keep).map((surface) => surface.areaM2));
}

/** The walls' extent: every wall and opening surface except hung fabric. */
export function wallExtentM2(room: RoomAcoustics): number {
  return areaOf(
    room,
    (surface) => (surface.role === "wall" || surface.role === "opening") && !HUNG_FABRICS.has(surface.material),
  );
}

/** The dome above the ceiling plane, for the one room that has one. */
export function tracedDome(slug: RoomSlug): ReturnType<typeof domeGeometry> | null {
  return slug === "grand-hall" ? domeGeometry() : null;
}

/**
 * The prism the tracer stands in for the room. Its height is the volume
 * (less the Grand Hall's dome) over the floor's area, so the prism keeps the
 * model's volume exactly. A room whose plan rectangle (ROOM_PLANS) is its
 * whole floor keeps that rectangle. The two-part rooms' plans hold only their
 * main part (the Robert Adam Room's lower section, the Reception Room's wide
 * arm), so each becomes the rectangle with its floor's area and its walls'
 * perimeter: volume, floor, ceiling and wall areas all stay the model's.
 */
export function tracerPrism(slug: RoomSlug): Prism {
  const room = ROOM_ACOUSTICS[slug];
  const floorArea = areaOf(room, (surface) => surface.role === "floor");
  const heightM = (room.volumeM3 - (tracedDome(slug)?.volumeM3 ?? 0)) / floorArea;
  const plan = ROOM_PLANS[slug];
  if (Math.abs(plan.lengthM * plan.widthM - floorArea) <= 1e-9 * floorArea) {
    return { lengthM: plan.lengthM, widthM: plan.widthM, heightM, rule: "the plan rectangle (ROOM_PLANS)" };
  }
  const halfPerimeter = wallExtentM2(room) / heightM / 2;
  const spread = Math.sqrt(halfPerimeter * halfPerimeter - 4 * floorArea);
  return {
    lengthM: (halfPerimeter + spread) / 2,
    widthM: (halfPerimeter - spread) / 2,
    heightM,
    rule: "the rectangle of the floor's area and the walls' perimeter (a two-part room)",
  };
}

/** The prism part a surface's absorption goes on, by its role and, in a domed room, the dome's own marker (rooms.ts). */
export function partOf(surface: Surface, hasDome: boolean): PrismPart {
  if (surface.role === "floor") return "floor";
  if (surface.role === "ceiling") return hasDome && surface.dome === true ? "dome" : "ceiling";
  return "walls";
}

function exportRoom(slug: RoomSlug): Record<string, unknown> {
  const room = ROOM_ACOUSTICS[slug];
  const dome = tracedDome(slug);
  const uncalibrated: RoomAcoustics = { ...room, calibration: UNCALIBRATED };
  const contents = (dressing: Dressing): BandValues => dressingContents(slug, dressing);
  return {
    volumeM3: room.volumeM3,
    plan: ROOM_PLANS[slug],
    floorAreaM2: areaOf(room, (surface) => surface.role === "floor"),
    prism: tracerPrism(slug),
    surfaces: room.surfaces.map((surface) => ({
      material: surface.material,
      role: surface.role,
      part: partOf(surface, dome !== null),
      areaM2: surface.areaM2,
      alpha: SURFACE_ABSORPTION[surface.material],
    })),
    dome,
    contents: { half: contents("half"), dressed: contents("dressed") },
    items: { half: dressingItems(slug, "half").length, dressed: dressingItems(slug, "dressed").length },
    eyringUncalibrated: Object.fromEntries(
      DRESSINGS.map((dressing) => [dressing, reverberationTimes(uncalibrated, contents(dressing))]),
    ),
  };
}

/** rooms.json's content, as the model stands now. */
export function tracerRoomsFile(): Record<string, unknown> {
  return {
    note: "Exported from packages/web/src/lib/set-down (rooms.ts, room-acoustics.ts) by __tests__/export-rooms.test.ts with EXPORT=1; read by raytrace.py. Areas m2, volumes m3, times s; alpha and contents per octave band.",
    bandsHz: OCTAVE_BANDS_HZ,
    airAttenuationPerM: AIR_ATTENUATION_PER_M,
    rooms: Object.fromEntries(TRACED_ROOMS.map((slug) => [slug, exportRoom(slug)])),
  };
}
