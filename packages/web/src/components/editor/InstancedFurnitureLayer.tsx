import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Instances, Instance } from "@react-three/drei";
import {
  type BufferGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type InstancedMesh,
  type Object3D,
} from "three";
import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import {
  FurnitureProxy,
  normalizedFurniturePresentationScale,
} from "../FurnitureProxy.js";
import {
  mergePartsByMaterial,
  type ExtractedPart,
  type MergedMaterialGroup,
} from "../../lib/furniture-instancing.js";

// ---------------------------------------------------------------------------
// InstancedFurnitureLayer — draws every placed furniture *model* with instanced
// rendering instead of one composite mesh tree per item.
//
// A realistic 162-item layout drawn per-item costs ~3000 draw calls (~15fps),
// because each item is a ~13-mesh composite. Furniture types repeat heavily
// (dozens of identical chairs/tables), so we draw each model's *material group*
// once for ALL items of that type via an InstancedMesh.
//
// How it preserves selection/drag with ZERO changes to SelectionSystem:
//   - The instanced meshes render but are made non-pickable (raycast = noop).
//   - Per-item selection/drag still keys off the invisible `furniture-{id}`
//     pick proxy rendered by PlacedFurnitureItem (raycaster hits invisible
//     meshes), so findFurnitureItemId resolves exactly as before.
//
// Lifecycle: each unique variant (catalogue type — placed items carry no colour
// or opacity overrides) is rendered once into a hidden template, harvested into
// merged-by-material geometries + cloned materials, and instanced. The layer
// owns its geometries/materials and disposes them when the variant set changes
// or the layer unmounts. GLTF/imported models are excluded by the caller (they
// load asynchronously and can't be harvested synchronously) and keep their
// existing per-item rendering.
// ---------------------------------------------------------------------------

interface HarvestedVariant {
  readonly groups: readonly MergedMaterialGroup[];
  readonly materialByKey: ReadonlyMap<string, Material>;
  readonly appearanceByKey: ReadonlyMap<string, MaterialAppearance>;
  readonly shadowsByKey: ReadonlyMap<string, MaterialShadows>;
}

interface MaterialAppearance {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
}

interface MaterialShadows {
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

const noRaycast: Object3D["raycast"] = () => undefined;

/** A stable appearance signature so identical-looking sub-meshes merge and share one material. */
function materialSignature(material: Material): string {
  const parts: (string | number)[] = [
    material.type,
    material.side,
    material.transparent ? 1 : 0,
    material.opacity,
  ];
  if (material instanceof MeshStandardMaterial) {
    parts.push(
      material.color.getHexString(),
      material.emissive.getHexString(),
      material.roughness,
      material.metalness,
    );
  } else if (material instanceof MeshBasicMaterial) {
    parts.push(material.color.getHexString());
  }
  return parts.join("|");
}

/** Type guard via the `isMesh` flag — avoids `instanceof Mesh` widening material to `any`. */
function isMesh(object: Object3D): object is Mesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

/** Growth step for the instance matrix pool. See `instanceCapacityFor`. */
export const INSTANCE_CAPACITY_STEP = 32;

/**
 * Round an instance count up to the next capacity bucket.
 *
 * drei allocates `new Float32Array(limit * 16)` once per mount, so `limit`
 * must never be exceeded by the live count. Bucketing trades a little unused
 * buffer for stability: placing chairs 1..32 reuses one pool, and only the
 * 33rd forces a remount. Chairs are placed in tens, so the alternative —
 * keying on the exact count — would rebuild the pool on every single drop.
 */
export function instanceCapacityFor(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return INSTANCE_CAPACITY_STEP;
  return Math.ceil(count / INSTANCE_CAPACITY_STEP) * INSTANCE_CAPACITY_STEP;
}

/** Harvest a rendered model template into merged-by-material geometries + cloned materials. */
function harvestVariant(root: Object3D): HarvestedVariant {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const parts: ExtractedPart[] = [];
  const sourceMaterialByKey = new Map<string, Material>();
  const materialByKey = new Map<string, Material>();
  const appearanceByKey = new Map<string, MaterialAppearance>();
  const shadowsByKey = new Map<string, MaterialShadows>();

  root.traverse((obj) => {
    if (!isMesh(obj)) return;
    const material = obj.material;
    if (Array.isArray(material)) return; // composite procedural meshes are single-material
    const key = materialSignature(material);
    if (!sourceMaterialByKey.has(key)) sourceMaterialByKey.set(key, material);
    const shadows = shadowsByKey.get(key);
    shadowsByKey.set(key, {
      castShadow: (shadows?.castShadow ?? false) || obj.castShadow,
      receiveShadow: (shadows?.receiveShadow ?? false) || obj.receiveShadow,
    });
    parts.push({
      geometry: obj.geometry,
      materialKey: key,
      matrix: rootInverse.clone().multiply(obj.matrixWorld),
    });
  });

  const groups = mergePartsByMaterial(parts);
  try {
    for (const [key, material] of sourceMaterialByKey) {
      materialByKey.set(key, material.clone());
      appearanceByKey.set(key, {
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
      });
    }
    return { groups, materialByKey, appearanceByKey, shadowsByKey };
  } catch (error: unknown) {
    for (const group of groups) group.geometry.dispose();
    for (const material of materialByKey.values()) material.dispose();
    throw error;
  }
}

function disposeVariant(variant: HarvestedVariant): void {
  for (const group of variant.groups) group.geometry.dispose();
  for (const material of variant.materialByKey.values()) material.dispose();
}

function applyHarvestedOpacity(
  harvested: ReadonlyMap<string, HarvestedVariant>,
  opacity: number,
): void {
  const clampedOpacity = Math.min(1, Math.max(0, opacity));
  for (const variant of harvested.values()) {
    for (const [key, material] of variant.materialByKey) {
      const base = variant.appearanceByKey.get(key);
      if (base === undefined) continue;
      const transparent = base.transparent || clampedOpacity < 1;
      material.opacity = base.opacity * clampedOpacity;
      material.depthWrite = clampedOpacity >= 1 ? base.depthWrite : false;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }
  }
}

function DirectInstanceBatch({
  geometry,
  material,
  items,
  itemScale,
  castShadow,
  receiveShadow,
  setNonPickable,
}: {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly items: readonly PlacedItem[];
  readonly itemScale: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly setNonPickable: (mesh: InstancedMesh | null) => void;
}): React.ReactElement {
  const meshRef = useRef<InstancedMesh | null>(null);
  const matrixSource = useMemo(() => new Group(), []);
  const invalidate = useThree((state) => state.invalidate);
  const assignMesh = useCallback((mesh: InstancedMesh | null): void => {
    meshRef.current = mesh;
    setNonPickable(mesh);
  }, [setNonPickable]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    mesh.count = items.length;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      matrixSource.position.set(item.x, item.y, item.z);
      matrixSource.rotation.set(0, item.rotationY, 0);
      matrixSource.scale.setScalar(
        normalizedFurniturePresentationScale(item.scale) * itemScale,
      );
      matrixSource.updateMatrix();
      mesh.setMatrixAt(index, matrixSource.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [invalidate, itemScale, items, matrixSource]);

  return (
    <instancedMesh
      ref={assignMesh}
      args={[geometry, material, Math.max(1, items.length)]}
      count={items.length}
      frustumCulled={false}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

export function InstancedFurnitureLayer({
  items,
  opacity = 1,
  itemScale = 1,
  opacitySource,
  directInstances = false,
  onFailedVariantIdsChange,
}: {
  readonly items: readonly PlacedItem[];
  /** Presentation-only opacity. The editable furniture path leaves this at 1. */
  readonly opacity?: number;
  /** Uniform per-item scale used by timeline strike/materialize transitions. */
  readonly itemScale?: number;
  /** Optional imperative driver used by timeline crossfades without reconciling item trees. */
  readonly opacitySource?: () => number;
  /** Timeline-only fast path: one raw InstancedMesh update instead of one React child per item. */
  readonly directInstances?: boolean;
  /** Catalogue IDs that must use the caller's per-item visible fallback. */
  readonly onFailedVariantIdsChange?: (ids: ReadonlySet<string>) => void;
}): React.ReactElement {
  const invalidate = useThree((state) => state.invalidate);

  const { variantOrder, itemsByVariant, sampleByVariant } = useMemo(() => {
    const order: string[] = [];
    const byVariant = new Map<string, PlacedItem[]>();
    const sample = new Map<string, PlacedItem>();
    for (const item of items) {
      const key = item.catalogueItemId;
      let list = byVariant.get(key);
      if (list === undefined) {
        list = [];
        byVariant.set(key, list);
        order.push(key);
        sample.set(key, item);
      }
      list.push(item);
    }
    return { variantOrder: order, itemsByVariant: byVariant, sampleByVariant: sample };
  }, [items]);

  const templateRef = useRef<Group>(null);
  const lastDrivenOpacity = useRef<number | null>(null);
  const [harvested, setHarvested] = useState<ReadonlyMap<string, HarvestedVariant>>(new Map());

  // Re-harvest only when the SET of variants changes (not on every drag). The
  // cleanup disposes the geometries/materials this run created — it runs before
  // the next harvest or on unmount, never while the current generation is still
  // on screen.
  const variantSignature = variantOrder.join("|");
  useLayoutEffect(() => {
    const root = templateRef.current;
    if (root === null) return undefined;
    const next = new Map<string, HarvestedVariant>();
    const failedVariantIds = new Set<string>();
    for (const key of variantOrder) {
      const node = root.getObjectByName(`furniture-template-${key}`);
      if (node === undefined) {
        failedVariantIds.add(key);
        continue;
      }
      try {
        next.set(key, harvestVariant(node));
      } catch {
        // Preserve visibility through the caller's named per-item model path.
        failedVariantIds.add(key);
      }
    }
    setHarvested(next);
    onFailedVariantIdsChange?.(failedVariantIds);
    invalidate();
    return () => {
      for (const variant of next.values()) disposeVariant(variant);
    };
    // variantSignature is the derived key for the variantOrder set read inside.
  }, [variantSignature, invalidate, onFailedVariantIdsChange]);

  const setNonPickable = useCallback((mesh: InstancedMesh | null) => {
    if (mesh !== null) mesh.raycast = noRaycast;
  }, []);

  useLayoutEffect(() => {
    const resolvedOpacity = opacitySource?.() ?? opacity;
    applyHarvestedOpacity(harvested, resolvedOpacity);
    lastDrivenOpacity.current = resolvedOpacity;
    invalidate();
  }, [harvested, invalidate, opacity, opacitySource]);

  useFrame(() => {
    if (opacitySource === undefined) return;
    const nextOpacity = opacitySource();
    if (nextOpacity === lastDrivenOpacity.current) return;
    applyHarvestedOpacity(harvested, nextOpacity);
    lastDrivenOpacity.current = nextOpacity;
  });

  return (
    <group name="instanced-furniture">
      {/* Hidden templates — one model per variant at the origin, harvested once. */}
      <group ref={templateRef} visible={false}>
        {variantOrder.map((key) => {
          const sampleItem = sampleByVariant.get(key);
          const catalogueItem =
            sampleItem !== undefined ? getCatalogueItem(sampleItem.catalogueItemId) : undefined;
          if (catalogueItem === undefined) return null;
          return (
            <group key={key} name={`furniture-template-${key}`}>
              <FurnitureProxy item={catalogueItem} position={[0, 0, 0]} rotationY={0} />
            </group>
          );
        })}
      </group>

      {/* Visible instanced models — one InstancedMesh per variant per material group. */}
      {variantOrder.map((key) => {
        const variant = harvested.get(key);
        const variantItems = itemsByVariant.get(key);
        if (variant === undefined || variantItems === undefined || variantItems.length === 0) {
          return null;
        }
        return variant.groups.map((group, groupIndex) => {
          const material = variant.materialByKey.get(group.materialKey);
          const shadows = variant.shadowsByKey.get(group.materialKey);
          if (material === undefined || shadows === undefined) return null;
          if (directInstances) {
            return (
              <DirectInstanceBatch
                key={`${key}-${String(groupIndex)}`}
                geometry={group.geometry}
                material={material}
                items={variantItems}
                itemScale={itemScale}
                castShadow={shadows.castShadow}
                receiveShadow={shadows.receiveShadow}
                setNonPickable={setNonPickable}
              />
            );
          }
          // `limit` sizes drei's matrix buffer ONCE, inside a useState
          // initialiser, but the mesh's `count` is recomputed from live props
          // every frame. Passing the raw length means adding an item of a type
          // already on screen grows count past the buffer, and the extra
          // matrices are silently swallowed by typed-array semantics — the
          // item vanishes while staying selectable and saveable. Bucketing the
          // capacity and keying on it remounts the pool only when it genuinely
          // has to grow, rather than on every placement.
          const capacity = instanceCapacityFor(variantItems.length);
          return (
            <Instances
              key={`${key}-${String(groupIndex)}-cap${String(capacity)}`}
              ref={setNonPickable}
              limit={capacity}
              range={variantItems.length}
              geometry={group.geometry}
              material={material}
              castShadow={shadows.castShadow}
              receiveShadow={shadows.receiveShadow}
            >
              {variantItems.map((item) => (
                <Instance
                  key={item.id}
                  position={[item.x, item.y, item.z]}
                  rotation={[0, item.rotationY, 0]}
                  scale={normalizedFurniturePresentationScale(item.scale) * itemScale}
                />
              ))}
            </Instances>
          );
        });
      })}
    </group>
  );
}
