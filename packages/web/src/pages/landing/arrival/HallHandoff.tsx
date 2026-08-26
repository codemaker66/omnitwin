import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { GLTFLoader } from "three-stdlib";
import { Material, type Object3D } from "three";
import type { TwinManifest } from "@omnitwin/types";
import {
  isSpringSettled,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "../../../lib/springs.js";
import { applyDollhouseCaps, meshRootWorldMatrix } from "../../../twin/dollhouse-peel.js";
import { pruneDollhouseShell } from "../../../twin/dollhouse-shell.js";
import { twinAssetBase, useTwinManifest } from "../../../twin/useTwinManifest.js";
import { TRADES_HALL_TWIN_PLACEMENT, twinPlacementMatrix } from "./twin-placement.js";

// -----------------------------------------------------------------------------
// HallHandoff — the reveal (Arrival Task 7). At the moment the fly-in lands,
// our own captured dollhouse mesh crossfades in over Google's tiles: the
// product's signature beat, the instant the "twin" in OmniTwin stops being a
// borrowed Google mesh and becomes ours.
//
// Loads the SAME optimized GLB DollhouseStage.tsx uses — useGLTF + meshopt,
// dollhouse-peel's caps split, dollhouse-shell's prune — on the trades-hall
// venue slug (never trades-hall-glasgow, a different, 404ing namespace). The
// caps+prune repairs run on the SHARED, globally-cached scene exactly as
// DollhouseStage.tsx:141-145 does, in the SAME order (prune, then caps — its
// own comment: "the prune rewrites the index the split then partitions").
// Both are flagged idempotent on the geometry, so every mount of this GLB
// from any component inherits them, and a StrictMode double-invoke of this
// memo is a safe no-op the second time.
//
// What is NOT shared is the fade: this component mutates transparent/opacity
// every frame, so — mirroring how DollhouseStage isolates ITS per-mount
// concern (dollhouse-cutaway.ts's cloneSceneWithCutawayPlanes clones a scene's
// MATERIALS only, leaving geometry shared) — this clones the shared scene's
// materials before ever touching transparent/opacity. Mutating the CACHED
// materials directly would leave DollhouseStage's own mount, or a second
// HallHandoff mount, permanently stuck mid-fade. cloneSceneWithCutawayPlanes
// itself is not reused here: its contract is clipping planes, not fade
// ownership, and importing it just to pass an empty plane list would read as
// a non-sequitur to the next person in this file — so the same clone+dedupe
// technique is repeated locally, scoped to what this component actually owns.
//
// Placement: twinPlacementMatrix wraps the twin's own basis transform
// (meshRootWorldMatrix — the single inner truth, twin-basis.ts) in an OUTER
// rotate+translate (twin-placement.ts). Seeded at zero until Task 8
// calibrates it against the Google tiles facade.
//
// material.side is never touched here: the peel system's per-triangle open/
// capped split depends on FrontSide vs DoubleSide staying exactly as
// applyDollhouseCaps set them. Only transparent/opacity move, and settling
// snaps back to transparent = false (kills alpha-sort cost).
// -----------------------------------------------------------------------------

/** The twin asset slug — NEVER "trades-hall-glasgow" (a different, 404ing namespace). */
export const TRADES_HALL_TWIN_SLUG = "trades-hall";

/** Slow reveal — tuned at the visual gate alongside the rest of the Arrival. */
export const HANDOFF_FADE_SPRING: SpringConfig = { stiffness: 60, damping: 14 };

/** The combined placement × basis transform is pure and constant — computed once. */
const HANDOFF_PLACEMENT_MATRIX = twinPlacementMatrix(TRADES_HALL_TWIN_PLACEMENT);

/**
 * Mesh bundle URL, exactly as TwinViewer.tsx:1280 builds it
 * (`${assetBase}/${manifest.mesh.path}`) with `assetBase` fixed to the
 * trades-hall slug (TwinPage.tsx:96's pattern) — never the manifest's own
 * `venueSlug` field, since HallHandoff is hard-wired to this one venue.
 * `manifest.mesh` is optional in the schema (older/mesh-less bundles); null
 * here degrades HallHandoff to rendering nothing, same as a manifest error.
 */
export function tradesHallMeshUrl(manifest: TwinManifest): string | null {
  return manifest.mesh === undefined
    ? null
    : `${twinAssetBase()}/${TRADES_HALL_TWIN_SLUG}/${manifest.mesh.path}`;
}

/** Shared loader config — identical contract to DollhouseStage.tsx:100-103. */
function configureHandoffLoader(loader: GLTFLoader): void {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

interface HandoffScene {
  readonly scene: Object3D;
  readonly materials: readonly Material[];
}

interface MaterialBearing extends Object3D {
  material: Material | Material[];
}

function hasMaterial(object: Object3D): object is MaterialBearing {
  if (!("material" in object)) {
    return false;
  }
  const material = (object as { material?: unknown }).material;
  return (
    material instanceof Material ||
    (Array.isArray(material) && material.every((entry) => entry instanceof Material))
  );
}

/**
 * Clone the shared, cached dollhouse scene's materials so the crossfade's
 * per-frame transparent/opacity writes never reach useGLTF's globally cached
 * materials. Geometry — including the caps split's groups — stays shared by
 * reference; only Material instances are cloned, deduped by source identity
 * so two meshes that share one material still share one clone after cloning
 * (mirrors dollhouse-cutaway.ts's cloneSceneWithCutawayPlanes technique).
 */
function cloneHandoffMaterials(source: Object3D): HandoffScene {
  const scene = source.clone(true);
  const clones = new Map<Material, Material>();
  const cloneOne = (material: Material): Material => {
    const existing = clones.get(material);
    if (existing !== undefined) {
      return existing;
    }
    const cloned = material.clone();
    clones.set(material, cloned);
    return cloned;
  };
  scene.traverse((object) => {
    if (!hasMaterial(object)) {
      return;
    }
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneOne)
      : cloneOne(object.material);
  });
  return { scene, materials: [...clones.values()] };
}

function disposeHandoffScene(handoff: HandoffScene): void {
  for (const material of handoff.materials) {
    material.dispose();
  }
}

interface HallHandoffMeshProps {
  readonly meshUrl: string;
}

function HallHandoffMesh({ meshUrl }: HallHandoffMeshProps): ReactElement {
  const gltf = useGLTF(meshUrl, true, true, configureHandoffLoader);
  const shellScene = useMemo(() => {
    pruneDollhouseShell(gltf.scene);
    applyDollhouseCaps(gltf.scene, undefined, meshRootWorldMatrix());
    return gltf.scene;
  }, [gltf.scene]);
  const handoff = useMemo(() => cloneHandoffMaterials(shellScene), [shellScene]);
  useEffect(
    () => () => {
      disposeHandoffScene(handoff);
    },
    [handoff],
  );

  const fade = useRef<SpringState>({ value: 0, velocity: 0 });
  const invalidate = useThree((state) => state.invalidate);

  useFrame((_state, delta) => {
    const spring = fade.current;
    if (isSpringSettled(spring, 1)) {
      return;
    }
    stepSpring(spring, 1, delta, HANDOFF_FADE_SPRING);
    const settled = isSpringSettled(spring, 1);
    for (const material of handoff.materials) {
      material.transparent = !settled;
      material.opacity = settled ? 1 : spring.value;
    }
    if (!settled) {
      invalidate();
    }
  });

  return (
    <group matrixAutoUpdate={false} matrix={HANDOFF_PLACEMENT_MATRIX}>
      {/* Matterport-style bake: the capture's lighting lives in the texture,
          the ambient wash simply exposes it (DollhouseStage.tsx's own rule
          for the same GLB — without it a PBR material this dim renders
          essentially black). */}
      <ambientLight intensity={2.2} />
      <directionalLight position={[12, 30, 18]} intensity={0.8} />
      <primitive object={handoff.scene} />
    </group>
  );
}

/** Self-gates: nothing while the manifest loads or errors, the mesh once ready. */
export function HallHandoff(): ReactElement | null {
  const manifest = useTwinManifest(TRADES_HALL_TWIN_SLUG);
  const warned = useRef(false);

  useEffect(() => {
    if (manifest.state === "error" && !warned.current) {
      warned.current = true;
      // eslint-disable-next-line no-console -- deliberate, once-only diagnostic; the hero survives without the twin.
      console.warn(
        "HallHandoff: trades-hall twin manifest failed to load; the tiles building remains uncovered.",
      );
    }
  }, [manifest.state]);

  if (manifest.state !== "ready") {
    return null;
  }
  const meshUrl = tradesHallMeshUrl(manifest.manifest);
  if (meshUrl === null) {
    return null;
  }
  return <HallHandoffMesh meshUrl={meshUrl} />;
}
