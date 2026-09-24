/**
 * Grand Hall ornamental dressing.
 *
 * Layered on top of the basic 6-surface room (`GrandHallRoom`). The ornaments
 * themselves are described in `grand-hall-ornament-parts.ts`; this component
 * renders that description two ways from the same data:
 *
 *   - the canonical per-mesh tree, one mesh per ornament piece, inside each
 *     surface's `SurfaceVisibilityGroup`; and
 *   - an opaque stand-in per surface, the opaque pieces baked into one draw
 *     per material, with each translucent piece (window glass) kept as its
 *     own object on its original transform.
 *
 * `SurfaceVisibilityGroup` draws the stand-in only while its surface is fully
 * opaque, where the depth buffer makes the opaque result independent of how
 * the geometry is split into draws, and the glass sorts exactly as before.
 * Fading, clicked-open and x-ray surfaces draw the per-mesh tree, whose
 * per-object depth sort sets the blending order. Chandelier fittings never
 * fade, so they are merged outright; their blended crystal keeps its own
 * objects.
 */

import { useEffect, useMemo, useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { Instances, Instance } from "@react-three/drei";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../constants/scale.js";
import { SurfaceVisibilityGroup } from "./SurfaceVisibilityGroup.js";
import { useSectionStore } from "../stores/section-store.js";
import {
  buildOrnamentBatches,
  buildOrnamentStandIn,
  createOrnamentMaterial,
  disposeOrnamentBatches,
  ornamentMaterialProps,
  type OrnamentBatch,
  type OrnamentBatchSet,
  type OrnamentGeometry,
  type OrnamentNode,
  type Vec3,
} from "../lib/ornament-batching.js";
import {
  describeGrandHallOrnaments,
  shouldShowCeilingOrnamentsForSection,
  shouldShowWallOrnamentsForSection,
  type ChandelierDescription,
  type OrnamentSurface,
} from "./grand-hall-ornament-parts.js";

export {
  CEILING_ORNAMENT_SECTION_EPSILON_M,
  WAINSCOT_PANEL_TOP_Y,
  WALL_ORNAMENT_SECTION_HIDE_BELOW_M,
  WINDOW_SILL_Y,
  WINDOW_WALL_RESERVED_BAY_HALF_WIDTH,
  computeOppositeLongWallChairRailSegments,
  computeOppositeLongWallDoorCenters,
  computeVisibleLongWainscotPanelCenters,
  computeVisibleShortWainscotPanelCenters,
  computeWindowWallCenters,
  isInWindowWallOpeningBay,
  shouldShowCeilingOrnamentsForSection,
  shouldShowWallOrnamentsForSection,
} from "./grand-hall-ornament-parts.js";
export type { ChairRailSegment } from "./grand-hall-ornament-parts.js";

// ---------------------------------------------------------------------------
// Model — description plus baked stand-ins, rebuilt only when dimensions change
// ---------------------------------------------------------------------------

export interface OrnamentSurfaceEntry {
  readonly surface: OrnamentSurface;
  /** Null where merging would not remove a draw; the per-mesh tree is then always drawn. */
  readonly standIn: OrnamentBatchSet | null;
}

export type OrnamentWallLayerEntry =
  | { readonly kind: "surface"; readonly entry: OrnamentSurfaceEntry }
  | { readonly kind: "cluster"; readonly name: string; readonly entries: readonly OrnamentSurfaceEntry[] };

export interface GrandHallOrnamentModel {
  readonly ceiling: readonly OrnamentSurfaceEntry[];
  readonly walls: readonly OrnamentWallLayerEntry[];
  readonly rosette: readonly OrnamentSurfaceEntry[];
  readonly chandeliers: readonly ChandelierDescription[];
  /** Every chandelier's opaque fittings, relative to the ornament root. */
  readonly chandelierFittings: OrnamentBatchSet;
}

function surfaceEntry(surface: OrnamentSurface): OrnamentSurfaceEntry {
  return { surface, standIn: buildOrnamentStandIn(surface.children) };
}

export function buildGrandHallOrnamentModel(width: number, length: number, height: number): GrandHallOrnamentModel {
  const description = describeGrandHallOrnaments(width, length, height);
  return {
    ceiling: description.ceiling.map(surfaceEntry),
    walls: description.walls.map((layer): OrnamentWallLayerEntry => (
      layer.kind === "surface"
        ? { kind: "surface", entry: surfaceEntry(layer) }
        : { kind: "cluster", name: layer.name, entries: layer.surfaces.map(surfaceEntry) }
    )),
    rosette: description.rosette.map(surfaceEntry),
    chandeliers: description.chandeliers,
    chandelierFittings: buildOrnamentBatches(description.chandeliers.map((chandelier): OrnamentNode => ({
      kind: "group",
      position: chandelier.placement.position,
      scale: chandelier.placement.scale,
      children: chandelier.fittings,
    }))),
  };
}

export function disposeGrandHallOrnamentModel(model: GrandHallOrnamentModel): void {
  const entries = [
    ...model.ceiling,
    ...model.walls.flatMap((layer) => (layer.kind === "surface" ? [layer.entry] : layer.entries)),
    ...model.rosette,
  ];
  for (const entry of entries) {
    if (entry.standIn !== null) disposeOrnamentBatches(entry.standIn);
  }
  disposeOrnamentBatches(model.chandelierFittings);
}

// ---------------------------------------------------------------------------
// Per-mesh rendering of the description
// ---------------------------------------------------------------------------

function tuple(value: Vec3 | undefined): [number, number, number] | undefined {
  return value === undefined ? undefined : [value[0], value[1], value[2]];
}

function OrnamentGeometryElement({ spec }: { readonly spec: OrnamentGeometry }): React.ReactElement {
  switch (spec.kind) {
    case "box": return <boxGeometry args={[...spec.args]} />;
    case "sphere": return <sphereGeometry args={[...spec.args]} />;
    case "cylinder": return <cylinderGeometry args={[...spec.args]} />;
    case "plane": return <planeGeometry args={[...spec.args]} />;
    case "circle": return <circleGeometry args={[...spec.args]} />;
    case "ring": return <ringGeometry args={[...spec.args]} />;
    case "torus": return <torusGeometry args={[...spec.args]} />;
  }
}

function OrnamentNodeElement({ node }: { readonly node: OrnamentNode }): React.ReactElement {
  if (node.kind === "group") {
    return (
      <group name={node.name} position={tuple(node.position)} rotation={tuple(node.rotation)} scale={tuple(node.scale)}>
        {node.children.map((child, i) => <OrnamentNodeElement key={String(i)} node={child} />)}
      </group>
    );
  }
  if (node.kind === "mesh") {
    return (
      <mesh name={node.name} position={tuple(node.position)} rotation={tuple(node.rotation)}>
        <OrnamentGeometryElement spec={node.geometry} />
        <meshStandardMaterial {...ornamentMaterialProps(node.material)} />
      </mesh>
    );
  }
  return (
    <Instances limit={node.instances.length} range={node.instances.length} name={node.name}>
      <OrnamentGeometryElement spec={node.geometry} />
      <meshStandardMaterial {...ornamentMaterialProps(node.material)} />
      {node.instances.map((instance, i) => (
        <Instance key={String(i)} position={tuple(instance.position)} rotation={tuple(instance.rotation)} />
      ))}
    </Instances>
  );
}

// ---------------------------------------------------------------------------
// Merged batches
// ---------------------------------------------------------------------------

function batchMaterialKey(batch: OrnamentBatch, index: number): string {
  return `${String(index)}|${batch.key}`;
}

/**
 * One material per batch, created while this component renders — the same
 * slot in the scene's material-creation order that the per-mesh materials it
 * replaces occupied, which three's opaque sort (by material id) relies on for
 * depth-write-disabled barriers. Stable across re-renders: a rebuilt set keeps
 * the materials of the batches it still has and releases the rest; everything
 * is released on unmount.
 */
function useBatchMaterials(set: OrnamentBatchSet | null): readonly MeshStandardMaterial[] {
  const cache = useRef<Map<string, MeshStandardMaterial> | null>(null);
  cache.current ??= new Map();
  const materials = cache.current;
  const batchMaterials = (set?.batches ?? []).map((batch, index) => {
    const key = batchMaterialKey(batch, index);
    let material = materials.get(key);
    if (material === undefined) {
      material = createOrnamentMaterial(batch.material);
      materials.set(key, material);
    }
    return material;
  });
  useEffect(() => {
    const used = new Set((set?.batches ?? []).map(batchMaterialKey));
    for (const [key, material] of materials) {
      if (used.has(key)) continue;
      material.dispose();
      materials.delete(key);
    }
  }, [materials, set]);
  useEffect(() => () => {
    for (const material of materials.values()) material.dispose();
  }, [materials]);
  return batchMaterials;
}

function OrnamentBatchMeshes({
  name,
  set,
  materials,
}: {
  readonly name: string;
  readonly set: OrnamentBatchSet;
  readonly materials: readonly MeshStandardMaterial[];
}): React.ReactElement {
  return (
    <>
      {set.batches.map((batch, i) => (
        batch.transform === null ? (
          <mesh key={String(i)} name={`${name}-batch-${String(i)}`} geometry={batch.geometry} material={materials[i]} />
        ) : (
          // One piece on its original transform: bit-identical to its per-mesh draw.
          <mesh
            key={String(i)}
            name={`${name}-batch-${String(i)}`}
            geometry={batch.geometry}
            material={materials[i]}
            matrix={batch.transform}
            matrixAutoUpdate={false}
          />
        )
      ))}
    </>
  );
}

function OrnamentSurfaceElement({ entry }: { readonly entry: OrnamentSurfaceEntry }): React.ReactElement {
  const { surface, standIn } = entry;
  const materials = useBatchMaterials(standIn);
  return (
    <SurfaceVisibilityGroup
      surfaceKey={surface.surfaceKey}
      name={surface.name}
      opaqueStandIn={standIn === null ? undefined : <OrnamentBatchMeshes name={surface.name} set={standIn} materials={materials} />}
    >
      {surface.children.map((node, i) => <OrnamentNodeElement key={String(i)} node={node} />)}
    </SurfaceVisibilityGroup>
  );
}

function Chandeliers({
  chandeliers,
  fittings,
}: {
  readonly chandeliers: readonly ChandelierDescription[];
  readonly fittings: OrnamentBatchSet;
}): React.ReactElement {
  const materials = useBatchMaterials(fittings);
  return (
    <>
      <group name="chandelier-fittings">
        <OrnamentBatchMeshes name="chandelier-fittings" set={fittings} materials={materials} />
      </group>
      {chandeliers.map((chandelier, i) => (
        <group
          key={`chandelier-${String(i)}`}
          name="chandelier"
          position={tuple(chandelier.placement.position)}
          scale={tuple(chandelier.placement.scale)}
        >
          {chandelier.crystal.map((node, j) => <OrnamentNodeElement key={String(j)} node={node} />)}
        </group>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Public composite
// ---------------------------------------------------------------------------

export interface GrandHallOrnamentsProps {
  readonly width?: number;
  readonly length?: number;
  readonly height?: number;
}

/**
 * Drop-in component that adds every ornament in one group. Defaults to the
 * Grand Hall render dimensions; override per-call for ablations.
 */
export function GrandHallOrnaments({
  width = GRAND_HALL_RENDER_DIMENSIONS.width,
  length = GRAND_HALL_RENDER_DIMENSIONS.length,
  height = GRAND_HALL_RENDER_DIMENSIONS.height,
}: GrandHallOrnamentsProps): React.ReactElement {
  const sectionHeight = useSectionStore((s) => s.height);
  const model = useMemo(() => buildGrandHallOrnamentModel(width, length, height), [width, length, height]);
  useEffect(() => () => { disposeGrandHallOrnamentModel(model); }, [model]);

  const wallOrnamentsVisible = shouldShowWallOrnamentsForSection(sectionHeight, height);
  const ceilingOrnamentsVisible = shouldShowCeilingOrnamentsForSection(sectionHeight, height);

  return (
    <group name="grand-hall-ornaments">
      {ceilingOrnamentsVisible && model.ceiling.map((entry) => (
        <OrnamentSurfaceElement key={entry.surface.name} entry={entry} />
      ))}
      {wallOrnamentsVisible && model.walls.map((layer) => (
        layer.kind === "surface" ? (
          <OrnamentSurfaceElement key={layer.entry.surface.name} entry={layer.entry} />
        ) : (
          <group key={layer.name} name={layer.name}>
            {layer.entries.map((entry) => <OrnamentSurfaceElement key={entry.surface.name} entry={entry} />)}
          </group>
        )
      ))}
      {ceilingOrnamentsVisible && model.rosette.map((entry) => (
        <OrnamentSurfaceElement key={entry.surface.name} entry={entry} />
      ))}
      {ceilingOrnamentsVisible && <Chandeliers chandeliers={model.chandeliers} fittings={model.chandelierFittings} />}
    </group>
  );
}
