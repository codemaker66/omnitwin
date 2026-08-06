import { Vector2, Vector3, type Material, type WebGLProgramParametersWithUniforms } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import { e57PointToThree } from "./twin-basis.js";

// -----------------------------------------------------------------------------
// dollhouse-occlusion — the Baldur's-Gate view-dependent peel.
//
// The vertical cutaway plane (dollhouse-cutaway.ts) handles side-on views but
// must stay inert above ~32° elevation, which leaves torn wall crowns and
// curtains hanging between an elevated camera and the room the visitor is
// standing in. This module hides exactly those fragments at RENDER time: a
// soft cylinder is carved along the camera → current-node ray, and any mesh
// fragment inside it that is (a) nearer to the camera than the current node,
// (b) above floor-keep height, and (c) within the focused room's radius is
// dissolved with a 4×4 Bayer screen-door dither. No alpha blending — depth
// order stays exact across the 144 atlas chunks — and no mesh surgery: the
// asset remains truthful (the 2026-07-17 hand-cut incident is why).
//
// Geometry self-gates by construction: from a top-down orbit almost no
// geometry lies between the camera and the focus point, so the peel vanishes
// exactly where the open-top scan already reveals the rooms.
// -----------------------------------------------------------------------------

/** Peel window bounds (metres): the soft cylinder's radius is derived from
 *  the focused room's node spread, clamped to stay a window — never a
 *  building-wide demolition. */
export const PEEL_RADIUS_MIN_M = 2.5;
/** Must swallow the largest room's near wall whole: the Grand Hall's node
 *  spread reaches ~11 m, and a cap below that parks the dither edge mid-room
 *  (the speckle-on-interior-walls report, 2026-07-17). */
export const PEEL_RADIUS_MAX_M = 14;
/** Added beyond the farthest same-room node so walls at the room boundary
 *  (the very fragments that obscure) fall inside the window. */
export const PEEL_RADIUS_MARGIN_M = 1.2;
/** Same-floor fallback reach when the current node has no roomSlug tag. */
export const PEEL_FLOOR_FALLBACK_REACH_M = 9;
/** Scan nodes sit at tripod height; keep everything below node − offset so
 *  floors and skirtings survive the peel. */
export const PEEL_KEEP_BELOW_OFFSET_M = 1.2;
/** Vertical feather above keep height (hard edges read as bugs). */
export const PEEL_HEIGHT_FEATHER_M = 0.35;
/** Stop peeling this far in front of the focus — the focused room's own far
 *  content must never dissolve. */
export const PEEL_AXIAL_MARGIN_M = 0.75;
/** Soft edge width for the cylinder wall and the axial cutoff. */
export const PEEL_FADE_M = 0.9;

/** Nodes stand a stride inside their walls; the footprint ends just SHORT of
 *  the wall faces so boundary walls fall OUTSIDE it (and can peel) while
 *  interior partitions stay INSIDE (and never can). */
export const PEEL_FOOTPRINT_MARGIN_M = 0.6;

export interface RoomFocus {
  /** Focus point in three.js world space (the current node's position). */
  readonly center: readonly [number, number, number];
  /** Peel cylinder radius (metres). */
  readonly radiusM: number;
  /** World Y below which the peel never bites (floor preservation). */
  readonly keepBelowY: number;
  /** Horizontal centre of the focused room's node footprint (world x, z). */
  readonly footprintCenter: readonly [number, number];
  /** Footprint half-extents (world x, z) — node spread + margin. Fragments
   *  inside this box are the room's own fabric and NEVER dissolve; only
   *  geometry beyond its camera-facing boundary may peel. */
  readonly footprintHalf: readonly [number, number];
}

/**
 * Derive the peel focus from the node the walk is standing on. Peers sharing
 * the node's roomSlug size the window; untagged nodes fall back to same-floor
 * neighbours within a fixed reach. Returns null when the current node is
 * unknown — callers then hold the peel at zero strength.
 */
export function computeRoomFocus(
  nodes: readonly TwinScanNode[],
  currentId: string,
): RoomFocus | null {
  const current = nodes.find((node) => node.id === currentId);
  if (current === undefined) {
    return null;
  }
  const center = e57PointToThree(current.pose.t);
  const peers = nodes.filter((node) => {
    if (node.id === current.id) {
      return false;
    }
    if (current.roomSlug !== null) {
      return node.roomSlug === current.roomSlug;
    }
    if (node.floor !== current.floor) {
      return false;
    }
    const position = e57PointToThree(node.pose.t);
    return (
      Math.hypot(position[0] - center[0], position[2] - center[2]) <=
      PEEL_FLOOR_FALLBACK_REACH_M
    );
  });
  let reach = 0;
  let minX = center[0];
  let maxX = center[0];
  let minZ = center[2];
  let maxZ = center[2];
  for (const peer of peers) {
    const position = e57PointToThree(peer.pose.t);
    reach = Math.max(
      reach,
      Math.hypot(position[0] - center[0], position[2] - center[2]),
    );
    minX = Math.min(minX, position[0]);
    maxX = Math.max(maxX, position[0]);
    minZ = Math.min(minZ, position[2]);
    maxZ = Math.max(maxZ, position[2]);
  }
  const radiusM = Math.min(
    PEEL_RADIUS_MAX_M,
    Math.max(PEEL_RADIUS_MIN_M, reach + PEEL_RADIUS_MARGIN_M),
  );
  return {
    center,
    radiusM,
    keepBelowY: center[1] - PEEL_KEEP_BELOW_OFFSET_M,
    footprintCenter: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    footprintHalf: [
      (maxX - minX) / 2 + PEEL_FOOTPRINT_MARGIN_M,
      (maxZ - minZ) / 2 + PEEL_FOOTPRINT_MARGIN_M,
    ],
  };
}

export interface PeelUniforms {
  readonly venPeelOrigin: { readonly value: Vector3 };
  readonly venPeelDir: { readonly value: Vector3 };
  readonly venPeelFocusT: { value: number };
  readonly venPeelRadius: { value: number };
  readonly venPeelKeepBelowY: { value: number };
  readonly venPeelStrength: { value: number };
  /** Room footprint (world xz): centre, half-extents, and the horizontal
   *  room→camera direction the side test projects onto. */
  readonly venPeelRoomCenter: { readonly value: Vector2 };
  readonly venPeelRoomHalf: { readonly value: Vector2 };
  readonly venPeelDirHoriz: { readonly value: Vector2 };
}

/** One shared uniforms object serves every patched material clone — a single
 *  per-frame update reaches all 144 atlas-chunk programs. */
export function createPeelUniforms(): PeelUniforms {
  return {
    venPeelOrigin: { value: new Vector3() },
    venPeelDir: { value: new Vector3(0, 0, -1) },
    venPeelFocusT: { value: 0 },
    venPeelRadius: { value: PEEL_RADIUS_MIN_M },
    venPeelKeepBelowY: { value: 0 },
    venPeelStrength: { value: 0 },
    venPeelRoomCenter: { value: new Vector2() },
    venPeelRoomHalf: { value: new Vector2(1, 1) },
    venPeelDirHoriz: { value: new Vector2(0, 1) },
  };
}

/**
 * Point the peel cylinder from the camera at the focus. Degenerate rays
 * (camera at the focus point, mid-dive) force strength to zero rather than
 * feeding NaNs to the shader.
 */
export function updatePeelUniforms(
  uniforms: PeelUniforms,
  cameraPosition: Vector3,
  focus: RoomFocus | null,
  strength: number,
): void {
  if (focus === null) {
    uniforms.venPeelStrength.value = 0;
    return;
  }
  const direction = new Vector3(
    focus.center[0] - cameraPosition.x,
    focus.center[1] - cameraPosition.y,
    focus.center[2] - cameraPosition.z,
  );
  const distance = direction.length();
  if (!Number.isFinite(distance) || distance < 1e-6) {
    uniforms.venPeelStrength.value = 0;
    return;
  }
  direction.multiplyScalar(1 / distance);
  // Horizontal room→camera direction for the footprint side test. Directly
  // overhead it degenerates — zero strength then: nothing is "in front of"
  // the room from above, so nothing should peel anyway.
  const horizontalX = cameraPosition.x - focus.footprintCenter[0];
  const horizontalZ = cameraPosition.z - focus.footprintCenter[1];
  const horizontalLength = Math.hypot(horizontalX, horizontalZ);
  if (!Number.isFinite(horizontalLength) || horizontalLength < 1e-6) {
    uniforms.venPeelStrength.value = 0;
    return;
  }
  uniforms.venPeelOrigin.value.copy(cameraPosition);
  uniforms.venPeelDir.value.copy(direction);
  uniforms.venPeelFocusT.value = distance;
  uniforms.venPeelRadius.value = focus.radiusM;
  uniforms.venPeelKeepBelowY.value = focus.keepBelowY;
  uniforms.venPeelRoomCenter.value.set(focus.footprintCenter[0], focus.footprintCenter[1]);
  uniforms.venPeelRoomHalf.value.set(focus.footprintHalf[0], focus.footprintHalf[1]);
  uniforms.venPeelDirHoriz.value.set(horizontalX / horizontalLength, horizontalZ / horizontalLength);
  uniforms.venPeelStrength.value = Math.min(1, Math.max(0, strength));
}

const glslFloat = (value: number): string => value.toFixed(4);

/** Declarations shared by both stages (varying) + fragment-only helpers. */
export const PEEL_VERTEX_PRELUDE = "varying vec3 venPeelWorldPos;\n";

export const PEEL_VERTEX_ASSIGN =
  "venPeelWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n";

export const PEEL_FRAGMENT_PRELUDE = `varying vec3 venPeelWorldPos;
uniform vec3 venPeelOrigin;
uniform vec3 venPeelDir;
uniform float venPeelFocusT;
uniform float venPeelRadius;
uniform float venPeelKeepBelowY;
uniform float venPeelStrength;
uniform vec2 venPeelRoomCenter;
uniform vec2 venPeelRoomHalf;
uniform vec2 venPeelDirHoriz;
float venPeelBayer( const in vec2 fragCoord ) {
  ivec2 cell = ivec2( mod( fragCoord, 4.0 ) );
  int index = cell.y * 4 + cell.x;
  const float pattern[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( pattern[ index ] + 0.5 ) / 16.0;
}
`;

export const PEEL_FRAGMENT_BLOCK = `if ( venPeelStrength > 0.001 ) {
  vec3 venPeelRel = venPeelWorldPos - venPeelOrigin;
  float venPeelAxial = dot( venPeelRel, venPeelDir );
  float venPeelRadial = length( venPeelRel - venPeelAxial * venPeelDir );
  float venPeelAxialHide = 1.0 - smoothstep( venPeelFocusT - ${glslFloat(PEEL_AXIAL_MARGIN_M)} - ${glslFloat(PEEL_FADE_M)}, venPeelFocusT - ${glslFloat(PEEL_AXIAL_MARGIN_M)}, venPeelAxial );
  float venPeelRadialHide = 1.0 - smoothstep( venPeelRadius - ${glslFloat(PEEL_FADE_M)}, venPeelRadius, venPeelRadial );
  float venPeelHeightHide = smoothstep( venPeelKeepBelowY, venPeelKeepBelowY + ${glslFloat(PEEL_HEIGHT_FEATHER_M)}, venPeelWorldPos.y );
  // Room-footprint side test: the focused room's own fabric (everything
  // inside the footprint box) never dissolves; only geometry beyond the
  // footprint's camera-facing boundary may. Support function of the box
  // along the horizontal room->camera axis gives that boundary distance.
  float venPeelSide = dot( venPeelWorldPos.xz - venPeelRoomCenter, venPeelDirHoriz );
  float venPeelSupport = abs( venPeelDirHoriz.x ) * venPeelRoomHalf.x + abs( venPeelDirHoriz.y ) * venPeelRoomHalf.y;
  float venPeelOutsideHide = smoothstep( venPeelSupport - ${glslFloat(PEEL_FADE_M)}, venPeelSupport, venPeelSide );
  float venPeelHide = venPeelStrength * venPeelAxialHide * venPeelRadialHide * venPeelHeightHide * venPeelOutsideHide;
  if ( venPeelHide >= venPeelBayer( gl_FragCoord.xy ) ) discard;
}
`;

const VERTEX_ANCHOR = "#include <fog_vertex>";
const FRAGMENT_ANCHOR = "#include <clipping_planes_fragment>";

/**
 * Patch a material clone with the peel shader. Chains any existing
 * onBeforeCompile and namespaces the program cache key so patched programs
 * never alias unpatched ones. Apply ONLY to cutaway material clones (owned by
 * the stage) — never to drei's shared cache materials.
 */
export function applyOcclusionPeel(material: Material, uniforms: PeelUniforms): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      PEEL_VERTEX_PRELUDE +
      shader.vertexShader.replace(VERTEX_ANCHOR, `${VERTEX_ANCHOR}\n${PEEL_VERTEX_ASSIGN}`);
    shader.fragmentShader =
      PEEL_FRAGMENT_PRELUDE +
      shader.fragmentShader.replace(FRAGMENT_ANCHOR, `${FRAGMENT_ANCHOR}\n${PEEL_FRAGMENT_BLOCK}`);
  };
  // Three folds this key into its parameter-based program hash — the default
  // implementation stringifies onBeforeCompile instead, which would make
  // every clone's program unique. A constant lets patched chunks share.
  material.customProgramCacheKey = () => "ven-peel";
}
