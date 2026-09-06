import { EquirectangularReflectionMapping, PMREMGenerator, SRGBColorSpace, TextureLoader } from "three";
import type { Scene, Texture, WebGLRenderer } from "three";
import { GRAND_HALL_FURNITURE_REFLECTION_SOURCE as source } from "../data/grand-hall-furniture-reflection-source.js";

export function resolveFurnitureReflectionExperiment(options: {
  readonly development: boolean;
  readonly search: string;
  readonly roomSlug: string | null;
  readonly captureSource: string;
  readonly splatActive: boolean;
  readonly layerMode: string;
  readonly timelinePreviewActive: boolean;
}): boolean {
  // This derivative uses the staged capture's served frame. A future registered
  // package must not silently inherit the experiment's provisional orientation.
  return options.development && options.roomSlug === "grand-hall" && options.captureSource === "staged"
    && options.splatActive && options.layerMode === "splat" && !options.timelinePreviewActive
    && new URLSearchParams(options.search).get("furniture-reflections") === "panorama";
}

export interface ReflectionResource {
  readonly texture: Texture;
  readonly buildMs: number;
  readonly width: number;
  readonly height: number;
  readonly dispose: () => void;
}

export interface ReflectionLease {
  readonly ready: Promise<ReflectionResource>;
  readonly release: () => void;
}

/** Renderer-local, reference-counted GPU ownership. A microtask absorbs React's
 * synchronous StrictMode effect replay; no timeout retains unused GPU memory. */
export function createReflectionResourceCache<Key extends object>(
  create: (key: Key, isNeeded: () => boolean) => Promise<ReflectionResource>,
): (key: Key) => ReflectionLease {
  interface Entry { refs: number; removed: boolean; resource?: ReflectionResource; ready: Promise<ReflectionResource> }
  const entries = new WeakMap<Key, Entry>();
  return (key) => {
    let entry = entries.get(key);
    if (entry === undefined) {
      const fresh: Entry = { refs: 0, removed: false, ready: Promise.resolve().then(() => {
        if (fresh.removed || fresh.refs === 0) throw new Error("Reflection experiment cancelled before loading");
        return create(key, () => !fresh.removed && fresh.refs > 0);
      }).then((resource) => {
        if (fresh.removed) resource.dispose();
        else fresh.resource = resource;
        return resource;
      }) };
      entry = fresh;
      entries.set(key, entry);
      // Every rejection has an observer even if all owners leave before loading.
      void entry.ready.catch(() => {
        if (entries.get(key) === fresh) entries.delete(key);
      });
    }
    entry.refs += 1;
    const owned = entry;
    let released = false;
    return {
      ready: owned.ready,
      release: () => {
        if (released) return;
        released = true;
        owned.refs -= 1;
        queueMicrotask(() => {
          if (owned.refs !== 0 || owned.removed) return;
          owned.removed = true;
          if (entries.get(key) === owned) entries.delete(key);
          owned.resource?.dispose();
        });
      },
    };
  };
}

/** Image decode is the only async stage. Cancelled owners never start a PMREM
 * render on a renderer that may already have been disposed. */
export async function loadFurnitureReflectionResource(
  renderer: WebGLRenderer, isNeeded: () => boolean,
): Promise<ReflectionResource> {
  const started = performance.now();
  const texture = await new TextureLoader().loadAsync(new URL("../assets/experiments/grand-hall-reflections-1024.jpg", import.meta.url).href);
  let generator: PMREMGenerator | undefined;
  let restoreRenderer: (() => void) | undefined;
  try {
    if (!isNeeded()) throw new Error("Reflection experiment cancelled during image loading");
    texture.colorSpace = SRGBColorSpace;
    texture.mapping = EquirectangularReflectionMapping;
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const xr = renderer.xr.enabled, autoClear = renderer.autoClear;
    restoreRenderer = () => {
      renderer.xr.enabled = xr;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(target, face, mip);
    };
    generator = new PMREMGenerator(renderer);
    const filtered = generator.fromEquirectangular(texture);
    filtered.texture.name = "grand-hall-furniture-reflection-hypothesis";
    return {
      texture: filtered.texture, buildMs: performance.now() - started,
      width: filtered.width, height: filtered.height, dispose: () => { filtered.dispose(); },
    };
  } finally {
    try { generator?.dispose(); } finally {
      try { texture.dispose(); } finally { restoreRenderer?.(); }
    }
  }
}

const acquireReflection = createReflectionResourceCache(loadFurnitureReflectionResource);

export interface FurnitureReflectionLedger {
  readonly status: "loading" | "ready" | "error" | "cancelled" | "superseded";
  readonly sourceSha256: string;
  readonly derivativeSha256: string;
  readonly derivativeBytes: number;
  readonly acceptedRegistration: false;
  readonly radiometricallyCalibrated: false;
  readonly textureUuid?: string;
  readonly buildMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly error?: string;
}

/** Exposes actual state to the local comparison harness without adding product
 * chrome. The usable scene stays visible while this optional texture loads. */
export function mountFurnitureReflectionExperiment(
  scene: Scene, renderer: WebGLRenderer, invalidate: () => void,
  acquire: (renderer: WebGLRenderer) => ReflectionLease = acquireReflection,
): () => void {
  const previousEnvironment = scene.environment;
  const previousRotation = scene.environmentRotation.clone();
  const identityRotation = previousRotation.clone().set(0, 0, 0, "XYZ");
  const lease = acquire(renderer);
  let active = true;
  let installed: Texture | null = null;
  const restoreEnvironment = () => {
    if (installed !== null && scene.environment === installed) {
      scene.environment = previousEnvironment;
      if (scene.environmentRotation.equals(identityRotation)) scene.environmentRotation.copy(previousRotation);
      invalidate();
    }
  };
  let ledger: FurnitureReflectionLedger;
  const publish = (state: Pick<FurnitureReflectionLedger, "status"> & Partial<FurnitureReflectionLedger>) => {
    ledger = {
      sourceSha256: source.source_sha256, derivativeSha256: source.derivative_sha256,
      derivativeBytes: source.derivative_bytes, acceptedRegistration: false,
      radiometricallyCalibrated: false, ...state,
    };
    scene.userData["furnitureReflectionExperiment"] = ledger;
  };
  publish({ status: "loading" });
  void lease.ready.then((resource) => {
    if (!active) return;
    // Do not overwrite another environment owner that arrived during the load.
    if (scene.environment !== previousEnvironment || !scene.environmentRotation.equals(previousRotation)) {
      publish({ status: "superseded" });
      lease.release();
      return;
    }
    installed = resource.texture;
    scene.environment = installed;
    scene.environmentRotation.copy(identityRotation);
    publish({ status: "ready", textureUuid: installed.uuid, buildMs: resource.buildMs, width: resource.width, height: resource.height });
    invalidate();
  }).catch((error: unknown) => {
    if (!active) return;
    restoreEnvironment();
    publish({ status: "error", error: error instanceof Error ? error.message : "Reflection environment failed" });
    lease.release();
  });
  return () => {
    if (!active) return;
    active = false;
    restoreEnvironment();
    if (scene.userData["furnitureReflectionExperiment"] === ledger) publish({ status: "cancelled" });
    lease.release();
  };
}
