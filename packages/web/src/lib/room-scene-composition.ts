import type { RoomSceneManifestV0, SpatialLayerDescriptorV0 } from "@omnitwin/types";
import type { RoomResolveInput } from "./room-resolve-model.js";

export type RoomScenePresentation = "appearance" | "structural-proxy";
export type RoomSceneLayerLoadStatus = "absent" | "loading" | "ready" | "failed";

export interface RoomSceneLayerLoadState {
  readonly status: RoomSceneLayerLoadStatus;
  readonly loadedUnits: number;
  readonly totalUnits: number;
}

export interface RoomSceneCompositionContext {
  readonly presentation: RoomScenePresentation;
  readonly layerStates: Readonly<Record<string, RoomSceneLayerLoadState>>;
}

export interface RoomSceneComposition {
  readonly visibleLayerIds: readonly string[];
  readonly visibleLayers: readonly SpatialLayerDescriptorV0[];
  readonly activeLoadState: RoomSceneLayerLoadState;
}

export interface RoomSceneResolveInput extends RoomResolveInput {
  readonly atomicReady: boolean;
}

const ABSENT_LAYER_STATE: RoomSceneLayerLoadState = {
  status: "absent",
  loadedUnits: 0,
  totalUnits: 0,
};

function safeUnits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function aggregateVisibleLayerState(
  layers: readonly SpatialLayerDescriptorV0[],
  states: RoomSceneCompositionContext["layerStates"],
): RoomSceneLayerLoadState {
  if (layers.length === 0) return ABSENT_LAYER_STATE;
  const visibleStates = layers.map((layer) => states[layer.id] ?? ABSENT_LAYER_STATE);
  const totalUnits = visibleStates.reduce((sum, state) => sum + safeUnits(state.totalUnits), 0);
  const loadedUnits = visibleStates.reduce((sum, state) => {
    const total = safeUnits(state.totalUnits);
    return sum + Math.min(safeUnits(state.loadedUnits), total);
  }, 0);
  const status: RoomSceneLayerLoadStatus = visibleStates.some((state) => state.status === "failed")
    ? "failed"
    : visibleStates.some((state) => state.status === "absent")
      ? "absent"
      : visibleStates.some((state) => state.status === "loading")
        ? "loading"
        : "ready";
  return { status, loadedUnits, totalUnits };
}

function targetKinds(presentation: RoomScenePresentation): ReadonlySet<string> {
  return presentation === "appearance"
    ? new Set(["Appearance", "HeroVolume", "Semantic"])
    : new Set(["StructuralProxy"]);
}

/**
 * Resolves only declared layers. It deliberately has no fallback/substitution
 * rule: a failed Appearance layer stays failed instead of revealing a proxy
 * and implying that reconstructed diagnostics are captured pixels.
 */
export function resolveRoomSceneComposition(
  manifest: RoomSceneManifestV0,
  context: RoomSceneCompositionContext,
): RoomSceneComposition {
  const kinds = targetKinds(context.presentation);
  const visibleLayers = manifest.layerDescriptors.filter((layer) => kinds.has(layer.kind));
  const activeLoadState = aggregateVisibleLayerState(visibleLayers, context.layerStates);
  return {
    visibleLayerIds: visibleLayers.map((layer) => layer.id),
    visibleLayers,
    activeLoadState,
  };
}

/** Adapts actual compositor load state to the existing Room Resolves model. */
export function layerStateForRoomResolve(
  state: RoomSceneLayerLoadState,
): RoomSceneResolveInput {
  if (state.status === "absent") {
    return {
      splatStatus: "none",
      hasAsset: false,
      totalChunks: 0,
      loadedChunks: 0,
      failedChunks: 0,
      atomicReady: false,
    };
  }
  const totalChunks = safeUnits(state.totalUnits);
  const loadedChunks = Math.min(safeUnits(state.loadedUnits), totalChunks);
  const invalidReadyState = state.status === "ready"
    && (totalChunks === 0 || loadedChunks !== totalChunks);
  if (state.status === "failed" || invalidReadyState) {
    const failedTotal = Math.max(totalChunks, 1);
    const failedLoaded = Math.min(loadedChunks, failedTotal - 1);
    return {
      splatStatus: "loaded",
      hasAsset: true,
      totalChunks: failedTotal,
      loadedChunks: failedLoaded,
      failedChunks: failedTotal - failedLoaded,
      atomicReady: false,
    };
  }
  return {
    splatStatus: "loaded",
    hasAsset: true,
    totalChunks,
    loadedChunks,
    failedChunks: 0,
    atomicReady: state.status === "ready",
  };
}
