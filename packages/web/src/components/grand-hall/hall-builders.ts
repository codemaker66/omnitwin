// ---------------------------------------------------------------------------
// HallBuilders — one MeshBuilder per room material, each baking light
//
// The room is assembled part by part into per-material builders. Every vertex
// stores its precomputed light (ambient occlusion, chandelier, daylight,
// uplight) as a vec4 `aLight`, sampled from the hall's light model with the
// role of the part being built (floor, wall, ceiling, dome, detail); the wall
// it belongs to (`aWall`, for the cutaway); and, on walls, its texel in the
// scan's wall atlas (`aAtlas`).
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { MeshBuilder } from "./mesh-builder.js";
import { sampleHallLight, type HallSurfaceRole } from "./hall-lighting-model.js";
import { atlasUvForPoint } from "./hall-atlas.js";

export const HALL_MATERIAL_KEYS = [
  "floor",
  // Surfaces coloured by the scan's photographs.
  "wallPhoto",
  "wallPhotoGloss",
  "ceilingPhoto",
  "domePhoto",
  // Painted surfaces the photographs cannot see.
  "mahoganyDark",
  "gilt",
  "brass",
] as const;

export type HallMaterialKey = (typeof HALL_MATERIAL_KEYS)[number];

export interface HallGeometryStats {
  readonly vertices: number;
  readonly triangles: number;
  readonly parts: number;
}

export class HallBuilders {
  private readonly builders = new Map<HallMaterialKey, MeshBuilder>();
  /** The role used for light sampling of vertices emitted next. */
  role: HallSurfaceRole = "detail";
  /** Index of the wall the next vertices belong to (-1: floor, ceiling, dome). */
  wall = -1;

  get(key: HallMaterialKey): MeshBuilder {
    let builder = this.builders.get(key);
    if (builder === undefined) {
      builder = new MeshBuilder({
        extraSize: 7,
        extraLayout: [{ name: "aLight", size: 4 }, { name: "aWall", size: 1 }, { name: "aAtlas", size: 2 }],
        extra: (position, normal) => {
          // Wall vertices find their texel in the wall atlas by projection
          // onto their wall; everything else carries no atlas coordinate.
          const [atlasU, atlasV] = this.wall >= 0 && this.wall < 4 ? atlasUvForPoint(this.wall, position) : [-1, -1];
          const sample = sampleHallLight(position, normal, this.role);
          return [sample.ao, sample.chandelier, sample.daylight, sample.uplight, this.wall, atlasU, atlasV];
        },
      });
      this.builders.set(key, builder);
    }
    return builder;
  }

  /** Runs `emit` with every vertex it creates tagged as part of wall `index`. */
  onWall(index: number, emit: () => void): void {
    const previous = this.wall;
    this.wall = index;
    try { emit(); } finally { this.wall = previous; }
  }

  /** Runs `emit` with a role set for every vertex it creates. */
  withRole(role: HallSurfaceRole, emit: () => void): void {
    const previous = this.role;
    this.role = role;
    try { emit(); } finally { this.role = previous; }
  }

  build(): { geometries: Map<HallMaterialKey, BufferGeometry>; stats: HallGeometryStats } {
    const geometries = new Map<HallMaterialKey, BufferGeometry>();
    let vertices = 0;
    let triangles = 0;
    for (const key of HALL_MATERIAL_KEYS) {
      const builder = this.builders.get(key);
      if (builder === undefined || builder.vertices === 0) continue;
      vertices += builder.vertices;
      triangles += builder.triangles;
      geometries.set(key, builder.build());
    }
    return { geometries, stats: { vertices, triangles, parts: geometries.size } };
  }
}
