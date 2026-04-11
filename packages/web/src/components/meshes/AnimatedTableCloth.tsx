import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { toRenderSpace } from "../../constants/scale.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import {
  computeRoundClothGeometry,
  computeRectClothGeometry,
  CLOTH_COLOR,
} from "../../lib/cloth-geometry.js";
import { noClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// AnimatedTableCloth — cinematic cloth placement animation
// ---------------------------------------------------------------------------
//
// Five overlapping phases create a Hollywood-quality magical effect:
//
//   Phase 1: SUMMON      (0–15%)  — cloth materializes from nothing, scale 0→0.6
//   Phase 2: RISE        (10–25%) — slight upward lift (anticipation)
//   Phase 3: SPIRAL      (20–70%) — graceful spiralling descent with billowing
//   Phase 4: DRAPE       (50–90%) — skirt unfurls, fabric waves ripple outward
//   Phase 5: SETTLE      (85–100%) — everything comes to rest, final elegance
//
// Each phase uses its own easing curve. Phases overlap for fluid motion.
// ---------------------------------------------------------------------------

/** Total animation duration in seconds. */
const TOTAL_DURATION = 3.2;

/** Height above table where cloth appears. */
const SUMMON_HEIGHT = 2.0;

/** Slight upward lift during anticipation (rise phase). */
const RISE_LIFT = 0.15;

/** Number of spiral rotations during descent. */
const SPIRAL_TURNS = 1.5;

/** Amplitude of Y wobble during descent (feather float). */
const FLOAT_WOBBLE_AMP = 0.08;

/** Number of wobble oscillations during descent. */
const FLOAT_WOBBLE_CYCLES = 4;

/** Amplitude of fabric surface wave ripple (render-space). */
const WAVE_RIPPLE_AMP = 0.12;

/** Speed of the radial ripple wave (rings per second). */
const WAVE_RIPPLE_SPEED = 3.0;

/** Scale overshoot at peak of summon phase. */
const SUMMON_OVERSHOOT = 1.08;

// ---------------------------------------------------------------------------
// Easing functions — each phase gets its own curve
// ---------------------------------------------------------------------------

/** Smooth cubic ease-in for the summon (accelerates from nothing). */
export function easeInCubic(t: number): number {
  return t * t * t;
}

/** Quintic ease-out: very smooth deceleration, luxurious settling. */
export function easeOutQuint(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv * inv;
}

/** Ease-in-out sine: gentle S-curve for the rise anticipation. */
export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/** Back ease-out: slight overshoot then settle (for scale). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ---------------------------------------------------------------------------
// Phase computation — pure functions for each animation property
// ---------------------------------------------------------------------------

/** Map a global t to a local phase t, clamped to [0, 1]. */
function phaseT(globalT: number, start: number, end: number): number {
  return Math.max(0, Math.min(1, (globalT - start) / (end - start)));
}

/**
 * Compute the scale factor at time t.
 * Summon: 0→1.08 (overshoot) then settles to 1.0.
 */
export function computeScale(t: number): number {
  // Summon phase: 0–20%
  const summonT = phaseT(t, 0, 0.20);
  const summonScale = easeOutBack(summonT) * SUMMON_OVERSHOOT;

  // Settle from overshoot to 1.0: 20–35%
  const settleT = phaseT(t, 0.20, 0.35);
  const settleScale = SUMMON_OVERSHOOT + (1.0 - SUMMON_OVERSHOOT) * easeOutQuint(settleT);

  if (t < 0.20) return summonScale;
  if (t < 0.35) return settleScale;
  return 1.0;
}

/**
 * Compute the Y offset above the table at time t.
 * Starts at SUMMON_HEIGHT, rises slightly (anticipation), then spirals down.
 */
export function computeYOffset(t: number): number {
  // Base descent: quintic ease-out from full height to 0
  const descentT = phaseT(t, 0.15, 0.90);
  const baseY = SUMMON_HEIGHT * (1 - easeOutQuint(descentT));

  // Rise anticipation: brief upward lift at 10–25%
  const riseT = phaseT(t, 0.10, 0.25);
  const rise = RISE_LIFT * Math.sin(riseT * Math.PI); // up then back down

  // Feather wobble: gentle sine oscillation, damped over time
  const wobblePhase = phaseT(t, 0.20, 0.90);
  const wobbleDamp = Math.max(0, 1 - wobblePhase * 1.5); // damps to 0
  const wobble = FLOAT_WOBBLE_AMP * Math.sin(wobblePhase * FLOAT_WOBBLE_CYCLES * Math.PI * 2) * wobbleDamp;

  // Final settle: snap to 0 at end
  if (t >= 0.90) {
    const finalT = phaseT(t, 0.90, 1.0);
    const remaining = baseY + wobble;
    return remaining * (1 - easeOutQuint(finalT));
  }

  return baseY + rise + wobble;
}

/**
 * Compute the Y rotation at time t (spiral descent).
 * Smooth spiral with deceleration.
 */
export function computeSpiralRotation(t: number): number {
  const spiralT = phaseT(t, 0.15, 0.85);
  // Ease-out rotation: fast at start, slows gracefully
  const eased = easeOutQuint(spiralT);
  return eased * SPIRAL_TURNS * Math.PI * 2;
}

/**
 * Compute the opacity at time t.
 * Fades in during summon, stabilises at cloth opacity.
 */
export function computeOpacity(t: number): number {
  const fadeT = phaseT(t, 0, 0.15);
  return 0.78 * easeInCubic(fadeT);
}

/**
 * Compute the drape/unfurl progress at time t.
 * Skirt starts extending during spiral, completes during settle.
 */
export function computeDrapeProgress(t: number): number {
  const drapeT = phaseT(t, 0.35, 0.90);
  return easeOutQuint(drapeT);
}

/**
 * Apply a radial wave ripple to cloth vertex positions.
 * A ring of displacement travels outward from center, fading over time.
 *
 * @param positions     - The vertex position array (modified in place)
 * @param tableHeight   - Table height (Y of the disc top)
 * @param tableRadius   - Radius of the table top
 * @param t             - Global animation time [0, 1]
 * @param discVertCount - Number of vertices in the disc portion
 * @param radialSegments - Segments around circumference
 * @param discRings     - Number of rings in the disc
 */
export function applyWaveRipple(
  positions: Float32Array,
  _tableHeight: number,
  _tableRadius: number,
  t: number,
  discVertCount: number,
  radialSegments: number,
  discRings: number,
): void {
  // Wave is active during 30–85% of animation
  const waveT = phaseT(t, 0.30, 0.85);
  if (waveT <= 0 || waveT >= 1) return;

  // Wave front position: travels from center outward
  const waveFront = waveT * WAVE_RIPPLE_SPEED;
  // Damping: wave fades as it travels and as animation progresses
  const globalDamp = Math.sin(waveT * Math.PI); // peak at middle

  const stride = radialSegments + 1;

  // Apply to disc vertices: Y displacement based on distance from center
  for (let ring = 0; ring <= discRings; ring++) {
    const ringFrac = ring / discRings;
    const dist = ringFrac; // 0 at center, 1 at edge

    // Distance from wave front
    const waveDist = dist - waveFront;
    // Gaussian-ish envelope around wave front
    const envelope = Math.exp(-waveDist * waveDist * 20);
    const displacement = WAVE_RIPPLE_AMP * envelope * globalDamp * Math.sin(waveDist * 15);

    for (let seg = 0; seg <= radialSegments; seg++) {
      const idx = (ring * stride + seg) * 3 + 1; // Y component
      const current = positions[idx];
      if (current !== undefined) {
        positions[idx] = current + displacement;
      }
    }
  }

  // Apply to skirt vertices: radial displacement creating a billow effect
  const skirtStartIdx = discVertCount * 3;
  const totalSkirtVerts = positions.length / 3 - discVertCount;
  const skirtRings = totalSkirtVerts / stride;

  for (let ring = 0; ring < skirtRings; ring++) {
    const ringFrac = ring / Math.max(1, skirtRings - 1);
    // Wave travels down the skirt too
    const skirtWaveDist = (1.0 + ringFrac * 0.5) - waveFront;
    const envelope = Math.exp(-skirtWaveDist * skirtWaveDist * 15);
    const displacement = WAVE_RIPPLE_AMP * 0.7 * envelope * globalDamp;

    for (let seg = 0; seg <= radialSegments; seg++) {
      const baseIdx = skirtStartIdx + (ring * stride + seg) * 3;
      // Push outward radially
      const x = positions[baseIdx] ?? 0;
      const z = positions[baseIdx + 2] ?? 0;
      const len = Math.sqrt(x * x + z * z);
      if (len > 0.001) {
        const curX = positions[baseIdx];
        const curZ = positions[baseIdx + 2];
        if (curX !== undefined && curZ !== undefined) {
          positions[baseIdx] = curX + (x / len) * displacement;
          positions[baseIdx + 2] = curZ + (z / len) * displacement;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AnimatedTableClothProps {
  readonly tableItem: CatalogueItem;
  /** Called when the animation completes. */
  readonly onComplete?: () => void;
}

/**
 * Cinematic cloth placement animation — five overlapping phases create
 * a magical, Hollywood-quality effect: summoning from nothing, rising
 * with anticipation, spiralling down like a feather, draping with
 * rippling fabric waves, and settling with graceful finality.
 */
export function AnimatedTableCloth({
  tableItem,
  onComplete,
}: AnimatedTableClothProps): React.ReactElement {
  const { invalidate } = useThree();
  const isRound = tableItem.tableShape === "round";
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  // Punch list #17: direct ref to the mesh (not a callback that caches
  // mesh.geometry). R3F manages attachment and clears meshRef.current to
  // null on unmount automatically, so there's no stale-ref window after
  // the cloth animation completes and the component unmounts.
  const meshRef = useRef<Mesh | null>(null);
  const groupRef = useRef<Group | null>(null);
  const matRef = useRef<MeshStandardMaterial | null>(null);

  const renderRadius = useMemo(() => toRenderSpace(tableItem.width) / 2, [tableItem.width]);
  const renderWidth = useMemo(() => toRenderSpace(tableItem.width), [tableItem.width]);
  const renderDepth = useMemo(() => toRenderSpace(tableItem.depth), [tableItem.depth]);

  // Geometry constants for wave ripple application
  const radialSegments = 64;
  const discRings = 6;
  const skirtRings = 20;
  const discVertCount = (discRings + 1) * (radialSegments + 1);

  // Initial geometry (progress=0, invisible until animation starts)
  const initialGeom = useMemo(() => {
    const geom = new BufferGeometry();
    let result;

    if (isRound) {
      result = computeRoundClothGeometry(renderRadius, tableItem.height, radialSegments, discRings, skirtRings, 0.05, 0);
    } else {
      result = computeRectClothGeometry(renderWidth, renderDepth, tableItem.height, 16, 16, 16, 0.04);
    }

    geom.setAttribute("position", new Float32BufferAttribute(result.positions, 3));
    geom.setAttribute("normal", new Float32BufferAttribute(result.normals, 3));
    geom.setAttribute("uv", new Float32BufferAttribute(result.uvs, 2));
    geom.setIndex(new Uint32BufferAttribute(result.indices, 1));

    return geom;
  }, [isRound, renderRadius, renderWidth, renderDepth, tableItem.height, radialSegments, discRings, skirtRings]);

  useEffect(() => {
    startTimeRef.current = null;
    completedRef.current = false;
  }, []);

  // Punch list #17: dispose the BufferGeometry when the component unmounts
  // OR when initialGeom is replaced (e.g. table dimensions change). Three.js
  // does not garbage-collect GPU resources \u2014 leaking BufferGeometry on every
  // animation cycle would accumulate VRAM until the tab crashes.
  useEffect(() => {
    return () => { initialGeom.dispose(); };
  }, [initialGeom]);

  // Main animation loop — orchestrates all five phases
  useFrame(() => {
    if (completedRef.current) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = performance.now() / 1000;
    }

    const elapsed = performance.now() / 1000 - startTimeRef.current;
    const t = Math.min(elapsed / TOTAL_DURATION, 1);

    // --- Compute all animation properties from pure functions ---
    const scale = computeScale(t);
    const yOffset = computeYOffset(t);
    const spiralRot = computeSpiralRotation(t);
    const opacity = computeOpacity(t);
    const drapeProgress = computeDrapeProgress(t);

    // --- Apply group transform (position, rotation, scale) ---
    const group = groupRef.current;
    if (group !== null) {
      group.position.y = yOffset;
      group.rotation.y = isRound ? spiralRot : 0;
      group.scale.setScalar(scale);
    }

    // --- Apply material opacity ---
    const mat = matRef.current;
    if (mat !== null) {
      mat.opacity = opacity;
    }

    // --- Recompute geometry with current drape progress ---
    let result;
    if (isRound) {
      result = computeRoundClothGeometry(renderRadius, tableItem.height, radialSegments, discRings, skirtRings, 0.05, drapeProgress);
    } else {
      result = computeRectClothGeometry(renderWidth, renderDepth, tableItem.height, 16, 16, 16, 0.04);
    }

    // Apply wave ripple distortion to the positions
    if (isRound) {
      applyWaveRipple(result.positions, tableItem.height, renderRadius, t, discVertCount, radialSegments, discRings);
    }

    const geom = meshRef.current?.geometry;
    if (geom !== undefined) {
      const posAttr = geom.getAttribute("position") as Float32BufferAttribute;
      posAttr.set(result.positions);
      posAttr.needsUpdate = true;
      const normAttr = geom.getAttribute("normal") as Float32BufferAttribute;
      normAttr.set(result.normals);
      normAttr.needsUpdate = true;
    }

    invalidate();

    // --- Completion ---
    if (t >= 1) {
      completedRef.current = true;
      if (group !== null) {
        group.position.y = 0;
        group.rotation.y = 0;
        group.scale.setScalar(1);
      }
      onComplete?.();
    }
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={initialGeom} ref={meshRef}>
        <meshStandardMaterial
          ref={matRef}
          color={CLOTH_COLOR}
          roughness={0.88}
          metalness={0.02}
          side={DoubleSide}
          transparent
          opacity={0}
          clippingPlanes={noClipPlanes}
        />
      </mesh>
    </group>
  );
}
