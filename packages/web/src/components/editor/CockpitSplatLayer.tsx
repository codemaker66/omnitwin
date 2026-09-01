import { Suspense, lazy, useCallback, useEffect, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";

export interface CockpitSplatLayerProps {
  readonly urls: readonly string[];
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

const LazySparkSplatLayer = lazy(async () => {
  const module = await import("../scene/SparkSplatLayer.js");
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

interface RevealingSplatChunkProps {
  readonly url: string;
  readonly transform: RuntimeAssetViewTransform;
  /** Polled per frame by SparkSplatLayer; identity-stable per url. */
  readonly opacityFn: () => number;
  readonly includeRendererHost: boolean;
  readonly onLoaded: (url: string) => void;
  readonly onFailed: (url: string) => void;
}

/**
 * One captured chunk developing into the scene: invisible until its bytes
 * decode, then eased in by the engine above. The onLoad/onError callbacks
 * passed to Spark must stay identity-stable — SparkSplatLayer disposes and
 * re-creates its SplatMesh when either callback's identity changes. A
 * permanent decode failure is reported upward so the phase machine can settle
 * instead of wedging in "developing" (reviewer HIGH finding).
 */
function RevealingSplatChunk({
  url,
  transform,
  opacityFn,
  includeRendererHost,
  onLoaded,
  onFailed,
}: RevealingSplatChunkProps): ReactElement {
  const onLoadedRef = useRef(onLoaded);
  const onFailedRef = useRef(onFailed);
  useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);
  useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

  const handleLoad = useCallback(() => {
    onLoadedRef.current(url);
  }, [url]);

  const handleError = useCallback(() => {
    onFailedRef.current(url);
  }, [url]);

  return (
    <LazySparkSplatLayer
      url={url}
      visible
      opacityFn={opacityFn}
      position={transform.position}
      rotation={transform.rotation}
      scale={transform.scale}
      includeRendererHost={includeRendererHost}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

/**
 * In-canvas Mesh↔Splat dissolve plus the CARD A2 develop: each registered
 * Gaussian-splat chunk eases in as it decodes (coarse-to-fine over the
 * blueprint ink), while the shared opacity eases toward the layer-mode target
 * (1 when active, 0 when not), invalidating each frame so the splat redraws
 * under `frameloop="demand"`. Honours `prefers-reduced-motion` by snapping
 * instead of animating.
 */
export function CockpitSplatLayer({ urls, transform, active, onChunkLoaded, onChunkFailed }: CockpitSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const onChunkLoadedRef = useRef(onChunkLoaded);
  const onChunkFailedRef = useRef(onChunkFailed);
  useEffect(() => { onChunkLoadedRef.current = onChunkLoaded; }, [onChunkLoaded]);
  useEffect(() => { onChunkFailedRef.current = onChunkFailed; }, [onChunkFailed]);

  // Every eased value lives here; nothing in the dissolve touches React state.
  // Initial shared value equals its target so a fresh mount does not fade.
  const sharedRef = useRef<EasedChannel>({ value: active ? 1 : 0, target: active ? 1 : 0 });
  const chunksRef = useRef<Map<string, EasedChannel>>(new Map());
  const opacityFnsRef = useRef<Map<string, () => number>>(new Map());

  const opacityFnFor = useCallback((url: string): (() => number) => {
    let fn = opacityFnsRef.current.get(url);
    if (fn === undefined) {
      fn = () => sharedRef.current.value * (chunksRef.current.get(url)?.value ?? 0);
      opacityFnsRef.current.set(url, fn);
    }
    return fn;
  }, []);

  // Target changes must WAKE the demand loop; the frame loop below only
  // sustains it. (The two halves of invalidation — see the splat camera
  // gotcha; building only the second half reads as a frozen dissolve.)
  useEffect(() => {
    sharedRef.current.target = active ? 1 : 0;
    invalidate();
  }, [active, invalidate]);

  useEffect(() => {
    const known = new Set(urls);
    for (const url of urls) {
      if (!chunksRef.current.has(url)) chunksRef.current.set(url, { value: 0, target: 0 });
    }
    for (const url of [...chunksRef.current.keys()]) {
      if (!known.has(url)) {
        chunksRef.current.delete(url);
        opacityFnsRef.current.delete(url);
      }
    }
    invalidate();
  }, [urls, invalidate]);

  const handleChunkLoaded = useCallback((url: string) => {
    const channel = chunksRef.current.get(url);
    if (channel !== undefined) channel.target = 1;
    invalidate();
    onChunkLoadedRef.current?.(url);
  }, [invalidate]);

  const handleChunkFailed = useCallback((url: string) => {
    onChunkFailedRef.current?.(url);
  }, []);

  useFrame((_state, delta) => {
    const reduced = prefersReducedMotion();
    let moving = stepChannel(sharedRef.current, DISSOLVE_EASE, delta, reduced);
    for (const channel of chunksRef.current.values()) {
      if (stepChannel(channel, REVEAL_EASE, delta, reduced)) moving = true;
    }
    if (moving) invalidate();
  });

  if (urls.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {urls.map((url, index) => (
        <RevealingSplatChunk
          key={url}
          url={url}
          transform={transform}
          opacityFn={opacityFnFor(url)}
          includeRendererHost={index === 0}
          onLoaded={handleChunkLoaded}
          onFailed={handleChunkFailed}
        />
      ))}
    </Suspense>
  );
}
