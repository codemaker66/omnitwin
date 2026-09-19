import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Object3D, type BufferGeometry } from "three";
import type { SplatRuntimeSettings } from "../../lib/splat-runtime-profile.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { nativeSplatScene } from "../../lib/native-splat-scene.js";
import { nativeSplatCount } from "../../lib/native-splat-merge.js";
import { gaussianSplatsAvailable } from "../../lib/splat-access.js";

type Vector3Tuple = readonly [number, number, number];
export type NativeSplatRuntime = Pick<SplatRuntimeSettings, "minSortIntervalMs" | "maxStdDev" | "lod" | "lodSplatCount"> & Partial<Pick<SplatRuntimeSettings, "maxSh">>;

export interface NativeSplatLoadEvent {
  readonly url: string;
  readonly splatCount: number;
  readonly localBounds: { readonly min: Vector3Tuple; readonly max: Vector3Tuple } | null;
}
export interface NativeSplatErrorEvent { readonly url: string; readonly error: Error }

export interface NativeSplatLayerProps {
  readonly url: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly opacityFn?: () => number;
  readonly position?: Vector3Tuple;
  readonly rotation?: Vector3Tuple;
  readonly scale?: number | Vector3Tuple;
  readonly includeRendererHost?: boolean;
  readonly runtime?: NativeSplatRuntime;
  /** Whole capture levels are selected by the room controller; native never thins individual splats. */
  readonly lodScaleFn?: () => number;
  /** Legacy route flag. RAD is resolved to canonical SOG by the source controller. */
  readonly paged?: boolean;
  /** Complete level cache for immediate motion/detail switching, bounded to two snapshots. */
  readonly residencyGroup?: string;
  readonly onFirstFrame?: () => void;
  readonly minimumDrawnSources?: number;
  readonly onLoad?: (event: NativeSplatLoadEvent) => void;
  /** First GPU-completed main-camera draw with submitted opacity >= 0.98; not compositor presentation. */
  readonly onRendered?: (url: string) => void;
  readonly onError?: (event: NativeSplatErrorEvent) => void;
}

interface NativeRendererMountProps {
  readonly runtime?: NativeSplatRuntime;
  readonly lodScaleFn?: () => number;
  readonly onFirstFrame?: () => void;
  readonly minimumDrawnSources?: number;
}

/** Shared scene host. Multiple mounts acquire the same native draw and lifecycle. */
export function NativeSplatRendererMount({ runtime, onFirstFrame, minimumDrawnSources = 1 }: NativeRendererMountProps): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const host = useMemo(() => nativeSplatScene(scene), [scene]);
  useEffect(() => {
    const renderer = getNativeRenderer(gl);
    if (renderer === null) throw new Error("NativeSplatLayer requires NativeCanvas (Three WebGPURenderer)");
    return host.attach(renderer, camera, invalidate);
  }, [host, gl, camera, invalidate]);
  const radius = runtime?.maxStdDev;
  const interval = runtime?.minSortIntervalMs;
  useEffect(() => { host.configure(radius, interval); invalidate(); }, [host, radius, interval, invalidate]);
  useEffect(() => {
    if (onFirstFrame === undefined) return;
    return host.firstFrame({ camera, callback: onFirstFrame, minimumSources: minimumDrawnSources });
  }, [host, camera, onFirstFrame, minimumDrawnSources]);
  useFrame((state) => { host.frame(state.clock.elapsedTime); }, -1);
  return null;
}

export const NativeRendererMount = NativeSplatRendererMount;

/** Loads one source; the host merges all sources in their actual scene-world frame. */
export function NativeSplatLayer(props: NativeSplatLayerProps): ReactElement | null {
  // A final render boundary also covers future callers and persisted scene state.
  if (!gaussianSplatsAvailable()) return null;
  return <AvailableNativeSplatLayer {...props} />;
}

function AvailableNativeSplatLayer(props: NativeSplatLayerProps): ReactElement {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const host = useMemo(() => nativeSplatScene(scene), [scene]);
  const anchor = useMemo(() => new Object3D(), []);
  const latest = useRef(props);
  latest.current = props;
  const opacity = useRef(props.opacity ?? 1);
  const url = props.url;
  useFrame(() => {
    opacity.current = latest.current.opacityFn?.() ?? latest.current.opacity ?? 1;
  }, -2);

  useEffect(() => {
    const controller = new AbortController();
    let geometry: BufferGeometry | null = null;
    let disposed = false;
    opacity.current = latest.current.opacityFn?.() ?? latest.current.opacity ?? 1;
    const registration = host.register({
      anchor,
      opacity: () => opacity.current,
      maxSh: () => Math.max(0, Math.min(3, Math.floor(latest.current.runtime?.maxSh ?? 3))),
      residencyGroup: () => latest.current.residencyGroup,
      onError: (error) => { if (!disposed) latest.current.onError?.({ url, error }); },
      onRendered: () => { if (!disposed) latest.current.onRendered?.(url); },
    });
    void import("../../lib/native-splat-loader.js")
      .then(({ loadNativeSplatGeometry }) => loadNativeSplatGeometry(url, { signal: controller.signal }))
      .then((loaded) => {
        if (disposed) { loaded.dispose(); return; }
        geometry = loaded;
        registration.setGeometry(loaded);
        const bounds = loaded.boundingBox;
        latest.current.onLoad?.({
          url,
          splatCount: nativeSplatCount(loaded),
          localBounds: bounds === null || bounds.isEmpty() ? null : {
            min: [bounds.min.x, bounds.min.y, bounds.min.z],
            max: [bounds.max.x, bounds.max.y, bounds.max.z],
          },
        });
        invalidate();
      })
      .catch((reason: unknown) => {
        if (disposed || controller.signal.aborted) return;
        latest.current.onError?.({ url, error: reason instanceof Error ? reason : new Error(String(reason)) });
      });
    return () => {
      disposed = true;
      controller.abort();
      registration.dispose();
      geometry?.dispose();
    };
  }, [host, anchor, url, invalidate]);

  const position = props.position ?? [0, 0, 0];
  const rotation = props.rotation ?? [0, 0, 0];
  const scale = props.scale ?? 1;
  // The anchor participates in the actual parent graph, including fixture Z-up groups.
  // There is no separate per-layer renderer or draw hidden under it.
  return <>
    {(props.includeRendererHost ?? true) && <NativeSplatRendererMount runtime={props.runtime} lodScaleFn={props.lodScaleFn} onFirstFrame={props.onFirstFrame} minimumDrawnSources={props.minimumDrawnSources} />}
    <primitive object={anchor} visible={props.visible ?? true} position={position} rotation={rotation} scale={scale} />
  </>;
}
