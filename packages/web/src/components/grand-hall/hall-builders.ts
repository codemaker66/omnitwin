// ---------------------------------------------------------------------------
// HallBuilders — one MeshBuilder per room material, each baking light
//
// The room is assembled part by part into per-material builders. Every vertex
// stores its precomputed light (ambient occlusion, chandelier, daylight,
// uplight) as a vec4 `aLight`, sampled from the hall's light model with the
// role of the part being built (floor, wall, ceiling, dome, detail); the wall
// it belongs to (`aWall`, for the cutaway) and, for relief that stands in a
// corner against the neighbouring wall, that wall too (`aWallB`, -1 for none:
// the cutaway cuts it at the lower of the two walls' cuts); on walls, its
// texel in the scan's wall atlas (`aAtlas`); and the window or door whose
// clear outline it lies in (`aOpening`, its index in HALL_OPENINGS, -1 for
// none), set as the walls are built. The doors' leaves (hall-doors.ts) also
// carry the hinge they turn about (`aHinge`, built with `{ hinge: true }`).
// ---------------------------------------------------------------------------

import type { BufferGeometry } from "three";
import { MeshBuilder, type V3 } from "./mesh-builder.js";
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
  // The windows' painted glazing bars and outer reveals (hall-glazing.ts).
  "paint",
] as const;

export type HallMaterialKey = (typeof HALL_MATERIAL_KEYS)[number];

export interface HallGeometryStats {
  readonly vertices: number;
  readonly triangles: number;
  readonly parts: number;
}

/**
 * The hinge a door leaf's vertices turn about (hall-doors.ts): the axis's
 * plan position, the sense the leaf opens in (+1 or -1 about +y) and a code
 * (its door's index in HALL_DOORS, plus LEAF_CAP_CODE for the section a cut
 * lays on the leaf, plus LEAF_LAG_CODE on the lapping leaf of a pair).
 */
export interface HallHinge {
  readonly x: number;
  readonly z: number;
  readonly sense: 1 | -1;
  readonly code: number;
}

export interface HallBuildersOptions {
  /** Every vertex also carries `aHinge` (vec4: x, z, sense, code), set by withHinge. */
  readonly hinge?: boolean;
}

export class HallBuilders {
  private readonly builders = new Map<HallMaterialKey, MeshBuilder>();
  private readonly withHinges: boolean;
  /** The role used for light sampling of vertices emitted next. */
  role: HallSurfaceRole = "detail";
  /** Index of the wall the next vertices belong to (-1: floor, ceiling, dome). */
  wall = -1;
  /** Index of a neighbouring wall whose cut the next vertices also take (-1: none). */
  wallB = -1;
  /** Index in HALL_OPENINGS of the window or door the next vertices lie in (-1: none). */
  opening = -1;
  /** The hinge the next vertices turn about (only with `{ hinge: true }`). */
  hinge: HallHinge = { x: 0, z: 0, sense: 1, code: -1 };
  /** Scales the next vertices' baked occlusion by their position (a modelled panel's sunk margin, hall-doors.ts). */
  occlusion: ((position: V3) => number) | null = null;

  constructor(options: HallBuildersOptions = {}) {
    this.withHinges = options.hinge ?? false;
  }

  get(key: HallMaterialKey): MeshBuilder {
    let builder = this.builders.get(key);
    if (builder === undefined) {
      const layout = [
        { name: "aLight", size: 4 }, { name: "aWall", size: 1 }, { name: "aAtlas", size: 2 }, { name: "aWallB", size: 1 }, { name: "aOpening", size: 1 },
        ...(this.withHinges ? [{ name: "aHinge", size: 4 }] : []),
      ];
      builder = new MeshBuilder({
        extraSize: layout.reduce((sum, entry) => sum + entry.size, 0),
        extraLayout: layout,
        extra: (position, normal) => {
          // Wall vertices find their texel in the wall atlas by projection
          // onto their wall; everything else carries no atlas coordinate.
          const [atlasU, atlasV] = this.wall >= 0 && this.wall < 4 ? atlasUvForPoint(this.wall, position) : [-1, -1];
          const sample = sampleHallLight(position, normal, this.role);
          const ao = sample.ao * (this.occlusion === null ? 1 : this.occlusion(position));
          const base = [ao, sample.chandelier, sample.daylight, sample.uplight, this.wall, atlasU, atlasV, this.wallB, this.opening];
          return this.withHinges ? [...base, this.hinge.x, this.hinge.z, this.hinge.sense, this.hinge.code] : base;
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

  /** Runs `emit` with every vertex it creates also taking wall `index`'s cut. */
  withNeighbour(index: number, emit: () => void): void {
    const previous = this.wallB;
    this.wallB = index;
    try { emit(); } finally { this.wallB = previous; }
  }

  /** Runs `emit` with every vertex it creates tagged as lying in opening `index` (HALL_OPENINGS). */
  withOpening(index: number, emit: () => void): void {
    const previous = this.opening;
    this.opening = index;
    try { emit(); } finally { this.opening = previous; }
  }

  /** Runs `emit` with every vertex it creates taking `occlusion` of its baked light's occlusion. */
  withOcclusion(occlusion: (position: V3) => number, emit: () => void): void {
    const previous = this.occlusion;
    this.occlusion = occlusion;
    try { emit(); } finally { this.occlusion = previous; }
  }

  /** Runs `emit` with every vertex it creates turning about `hinge`. */
  withHinge(hinge: HallHinge, emit: () => void): void {
    const previous = this.hinge;
    this.hinge = hinge;
    try { emit(); } finally { this.hinge = previous; }
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
