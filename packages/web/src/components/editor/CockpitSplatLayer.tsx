import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { useSplatDelivery, type SplatDeliveryStage } from "../../hooks/use-splat-delivery.js";
import type { RoomSplatLadder } from "../../data/room-splat-bundles.js";
import type { SparkSplatLoadEvent, SparkSplatErrorEvent } from "../scene/SparkSplatLayer.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";

export interface CockpitSplatLayerProps {
  readonly urls: readonly string[];
  readonly ladder?: RoomSplatLadder | null;
  readonly transform: RuntimeAssetViewTransform;
  /** Whether the splat should be shown for the current layer mode. */
  readonly active: boolean;
  /** Fires once per chunk when its captured bytes finish decoding (CARD A2). */
  readonly onChunkLoaded?: (url: string) => void;
  /** Fires once per chunk whose decode fails permanently, so the resolve
   *  phase can settle instead of wedging in "developing". */
  readonly onChunkFailed?: (url: string) => void;
}

const DISSOLVE_EASE = 0.16;
const DISSOLVE_SNAP = 0.012;
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

/**
 * Ref-driven dissolve engine: every eased value lives in refs and is stepped
 * inside ONE useFrame, with SplatMesh opacity applied by SparkSplatLayer's
 * polled opacityFn — no React state anywhere in the loop.
 *
 * The previous implementation called setState per animation frame per chunk,
 * which reconciled all nine chunk components every frame of every dissolve.
 * With the stage full-bleed that render storm rode on top of frames already
 * heavy with gaussian sorting, and on a slow GPU the main thread saturated so
 * completely that pointer stability checks starved for minutes (found by the
 * walk e2e, confirmed by a CPU profile: 5,436 of 5,442 samples in native
 * paint).
 *
 * The step uses the frame-rate-independent form (1 - (1-ease)^(dt*60)), so the
 * dissolve settles in the same wall-clock time at any frame rate, and values
 * snap exactly onto their targets at the end — a demand loop must never be
 * left holding a sub-snap error it will not redraw.
 */
interface EasedChannel {
  value: number;
  target: number;
}

function stepChannel(channel: EasedChannel, ease: number, dtSeconds: number, reduced: boolean): boolean {
  const delta = channel.target - channel.value;
  if (delta === 0) return false;
  if (reduced || Math.abs(delta) <= DISSOLVE_SNAP) {
    channel.value = channel.target;
    return true;
  }
  const clamped = Math.min(Math.max(dtSeconds, 0), 0.1);
  channel.value += delta * (1 - Math.pow(1 - ease, clamped * 60));
  return true;
}

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
 */
export function CockpitSplatLayer({ urls, ladder, transform, active, onChunkLoaded, onChunkFailed }: CockpitSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const direct = useMemo<RoomSplatLadder>(() => ({
    environment: [], coarse: [], sharp: urls.map((url) => ({ url, file: url, tree: false })),
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
  const sharedRef = useRef<EasedChannel>({ value: active ? 1 : 0, target: active ? 1 : 0 });
  const channels = useMemo(() => ({
    chunks: new Map<string, EasedChannel>(),
    opacityFns: new Map<string, () => number>(),
    deliveryKey: delivery.key,
  }), [delivery.key]);

  const opacityFnFor = useCallback((url: string): (() => number) => {
    let fn = channels.opacityFns.get(url);
    if (fn === undefined) {
      // Ladder layers must be drawable as soon as decoded. Fading finest
      // tiles from zero after dropping the coarse cover would expose holes,
      // and zero-opacity Spark layers can miss tree traversal while loading.
      if (!channels.chunks.has(url)) channels.chunks.set(url, { value: layered ? 1 : 0, target: layered ? 1 : 0 });
      fn = () => sharedRef.current.value * (channels.chunks.get(url)?.value ?? 0);
      channels.opacityFns.set(url, fn);
    }
    return fn;
  }, [channels, layered]);

  // Target changes must WAKE the demand loop; the frame loop below only
  // sustains it. (The two halves of invalidation — see the splat camera
  // gotcha; building only the second half reads as a frozen dissolve.)
  useEffect(() => {
    sharedRef.current.target = active ? 1 : 0;
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
    if (channel !== undefined) channel.target = 1;
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

  useFrame((_state, delta) => {
    const reduced = prefersReducedMotion();
    let moving = stepChannel(sharedRef.current, DISSOLVE_EASE, delta, reduced);
    for (const channel of channels.chunks.values()) {
      if (stepChannel(channel, REVEAL_EASE, delta, reduced)) moving = true;
    }
    if (moving) invalidate();
  });

  if (urls.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {/* The renderer outlives the coarse tile and is never owned by it. */}
      <LazySparkRendererMount />
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
