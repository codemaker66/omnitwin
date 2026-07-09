import { useCallback, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Color, FrontSide } from "three";
import { textSplats } from "@sparkjsdev/spark";
import { useSearchParams } from "react-router-dom";
import { TruthModeIndicator } from "../components/truth/TruthModeIndicator.js";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../components/scene/SparkSplatLayer.js";
import {
  buildProceduralTruthSummary,
  isTruthModeUiEnabled,
} from "../lib/truth-mode-summary.js";

// P0 ingestion probe bridge (dev route only): headless checks read load
// results per URL from this window global instead of scraping the canvas.
interface SplatFixtureBridge {
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
}

declare global {
  interface Window {
    __splatFixture?: SplatFixtureBridge;
  }
}

function fixtureBridge(): SplatFixtureBridge {
  window.__splatFixture ??= {
    status: "loading",
    startedAtMs: performance.now(),
    results: [],
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

function UrlSplatScene({ urls }: { readonly urls: readonly string[] }): React.ReactElement {
  const expected = urls.length;

  const settle = useCallback((entry: SplatFixtureBridge["results"][number]) => {
    const bridge = fixtureBridge();
    bridge.results.push(entry);
    if (bridge.results.length >= expected) {
      bridge.status = bridge.results.every((r) => r.ok) ? "loaded" : "error";
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

  useEffect(() => {
    fixtureBridge();
  }, []);

  return (
    <>
      {urls.map((url, index) => (
        <SparkSplatLayer
          key={url}
          url={url}
          includeRendererHost={index === 0}
          onLoad={onLoad}
          onError={onError}
        />
      ))}
    </>
  );
}

export function SplatFixturePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const truthModeEnabled = isTruthModeUiEnabled(searchParams, import.meta.env.DEV);
  const splatUrls = useMemo(() => {
    const raw = searchParams.get("splatUrl");
    if (raw === null || raw.trim() === "") return null;
    return raw.split(",").map((u) => u.trim()).filter((u) => u !== "");
  }, [searchParams]);
  const truthSummary = useMemo(
    () => buildProceduralTruthSummary({
      surface: "spark_fixture",
      placedObjectCount: 0,
      measuredRuntimeAssetsLoaded: false,
    }),
    [],
  );

  return (
    <main style={{
      position: "fixed",
      inset: 0,
      background: "#101217",
      color: "#f7efe2",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 48, near: 0.1, far: 80, position: [0, 0.6, 3.4] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#101217"]} />
        <hemisphereLight args={["#fff4d8", "#30243a", 1.8]} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} />
        {splatUrls === null ? (
          <>
            <SparkTextSplat />
            <mesh position={[0, -0.85, -2.9]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.35, 1.38, 96]} />
              <meshBasicMaterial color="#6f5c3a" transparent opacity={0.6} side={FrontSide} />
            </mesh>
          </>
        ) : (
          <UrlSplatScene urls={splatUrls} />
        )}
        <OrbitControls
          enablePan={splatUrls !== null}
          minDistance={splatUrls === null ? 2.4 : 0.2}
          maxDistance={splatUrls === null ? 5.2 : 40}
          target={splatUrls === null ? [0, -0.1, -2.8] : [0, 0, 0]}
        />
      </Canvas>

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
      {truthModeEnabled && <TruthModeIndicator summary={truthSummary} />}
    </main>
  );
}
