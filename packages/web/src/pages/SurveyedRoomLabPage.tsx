import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { NativeCanvas as Canvas } from "../components/scene/NativeCanvas.js";
import { CaptureToneMapping } from "../components/scene/CaptureToneMapping.js";
import { PlannerRenderPipeline } from "../components/scene/PlannerRenderPipeline.js";
import { ActivityStatus } from "../components/shared/Activity.js";
import { SurveyedRoomModel, type SurveyedRoomPhotoProgress } from "../components/surveyed-room/SurveyedRoomModel.js";
import { parseRoomLabQuery, resolveRoomPose, ROOM_POSE_NAMES, type RoomPose } from "../components/surveyed-room/room-lab.js";
import { useSurveyedRoom, type SurveyedRoomFailure, type SurveyedRoomState } from "../components/surveyed-room/use-surveyed-room.js";
import { nativePrecompilePending } from "../lib/native-precompile.js";
import { getNativeRenderer } from "../lib/native-renderer.js";
import { readRenderDeviceContext, selectRenderProfile } from "../lib/render-quality.js";

// Development fixture for one surveyed room, drawn by the room-driven path
// (components/surveyed-room) from a public folder:
//
//   /dev/surveyed-room?base=/rooms/saloon/survey-2026-07-11&r=1
//
// `base` is the survey's folder and `r` its revision (1 when left out);
// `photos=half` or `photos=full` takes that size of the photographs whatever
// the device. The room is drawn through the planner's own pipeline for this
// device (`?render=phone|tablet|desktop|office|off` to choose, `?pipeline=ao`
// to look at the occlusion alone), so what is seen here is what the planner's
// passes make of the room's materials. A window bridge poses the camera and
// sets the grade for headless captures (scripts/surveyed-room-lab.mjs).
// Compiled out of production builds with the other fixtures.

/** What a capture script can read of the page's state. */
interface RoomLabStatus {
  readonly status: SurveyedRoomState["status"];
  /** Why the room could not be loaded, once it has failed. */
  readonly failure: SurveyedRoomFailure | null;
  readonly photos: SurveyedRoomPhotoProgress | null;
  /** The record's wall ids, in order: a wall's index or id is a pose. */
  readonly walls: readonly string[];
}

declare global {
  interface Window {
    __roomLab?: {
      /** True once the room is drawn, every photograph has arrived or failed, and nothing is still compiling. */
      ready: () => boolean;
      status: () => RoomLabStatus;
      /** Poses the camera: a named pose, a wall's index or id, or a position and target. False when it is none of them. */
      setPose: (pose: string | number | RoomPose) => boolean;
      exposure: () => number;
      setExposure: (exposure: number) => void;
      setGlow: (glow: number) => void;
    };
  }
}

const GROUND = "#0d0b09";
const INK = "#e8e4dc";

function PoseController({ pose }: { readonly pose: RoomPose | null }): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (pose === null) return;
    camera.position.set(...pose.position);
    if ("fov" in camera) {
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

/** Hands the canvas's renderer to the page, for the bridge's `ready`. */
function RendererProbe({ onRenderer }: { readonly onRenderer: (renderer: object | null) => void }): null {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    onRenderer(gl);
    return () => { onRenderer(null); };
  }, [gl, onRenderer]);
  return null;
}

/** What the page is doing, in words, with a measured share where there is one. */
function working(state: SurveyedRoomState, photos: SurveyedRoomPhotoProgress | null): { readonly label: string; readonly progress?: number } | null {
  if (state.status === "loading") {
    if (state.expected === null) return { label: "Reading the survey…" };
    return { label: `Reading the survey: ${String(state.settled)} of ${String(state.expected)} files`, progress: (state.settled / state.expected) * 100 };
  }
  if (state.status !== "ready") return null;
  const name = state.room.record.room.name;
  if (photos === null) return { label: `Loading the ${name}'s photographs…` };
  if (photos.settled >= photos.expected) return null;
  return {
    label: `Loading the ${name}'s photographs: ${String(photos.settled)} of ${String(photos.expected)}`,
    progress: (photos.settled / photos.expected) * 100,
  };
}

export function SurveyedRoomLabPage(): ReactElement {
  const [query] = useState(() => parseRoomLabQuery(window.location.search));
  const state = useSurveyedRoom(query.entry);
  const [photos, setPhotos] = useState<SurveyedRoomPhotoProgress | null>(null);
  const [pose, setPose] = useState<RoomPose | null>(null);
  const [exposure, setExposure] = useState(1);
  const [glow, setGlow] = useState(1);
  const grade = useMemo(() => ({ exposure, glow }), [exposure, glow]);
  const profile = useMemo(() => selectRenderProfile(readRenderDeviceContext(import.meta.env.DEV)), []);
  const renderer = useRef<object | null>(null);
  const [onRenderer] = useState(() => (value: object | null): void => { renderer.current = value; });

  const room = state.status === "ready" ? state.room : null;
  const wallIds = useMemo(() => (room === null ? [] : room.record.walls.map((wall) => wall.id)), [room]);
  const poseFor = useMemo(() => (asked: string | number): RoomPose | null => (
    room === null ? null : resolveRoomPose(room.frame, room.record.room.ceilingHeight, wallIds, asked)
  ), [room, wallIds]);

  // The room opens on its overview.
  useEffect(() => {
    if (room !== null) setPose(poseFor("overview"));
  }, [poseFor, room]);

  // The bridge reads the page as it is now, not as it was when installed.
  const latest = useRef({ state, photos, pose, exposure, wallIds, poseFor });
  useEffect(() => { latest.current = { state, photos, pose, exposure, wallIds, poseFor }; });

  useEffect(() => {
    window.__roomLab = {
      ready: () => {
        const now = latest.current;
        const native = renderer.current === null ? null : getNativeRenderer(renderer.current);
        return now.state.status === "ready" && now.pose !== null
          && now.photos !== null && now.photos.settled >= now.photos.expected
          && native !== null && !nativePrecompilePending(native);
      },
      status: () => {
        const now = latest.current;
        return {
          status: now.state.status,
          failure: now.state.status === "failed" ? now.state.failure : null,
          photos: now.photos,
          walls: now.wallIds,
        };
      },
      setPose: (asked) => {
        const next = typeof asked === "object" ? asked : latest.current.poseFor(asked);
        if (next === null) return false;
        setPose(next);
        return true;
      },
      exposure: () => latest.current.exposure,
      setExposure,
      setGlow,
    };
    return () => { delete window.__roomLab; };
  }, []);

  const work = working(state, photos);
  const failedPhotos = photos !== null && photos.settled >= photos.expected ? photos.failed : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: GROUND, color: INK, fontFamily: "Inter, sans-serif", fontSize: 13 }}>
      <Canvas frameloop="demand" dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 40, near: 0.1, far: 200, position: [13, 15, 15] }}>
        <color attach="background" args={[GROUND]} />
        <CaptureToneMapping captureShown={false} photographedRoom />
        <PlannerRenderPipeline enabled profile={profile} />
        <RendererProbe onRenderer={onRenderer} />
        {room !== null && (
          <SurveyedRoomModel room={room} grade={grade} onPhotoProgress={setPhotos} photoQuality={query.photoQuality ?? undefined} />
        )}
        <OrbitControls makeDefault enableDamping target={[0, 1, 0]} />
        <PoseController pose={pose} />
      </Canvas>

      {room !== null && (
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {ROOM_POSE_NAMES.map((name) => (
            <button key={name} type="button" onClick={() => { setPose(poseFor(name)); }}>{name}</button>
          ))}
          {wallIds.map((id, index) => (
            <button key={id} type="button" title={id} onClick={() => { setPose(poseFor(index)); }}>{`wall ${String(index)}`}</button>
          ))}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Exposure
            <input type="range" min={0.1} max={2} step={0.05} value={exposure} onChange={(event) => { setExposure(Number(event.target.value)); }} />
            {exposure.toFixed(2)}
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Glass glow
            <input type="range" min={0} max={4} step={0.05} value={glow} onChange={(event) => { setGlow(Number(event.target.value)); }} />
            {glow.toFixed(2)}
          </label>
        </div>
      )}

      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", padding: 24, textAlign: "center" }}>
        {work !== null && <ActivityStatus variant="panel" progress={work.progress}>{work.label}</ActivityStatus>}
        {query.problem !== null && <p role="status" style={{ maxWidth: 560 }}>{query.problem}</p>}
        {state.status === "failed" && (
          <div role="alert" style={{ maxWidth: 640 }}>
            <p>The surveyed room could not be loaded.</p>
            <p>{`${state.failure.file} (${state.failure.reason}): ${state.failure.detail}`}</p>
          </div>
        )}
      </div>

      {failedPhotos.length > 0 && (
        <p role="status" style={{ position: "absolute", left: 12, bottom: 12, margin: 0 }}>
          {`${String(failedPhotos.length)} of ${String(photos?.expected ?? 0)} photographs could not be loaded (${failedPhotos.join(", ")}): those surfaces are drawn in a plain tone.`}
        </p>
      )}
    </div>
  );
}
