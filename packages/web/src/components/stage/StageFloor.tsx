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
import { GENERATED_VENUE_SLUG } from "../../data/generated/trades-hall-splat-bundles.js";
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

interface FloorTile {
  readonly geometry: BufferGeometry;
  readonly map: Texture;
}

interface LoadedFloor {
  readonly manifest: FloorSkinManifest;
  readonly tiles: readonly FloorTile[];
  readonly slab: Uint8Array;
}

/** A load result tagged with the room+tier it answers, so a stale result
 * (superseded before it landed, or still on hand from before a room change)
 * is never rendered or excluded against the wrong room. */
interface KeyedFloor {
  readonly key: string;
  readonly floor: LoadedFloor;
}

/** Floors whose geometries and textures have been disposed. None is ever
 * rendered again: three would upload the disposed resources afresh, and
 * nothing would dispose that upload. */
const releasedFloors = new WeakSet<LoadedFloor>();

function releaseTiles(tiles: readonly FloorTile[]): void {
  for (const tile of tiles) { tile.geometry.dispose(); tile.map.dispose(); }
}

function releaseFloor(floor: LoadedFloor): void {
  releasedFloors.add(floor);
  releaseTiles(floor.tiles);
}

async function readBytes(url: string, signal: AbortSignal, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The ${what} could not be read (${String(response.status)}).`);
  return response.arrayBuffer();
}

/** One tile's texture and its displaced grid; the texture is disposed if the grid cannot be built. */
async function loadTile(loader: TextureLoader, url: string, manifest: FloorSkinManifest, index: number, heights: Int16Array): Promise<FloorTile> {
  const map = await loader.loadAsync(url);
  map.colorSpace = SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  map.needsUpdate = true;
  try {
    return { geometry: floorSkinTileGeometry(manifest, index, heights), map };
  } catch (reason: unknown) {
    map.dispose();
    throw reason;
  }
}

/**
 * Whether an answer means no floor-skin package is published here. A checkout
 * without staged captures answers 404 or with the app's HTML shell; neither is
 * an error, the room simply keeps its captured floor.
 */
function packageAbsent(response: Response): boolean {
  return response.status === 404 || (response.ok && !(response.headers.get("content-type") ?? "").includes("json"));
}

/** Loads the room's floor skin, or resolves null when none is published. */
async function loadFloor(url: string, roomSlug: string, tierName: FloorSkinTier, signal: AbortSignal): Promise<LoadedFloor | null> {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const response = await fetch(url, { signal });
  if (packageAbsent(response)) return null;
  if (!response.ok) throw new Error(`The floor skin could not be read (${String(response.status)}).`);
  const manifest = FloorSkinManifestSchema.parse(await response.json());
  // The package says what it was built for. One for another venue or room is
  // measured in another capture's frame and must never stand in for this floor.
  if (manifest.venue !== GENERATED_VENUE_SLUG || manifest.room !== roomSlug) {
    throw new Error(`The floor skin at ${url} was built for ${manifest.venue}/${manifest.room}, not ${GENERATED_VENUE_SLUG}/${roomSlug}.`);
  }
  const [heightBuffer, slabBuffer] = await Promise.all([
    readBytes(base + manifest.height.file, signal, "floor height grid"),
    readBytes(base + manifest.slab.file, signal, "floor slab mask"),
  ]);
  const heights = decodeFloorHeights(heightBuffer, manifest);
  const slab = new Uint8Array(slabBuffer);
  if (slab.length !== manifest.slab.width * manifest.slab.height) throw new Error("The floor slab mask has the wrong size.");
  const files = manifest.tiers[tierName].files.slice(0, manifest.tiles.length);
  if (files.length !== manifest.tiles.length) {
    throw new Error(`The floor skin's ${tierName} tier has ${String(files.length)} files for ${String(manifest.tiles.length)} tiles.`);
  }
  const loader = new TextureLoader();
  // Every tile settles before anything is decided, so a failed or superseded
  // load disposes each tile that did arrive instead of leaving it resident.
  const settled = await Promise.allSettled(files.map((file, index) => loadTile(loader, base + file, manifest, index, heights)));
  const tiles = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (signal.aborted) {
    releaseTiles(tiles);
    throw new DOMException("Aborted", "AbortError");
  }
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed !== undefined) {
    releaseTiles(tiles);
    const reason: unknown = failed.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  return { manifest, tiles, slab };
}

/**
 * The room's floor as a measured surface wearing its own photographs (T-639),
 * drawn under the same `transform` as its splat tiles. While shown, it hides
 * the floor-slab splats underneath via the host's exclusion test (see
 * `native-splat-scene.ts`). Renders nothing for a room without a floor-skin
 * package, where Gaussian splats may not run, while loading, or while
 * `active` is false.
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
  // The floor replaces part of the capture, so it is held wherever the
  // capture is: nothing is fetched where Gaussian splats may not run.
  const splatsAvailable = gaussianSplatsAvailable();
  const url = roomSlug === null || !splatsAvailable ? null : floorSkinManifestUrl(roomSlug, import.meta.env.VITE_SPLAT_BASE_URL);
  const key = url === null ? null : `${url}|${tierName}`;
  const colourMode = floorColourModeFromSearch(typeof window === "undefined" ? "" : window.location.search, splatsAvailable);
  const [loaded, setLoaded] = useState<KeyedFloor | null>(null);
  // Only a load whose key matches the room/tier showing right now counts, and
  // never one already disposed: returning to a room (another room and back,
  // or the planner's staged → package → staged flip) reaches the same key as
  // the floor its previous visit disposed.
  const floor = loaded !== null && loaded.key === key && !releasedFloors.has(loaded.floor) ? loaded.floor : null;
  const groupRef = useRef<Group>(null);

  // Keyed by room + device tier only, not by `active`: switching layer modes
  // must not re-fetch a floor already on hand, and loading proceeds even
  // while the layer that will show it is not active yet, so activating it is
  // instant instead of popping in a frame later. A load that is no longer
  // wanted (its key superseded, or the component unmounted) is aborted, and
  // whatever it produced is disposed by this effect's cleanup and cleared from
  // state: a later visit to the same key loads afresh.
  useEffect(() => {
    if (url === null || roomSlug === null) return;
    const loadKey = `${url}|${tierName}`;
    const controller = new AbortController();
    let delivered: LoadedFloor | null = null;
    loadFloor(url, roomSlug, tierName, controller.signal)
      .then((result) => {
        if (result === null) return;
        // Superseded after the loader's last check: nothing will ever show it.
        if (controller.signal.aborted) { releaseFloor(result); return; }
        delivered = result;
        setLoaded({ key: loadKey, floor: result });
        invalidate();
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        // Not fatal: the room is still shown through its Gaussian splats, so a
        // broken floor skin must not break the walk or the plan. (An absent one
        // resolves null above and is not an error at all.)
        globalThis.reportError(reason instanceof Error ? reason : new Error(String(reason)));
      });
    return () => {
      controller.abort();
      if (delivered === null) return;
      const released = delivered;
      releaseFloor(released);
      setLoaded((current) => (current?.floor === released ? null : current));
    };
  }, [url, roomSlug, tierName, invalidate]);

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

  // The placement's values, not the transform object: a caller may build an
  // equal transform on every render, and each re-run of the exclusion effect
  // below clears and re-cuts the host's shared 512 KB mask and uploads it again.
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
  const { scale } = transform;

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
  }, [floor, active, scene, invalidate, px, py, pz, rx, ry, rz, scale]);

  if (floor === null || !active) return null;
  return (
    <group ref={groupRef} position={[px, py, pz]} rotation={[rx, ry, rz]} scale={scale} name="stage-floor">
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
