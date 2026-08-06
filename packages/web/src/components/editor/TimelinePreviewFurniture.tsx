import { memo, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Material, type Group, type Object3D } from "three";
import type { PlacedItem } from "../../lib/placement.js";
import { getCatalogueItem } from "../../lib/catalogue.js";
import {
  TIMELINE_CAPTURE_FURNITURE_GROUP,
  TIMELINE_PREVIEW_FURNITURE_GROUP,
} from "../../lib/layout-timeline-capture.js";
import {
  useLayoutTimelinePreviewStore,
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

const EMPTY_ITEMS: readonly PlacedItem[] = [];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  const { instancedItems, importedItems } = useMemo(() => {
    const instanced: PlacedItem[] = [];
    const imported: PlacedItem[] = [];
    for (const item of items) {
      const catalogueItem = getCatalogueItem(item.catalogueItemId);
      if (catalogueItem === undefined) continue;
      (catalogueItem.meshUrl === null ? instanced : imported).push(item);
    }
    return { instancedItems: instanced, importedItems: imported };
  }, [items]);

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

  return (
    <group>
      <InstancedFurnitureLayer
        items={instancedItems}
        opacitySource={opacitySource}
        directInstances
      />
      {opacitySource === undefined ? importedFurniture : (
        <DrivenImportedOpacity opacitySource={opacitySource}>
          {importedFurniture}
        </DrivenImportedOpacity>
      )}
    </group>
  );
}

const TimelineFurnitureLayer = memo(TimelineFurnitureLayerComponent);

function isStaticTransition(mode: LayoutTimelinePreviewTransitionMode | null): boolean {
  return mode === "cross-event-replace" || mode === "reduced-motion-crossfade";
}

function TimelineStaticTransitionFurniture(): ReactElement | null {
  const mode = useLayoutTimelinePreviewStore((state) => state.transition?.mode ?? null);
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
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!isStaticTransition(mode)) return undefined;
    let previousProgress = currentTransitionProgress();
    return useLayoutTimelinePreviewStore.subscribe((state) => {
      const nextProgress = state.transition?.progress ?? 0;
      if (nextProgress === previousProgress) return;
      previousProgress = nextProgress;
      invalidate();
    });
  }, [invalidate, mode]);

  if (!isStaticTransition(mode)) return null;
  return (
    <>
      <TimelineFurnitureLayer key="from" items={fromItems} opacitySource={fromOpacitySource} />
      <TimelineFurnitureLayer key="to" items={toItems} opacitySource={toOpacitySource} />
    </>
  );
}

function TimelineDynamicFurniture(): ReactElement | null {
  const mode = useLayoutTimelinePreviewStore((state) => state.transition?.mode ?? null);
  const currentItems = useLayoutTimelinePreviewStore((state) => state.currentItems);
  if (isStaticTransition(mode)) return null;
  return <TimelineFurnitureLayer items={currentItems} />;
}

function TimelineCaptureFurniture(): ReactElement {
  const captureItems = useLayoutTimelinePreviewStore((state) => state.captureItems);
  return <TimelineFurnitureLayer items={captureItems} />;
}

/** Read-only furniture renderer driven only by the isolated timeline store. */
export function TimelinePreviewFurniture(): ReactElement | null {
  const active = useLayoutTimelinePreviewStore((state) => state.activeFrame !== null);
  if (!active) return null;

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

