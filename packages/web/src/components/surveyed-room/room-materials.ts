// ---------------------------------------------------------------------------
// Materials for a surveyed room
//
// Version 1 shows a room's photographs as they were taken. They already hold
// the light of the day of the scan, so nothing here lights them: each surface
// is unlit, its photograph times a grade the caller sets.
//
//   exposure  one number over the room, 1 as photographed
//   tint      a colour over the room, white as photographed
//   glow      what the walls' glass is multiplied by instead of exposure and
//             tint: the atlas's alpha marks glass (255 - 127 x glass), and
//             glass lit from behind (the Saloon's stained windows) does not
//             follow the room's light, so a mood that dims the room leaves
//             its windows as bright as `glow` says
//
// The elevations and the ceiling were photographed straight on, so a face
// they saw edge-on (the side of a doorcase or a coffer) would stretch one row
// of texels into streaks. Such faces take the photograph's local average
// instead, a coarser mip, as the Grand Hall's walls do (hall-materials.ts
// wallTexel): 2.5 levels for a face square to the photograph's line of sight,
// 4 for one turned up or down. One sample either way.
//
// Rules these materials keep for the planner's pipeline:
//
//   - Front faces only. A wall is seen from inside the room and not from
//     outside it, which is what lets an orbiting camera look in.
//   - No outputs of their own (`mrtNode`). They are opaque surfaces, and the
//     scene pass's own outputs are right for them as they are for the Grand
//     Hall's photographed walls, which set none either: the view normal with
//     an occlusion weight of 1, and their motion
//     (scene/PlannerRenderPipeline.tsx plannerSceneOutputs). The geometry
//     carries normals for that. Outputs of a material's own are for what the
//     pass's would be wrong for (a pane, a light), and go through
//     lib/target-safe-mrt.ts.
//   - Nothing of a room in the shader. Every room's materials are built from
//     the same nodes, with the room in attributes, uniforms and textures, so
//     they compile to the same shader text and share its pipelines, which
//     the planner keeps for the renderer's life (lib/pipeline-retention.ts).
//   - The normal is never read in the colour: in an unlit material that put
//     the pass's normal target out of step (hall-materials.ts cardLeafColour).
//     A face's direction comes from its position's screen derivatives.
// ---------------------------------------------------------------------------

import { Color, FrontSide, type ColorRepresentation } from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { attribute, float, mix, positionWorld, smoothstep, uniform, uv } from "three/tsl";
import type { RoomPhotos } from "./room-photos.js";

/** A grade as numbers: what RoomGradeUniforms.set takes. */
export interface RoomGrade {
  /** The room's photographs times this; 1 as photographed. */
  readonly exposure?: number;
  /** A colour over the room; white as photographed. */
  readonly tint?: ColorRepresentation;
  /** The walls' glass times this, whatever the exposure and tint; 1 as photographed. */
  readonly glow?: number;
}

/** The uniforms every surface of one room reads. */
export class RoomGradeUniforms {
  readonly exposure = uniform(1);
  readonly tint = uniform(new Color(1, 1, 1));
  readonly glow = uniform(1);

  /** Sets what is given and leaves the rest as it is. */
  set(grade: RoomGrade): void {
    if (grade.exposure !== undefined) this.exposure.value = grade.exposure;
    if (grade.tint !== undefined) this.tint.value.set(grade.tint);
    if (grade.glow !== undefined) this.glow.value = grade.glow;
  }
}

/**
 * How far the atlas's alpha says a texel is glass, 0 to 1: the tools write
 * alpha as 255 - 127 x glass.
 */
export const GLASS_ALPHA_SCALE = 255 / 127;

/** Mip levels coarser that a face takes where its photograph saw it edge-on. */
export const EDGE_ON_LEVELS = { upright: 2.5, level: 4 } as const;

/** The direction a fragment's face looks, either way round, from its position's screen derivatives. */
function faceDirection(): Node<"vec3"> {
  return positionWorld.dFdx().cross(positionWorld.dFdy()).normalize();
}

/**
 * 1 where a face looks along the line its photograph was taken on, easing to
 * 0 where the photograph saw it edge-on. `along` is the cosine between them.
 */
function seenFaceOn(along: Node<"float">): Node<"float"> {
  return smoothstep(0.18, 0.42, along.abs());
}

export interface RoomMaterials {
  readonly walls: MeshBasicNodeMaterial;
  readonly ceiling: MeshBasicNodeMaterial;
  readonly floor: MeshBasicNodeMaterial;
}

function unlit(name: string): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false });
  material.name = name;
  return material;
}

/**
 * The three materials of a surveyed room, sampling `photos` and graded by
 * `grade`. The walls' geometry carries its atlas coordinates as `uv` and each
 * vertex's own wall's normal as `aWallNormal` (x, z); the ceiling's and the
 * floor's carry their photograph's coordinates as `uv`.
 */
export function createRoomMaterials(photos: RoomPhotos, grade: RoomGradeUniforms): RoomMaterials {
  const room = (photographed: Node<"vec3">): Node<"vec3"> => photographed.mul(grade.tint).mul(grade.exposure);

  const walls = unlit("surveyed-room-walls");
  {
    const face = faceDirection();
    const wallNormal = attribute("aWallNormal", "vec2");
    const faceOn = seenFaceOn(face.x.mul(wallNormal.x).add(face.z.mul(wallNormal.y)));
    // A shelf's top or a head's underside lies along the photograph's line of
    // sight across its whole depth: a wider average than an upright side takes.
    const turnedLevel = smoothstep(0.55, 0.8, face.y.abs());
    const coarser = mix(mix(float(EDGE_ON_LEVELS.upright), float(EDGE_ON_LEVELS.level), turnedLevel), float(0), faceOn);
    const texel = photos.sample("walls", uv()).bias(coarser);
    const glass = float(1).sub(texel.a).mul(GLASS_ALPHA_SCALE).clamp(0, 1);
    walls.colorNode = mix(room(texel.rgb), texel.rgb.mul(grade.glow), glass);
  }

  const ceiling = unlit("surveyed-room-ceiling");
  {
    // Photographed from below, straight up: a coffer's sides are what it saw edge-on.
    const faceOn = seenFaceOn(faceDirection().y);
    const texel = photos.sample("ceiling", uv()).bias(mix(float(EDGE_ON_LEVELS.upright), float(0), faceOn));
    ceiling.colorNode = room(texel.rgb);
  }

  const floor = unlit("surveyed-room-floor");
  floor.colorNode = room(photos.sample("floor", uv()).rgb);

  return { walls, ceiling, floor };
}

export function disposeRoomMaterials(materials: RoomMaterials): void {
  materials.walls.dispose();
  materials.ceiling.dispose();
  materials.floor.dispose();
}
