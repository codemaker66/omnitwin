import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import {
  FrontSide,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Group,
  type Texture,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { texture as textureNode, uniform, uv, vec4 } from "three/tsl";
import type { RuntimeAssetViewTransform } from "../../lib/runtime-package-resolution.js";
import {
  FloorSkinManifestSchema,
  decodeFloorHeights,
  floorColourGain,
  floorColourModeFromSearch,
  floorExclusionMatrix,
  floorSkinManifestUrl,
  floorSkinTier,
  floorSkinTileGeometry,
  type FloorSkinManifest,
  type FloorSkinTier,
} from "../../lib/floor-skin.js";
import { useAssetDeviceTier } from "../../hooks/use-splat-runtime-profile.js";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";

interface LoadedFloor {
  readonly manifest: FloorSkinManifest;
  readonly tiles: readonly { readonly geometry: BufferGeometry; readonly map: Texture }[];
  readonly slab: Uint8Array;
}

/** A load result tagged with the room+tier it answers, so a stale result
 * (superseded before it landed, or still on hand from before a room change)
 * is never rendered or excluded against the wrong room. */
interface KeyedFloor {
  readonly key: string;
  readonly floor: LoadedFloor;
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
  const deviceTier = useAssetDeviceTier();
  const tierName = floorSkinTier(deviceTier);
  const url = roomSlug === null ? null : floorSkinManifestUrl(roomSlug, import.meta.env.VITE_SPLAT_BASE_URL);
  const key = url === null ? null : `${url}|${tierName}`;
  const colourMode = floorColourModeFromSearch(typeof window === "undefined" ? "" : window.location.search, gaussianSplatsAvailable());
  const [loaded, setLoaded] = useState<KeyedFloor | null>(null);
  // Only a load whose key matches the room/tier showing right now counts:
  // one still in flight for a room we have already left, or one left over
  // from before a room change, must never draw or exclude against this room.
  const floor = loaded !== null && loaded.key === key ? loaded.floor : null;
  const groupRef = useRef<Group>(null);

  // Keyed by room + device tier only, not by `active`: switching layer modes
  // must not re-fetch a floor already on hand, and loading proceeds even
  // while the layer that will show it is not active yet, so activating it is
  // instant instead of popping in a frame later. A load that is no longer
  // wanted (its key superseded, or the component unmounted) is aborted, and
  // anything it already decoded is disposed by this same effect's cleanup —
  // never left for a later render to pick up, and never left resident once
  // nothing can show it.
  useEffect(() => {
    if (url === null) return;
    const loadKey = `${url}|${tierName}`;
    const controller = new AbortController();
    let loadedResult: LoadedFloor | null = null;
    loadFloor(url, tierName, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        loadedResult = result;
        setLoaded({ key: loadKey, floor: result });
        invalidate();
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        // Not fatal: the room is still shown through its Gaussian splats, so
        // a missing or broken floor skin must not break the walk or the plan.
        globalThis.reportError(reason instanceof Error ? reason : new Error(String(reason)));
      });
    return () => {
      controller.abort();
      if (loadedResult !== null) for (const tile of loadedResult.tiles) { tile.geometry.dispose(); tile.map.dispose(); }
    };
  }, [url, tierName, invalidate]);

  const materials = useMemo(() => {
    if (floor === null) return [];
    const gain = uniform(new Vector3(...floorColourGain(floor.manifest, colourMode)));
    return floor.tiles.map((tile) => {
      const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: false, toneMapped: false });
      const sample = textureNode(tile.map, uv());
      material.colorNode = vec4(sample.rgb.mul(gain), sample.a);
      material.alphaTest = 0.5;
      return material;
    });
  }, [floor, colourMode]);
  useEffect(() => () => { for (const material of materials) material.dispose(); }, [materials]);

  // R3F applies a group's position/rotation/scale props and attaches it to
  // the scene graph while committing — before any passive effect in this
  // component runs — so reading updateWorldMatrix here sees this group's
  // real, current placement, not a leftover construction-time identity.
  useEffect(() => {
    if (floor === null || !active) return;
    const group = groupRef.current;
    if (group === null) return;
    const host = nativeSplatScene(scene);
    const owner = {};
    scene.updateWorldMatrix(true, false);
    group.updateWorldMatrix(true, false);
    host.setExclusion(owner, {
      matrix: floorExclusionMatrix(floor.manifest, scene.matrixWorld, group.matrixWorld),
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
      ref={groupRef}
      position={[...transform.position] as [number, number, number]}
      rotation={[...transform.rotation] as [number, number, number]}
      scale={transform.scale}
      name="stage-floor"
    >
      {floor.tiles.map((tile, index) => {
        const material = materials[index];
        return material === undefined ? null : (
          <mesh
            key={index}
            geometry={tile.geometry}
            material={material}
            name={`stage-floor-tile-${String(index)}`}
            raycast={() => undefined}
          />
        );
      })}
    </group>
  );
}
