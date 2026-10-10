import { useEffect, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { NativeCanvas as Canvas } from "../components/scene/NativeCanvas.js";
import { GrandHallModel, type HallView } from "../components/grand-hall/GrandHallModel.js";
import { HALL_MOOD_NAMES, type HallMoodName } from "../components/grand-hall/hall-mood.js";
import { HallLightRig } from "../components/grand-hall/HallLightRig.js";
import { FULL_HALL_FINISH } from "../components/grand-hall/hall-finish.js";
import { CaptureToneMapping } from "../components/scene/CaptureToneMapping.js";

// Development fixture for the Grand Hall's real-time room: every mood and
// view on one page, with a window bridge so headless captures can pose the
// camera exactly, always in the full finish (a headless browser renders in
// software). Furniture is the planner's own (see /plan). Compiled out of
// production builds with the other fixtures.

interface LabPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov?: number;
}

declare global {
  interface Window {
    __hallLab?: {
      setMood: (mood: HallMoodName) => void;
      setView: (view: Exclude<HallView, "auto">) => void;
      setPose: (pose: LabPose) => void;
    };
  }
}

const POSES: Readonly<Record<Exclude<HallView, "auto">, LabPose>> = {
  plan: { position: [0, 26, 0.01], target: [0, 0, 0], fov: 42 },
  overview: { position: [13, 15, 15], target: [0, 1, 0], fov: 40 },
  walk: { position: [8.5, 1.6, 3.2], target: [-2, 3.2, -0.6], fov: 62 },
};

function PoseController({ pose }: { readonly pose: LabPose }): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    camera.position.set(...pose.position);
    if ("fov" in camera && pose.fov !== undefined) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(...pose.target);
    controls?.target?.set(...pose.target);
    controls?.update?.();
    invalidate();
  }, [camera, controls, invalidate, pose]);
  return null;
}

export function GrandHallLabPage(): ReactElement {
  const [mood, setMood] = useState<HallMoodName>("daylight");
  const [view, setView] = useState<Exclude<HallView, "auto">>("overview");
  const [pose, setPose] = useState<LabPose>(POSES.overview);

  useEffect(() => {
    window.__hallLab = {
      setMood,
      setView: (next) => { setView(next); setPose(POSES[next]); },
      setPose,
    };
    return () => { delete window.__hallLab; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d0b09" }}>
      <Canvas frameloop="demand" dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 40, near: 0.1, far: 200, position: [13, 15, 15] }}>
        <color attach="background" args={["#0d0b09"]} />
        <CaptureToneMapping captureShown={false} photographedRoom />
        <HallLightRig mood={mood} finish={FULL_HALL_FINISH} />
        <GrandHallModel mood={mood} view={view} finish={FULL_HALL_FINISH} />
        <OrbitControls makeDefault enableDamping target={[0, 1, 0]} />
        <PoseController pose={pose} />
      </Canvas>
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, fontFamily: "Inter, sans-serif" }}>
        {HALL_MOOD_NAMES.map((name) => (
          <button key={name} type="button" onClick={() => { setMood(name); }} aria-pressed={mood === name}>{name}</button>
        ))}
        {(["plan", "overview", "walk"] as const).map((name) => (
          <button key={name} type="button" onClick={() => { setView(name); setPose(POSES[name]); }} aria-pressed={view === name}>{name}</button>
        ))}
      </div>
    </div>
  );
}
