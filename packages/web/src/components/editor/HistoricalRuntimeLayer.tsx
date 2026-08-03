import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { SplatMesh } from "@sparkjsdev/spark";
import { Matrix4, type Group } from "three";
import type { PhaseLayoutRuntimeAvailableBinding } from "@omnitwin/types";
import {
  fetchVerifiedHistoricalRuntimeAsset,
  type VerifiedHistoricalRuntimeAsset,
} from "../../api/historical-runtime-assets.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { frozenRoomEnvelopeKey } from "../../lib/frozen-layout-room.js";
import {
  HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
  HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET,
  HISTORICAL_RUNTIME_MAX_MEMBERS,
  HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
  HistoricalRuntimeCache,
  historicalRuntimeBindingKey,
  historicalRuntimeCombinedSplatsWithinBudget,
  historicalRuntimeCompressedBytes,
  historicalRuntimeCrossfadeAllowed,
  historicalRuntimeDecodedSplatsWithinViewerBudget,
  historicalRuntimeResourceCanRender,
  historicalRuntimeRemainingAdjacentSplatBudget,
  historicalRuntimeViewerCapacity,
} from "../../lib/historical-runtime-cache.js";
import { resolveHistoricalRuntimeAssetToRrfTransform } from "../../lib/historical-runtime-transform.js";
import { useHistoricalRuntimeStatusStore } from "../../stores/historical-runtime-status-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { sparkRendererAdmissionGate } from "../scene/spark-renderer-lifecycle.js";

const HISTORICAL_RUNTIME_CROSSFADE_MS = 240;
const MAX_REMEMBERED_SPLAT_COUNTS = 32;
const splatBudgetByBinding = new WeakMap<PhaseLayoutRuntimeAvailableBinding, number>();
const splatCountByBindingKey = new Map<string, number>();

export interface HistoricalRuntimeMesh {
  visible: boolean;
  opacity: number;
  matrixAutoUpdate: boolean;
  readonly matrix: Matrix4;
  matrixWorldNeedsUpdate: boolean;
  readonly initialized: Promise<HistoricalRuntimeMesh>;
  readonly numSplats: number;
  readonly dispose: () => void;
}

export interface HistoricalRuntimeResource {
  readonly binding: PhaseLayoutRuntimeAvailableBinding;
  readonly meshes: readonly HistoricalRuntimeMesh[];
  splatCount: number;
  disposed: boolean;
}

interface DisplayedResources {
  readonly currentKey: string | null;
  readonly current: HistoricalRuntimeResource | null;
  readonly currentEnvelopeKey: string | null;
  readonly previous: HistoricalRuntimeResource | null;
}

const EMPTY_DISPLAY: DisplayedResources = {
  currentKey: null,
  current: null,
  currentEnvelopeKey: null,
  previous: null,
};

interface RuntimePresentationCandidate {
  readonly key: string;
  readonly resource: HistoricalRuntimeResource;
}

export function historicalRuntimePresentationCanAcknowledge(params: {
  readonly candidateKey: string | null;
  readonly attachedKey: string | null;
  readonly groupAttached: boolean;
}): boolean {
  return params.candidateKey !== null &&
    params.groupAttached &&
    params.attachedKey === params.candidateKey;
}

function rememberSplatCount(binding: PhaseLayoutRuntimeAvailableBinding, count: number): void {
  const key = historicalRuntimeBindingKey(binding);
  splatCountByBindingKey.delete(key);
  splatCountByBindingKey.set(key, count);
  while (splatCountByBindingKey.size > MAX_REMEMBERED_SPLAT_COUNTS) {
    const oldest = splatCountByBindingKey.keys().next();
    if (oldest.done === true) break;
    splatCountByBindingKey.delete(oldest.value);
  }
}

function abortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

export function disposeHistoricalRuntimeResource(resource: HistoricalRuntimeResource): void {
  if (resource.disposed) return;
  resource.disposed = true;
  for (const mesh of resource.meshes) {
    mesh.visible = false;
    mesh.opacity = 0;
    mesh.dispose();
  }
}

export async function decodeHistoricalRuntimePackage(
  binding: PhaseLayoutRuntimeAvailableBinding,
  assets: readonly VerifiedHistoricalRuntimeAsset[],
  signal: AbortSignal,
  createMesh: (
    asset: VerifiedHistoricalRuntimeAsset,
    maxSplats: number,
  ) => HistoricalRuntimeMesh = (asset, maxSplats) => new SplatMesh({
    fileBytes: asset.bytes,
    fileName: asset.member.fileName,
    maxSplats,
    editable: false,
    raycastable: false,
  }),
  maxSplats = splatBudgetByBinding.get(binding) ?? HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
): Promise<HistoricalRuntimeResource> {
  const transform = resolveHistoricalRuntimeAssetToRrfTransform(binding);
  if (!transform.ok) throw new Error(transform.message);
  const meshes: HistoricalRuntimeMesh[] = [];
  const resource: HistoricalRuntimeResource = { binding, meshes, splatCount: 0, disposed: false };
  const matrix = new Matrix4().fromArray(transform.matrix);

  try {
    for (const asset of assets) {
      if (abortRequested(signal) && meshes.length === 0) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (abortRequested(signal)) break;
      const remainingSplats = maxSplats - resource.splatCount;
      const mesh = createMesh(asset, remainingSplats + 1);
      mesh.visible = false;
      mesh.opacity = 0;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
      mesh.matrixWorldNeedsUpdate = true;
      meshes.push(mesh);
      await mesh.initialized;
      const decodedSplats = mesh.numSplats;
      const decodedTotal = resource.splatCount + decodedSplats;
      if (
        !historicalRuntimeDecodedSplatsWithinViewerBudget(decodedSplats, remainingSplats) ||
        !historicalRuntimeDecodedSplatsWithinViewerBudget(decodedTotal, maxSplats)
      ) {
        rememberSplatCount(binding, maxSplats + 1);
        throw new Error("The exact historical room capture exceeds this viewer's splat budget.");
      }
      resource.splatCount = decodedTotal;
      if (abortRequested(signal)) break;
    }
    rememberSplatCount(binding, resource.splatCount);
    return resource;
  } catch (error: unknown) {
    disposeHistoricalRuntimeResource(resource);
    throw error;
  }
}

const historicalRuntimeCache = new HistoricalRuntimeCache<HistoricalRuntimeResource>({
  fetchMember: fetchVerifiedHistoricalRuntimeAsset,
  decode: decodeHistoricalRuntimePackage,
  dispose: disposeHistoricalRuntimeResource,
});

function setResourceOpacity(resource: HistoricalRuntimeResource | null, opacity: number): void {
  if (resource === null || resource.disposed) return;
  for (const mesh of resource.meshes) {
    mesh.opacity = opacity;
    mesh.visible = opacity > 0.002;
  }
}

function deviceMemoryGb(): number {
  if (typeof navigator === "undefined") return 4;
  return (navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory ?? 4;
}

function initialViewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

function useHistoricalRuntimeViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(initialViewportWidth);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = (): void => { setViewportWidth(window.innerWidth); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, []);
  return viewportWidth;
}

export function HistoricalRuntimeLayer(): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const previewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const activeFrame = useLayoutTimelinePreviewStore((state) => state.activeFrame);
  const previewTransitionFromFrame = useLayoutTimelinePreviewStore(
    (state) => state.transition?.fromFrame ?? null,
  );
  const previewTransitionToFrame = useLayoutTimelinePreviewStore(
    (state) => state.transition?.toFrame ?? null,
  );
  const adjacentRuntime = useLayoutTimelinePreviewStore((state) => state.adjacentHistoricalRuntime);
  const retryRevision = useHistoricalRuntimeStatusStore((state) => state.retryRevision);
  const snapshot = useSyncExternalStore(
    historicalRuntimeCache.subscribe,
    historicalRuntimeCache.getSnapshot,
    historicalRuntimeCache.getSnapshot,
  );
  const rendererAdmissionState = useSyncExternalStore(
    sparkRendererAdmissionGate.subscribe,
    sparkRendererAdmissionGate.getSnapshot,
    sparkRendererAdmissionGate.getSnapshot,
  );
  const [display, setDisplay] = useState<DisplayedResources>(EMPTY_DISPLAY);
  const displayRef = useRef<DisplayedResources>(EMPTY_DISPLAY);
  const selectedKeyRef = useRef<string | null>(null);
  const animationGenerationRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const presentationFrameRef = useRef<number | null>(null);
  const attachedGroupRef = useRef<Group | null>(null);
  const attachedKeyRef = useRef<string | null>(null);
  const presentationCandidateRef = useRef<RuntimePresentationCandidate | null>(null);
  const presentedKeyRef = useRef<string | null>(null);
  const [presentedKey, setPresentedKey] = useState<string | null>(null);
  const viewportWidth = useHistoricalRuntimeViewportWidth();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const historicalRuntime = activeFrame?.historicalRuntime ?? null;
  const availableBinding = historicalRuntime?.state === "available"
    ? historicalRuntime.binding
    : null;
  const transform = useMemo(
    () => availableBinding === null
      ? null
      : resolveHistoricalRuntimeAssetToRrfTransform(availableBinding),
    [availableBinding],
  );
  const viewerCapacity = useMemo(() => historicalRuntimeViewerCapacity({
    deviceMemoryGb: deviceMemoryGb(),
    mobile: viewportWidth <= 767,
  }), [viewportWidth]);
  const activeFitsBudget = availableBinding !== null &&
    availableBinding.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
    historicalRuntimeCompressedBytes(availableBinding) <= viewerCapacity.maxCompressedBytes;
  const rendererQuarantined = rendererAdmissionState === "quarantined";
  const candidateBinding = transform?.ok === true && activeFitsBudget && !rendererQuarantined
    ? availableBinding
    : null;
  const candidateKey = candidateBinding === null ? null : historicalRuntimeBindingKey(candidateBinding);
  const candidateRecord = candidateKey === null ? undefined : snapshot.records.get(candidateKey);
  const knownActiveSplatCount = candidateKey === null
    ? undefined
    : candidateRecord?.resource?.splatCount ?? splatCountByBindingKey.get(candidateKey);
  const activeFitsSplatBudget = knownActiveSplatCount === undefined ||
    historicalRuntimeDecodedSplatsWithinViewerBudget(
      knownActiveSplatCount,
      viewerCapacity.maxSplats,
    );
  const activeBinding = activeFitsSplatBudget ? candidateBinding : null;
  const activeKey = activeBinding === null ? null : candidateKey;
  const activeRecord = activeKey === null ? undefined : candidateRecord;
  const activeEnvelopeKey = activeFrame?.venueRuntime === null || activeFrame?.venueRuntime === undefined
    ? null
    : frozenRoomEnvelopeKey(activeFrame.venueRuntime);
  const transitionAdjacentRuntime = previewTransitionFromFrame === null ||
    previewTransitionToFrame === null ||
    activeFrame === null
    ? null
    : activeFrame.id === previewTransitionFromFrame.id
      ? previewTransitionToFrame.historicalRuntime
      : previewTransitionFromFrame.historicalRuntime;
  const effectiveAdjacentRuntime = transitionAdjacentRuntime ?? adjacentRuntime;
  const adjacentBindingCandidate = effectiveAdjacentRuntime?.state === "available"
    ? effectiveAdjacentRuntime.binding
    : null;
  const adjacentTransform = useMemo(
    () => adjacentBindingCandidate === null
      ? null
      : resolveHistoricalRuntimeAssetToRrfTransform(adjacentBindingCandidate),
    [adjacentBindingCandidate],
  );
  const adjacentCandidateKey = adjacentBindingCandidate === null
    ? null
    : historicalRuntimeBindingKey(adjacentBindingCandidate);
  const adjacentSplatCount = adjacentCandidateKey === null
    ? undefined
    : splatCountByBindingKey.get(adjacentCandidateKey);
  const adjacentFitsSplatBudget = adjacentSplatCount === undefined ||
    historicalRuntimeDecodedSplatsWithinViewerBudget(
      adjacentSplatCount,
      viewerCapacity.maxSplats,
    );
  const combinedResidentSplatBudget = Math.min(
    viewerCapacity.maxSplats,
    HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET,
  );
  const remainingAdjacentSplatBudget = historicalRuntimeRemainingAdjacentSplatBudget({
    activeSplatCount: knownActiveSplatCount,
    viewerSplatBudget: viewerCapacity.maxSplats,
    combinedResidentSplatBudget,
  });
  const adjacentFitsCombinedSplatBudget = adjacentSplatCount === undefined ||
    (knownActiveSplatCount !== undefined &&
      historicalRuntimeCombinedSplatsWithinBudget(
        knownActiveSplatCount,
        adjacentSplatCount,
        combinedResidentSplatBudget,
      ));
  const adjacentFitsBudget = activeBinding !== null && adjacentBindingCandidate !== null &&
    adjacentBindingCandidate.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
    historicalRuntimeCompressedBytes(activeBinding) + historicalRuntimeCompressedBytes(adjacentBindingCandidate)
      <= viewerCapacity.maxCompressedBytes;
  const adjacentBinding = activeBinding !== null &&
    viewerCapacity.allowAdjacent &&
    !reducedMotion &&
    adjacentFitsBudget &&
    adjacentFitsSplatBudget &&
    adjacentFitsCombinedSplatBudget &&
    adjacentTransform?.ok === true
    ? adjacentBindingCandidate
    : null;
  const decodeAdjacent = activeBinding !== null && adjacentBinding !== null &&
    activeRecord?.status === "ready" &&
    remainingAdjacentSplatBudget > 0;

  useLayoutEffect(() => {
    if (activeBinding !== null) splatBudgetByBinding.set(activeBinding, viewerCapacity.maxSplats);
    if (adjacentBinding !== null) {
      splatBudgetByBinding.set(adjacentBinding, remainingAdjacentSplatBudget);
    }
    historicalRuntimeCache.setWindow({
      active: activeBinding,
      adjacent: adjacentBinding,
      decodeAdjacent,
    });
  }, [
    activeBinding,
    adjacentBinding,
    decodeAdjacent,
    remainingAdjacentSplatBudget,
    retryRevision,
    viewerCapacity.maxSplats,
  ]);

  const cancelPresentationFrame = useCallback((): void => {
    if (presentationFrameRef.current === null) return;
    cancelAnimationFrame(presentationFrameRef.current);
    presentationFrameRef.current = null;
  }, []);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    cancelPresentationFrame();
    historicalRuntimeCache.clear();
    splatCountByBindingKey.clear();
  }, [cancelPresentationFrame]);

  useLayoutEffect(() => {
    cancelPresentationFrame();
    presentedKeyRef.current = null;
    setPresentedKey(null);
  }, [activeKey, activeRecord?.resource, cancelPresentationFrame]);

  useLayoutEffect(() => {
    const publish = useHistoricalRuntimeStatusStore.getState().publish;
    if (previewMode === "inactive") {
      publish({ state: "inactive", bindingId: null, message: null });
      return;
    }
    if (rendererQuarantined) {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime?.binding?.bindingId ?? null,
        message: "Historical room rendering is unavailable until this page is reloaded because the previous renderer could not retire safely.",
      });
      return;
    }
    if (historicalRuntime === null) {
      publish({
        state: "unavailable",
        bindingId: null,
        message: "No exact historical room capture is bound to this timeline frame.",
      });
      return;
    }
    if (historicalRuntime.state === "unavailable") {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime.binding?.bindingId ?? null,
        message: historicalRuntime.message,
      });
      return;
    }
    if (transform?.ok !== true) {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime.binding.bindingId,
        message: transform?.message ?? "The frozen runtime transform is unsupported.",
      });
      return;
    }
    if (!activeFitsBudget) {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime.binding.bindingId,
        message: historicalRuntime.binding.visualAssets.length > HISTORICAL_RUNTIME_MAX_MEMBERS
          ? "The exact historical room capture has too many members for this viewer."
          : "The exact historical room capture exceeds this viewer's verified runtime budget.",
      });
      return;
    }
    if (!activeFitsSplatBudget) {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime.binding.bindingId,
        message: "The exact historical room capture exceeds this viewer's splat budget.",
      });
      return;
    }
    if (activeRecord?.status === "ready" && presentedKey === activeKey) {
      publish({ state: "ready", bindingId: historicalRuntime.binding.bindingId, message: null });
      return;
    }
    if (activeRecord?.status === "error") {
      publish({
        state: "error",
        bindingId: historicalRuntime.binding.bindingId,
        message: "The exact historical room capture could not be verified.",
      });
      return;
    }
    publish({
      state: "loading",
      bindingId: historicalRuntime.binding.bindingId,
      message: "Loading the exact historical room capture…",
    });
  }, [
    activeFitsBudget,
    activeFitsSplatBudget,
    activeKey,
    activeRecord?.status,
    historicalRuntime,
    presentedKey,
    previewMode,
    rendererQuarantined,
    transform,
  ]);

  useLayoutEffect(() => {
    const generation = ++animationGenerationRef.current;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const selectionChanged = selectedKeyRef.current !== activeKey;
    selectedKeyRef.current = activeKey;
    const target = activeRecord?.status === "ready" ? activeRecord.resource : null;
    const previousDisplay = displayRef.current;

    if (activeKey === null || target === null) {
      if (selectionChanged || activeKey === null || activeRecord?.status === "error") {
        setResourceOpacity(previousDisplay.current, 0);
        setResourceOpacity(previousDisplay.previous, 0);
        displayRef.current = EMPTY_DISPLAY;
        setDisplay(EMPTY_DISPLAY);
        invalidate();
      }
      return;
    }
    if (!selectionChanged && previousDisplay.current === target) {
      if (reducedMotion && previousDisplay.previous !== null) {
        setResourceOpacity(previousDisplay.previous, 0);
        setResourceOpacity(target, 1);
        const settled: DisplayedResources = { ...previousDisplay, previous: null };
        displayRef.current = settled;
        setDisplay(settled);
        invalidate();
      }
      return;
    }

    const previous = previousDisplay.current;
    const canCrossfade = selectionChanged &&
      previous !== null &&
      previousDisplay.currentEnvelopeKey !== null &&
      previousDisplay.currentEnvelopeKey === activeEnvelopeKey &&
      historicalRuntimeCrossfadeAllowed({
        from: previous.binding,
        to: target.binding,
        sameEnvelope: true,
        reducedMotion,
        combinedByteBudget: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
        fromSplatCount: previous.splatCount,
        toSplatCount: target.splatCount,
        combinedSplatBudget: HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET,
      });

    setResourceOpacity(previousDisplay.previous, 0);
    if (!canCrossfade) {
      setResourceOpacity(previous, 0);
      setResourceOpacity(target, 1);
      const nextDisplay: DisplayedResources = {
        currentKey: activeKey,
        current: target,
        currentEnvelopeKey: activeEnvelopeKey,
        previous: null,
      };
      displayRef.current = nextDisplay;
      setDisplay(nextDisplay);
      invalidate();
      return;
    }

    setResourceOpacity(previous, 1);
    setResourceOpacity(target, 0);
    const nextDisplay: DisplayedResources = {
      currentKey: activeKey,
      current: target,
      currentEnvelopeKey: activeEnvelopeKey,
      previous,
    };
    displayRef.current = nextDisplay;
    setDisplay(nextDisplay);
    const startedAt = performance.now();
    const animate = (now: number): void => {
      if (animationGenerationRef.current !== generation) return;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / HISTORICAL_RUNTIME_CROSSFADE_MS));
      setResourceOpacity(previous, 1 - progress);
      setResourceOpacity(target, progress);
      invalidate();
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      animationFrameRef.current = null;
      setResourceOpacity(previous, 0);
      const settled: DisplayedResources = { ...nextDisplay, previous: null };
      displayRef.current = settled;
      setDisplay(settled);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [
    activeEnvelopeKey,
    activeKey,
    activeRecord?.resource,
    activeRecord?.status,
    invalidate,
    reducedMotion,
  ]);

  const displayMatchesSelection = historicalRuntimeResourceCanRender({
    displayKey: display.currentKey,
    activeKey,
    activeStatus: activeRecord?.status ?? null,
    displayedResource: display.current,
    activeResource: activeRecord?.resource ?? null,
  });
  const presentationCandidate = displayMatchesSelection &&
    activeKey !== null &&
    display.current !== null &&
    display.previous === null
    ? { key: activeKey, resource: display.current }
    : null;
  presentationCandidateRef.current = presentationCandidate;

  const renderedDisplayKey = display.currentKey;
  const attachDisplayGroup = useCallback((group: Group | null): void => {
    attachedGroupRef.current = group;
    attachedKeyRef.current = group === null ? null : renderedDisplayKey;
    if (group !== null) invalidate();
  }, [invalidate, renderedDisplayKey]);

  useFrame(() => {
    const candidate = presentationCandidateRef.current;
    if (
      candidate === null ||
      !historicalRuntimePresentationCanAcknowledge({
        candidateKey: candidate.key,
        attachedKey: attachedKeyRef.current,
        groupAttached: attachedGroupRef.current !== null,
      }) ||
      presentedKeyRef.current === candidate.key ||
      presentationFrameRef.current !== null
    ) return;
    const key = candidate.key;
    const resource = candidate.resource;
    presentationFrameRef.current = requestAnimationFrame(() => {
      presentationFrameRef.current = null;
      const latest = presentationCandidateRef.current;
      if (
        latest?.key !== key ||
        latest.resource !== resource ||
        !historicalRuntimePresentationCanAcknowledge({
          candidateKey: key,
          attachedKey: attachedKeyRef.current,
          groupAttached: attachedGroupRef.current !== null,
        })
      ) return;
      presentedKeyRef.current = key;
      setPresentedKey(key);
    });
  });

  if (!displayMatchesSelection || display.current === null) return null;
  return (
    <group
      key={display.currentKey ?? undefined}
      ref={attachDisplayGroup}
      name="historical-runtime-capture"
    >
      {display.previous?.meshes.map((mesh, index) => (
        <primitive key={`previous:${display.previous?.binding.bindingId ?? "none"}:${String(index)}`} object={mesh} />
      ))}
      {display.current.meshes.map((mesh, index) => (
        <primitive key={`current:${display.currentKey ?? "none"}:${String(index)}`} object={mesh} />
      ))}
    </group>
  );
}
