import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  DynamicDrawUsage,
  Group,
  Material,
  MeshStandardMaterial,
  type InstancedMesh,
  type Object3D,
} from "three";
import type { PlacedItem } from "../../lib/placement.js";
import {
  TIMELINE_IMPERATIVE_MORPH_THRESHOLD,
  timelineTransitionUsesImperativeMorph,
  type TimelineItemTransitionPlan,
} from "../../lib/layout-timeline.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import { toRenderSpace } from "../../constants/scale.js";
import {
  TIMELINE_CAPTURE_FURNITURE_GROUP,
  TIMELINE_PREVIEW_FURNITURE_GROUP,
} from "../../lib/layout-timeline-capture.js";
import {
  useLayoutTimelinePreviewStore,
  type LayoutTimelinePreviewFrameMetadata,
  type LayoutTimelinePreviewTransition,
  type LayoutTimelinePreviewTransitionMode,
} from "../../stores/layout-timeline-preview-store.js";
import { FurnitureProxy } from "../FurnitureProxy.js";
import { InstancedFurnitureLayer } from "./InstancedFurnitureLayer.js";

export type TimelinePreviewOpacityRole = "fixed" | "from-progress" | "to-progress";

export interface TimelinePreviewRenderLayer {
  readonly key: "settled" | "morph" | "from" | "to";
  readonly items: readonly PlacedItem[];
  readonly opacityRole: TimelinePreviewOpacityRole;
}

export type TimelineFurnitureRenderKind = "catalogue" | "canonical-fallback" | "unavailable";

function isRoundCollision(collisionType: string): boolean {
  return collisionType === "circle" || collisionType === "cylinder";
}

function dimensionsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

/**
 * A frozen snapshot's embedded definition is the historical source of truth.
 * The richer live-catalogue renderer is safe only while its geometry still
 * describes that exact definition; otherwise the canonical snapshot proxy is
 * used so catalogue edits cannot rewrite history on screen.
 */
function catalogueMatchesEmbeddedDefinition(item: PlacedItem): boolean {
  const catalogue = getCatalogueItem(item.catalogueItemId);
  const definition = item.embeddedAssetDefinition;
  if (catalogue === undefined || definition === undefined) return false;
  return catalogue.category === definition.category
    && dimensionsMatch(catalogue.width, definition.widthM)
    && dimensionsMatch(catalogue.height, definition.heightM)
    && dimensionsMatch(catalogue.depth, definition.depthM)
    && (catalogue.tableShape === "round") === isRoundCollision(definition.collisionType);
}

export function timelineFurnitureRenderKind(item: PlacedItem): TimelineFurnitureRenderKind {
  const catalogue = getCatalogueItem(item.catalogueItemId);
  const definition = item.embeddedAssetDefinition;
  if (definition !== undefined) {
    return catalogueMatchesEmbeddedDefinition(item) ? "catalogue" : "canonical-fallback";
  }
  return catalogue === undefined ? "unavailable" : "catalogue";
}

const EMPTY_ITEMS: readonly PlacedItem[] = [];
export const TIMELINE_SIMPLIFIED_LOD_THRESHOLD = TIMELINE_IMPERATIVE_MORPH_THRESHOLD;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function timelinePreviewUsesSimplifiedLod(itemCount: number): boolean {
  return itemCount > TIMELINE_SIMPLIFIED_LOD_THRESHOLD;
}

interface TimelineProxySpec {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly round: boolean;
  readonly colour: string;
}

export interface TimelineSimplifiedProxyDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface TimelineProxyBatch extends TimelineProxySpec {
  readonly items: readonly PlacedItem[];
}

function proxyColour(category: string): string {
  if (category === "table") return "#d5b557";
  if (category === "chair") return "#a82020";
  if (category === "stage") return "#8d6aa8";
  return "#8e978f";
}

export function timelineSimplifiedProxyDimensions(
  item: PlacedItem,
): TimelineSimplifiedProxyDimensions | null {
  const catalogue = getCatalogueItem(item.catalogueItemId);
  const definition = item.embeddedAssetDefinition;
  if (catalogue === undefined && definition === undefined) return null;
  return {
    width: toRenderSpace(definition?.widthM ?? catalogue?.width ?? 0),
    height: definition?.heightM ?? catalogue?.height ?? 0,
    depth: toRenderSpace(definition?.depthM ?? catalogue?.depth ?? 0),
  };
}

function timelineProxySpec(item: PlacedItem): TimelineProxySpec | null {
  const catalogue = getCatalogueItem(item.catalogueItemId);
  const definition = item.embeddedAssetDefinition;
  const dimensions = timelineSimplifiedProxyDimensions(item);
  if (dimensions === null) return null;
  const { width, height, depth } = dimensions;
  const category = definition?.category ?? catalogue?.category ?? "object";
  const round = definition === undefined
    ? catalogue?.tableShape === "round"
    : isRoundCollision(definition.collisionType);
  const colour = definition === undefined && catalogue !== undefined
    ? catalogue.color
    : proxyColour(category);
  return {
    key: [item.catalogueItemId, width, height, depth, round ? "round" : "box", colour].join(":"),
    width,
    height,
    depth,
    round,
    colour,
  };
}

function writeTimelineProxyMatrix(
  target: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  rotationY: number,
  scale: number,
  height: number,
): void {
  const offset = index * 16;
  const cosine = Math.cos(rotationY) * scale;
  const sine = Math.sin(rotationY) * scale;
  target[offset] = cosine;
  target[offset + 1] = 0;
  target[offset + 2] = -sine;
  target[offset + 3] = 0;
  target[offset + 4] = 0;
  target[offset + 5] = scale;
  target[offset + 6] = 0;
  target[offset + 7] = 0;
  target[offset + 8] = sine;
  target[offset + 9] = 0;
  target[offset + 10] = cosine;
  target[offset + 11] = 0;
  target[offset + 12] = x;
  target[offset + 13] = y + (height * scale) / 2;
  target[offset + 14] = z;
  target[offset + 15] = 1;
}

export interface TimelineUniformMorphTranslation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function normalizedAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Detects the common large-room case where an entire saved arrangement shifts
 * rigidly. It can be animated with one group transform instead of rewriting
 * hundreds of instance matrices, while non-rigid plans retain full per-item
 * interpolation.
 */
export function timelineUniformMorphTranslation(
  plan: TimelineItemTransitionPlan,
): TimelineUniformMorphTranslation | null {
  if (
    plan.pairs.length !== plan.fromItems.length
    || plan.pairs.length !== plan.toItems.length
    || plan.unmatchedFrom.length > 0
    || plan.unmatchedTo.length > 0
  ) return null;

  let translation: TimelineUniformMorphTranslation | null = null;
  for (const { from, to } of plan.pairs) {
    const fromSpec = timelineProxySpec(from);
    const toSpec = timelineProxySpec(to);
    if (
      fromSpec === null
      || toSpec === null
      || fromSpec.key !== toSpec.key
      || Math.abs((from.scale ?? 1) - (to.scale ?? 1)) > 1e-6
      || Math.abs(normalizedAngleDelta(from.rotationY, to.rotationY)) > 1e-6
    ) return null;
    const candidate = {
      x: to.x - from.x,
      y: to.y - from.y,
      z: to.z - from.z,
    };
    if (translation === null) {
      translation = candidate;
      continue;
    }
    if (
      Math.abs(candidate.x - translation.x) > 1e-6
      || Math.abs(candidate.y - translation.y) > 1e-6
      || Math.abs(candidate.z - translation.z) > 1e-6
    ) return null;
  }
  return translation ?? { x: 0, y: 0, z: 0 };
}

function TimelineProxyBatchMesh({
  batch,
  opacitySource,
}: {
  readonly batch: TimelineProxyBatch;
  readonly opacitySource?: () => number;
}): ReactElement {
  const meshRef = useRef<InstancedMesh | null>(null);
  const materialRef = useRef<MeshStandardMaterial | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const lastOpacity = useRef<number | null>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    mesh.count = batch.items.length;
    const matrices = mesh.instanceMatrix.array as Float32Array;
    for (let index = 0; index < batch.items.length; index += 1) {
      const item = batch.items[index];
      if (item === undefined) continue;
      const scale = item.scale ?? 1;
      writeTimelineProxyMatrix(
        matrices,
        index,
        item.x,
        item.y,
        item.z,
        item.rotationY,
        scale,
        batch.height,
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [batch, invalidate]);

  const driveOpacity = (): void => {
    const material = materialRef.current;
    if (material === null) return;
    const next = clamp01(opacitySource?.() ?? 1);
    if (next === lastOpacity.current) return;
    material.opacity = next;
    material.transparent = next < 1;
    material.depthWrite = next >= 1;
    material.needsUpdate = true;
    lastOpacity.current = next;
  };

  useLayoutEffect(() => {
    driveOpacity();
    invalidate();
  });
  useFrame(driveOpacity);

  return (
    <instancedMesh
      ref={(mesh) => {
        meshRef.current = mesh;
        if (mesh !== null) mesh.raycast = () => undefined;
      }}
      args={[undefined, undefined, Math.max(1, batch.items.length)]}
      count={batch.items.length}
      frustumCulled={false}
    >
      {batch.round
        ? <cylinderGeometry args={[Math.max(batch.width, batch.depth) / 2, Math.max(batch.width, batch.depth) / 2, batch.height, 10]} />
        : <boxGeometry args={[batch.width, batch.height, batch.depth]} />}
      <meshStandardMaterial
        ref={materialRef}
        color={batch.colour}
        roughness={0.72}
        metalness={0.04}
      />
    </instancedMesh>
  );
}

function TimelineSimplifiedFurnitureLayer({
  items,
  opacitySource,
}: {
  readonly items: readonly PlacedItem[];
  readonly opacitySource?: () => number;
}): ReactElement {
  const batches = useMemo(() => {
    const byKey = new Map<string, { spec: TimelineProxySpec; items: PlacedItem[] }>();
    for (const item of items) {
      const spec = timelineProxySpec(item);
      if (spec === null) continue;
      const current = byKey.get(spec.key);
      if (current === undefined) byKey.set(spec.key, { spec, items: [item] });
      else current.items.push(item);
    }
    return [...byKey.values()].map(({ spec, items: batchItems }): TimelineProxyBatch => ({
      ...spec,
      items: batchItems,
    }));
  }, [items]);
  return (
    <group name="timeline-simplified-lod">
      {batches.map((batch) => (
        <TimelineProxyBatchMesh key={batch.key} batch={batch} opacitySource={opacitySource} />
      ))}
    </group>
  );
}

interface TimelineMorphProxyBatch extends TimelineProxySpec {
  readonly index: number;
  readonly capacity: number;
}

interface TimelineMorphProxyEndpoint {
  readonly item: PlacedItem;
  readonly batchIndex: number;
  readonly height: number;
}

interface TimelineMorphProxyPair {
  readonly fromEndpoint: TimelineMorphProxyEndpoint | null;
  readonly toEndpoint: TimelineMorphProxyEndpoint | null;
  readonly fromX: number;
  readonly deltaX: number;
  readonly fromY: number;
  readonly deltaY: number;
  readonly fromZ: number;
  readonly deltaZ: number;
  readonly fromRotationY: number;
  readonly deltaRotationY: number;
  readonly fromScale: number;
  readonly deltaScale: number;
}

interface CompiledTimelineMorphPlan {
  readonly batches: readonly TimelineMorphProxyBatch[];
  readonly pairs: readonly TimelineMorphProxyPair[];
  readonly unmatchedFrom: readonly TimelineMorphProxyEndpoint[];
  readonly unmatchedTo: readonly TimelineMorphProxyEndpoint[];
}

const EMPTY_COMPILED_TIMELINE_MORPH_PLAN: CompiledTimelineMorphPlan = {
  batches: [],
  pairs: [],
  unmatchedFrom: [],
  unmatchedTo: [],
};

function compileTimelineMorphPlan(plan: TimelineItemTransitionPlan): CompiledTimelineMorphPlan {
  const specs = new Map<string, TimelineProxySpec>();
  const specByItem = new Map<PlacedItem, TimelineProxySpec | null>();
  const fromCounts = new Map<string, number>();
  const toCounts = new Map<string, number>();
  const collect = (items: readonly PlacedItem[], counts: Map<string, number>): void => {
    for (const item of items) {
      const spec = timelineProxySpec(item);
      specByItem.set(item, spec);
      if (spec === null) continue;
      specs.set(spec.key, spec);
      counts.set(spec.key, (counts.get(spec.key) ?? 0) + 1);
    }
  };
  collect(plan.fromItems, fromCounts);
  collect(plan.toItems, toCounts);

  const batches = [...specs.values()].map((spec, index): TimelineMorphProxyBatch => ({
    ...spec,
    index,
    capacity: Math.max(fromCounts.get(spec.key) ?? 0, toCounts.get(spec.key) ?? 0),
  }));
  const batchIndexByKey = new Map(batches.map((batch) => [batch.key, batch.index] as const));
  const endpoint = (item: PlacedItem): TimelineMorphProxyEndpoint | null => {
    const spec = specByItem.get(item) ?? null;
    if (spec === null) return null;
    const batchIndex = batchIndexByKey.get(spec.key);
    if (batchIndex === undefined) return null;
    return { item, batchIndex, height: spec.height };
  };

  return {
    batches,
    pairs: plan.pairs.map(({ from, to }) => {
      const fromScale = from.scale ?? 1;
      const toScale = to.scale ?? 1;
      return {
        fromEndpoint: endpoint(from),
        toEndpoint: endpoint(to),
        fromX: from.x,
        deltaX: to.x - from.x,
        fromY: from.y,
        deltaY: to.y - from.y,
        fromZ: from.z,
        deltaZ: to.z - from.z,
        fromRotationY: from.rotationY,
        deltaRotationY: normalizedAngleDelta(from.rotationY, to.rotationY),
        fromScale,
        deltaScale: toScale - fromScale,
      };
    }),
    unmatchedFrom: plan.unmatchedFrom
      .map(endpoint)
      .filter((value): value is TimelineMorphProxyEndpoint => value !== null),
    unmatchedTo: plan.unmatchedTo
      .map(endpoint)
      .filter((value): value is TimelineMorphProxyEndpoint => value !== null),
  };
}

function TimelineMorphProxyMesh({
  batch,
  register,
}: {
  readonly batch: TimelineMorphProxyBatch;
  readonly register: (index: number, mesh: InstancedMesh | null) => void;
}): ReactElement {
  return (
    <instancedMesh
      ref={(mesh) => {
        if (mesh !== null) {
          mesh.raycast = () => undefined;
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        }
        register(batch.index, mesh);
      }}
      args={[undefined, undefined, Math.max(1, batch.capacity)]}
      count={0}
      frustumCulled={false}
    >
      {batch.round
        ? <cylinderGeometry args={[Math.max(batch.width, batch.depth) / 2, Math.max(batch.width, batch.depth) / 2, batch.height, 10]} />
        : <boxGeometry args={[batch.width, batch.height, batch.depth]} />}
      <meshStandardMaterial
        color={batch.colour}
        roughness={0.72}
        metalness={0.04}
      />
    </instancedMesh>
  );
}

export function subscribeTimelineMorphInvalidation(
  plan: TimelineItemTransitionPlan,
  invalidate: () => void,
): () => void {
  const initial = useLayoutTimelinePreviewStore.getState().transition;
  let previousProgress = initial?.itemTransitionPlan === plan ? initial.progress : null;
  return useLayoutTimelinePreviewStore.subscribe((state) => {
    const transition = state.transition;
    const nextProgress = transition?.itemTransitionPlan === plan ? transition.progress : null;
    if (nextProgress === null || nextProgress === previousProgress) return;
    previousProgress = nextProgress;
    invalidate();
  });
}

/**
 * High-cardinality morphs keep a stable React/Three object graph. The timeline
 * store remains the unit-observable source of truth, while this layer samples
 * the immutable correspondence plan directly into lightweight instance
 * buffers. No 500-item allocation or child reconciliation occurs per frame.
 */
function TimelineImperativeSimplifiedMorphLayer({
  plan,
  settledAtToEndpoint,
}: {
  readonly plan: TimelineItemTransitionPlan;
  readonly settledAtToEndpoint: boolean;
}): ReactElement {
  const meshByIndexRef = useRef<Array<InstancedMesh | null>>([]);
  const uniformGroupRef = useRef<Group | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const uniformTranslation = useMemo(() => timelineUniformMorphTranslation(plan), [plan]);
  const compiled = useMemo(
    () => uniformTranslation === null
      ? compileTimelineMorphPlan(plan)
      : EMPTY_COMPILED_TIMELINE_MORPH_PLAN,
    [plan, uniformTranslation],
  );
  const countsRef = useRef(new Int32Array(compiled.batches.length));
  const lastProgressRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    countsRef.current = new Int32Array(compiled.batches.length);
    lastProgressRef.current = null;
  }, [compiled]);

  const register = useCallback((index: number, mesh: InstancedMesh | null): void => {
    meshByIndexRef.current[index] = mesh;
  }, []);

  useLayoutEffect(() => {
    invalidate();
  }, [invalidate, plan, settledAtToEndpoint]);

  useEffect(
    () => subscribeTimelineMorphInvalidation(plan, invalidate),
    [invalidate, plan],
  );

  useFrame(() => {
    const transition = useLayoutTimelinePreviewStore.getState().transition;
    const progress = transition?.itemTransitionPlan === plan
      ? clamp01(transition.progress)
      : settledAtToEndpoint ? 1 : null;
    if (progress === null) return;
    if (progress === lastProgressRef.current) return;
    lastProgressRef.current = progress;

    if (uniformTranslation !== null) {
      uniformGroupRef.current?.position.set(
        uniformTranslation.x * progress,
        uniformTranslation.y * progress,
        uniformTranslation.z * progress,
      );
      return;
    }

    const counts = countsRef.current;
    counts.fill(0);
    const usesToEndpoint = progress >= 0.5;
    for (const record of compiled.pairs) {
      const endpoint = usesToEndpoint ? record.toEndpoint : record.fromEndpoint;
      if (endpoint === null) continue;
      const mesh = meshByIndexRef.current[endpoint.batchIndex];
      if (mesh === null || mesh === undefined) continue;
      const index = counts[endpoint.batchIndex] ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;
      const scale = record.fromScale + record.deltaScale * progress;
      writeTimelineProxyMatrix(
        mesh.instanceMatrix.array as Float32Array,
        index,
        record.fromX + record.deltaX * progress,
        record.fromY + record.deltaY * progress,
        record.fromZ + record.deltaZ * progress,
        record.fromRotationY + record.deltaRotationY * progress,
        scale,
        endpoint.height,
      );
      counts[endpoint.batchIndex] = index + 1;
    }

    const unmatched = usesToEndpoint ? compiled.unmatchedTo : compiled.unmatchedFrom;
    for (const endpoint of unmatched) {
      const mesh = meshByIndexRef.current[endpoint.batchIndex];
      if (mesh === null || mesh === undefined) continue;
      const index = counts[endpoint.batchIndex] ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;
      const { item } = endpoint;
      const scale = item.scale ?? 1;
      writeTimelineProxyMatrix(
        mesh.instanceMatrix.array as Float32Array,
        index,
        item.x,
        item.y,
        item.z,
        item.rotationY,
        scale,
        endpoint.height,
      );
      counts[endpoint.batchIndex] = index + 1;
    }

    for (const batch of compiled.batches) {
      const mesh = meshByIndexRef.current[batch.index];
      if (mesh === null || mesh === undefined) continue;
      mesh.count = counts[batch.index] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="timeline-imperative-simplified-morph">
      {uniformTranslation === null ? compiled.batches.map((batch) => (
        <TimelineMorphProxyMesh key={batch.key} batch={batch} register={register} />
      )) : (
        <group ref={uniformGroupRef} name="timeline-uniform-translation-morph">
          <TimelineSimplifiedFurnitureLayer items={plan.fromItems} />
        </group>
      )}
    </group>
  );
}

export function timelinePreviewOpacity(
  role: TimelinePreviewOpacityRole,
  progress: number,
): number {
  const clamped = clamp01(progress);
  if (role === "from-progress") return 1 - clamped;
  if (role === "to-progress") return clamped;
  return 1;
}

/**
 * Render descriptors intentionally ignore progress. Cross-event endpoint item
 * arrays therefore remain referentially stable for the whole transition;
 * opacity is applied imperatively immediately before each Three render.
 */
export function timelinePreviewRenderLayers({
  currentItems,
  transition,
}: {
  readonly currentItems: readonly PlacedItem[];
  readonly transition: LayoutTimelinePreviewTransition | null;
}): readonly TimelinePreviewRenderLayer[] {
  if (transition === null) {
    return [{ key: "settled", items: currentItems, opacityRole: "fixed" }];
  }
  if (transition.roomEnvelopeChanged) {
    return [{
      key: "settled",
      items: transition.progress < 0.5 ? transition.fromItems : transition.toItems,
      opacityRole: "fixed",
    }];
  }
  if (transition.mode === "same-event-morph") {
    return [{ key: "morph", items: currentItems, opacityRole: "fixed" }];
  }
  return [
    { key: "from", items: transition.fromItems, opacityRole: "from-progress" },
    { key: "to", items: transition.toItems, opacityRole: "to-progress" },
  ];
}

export function nearestTimelineKeyframeItems(
  currentItems: readonly PlacedItem[],
  transition: LayoutTimelinePreviewTransition | null,
): readonly PlacedItem[] {
  if (transition === null) return currentItems;
  return transition.progress < 0.5 ? transition.fromItems : transition.toItems;
}

function currentTransitionProgress(): number {
  return useLayoutTimelinePreviewStore.getState().transition?.progress ?? 0;
}

const fromOpacitySource = (): number => timelinePreviewOpacity(
  "from-progress",
  currentTransitionProgress(),
);
const toOpacitySource = (): number => timelinePreviewOpacity(
  "to-progress",
  currentTransitionProgress(),
);

interface MaterialAppearance {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
}

function objectMaterials(object: Object3D): readonly Material[] {
  if (!("material" in object)) return [];
  const value = (object as Object3D & { readonly material?: unknown }).material;
  if (Array.isArray(value)) return value.filter((candidate): candidate is Material => candidate instanceof Material);
  return value instanceof Material ? [value] : [];
}

function DrivenImportedOpacity({
  children,
  opacitySource,
}: {
  readonly children: ReactNode;
  readonly opacitySource: () => number;
}): ReactElement {
  const groupRef = useRef<Group>(null);
  const baseAppearances = useRef(new WeakMap<Material, MaterialAppearance>());

  useFrame(() => {
    const root = groupRef.current;
    if (root === null) return;
    const opacity = clamp01(opacitySource());
    root.traverse((object) => {
      for (const material of objectMaterials(object)) {
        let base = baseAppearances.current.get(material);
        if (base === undefined) {
          base = {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          };
          baseAppearances.current.set(material, base);
        }
        const transparent = base.transparent || opacity < 1;
        material.opacity = base.opacity * opacity;
        material.depthWrite = opacity >= 1 ? base.depthWrite : false;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
      }
    });
  });

  return <group ref={groupRef}>{children}</group>;
}

function TimelineFurnitureLayerComponent({
  items,
  opacitySource,
}: {
  readonly items: readonly PlacedItem[];
  readonly opacitySource?: () => number;
}): ReactElement {
  const simplified = timelinePreviewUsesSimplifiedLod(items.length);
  const { instancedItems, importedItems, fallbackItems } = useMemo(() => {
    if (simplified) {
      return { instancedItems: [], importedItems: [], fallbackItems: [] };
    }
    const instanced: PlacedItem[] = [];
    const imported: PlacedItem[] = [];
    const fallback: PlacedItem[] = [];
    for (const item of items) {
      const renderKind = timelineFurnitureRenderKind(item);
      if (renderKind === "canonical-fallback") {
        fallback.push(item);
        continue;
      }
      if (renderKind === "unavailable") continue;
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem === undefined) continue;
      (catalogueItem.meshUrl === null ? instanced : imported).push(item);
    }
    return { instancedItems: instanced, importedItems: imported, fallbackItems: fallback };
  }, [items, simplified]);

  if (simplified) {
    return <TimelineSimplifiedFurnitureLayer items={items} opacitySource={opacitySource} />;
  }

  const importedFurniture = importedItems.map((item) => {
    const catalogueItem = getCatalogueItem(item.catalogueItemId);
    if (catalogueItem === undefined) return null;
    return (
      <group
        key={item.id}
        position={[item.x, item.y, item.z]}
        rotation={[0, item.rotationY, 0]}
        scale={item.scale ?? 1}
      >
        <FurnitureProxy
          item={catalogueItem}
          position={[0, 0, 0]}
          rotationY={0}
          opacity={1}
          name={`timeline-furniture-${item.id}`}
        />
      </group>
    );
  });

  const fallbackFurniture = fallbackItems.map((item) => {
    const definition = item.embeddedAssetDefinition;
    if (definition === undefined) return null;
    const width = toRenderSpace(definition.widthM);
    const height = definition.heightM;
    const depth = toRenderSpace(definition.depthM);
    const round = isRoundCollision(definition.collisionType);
    const colour = definition.category === "table" ? "#d5b557"
      : definition.category === "chair" ? "#a5b8bc"
        : definition.category === "stage" ? "#b788e4"
          : "#8e978f";
    return (
      <group
        key={item.id}
        position={[item.x, item.y, item.z]}
        rotation={[0, item.rotationY, 0]}
        scale={item.scale ?? 1}
        name={`timeline-canonical-fallback-${item.id}`}
      >
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          {round
            ? <cylinderGeometry args={[width / 2, width / 2, height, 24]} />
            : <boxGeometry args={[width, height, depth]} />}
          <meshStandardMaterial color={colour} roughness={0.72} metalness={0.04} />
        </mesh>
      </group>
    );
  });
  const individualFurniture = [...importedFurniture, ...fallbackFurniture];

  return (
    <group>
      <InstancedFurnitureLayer
        items={instancedItems}
        opacitySource={opacitySource}
        directInstances
      />
      {opacitySource === undefined ? individualFurniture : (
        <DrivenImportedOpacity opacitySource={opacitySource}>
          {individualFurniture}
        </DrivenImportedOpacity>
      )}
    </group>
  );
}

const TimelineFurnitureLayer = memo(TimelineFurnitureLayerComponent);

function isStaticTransition(mode: LayoutTimelinePreviewTransitionMode | null): boolean {
  return mode === "cross-event-replace" || mode === "reduced-motion-crossfade";
}

export function timelineStaticTransitionHardCuts(
  mode: LayoutTimelinePreviewTransitionMode | null,
  roomEnvelopeChanged: boolean,
): boolean {
  return isStaticTransition(mode) && roomEnvelopeChanged;
}

function TimelineStaticTransitionFurniture(): ReactElement | null {
  const mode = useLayoutTimelinePreviewStore((state) => state.transition?.mode ?? null);
  const roomEnvelopeChanged = useLayoutTimelinePreviewStore(
    (state) => state.transition?.roomEnvelopeChanged ?? false,
  );
  const fromItems = useLayoutTimelinePreviewStore(
    (state) => isStaticTransition(state.transition?.mode ?? null)
      ? state.transition?.fromItems ?? EMPTY_ITEMS
      : EMPTY_ITEMS,
  );
  const toItems = useLayoutTimelinePreviewStore(
    (state) => isStaticTransition(state.transition?.mode ?? null)
      ? state.transition?.toItems ?? EMPTY_ITEMS
      : EMPTY_ITEMS,
  );
  const highCardinalityReplace = isStaticTransition(mode)
    && timelinePreviewUsesSimplifiedLod(Math.max(fromItems.length, toItems.length));
  const hardEndpointReplace = timelineStaticTransitionHardCuts(mode, roomEnvelopeChanged);
  const endpointItems = useLayoutTimelinePreviewStore(
    (state) => isStaticTransition(state.transition?.mode ?? null)
      && (
        (state.transition?.roomEnvelopeChanged ?? false)
        || timelinePreviewUsesSimplifiedLod(Math.max(
          state.transition?.fromItems.length ?? 0,
          state.transition?.toItems.length ?? 0,
        ))
      )
      ? state.currentItems
      : EMPTY_ITEMS,
  );
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!isStaticTransition(mode) || highCardinalityReplace || hardEndpointReplace) return undefined;
    let previousProgress = currentTransitionProgress();
    return useLayoutTimelinePreviewStore.subscribe((state) => {
      const nextProgress = state.transition?.progress ?? 0;
      if (nextProgress === previousProgress) return;
      previousProgress = nextProgress;
      invalidate();
    });
  }, [hardEndpointReplace, highCardinalityReplace, invalidate, mode]);

  if (!isStaticTransition(mode)) return null;
  if (highCardinalityReplace || hardEndpointReplace) {
    return <TimelineFurnitureLayer items={endpointItems} />;
  }
  return (
    <>
      <TimelineFurnitureLayer key="from" items={fromItems} opacitySource={fromOpacitySource} />
      <TimelineFurnitureLayer key="to" items={toItems} opacitySource={toOpacitySource} />
    </>
  );
}

interface RetainedImperativeMorph {
  readonly plan: TimelineItemTransitionPlan;
  readonly toFrameId: string;
  readonly toRuntime: LayoutTimelinePreviewFrameMetadata["venueRuntime"];
}

function TimelineDynamicFurniture(): ReactElement | null {
  const sessionMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const mode = useLayoutTimelinePreviewStore((state) => state.transition?.mode ?? null);
  const itemTransitionPlan = useLayoutTimelinePreviewStore(
    (state) => state.transition?.itemTransitionPlan ?? null,
  );
  const highMorphTarget = useLayoutTimelinePreviewStore((state) => {
    const transition = state.transition;
    return transition?.mode === "same-event-morph"
      && transition.itemTransitionPlan !== null
      && timelineTransitionUsesImperativeMorph(transition.itemTransitionPlan)
      ? transition.toFrame
      : null;
  });
  const settledFrame = useLayoutTimelinePreviewStore(
    (state) => state.mode === "keyframe" ? state.activeFrame : null,
  );
  const settledRuntime = useLayoutTimelinePreviewStore(
    (state) => state.mode === "keyframe" ? state.activeVenueRuntime : null,
  );
  const highCardinalityMorph = mode === "same-event-morph"
    && itemTransitionPlan !== null
    && timelineTransitionUsesImperativeMorph(itemTransitionPlan);
  const currentItems = useLayoutTimelinePreviewStore((state) => (
    state.transition?.mode === "same-event-morph"
      && state.transition.itemTransitionPlan !== null
      && timelineTransitionUsesImperativeMorph(state.transition.itemTransitionPlan)
      ? EMPTY_ITEMS
      : state.currentItems
  ));
  const retainedPlanRef = useRef<RetainedImperativeMorph | null>(null);
  if (isStaticTransition(mode)) {
    retainedPlanRef.current = null;
    return null;
  }
  if (highCardinalityMorph && highMorphTarget !== null) {
    retainedPlanRef.current = {
      plan: itemTransitionPlan,
      toFrameId: highMorphTarget.id,
      toRuntime: highMorphTarget.venueRuntime,
    };
  }
  const retained = retainedPlanRef.current;
  const settledAtToEndpoint = sessionMode === "keyframe"
    && retained !== null
    && currentItems === retained.plan.toItems
    && settledFrame?.id === retained.toFrameId
    && settledRuntime === retained.toRuntime;
  const trustworthySettledPlan = settledAtToEndpoint
    ? retained.plan
    : null;
  if (!highCardinalityMorph && trustworthySettledPlan === null) {
    retainedPlanRef.current = null;
  }
  const imperativePlan = highCardinalityMorph ? itemTransitionPlan : trustworthySettledPlan;
  if (imperativePlan !== null) {
    return (
      <TimelineImperativeSimplifiedMorphLayer
        plan={imperativePlan}
        settledAtToEndpoint={!highCardinalityMorph}
      />
    );
  }
  return <TimelineFurnitureLayer items={currentItems} />;
}

interface RetainedCaptureEndpoints {
  /** Physical mesh order; may be reused in reverse for the next transition. */
  readonly physicalPlan: TimelineItemTransitionPlan;
  readonly activePlan: TimelineItemTransitionPlan;
  readonly activeFromUsesPhysicalTo: boolean;
  readonly targetEndpoint: "from" | "to";
  readonly toFrameId: string;
  readonly toRuntime: LayoutTimelinePreviewFrameMetadata["venueRuntime"];
}

export type TimelineCaptureEndpointReuse = Pick<
  RetainedCaptureEndpoints,
  "physicalPlan" | "activePlan" | "activeFromUsesPhysicalTo" | "targetEndpoint"
>;

/** Reuses the same two hidden endpoint batches when a scrub reverses direction. */
export function timelineCaptureEndpointReuse(
  previous: TimelineCaptureEndpointReuse | null,
  activePlan: TimelineItemTransitionPlan,
): TimelineCaptureEndpointReuse {
  const reusesReverseEndpoints = previous !== null
    && activePlan.fromItems === previous.physicalPlan.toItems
    && activePlan.toItems === previous.physicalPlan.fromItems;
  return reusesReverseEndpoints
    ? {
        physicalPlan: previous.physicalPlan,
        activePlan,
        activeFromUsesPhysicalTo: true,
        targetEndpoint: "from",
      }
    : {
        physicalPlan: activePlan,
        activePlan,
        activeFromUsesPhysicalTo: false,
        targetEndpoint: "to",
      };
}

function TimelineCaptureFurniture(): ReactElement {
  const fromGroupRef = useRef<Group | null>(null);
  const toGroupRef = useRef<Group | null>(null);
  const activePlan = useLayoutTimelinePreviewStore((state) => {
    const plan = state.transition?.itemTransitionPlan ?? null;
    return plan !== null && timelineTransitionUsesImperativeMorph(plan) ? plan : null;
  });
  const activeTarget = useLayoutTimelinePreviewStore((state) => {
    const plan = state.transition?.itemTransitionPlan ?? null;
    return plan !== null && timelineTransitionUsesImperativeMorph(plan)
      ? state.transition?.toFrame ?? null
      : null;
  });
  const sessionMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const settledFrame = useLayoutTimelinePreviewStore(
    (state) => state.mode === "keyframe" ? state.activeFrame : null,
  );
  const settledRuntime = useLayoutTimelinePreviewStore(
    (state) => state.mode === "keyframe" ? state.activeVenueRuntime : null,
  );
  // During an imperative morph the capture endpoint changes only at the
  // midpoint. Keep the already-mounted `from` array stable there; visibility
  // switches imperatively while the prebuilt `to` endpoint remains hidden.
  const captureItems = useLayoutTimelinePreviewStore((state) => {
    const plan = state.transition?.itemTransitionPlan ?? null;
    return plan !== null && timelineTransitionUsesImperativeMorph(plan)
      ? plan.fromItems
      : state.captureItems;
  });
  const retainedPlanRef = useRef<RetainedCaptureEndpoints | null>(null);
  if (activePlan !== null && activeTarget !== null) {
    const previous = retainedPlanRef.current;
    if (previous?.activePlan !== activePlan) {
      retainedPlanRef.current = {
        ...timelineCaptureEndpointReuse(previous, activePlan),
        toFrameId: activeTarget.id,
        toRuntime: activeTarget.venueRuntime,
      };
    }
  }
  const retained = retainedPlanRef.current;
  const targetItems = retained?.targetEndpoint === "from"
    ? retained.physicalPlan.fromItems
    : retained?.physicalPlan.toItems ?? null;
  const settledAtToEndpoint = sessionMode === "keyframe"
    && retained !== null
    && captureItems === targetItems
    && settledFrame?.id === retained.toFrameId
    && settledRuntime === retained.toRuntime;
  const endpointPlan = activePlan !== null || settledAtToEndpoint
    ? retained?.physicalPlan ?? null
    : null;
  if (activePlan === null && !settledAtToEndpoint) retainedPlanRef.current = null;
  const activeFromUsesPhysicalTo = activePlan !== null
    && retained?.activePlan === activePlan
    && retained.activeFromUsesPhysicalTo;

  const physicalToVisibleAt = useCallback((progress: number): boolean => (
    activeFromUsesPhysicalTo ? progress < 0.5 : progress >= 0.5
  ), [activeFromUsesPhysicalTo]);

  const applyEndpointVisibility = useCallback((showTo: boolean): void => {
    if (fromGroupRef.current !== null) fromGroupRef.current.visible = !showTo;
    if (toGroupRef.current !== null) toGroupRef.current.visible = showTo;
  }, []);

  useLayoutEffect(() => {
    const transition = useLayoutTimelinePreviewStore.getState().transition;
    applyEndpointVisibility(
      settledAtToEndpoint
        ? retained.targetEndpoint === "to"
        : activePlan !== null && transition?.itemTransitionPlan === activePlan
          ? physicalToVisibleAt(transition.progress)
          : false,
    );
  }, [activePlan, applyEndpointVisibility, endpointPlan, physicalToVisibleAt, retained, settledAtToEndpoint]);

  useEffect(() => {
    if (activePlan === null) return undefined;
    let showingTo = physicalToVisibleAt(
      useLayoutTimelinePreviewStore.getState().transition?.progress ?? 0,
    );
    return useLayoutTimelinePreviewStore.subscribe((state) => {
      if (state.transition?.itemTransitionPlan !== activePlan) return;
      const nextShowingTo = physicalToVisibleAt(state.transition.progress);
      if (nextShowingTo === showingTo) return;
      showingTo = nextShowingTo;
      applyEndpointVisibility(showingTo);
    });
  }, [activePlan, applyEndpointVisibility, physicalToVisibleAt]);

  const primaryItems = endpointPlan?.fromItems ?? captureItems;
  return (
    <>
      <group ref={fromGroupRef} name="timeline-capture-from-endpoint">
        <TimelineFurnitureLayer items={primaryItems} />
      </group>
      {endpointPlan === null ? null : (
        <group ref={toGroupRef} name="timeline-capture-to-endpoint" visible={false}>
          <TimelineFurnitureLayer items={endpointPlan.toItems} />
        </group>
      )}
    </>
  );
}

/** Read-only furniture renderer driven only by the isolated timeline store. */
export function TimelinePreviewFurniture(): ReactElement | null {
  const mode = useLayoutTimelinePreviewStore((state) => state.mode);
  if (mode === "inactive") return null;
  if (mode === "unavailable" || mode === "schedule-gap") {
    return <group name={TIMELINE_PREVIEW_FURNITURE_GROUP} />;
  }

  return (
    <>
      <group name={TIMELINE_PREVIEW_FURNITURE_GROUP}>
        <TimelineDynamicFurniture />
        <TimelineStaticTransitionFurniture />
      </group>
      <group name={TIMELINE_CAPTURE_FURNITURE_GROUP} visible={false}>
        <TimelineCaptureFurniture />
      </group>
    </>
  );
}
