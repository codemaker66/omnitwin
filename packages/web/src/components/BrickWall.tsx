import { useRef, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  FrontSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { sectionClipPlanes } from "./SectionPlane.js";
import { useVisibilityStore, getSurfaceOpacity, type WallKey } from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Stone block dimensions in meters (width × height × depth). */
export const BLOCK_WIDTH = 0.4;
export const BLOCK_HEIGHT = 0.2;
export const BLOCK_DEPTH = 0.08;

/** Mortar gap between blocks in meters. */
export const MORTAR_GAP = 0.008;

/** How far blocks scatter outward from the wall face (meters). */
export const SCATTER_DISTANCE = 2.2;

/** Proportion of the 0→1 timeline used for row stagger.
 *  0.8 = very sequential — each row mostly finishes before the next starts.
 *  This gives a realistic bottom-up bricklaying feel. */
export const STAGGER_SPAN = 0.8;

/** Random per-brick timing jitter (fraction of timeline).
 *  Low value = tidy rows like a real bricklayer. */
export const BRICK_JITTER = 0.03;

/** Max random rotation (radians) when fully scattered — kept low for heavy feel. */
export const MAX_SCATTER_ROTATION = 0.12;

/** Fraction of per-brick timeline where the brick reaches its rest position.
 *  The remaining time is used for the impact bounce. */
export const IMPACT_POINT = 0.6;

/** How far past rest position the brick overshoots on impact (fraction of SCATTER_DISTANCE). */
export const BOUNCE_OVERSHOOT = 0.04;

/** Wall opacity threshold — below this means "should be unbuilt". */
const BUILD_THRESHOLD = 0.5;

/** Full build/unbuild animation duration in seconds.
 *  5s gives a slow, deliberate, row-by-row bricklaying feel. */
const BUILD_DURATION = 5.0;

// ---------------------------------------------------------------------------
// Pure layout helpers — fully testable
// ---------------------------------------------------------------------------

export interface BrickInstance {
  /** Rest position in wall-local space (wall centered at origin, facing +Z). */
  readonly restX: number;
  readonly restY: number;
  /** Normalized row height (0 = bottom row, 1 = top row). Bottom bricks build first. */
  readonly stagger: number;
  /** Scatter offset direction (unit vector). Bricks slide in from below/outward. */
  readonly scatterDirX: number;
  readonly scatterDirY: number;
  readonly scatterDirZ: number;
  /** Random rotation axes and magnitude for scatter. */
  readonly scatterRotX: number;
  readonly scatterRotY: number;
  readonly scatterRotZ: number;
}

/**
 * Simple seeded PRNG (mulberry32) for deterministic brick scatter.
 * Returns a function that produces values in [0, 1).
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes a grid of brick instances for a wall of given dimensions.
 *
 * The wall is centered at local origin, spanning [-w/2, w/2] × [-h/2, h/2].
 * Bricks are laid in a standard running bond pattern (half-brick offset on alternating rows).
 *
 * @param wallWidth  - Wall width in meters.
 * @param wallHeight - Wall height in meters.
 * @param seed       - PRNG seed for deterministic scatter directions.
 */
export function computeBrickLayout(
  wallWidth: number,
  wallHeight: number,
  seed: number,
): readonly BrickInstance[] {
  const rand = createSeededRandom(seed);
  const bricks: BrickInstance[] = [];

  const cellW = BLOCK_WIDTH + MORTAR_GAP;
  const cellH = BLOCK_HEIGHT + MORTAR_GAP;
  const cols = Math.ceil(wallWidth / cellW);
  const rows = Math.ceil(wallHeight / cellH);

  const halfW = wallWidth / 2;
  const halfH = wallHeight / 2;
  const maxRow = Math.max(rows - 1, 1);

  for (let row = 0; row < rows; row++) {
    // Running bond: offset odd rows by half a brick width.
    const xOffset = row % 2 === 0 ? 0 : cellW * 0.5;
    // Bottom-up base stagger: row 0 (bottom) = 0, top row = 1.
    const rowStagger = row / maxRow;

    for (let col = 0; col < cols; col++) {
      const x = -halfW + col * cellW + xOffset + cellW * 0.5;
      const y = -halfH + row * cellH + cellH * 0.5;

      // Skip bricks entirely outside the wall boundary.
      if (x - BLOCK_WIDTH / 2 > halfW || x + BLOCK_WIDTH / 2 < -halfW) continue;
      if (y - BLOCK_HEIGHT / 2 > halfH || y + BLOCK_HEIGHT / 2 < -halfH) continue;

      // Per-brick random jitter so bricks in the same row don't move in lockstep.
      const jitter = (rand() - 0.5) * BRICK_JITTER * 2;
      const stagger = Math.max(0, Math.min(1, rowStagger + jitter));

      // Scatter direction: primarily upward (+Y in wall-local = above the wall).
      // Bricks fall rapidly from the sky and slam into their grid position.
      const spreadX = (rand() - 0.5) * 0.15;
      const spreadY = 0.85 + rand() * 0.15; // strongly upward — bricks start above, fall down
      const spreadZ = (rand() - 0.5) * 0.1; // minimal outward drift
      const len = Math.sqrt(spreadX * spreadX + spreadY * spreadY + spreadZ * spreadZ);

      bricks.push({
        restX: x,
        restY: y,
        stagger,
        scatterDirX: spreadX / len,
        scatterDirY: spreadY / len,
        scatterDirZ: spreadZ / len,
        scatterRotX: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
        scatterRotY: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
        scatterRotZ: (rand() - 0.5) * MAX_SCATTER_ROTATION * 2,
      });
    }
  }

  return bricks;
}

/**
 * Heavy-landing easing: accelerate in (gravity), slam into place, damped bounce.
 *
 * Phase 1 (0 → IMPACT_POINT): ease-in quadratic — slow start, fast arrival.
 *   Simulates gravity pulling the brick toward its slot.
 * Phase 2 (IMPACT_POINT → 1): damped sine bounce — overshoot past rest then settle.
 *   Returns values slightly > 1 during bounce (brick pushes into wall, then rebounds).
 *   This is the "dud" — the visual cue of weight and impact.
 *
 * At t=0 returns 0, at t=1 returns 1. Peak overshoot ≈ 1 + BOUNCE_OVERSHOOT.
 */
export function easeHeavyLanding(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  if (t < IMPACT_POINT) {
    // Ease-in quadratic: accelerates toward target (gravity feel)
    const n = t / IMPACT_POINT;
    return n * n;
  }

  // Post-impact: damped sine bounce
  const postT = (t - IMPACT_POINT) / (1 - IMPACT_POINT);
  const bounce = Math.sin(postT * Math.PI) * BOUNCE_OVERSHOOT * (1 - postT);
  return 1 + bounce;
}

/**
 * Computes per-brick animation progress given global progress (0→1).
 *
 * - progress=0: all bricks scattered
 * - progress=1: all bricks assembled
 * - Bottom bricks assemble first (low stagger), top bricks last (high stagger).
 */
export function computeBrickProgress(globalProgress: number, stagger: number): number {
  // Each brick's "start time" is proportional to its stagger value.
  const startTime = stagger * STAGGER_SPAN;
  const endTime = startTime + (1 - STAGGER_SPAN);
  const raw = (globalProgress - startTime) / (endTime - startTime);
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BrickWallProps {
  /** Wall width in meters. */
  readonly wallWidth: number;
  /** Wall height in meters. */
  readonly wallHeight: number;
  /** World position of the wall center. */
  readonly position: readonly [number, number, number];
  /** World rotation of the wall. */
  readonly rotation: readonly [number, number, number];
  /** Wall color. */
  readonly color: string;
  /** Surface name used to look up opacity from the visibility store. */
  readonly name: string;
  /** Material roughness. */
  readonly roughness?: number;
}

// Reusable objects to avoid per-frame allocations.
const _euler = new Euler();
const _qRest = new Quaternion();
const _qScatter = new Quaternion();
const _qFinal = new Quaternion();
const _pos = new Vector3();
const _scale = new Vector3(1, 1, 1);
const _mat = new Matrix4();

/**
 * Renders a wall as an InstancedMesh of stone blocks with brick-build animation.
 *
 * The wall is either BUILT or UNBUILT — never frozen mid-animation.
 * When the visibility store signals the wall should appear/disappear (opacity
 * crosses the 0.5 threshold), the brick animation plays to completion at its
 * own pace (BUILD_DURATION seconds). Camera movement during the animation
 * does NOT interrupt or freeze it.
 *
 * At progress=1, the wall looks like a solid stone/plaster surface.
 * At progress=0, all bricks are scattered and invisible.
 */
/** Maps surface names to WallKeys for click-to-toggle. */
function getWallKey(surfaceName: string): WallKey | null {
  if (surfaceName.startsWith("wainscot-")) {
    return surfaceName.replace("wainscot-", "wall-") as WallKey;
  }
  if (surfaceName.startsWith("wall-")) {
    return surfaceName as WallKey;
  }
  return null;
}

export function BrickWall({
  wallWidth,
  wallHeight,
  position,
  rotation,
  color,
  name,
  roughness = 0.95,
}: BrickWallProps): React.ReactElement | null {
  const meshRef = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();

  /** Internal animation progress — drives brick positions independently of wallOpacity. */
  const animProgress = useRef(1); // start fully built
  /** Target: 1 = built, 0 = unbuilt. */
  const animTarget = useRef(1);
  /** True when the last visibility change was triggered by a click (animate bricks).
   *  False when driven by camera rotation (instant show/hide, no animation). */
  const useAnimation = useRef(false);

  /** Click to toggle this wall's visibility (called from SelectionSystem). */
  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const wallKey = getWallKey(name);
    if (wallKey !== null) {
      useAnimation.current = true;
      (window as unknown as Record<string, unknown>)["__brickWallAnimate"] = wallKey;
      useVisibilityStore.getState().toggleWall(wallKey);
      invalidate();
    }
  }, [name, invalidate]);

  const bricks = useMemo(
    () => computeBrickLayout(wallWidth, wallHeight, hashString(name)),
    [wallWidth, wallHeight, name],
  );

  const geometry = useMemo(
    () => new BoxGeometry(BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_DEPTH),
    [],
  );

  const material = useMemo(() => {
    const mat = new MeshStandardMaterial({
      color: new Color(color),
      side: FrontSide,
      roughness,
      metalness: 0,
      transparent: true,
      clippingPlanes: sectionClipPlanes,
    });
    return mat;
  }, [color, roughness]);

  // Update instance matrices every frame based on internal animation progress.
  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (mesh === null) return;

    // Read the visibility store to determine whether wall should be built or not
    const { wallOpacity, ceiling, dome } = useVisibilityStore.getState();
    const baseOpacity = getSurfaceOpacity(name, wallOpacity, ceiling, dome);
    const xrayOpacity = useXrayStore.getState().opacity;
    const surfaceOpacity = applyXrayOpacity(name, baseOpacity, xrayOpacity);

    // Determine target from threshold — binary decision
    const shouldBeBuilt = surfaceOpacity >= BUILD_THRESHOLD;
    const newTarget = shouldBeBuilt ? 1 : 0;

    // Check if this wall was click-toggled (via global flag from SelectionSystem)
    const globalAnimKey = (window as unknown as Record<string, unknown>)["__brickWallAnimate"] as string | undefined;
    const wallKey = getWallKey(name);
    if (globalAnimKey !== undefined && globalAnimKey === wallKey) {
      useAnimation.current = true;
      (window as unknown as Record<string, unknown>)["__brickWallAnimate"] = undefined;
    }

    // Detect if target changed (camera rotation or click)
    if (newTarget !== animTarget.current) {
      // If not triggered by a click, this is a camera-driven change → no animation
      if (!useAnimation.current) {
        animProgress.current = newTarget;
      }
      animTarget.current = newTarget;
    }

    // Advance internal animation toward target (only matters if useAnimation is true)
    const speed = 1 / BUILD_DURATION;
    const clampedDelta = Math.min(delta, 0.1);
    const step = speed * clampedDelta;

    const prev = animProgress.current;
    if (animTarget.current > prev) {
      animProgress.current = Math.min(animTarget.current, prev + step);
    } else if (animTarget.current < prev) {
      animProgress.current = Math.max(animTarget.current, prev - step);
    }

    // Clear the animation flag once animation completes
    if (Math.abs(animProgress.current - animTarget.current) < 0.001) {
      useAnimation.current = false;
    }

    const progress = animProgress.current;
    const isAnimating = Math.abs(progress - animTarget.current) > 0.001;

    // If animating, keep requesting frames
    if (isAnimating) {
      invalidate();
    }

    // Hide entire mesh when fully scattered.
    if (progress < 0.005) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Fade material for bricks at the transition edge.
    material.opacity = Math.min(1, progress * 3);

    for (let i = 0; i < bricks.length; i++) {
      const brick = bricks[i];
      if (brick === undefined) continue;
      const localProgress = easeHeavyLanding(computeBrickProgress(progress, brick.stagger));

      // scatter: 1 = fully away, 0 = at rest, slightly negative = bounce overshoot
      const scatter = 1 - localProgress;
      const scatterDist = scatter * SCATTER_DISTANCE;

      _pos.set(
        brick.restX + brick.scatterDirX * scatterDist,
        brick.restY + brick.scatterDirY * scatterDist,
        brick.scatterDirZ * scatterDist,
      );

      // Rotation only during approach — clamp to zero once brick lands (no wobble during bounce).
      const rotAmount = Math.max(0, scatter);
      _qRest.identity();
      _euler.set(
        brick.scatterRotX * rotAmount,
        brick.scatterRotY * rotAmount,
        brick.scatterRotZ * rotAmount,
      );
      _qScatter.setFromEuler(_euler);
      _qFinal.copy(_qRest).slerp(_qScatter, rotAmount);

      _scale.setScalar(localProgress < 0.01 ? 0 : 1);

      _mat.compose(_pos, _qFinal, _scale);
      mesh.setMatrixAt(i, _mat);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceMatrix.usage !== DynamicDrawUsage) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    }
  });

  if (bricks.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, bricks.length]}
        position={[position[0], position[1], position[2]]}
        rotation={[rotation[0], rotation[1], rotation[2]]}
        name={name}
        frustumCulled={false}
      />
      {/* Click plane — full wall-sized transparent plane for reliable click detection.
          Slightly in front of the bricks so it catches clicks first. */}
      <mesh
        position={[position[0], position[1], position[2]]}
        rotation={[rotation[0], rotation[1], rotation[2]]}
        onClick={handleClick}
        name={`${name}-click-plane`}
      >
        <planeGeometry args={[wallWidth, wallHeight]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Simple string hash for deterministic PRNG seeds. */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash;
}
