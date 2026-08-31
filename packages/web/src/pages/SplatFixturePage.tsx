import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Color, FrontSide, NoToneMapping, PerspectiveCamera } from "three";
import { textSplats } from "@sparkjsdev/spark";
import type {
  VisualLineageFixtureSettingsV0,
  VisualLineagePlyMeshRuntimeStateV0,
  VisualLineageSparkRuntimeStateV0,
} from "@omnitwin/types";
import { useSearchParams } from "react-router-dom";
import { TruthModeIndicator } from "../components/truth/TruthModeIndicator.js";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
  type SparkRendererRuntimeState,
} from "../components/scene/SparkSplatLayer.js";
import {
  PlyStructuralEvidenceLayer,
  type PlyStructuralEvidenceErrorEvent,
  type PlyStructuralEvidenceLoadEvent,
} from "../components/scene/PlyStructuralEvidenceLayer.js";
import {
  buildProceduralTruthSummary,
  isTruthModeUiEnabled,
} from "../lib/truth-mode-summary.js";

// P0 ingestion probe bridge (dev route only): headless checks read load
// results per URL from this window global instead of scraping the canvas.
interface SplatFixtureBridge {
  runtimeInstanceId?: string;
  status: "loading" | "loaded" | "error";
  startedAtMs: number;
  results: {
    url: string;
    ok: boolean;
    splatCount?: number;
    bounds?: SparkSplatLoadEvent["localBounds"];
    error?: string;
    elapsedMs: number;
  }[];
  settings?: VisualLineageFixtureSettingsV0;
  actualCamera?: {
    readonly position: readonly [number, number, number];
    readonly quaternion: readonly [number, number, number, number];
    readonly projectionMatrix: readonly number[];
    readonly fov: number | null;
    readonly near: number;
    readonly far: number;
  };
  actualRenderer?: {
    readonly toneMapping: string;
    readonly outputColorSpace: string;
  };
  renderedFrameCount: number;
  sparkRuntimeState?: VisualLineageSparkRuntimeStateV0;
  plyMeshRuntimeState?: VisualLineagePlyMeshRuntimeStateV0;
}

declare global {
  interface Window {
    __splatFixture?: SplatFixtureBridge;
    __splatFixtureRequestRender?: () => void;
  }
}

function fixtureBridge(): SplatFixtureBridge {
  window.__splatFixture ??= {
    status: "loading",
    startedAtMs: performance.now(),
    results: [],
    renderedFrameCount: 0,
  };
  return window.__splatFixture;
}

function SparkTextSplat(): React.ReactElement {
  const splat = useMemo(() => {
    const mesh = textSplats({
      text: "VSIR",
      fontSize: 84,
      color: new Color("#d8ad4a"),
      dotRadius: 0.024,
      objectScale: 0.018,
    });
    mesh.position.set(-1.2, -0.15, -2.8);
    mesh.rotation.x = -0.08;
    return mesh;
  }, []);

  useFrame((_state, delta) => {
    splat.rotation.y += delta * 0.18;
  });

  useEffect(() => {
    return () => {
      splat.dispose();
    };
  }, [splat]);

  return <primitive object={splat} />;
}

/** "x,y,z" → tuple, or null when absent/malformed. */
function parseVec3(raw: string | null): readonly [number, number, number] | null {
  if (raw === null) return null;
  const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function FixtureCameraProbe(): null {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    window.__splatFixtureRequestRender = invalidate;
    return () => {
      delete window.__splatFixtureRequestRender;
    };
  }, [invalidate]);

  useFrame(({ camera, gl }) => {
    const actualCamera = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
      projectionMatrix: camera.projectionMatrix.toArray(),
      fov: camera instanceof PerspectiveCamera ? camera.fov : null,
      near: camera.near,
      far: camera.far,
    } as const;
    const actualRenderer = {
      toneMapping: gl.toneMapping === NoToneMapping ? "NoToneMapping" : `three:${String(gl.toneMapping)}`,
      outputColorSpace: gl.outputColorSpace,
    } as const;
    queueMicrotask(() => {
      const bridge = fixtureBridge();
      bridge.actualCamera = actualCamera;
      bridge.actualRenderer = actualRenderer;
      bridge.renderedFrameCount += 1;
    });
  });
  return null;
}

function FixedFixtureCamera({
  position,
  target,
}: {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}): null {
  const camera = useThree((state) => state.camera);

  useLayoutEffect(() => {
    camera.position.set(...position);
    camera.lookAt(...target);
    camera.updateMatrixWorld(true);
  }, [camera, position, target]);

  return null;
}

function parsePositiveNumber(raw: string | null, fallback: number): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function UrlSplatScene({ urls }: { readonly urls: readonly string[] }): React.ReactElement {
  const expected = urls.length;
  const [allLoaded, setAllLoaded] = useState(false);
  const runtimeInstanceId = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    if (allLoaded) fixtureBridge().status = "loaded";
  }, [allLoaded]);

  const settle = useCallback((entry: SplatFixtureBridge["results"][number]) => {
    const bridge = fixtureBridge();
    bridge.results.push(entry);
    if (bridge.results.length >= expected) {
      const loaded = bridge.results.every((r) => r.ok);
      if (loaded) setAllLoaded(true);
      else bridge.status = "error";
    }
  }, [expected]);

  const onLoad = useCallback((event: SparkSplatLoadEvent) => {
    settle({
      url: event.url,
      ok: true,
      splatCount: event.splatCount,
      bounds: event.localBounds,
      elapsedMs: performance.now() - fixtureBridge().startedAtMs,
    });
  }, [settle]);

  const onError = useCallback((event: SparkSplatErrorEvent) => {
    settle({
      url: event.url,
      ok: false,
      error: event.error.message,
      elapsedMs: performance.now() - fixtureBridge().startedAtMs,
    });
  }, [settle]);

  const onRendererState = useCallback((state: SparkRendererRuntimeState) => {
    fixtureBridge().sparkRuntimeState = state;
  }, []);

  useEffect(() => {
    fixtureBridge().runtimeInstanceId = runtimeInstanceId;
  }, [runtimeInstanceId]);

  return (
    <>
      {urls.map((url, index) => (
        <SparkSplatLayer
          key={url}
          url={url}
          visible={allLoaded}
          includeRendererHost={index === 0}
          sortRadial={false}
          onRendererState={onRendererState}
          onLoad={onLoad}
          onError={onError}
        />
      ))}
    </>
  );
}

function PlyStructuralScene({ url }: { readonly url: string }): React.ReactElement {
  const runtimeInstanceId = useRef(crypto.randomUUID()).current;
  useEffect(() => {
    fixtureBridge().runtimeInstanceId = runtimeInstanceId;
  }, [runtimeInstanceId]);
  const onLoad = useCallback((event: PlyStructuralEvidenceLoadEvent) => {
    const bridge = fixtureBridge();
    bridge.results.push({
      url: event.url,
      ok: true,
      elapsedMs: performance.now() - bridge.startedAtMs,
    });
    bridge.plyMeshRuntimeState = event.runtimeState;
    bridge.status = "loaded";
  }, []);
  const onError = useCallback((event: PlyStructuralEvidenceErrorEvent) => {
    const bridge = fixtureBridge();
    bridge.results.push({
      url: event.url,
      ok: false,
      error: event.error.message,
      elapsedMs: performance.now() - bridge.startedAtMs,
    });
    bridge.status = "error";
  }, []);
  return <PlyStructuralEvidenceLayer url={url} onLoad={onLoad} onError={onError} />;
}

function FixtureConfigurationError({ message }: { readonly message: string }): null {
  useEffect(() => {
    const bridge = fixtureBridge();
    bridge.results.push({
      url: "fixture:configuration",
      ok: false,
      error: message,
      elapsedMs: performance.now() - bridge.startedAtMs,
    });
    bridge.status = "error";
  }, [message]);
  return null;
}

export function SplatFixturePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const truthModeEnabled = isTruthModeUiEnabled(searchParams, import.meta.env.DEV);
  const splatUrls = useMemo(() => {
    const raw = searchParams.get("splatUrl");
    if (raw === null || raw.trim() === "") return null;
    return raw.split(",").map((u) => u.trim()).filter((u) => u !== "");
  }, [searchParams]);
  const meshUrl = useMemo(() => {
    const raw = searchParams.get("meshUrl")?.trim() ?? "";
    return raw === "" ? null : raw;
  }, [searchParams]);
  const sourceConflict = splatUrls !== null && meshUrl !== null;
  const hasSource = splatUrls !== null || meshUrl !== null;
  const meshMode = meshUrl !== null && !sourceConflict;
  // Content axis + framing controls for real-capture probes (P1). LCC exports
  // are Z-up; zUp=1 rotates the splat group into three.js Y-up. cam/look are
  // world-space (post-rotation) tuples; fov defaults tighter for interiors.
  const zUp = searchParams.get("zUp") === "1";
  const cam = useMemo(() => parseVec3(searchParams.get("cam")), [searchParams]);
  const look = useMemo(() => parseVec3(searchParams.get("look")), [searchParams]);
  const offset = useMemo(() => parseVec3(searchParams.get("offset")), [searchParams]);
  const fov = Number.parseFloat(searchParams.get("fov") ?? "") || (hasSource ? 60 : 48);
  const near = parsePositiveNumber(searchParams.get("near"), 0.1);
  const far = parsePositiveNumber(searchParams.get("far"), 120);
  const dpr = parsePositiveNumber(searchParams.get("dpr"), 1);
  const antialias = searchParams.get("antialias") !== "0";
  const fixedCamera = searchParams.get("fixed") === "1";
  const cameraPosition = cam ?? [0, 0.6, 3.4] as const;
  const cameraTarget = look ?? (hasSource ? [0, 0, 0] as const : [0, -0.1, -2.8] as const);
  const groupOffset = offset ?? [0, 0, 0] as const;
  const truthSummary = useMemo(
    () => buildProceduralTruthSummary({
      surface: "spark_fixture",
      placedObjectCount: 0,
      measuredRuntimeAssetsLoaded: false,
    }),
    [],
  );

  useEffect(() => {
    fixtureBridge().settings = {
      camera: {
        position: [...cameraPosition],
        target: [...cameraTarget],
        fov,
        near,
        far,
      },
      group: { zUp, offset: [...groupOffset] },
      renderer: {
        dpr,
        antialias,
        fixedCamera,
        transparent: !meshMode,
        depthWrite: meshMode,
      },
    };
  }, [antialias, cameraPosition, cameraTarget, dpr, far, fixedCamera, fov, groupOffset, meshMode, near, zUp]);

  return (
    <main style={{
      position: "fixed",
      inset: 0,
      background: "#101217",
      color: "#f7efe2",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <Canvas
        flat
        dpr={[dpr, dpr]}
        frameloop={fixedCamera ? "demand" : "always"}
        camera={{
          fov,
          near,
          far,
          position: cameraPosition,
        }}
        gl={{ antialias, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#101217"]} />
        {fixedCamera ? <FixedFixtureCamera position={cameraPosition} target={cameraTarget} /> : null}
        <FixtureCameraProbe />
        {meshMode ? null : <hemisphereLight args={["#fff4d8", "#30243a", 1.8]} />}
        {meshMode ? null : <directionalLight position={[2, 4, 3]} intensity={1.1} />}
        {sourceConflict ? (
          <FixtureConfigurationError message="PLY structural fixture received both splatUrl and meshUrl." />
        ) : !hasSource ? (
          <>
            <SparkTextSplat />
            <mesh position={[0, -0.85, -2.9]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.35, 1.38, 96]} />
              <meshBasicMaterial color="#6f5c3a" transparent opacity={0.6} side={FrontSide} />
            </mesh>
          </>
        ) : (
          <group
            rotation={zUp ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
            position={groupOffset}
          >
            {meshUrl === null
              ? <UrlSplatScene urls={splatUrls ?? []} />
              : <PlyStructuralScene url={meshUrl} />}
          </group>
        )}
        {fixedCamera ? null : (
          <OrbitControls
            enablePan={hasSource}
            minDistance={hasSource ? 0.2 : 2.4}
            maxDistance={hasSource ? 40 : 5.2}
            target={cameraTarget}
          />
        )}
      </Canvas>

      {fixedCamera ? null : (
        <div style={{
          position: "absolute",
          left: 24,
          top: 24,
          maxWidth: 360,
          padding: "14px 16px",
          border: "1px solid rgba(216, 173, 74, 0.38)",
          background: "rgba(16, 18, 23, 0.72)",
          backdropFilter: "blur(14px)",
        }}>
          <div style={{ fontSize: 13, letterSpacing: 0, color: "#d8ad4a", marginBottom: 6 }}>
            Spark fixture
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.45 }}>
            Three.js 0.180 + Spark 2.0 smoke route.
          </div>
        </div>
      )}
      {truthModeEnabled && !fixedCamera && <TruthModeIndicator summary={truthSummary} />}
    </main>
  );
}
