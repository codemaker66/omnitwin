import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Object3D } from "three";
import {
  clearAllFurnitureSettles,
  furnitureSettleOffset,
  stepFurnitureSettles,
} from "../../lib/furniture-motion.js";

// ---------------------------------------------------------------------------
// FurnitureMotion — applies the settle registry's transient offsets to the
// scene, one useFrame for every live spring (the ref-driven division of
// labour the splat dissolve engine established: React writes truth, this
// layer writes the transient).
//
// The outer `furniture-<id>` group is the free channel: React manages the
// inner mesh's position and never writes the outer group's, so imperative
// writes here never fight reconciliation. Groups are looked up by name and
// cached; a miss (item deleted mid-settle) simply drops the id.
//
// Under frameloop="demand" this component SUSTAINS the loop while springs
// are live — the seeding site (SelectionSystem's pointer-up) is what WAKES
// it, per the two-halves rule.
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
        if (group !== undefined) group.position.set(0, 0, 0);
      }
      applied.clear();
      cache.clear();
      clearAllFurnitureSettles();
    };
  }, []);

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
      if (group !== undefined) group.position.set(0, 0, 0);
      applied.delete(id);
    }

    for (const id of live) {
      const offset = furnitureSettleOffset(id);
      if (offset === null) continue;
      const group = findGroup(id);
      if (group === undefined) continue;
      group.position.set(offset.x, 0, offset.z);
      applied.add(id);
    }

    if (live.length > 0 || applied.size > 0) invalidate();
  });

  return null;
}
