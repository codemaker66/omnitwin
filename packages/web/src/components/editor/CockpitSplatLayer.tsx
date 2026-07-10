import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";

export interface CockpitSplatLayerProps {
  readonly urls: readonly string[];
  readonly transform: RuntimeAssetViewTransform;
  /** Whether the splat should be shown for the current layer mode. */
  readonly active: boolean;
}

const DISSOLVE_EASE = 0.16;
const DISSOLVE_SNAP = 0.012;

const LazySparkSplatLayer = lazy(async () => {
  const module = await import("../scene/SparkSplatLayer.js");
  return { default: module.SparkSplatLayer };
});

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * In-canvas Mesh↔Splat dissolve. Renders the registered Gaussian-splat chunks
 * via Spark and eases their opacity toward the target (1 when active, 0 when
 * not), invalidating each frame so the splat redraws under `frameloop="demand"`.
 * The result is the captured Trades Hall room melting in over the procedural
 * mesh. Honours `prefers-reduced-motion` by snapping instead of animating.
 */
export function CockpitSplatLayer({ urls, transform, active }: CockpitSplatLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);
  const [opacity, setOpacity] = useState(active ? 1 : 0);
  const opacityRef = useRef(opacity);

  useEffect(() => {
    const target = active ? 1 : 0;
    if (prefersReducedMotion()) {
      opacityRef.current = target;
      setOpacity(target);
      invalidate();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      const current = opacityRef.current;
      const delta = target - current;
      if (Math.abs(delta) <= DISSOLVE_SNAP) {
        opacityRef.current = target;
        setOpacity(target);
        invalidate();
        return;
      }
      const next = current + delta * (1 - Math.pow(1 - DISSOLVE_EASE, dt * 60));
      opacityRef.current = next;
      setOpacity(next);
      invalidate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [active, invalidate]);

  if (urls.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {urls.map((url, index) => (
        <LazySparkSplatLayer
          key={url}
          url={url}
          visible={opacity > 0.002}
          opacity={opacity}
          position={transform.position}
          rotation={transform.rotation}
          scale={transform.scale}
          includeRendererHost={index === 0}
        />
      ))}
    </Suspense>
  );
}
