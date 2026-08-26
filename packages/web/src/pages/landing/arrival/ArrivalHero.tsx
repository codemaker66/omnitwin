import { useEffect, useRef, type ReactElement } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate } from "react-router-dom";
import { googleTilesApiKey } from "./arrival-config.js";
import { useArrivalStore } from "./arrival-store.js";
import { useExplodeOverlayStore } from "./ExplodedHall.js";
import { GoogleTilesStage } from "./GoogleTilesStage.js";
import { HallHandoff, TRADES_HALL_TWIN_SLUG, tradesHallMeshUrl } from "./HallHandoff.js";
import { ARRIVAL_RAIL, FLIGHT_DURATION_S, sampleRail } from "./camera-rail.js";
import { preloadDollhouse } from "../../../twin/DollhouseStage.js";
import { useTwinManifest } from "../../../twin/useTwinManifest.js";
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
//
// HallHandoff (Task 7) mounts only for arrived/exploded — the reveal never
// competes with the flight for GPU budget. Its own useTwinManifest("trades-
// hall") call, though, would only start the manifest fetch once HallHandoff
// itself mounts (i.e. once already arrived) — too late to warm the heavy GLB.
// So this component ALSO calls useTwinManifest independently (a second, small
// JSON fetch is cheap; duplicating HallHandoff's own mesh-URL construction is
// not, hence the shared tradesHallMeshUrl helper) and preloads the GLB as
// early as possible — as soon as the manifest is ready, in EVERY phase except
// fallback (loading, flight, arrived, exploded), not flight-only. Flight-only
// warming left a cold-cache gap: reduced-motion visits go loading -> arrived
// directly, skipping flight entirely, and HallHandoff mounts at arrived
// regardless of whether flight ever ran — a flight-only trigger would never
// fire for those visitors (nor for anyone who Skips before the fetch
// finishes), so HallHandoff's own useGLTF would suspend against a cold 7 MB
// cache right when it mounts. HallHandoffMesh has its own Suspense boundary
// as a backstop for that case (see HallHandoff.tsx), but the real fix is
// starting the download as early as this component can possibly know to.
//
// The storey label/CTA layer (Task 10) reads useExplodeOverlayStore — a small
// store dedicated to bridging ExplodedHall's per-frame, camera-projected
// state out of the Canvas to this DOM overlay (ExplodedHall.tsx's own header
// justifies the choice of a zustand store over a lifted-callback or a
// ref-based imperative writer). This component only ever READS it: which
// labels to place where, and whether the explode spring is still moving —
// the latter widens `animating` past "flight" so the Canvas keeps rendering
// continuously while a storey is drifting, exactly like the flight sequence's
// own continuous-motion treatment, rather than depending on demand mode's
// invalidate-then-reschedule path for a motion this central to the page.
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
  const manifest = useTwinManifest(TRADES_HALL_TWIN_SLUG);
  const overlaySettled = useExplodeOverlayStore((s) => s.settled);
  const overlayLabels = useExplodeOverlayStore((s) => s.labels);
  const navigate = useNavigate();

  useEffect(() => {
    if (apiToken === null) {
      useArrivalStore.getState().fail("no-key");
    }
  }, [apiToken]);

  // Warm the dollhouse GLB as soon as possible so arrival never pops (Task 7,
  // Step 3; widened post-review — see the file header comment for why
  // flight-only warming left reduced-motion and early-Skip visitors cold).
  // Fires in every phase except fallback: re-runs on each phase transition
  // while the manifest stays ready (cheap — preloadDollhouse/useGLTF.preload
  // degrades to a safe no-op if the GLB is already cached or in flight), and
  // the manifest fetch itself starts the instant this component mounts.
  useEffect(() => {
    if (phase === "fallback" || manifest.state !== "ready") {
      return;
    }
    const meshUrl = tradesHallMeshUrl(manifest.manifest);
    if (meshUrl !== null) {
      preloadDollhouse(meshUrl);
    }
  }, [phase, manifest]);

  if (apiToken === null || phase === "fallback") {
    return null; // the static hero photo beneath carries the page (spec §6)
  }

  // "always" during flight (unchanged, Task 6) OR while the explode spring is
  // still moving (Task 10, Step 2) — a storey mid-drift is exactly the kind
  // of continuous, springed motion this codebase always runs at "always"
  // rather than leaning on demand mode's invalidate-then-reschedule path (see
  // the file header comment).
  const animating = phase === "flight" || !overlaySettled;
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
        {(phase === "arrived" || phase === "exploded") && <HallHandoff />}
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
      {/* Storey labels (Task 10): DOM, not drei <Html> — positioned every
          unsettled frame from ExplodedHall's overlay bridge. Gated on the
          overlay's OWN labels array rather than `phase === "exploded"`
          directly, so a label lingers, tracking, through the tail of a
          reassemble animation instead of vanishing the instant Close is
          clicked while the storeys are still visibly mid-flight together
          (ExplodedHall.tsx's LABEL_APPEAR_PROGRESS). */}
      {overlayLabels.length > 0 && (
        <div className="arrival-storeys">
          {overlayLabels.map((entry) => (
            <div
              key={entry.bucket}
              className="arrival-storey-label"
              data-arrival-storey={entry.bucket}
              style={{
                transform: `translate(${String(entry.xPx)}px, ${String(entry.yPx)}px) translate(-50%, -50%)`,
              }}
            >
              <button
                type="button"
                className="arrival-storey-name"
                onClick={() => {
                  // react-router-dom's NavigateFunction can return a Promise
                  // (view transitions); this click has nothing to await it against.
                  void navigate("/tour");
                }}
              >
                {entry.label}
              </button>
              <button
                type="button"
                className="arrival-storey-plan"
                onClick={() => {
                  void navigate("/plan");
                }}
              >
                Plan this room
              </button>
            </div>
          ))}
        </div>
      )}
      {phase === "exploded" && (
        <button
          type="button"
          className="arrival-explode-close"
          onClick={() => {
            useArrivalStore.getState().reassemble();
          }}
        >
          Close
        </button>
      )}
    </div>
  );
}
