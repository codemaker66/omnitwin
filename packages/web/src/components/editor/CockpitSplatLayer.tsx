import { Suspense, lazy, useCallback, useEffect, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import {
  createDissolveChannel,
  setDissolveTarget,
  stepDissolveChannel,
  type DissolveChannel,
} from "../../lib/dissolve-channel.js";

export interface CockpitSplatLayerProps {
  readonly urls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  /** Whether the splat should be shown for the current layer mode. */
  readonly active: boolean;
  readonly onFirstFrame?: () => void;
  readonly minimumDrawnSources?: number;
  /** Fires once per chunk after its first visible main-camera draw (CARD A2). */
  readonly onChunkLoaded?: (url: string) => void;
  /** Fires once per chunk whose load or draw fails, so the resolve
   *  phase can settle instead of wedging in "developing". */
  readonly onChunkFailed?: (url: string) => void;
}

const DISSOLVE_EASE = 0.16;
// Per-chunk develop is slightly softer than the mode dissolve so arrivals
// read as the room developing coarse-to-fine rather than popping (02 §6).
const REVEAL_EASE = 0.12;

const LazyNativeSplatLayer = lazy(async () => {
  const module = await import("../scene/NativeSplatLayer.js");
  return { default: module.NativeSplatLayer };
});

/**
 * Ref-driven dissolve engine: every eased value lives in refs and is stepped
 * inside ONE useFrame, with source opacity applied by NativeSplatLayer's
 * polled opacityFn. Per-channel timestamps preserve a fresh fade after demand
 * idle while allowing genuinely slow active frames to catch up. No React
 * state or per-frame reconciliation is introduced by this animation.
 */
interface RevealingSplatChunkProps {
  readonly url: string;
  readonly transform: RuntimeAssetViewTransform;
  /** Polled per frame by NativeSplatLayer; identity-stable per url. */
  readonly opacityFn: () => number;
  readonly includeRendererHost: boolean;
  readonly onFirstFrame?: () => void;
  readonly minimumDrawnSources?: number;
  readonly onDecoded: (url: string) => void;
  readonly onRendered: (url: string) => void;
  readonly onFailed: (url: string) => void;
}

/**
 * One captured chunk developing into the scene: invisible until its bytes
 * decode, then eased in by the engine above. Stable callbacks forward the
 * latest parent handlers. NativeSplatLayer keeps callback updates separate
 * from the source's decode/registration lifecycle. A permanent decode failure
 * is reported upward so the phase machine can settle instead of wedging in
 * "developing".
 */
function RevealingSplatChunk({
  url,
  transform,
  opacityFn,
  includeRendererHost,
  onFirstFrame,
  minimumDrawnSources,
  onDecoded,
  onRendered,
  onFailed,
}: RevealingSplatChunkProps): ReactElement {
  const onDecodedRef = useRef(onDecoded);
  const onRenderedRef = useRef(onRendered);
  const onFailedRef = useRef(onFailed);
  useEffect(() => { onDecodedRef.current = onDecoded; }, [onDecoded]);
  useEffect(() => { onRenderedRef.current = onRendered; }, [onRendered]);
  useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

  const handleLoad = useCallback(() => {
    onDecodedRef.current(url);
  }, [url]);

  const handleRendered = useCallback(() => {
    onRenderedRef.current(url);
  }, [url]);

  const handleError = useCallback(() => {
    onFailedRef.current(url);
  }, [url]);

  return (
    <LazyNativeSplatLayer
      url={url}
      visible
      opacityFn={opacityFn}
      position={transform.position}
      rotation={transform.rotation}
      scale={transform.scale}
      includeRendererHost={includeRendererHost}
      onFirstFrame={onFirstFrame}
      minimumDrawnSources={minimumDrawnSources}
      onLoad={handleLoad}
      onRendered={handleRendered}
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
export function CockpitSplatLayer({ urls, transform, active, onChunkLoaded, onChunkFailed, onFirstFrame, minimumDrawnSources }: CockpitSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const onChunkLoadedRef = useRef(onChunkLoaded);
  const onChunkFailedRef = useRef(onChunkFailed);
  useEffect(() => { onChunkLoadedRef.current = onChunkLoaded; }, [onChunkLoaded]);
  useEffect(() => { onChunkFailedRef.current = onChunkFailed; }, [onChunkFailed]);

  // Every eased value lives here; nothing in the dissolve touches React state.
  // Initial shared value equals its target so a fresh mount does not fade.
  const sharedRef = useRef<DissolveChannel>(createDissolveChannel(active ? 1 : 0, performance.now()));
  const chunksRef = useRef<Map<string, DissolveChannel>>(new Map());
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
    setDissolveTarget(sharedRef.current, active ? 1 : 0, DISSOLVE_EASE, performance.now());
    invalidate();
  }, [active, invalidate]);

  useEffect(() => {
    const known = new Set(urls);
    const nowMs = performance.now();
    for (const url of urls) {
      if (!chunksRef.current.has(url)) chunksRef.current.set(url, createDissolveChannel(0, nowMs));
    }
    for (const url of [...chunksRef.current.keys()]) {
      if (!known.has(url)) {
        chunksRef.current.delete(url);
        opacityFnsRef.current.delete(url);
      }
    }
    invalidate();
  }, [urls, invalidate]);

  const handleChunkDecoded = useCallback((url: string) => {
    const channel = chunksRef.current.get(url);
    if (channel !== undefined) setDissolveTarget(channel, 1, REVEAL_EASE, performance.now());
    invalidate();
  }, [invalidate]);

  // Decoding starts the reveal; only native's confirmed main-camera draw
  // may advance progress and retire the blueprint ink covering that source.
  const handleChunkRendered = useCallback((url: string) => {
    onChunkLoadedRef.current?.(url);
  }, []);

  const handleChunkFailed = useCallback((url: string) => {
    onChunkFailedRef.current?.(url);
  }, []);

  useFrame(() => {
    const nowMs = performance.now();
    const reduced = prefersReducedMotion();
    let needsRedraw = stepDissolveChannel(sharedRef.current, DISSOLVE_EASE, nowMs, reduced);
    for (const channel of chunksRef.current.values()) {
      if (stepDissolveChannel(channel, REVEAL_EASE, nowMs, reduced)) needsRedraw = true;
    }
    if (needsRedraw) invalidate();
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
          onFirstFrame={onFirstFrame}
          minimumDrawnSources={minimumDrawnSources}
          onDecoded={handleChunkDecoded}
          onRendered={handleChunkRendered}
          onFailed={handleChunkFailed}
        />
      ))}
    </Suspense>
  );
}
