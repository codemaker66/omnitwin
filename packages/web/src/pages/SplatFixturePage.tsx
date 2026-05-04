import { useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Color, FrontSide } from "three";
import { textSplats } from "@sparkjsdev/spark";
import { useSearchParams } from "react-router-dom";
import { TruthModeIndicator } from "../components/truth/TruthModeIndicator.js";
import {
  buildProceduralTruthSummary,
  isTruthModeUiEnabled,
} from "../lib/truth-mode-summary.js";

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

export function SplatFixturePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const truthModeEnabled = isTruthModeUiEnabled(searchParams, import.meta.env.DEV);
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
        <SparkTextSplat />
        <mesh position={[0, -0.85, -2.9]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.35, 1.38, 96]} />
          <meshBasicMaterial color="#6f5c3a" transparent opacity={0.6} side={FrontSide} />
        </mesh>
        <OrbitControls enablePan={false} minDistance={2.4} maxDistance={5.2} target={[0, -0.1, -2.8]} />
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
