// ---------------------------------------------------------------------------
// FurnitureContactShadows — every piece of furniture sits on the floor
//
// A soft shadow under each placed piece, the shape of its footprint: darkest
// where it meets the floor, fading over a hand's width outside it, and a
// gentle shade beneath it where the floor shows between legs. Real rooms are
// lit from many directions at once, so this soft occlusion — not a crisp
// cast shadow — is what grounds furniture; the screen-space occlusion adds
// the small creases. All pieces draw in one instanced call with the shape
// computed per pixel (a rounded rectangle's distance field), so it costs the
// same on a phone for ten chairs or a thousand.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { exp, float, instancedBufferAttribute, max, smoothstep, uv, vec2, vec3 } from "three/tsl";
import { usePlacementStore } from "../../stores/placement-store.js";
import { getCatalogueItem, type CatalogueItem } from "../../lib/catalogue.js";
import { normalizeFurnitureScale } from "../../lib/furniture-scale.js";
import { toRenderSpace } from "../../constants/scale.js";
import type { PlacedItem } from "../../lib/placement.js";
import { furnitureMotionPose, subscribeFurnitureSettleFrames, type FurnitureMotionPose } from "../../lib/furniture-motion.js";
import {
  HIDDEN_MATRIX,
  currentFurniturePresentation,
  presentedPiece,
  subscribeFurniturePresentation,
  type PresentationFrame,
} from "../../floor/presentation-channel.js";

/** How far a shadow reaches beyond its footprint, metres. */
const SPREAD = 0.28;
/** Height above the floor the shadows lie at, metres (with a depth bias). */
const LIFT = 0.002;
/** At this height and above, a piece in motion casts its lightest, widest shadow, metres. */
const RAISED = 0.05;
/** That shadow against one on the floor: lighter, and spread wider. */
const RAISED_DARKNESS = 0.45;
const RAISED_SPREAD = 1.25;

/** The shadow of a piece in motion, against the shadow where it is placed. */
export interface MovingShadow {
  /** Offset from the placed position, metres. */
  readonly dx: number;
  readonly dz: number;
  /** Darkness against the shadow on the floor, 0 to 1. */
  readonly darkness: number;
  /** Footprint scale. */
  readonly spread: number;
}

/**
 * Where and how a piece in motion (lib/furniture-motion.ts) casts its shadow:
 * under where it is drawn, and the higher it is, the lighter and wider, as a
 * real shadow softens once its object leaves the floor. A squash widens it
 * with the base, as composeFurnitureMotion widens the piece.
 */
export function shadowUnderMotion(pose: FurnitureMotionPose): MovingShadow {
  const raised = Math.min(1, Math.max(0, pose.lift / RAISED));
  return {
    dx: pose.x,
    dz: pose.z,
    darkness: 1 - (1 - RAISED_DARKNESS) * raised,
    spread: (1 + (RAISED_SPREAD - 1) * raised) * (1 - pose.squash * 0.5),
  };
}

export interface ContactShadowShape {
  /** Half extents of the footprint, metres. */
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Corner radius, metres (a circle when equal to both halves). */
  readonly corner: number;
  /** Darkness at the contact line, 0 to 1. */
  readonly strength: number;
  /** Darkness beneath the piece, where the floor shows through. */
  readonly under: number;
}

/** The shadow a catalogue piece casts, or null for pieces that cast none. */
export function contactShadowShape(item: CatalogueItem, placed: Pick<PlacedItem, "scale" | "clothed">): ContactShadowShape | null {
  const scale = normalizeFurnitureScale(placed.scale);
  const halfWidth = (toRenderSpace(item.width) * scale) / 2;
  const halfDepth = (toRenderSpace(item.depth) * scale) / 2;
  if (!(halfWidth > 0.01 && halfDepth > 0.01)) return null;
  const round = item.tableShape === "round";
  const corner = round ? Math.min(halfWidth, halfDepth) : Math.min(0.06, halfWidth, halfDepth);
  switch (item.category) {
    case "chair":
      return { halfWidth: halfWidth * 0.92, halfDepth: halfDepth * 0.92, corner: Math.min(0.08, halfWidth), strength: 0.5, under: 0.38 };
    case "table":
      // A cloth to the floor hides the floor beneath; bare tables show it.
      return { halfWidth, halfDepth, corner, strength: placed.clothed ? 0.7 : 0.55, under: placed.clothed ? 0.7 : 0.32 };
    case "stage":
      return { halfWidth, halfDepth, corner: 0.02, strength: 0.75, under: 0.75 };
    case "lighting":
    case "av":
    case "lectern":
      return { halfWidth, halfDepth, corner, strength: 0.45, under: 0.35 };
    default:
      return { halfWidth, halfDepth, corner, strength: 0.5, under: 0.4 };
  }
}

const PLANE = (() => {
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
})();

interface ShadowBuffers {
  readonly mesh: InstancedMesh;
  readonly shape: InstancedBufferAttribute;
  readonly look: InstancedBufferAttribute;
}

function createShadowMesh(capacity: number): ShadowBuffers {
  const shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  shape.setUsage(DynamicDrawUsage);
  const look = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  look.setUsage(DynamicDrawUsage);
  const shapeNode = instancedBufferAttribute<"vec4">(shape, "vec4");
  const lookNode = instancedBufferAttribute<"vec2">(look, "vec2");
  // The plane spans the footprint plus the spread on each side; recover
  // metres from its texture coordinates (an instanced mesh's local position
  // already carries the instance's transform).
  const half = shapeNode.xy;
  const corner = shapeNode.z;
  const extent = half.add(SPREAD);
  const p = uv().sub(0.5).mul(extent.mul(2));
  // Signed distance to the rounded rectangle.
  const q = p.abs().sub(half).add(corner);
  const outside = vec2(max(q.x, 0), max(q.y, 0)).length();
  const distance = outside.add(q.x.max(q.y).min(0)).sub(corner);
  const strength = lookNode.x;
  const under = lookNode.y;
  const contact = exp(distance.max(0).mul(-11)).mul(strength);
  const beneath = float(1).sub(smoothstep(-0.18, 0.0, distance)).mul(under);
  const alpha = contact.max(beneath).mul(float(1).sub(smoothstep(SPREAD * 0.75, SPREAD, distance)));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
  material.colorNode = vec3(0.02, 0.015, 0.01);
  material.opacityNode = alpha;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -4;
  material.fog = false;
  material.name = "furniture-contact-shadows";
  const geometry = PLANE.clone();
  geometry.setAttribute("shape", shape);
  geometry.setAttribute("look", look);
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = "furniture-contact-shadows";
  return { mesh, shape, look };
}

const matrix = new Matrix4();
const position = new Vector3();
const rotation = new Quaternion();
const size = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Writes every placed piece's shadow into the buffers; returns how many.
 * While a reveal plays (floor/presentation-channel.ts) a piece's shadow lies
 * where the reveal draws it, as dark and as wide as it says; the store is
 * never written, and the frame after release writes every shadow as placed.
 * Otherwise a piece in motion (lib/furniture-motion.ts) casts its shadow
 * where the motion draws it (shadowUnderMotion).
 */
function fillShadows(buffers: ShadowBuffers, items: readonly PlacedItem[], frame: PresentationFrame | null): number {
  let count = 0;
  for (const placed of items) {
    if (count >= buffers.mesh.instanceMatrix.count) break;
    const item = getCatalogueItem(placed.catalogueItemId);
    if (item === undefined) continue;
    const shape = contactShadowShape(item, placed);
    if (shape === null) continue;
    const shown = frame === null ? null : presentedPiece(frame, placed.id);
    const presented = shown === null || shown === "hidden" ? null : shown;
    const pose = shown === null ? furnitureMotionPose(placed.id) : null;
    const moving = pose === null ? null : shadowUnderMotion(pose);
    const spread = presented?.shadowSpread ?? moving?.spread ?? 1;
    if (shown === "hidden" || (presented !== null && presented.shadow <= 0)) {
      buffers.mesh.setMatrixAt(count, HIDDEN_MATRIX);
      buffers.look.setXY(count, 0, 0);
    } else {
      const darkness = Math.min(1, presented?.shadow ?? moving?.darkness ?? 1);
      position.set(presented?.shadowX ?? placed.x + (moving?.dx ?? 0), placed.y + LIFT, presented?.shadowZ ?? placed.z + (moving?.dz ?? 0));
      rotation.setFromAxisAngle(UP, presented?.shadowYaw ?? placed.rotationY);
      size.set((shape.halfWidth * spread + SPREAD) * 2, 1, (shape.halfDepth * spread + SPREAD) * 2);
      matrix.compose(position, rotation, size);
      buffers.mesh.setMatrixAt(count, matrix);
      buffers.look.setXY(count, shape.strength * darkness, shape.under * darkness);
    }
    buffers.shape.setXYZW(count, shape.halfWidth * spread, shape.halfDepth * spread, shape.corner, 0);
    count += 1;
  }
  buffers.mesh.count = count;
  buffers.mesh.instanceMatrix.needsUpdate = true;
  buffers.shape.needsUpdate = true;
  buffers.look.needsUpdate = true;
  return count;
}

/** Soft contact shadows under every placed piece, one draw call. */
export function FurnitureContactShadows(): ReactElement | null {
  const items = usePlacementStore((state) => state.placedItems);
  const invalidate = useThree((state) => state.invalidate);
  const capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, items.length))));
  const buffers = useMemo(() => createShadowMesh(capacity), [capacity]);
  const previous = useRef<ShadowBuffers | null>(null);

  useEffect(() => {
    const replaced = previous.current;
    previous.current = buffers;
    if (replaced !== null && replaced !== buffers) {
      replaced.mesh.geometry.dispose();
      if (replaced.mesh.material instanceof MeshBasicNodeMaterial) replaced.mesh.material.dispose();
    }
  }, [buffers]);

  useEffect(() => () => {
    const current = previous.current;
    if (current === null) return;
    current.mesh.geometry.dispose();
    if (current.mesh.material instanceof MeshBasicNodeMaterial) current.mesh.material.dispose();
    previous.current = null;
  }, []);

  const latest = useRef(items);
  latest.current = items;
  useEffect(() => {
    fillShadows(buffers, items, currentFurniturePresentation());
    invalidate();
  }, [buffers, invalidate, items]);

  // A reveal's frames, published before the frame renders (the publisher invalidates).
  useEffect(() => subscribeFurniturePresentation((frame) => {
    fillShadows(buffers, latest.current, frame);
  }), [buffers]);

  // Motion frames, likewise: a shadow follows its piece as it glides, lifts
  // and lands, and the frame after the last motion writes every shadow as placed.
  useEffect(() => subscribeFurnitureSettleFrames(() => {
    fillShadows(buffers, latest.current, currentFurniturePresentation());
  }), [buffers]);

  return <primitive object={buffers.mesh} />;
}
