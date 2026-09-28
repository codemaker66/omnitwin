import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import {
  Euler,
  FrontSide,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Texture,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { texture as textureNode, uniform, uv, vec4 } from "three/tsl";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import {
  FloorSkinManifestSchema,
  captureToMaskMatrix,
  decodeFloorHeights,
  floorColourGain,
  floorSkinManifestUrl,
  floorSkinTier,
  floorSkinTileGeometry,
  type FloorColourMode,
  type FloorSkinManifest,
  type FloorSkinTier,
} from "../../lib/floor-skin.js";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";
import { useDeviceStore } from "../../stores/device-store.js";

/**
 * Whether Blake's review may ask for the matched (colour-graded) floor instead
 * of the photographs as captured (T-639). The query is only honoured where
 * Gaussian splats may run at all — that is the same review audience, and the
 * public site must never see a query-driven variant.
 */
export function floorColourModeFromSearch(search: string, previewable: boolean): FloorColourMode {
  if (!previewable) return "photo";
  return new URLSearchParams(search).get("floor") === "matched" ? "matched" : "photo";
}

interface LoadedFloor {
  readonly manifest: FloorSkinManifest;
  readonly tiles: readonly { readonly geometry: BufferGeometry; readonly map: Texture }[];
  readonly slab: Uint8Array;
}

async function readBytes(url: string, signal: AbortSignal, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The ${what} could not be read (${String(response.status)}).`);
  return response.arrayBuffer();
}

async function loadFloor(url: string, tierName: FloorSkinTier, signal: AbortSignal): Promise<LoadedFloor> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The floor skin could not be read (${String(response.status)}).`);
  const manifest = FloorSkinManifestSchema.parse(await response.json());
  const [heightBuffer, slabBuffer] = await Promise.all([
    readBytes(base + manifest.height.file, signal, "floor height grid"),
    readBytes(base + manifest.slab.file, signal, "floor slab mask"),
  ]);
  const heights = decodeFloorHeights(heightBuffer, manifest);
  const slab = new Uint8Array(slabBuffer);
  if (slab.length !== manifest.slab.width * manifest.slab.height) throw new Error("The floor slab mask has the wrong size.");
  const loader = new TextureLoader();
  const files = manifest.tiers[tierName].files;
  const tiles = await Promise.all(manifest.tiles.map(async (_, index) => {
    const file = files[index];
    if (file === undefined) throw new Error(`The floor skin tier lacks tile ${String(index)}.`);
    const map = await loader.loadAsync(base + file);
    map.colorSpace = SRGBColorSpace;
    map.flipY = false;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return { geometry: floorSkinTileGeometry(manifest, index, heights), map };
  }));
  if (signal.aborted) {
    for (const tile of tiles) { tile.geometry.dispose(); tile.map.dispose(); }
    throw new DOMException("Aborted", "AbortError");
  }
  return { manifest, tiles, slab };
}

/**
 * The room's floor as a measured surface wearing its own photographs (T-639),
 * drawn under the same `transform` as its splat tiles. While shown, it hides
 * the floor-slab splats underneath via the host's exclusion test (see
 * `native-splat-scene.ts`). Renders nothing for a room without a floor-skin
 * package, while loading, or while `active` is false.
 */
export function StageFloor({ roomSlug, transform, active }: {
  readonly roomSlug: string | null;
  readonly transform: RuntimeAssetViewTransform;
  readonly active: boolean;
}): ReactElement | null {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const deviceTier = useDeviceStore((state) => state.tier);
  const tierName = floorSkinTier(deviceTier);
  const url = roomSlug === null ? null : floorSkinManifestUrl(roomSlug, import.meta.env.VITE_SPLAT_BASE_URL);
  const colourMode = floorColourModeFromSearch(typeof window === "undefined" ? "" : window.location.search, gaussianSplatsAvailable());
  const [floor, setFloor] = useState<LoadedFloor | null>(null);

  // Loads (and reloads on room/tier/active change), always leaving a load that
  // is no longer wanted with nothing pending: the fetch is aborted, `floor`
  // reverts to null, and anything this run already decoded is disposed. A
  // fetch that completes after abort() rejects instead of resolving (loadFloor
  // re-checks the signal after its last await), so a late load can never call
  // setFloor on an unmounted/superseded instance.
  useEffect(() => {
    if (url === null || !active) return;
    const controller = new AbortController();
    let loaded: LoadedFloor | null = null;
    loadFloor(url, tierName, controller.signal)
      .then((result) => { loaded = result; setFloor(result); invalidate(); })
      .catch(() => { if (!controller.signal.aborted) setFloor(null); });
    return () => {
      controller.abort();
      setFloor(null);
      if (loaded !== null) for (const tile of loaded.tiles) { tile.geometry.dispose(); tile.map.dispose(); }
    };
  }, [url, tierName, active, invalidate]);

  const materials = useMemo(() => {
    if (floor === null) return [];
    const gain = uniform(new Vector3(...floorColourGain(floor.manifest, colourMode)));
    return floor.tiles.map((tile) => {
      const material = new MeshBasicNodeMaterial({ side: FrontSide });
      const sample = textureNode(tile.map, uv());
      material.colorNode = vec4(sample.rgb.mul(gain), sample.a);
      material.alphaTest = 0.5;
      return material;
    });
  }, [floor, colourMode]);
  useEffect(() => () => { for (const material of materials) material.dispose(); }, [materials]);

  // The exclusion matrix maps a splat centre already expressed in the host
  // Scene's own frame to the floor-skin mask (see SplatExclusion in
  // splat-exclusion.ts). It is composed straight from `transform` rather than
  // read off this group's Object3D.matrixWorld below: at the moment this
  // effect runs, three.js may not yet have propagated the position/rotation/
  // scale props into a fresh matrixWorld (that only happens on the next
  // render traversal), so reading it here could still see the construction-
  // time identity. Composing directly from `transform` has no such race.
  //
  // This is exact, not just a safe approximation, because both mount sites
  // place this component's group directly under the host Scene with no
  // transforming ancestor in between (PlannerScene's "live-room-capture"
  // wrapper carries visibility only; in RoomSplatScene this is a direct
  // Canvas child) — the same placement NativeSplatLayer's own anchors rely on
  // to bake this identical `transform` into merged splat centres
  // (native-splat-scene.ts's `source.matrix`). So the capture-to-Scene matrix
  // really is just `transform` composed, with no separate Scene matrix term:
  // composing it and then also premultiplying by the Scene's own (inverse)
  // matrixWorld would double-count that placement and be wrong the moment the
  // Scene object itself ever carried a transform — verified algebraically and
  // with a worked numeric example, not merely assumed.
  useEffect(() => {
    if (floor === null || !active) return;
    const host = nativeSplatScene(scene);
    const owner = {};
    const captureFromScene = new Matrix4().compose(
      new Vector3(...transform.position),
      new Quaternion().setFromEuler(new Euler(...transform.rotation)),
      new Vector3(transform.scale, transform.scale, transform.scale),
    ).invert();
    host.setExclusion(owner, {
      matrix: captureToMaskMatrix(floor.manifest).multiply(captureFromScene),
      below: floor.manifest.slab.below,
      above: floor.manifest.slab.above,
      mask: { width: floor.manifest.slab.width, height: floor.manifest.slab.height, data: floor.slab },
    });
    invalidate();
    return () => { host.clearExclusion(owner); invalidate(); };
  }, [floor, active, scene, invalidate, transform]);

  if (floor === null || !active) return null;
  return (
    <group
      position={[...transform.position] as [number, number, number]}
      rotation={[...transform.rotation] as [number, number, number]}
      scale={transform.scale}
      name="stage-floor"
    >
      {floor.tiles.map((tile, index) => {
        const material = materials[index];
        return material === undefined ? null : (
          <mesh key={index} geometry={tile.geometry} material={material} name={`stage-floor-tile-${String(index)}`} />
        );
      })}
    </group>
  );
}
