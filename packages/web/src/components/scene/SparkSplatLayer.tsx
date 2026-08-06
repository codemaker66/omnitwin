import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import {
  SparkRenderer,
  SplatMesh,
  type SparkRendererOptions,
  type SplatMeshOptions,
} from "@sparkjsdev/spark";
import type { Camera, Scene, WebGLRenderer } from "three";
import { openRuntimePackagePreviewAsset } from "../../api/runtime-packages.js";
import type { SparkSplatSource } from "./spark-splat-source.js";

type Vector3Tuple = readonly [number, number, number];
type ScaleValue = number | Vector3Tuple;
export type SparkSplatRendererSettings = Readonly<Pick<
  SparkRendererOptions,
  | "encodeLinear"
  | "autoUpdate"
  | "preUpdate"
  | "maxStdDev"
  | "minPixelRadius"
  | "maxPixelRadius"
  | "minAlpha"
  | "enable2DGS"
  | "preBlurAmount"
  | "blurAmount"
  | "focalDistance"
  | "apertureAngle"
  | "falloff"
  | "clipXY"
  | "focalAdjustment"
  | "sortRadial"
  | "minSortIntervalMs"
  | "enableLod"
  | "premultipliedAlpha"
  | "transparent"
  | "depthTest"
  | "depthWrite"
>>;

/** A named, inspectable renderer contract. The same object must be supplied to
 * every leaf in one composition so a candidate comparison cannot change
 * quality settings tile by tile. */
export interface SparkSplatRenderProfile {
  readonly id: string;
  readonly maxSh: 0 | 1 | 2 | 3;
  readonly enableLod: boolean;
  readonly renderer: SparkSplatRendererSettings;
}

type LayerVisualProps = Required<Pick<
  SparkSplatLayerBaseProps,
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

export interface SparkSplatCaptureIdentity {
  readonly candidateId: string;
  readonly requestPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface SparkPresentedFrameEvent {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly sparkRenderer: SparkRenderer;
}

export const SPARK_CAPTURE_USER_DATA_KEY = "venviewerSplatCaptureV1";

interface SparkSplatLayerBaseProps {
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly position?: Vector3Tuple;
  readonly rotation?: Vector3Tuple;
  readonly scale?: ScaleValue;
  readonly renderProfile?: SparkSplatRenderProfile;
  readonly includeRendererHost?: boolean;
  readonly onLoad?: (event: SparkSplatLoadEvent) => void;
  readonly onError?: (event: SparkSplatErrorEvent) => void;
  readonly captureIdentity?: SparkSplatCaptureIdentity;
  readonly onPresentedFrame?: (event: SparkPresentedFrameEvent) => void;
}

export type SparkSplatLayerProps = SparkSplatLayerBaseProps & (
  | { readonly url: string; readonly source?: never }
  | { readonly source: SparkSplatSource; readonly url?: never }
);

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
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

function SparkRendererHost({
  renderProfile,
  onPresentedFrame,
}: {
  readonly renderProfile?: SparkSplatRenderProfile;
  readonly onPresentedFrame?: (event: SparkPresentedFrameEvent) => void;
}): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const sparkRenderer = useMemo(
    () => new SparkRenderer({
      renderer: gl,
      onDirty: invalidate,
      transparent: true,
      depthWrite: false,
      ...renderProfile?.renderer,
    }),
    [gl, invalidate, renderProfile],
  );
  const latestPresentedFrame = useRef(onPresentedFrame);
  latestPresentedFrame.current = onPresentedFrame;

  useEffect(() => {
    const rawPrevious: unknown = Reflect.get(sparkRenderer, "onAfterRender");
    const previous = typeof rawPrevious === "function" ? rawPrevious : null;
    sparkRenderer.onAfterRender = function onAfterRender(renderer, scene, camera, ...rest) {
      if (previous !== null) Reflect.apply(previous, this, [renderer, scene, camera, ...rest]);
      latestPresentedFrame.current?.({ renderer, scene, camera, sparkRenderer });
    };
    return () => {
      Reflect.set(sparkRenderer, "onAfterRender", previous ?? undefined);
    };
  }, [sparkRenderer]);

  useEffect(() => {
    return () => {
      sparkRenderer.dispose();
    };
  }, [sparkRenderer]);

  return <primitive object={sparkRenderer} />;
}

interface MutableValue<T> {
  current: T;
}

interface SplatLoadSession {
  readonly controller: AbortController;
  splatMesh: SplatMesh | null;
  meshDisposed: boolean;
  unopenedStream: ReadableStream<Uint8Array> | null;
}

interface SplatLoadDependencies {
  readonly source: SparkSplatSource;
  readonly renderProfile?: SparkSplatRenderProfile;
  readonly captureIdentity?: SparkSplatCaptureIdentity;
  readonly latestLayerPropsRef: MutableValue<LayerVisualProps>;
  readonly meshRef: MutableValue<SplatMesh | null>;
  readonly setMesh: (mesh: SplatMesh | null) => void;
  readonly invalidate: () => void;
  readonly onLoad?: (event: SparkSplatLoadEvent) => void;
  readonly onError?: (event: SparkSplatErrorEvent) => void;
}

interface UseSparkSplatMeshOptions {
  readonly source: SparkSplatSource;
  readonly layerProps: LayerVisualProps;
  readonly renderProfile?: SparkSplatRenderProfile;
  readonly captureIdentity?: SparkSplatCaptureIdentity;
  readonly invalidate: () => void;
  readonly onLoad?: (event: SparkSplatLoadEvent) => void;
  readonly onError?: (event: SparkSplatErrorEvent) => void;
}

function useSparkSplatSource(props: SparkSplatLayerProps): SparkSplatSource {
  const suppliedSource = "source" in props ? props.source : undefined;
  const legacyUrl = "url" in props ? props.url : undefined;
  return useMemo<SparkSplatSource>(() => {
    if (suppliedSource !== undefined) return suppliedSource;
    if (legacyUrl === undefined) throw new Error("SparkSplatLayer requires one splat source");
    return { kind: "url", id: legacyUrl, url: legacyUrl };
  }, [legacyUrl, suppliedSource]);
}

function useLayerVisualProps(props: SparkSplatLayerProps): LayerVisualProps {
  const {
    visible = true,
    opacity = 1,
    position = DEFAULT_POSITION,
    rotation = DEFAULT_ROTATION,
    scale = DEFAULT_SCALE,
  } = props;
  return useMemo(
    () => ({ visible, opacity, position, rotation, scale }),
    [visible, opacity, position, rotation, scale],
  );
}

function createSplatLoadSession(): SplatLoadSession {
  return {
    controller: new AbortController(),
    splatMesh: null,
    meshDisposed: false,
    unopenedStream: null,
  };
}

function requestWasAborted(session: SplatLoadSession): boolean {
  return session.controller.signal.aborted;
}

function disposeSessionMesh(session: SplatLoadSession): void {
  if (session.splatMesh !== null && !session.meshDisposed) {
    session.meshDisposed = true;
    session.splatMesh.dispose();
  }
}

async function openSplatOptions(
  session: SplatLoadSession,
  source: SparkSplatSource,
): Promise<SplatMeshOptions> {
  if (source.kind === "url") return { url: source.url };
  const opened = await openRuntimePackagePreviewAsset(
    source.runtimePackageId,
    source.asset,
    session.controller.signal,
  );
  session.unopenedStream = opened.stream;
  return {
    stream: opened.stream,
    streamLength: opened.streamLength,
    fileName: opened.fileName,
  };
}

async function cancelUnopenedStream(session: SplatLoadSession, clear: boolean): Promise<void> {
  const stream = session.unopenedStream;
  if (stream === null || stream.locked) return;
  await stream.cancel().catch(() => undefined);
  if (clear) session.unopenedStream = null;
}

function createAndMountSplatMesh(
  session: SplatLoadSession,
  dependencies: SplatLoadDependencies,
  options: SplatMeshOptions,
): SplatMesh {
  const { captureIdentity, renderProfile, source } = dependencies;
  const splatMesh = new SplatMesh({
    ...options,
    editable: false,
    raycastable: false,
    ...(renderProfile === undefined ? {} : { enableLod: renderProfile.enableLod }),
  });
  session.splatMesh = splatMesh;
  if (renderProfile !== undefined) splatMesh.maxSh = renderProfile.maxSh;
  if (captureIdentity !== undefined) {
    splatMesh.userData[SPARK_CAPTURE_USER_DATA_KEY] = Object.freeze({
      ...captureIdentity,
      sourceId: source.id,
      renderProfileId: renderProfile?.id ?? null,
    });
  }
  session.unopenedStream = null;
  applyLayerProps(splatMesh, dependencies.latestLayerPropsRef.current);
  dependencies.meshRef.current = splatMesh;
  dependencies.setMesh(splatMesh);
  dependencies.invalidate();
  return splatMesh;
}

function clearMountedSplat(dependencies: SplatLoadDependencies): void {
  dependencies.meshRef.current = null;
  dependencies.setMesh(null);
  dependencies.invalidate();
}

function handleSplatInitializationError(
  session: SplatLoadSession,
  dependencies: SplatLoadDependencies,
  reason: unknown,
): void {
  const error = asError(reason);
  const shouldReport = !requestWasAborted(session) && !isAbortError(reason);
  if (shouldReport) dependencies.onError?.({ url: dependencies.source.id, error });
  // Spark may reject while its reader still owns the response body.
  // Aborting the original fetch is the only reliable way to stop those
  // authenticated bytes; SplatMesh.dispose() releases GPU data only.
  if (!requestWasAborted(session)) session.controller.abort();
  disposeSessionMesh(session);
  if (shouldReport) clearMountedSplat(dependencies);
}

async function settleSplatMesh(
  session: SplatLoadSession,
  dependencies: SplatLoadDependencies,
  splatMesh: SplatMesh,
): Promise<void> {
  try {
    const loadedMesh = await splatMesh.initialized;
    if (requestWasAborted(session)) return;
    applyLayerProps(loadedMesh, dependencies.latestLayerPropsRef.current);
    dependencies.onLoad?.({
      url: dependencies.source.id,
      splatCount: splatCount(loadedMesh),
      localBounds: splatLocalBounds(loadedMesh),
    });
    dependencies.invalidate();
  } catch (reason: unknown) {
    handleSplatInitializationError(session, dependencies, reason);
  }
}

async function initializeSplatSession(
  session: SplatLoadSession,
  dependencies: SplatLoadDependencies,
): Promise<void> {
  const options = await openSplatOptions(session, dependencies.source);
  if (requestWasAborted(session)) {
    await cancelUnopenedStream(session, false);
    return;
  }
  const splatMesh = createAndMountSplatMesh(session, dependencies, options);
  await settleSplatMesh(session, dependencies, splatMesh);
}

async function handleSplatStartupError(
  session: SplatLoadSession,
  dependencies: SplatLoadDependencies,
  reason: unknown,
): Promise<void> {
  await cancelUnopenedStream(session, true);
  if (requestWasAborted(session) || isAbortError(reason)) return;
  dependencies.onError?.({ url: dependencies.source.id, error: asError(reason) });
  clearMountedSplat(dependencies);
}

function cleanupSplatSession(
  session: SplatLoadSession,
  meshRef: MutableValue<SplatMesh | null>,
): void {
  session.controller.abort();
  if (meshRef.current === session.splatMesh) meshRef.current = null;
  disposeSessionMesh(session);
  const stream = session.unopenedStream;
  if (stream !== null && !stream.locked) {
    void stream.cancel().catch(() => undefined);
  }
}

function useSplatVisualProps(
  meshRef: MutableValue<SplatMesh | null>,
  latestLayerPropsRef: MutableValue<LayerVisualProps>,
  layerProps: LayerVisualProps,
  invalidate: () => void,
): void {
  useEffect(() => {
    latestLayerPropsRef.current = layerProps;
    const current = meshRef.current;
    if (current !== null) {
      applyLayerProps(current, layerProps);
      invalidate();
    }
  }, [invalidate, layerProps, latestLayerPropsRef, meshRef]);
}

function useSplatLoadEffect(dependencies: SplatLoadDependencies): void {
  const {
    captureIdentity,
    invalidate,
    latestLayerPropsRef,
    meshRef,
    onError,
    onLoad,
    renderProfile,
    setMesh,
    source,
  } = dependencies;

  useEffect(() => {
    const session = createSplatLoadSession();
    const loadDependencies: SplatLoadDependencies = {
      captureIdentity,
      invalidate,
      latestLayerPropsRef,
      meshRef,
      onError,
      onLoad,
      renderProfile,
      setMesh,
      source,
    };
    void initializeSplatSession(session, loadDependencies).catch(
      (reason: unknown) => handleSplatStartupError(session, loadDependencies, reason),
    );
    return () => {
      cleanupSplatSession(session, meshRef);
    };
  }, [
    captureIdentity,
    invalidate,
    latestLayerPropsRef,
    meshRef,
    onError,
    onLoad,
    renderProfile,
    setMesh,
    source,
  ]);
}

function useSparkSplatMesh(options: UseSparkSplatMeshOptions): SplatMesh | null {
  const [mesh, setMesh] = useState<SplatMesh | null>(null);
  const meshRef = useRef<SplatMesh | null>(null);
  const latestLayerPropsRef = useRef<LayerVisualProps>(options.layerProps);
  useSplatVisualProps(meshRef, latestLayerPropsRef, options.layerProps, options.invalidate);
  useSplatLoadEffect({
    source: options.source,
    renderProfile: options.renderProfile,
    captureIdentity: options.captureIdentity,
    latestLayerPropsRef,
    meshRef,
    setMesh,
    invalidate: options.invalidate,
    onLoad: options.onLoad,
    onError: options.onError,
  });
  return mesh;
}

export function SparkSplatLayer(props: SparkSplatLayerProps): ReactElement | null {
  const source = useSparkSplatSource(props);
  const invalidate = useThree((state) => state.invalidate);
  const layerProps = useLayerVisualProps(props);
  const mesh = useSparkSplatMesh({
    source,
    layerProps,
    renderProfile: props.renderProfile,
    captureIdentity: props.captureIdentity,
    invalidate,
    onLoad: props.onLoad,
    onError: props.onError,
  });
  const { includeRendererHost = true } = props;

  return (
    <>
      {includeRendererHost && (
        <SparkRendererHost
          renderProfile={props.renderProfile}
          onPresentedFrame={props.onPresentedFrame}
        />
      )}
      {mesh !== null && <primitive object={mesh} />}
    </>
  );
}
