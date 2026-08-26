import { useEffect, useRef, type ReactElement } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { googleTilesApiKey } from "./arrival-config.js";
import { useArrivalStore } from "./arrival-store.js";
import { GoogleTilesStage } from "./GoogleTilesStage.js";
import { ARRIVAL_RAIL, FLIGHT_DURATION_S, sampleRail } from "./camera-rail.js";
import "./arrival.css";

// -----------------------------------------------------------------------------
// ArrivalHero — the live hero canvas layered over /fresh's static hero photo
// (Arrival Task 5). Self-gating: with no Google Tiles API key configured, or
// once the arrival store has failed into "fallback" for any reason (no key,
// tile load error, lost WebGL context), this renders null and the static
// photo beneath simply carries the page (spec §6) — FreshPage never branches
// on this component's internal state.
//
// The store (Task 3) is the ONLY coupling to GoogleTilesStage (Task 4): that
// component self-drives tilesReady()/fail("tiles") on first-idle/load-error,
// so there is no readiness threshold to thread through here.
// -----------------------------------------------------------------------------

export const ARRIVAL_SKIP_LABEL = "Skip the flight";

/** Drives the camera along the rail while phase === "flight". */
function FlightCamera(): null {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const phase = useArrivalStore((s) => s.phase);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (phase !== "flight") {
      elapsed.current = 0;
      return;
    }
    elapsed.current += delta;
    const t = elapsed.current / FLIGHT_DURATION_S;
    const pose = sampleRail(ARRIVAL_RAIL, t);
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    if (t >= 1) {
      useArrivalStore.getState().flightDone();
    }
    invalidate();
  });

  // Held poses outside active flight. "loading" snaps to the rail's START
  // pose (t=0): GoogleTilesStage's first-idle readiness signal certifies
  // "everything requested for the START-POSE camera has loaded" (see that
  // component's header comment), so without this the tiles stream for R3F's
  // default camera (position.z=5, looking at the origin) instead — readiness
  // then certifies the wrong view, and when flight begins and the camera
  // snaps to the aerial start, those tiles may not be loaded yet. Arrived
  // and exploded hold the rail's FINAL pose (t=1; explode framing is Task
  // 10's).
  useEffect(() => {
    if (phase === "loading") {
      const pose = sampleRail(ARRIVAL_RAIL, 0);
      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      invalidate();
    } else if (phase === "arrived" || phase === "exploded") {
      const pose = sampleRail(ARRIVAL_RAIL, 1);
      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      invalidate();
    }
  }, [phase, camera, invalidate]);
  return null;
}

export function ArrivalHero(): ReactElement | null {
  const phase = useArrivalStore((s) => s.phase);
  const apiToken = googleTilesApiKey();

  useEffect(() => {
    if (apiToken === null) {
      useArrivalStore.getState().fail("no-key");
    }
  }, [apiToken]);

  if (apiToken === null || phase === "fallback") {
    return null; // the static hero photo beneath carries the page (spec §6)
  }

  const animating = phase === "flight";
  return (
    <div className="arrival-hero" data-arrival-phase={phase}>
      <Canvas
        className="arrival-canvas"
        frameloop={animating ? "always" : "demand"}
        dpr={[1, 2]}
        gl={{ powerPreference: "high-performance" }}
        camera={{ fov: 45, near: 1, far: 60000 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", () => {
            useArrivalStore.getState().fail("webgl");
          });
        }}
      >
        <GoogleTilesStage apiToken={apiToken} />
        <FlightCamera />
      </Canvas>
      {phase === "flight" && (
        <button
          type="button"
          className="arrival-skip"
          onClick={() => {
            useArrivalStore.getState().skip();
          }}
        >
          {ARRIVAL_SKIP_LABEL}
        </button>
      )}
    </div>
  );
}
