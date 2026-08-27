import { useEffect, useRef, useState, type ReactElement } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate } from "react-router-dom";
import { googleTilesApiKey } from "./arrival-config.js";
import { useArrivalStore, type ArrivalPhase } from "./arrival-store.js";
import { useArrivalGate } from "./use-arrival-gate.js";
import { useExplodeOverlayStore } from "./explode-overlay-store.js";
import { GoogleTilesStage } from "./GoogleTilesStage.js";
import { HallHandoff, TRADES_HALL_TWIN_SLUG, tradesHallMeshUrl } from "./HallHandoff.js";
import { ARRIVAL_RAIL, FLIGHT_DURATION_S, sampleRail } from "./camera-rail.js";
import { preloadDollhouse } from "../../../twin/DollhouseStage.js";
import { prefersReducedMotion } from "../../../twin/reduced-motion.js";
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
// THE STOREY LABEL/CTA LAYER (Task 10) IS SPLIT ACROSS TWO SUBSCRIPTIONS ON
// PURPOSE (review round 1). explode-overlay-store.ts bridges ExplodedHall's
// per-frame, camera-projected state out of the Canvas; the naive approach —
// ArrivalHero itself subscribing to BOTH `settled` and `labels` — looks
// cheap ("just re-rendering a handful of divs") but is not: ArrivalHero
// renders the entire <Canvas> subtree (GoogleTilesStage, FlightCamera,
// HallHandoff) as its own JSX children, and React re-evaluates a component's
// whole returned tree on every one of ITS re-renders — Canvas children are
// fresh element objects each render and none of them are React.memo'd — so a
// `labels` write firing ~60 times a second while a storey drifts would mean
// ~60 full re-renders of the hero scene per second, not a cheap DOM update.
// So ArrivalHero subscribes ONLY to `settled` (flips at most twice per
// explode/reassemble cycle, purely to widen `animating` below); the `labels`
// subscription lives in StoreyLabels, a leaf component rendered as a Canvas
// SIBLING with nothing under it but plain DOM. StoreyLabels re-rendering at
// frame rate is genuinely cheap — a handful of positioned divs and buttons —
// and it structurally cannot cause the Canvas subtree to redo anything.
//
// FALLBACK ARMOR (Task 12) replaces the old "apiToken === null" ad hoc check
// with useArrivalGate() — the single pre-Canvas gate covering BOTH no-key and
// poster-tier device. Tasks 4/5 already wired fail("tiles") (GoogleTilesStage
// load-error) and fail("webgl") (onCreated's webglcontextlost listener,
// below) — those stay untouched; this task only adds the gate itself, plus a
// fade for the case the plain "return null" always handled badly: a failure
// arriving WHILE the canvas was already showing something (spec §6 "holds
// briefly, then fades", not an abrupt cut). The two fallback cases are
// distinguished by a fact only THIS component instance's own render history
// can answer — never rendered the canvas at all (no-key/poster-tier decided
// before <Canvas> ever mounts; also a fresh remount landing directly in an
// already-"fallback" store) versus was actively rendering it when fail() hit
// (tiles/webgl, which can only ever fire from callbacks wired INSIDE an
// already-mounted Canvas) — hence hasShownCanvasRef, a ref flipped by an
// effect (never during render itself, so a discarded/speculative render can
// never mark it), not derived from `failReason`'s value.
// -----------------------------------------------------------------------------

export const ARRIVAL_SKIP_LABEL = "Skip the flight";

/** The spec's own invitation copy (Act II) — the only way to explode the
 *  Hall that does not require a canvas raycast, so keyboard/AT visitors can
 *  reach it too. The 3D click (ExplodedHall's handleChunkClick) stays as an
 *  additional, redundant path — this does not replace it. */
export const ARRIVAL_OPEN_HALL_LABEL = "Open the Hall";

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

/**
 * Storey labels (Task 10): DOM, not drei <Html> — positioned every unsettled
 * frame from ExplodedHall's overlay bridge, PLUS the "Close" control.
 *
 * A LEAF component, deliberately: it is the ONLY thing in ArrivalHero's tree
 * subscribed to `labels`, so it is the only thing that re-renders on every
 * unsettled frame — see the file header for why that separation matters. It
 * owns its own `useNavigate()` rather than receiving one as a prop, since it
 * has no other reason to couple to its parent's render.
 *
 * Gated on the overlay's OWN labels array rather than `phase === "exploded"`
 * directly, so a label lingers, tracking, through the tail of a reassemble
 * animation instead of vanishing the instant Close is clicked while the
 * storeys are still visibly mid-flight together (ExplodedHall.tsx's
 * LABEL_APPEAR_PROGRESS). "Close" itself is gated on phase directly — it is
 * not a per-frame value, so reading it here does not reintroduce the cost
 * this component exists to avoid.
 */
function StoreyLabels(): ReactElement | null {
  const labels = useExplodeOverlayStore((s) => s.labels);
  const phase = useArrivalStore((s) => s.phase);
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus handoff (Task 12 bundled a11y fix): "Open the Hall" (ArrivalHero)
  // unmounts the instant explode() fires, dropping focus to <body> — without
  // this, a keyboard/AT visitor would have to Tab in from the top of the
  // page to reach anything in the newly-exploded view. ArrivalHero's own
  // effect owns the symmetric reassemble -> "Open the Hall" direction, since
  // Close only ever exists here. By the time this effect body runs (after
  // commit), the ref is already attached — Close is unconditional on
  // `phase === "exploded"`, the same guard this effect uses.
  useEffect(() => {
    if (phase === "exploded") {
      closeRef.current?.focus();
    }
  }, [phase]);

  if (labels.length === 0 && phase !== "exploded") {
    return null;
  }

  return (
    <>
      {labels.length > 0 && (
        <div className="arrival-storeys">
          {labels.map((entry) => (
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
                aria-label={`Plan ${entry.label}`}
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
          ref={closeRef}
          type="button"
          className="arrival-explode-close"
          onClick={() => {
            useArrivalStore.getState().reassemble();
          }}
        >
          Close
        </button>
      )}
    </>
  );
}

export function ArrivalHero(): ReactElement | null {
  const phase = useArrivalStore((s) => s.phase);
  const { blocked } = useArrivalGate();
  const apiToken = googleTilesApiKey();
  const manifest = useTwinManifest(TRADES_HALL_TWIN_SLUG);
  const overlaySettled = useExplodeOverlayStore((s) => s.settled);

  // Fallback armor (Task 12). hasShownCanvasRef answers "has THIS component
  // instance's own render history ever actually shown the canvas" — written
  // only from an effect below (never during render itself, so a discarded or
  // speculative render can never mark it falsely true), read synchronously
  // during render to pick between the two fallback shapes further down.
  // fadedOut flips once the 300ms opacity transition genuinely completes, or
  // — under reduced motion, where a 0-duration transition is not guaranteed
  // to fire transitionend at all — immediately, from the same effect.
  const hasShownCanvasRef = useRef(false);
  const [fadedOut, setFadedOut] = useState(false);
  // The phase as of the PREVIOUS render, so "arrived, having just come FROM
  // exploded" (a reassemble) can be told apart from "arrived, having just
  // come from flight/loading" (a normal arrival, or Skip) — only the former
  // hands focus back to "Open the Hall" (Task 12 bundled a11y fix; the
  // explode direction is StoreyLabels' own symmetric effect).
  const previousPhaseRef = useRef<ArrivalPhase>(phase);
  const openHallRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (blocked !== null) {
      useArrivalStore.getState().fail(blocked);
    }
  }, [blocked]);

  useEffect(() => {
    if (phase === "fallback") {
      if (hasShownCanvasRef.current && prefersReducedMotion()) {
        setFadedOut(true);
      }
    } else {
      setFadedOut(false);
      if (blocked === null) {
        hasShownCanvasRef.current = true;
      }
    }
  }, [phase, blocked]);

  useEffect(() => {
    if (phase === "arrived" && previousPhaseRef.current === "exploded") {
      openHallRef.current?.focus();
    }
    previousPhaseRef.current = phase;
  }, [phase]);

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

  if (blocked !== null || apiToken === null) {
    // Never shown the canvas at all this instance — no-key/poster-tier is
    // decided before <Canvas> ever mounts (or the fail effect above simply
    // hasn't committed yet, on this very first render) — so there is nothing
    // to fade FROM (spec §6). `apiToken === null` can never actually be true
    // here at runtime without `blocked` already being non-null too — both
    // read the same googleTilesApiKey() — but stating it lets TypeScript
    // narrow `apiToken` to string below, rather than asserting the
    // invariant with a cast.
    return null;
  }

  const inFallback = phase === "fallback";
  if (inFallback && (!hasShownCanvasRef.current || fadedOut)) {
    // Either this instance landed in fallback without ever having shown a
    // canvas (a fresh mount/remount that inherits an already-failed store —
    // the OTHER never-rendered case, distinct from the blocked check above),
    // or the fade genuinely finished. Either way: fully gone, same as the
    // pre-Task-12 behaviour.
    return null; // the static hero photo beneath carries the page (spec §6)
  }

  // "always" during flight (unchanged, Task 6) OR while the explode spring is
  // still moving (Task 10, Step 2) — a storey mid-drift is exactly the kind
  // of continuous, springed motion this codebase always runs at "always"
  // rather than leaning on demand mode's invalidate-then-reschedule path (see
  // the file header comment). This is the ONLY thing ArrivalHero reads from
  // the overlay store — see StoreyLabels for the per-frame `labels` read.
  const animating = phase === "flight" || !overlaySettled;
  return (
    <div
      className="arrival-hero"
      data-arrival-phase={phase}
      onTransitionEnd={(event) => {
        // Spec §6's fade completing (the CSS rule lives in arrival.css,
        // keyed on this same [data-arrival-phase="fallback"]). Gated on the
        // property name so a future, unrelated transition on this element
        // could never trigger an early unmount by accident.
        if (phase === "fallback" && event.propertyName === "opacity") {
          setFadedOut(true);
        }
      }}
    >
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
      {phase === "arrived" && (
        <button
          ref={openHallRef}
          type="button"
          className="arrival-open-hall"
          onClick={() => {
            useArrivalStore.getState().explode();
          }}
        >
          {ARRIVAL_OPEN_HALL_LABEL}
        </button>
      )}
      <StoreyLabels />
    </div>
  );
}
