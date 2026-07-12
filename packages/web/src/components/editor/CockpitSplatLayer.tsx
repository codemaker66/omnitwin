import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
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

/** Exponential ease of a 0..1 value toward a target, invalidating the demand
 *  frameloop each step. Shared by the mode dissolve and the chunk reveal. */
function useEasedOpacity(target: number, ease: number): number {
  const invalidate = useThree((state) => state.invalidate);
  const [value, setValue] = useState(target);
  const valueRef = useRef(value);

  useEffect(() => {
    if (prefersReducedMotion()) {
      valueRef.current = target;
      setValue(target);
      invalidate();
      return undefined;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      const current = valueRef.current;
      const delta = target - current;
      if (Math.abs(delta) <= DISSOLVE_SNAP) {
        valueRef.current = target;
        setValue(target);
        invalidate();
        return;
      }
      const next = current + delta * (1 - Math.pow(1 - ease, dt * 60));
      valueRef.current = next;
      setValue(next);
      invalidate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [ease, invalidate, target]);

  return value;
}

interface RevealingSplatChunkProps {
  readonly url: string;
  readonly transform: RuntimeAssetViewTransform;
  /** The shared mode-dissolve opacity (Mesh ↔ Splat ↔ Hybrid). */
  readonly sharedOpacity: number;
  readonly includeRendererHost: boolean;
  readonly onLoaded: (url: string) => void;
  readonly onFailed: (url: string) => void;
}

/**
 * One captured chunk developing into the scene: invisible until its bytes
 * decode, then eased in and multiplied by the shared mode dissolve. The
 * onLoad/onError callbacks passed to Spark must stay identity-stable —
 * SparkSplatLayer disposes and re-creates its SplatMesh when either
 * callback's identity changes. A permanent decode failure is reported
 * upward so the phase machine can settle instead of wedging in
 * "developing" (reviewer HIGH finding).
 */
function RevealingSplatChunk({
  url,
  transform,
  sharedOpacity,
  includeRendererHost,
  onLoaded,
  onFailed,
}: RevealingSplatChunkProps): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  const onFailedRef = useRef(onFailed);
  useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);
  useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onLoadedRef.current(url);
  }, [url]);

  const handleError = useCallback(() => {
    onFailedRef.current(url);
  }, [url]);

  const reveal = useEasedOpacity(loaded ? 1 : 0, REVEAL_EASE);
  const opacity = sharedOpacity * reveal;

  return (
    <LazySparkSplatLayer
      url={url}
      visible={opacity > 0.002}
      opacity={opacity}
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
  const sharedOpacity = useEasedOpacity(active ? 1 : 0, DISSOLVE_EASE);
  const onChunkLoadedRef = useRef(onChunkLoaded);
  const onChunkFailedRef = useRef(onChunkFailed);
  useEffect(() => { onChunkLoadedRef.current = onChunkLoaded; }, [onChunkLoaded]);
  useEffect(() => { onChunkFailedRef.current = onChunkFailed; }, [onChunkFailed]);
  const handleChunkLoaded = useCallback((url: string) => {
    onChunkLoadedRef.current?.(url);
  }, []);
  const handleChunkFailed = useCallback((url: string) => {
    onChunkFailedRef.current?.(url);
  }, []);

  if (urls.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {urls.map((url, index) => (
        <RevealingSplatChunk
          key={url}
          url={url}
          transform={transform}
          sharedOpacity={sharedOpacity}
          includeRendererHost={index === 0}
          onLoaded={handleChunkLoaded}
          onFailed={handleChunkFailed}
        />
      ))}
    </Suspense>
  );
}
