import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Matrix4, type Object3D } from "three";
import {
  DROP_HEIGHT,
  clearAllFurnitureSettles,
  composeFurnitureMotion,
  dropInFurniture,
  furnitureMotionPose,
  landingDelays,
  massForCategory,
  publishFurnitureSettleFrame,
  setFurnitureMassResolver,
  stepFurnitureSettles,
  type LandingPiece,
} from "../../lib/furniture-motion.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { subscribeFurniturePlaced, usePlacementStore } from "../../stores/placement-store.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";

const motion = new Matrix4();

/** Returns a group to store truth: no offset, lean or squash. */
function rest(group: Object3D): void {
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(1, 1, 1);
}

// ---------------------------------------------------------------------------
// FurnitureMotion — applies the settle registry's transient offsets to the
// scene, one useFrame for every live spring (the ref-driven division of
// labour the splat dissolve engine established: React writes truth, this
// layer writes the transient).
//
// The outer `furniture-<id>` group is the free channel: React manages the
// inner mesh's position and never writes the outer group's, so imperative
// writes here never fight reconciliation. Groups are looked up by name and
// cached; a miss (item deleted mid-settle) simply drops the id. Instanced
// models are drawn outside those groups, so each frame's live ids are then
// published for the instancing layer to offset the same items identically.
//
// Under frameloop="demand" this component SUSTAINS the loop while springs
// are live — the seeding sites (SelectionSystem's carry and release, and the
// placement announcement below) are what WAKE it, per the two-halves rule.
// The waking frame's delta is the whole idle gap; stepFurnitureSettles takes
// a motion's first step as one display frame, so the delta goes in as given.
// ---------------------------------------------------------------------------

export function FurnitureMotion(): null {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const groupCache = useRef(new Map<string, Object3D>());
  const appliedLastFrame = useRef(new Set<string>());

  // On unmount: zero every group this layer touched and drop the registry —
  // a room change must never inherit a stale offset.
  useEffect(() => {
    const cache = groupCache.current;
    const applied = appliedLastFrame.current;
    return () => {
      for (const id of applied) {
        const group = cache.get(id);
        if (group !== undefined) rest(group);
      }
      applied.clear();
      cache.clear();
      clearAllFurnitureSettles();
      publishFurnitureSettleFrame([]);
    };
  }, []);

  // How heavy each piece is, read from the catalogue when it starts to move:
  // staging, the dance floor and AV neither lean nor dip.
  useEffect(() => setFurnitureMassResolver((id) => {
    const item = usePlacementStore.getState().placedItems.find((candidate) => candidate.id === id);
    return massForCategory(item === undefined ? undefined : getCatalogueItem(item.catalogueItemId)?.category);
  }), []);

  // Newly placed pieces are set down onto the floor: a set lands in order,
  // its table and then its chairs round it, and a whole Lay out ripples out
  // from its middle.
  useEffect(() => subscribeFurniturePlaced((ids) => {
    if (prefersReducedMotion()) return;
    const placed = new Map(usePlacementStore.getState().placedItems.map((item) => [item.id, item]));
    const pieces = ids.flatMap((id): LandingPiece[] => {
      const item = placed.get(id);
      if (item === undefined) return [];
      return [{ id, x: item.x, z: item.z, groupId: item.groupId, isTable: getCatalogueItem(item.catalogueItemId)?.category === "table" }];
    });
    const delays = landingDelays(pieces);
    for (const id of ids) dropInFurniture(id, DROP_HEIGHT, delays.get(id) ?? 0);
    invalidate();
  }), [invalidate]);

  useFrame((_state, delta) => {
    const live = stepFurnitureSettles(delta);
    const cache = groupCache.current;
    const applied = appliedLastFrame.current;

    const findGroup = (id: string): Object3D | undefined => {
      const cached = cache.get(id);
      // A cached group whose parent chain was torn down (item deleted,
      // furniture remounted) must be re-resolved, not trusted.
      if (cached !== undefined && cached.parent !== null) return cached;
      const found = scene.getObjectByName(`furniture-${id}`);
      if (found !== undefined) cache.set(id, found);
      else cache.delete(id);
      return found;
    };

    // Settled or cleared since last frame → return those groups to truth.
    const liveSet = new Set(live);
    for (const id of applied) {
      if (liveSet.has(id)) continue;
      const group = findGroup(id);
      if (group !== undefined) rest(group);
      applied.delete(id);
    }

    // Each moving piece leans and squashes about its own base.
    const items = live.length === 0 ? null : new Map(usePlacementStore.getState().placedItems.map((item) => [item.id, item]));
    for (const id of live) {
      const pose = furnitureMotionPose(id);
      if (pose === null) continue;
      const group = findGroup(id);
      const item = items?.get(id);
      if (group === undefined || item === undefined) continue;
      composeFurnitureMotion(pose, item.x, item.y, item.z, motion).decompose(group.position, group.quaternion, group.scale);
      applied.add(id);
    }
    publishFurnitureSettleFrame(live);

    if (live.length > 0 || applied.size > 0) invalidate();
  });

  return null;
}
