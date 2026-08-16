import {
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Group } from "three";
import { RENDER_SCALE } from "../../../constants/scale.js";

import {
  createFurniturePresentationRuntime,
  type FurnitureInspectionPart,
  type FurniturePresentationRuntime,
} from "../../../lib/furniture-presentation-runtime.js";
import {
  createGeneratedFurnitureAppearanceController,
  type GeneratedFurnitureAppearance,
  type GeneratedFurnitureAppearanceController,
} from "./generatedFurnitureAppearance.js";
import {
  createGeneratedFurnitureObject,
  disposeGeneratedFurnitureObject,
  generatedFurnitureExplodeOrigin,
  type GeneratedFurnitureFactoryOptions,
  type GeneratedFurnitureProxyMarker,
  type GeneratedFurnitureSlug,
} from "./generatedFurnitureRegistry.js";

const DEFAULT_EXPLODE_DISTANCE = 0.35;

export interface GeneratedFurnitureProxyProps
  extends GeneratedFurnitureFactoryOptions {
  readonly slug: GeneratedFurnitureSlug;
  readonly explodeProgress?: number;
  readonly explodeDistance?: number;
  readonly selectedPartId?: string | null;
  readonly opacity?: number;
  readonly colorOverride?: string;
  readonly onPartSelect?: (
    part: FurnitureInspectionPart,
    event: ThreeEvent<MouseEvent>,
  ) => void;
  /** Parent UI uses this hook to render the mandatory visible proxy badge. */
  readonly onProxyMarkerChange?: (
    marker: GeneratedFurnitureProxyMarker | null,
  ) => void;
}

export interface GeneratedFurnitureRenderInstance {
  readonly root: Group;
  readonly controller: FurniturePresentationRuntime;
  readonly marker: GeneratedFurnitureProxyMarker;
  readonly disposed: boolean;
  applyAppearance(appearance: GeneratedFurnitureAppearance): void;
  dispose(): void;
}

function requireProxyMarker(root: Group): GeneratedFurnitureProxyMarker {
  const marker: unknown = root.userData.venviewerGeneratedFurnitureProxy;
  if (
    typeof marker !== "object"
    || marker === null
    || !("kind" in marker)
    || marker.kind !== "ai-generated-furniture-proxy"
  ) {
    throw new Error("generated furniture root is missing its presentation marker");
  }
  return marker as GeneratedFurnitureProxyMarker;
}

/** Build one fully-owned render instance, cleaning up if setup fails. */
export function createGeneratedFurnitureRenderInstance(
  slug: GeneratedFurnitureSlug,
  options: GeneratedFurnitureFactoryOptions,
  explodeDistance: number,
  explodeProgress: number,
  appearanceOptions: GeneratedFurnitureAppearance,
): GeneratedFurnitureRenderInstance {
  const root = createGeneratedFurnitureObject(slug, options);
  root.scale.set(RENDER_SCALE, 1, RENDER_SCALE);
  let controller: FurniturePresentationRuntime | null = null;
  let appearance: GeneratedFurnitureAppearanceController | null = null;
  try {
    const createdController = createFurniturePresentationRuntime(root, {
      explodeDistance,
      origin: generatedFurnitureExplodeOrigin(slug),
    });
    controller = createdController;
    createdController.setExplodeProgress(explodeProgress);
    const createdAppearance = createGeneratedFurnitureAppearanceController(
      root,
      createdController,
    );
    appearance = createdAppearance;
    createdAppearance.apply(appearanceOptions);
    const marker = requireProxyMarker(root);
    let disposed = false;
    return {
      root,
      controller: createdController,
      marker,
      get disposed(): boolean {
        return disposed;
      },
      applyAppearance(nextAppearance: GeneratedFurnitureAppearance): void {
        if (disposed) return;
        createdAppearance.apply(nextAppearance);
      },
      dispose(): void {
        if (disposed) return;
        createdAppearance.restore();
        createdController.dispose();
        disposeGeneratedFurnitureObject(root);
        disposed = true;
      },
    };
  } catch (error: unknown) {
    appearance?.restore();
    controller?.dispose();
    disposeGeneratedFurnitureObject(root);
    throw error;
  }
}

/**
 * Presentation-only R3F adapter for generated furniture assemblies.
 *
 * It adds no planning geometry, authority, camera, controls, or Canvas. The
 * parent owns the visible AI-proxy badge through `onProxyMarkerChange`.
 */
export function GeneratedFurnitureProxy({
  slug,
  castShadow,
  receiveShadow,
  explodeProgress = 0,
  explodeDistance = DEFAULT_EXPLODE_DISTANCE,
  selectedPartId = null,
  opacity = 1,
  colorOverride,
  onPartSelect,
  onProxyMarkerChange,
}: GeneratedFurnitureProxyProps): React.ReactElement | null {
  const containerRef = useRef<Group | null>(null);
  if (containerRef.current === null) {
    containerRef.current = new Group();
    containerRef.current.name = "generated-furniture-proxy-container";
  }
  const container = containerRef.current;
  const instanceRef = useRef<GeneratedFurnitureRenderInstance | null>(null);

  useLayoutEffect(() => {
    const next = createGeneratedFurnitureRenderInstance(
      slug,
      { castShadow, receiveShadow },
      explodeDistance,
      0,
      { opacity: 1, selectedPartId: null },
    );
    container.add(next.root);
    instanceRef.current = next;
    return () => {
      if (instanceRef.current === next) instanceRef.current = null;
      container.remove(next.root);
      next.dispose();
    };
  }, [castShadow, explodeDistance, receiveShadow, slug]);

  useLayoutEffect(() => {
    instanceRef.current?.controller.setExplodeProgress(explodeProgress);
  }, [castShadow, explodeDistance, explodeProgress, receiveShadow, slug]);

  useLayoutEffect(() => {
    instanceRef.current?.applyAppearance({
      opacity,
      colorOverride,
      selectedPartId,
    });
  }, [
    castShadow,
    colorOverride,
    explodeDistance,
    opacity,
    receiveShadow,
    selectedPartId,
    slug,
  ]);

  useLayoutEffect(() => {
    if (onProxyMarkerChange === undefined) return undefined;
    onProxyMarkerChange(instanceRef.current?.marker ?? null);
    return () => {
      onProxyMarkerChange(null);
    };
  }, [onProxyMarkerChange, slug]);

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>): void => {
    const instance = instanceRef.current;
    if (instance === null || onPartSelect === undefined) return;
    const part = instance.controller.resolveInspectionPart(event.object);
    if (part === null) return;
    event.stopPropagation();
    onPartSelect(part, event);
  }, [onPartSelect]);

  return (
    <primitive
      object={container}
      dispose={null}
      onClick={handleClick}
    />
  );
}
