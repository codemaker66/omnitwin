import { useEffect, useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  Color,
  DoubleSide,
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
import {
  useVisibilityStore,
  getSurfaceOpacity,
  WALL_BUILD_THRESHOLD,
  WALL_CLICK_ANIMATION_DURATION_SECONDS,
  type WallKey,
} from "../stores/visibility-store.js";
import { useXrayStore } from "../stores/xray-store.js";
import { applyXrayOpacity } from "../lib/xray.js";
import {
  BLOCK_DEPTH,
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  SCATTER_DISTANCE,
  computeBrickLayout,
  computeBrickProgress,
  easeHeavyLanding,
  shouldUpdateBrickWallMatrices,
} from "../lib/brick-wall.js";
export {
  BLOCK_DEPTH,
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  BOUNCE_OVERSHOOT,
  BRICK_JITTER,
  IMPACT_POINT,
  MAX_SCATTER_ROTATION,
  MORTAR_GAP,
  SCATTER_DISTANCE,
  STAGGER_SPAN,
  computeBrickLayout,
  computeBrickProgress,
  createSeededRandom,
  easeHeavyLanding,
  shouldUpdateBrickWallMatrices,
} from "../lib/brick-wall.js";
export type { BrickInstance } from "../lib/brick-wall.js";

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
  /** True when instance matrices need updating (animation in progress). */
  const needsMatrixUpdate = useRef(true);

  const bricks = useMemo(
    () => computeBrickLayout(wallWidth, wallHeight, hashString(name)),
    [wallWidth, wallHeight, name],
  );

  const geometry = useMemo(
    () => new BoxGeometry(BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_DEPTH),
    [],
  );
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

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
  useEffect(() => () => { material.dispose(); }, [material]);

  // Update instance matrices every frame based on internal animation progress.
  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (mesh === null) return;

    // Read the visibility store to determine whether wall should be built or not
    const { wallOpacity, wallLocks, ceiling, dome } = useVisibilityStore.getState();
    const baseOpacity = getSurfaceOpacity(name, wallOpacity, ceiling, dome);
    const xrayOpacity = useXrayStore.getState().opacity;
    const surfaceOpacity = applyXrayOpacity(name, baseOpacity, xrayOpacity);

    // Determine target from threshold — binary decision
    const shouldBeBuilt = surfaceOpacity >= WALL_BUILD_THRESHOLD;
    const newTarget = shouldBeBuilt ? 1 : 0;

    // Locked = user clicked this wall → animate bricks over BUILD_DURATION.
    // Unlocked = camera auto-fade → snap instantly (camera has its own smooth transition).
    const wallKey = name.startsWith("wainscot-")
      ? name.replace("wainscot-", "wall-") as WallKey
      : name as WallKey;
    const isLocked = wallLocks[wallKey];

    let targetChanged = false;
    if (newTarget !== animTarget.current) {
      targetChanged = true;
      if (!isLocked) {
        animProgress.current = newTarget; // camera: snap
      }
      animTarget.current = newTarget;
      needsMatrixUpdate.current = true;
    }

    // Advance animation toward target (only moves when locked / click-driven)
    const speed = 1 / WALL_CLICK_ANIMATION_DURATION_SECONDS;
    const clampedDelta = Math.min(delta, 0.1);
    const step = speed * clampedDelta;

    const prev = animProgress.current;
    if (animTarget.current > prev) {
      animProgress.current = Math.min(animTarget.current, prev + step);
    } else if (animTarget.current < prev) {
      animProgress.current = Math.max(animTarget.current, prev - step);
    }

    // Unlock wall once rebuild animation completes so camera auto resumes
    if (isLocked && animTarget.current === 1 && Math.abs(animProgress.current - 1) < 0.001) {
      useVisibilityStore.getState().unlockWall(wallKey);
    }

    const progress = animProgress.current;
    const isAnimating = Math.abs(progress - animTarget.current) > 0.001;

    // Early exit: nothing to update when animation is settled
    if (!shouldUpdateBrickWallMatrices(progress, animTarget.current, needsMatrixUpdate.current, targetChanged)) {
      return;
    }
    needsMatrixUpdate.current = isAnimating;

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
      {/* Click plane — full wall-sized plane for raycast detection by SelectionSystem.
          Always present so walls can be rebuilt after being fully unbuilt.
          Near-zero opacity: invisible to eye, hittable by raycaster. */}
      <mesh
        position={[position[0], position[1], position[2]]}
        rotation={[rotation[0], rotation[1], rotation[2]]}
        name={`${name}-click-plane`}
      >
        <planeGeometry args={[wallWidth, wallHeight]} />
        <meshBasicMaterial
          transparent
          opacity={0.001}
          depthWrite={false}
          color="#ffffff"
          side={DoubleSide}
        />
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
