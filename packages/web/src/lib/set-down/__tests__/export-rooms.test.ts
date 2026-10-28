// Exports the rooms the offline ray tracer traces to
// tools/set-down-acoustics/rooms.json (T-677, Task 7). Skipped unless EXPORT=1:
//   EXPORT=1 pnpm exec vitest run src/lib/set-down/__tests__/export-rooms.test.ts
// It lives here, not under tools/, because packages/web's vitest only includes
// src/**.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AIR_ATTENUATION_PER_M, SURFACE_ABSORPTION, type SurfaceMaterialId } from "../acoustic-data.js";
import { OCTAVE_BANDS_HZ, type BandValues } from "../bands.js";
import { reverberationTimes } from "../room-acoustics.js";
import { ROOM_ACOUSTICS, ROOM_PLANS, UNCALIBRATED, domeGeometry, type RoomAcoustics, type RoomSlug } from "../rooms.js";
import { DRESSINGS, TRACED_ROOMS, TRACER_DIR, dressingContents, dressingItems, type Dressing } from "./tracer-results.js";

/** Where a surface's absorption goes on the tracer's prism. */
type PrismPart = "floor" | "ceiling" | "dome" | "walls";

/**
 * Fabric hung in front of a wall. The model counts it on top of the wall's own
 * area, so it is left out of the walls' extent when a prism is sized to them.
 */
const HUNG_FABRICS: ReadonlySet<SurfaceMaterialId> = new Set(["velour-drape", "sheer-curtain"]);

interface Prism {
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly rule: string;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function areaOf(room: RoomAcoustics, keep: (surface: RoomAcoustics["surfaces"][number]) => boolean): number {
  return sum(room.surfaces.filter(keep).map((surface) => surface.areaM2));
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
function tracerPrism(slug: RoomSlug, room: RoomAcoustics, domeVolumeM3: number): Prism {
  const floorArea = areaOf(room, (surface) => surface.role === "floor");
  const heightM = (room.volumeM3 - domeVolumeM3) / floorArea;
  const plan = ROOM_PLANS[slug];
  if (Math.abs(plan.lengthM * plan.widthM - floorArea) <= 1e-9 * floorArea) {
    return { lengthM: plan.lengthM, widthM: plan.widthM, heightM, rule: "the plan rectangle (ROOM_PLANS)" };
  }
  const wallArea = areaOf(
    room,
    (surface) => (surface.role === "wall" || surface.role === "opening") && !HUNG_FABRICS.has(surface.material),
  );
  const halfPerimeter = wallArea / heightM / 2;
  const spread = Math.sqrt(halfPerimeter * halfPerimeter - 4 * floorArea);
  return {
    lengthM: (halfPerimeter + spread) / 2,
    widthM: (halfPerimeter - spread) / 2,
    heightM,
    rule: "the rectangle of the floor's area and the walls' perimeter (a two-part room)",
  };
}

function partOf(surface: RoomAcoustics["surfaces"][number], domeSurfaceM2: number | null): PrismPart {
  if (surface.role === "floor") return "floor";
  if (surface.role === "ceiling") return surface.areaM2 === domeSurfaceM2 ? "dome" : "ceiling";
  return "walls";
}

function exportRoom(slug: RoomSlug): Record<string, unknown> {
  const room = ROOM_ACOUSTICS[slug];
  const dome = slug === "grand-hall" ? domeGeometry() : null;
  const prism = tracerPrism(slug, room, dome?.volumeM3 ?? 0);
  const uncalibrated: RoomAcoustics = { ...room, calibration: UNCALIBRATED };
  const contents = (dressing: Dressing): BandValues => dressingContents(slug, dressing);
  return {
    volumeM3: room.volumeM3,
    plan: ROOM_PLANS[slug],
    floorAreaM2: areaOf(room, (surface) => surface.role === "floor"),
    prism,
    surfaces: room.surfaces.map((surface) => ({
      material: surface.material,
      role: surface.role,
      part: partOf(surface, dome?.surfaceM2 ?? null),
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

describe("the ray tracer's rooms", () => {
  it.skipIf(process.env["EXPORT"] !== "1")("exports every room to tools/set-down-acoustics/rooms.json", () => {
    const rooms = Object.fromEntries(TRACED_ROOMS.map((slug) => [slug, exportRoom(slug)]));
    for (const slug of TRACED_ROOMS) {
      const room = ROOM_ACOUSTICS[slug];
      const dome = slug === "grand-hall" ? domeGeometry() : null;
      const prism = tracerPrism(slug, room, dome?.volumeM3 ?? 0);
      // The prism keeps the model's volume, floor and walls.
      const prismVolume = prism.lengthM * prism.widthM * prism.heightM + (dome?.volumeM3 ?? 0);
      expect(prismVolume).toBeCloseTo(room.volumeM3, 6);
      expect(prism.lengthM * prism.widthM).toBeCloseTo(areaOf(room, (surface) => surface.role === "floor"), 6);
      const walls = areaOf(
        room,
        (surface) => (surface.role === "wall" || surface.role === "opening") && !HUNG_FABRICS.has(surface.material),
      );
      expect(2 * (prism.lengthM + prism.widthM) * prism.heightM).toBeCloseTo(walls, 6);
      const domes = room.surfaces.filter((surface) => partOf(surface, dome?.surfaceM2 ?? null) === "dome");
      expect(domes).toHaveLength(dome === null ? 0 : 1);
    }
    const file = {
      note: "Exported from packages/web/src/lib/set-down (rooms.ts, room-acoustics.ts) by __tests__/export-rooms.test.ts with EXPORT=1; read by raytrace.py. Areas m2, volumes m3, times s; alpha and contents per octave band.",
      bandsHz: OCTAVE_BANDS_HZ,
      airAttenuationPerM: AIR_ATTENUATION_PER_M,
      rooms,
    };
    writeFileSync(resolve(TRACER_DIR, "rooms.json"), `${JSON.stringify(file, null, 2)}\n`);
  });
});
