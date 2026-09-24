import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  type BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  Object3D,
} from "three";
import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import {
  FurnitureProxy,
  normalizedFurniturePresentationScale,
} from "../FurnitureProxy.js";
import { GltfFurnitureTemplateContext } from "../meshes/GltfFurnitureTemplateContext.js";
import { isImportedFurnitureMaterial } from "../../lib/gltf-furniture-instance.js";
import { furnitureMaterialParts } from "../../lib/gltf-furniture-parts.js";
import { furnitureSettleOffset, subscribeFurnitureSettleFrames } from "../../lib/furniture-motion.js";
import {
  materialAppearanceSignature,
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
// How it preserves selection/drag:
//   - The instanced meshes render but are made non-pickable (raycast = noop).
//   - Per-item selection/drag still keys off the invisible `furniture-{id}`
//     pick proxy rendered by PlacedFurnitureItem (raycaster hits invisible
//     meshes), so findFurnitureItemId resolves exactly as before.
//   - The hidden templates sit at the origin, and three's Raycaster tests
//     invisible objects too, so their root stops the Raycaster descending:
//     clicking empty floor there must never pick a phantom template.
//
// Lifecycle: each unique variant (catalogue type — placed items carry no colour
// or opacity overrides) is rendered once into a hidden template, harvested into
// merged-by-material geometries + cloned materials, and instanced. The layer
// owns its geometries/materials and disposes them when the variant set changes
// or the layer unmounts. Imported models first batch their procedural fallback,
// then notify the layer when the GLTF template is ready for a fresh harvest.
//
// Editable planner furniture writes instance matrices directly (see
// EditableVariantBatch): a drag re-renders one small component per variant and
// rewrites only the items that moved, instead of reconciling one React child
// and recomposing one matrix per item on every frame.
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

/**
 * Returning `false` from `raycast` makes three's Raycaster skip the object's
 * descendants (r186 `Raycaster.intersect`), including template meshes that an
 * imported model adds after the last harvest.
 */
const skipSubtreeRaycast = (): boolean => false;

/** Type guard via the `isMesh` flag — avoids `instanceof Mesh` widening material to `any`. */
function isMesh(object: Object3D): object is Mesh {
  return (object as { readonly isMesh?: boolean }).isMesh === true;
}

/** Type guard via the flag used by Three.js's renderer. */
function isInstancedMesh(object: Mesh): object is InstancedMesh {
  return (object as Mesh & { readonly isInstancedMesh?: boolean }).isInstancedMesh === true;
}

export interface HarvestMeshInstance {
  /** The factory-owned source mesh. Its geometry remains owned by the factory root. */
  readonly mesh: Mesh;
  /** Source geometry to variant-root transform, including one internal instance transform. */
  readonly matrix: Matrix4;
}

/**
 * Expand factory-owned InstancedMeshes into the effective meshes rendered by Three.js.
 *
 * Geometry references deliberately remain shared here: mergePartsByMaterial clones each
 * occurrence before applying its matrix, then owns and disposes the resulting geometry.
 * Per-instance colours cannot survive that material-group merge, so those variants use
 * the existing per-item renderer fallback instead of being rendered incorrectly.
 */
export function collectMeshInstancesForHarvest(root: Object3D): HarvestMeshInstance[] {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const result: HarvestMeshInstance[] = [];

  root.traverse((object) => {
    if (!isMesh(object)) return;
    const meshMatrix = rootInverse.clone().multiply(object.matrixWorld);
    if (!isInstancedMesh(object)) {
      result.push({ mesh: object, matrix: meshMatrix });
      return;
    }
    if (object.instanceColor !== null) {
      throw new Error("Cannot harvest an InstancedMesh with per-instance colours");
    }
    const instanceMatrix = new Matrix4();
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, instanceMatrix);
      result.push({
        mesh: object,
        matrix: meshMatrix.clone().multiply(instanceMatrix),
      });
    }
  });

  return result;
}

/** Smallest instance matrix pool. See `instanceCapacityFor`. */
export const INSTANCE_CAPACITY_STEP = 32;

/**
 * Round an instance count up to its pool capacity: the next power of two,
 * and never below INSTANCE_CAPACITY_STEP.
 *
 * A pool's matrix buffer is allocated once, and three's node renderer also
 * sizes the instance-matrix binding it compiles from it, so the live count
 * must never exceed the capacity; a larger pool means a new InstancedMesh.
 * Doubling keeps that rare: placing chairs one by one replaces each pool
 * log2(n) times, and removing items never does.
 */
export function instanceCapacityFor(count: number): number {
  let capacity = INSTANCE_CAPACITY_STEP;
  if (!Number.isFinite(count)) return capacity;
  while (capacity < count) capacity *= 2;
  return capacity;
}

/** Harvest a rendered model template into merged-by-material geometries + cloned materials. */
export function harvestVariant(root: Object3D): HarvestedVariant {
  const parts: ExtractedPart[] = [];
  const sourceMaterialByKey = new Map<string, Material>();
  const materialByKey = new Map<string, Material>();
  const appearanceByKey = new Map<string, MaterialAppearance>();
  const shadowsByKey = new Map<string, MaterialShadows>();

  const temporaryParts: ReturnType<typeof furnitureMaterialParts>[] = [];
  let groups: MergedMaterialGroup[];
  try {
    for (const { mesh, matrix } of collectMeshInstancesForHarvest(root)) {
      const extracted = furnitureMaterialParts(mesh);
      temporaryParts.push(extracted);
      for (const { geometry, material } of extracted.parts) {
        // Imported material identity preserves all maps/extensions, even unnamed
        // textures. Procedural factories retain their cross-mesh semantic batching.
        const key = isImportedFurnitureMaterial(material)
          ? `gltf:${material.uuid}`
          : materialAppearanceSignature(material);
        if (!sourceMaterialByKey.has(key)) sourceMaterialByKey.set(key, material);
        const shadows = shadowsByKey.get(key);
        shadowsByKey.set(key, {
          castShadow: (shadows?.castShadow ?? false) || mesh.castShadow,
          receiveShadow: (shadows?.receiveShadow ?? false) || mesh.receiveShadow,
        });
        parts.push({ geometry, materialKey: key, matrix });
      }
    }
    groups = mergePartsByMaterial(parts);
  } finally {
    for (const extracted of temporaryParts) extracted.dispose();
  }
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

export function disposeVariant(variant: HarvestedVariant): void {
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

/** One editable variant: shared instance buffers and a mesh per material group. */
export interface EditableInstancePool {
  readonly capacity: number;
  readonly meshes: readonly InstancedMesh[];
  readonly matrices: InstancedBufferAttribute;
  /** The placed transform last composed into each slot: x, y, z, rotationY, scale. */
  readonly written: Float64Array;
  /** Items drawn at their live grid-settle offset, like their item groups. */
  readonly settling: Set<string>;
  /** Slot of each item id, for the items it was built from. */
  readonly slots: { items: readonly PlacedItem[] | null; readonly byId: Map<string, number> };
}

const WRITTEN_STRIDE = 5;
const editableInstanceTransform = new Object3D();

/**
 * Create the InstancedMesh for every material group of a variant.
 *
 * The groups share one matrix buffer, so a moved item is composed and uploaded
 * once rather than once per material. They also share one buffer of white
 * per-instance colours: drei's Instances always attached one, and keeping it
 * keeps the exact shader variant and therefore the exact pixels.
 */
export function createEditableInstancePool(
  variant: HarvestedVariant,
  capacity: number,
): EditableInstancePool {
  const matrices = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
  matrices.setUsage(DynamicDrawUsage);
  const colors = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  const meshes: InstancedMesh[] = [];
  for (const group of variant.groups) {
    const material = variant.materialByKey.get(group.materialKey);
    const shadows = variant.shadowsByKey.get(group.materialKey);
    if (material === undefined || shadows === undefined) continue;
    const mesh = new InstancedMesh(group.geometry, material, 0);
    mesh.instanceMatrix = matrices;
    mesh.instanceColor = colors;
    // One batch holds items anywhere in the room. three computes an
    // InstancedMesh's culling sphere once and never refreshes it as items
    // move or arrive, which culled furniture that was on screen; culling a
    // whole room-spanning batch would rarely skip any work, so it is off, as
    // for timeline batches.
    mesh.frustumCulled = false;
    mesh.castShadow = shadows.castShadow;
    mesh.receiveShadow = shadows.receiveShadow;
    mesh.raycast = noRaycast;
    meshes.push(mesh);
  }
  return {
    capacity,
    meshes,
    matrices,
    written: new Float64Array(capacity * WRITTEN_STRIDE).fill(Number.NaN),
    settling: new Set(),
    slots: { items: null, byId: new Map() },
  };
}

function editableInstanceScale(item: PlacedItem, itemScale: number): number {
  return normalizedFurniturePresentationScale(item.scale) * itemScale;
}

/** Compose one slot: the placed transform, moved like its item group by a settle offset. */
function composeEditableSlot(
  pool: EditableInstancePool,
  slot: number,
  item: PlacedItem,
  scale: number,
  offset: { readonly x: number; readonly z: number } | null,
): void {
  editableInstanceTransform.position.set(
    offset === null ? item.x : item.x + offset.x,
    item.y,
    offset === null ? item.z : item.z + offset.z,
  );
  editableInstanceTransform.rotation.set(0, item.rotationY, 0);
  editableInstanceTransform.scale.setScalar(scale);
  editableInstanceTransform.updateMatrix();
  editableInstanceTransform.matrix.toArray(pool.matrices.array, slot * 16);
  const written = slot * WRITTEN_STRIDE;
  if (offset !== null) {
    // No longer the placed transform: the next write recomposes it.
    pool.written[written] = Number.NaN;
    return;
  }
  pool.written[written] = item.x;
  pool.written[written + 1] = item.y;
  pool.written[written + 2] = item.z;
  pool.written[written + 3] = item.rotationY;
  pool.written[written + 4] = scale;
}

function uploadEditableSlots(pool: EditableInstancePool, first: number, last: number): void {
  pool.matrices.addUpdateRange(first * 16, (last - first + 1) * 16);
  pool.matrices.needsUpdate = true;
}

/**
 * Draw `items` from the pool, composing only the slots whose position,
 * rotation or scale changed since they were last written and uploading just
 * that span. Returns whether anything drawn changed.
 */
export function writeEditableInstancePool(
  pool: EditableInstancePool,
  items: readonly PlacedItem[],
  itemScale: number,
): boolean {
  // Never draw past the buffer: a count above capacity would silently drop
  // (or garble) the extra items while they stayed selectable and saveable.
  const count = Math.min(items.length, pool.capacity);
  const { written } = pool;
  let firstChanged = count;
  let lastChanged = -1;
  for (let index = 0; index < count; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    const scale = editableInstanceScale(item, itemScale);
    const slot = index * WRITTEN_STRIDE;
    if (
      written[slot] === item.x
      && written[slot + 1] === item.y
      && written[slot + 2] === item.z
      && written[slot + 3] === item.rotationY
      && written[slot + 4] === scale
    ) {
      continue;
    }
    composeEditableSlot(pool, index, item, scale, null);
    firstChanged = Math.min(firstChanged, index);
    lastChanged = index;
  }
  let changed = lastChanged >= 0;
  if (changed) uploadEditableSlots(pool, firstChanged, lastChanged);
  for (const mesh of pool.meshes) {
    if (mesh.count === count) continue;
    mesh.count = count;
    changed = true;
  }
  return changed;
}

/**
 * Follow one frame of FurnitureMotion's grid settle: items with a live offset
 * are drawn exactly where their item groups (linen, covers, labels) are
 * drawn, and items whose settle ended return to their placed transform.
 */
export function drawEditableSettleFrame(
  pool: EditableInstancePool,
  items: readonly PlacedItem[],
  itemScale: number,
  live: readonly string[],
): void {
  if (live.length === 0 && pool.settling.size === 0) return;
  if (pool.slots.items !== items) {
    pool.slots.byId.clear();
    const count = Math.min(items.length, pool.capacity);
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (item !== undefined) pool.slots.byId.set(item.id, index);
    }
    pool.slots.items = items;
  }
  let first = pool.capacity;
  let last = -1;
  const draw = (id: string, offset: { readonly x: number; readonly z: number } | null): void => {
    const slot = pool.slots.byId.get(id);
    const item = slot === undefined ? undefined : items[slot];
    if (slot === undefined || item === undefined) return;
    composeEditableSlot(pool, slot, item, editableInstanceScale(item, itemScale), offset);
    first = Math.min(first, slot);
    last = Math.max(last, slot);
  };
  const liveIds = new Set(live);
  for (const id of pool.settling) {
    if (liveIds.has(id)) continue;
    pool.settling.delete(id);
    draw(id, null);
  }
  for (const id of live) {
    const offset = furnitureSettleOffset(id);
    if (offset === null || !pool.slots.byId.has(id)) continue;
    pool.settling.add(id);
    draw(id, offset);
  }
  if (last >= 0) uploadEditableSlots(pool, first, last);
}

/** Release the pool's instance buffers and renderer state. The layer owns geometry and materials. */
export function disposeEditableInstancePool(pool: EditableInstancePool): void {
  for (const mesh of pool.meshes) mesh.dispose();
}

/**
 * Editable planner furniture of one variant. A drag re-renders this component
 * once, not a React child per item, and frames that change nothing do no
 * instance work. The pool never shrinks while mounted and grows by doubling,
 * so routine edits keep its meshes and their compiled pipelines.
 */
function EditableVariantBatch({
  variant,
  items,
  itemScale,
}: {
  readonly variant: HarvestedVariant;
  readonly items: readonly PlacedItem[];
  readonly itemScale: number;
}): React.ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const [heldCapacity, setHeldCapacity] = useState(() => instanceCapacityFor(items.length));
  const capacity = Math.max(heldCapacity, instanceCapacityFor(items.length));
  // Growth is adjusted during render so the larger pool is built in this pass.
  if (capacity !== heldCapacity) setHeldCapacity(capacity);
  const pool = useMemo(() => createEditableInstancePool(variant, capacity), [variant, capacity]);
  const drawn = useRef({ items, itemScale });

  useLayoutEffect(() => () => { disposeEditableInstancePool(pool); }, [pool]);

  useLayoutEffect(() => {
    drawn.current = { items, itemScale };
    if (writeEditableInstancePool(pool, items, itemScale)) invalidate();
  }, [invalidate, itemScale, items, pool]);

  // Runs inside FurnitureMotion's frame, before that frame renders.
  useLayoutEffect(() => subscribeFurnitureSettleFrames((live) => {
    drawEditableSettleFrame(pool, drawn.current.items, drawn.current.itemScale, live);
  }), [pool]);

  return <>{pool.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}</>;
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
      dispose={null}
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
  /**
   * Timeline previews: an exactly sized InstancedMesh per material group,
   * rebuilt with each frozen item set. Editable furniture uses pooled batches.
   */
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
  const [templateRevision, setTemplateRevision] = useState(0);
  const handleTemplateReady = useCallback(() => {
    setTemplateRevision((revision) => revision + 1);
  }, []);

  // Re-harvest when variants change or an asynchronous GLTF resolves, never on drag. The
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
  }, [variantSignature, templateRevision, invalidate, onFailedVariantIdsChange]);

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
      <GltfFurnitureTemplateContext.Provider value={handleTemplateReady}>
      <group ref={templateRef} visible={false} raycast={skipSubtreeRaycast}>
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
      </GltfFurnitureTemplateContext.Provider>

      {/* Visible instanced models — one InstancedMesh per variant per material group. */}
      {variantOrder.map((key) => {
        const variant = harvested.get(key);
        const variantItems = itemsByVariant.get(key);
        if (variant === undefined || variantItems === undefined || variantItems.length === 0) {
          return null;
        }
        if (!directInstances) {
          return (
            <EditableVariantBatch
              key={key}
              variant={variant}
              items={variantItems}
              itemScale={itemScale}
            />
          );
        }
        return variant.groups.map((group, groupIndex) => {
          const material = variant.materialByKey.get(group.materialKey);
          const shadows = variant.shadowsByKey.get(group.materialKey);
          if (material === undefined || shadows === undefined) return null;
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
        });
      })}
    </group>
  );
}
