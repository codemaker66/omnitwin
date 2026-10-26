// ---------------------------------------------------------------------------
// WarmPlacedVariants — compile a piece's placed look while it is in hand
//
// A placed piece is drawn by InstancedFurnitureLayer: the first piece of a
// kind is rendered once into a hidden template, harvested into merged
// geometries and cloned materials, and drawn as instanced batches. Those
// batches are pipelines the ghost never drew, so the first round set down on
// an empty floor compiled 7 shader modules and 4 pipelines on the frames after
// it landed (scripts/phone-drag-budget.mjs, "after the lift"): a stall at the
// moment the planner should feel most solid, longer on a phone's GPU.
//
// While a piece is in hand this harvests the same templates through the
// layer's own functions and draws each batch once per frame for its first
// frames, one instance, too small to see, just ahead of the camera. The
// planner keeps every pipeline it compiles (lib/pipeline-retention.ts), so the
// drop finds them ready. A table brings its seats, so they are warmed with it.
//
// It relies on our three patch (patches/three@0.186.0.patch, WGSLNodeBuilder):
// three r186 named each uniform buffer after its node id, which made every
// InstancedMesh's vertex shader its own code, so a warmed batch never shared a
// program with the layer's. Numbered in each shader's own order, they do.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Matrix4, Object3D, Vector3, type Group, type InstancedMesh } from "three";
import { createEditableInstancePool, disposeVariant, harvestVariant, instanceCapacityFor } from "./editor/InstancedFurnitureLayer.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { GltfFurnitureTemplateContext } from "./meshes/GltfFurnitureTemplateContext.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../lib/catalogue.js";
import { DEFAULT_PLANNER_CHAIR_SLUG } from "../lib/furniture-defaults.js";
import { isDiningTableItem } from "../lib/furniture-semantics.js";
import { onMainDraw } from "../lib/main-draw-clock.js";
import { isTableDressingApplicator } from "../lib/table-dressing.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";

/** Draws of the main view the batches take part in: enough for every pass of a frame to draw them. */
export const WARM_PLACED_FRAMES = 3;
/**
 * Frame updates the warm-up asks for at most. NativeCanvas paces its draws by the GPU's progress, so
 * an update behind unfinished GPU work draws nothing (lib/main-draw-clock.ts): the warm-up counts draws,
 * and asks for updates until it has them, but not forever where nothing draws.
 */
export const WARM_PLACED_UPDATES = 60;
const WARM_SCALE = 1e-4;
const IDENTITY = new Matrix4();
const _ahead = new Vector3();
/** The most pieces of one kind a single drop sets down: a round table's seats. */
const MOST_LANDING = 12;
/** The templates sit at the origin: no raycast may find them (a false return skips the subtree). */
const skipSubtreeRaycast = (): boolean => false;

type HarvestedVariant = ReturnType<typeof harvestVariant>;

/**
 * A batch to warm: a kind of piece, and the capacity of the pool it will be drawn from. three's
 * node renderer sizes the instance-matrix binding it compiles from the pool's capacity, so a pool
 * of any other size warms another shader.
 */
export interface WarmPool {
  readonly item: CatalogueItem;
  readonly capacity: number;
}

export interface WarmPlacedVariantsProps {
  /** The pools the next drop draws from: the piece in hand's, and a table's seats'. */
  readonly pools: readonly WarmPool[];
}

/** Draws the batches the given pieces will be drawn with once placed, so they compile now. */
export function WarmPlacedVariants({ pools }: WarmPlacedVariantsProps): ReactElement {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const templates = useRef<Group>(null);
  const batches = useRef<Group>(null);
  const drawsLeft = useRef(0);
  const updatesLeft = useRef(0);
  // An imported model resolves after mount; its template then harvests again, as the layer's does.
  const [templateRevision, setTemplateRevision] = useState(0);
  const onTemplateReady = useCallback(() => { setTemplateRevision((revision) => revision + 1); }, []);
  const poolsKey = pools.map((pool) => `${pool.item.id}@${String(pool.capacity)}`).join("|");
  const items = [...new Map(pools.map((pool) => [pool.item.id, pool.item])).values()];

  useLayoutEffect(() => {
    const root = templates.current;
    const target = batches.current;
    // Only a three object has templates to harvest (the planner's DOM tests render this tree into the page).
    if (!(root instanceof Object3D) || !(target instanceof Object3D)) return undefined;
    const variants = new Map<string, HarvestedVariant>();
    const meshes: InstancedMesh[] = [];
    for (const { item, capacity } of pools) {
      let variant = variants.get(item.id);
      if (variant === undefined) {
        const node = root.getObjectByName(`warm-template-${item.id}`);
        if (node === undefined) continue;
        try {
          variant = harvestVariant(node);
        } catch {
          // The layer draws a piece it cannot harvest by its own per-item path, which the ghost warmed.
          continue;
        }
        variants.set(item.id, variant);
      }
      const pool = createEditableInstancePool(variant, capacity);
      for (const mesh of pool.meshes) {
        mesh.setMatrixAt(0, IDENTITY);
        mesh.count = 1;
        meshes.push(mesh);
      }
      pool.matrices.needsUpdate = true;
    }
    if (meshes.length > 0) target.add(...meshes);
    drawsLeft.current = WARM_PLACED_FRAMES;
    updatesLeft.current = WARM_PLACED_UPDATES;
    target.visible = meshes.length > 0;
    invalidate();
    return () => {
      if (meshes.length > 0) target.remove(...meshes);
      target.visible = false;
      for (const variant of variants.values()) disposeVariant(variant);
    };
    // poolsKey is the identity of `pools`, read inside.
  }, [poolsKey, templateRevision, invalidate]);

  // A draw of the main view while the batches are shown is a draw they took part in.
  useEffect(() => onMainDraw(() => {
    const target = batches.current;
    if (target instanceof Object3D && target.visible && drawsLeft.current > 0) drawsLeft.current -= 1;
  }), []);

  useFrame(() => {
    const target = batches.current;
    if (!(target instanceof Object3D) || !target.visible) return;
    // Shown until WARM_PLACED_FRAMES draws have taken them in, then hidden on the next update.
    if (drawsLeft.current === 0 || updatesLeft.current === 0) {
      target.visible = false;
      return;
    }
    updatesLeft.current -= 1;
    camera.getWorldDirection(_ahead);
    target.position.copy(camera.position).addScaledVector(_ahead, 1);
    invalidate();
  });

  return (
    <group name="warm-placed-variants">
      <GltfFurnitureTemplateContext.Provider value={onTemplateReady}>
        <group ref={templates} visible={false} raycast={skipSubtreeRaycast}>
          {items.map((item) => (
            <group key={item.id} name={`warm-template-${item.id}`}>
              <FurnitureProxy item={item} position={[0, 0, 0]} rotationY={0} />
            </group>
          ))}
        </group>
      </GltfFurnitureTemplateContext.Provider>
      <group ref={batches} visible={false} scale={WARM_SCALE} />
    </group>
  );
}

/** What lands when `item` is set down: the piece, and a dining table's seats (lib/table-group.ts). */
export function landsWith(item: CatalogueItem): readonly CatalogueItem[] {
  if (!isDiningTableItem(item)) return [item];
  const chair = getCatalogueItemBySlug(DEFAULT_PLANNER_CHAIR_SLUG);
  return chair === undefined ? [item] : [item, chair];
}

/**
 * The pools the next drop of `item` draws from, given how many of each kind are already placed:
 * every capacity the layer's pool can reach with the pieces that land (the piece itself, one at a
 * time; a table's seats, up to MOST_LANDING). On an empty floor that is the first pool; near a
 * doubling it is the doubled one too, so the 33rd chair compiles nothing either.
 */
export function poolsLanding(item: CatalogueItem, placedOfKind: (id: string) => number): readonly WarmPool[] {
  const pools: WarmPool[] = [];
  for (const piece of landsWith(item)) {
    const placed = placedOfKind(piece.id);
    const landing = piece.id === item.id ? 1 : MOST_LANDING;
    const capacities = new Set<number>();
    for (let count = 1; count <= landing; count++) capacities.add(instanceCapacityFor(placed + count));
    for (const capacity of capacities) pools.push({ item: piece, capacity });
  }
  return pools;
}

/**
 * Warms the placed look of the piece in hand from the moment it is armed, before the pointer
 * reaches the floor, and again after a drop when the next one would grow a pool. Table dressing
 * (a cloth, a setting) lands on a table rather than as a piece.
 */
export function WarmPieceInHand(): ReactElement | null {
  const selectedItemId = useCatalogueStore((state) => state.selectedItemId);
  const item = selectedItemId === null || isTableDressingApplicator(selectedItemId) ? undefined : getCatalogueItem(selectedItemId);
  const kinds = item === undefined ? [] : landsWith(item).map((piece) => piece.id);
  // How many of each landing kind are placed, as one string: a drag that moves pieces re-renders nothing.
  const placed = usePlacementStore((state) => kinds
    .map((id) => String(state.placedItems.reduce((count, placedItem) => (placedItem.catalogueItemId === id ? count + 1 : count), 0)))
    .join("|"));
  if (item === undefined) return null;
  const counts = new Map(kinds.map((id, index) => [id, Number(placed.split("|")[index] ?? 0)]));
  const pools = poolsLanding(item, (id) => counts.get(id) ?? 0);
  return <WarmPlacedVariants key={item.id} pools={pools} />;
}
