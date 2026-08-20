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
  HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE,
  HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE,
  HISTORICAL_RUNTIME_MAX_MEMBERS,
  HISTORICAL_RUNTIME_MAX_SPLATS_PER_RESOURCE,
  HistoricalRuntimeCache,
  HistoricalRuntimeLifecycleError,
  historicalRuntimeBindingKey,
  historicalRuntimeCombinedSplatsWithinBudget,
  historicalRuntimeCompressedBytes,
  historicalRuntimeCrossfadeAllowed,
  historicalRuntimeDecodedSplatsWithinViewerBudget,
  historicalRuntimeResourceCanRender,
  historicalRuntimeRemainingAdjacentSplatBudget,
  historicalRuntimeResourceKey,
  historicalRuntimeViewerCapacity,
} from "../../lib/historical-runtime-cache.js";
import { resolveHistoricalRuntimeAssetToRrfTransform } from "../../lib/historical-runtime-transform.js";
import { useHistoricalRuntimeStatusStore } from "../../stores/historical-runtime-status-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { sparkRendererAdmissionGate } from "../scene/spark-renderer-lifecycle.js";

const MAX_REMEMBERED_SPLAT_COUNTS = 32;
export const HISTORICAL_RUNTIME_MESH_INITIALIZATION_TIMEOUT_MS = 20_000;
const splatBudgetByBinding = new WeakMap<PhaseLayoutRuntimeAvailableBinding, number>();
const splatCountByResourceKey = new Map<string, number>();

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

interface TimelineRuntimeBlendResources {
  readonly fromKey: string;
  readonly from: HistoricalRuntimeResource;
  readonly toKey: string;
  readonly to: HistoricalRuntimeResource;
}

export function historicalRuntimeTimelineBlendOpacities(progress: number): {
  readonly from: number;
  readonly to: number;
} {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return { from: 1 - clamped, to: clamped };
}

export function historicalRuntimeTimelineBlendHasDistinctResources(
  fromKey: string | null,
  toKey: string | null,
): boolean {
  return fromKey !== null && toKey !== null && fromKey !== toKey;
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
  const key = historicalRuntimeResourceKey(binding);
  splatCountByResourceKey.delete(key);
  splatCountByResourceKey.set(key, count);
  while (splatCountByResourceKey.size > MAX_REMEMBERED_SPLAT_COUNTS) {
    const oldest = splatCountByResourceKey.keys().next();
    if (oldest.done === true) break;
    splatCountByResourceKey.delete(oldest.value);
  }
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfDecodeAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function awaitHistoricalRuntimeMeshInitialization(
  mesh: HistoricalRuntimeMesh,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<HistoricalRuntimeMesh> {
  if (signal.aborted) throw abortError();
  return new Promise<HistoricalRuntimeMesh>((resolve, reject) => {
    let settled = false;
    const settle = (next: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      next();
    };
    const onAbort = (): void => { settle(() => { reject(abortError()); }); };
    const timeoutId = setTimeout(() => {
      settle(() => {
        reject(new Error(HISTORICAL_RUNTIME_DECODE_TIMEOUT_ERROR_MESSAGE));
      });
    }, Math.max(1, timeoutMs));
    signal.addEventListener("abort", onAbort, { once: true });
    void mesh.initialized.then(
      (initialized) => { settle(() => { resolve(initialized); }); },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error
            ? error
            : new Error("The exact historical room capture could not initialize."));
        });
      },
    );
  });
}

export function disposeHistoricalRuntimeResource(
  resource: HistoricalRuntimeResource,
  quarantine: () => void = () => { sparkRendererAdmissionGate.quarantine(); },
): void {
  if (resource.disposed) return;
  resource.disposed = true;
  let failed = false;
  const uniqueMeshes = new Set(resource.meshes);
  for (const mesh of uniqueMeshes) {
    try {
      mesh.visible = false;
      mesh.opacity = 0;
    } catch {
      failed = true;
    }
    try {
      mesh.dispose();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    try {
      quarantine();
    } catch {
      // The sanitized lifecycle failure still surfaces even if reporting fails.
    }
    throw new HistoricalRuntimeLifecycleError();
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
  initializationTimeoutMs = HISTORICAL_RUNTIME_MESH_INITIALIZATION_TIMEOUT_MS,
): Promise<HistoricalRuntimeResource> {
  const transform = resolveHistoricalRuntimeAssetToRrfTransform(binding);
  if (!transform.ok) throw new Error(transform.message);
  const meshes: HistoricalRuntimeMesh[] = [];
  const resource: HistoricalRuntimeResource = { binding, meshes, splatCount: 0, disposed: false };
  const matrix = new Matrix4().fromArray(transform.matrix);

  try {
    for (const asset of assets) {
      throwIfDecodeAborted(signal);
      const remainingSplats = maxSplats - resource.splatCount;
      const mesh = createMesh(asset, remainingSplats + 1);
      mesh.visible = false;
      mesh.opacity = 0;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
      mesh.matrixWorldNeedsUpdate = true;
      meshes.push(mesh);
      await awaitHistoricalRuntimeMeshInitialization(
        mesh,
        signal,
        initializationTimeoutMs,
      );
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
      throwIfDecodeAborted(signal);
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
  onLifecycleError: () => { sparkRendererAdmissionGate.quarantine(); },
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
  const previewTransitionMode = useLayoutTimelinePreviewStore(
    (state) => state.transition?.mode ?? null,
  );
  const previewTransitionRoomEnvelopeChanged = useLayoutTimelinePreviewStore(
    (state) => state.transition?.roomEnvelopeChanged ?? false,
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
  const selectedAuthorizationKeyRef = useRef<string | null>(null);
  const selectedResourceKeyRef = useRef<string | null>(null);
  const presentationFrameRef = useRef<number | null>(null);
  const attachedGroupRef = useRef<Group | null>(null);
  const attachedKeyRef = useRef<string | null>(null);
  const presentationCandidateRef = useRef<RuntimePresentationCandidate | null>(null);
  const presentedKeyRef = useRef<string | null>(null);
  const [presentedKey, setPresentedKey] = useState<string | null>(null);
  const transitionBlendRef = useRef<TimelineRuntimeBlendResources | null>(null);
  const lastTransitionBlendProgressRef = useRef<number | null>(null);
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
  const candidateAuthorizationKey = candidateBinding === null
    ? null
    : historicalRuntimeBindingKey(candidateBinding);
  const candidateResourceKey = candidateBinding === null
    ? null
    : historicalRuntimeResourceKey(candidateBinding);
  const candidateRecord = candidateAuthorizationKey === null
    ? undefined
    : snapshot.records.get(candidateAuthorizationKey);
  const knownActiveSplatCount = candidateResourceKey === null
    ? undefined
    : candidateRecord?.resource?.splatCount ?? splatCountByResourceKey.get(candidateResourceKey);
  const activeFitsSplatBudget = knownActiveSplatCount === undefined ||
    historicalRuntimeDecodedSplatsWithinViewerBudget(
      knownActiveSplatCount,
      viewerCapacity.maxSplats,
    );
  const activeBinding = activeFitsSplatBudget ? candidateBinding : null;
  const activeAuthorizationKey = activeBinding === null ? null : candidateAuthorizationKey;
  const activeKey = activeBinding === null ? null : candidateResourceKey;
  const activeRecord = activeAuthorizationKey === null ? undefined : candidateRecord;
  const activeEnvelopeKey = activeFrame?.venueRuntime === null || activeFrame?.venueRuntime === undefined
    ? null
    : frozenRoomEnvelopeKey(activeFrame.venueRuntime);
  const transitionFromBinding = previewTransitionFromFrame?.historicalRuntime?.state === "available"
    ? previewTransitionFromFrame.historicalRuntime.binding
    : null;
  const transitionToBinding = previewTransitionToFrame?.historicalRuntime?.state === "available"
    ? previewTransitionToFrame.historicalRuntime.binding
    : null;
  const transitionFromAuthorizationKey = transitionFromBinding === null
    ? null
    : historicalRuntimeBindingKey(transitionFromBinding);
  const transitionToAuthorizationKey = transitionToBinding === null
    ? null
    : historicalRuntimeBindingKey(transitionToBinding);
  const transitionFromKey = transitionFromBinding === null
    ? null
    : historicalRuntimeResourceKey(transitionFromBinding);
  const transitionToKey = transitionToBinding === null
    ? null
    : historicalRuntimeResourceKey(transitionToBinding);
  const transitionFromRecord = transitionFromAuthorizationKey === null
    ? undefined
    : snapshot.records.get(transitionFromAuthorizationKey);
  const transitionToRecord = transitionToAuthorizationKey === null
    ? undefined
    : snapshot.records.get(transitionToAuthorizationKey);
  const timelineRuntimeBlend = useMemo<TimelineRuntimeBlendResources | null>(() => {
    if (
      previewTransitionMode !== "same-event-morph"
      || previewTransitionRoomEnvelopeChanged
      || reducedMotion
      || transitionFromBinding === null
      || transitionToBinding === null
      || transitionFromKey === null
      || transitionToKey === null
      || !historicalRuntimeTimelineBlendHasDistinctResources(
        transitionFromKey,
        transitionToKey,
      )
      || transitionFromRecord?.status !== "ready"
      || transitionToRecord?.status !== "ready"
      || transitionFromRecord.resource === null
      || transitionToRecord.resource === null
    ) return null;
    const from = transitionFromRecord.resource;
    const to = transitionToRecord.resource;
    return historicalRuntimeCrossfadeAllowed({
      from: transitionFromBinding,
      to: transitionToBinding,
      sameEnvelope: true,
      reducedMotion: false,
      combinedByteBudget: HISTORICAL_RUNTIME_DESKTOP_BYTE_BUDGET,
      fromSplatCount: from.splatCount,
      toSplatCount: to.splatCount,
      combinedSplatBudget: HISTORICAL_RUNTIME_CROSSFADE_SPLAT_BUDGET,
    })
      ? { fromKey: transitionFromKey, from, toKey: transitionToKey, to }
      : null;
  }, [
    previewTransitionMode,
    previewTransitionRoomEnvelopeChanged,
    reducedMotion,
    transitionFromBinding,
    transitionFromAuthorizationKey,
    transitionFromKey,
    transitionFromRecord,
    transitionToBinding,
    transitionToAuthorizationKey,
    transitionToKey,
    transitionToRecord,
  ]);
  transitionBlendRef.current = timelineRuntimeBlend;
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
  const adjacentCandidateResourceKey = adjacentBindingCandidate === null
    ? null
    : historicalRuntimeResourceKey(adjacentBindingCandidate);
  const adjacentSplatCount = adjacentCandidateResourceKey === null
    ? undefined
    : splatCountByResourceKey.get(adjacentCandidateResourceKey);
  const adjacentSharesActiveResource = activeKey !== null &&
    adjacentCandidateResourceKey === activeKey;
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
  const adjacentFitsCombinedSplatBudget = adjacentSharesActiveResource ||
    adjacentSplatCount === undefined ||
    (knownActiveSplatCount !== undefined &&
      historicalRuntimeCombinedSplatsWithinBudget(
        knownActiveSplatCount,
        adjacentSplatCount,
        combinedResidentSplatBudget,
      ));
  const adjacentFitsBudget = activeBinding !== null && adjacentBindingCandidate !== null &&
    adjacentBindingCandidate.visualAssets.length <= HISTORICAL_RUNTIME_MAX_MEMBERS &&
    (adjacentSharesActiveResource ||
      historicalRuntimeCompressedBytes(activeBinding) + historicalRuntimeCompressedBytes(adjacentBindingCandidate)
        <= viewerCapacity.maxCompressedBytes);
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
    (adjacentSharesActiveResource || remainingAdjacentSplatBudget > 0);

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
    cancelPresentationFrame();
    historicalRuntimeCache.clear();
    splatCountByResourceKey.clear();
  }, [cancelPresentationFrame]);

  useLayoutEffect(() => {
    cancelPresentationFrame();
    presentedKeyRef.current = null;
    setPresentedKey(null);
  }, [activeAuthorizationKey, activeKey, activeRecord?.resource, cancelPresentationFrame]);

  useLayoutEffect(() => {
    const publish = useHistoricalRuntimeStatusStore.getState().publish;
    if (previewMode === "inactive") {
      publish({ state: "inactive", bindingId: null, message: null });
      return;
    }
    if (snapshot.lifecycleError !== null) {
      publish({
        state: "error",
        bindingId: historicalRuntime?.binding?.bindingId ?? null,
        message: HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE,
      });
      return;
    }
    if (rendererQuarantined) {
      publish({
        state: "unavailable",
        bindingId: historicalRuntime?.binding?.bindingId ?? null,
        message: HISTORICAL_RUNTIME_LIFECYCLE_ERROR_MESSAGE,
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
    snapshot.lifecycleError,
    transform,
  ]);

  useLayoutEffect(() => {
    const selectionChanged = selectedAuthorizationKeyRef.current !== activeAuthorizationKey;
    selectedAuthorizationKeyRef.current = activeAuthorizationKey;
    selectedResourceKeyRef.current = activeKey;
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
    if (timelineRuntimeBlend !== null) {
      const activeIsFrom = activeKey === timelineRuntimeBlend.fromKey;
      const current = activeIsFrom ? timelineRuntimeBlend.from : timelineRuntimeBlend.to;
      const previous = activeIsFrom ? timelineRuntimeBlend.to : timelineRuntimeBlend.from;
      const nextDisplay: DisplayedResources = {
        currentKey: activeKey,
        current,
        currentEnvelopeKey: activeEnvelopeKey,
        previous,
      };
      const transitionProgress = useLayoutTimelinePreviewStore.getState().transition?.progress ?? 0;
      const opacity = historicalRuntimeTimelineBlendOpacities(transitionProgress);
      setResourceOpacity(timelineRuntimeBlend.from, opacity.from);
      setResourceOpacity(timelineRuntimeBlend.to, opacity.to);
      lastTransitionBlendProgressRef.current = transitionProgress;
      displayRef.current = nextDisplay;
      setDisplay(nextDisplay);
      invalidate();
      return;
    }
    if (!selectionChanged && previousDisplay.current === target) {
      if (previousDisplay.previous !== null) {
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
    setResourceOpacity(previousDisplay.previous, 0);
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
  }, [
    activeEnvelopeKey,
    activeAuthorizationKey,
    activeKey,
    activeRecord?.resource,
    activeRecord?.status,
    invalidate,
    reducedMotion,
    timelineRuntimeBlend,
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
    (display.previous === null || timelineRuntimeBlend !== null)
    ? { key: activeKey, resource: display.current }
    : null;
  presentationCandidateRef.current = presentationCandidate;

  const attachDisplayGroup = useCallback((group: Group | null): void => {
    attachedGroupRef.current = group;
    attachedKeyRef.current = group === null ? null : selectedResourceKeyRef.current;
    if (group !== null) invalidate();
  }, [invalidate]);

  useLayoutEffect(() => {
    if (attachedGroupRef.current !== null) attachedKeyRef.current = display.currentKey;
  }, [display.currentKey]);

  useEffect(() => {
    if (timelineRuntimeBlend === null) return undefined;
    let previousProgress = useLayoutTimelinePreviewStore.getState().transition?.progress ?? null;
    return useLayoutTimelinePreviewStore.subscribe((state) => {
      const transition = state.transition;
      const progress = transition?.fromFrame.historicalRuntime?.state === "available"
        && transition.toFrame.historicalRuntime?.state === "available"
        && historicalRuntimeResourceKey(transition.fromFrame.historicalRuntime.binding) === timelineRuntimeBlend.fromKey
        && historicalRuntimeResourceKey(transition.toFrame.historicalRuntime.binding) === timelineRuntimeBlend.toKey
        ? transition.progress
        : null;
      if (progress === null || progress === previousProgress) return;
      previousProgress = progress;
      invalidate();
    });
  }, [invalidate, timelineRuntimeBlend]);

  useFrame(() => {
    const blend = transitionBlendRef.current;
    if (blend !== null) {
      const transition = useLayoutTimelinePreviewStore.getState().transition;
      const progress = transition?.fromFrame.historicalRuntime?.state === "available"
        && transition.toFrame.historicalRuntime?.state === "available"
        && historicalRuntimeResourceKey(transition.fromFrame.historicalRuntime.binding) === blend.fromKey
        && historicalRuntimeResourceKey(transition.toFrame.historicalRuntime.binding) === blend.toKey
        ? transition.progress
        : null;
      if (progress !== null && progress !== lastTransitionBlendProgressRef.current) {
        const opacity = historicalRuntimeTimelineBlendOpacities(progress);
        setResourceOpacity(blend.from, opacity.from);
        setResourceOpacity(blend.to, opacity.to);
        lastTransitionBlendProgressRef.current = progress;
      }
    } else {
      lastTransitionBlendProgressRef.current = null;
    }

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
      key={timelineRuntimeBlend === null
        ? display.currentKey ?? undefined
        : `blend:${timelineRuntimeBlend.fromKey}:${timelineRuntimeBlend.toKey}`}
      ref={attachDisplayGroup}
      name="historical-runtime-capture"
    >
      {timelineRuntimeBlend === null ? (
        <>
          {display.previous?.meshes.map((mesh, index) => (
            <primitive key={`previous:${display.previous?.binding.bindingId ?? "none"}:${String(index)}`} object={mesh} />
          ))}
          {display.current.meshes.map((mesh, index) => (
            <primitive key={`current:${display.currentKey ?? "none"}:${String(index)}`} object={mesh} />
          ))}
        </>
      ) : (
        <>
          {timelineRuntimeBlend.from.meshes.map((mesh, index) => (
            <primitive key={`blend-from:${timelineRuntimeBlend.fromKey}:${String(index)}`} object={mesh} />
          ))}
          {timelineRuntimeBlend.to.meshes.map((mesh, index) => (
            <primitive key={`blend-to:${timelineRuntimeBlend.toKey}:${String(index)}`} object={mesh} />
          ))}
        </>
      )}
    </group>
  );
}
