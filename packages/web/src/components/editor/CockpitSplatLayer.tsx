import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { useSplatDelivery, type SplatDeliveryStage } from "../../hooks/use-splat-delivery.js";
import type { RoomSplatLadder } from "../../data/room-splat-bundles.js";
import type { SparkSplatLoadEvent, SparkSplatErrorEvent } from "../scene/SparkSplatLayer.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import {
  createDissolveChannel,
  setDissolveTarget,
  stepDissolveChannel,
  type DissolveChannel,
} from "../../lib/dissolve-channel.js";

export interface CockpitSplatLayerProps {
  readonly urls: readonly string[];
  readonly ladder?: RoomSplatLadder | null;
  readonly transform: RuntimeAssetViewTransform;
  /** Whether the splat should be shown for the current layer mode. */
  readonly active: boolean;
  readonly onFirstFrame?: () => void;
  readonly minimumDrawnSources?: number;
  /** Fires once per chunk when its captured bytes finish decoding (CARD A2). */
  readonly onChunkLoaded?: (url: string) => void;
  /** Fires once per chunk whose decode fails permanently, so the resolve
   *  phase can settle instead of wedging in "developing". */
  readonly onChunkFailed?: (url: string) => void;
}

const DISSOLVE_EASE = 0.16;
// Per-chunk develop is slightly softer than the mode dissolve so arrivals
// read as the room developing coarse-to-fine rather than popping (02 §6).
const REVEAL_EASE = 0.12;

let sparkModule: Promise<typeof import("../scene/SparkSplatLayer.js")> | undefined;
function loadSparkModule() {
  sparkModule ??= import("../scene/SparkSplatLayer.js");
  return sparkModule;
}

const LazySparkSplatLayer = lazy(async () => {
  const module = await loadSparkModule();
  return { default: module.SparkSplatLayer };
});

/** Read-only benchmark observation; decode readiness does not prove displayed pixels. */
declare global {
  interface Window {
    __plannerSplatDelivery?: {
      readonly stage: SplatDeliveryStage;
      readonly firstDecoded: boolean;
      /** performance.now() at the first room-geometry decode callback. */
      readonly firstDecodedAtMs: number | null;
      readonly finestSettled: number;
      readonly finestTotal: number;
      readonly finestFailed: number;
      readonly finestComplete: boolean;
    };
  }
}

/**
 * The renderer host, mounted on nothing of its own. One host per scene (T-574),
 * and never owned by a tile: the ladder drops the coarse room when the finest
 * level lands, and a host mounted on that tile would leave with it. This is
 * also the only mount SparkSplatLayer forwards `onFirstFrame` to, so the
 * planner's first-populated-draw handover is attached here.
 */
const LazySparkRendererMount = lazy(async () => {
  const module = await loadSparkModule();
  return { default: module.SparkRendererMount };
});

/**
 * In-canvas Mesh↔Splat dissolve plus the CARD A2 develop: each registered
 * Gaussian-splat chunk eases in as it decodes (coarse-to-fine over the
 * blueprint ink), while the shared opacity eases toward the layer-mode target
 * (1 when active, 0 when not), invalidating each frame so the splat redraws
 * under `frameloop="demand"`. Honours `prefers-reduced-motion` by snapping
 * instead of animating.
 *
 * Ref-driven: every eased value lives in a DissolveChannel and is stepped
 * inside ONE useFrame, with SplatMesh opacity applied by SparkSplatLayer's
 * polled opacityFn. Per-channel timestamps preserve a fresh fade after demand
 * idle while allowing genuinely slow active frames to catch up. No React state
 * or per-frame reconciliation is introduced by this animation.
 */
export function CockpitSplatLayer({ urls, ladder, transform, active, onChunkLoaded, onChunkFailed, onFirstFrame, minimumDrawnSources }: CockpitSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  // No ladder (a registered package): every url is a finest tile delivered in
  // one rung. Environment membership belongs to the ladder's own array, which
  // is empty here, so no source claims the manifest's environment role.
  const direct = useMemo<RoomSplatLadder>(() => ({
    environment: [], coarse: [], sharp: urls.map((url) => ({ url, file: url, tree: false, isEnvironment: false })),
  }), [urls]);
  const delivery = useSplatDelivery(ladder ?? direct);
  const deliveryKeyRef = useRef<string | null>(delivery.key);
  useEffect(() => {
    deliveryKeyRef.current = delivery.key;
    return () => { deliveryKeyRef.current = null; };
  }, [delivery.key]);
  const finalUrlsRef = useRef(new Set(urls));
  useEffect(() => { finalUrlsRef.current = new Set(urls); }, [urls]);
  const layered = ladder !== null && ladder !== undefined;
  const { stage, progress, firstDecodedAtMs } = delivery;
  useEffect(() => {
    window.__plannerSplatDelivery = {
      stage, firstDecoded: progress.firstView, firstDecodedAtMs,
      finestSettled: progress.settled, finestTotal: progress.total,
      finestFailed: progress.failed, finestComplete: progress.complete,
    };
  }, [stage, progress, firstDecodedAtMs]);
  useEffect(() => () => { delete window.__plannerSplatDelivery; }, []);
  const onChunkLoadedRef = useRef(onChunkLoaded);
  const onChunkFailedRef = useRef(onChunkFailed);
  useEffect(() => { onChunkLoadedRef.current = onChunkLoaded; }, [onChunkLoaded]);
  useEffect(() => { onChunkFailedRef.current = onChunkFailed; }, [onChunkFailed]);

  // Every eased value lives here; nothing in the dissolve touches React state.
  // Initial shared value equals its target so a fresh mount does not fade.
  const sharedRef = useRef<DissolveChannel>(createDissolveChannel(active ? 1 : 0, performance.now()));
  // A new delivery session owns fresh channels: a disposed ladder's tiles must
  // never keep easing into their replacement's opacity.
  const channels = useMemo(() => ({
    chunks: new Map<string, DissolveChannel>(),
    opacityFns: new Map<string, () => number>(),
    deliveryKey: delivery.key,
  }), [delivery.key]);

  const opacityFnFor = useCallback((url: string): (() => number) => {
    let fn = channels.opacityFns.get(url);
    if (fn === undefined) {
      // Ladder layers must be drawable as soon as decoded. Fading finest
      // tiles from zero after dropping the coarse cover would expose holes,
      // and zero-opacity Spark layers can miss tree traversal while loading.
      if (!channels.chunks.has(url)) channels.chunks.set(url, createDissolveChannel(layered ? 1 : 0, performance.now()));
      fn = () => sharedRef.current.value * (channels.chunks.get(url)?.value ?? 0);
      channels.opacityFns.set(url, fn);
    }
    return fn;
  }, [channels, layered]);

  // Target changes must WAKE the demand loop; the frame loop below only
  // sustains it. (The two halves of invalidation — see the splat camera
  // gotcha; building only the second half reads as a frozen dissolve.)
  useEffect(() => {
    setDissolveTarget(sharedRef.current, active ? 1 : 0, DISSOLVE_EASE, performance.now());
    invalidate();
  }, [active, invalidate]);

  useEffect(() => {
    const known = new Set(delivery.mounted.map((source) => source.url));
    for (const url of [...channels.chunks.keys()]) {
      if (!known.has(url)) {
        channels.chunks.delete(url);
        channels.opacityFns.delete(url);
      }
    }
    invalidate();
  }, [channels, delivery.mounted, invalidate]);

  const handleChunkLoaded = useCallback((event: SparkSplatLoadEvent) => {
    if (deliveryKeyRef.current !== delivery.key) return;
    delivery.onLoad(event);
    const channel = channels.chunks.get(event.url);
    if (channel !== undefined) setDissolveTarget(channel, 1, REVEAL_EASE, performance.now());
    invalidate();
    // Progress in the planner's resolve strip remains its original final
    // source set: a coarse arrival must not prematurely remove blueprint ink.
    if (finalUrlsRef.current.has(event.url)) onChunkLoadedRef.current?.(event.url);
  }, [channels, delivery.key, delivery.onLoad, invalidate]);

  const handleChunkFailed = useCallback((event: SparkSplatErrorEvent) => {
    if (deliveryKeyRef.current !== delivery.key) return;
    delivery.onError(event);
    if (finalUrlsRef.current.has(event.url)) onChunkFailedRef.current?.(event.url);
  }, [delivery.key, delivery.onError]);

  useFrame(() => {
    const nowMs = performance.now();
    const reduced = prefersReducedMotion();
    let needsRedraw = stepDissolveChannel(sharedRef.current, DISSOLVE_EASE, nowMs, reduced);
    for (const channel of channels.chunks.values()) {
      if (stepDissolveChannel(channel, REVEAL_EASE, nowMs, reduced)) needsRedraw = true;
    }
    if (needsRedraw) invalidate();
  });

  if (urls.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {/* The renderer outlives the coarse tile and is never owned by it; it is
          also the only mount that honours onFirstFrame/minimumDrawnSources. */}
      <LazySparkRendererMount onFirstFrame={onFirstFrame} minimumDrawnSources={minimumDrawnSources} />
      {delivery.mounted.map((source) => (
        <LazySparkSplatLayer
          key={`${delivery.key}:${source.url}`}
          url={source.url}
          paged={source.tree}
          visible
          position={transform.position}
          rotation={transform.rotation}
          scale={transform.scale}
          opacityFn={opacityFnFor(source.url)}
          includeRendererHost={false}
          onLoad={handleChunkLoaded}
          onError={handleChunkFailed}
        />
      ))}
    </Suspense>
  );
}
