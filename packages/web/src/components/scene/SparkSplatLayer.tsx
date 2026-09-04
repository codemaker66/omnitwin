import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { SplatRuntimeSettings } from "../../lib/splat-runtime-profile.js";

type Vector3Tuple = readonly [number, number, number];

/**
 * The part of a runtime profile the renderer and the mesh consume.
 *
 * Absent, Spark's own defaults apply everywhere, which is what every mount
 * that predates the profile gets. Present, the renderer host is created with
 * the sort interval, tail radius and level-of-detail budget, and each mesh
 * loads through the tree or not as the profile says.
 */
export type SparkSplatRuntime = Pick<
  SplatRuntimeSettings,
  "minSortIntervalMs" | "maxStdDev" | "lod" | "lodSplatCount"
> & Partial<Pick<SplatRuntimeSettings, "maxSh">>;
type ScaleValue = number | Vector3Tuple;
type LayerVisualProps = Required<Pick<
  SparkSplatLayerProps,
  "visible" | "opacity" | "position" | "rotation" | "scale"
>>;

const DEFAULT_POSITION: Vector3Tuple = [0, 0, 0];
const DEFAULT_ROTATION: Vector3Tuple = [0, 0, 0];
const DEFAULT_SCALE = 1;

export interface SparkSplatLoadEvent {
  readonly url: string;
  readonly splatCount: number;
  readonly localBounds: {
    readonly min: Vector3Tuple;
    readonly max: Vector3Tuple;
  } | null;
}

export interface SparkSplatErrorEvent {
  readonly url: string;
  readonly error: Error;
}

export interface SparkSplatLayerProps {
  readonly url: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  /**
   * Per-frame opacity source, for animated dissolves.
   *
   * When present it is polled inside useFrame and written straight onto the
   * SplatMesh — no React state, props, or reconciliation in the loop. The
   * caller owns invalidation (keep the demand loop awake while easing) and
   * MUST keep this function identity-stable: it is deliberately excluded from
   * the load effect, but churning it defeats the point of having it.
   */
  readonly opacityFn?: () => number;
  readonly position?: Vector3Tuple;
  readonly rotation?: Vector3Tuple;
  readonly scale?: ScaleValue;
  readonly includeRendererHost?: boolean;
  /**
   * Device runtime settings. Omitted, Spark's defaults apply; see
   * SparkSplatRuntime. Only the host mount's value reaches the renderer.
   */
  readonly runtime?: SparkSplatRuntime;
  /**
   * Per-frame level-of-detail scale for the renderer host, relative to the
   * runtime's resting budget: 1 shows the resting budget, 0.125 an eighth of
   * it. Polled inside useFrame like opacityFn, written to the renderer only
   * when it changes, and only honoured on the mount that includes the host.
   * Keep the identity stable.
   */
  readonly lodScaleFn?: () => number;
  /**
   * The url is a prebuilt, chunked Spark tree (`.rad` with `.radc` chunks):
   * stream it page by page. Such a mesh never gets the runtime's `lod` flag,
   * which would rebuild in a worker the tree the file already carries.
   */
  readonly paged?: boolean;
  readonly onLoad?: (event: SparkSplatLoadEvent) => void;
  readonly onError?: (event: SparkSplatErrorEvent) => void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function splatCount(mesh: SplatMesh): number {
  const count = mesh.numSplats;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function splatLocalBounds(mesh: SplatMesh): SparkSplatLoadEvent["localBounds"] {
  const bounds = mesh.getBoundingBox(true);
  if (bounds.isEmpty()) return null;
  return {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  };
}

function applyLayerProps(
  mesh: SplatMesh,
  { visible, opacity, position, rotation, scale }: LayerVisualProps,
): void {
  mesh.visible = visible;
  mesh.opacity = opacity;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);

  if (typeof scale === "number") {
    mesh.scale.setScalar(scale);
  } else {
    mesh.scale.set(scale[0], scale[1], scale[2]);
  }
}

/**
 * A SparkRenderer of its own, mounted on nothing.
 *
 * One host per scene is the rule (twelve hosts on twelve tiles cost the Grand
 * Hall 162 fps under drag, T-574). A scene that swaps its tiles — the
 * coarse-first ladder drops the coarse room when the finest level lands — must
 * mount the host here rather than on a tile, or the renderer leaves with it.
 */
export function SparkRendererMount({
  runtime,
  lodScaleFn,
}: {
  readonly runtime?: SparkSplatRuntime;
  readonly lodScaleFn?: () => number;
}): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const lodScaleFnRef = useRef<(() => number) | undefined>(lodScaleFn);
  useEffect(() => { lodScaleFnRef.current = lodScaleFn; }, [lodScaleFn]);
  // Primitive dependencies, deliberately: an equal profile arriving as a new
  // object must not tear the renderer down and rebuild it mid-scene.
  const minSortIntervalMs = runtime?.minSortIntervalMs;
  const maxStdDev = runtime?.maxStdDev;
  const lodSplatCount = runtime?.lodSplatCount;
  const sparkRenderer = useMemo(
    () => new SparkRenderer({
      renderer: gl,
      onDirty: invalidate,
      transparent: true,
      depthWrite: false,
      ...(minSortIntervalMs === undefined ? {} : { minSortIntervalMs }),
      ...(maxStdDev === undefined ? {} : { maxStdDev }),
      ...(lodSplatCount === undefined ? {} : { lodSplatCount }),
    }),
    [gl, invalidate, minSortIntervalMs, maxStdDev, lodSplatCount],
  );

  // The motion budget, applied as a scale on the resting budget. The tree
  // re-traverses on the next update, so the write is only made on a change.
  useFrame(() => {
    const fn = lodScaleFnRef.current;
    if (fn === undefined) return;
    const scale = fn();
    if (sparkRenderer.lodSplatScale !== scale) sparkRenderer.lodSplatScale = scale;
  });

  useEffect(() => {
    return () => {
      sparkRenderer.dispose();
    };
  }, [sparkRenderer]);

  return <primitive object={sparkRenderer} />;
}

export function SparkSplatLayer(props: SparkSplatLayerProps): ReactElement | null {
  const {
    url,
    onLoad,
    onError,
    visible = true,
    opacity = 1,
    position = DEFAULT_POSITION,
    rotation = DEFAULT_ROTATION,
    scale = DEFAULT_SCALE,
    includeRendererHost = true,
    runtime,
    lodScaleFn,
    paged = false,
    opacityFn,
  } = props;
  // Whether this mesh loads through the level-of-detail tree. A change means a
  // different mesh, so it joins the load effect's dependencies as a primitive.
  // A paged tree already is one, and must not be asked to build another.
  const lod = paged ? undefined : runtime?.lod;
  // The harmonic cap is a property of the live mesh: applied at creation and
  // again on change, without reloading anything.
  const maxSh = runtime?.maxSh;
  const invalidate = useThree((state) => state.invalidate);
  const opacityFnRef = useRef<(() => number) | undefined>(opacityFn);
  useEffect(() => { opacityFnRef.current = opacityFn; }, [opacityFn]);

  // Animated opacity bypasses React entirely: poll the source and write the
  // mesh. Visibility follows so a fully-dissolved splat costs no sort.
  useFrame(() => {
    const fn = opacityFnRef.current;
    const current = meshRef.current;
    if (fn === undefined || current === null) return;
    const next = fn();
    if (current.opacity !== next) {
      current.opacity = next;
      current.visible = latestLayerPropsRef.current.visible && next > 0.002;
    }
  });
  const [mesh, setMesh] = useState<SplatMesh | null>(null);
  const meshRef = useRef<SplatMesh | null>(null);
  const layerProps = useMemo<LayerVisualProps>(() => ({
    visible,
    opacity,
    position,
    rotation,
    scale,
  }), [visible, opacity, position, rotation, scale]);
  const latestLayerPropsRef = useRef<LayerVisualProps>(layerProps);

  useEffect(() => {
    latestLayerPropsRef.current = layerProps;
    const current = meshRef.current;
    if (current !== null) {
      applyLayerProps(current, layerProps);
      invalidate();
    }
  }, [invalidate, layerProps]);

  useEffect(() => {
    const current = meshRef.current;
    if (current !== null && maxSh !== undefined && current.maxSh !== maxSh) {
      current.maxSh = maxSh;
      invalidate();
    }
  }, [invalidate, maxSh]);

  useEffect(() => {
    let disposed = false;
    const splatMesh = new SplatMesh({
      url,
      editable: false,
      raycastable: false,
      ...(lod === undefined ? {} : { lod }),
      ...(paged ? { paged: true } : {}),
    });
    if (maxSh !== undefined) splatMesh.maxSh = maxSh;
    applyLayerProps(splatMesh, latestLayerPropsRef.current);
    meshRef.current = splatMesh;
    setMesh(splatMesh);
    invalidate();

    void splatMesh.initialized
      .then((loadedMesh) => {
        if (disposed) return;
        applyLayerProps(loadedMesh, latestLayerPropsRef.current);
        onLoad?.({
          url,
          splatCount: splatCount(loadedMesh),
          localBounds: splatLocalBounds(loadedMesh),
        });
        invalidate();
      })
      .catch((reason: unknown) => {
        const error = asError(reason);
        if (!disposed) {
          onError?.({ url, error });
        }
        splatMesh.dispose();
        if (!disposed) {
          meshRef.current = null;
          setMesh(null);
          invalidate();
        }
      });

    return () => {
      disposed = true;
      if (meshRef.current === splatMesh) {
        meshRef.current = null;
      }
      splatMesh.dispose();
    };
    // maxSh is deliberately absent: it is applied by its own effect above.
  }, [invalidate, lod, onError, onLoad, paged, url]);

  return (
    <>
      {includeRendererHost && <SparkRendererMount runtime={runtime} lodScaleFn={lodScaleFn} />}
      {mesh !== null && <primitive object={mesh} />}
    </>
  );
}
