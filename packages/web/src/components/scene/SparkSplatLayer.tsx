import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  disposeSparkRendererAfterWorkerDrain,
  sparkRendererAdmissionGate,
  type SparkRendererAdmissionLease,
} from "./spark-renderer-lifecycle.js";

type Vector3Tuple = readonly [number, number, number];
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
  readonly position?: Vector3Tuple;
  readonly rotation?: Vector3Tuple;
  readonly scale?: ScaleValue;
  readonly includeRendererHost?: boolean;
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

export function SparkRendererHost(): ReactElement | null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [sparkRenderer, setSparkRenderer] = useState<SparkRenderer | null>(null);

  useEffect(() => {
    let active = true;
    let constructorFailed = false;
    let renderer: SparkRenderer | null = null;
    let lease: SparkRendererAdmissionLease | null = null;
    const acquire = (): void => {
      if (!active || constructorFailed || renderer !== null) return;
      const nextLease = sparkRendererAdmissionGate.acquire(gl);
      if (nextLease === null) return;
      try {
        renderer = new SparkRenderer({
          renderer: gl,
          onDirty: invalidate,
          transparent: true,
          depthWrite: false,
        });
      } catch (error: unknown) {
        constructorFailed = true;
        nextLease.quarantine();
        setTimeout(() => { throw error; }, 0);
        return;
      }
      lease = nextLease;
      setSparkRenderer(renderer);
    };
    acquire();
    const unsubscribe = sparkRendererAdmissionGate.subscribe(acquire);

    return () => {
      active = false;
      unsubscribe();
      const retiringRenderer = renderer;
      const retiringLease = lease;
      renderer = null;
      lease = null;
      setSparkRenderer((current) => current === retiringRenderer ? null : current);
      if (retiringRenderer !== null && retiringLease !== null) {
        void disposeSparkRendererAfterWorkerDrain(retiringRenderer, {
          onDisposed: retiringLease.release,
          onQuarantined: retiringLease.quarantine,
        });
      }
    };
  }, [gl, invalidate]);

  return sparkRenderer === null ? null : <primitive object={sparkRenderer} />;
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
  } = props;
  const invalidate = useThree((state) => state.invalidate);
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
    let disposed = false;
    let meshDisposed = false;
    const splatMesh = new SplatMesh({
      url,
      editable: false,
      raycastable: false,
    });
    applyLayerProps(splatMesh, latestLayerPropsRef.current);
    meshRef.current = splatMesh;
    setMesh(splatMesh);
    invalidate();

    const disposeOnce = (): void => {
      if (meshDisposed) return;
      meshDisposed = true;
      splatMesh.dispose();
    };

    void splatMesh.initialized
      .then((loadedMesh) => {
        if (disposed) {
          disposeOnce();
          return;
        }
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
        disposeOnce();
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
      splatMesh.visible = false;
      splatMesh.opacity = 0;
      if (splatMesh.isInitialized) disposeOnce();
      invalidate();
    };
  }, [invalidate, onError, onLoad, url]);

  return (
    <>
      {includeRendererHost && <SparkRendererHost />}
      {mesh !== null && <primitive object={mesh} />}
    </>
  );
}
