import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

// ---------------------------------------------------------------------------
// AdaptiveResolution — renders the scene at full device pixel ratio when the
// camera is at rest, and at a reduced ratio while it is moving.
//
// OrbitControls' `regress` flag drives `performance.current` down to
// `performance.min` during any camera interaction (orbit, pan, inertial zoom,
// cinematic tours — everything routes through controls.update()). Cutting the
// pixel ratio *only while the view is in motion* removes roughly half the
// fragment/fill cost exactly when smoothness matters, then snaps back to full
// crispness the instant the camera settles. The reduction is imperceptible at
// speed and dominant on hi-DPI (Retina/4K) displays, where fragment cost scales
// with the square of the pixel ratio.
//
// This mirrors drei's <AdaptiveDpr> with two essential differences: it clamps
// the output to the route's configured DPR budget, and it invalidates on every
// resolution change. Under frameloop="demand" the renderer only paints on
// request, so without this the restored full-resolution frame would never render
// until the next interaction — leaving the scene stuck soft.
// ---------------------------------------------------------------------------

const DEFAULT_MIN_DPR = 0.5;
const FALLBACK_DPR = 1;
const DPR_PRECISION = 100;

export interface AdaptiveResolutionOptions {
  readonly enabled?: boolean;
  readonly minDpr?: number;
  readonly maxDpr?: number;
}

export interface AdaptiveDprInput {
  readonly current: number;
  readonly initialDpr: number;
  readonly minDpr?: number;
  readonly maxDpr?: number;
}

function finitePositiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundDpr(value: number): number {
  return Math.round(value * DPR_PRECISION) / DPR_PRECISION;
}

export function adaptiveDprForPerformance({
  current,
  initialDpr,
  minDpr,
  maxDpr,
}: AdaptiveDprInput): number {
  const safeInitialDpr = finitePositiveOr(initialDpr, FALLBACK_DPR);
  const safeCurrent = finitePositiveOr(current, FALLBACK_DPR);
  const lowerBound = finitePositiveOr(minDpr, DEFAULT_MIN_DPR);
  const upperBound = Math.max(lowerBound, finitePositiveOr(maxDpr, safeInitialDpr));
  const targetDpr = safeCurrent * safeInitialDpr;

  return roundDpr(Math.min(Math.max(targetDpr, lowerBound), upperBound));
}

export function AdaptiveResolution({
  enabled = true,
  minDpr,
  maxDpr,
}: AdaptiveResolutionOptions): null {
  const current = useThree((state) => state.performance.current);
  const initialDpr = useThree((state) => state.viewport.initialDpr);
  const setDpr = useThree((state) => state.setDpr);
  const invalidate = useThree((state) => state.invalidate);
  const targetDpr = adaptiveDprForPerformance({ current, initialDpr, minDpr, maxDpr });

  useEffect(() => {
    if (!enabled) return;
    setDpr(targetDpr);
    invalidate();
  }, [enabled, invalidate, setDpr, targetDpr]);

  return null;
}
