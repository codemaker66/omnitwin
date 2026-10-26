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

import { useCallback, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Matrix4, Object3D, Vector3, type Group, type InstancedMesh } from "three";
import { createEditableInstancePool, disposeVariant, harvestVariant, instanceCapacityFor } from "./editor/InstancedFurnitureLayer.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { GltfFurnitureTemplateContext } from "./meshes/GltfFurnitureTemplateContext.js";
import { getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../lib/catalogue.js";
import { DEFAULT_PLANNER_CHAIR_SLUG } from "../lib/furniture-defaults.js";
import { isDiningTableItem } from "../lib/furniture-semantics.js";
import { isTableDressingApplicator } from "../lib/table-dressing.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";

/** Frames each batch is drawn: enough for every pass of the frame to draw it once. */
export const WARM_PLACED_FRAMES = 3;
const WARM_SCALE = 1e-4;
const IDENTITY = new Matrix4();
const _ahead = new Vector3();
/**
 * The pool a first piece of a kind is drawn from. three's node renderer sizes the instance-matrix
 * binding it compiles from the pool's capacity, so a pool of any other size warms another shader.
 */
const FIRST_CAPACITY = instanceCapacityFor(1);
/** The templates sit at the origin: no raycast may find them (a false return skips the subtree). */
const skipSubtreeRaycast = (): boolean => false;

type HarvestedVariant = ReturnType<typeof harvestVariant>;

export interface WarmPlacedVariantsProps {
  /** Everything that lands when the piece in hand is set down: the piece, and a table's seats. */
  readonly items: readonly CatalogueItem[];
}

/** Draws the batches the given pieces will be drawn with once placed, so they compile now. */
export function WarmPlacedVariants({ items }: WarmPlacedVariantsProps): ReactElement {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const templates = useRef<Group>(null);
  const batches = useRef<Group>(null);
  const framesLeft = useRef(0);
  // An imported model resolves after mount; its template then harvests again, as the layer's does.
  const [templateRevision, setTemplateRevision] = useState(0);
  const onTemplateReady = useCallback(() => { setTemplateRevision((revision) => revision + 1); }, []);
  const itemsKey = items.map((item) => item.id).join("|");

  useLayoutEffect(() => {
    const root = templates.current;
    const target = batches.current;
    // Only a three object has templates to harvest (the planner's DOM tests render this tree into the page).
    if (!(root instanceof Object3D) || !(target instanceof Object3D)) return undefined;
    const variants: HarvestedVariant[] = [];
    const meshes: InstancedMesh[] = [];
    for (const item of items) {
      const node = root.getObjectByName(`warm-template-${item.id}`);
      if (node === undefined) continue;
      let variant: HarvestedVariant;
      try {
        variant = harvestVariant(node);
      } catch {
        // The layer draws a piece it cannot harvest by its own per-item path, which the ghost warmed.
        continue;
      }
      variants.push(variant);
      const pool = createEditableInstancePool(variant, FIRST_CAPACITY);
      for (const mesh of pool.meshes) {
        mesh.setMatrixAt(0, IDENTITY);
        mesh.count = 1;
        meshes.push(mesh);
      }
      pool.matrices.needsUpdate = true;
    }
    if (meshes.length > 0) target.add(...meshes);
    framesLeft.current = WARM_PLACED_FRAMES;
    target.visible = meshes.length > 0;
    invalidate();
    return () => {
      if (meshes.length > 0) target.remove(...meshes);
      target.visible = false;
      for (const variant of variants) disposeVariant(variant);
    };
    // itemsKey is the identity of `items`, read inside.
  }, [itemsKey, templateRevision, invalidate]);

  useFrame(() => {
    const target = batches.current;
    if (!(target instanceof Object3D) || !target.visible) return;
    // Drawn for WARM_PLACED_FRAMES frames, then hidden on the next.
    if (framesLeft.current === 0) {
      target.visible = false;
      return;
    }
    framesLeft.current -= 1;
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
 * Warms the placed look of the piece in hand from the moment it is armed, before the pointer
 * reaches the floor. Table dressing (a cloth, a setting) lands on a table rather than as a piece.
 */
export function WarmPieceInHand(): ReactElement | null {
  const selectedItemId = useCatalogueStore((state) => state.selectedItemId);
  if (selectedItemId === null || isTableDressingApplicator(selectedItemId)) return null;
  const item = getCatalogueItem(selectedItemId);
  if (item === undefined) return null;
  return <WarmPlacedVariants key={item.id} items={landsWith(item)} />;
}
