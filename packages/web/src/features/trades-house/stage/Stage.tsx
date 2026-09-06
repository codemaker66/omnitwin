import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import type { PokeGesture, PokeableState } from "../react/react-types.js";
import { DocumentFrame } from "./DocumentFrame.js";
import { LOOK_AT_REST, orientationToLook, pointerSpeed, pointerToLook } from "./parallax.js";
import { PlaneStack } from "./PlaneStack.js";
import type { PlaneRegistry } from "./plane-registry.js";
import { PointerLight, type PointerMotion } from "./PointerLight.js";
import { PropToolbar } from "./PropButton.js";
import { clientToStagePoint, hexToRgbTriplet, type StagePoint, type StageRect } from "./stage-geometry.js";
import type { SceneManifest, StageLight } from "./stage-manifest.js";
import { StageRuntimeContext, createStageRuntime, type StageRuntime } from "./stage-runtime.js";
import "./stage.css";

// -----------------------------------------------------------------------------
// Stage — the scene engine's root (Appendix A sections 2 and 5).
//
// A position: fixed; inset: 0 root, so it adds nothing to scrollHeight. In
// DOM order: the planes (aria-hidden), the light (aria-hidden), the document
// frame with the ledger margin, the narrative (the page's children, inside a
// wrapper that is height: 100dvh; overflow: clip), then the "In the room"
// toolbar of pokeables, so a screen reader hears scene, options, reply, then
// the things in the room. While mounted, `stage-mounted` on <html> sets
// overscroll-behavior-y: none on html and body (stage.css); the scene layer
// is touch-action: none.
//
// Input: one window pointermove listener publishes the pointer (for the
// light and the page's Lantern) and the look (for the parallax); on coarse
// pointers DeviceOrientation publishes the look instead. One rAF loop
// (stage-loop.ts) steps every spring and parks when they settle. Nothing
// here imports the instrument; the page passes the scene's title in.
// -----------------------------------------------------------------------------

export const STAGE_MOUNTED_CLASS = "stage-mounted";

export interface StageProps {
  readonly manifest: SceneManifest;
  readonly registry: PlaneRegistry;
  /** The tableau's lights, for the Lantern's water and for where the carried light rests. */
  readonly lights: readonly StageLight[];
  readonly pokes: Readonly<Record<string, PokeableState>>;
  readonly persisted: Readonly<Record<string, number | boolean>>;
  readonly reducedMotion: boolean;
  /** The scene line is playing: pokeables are inert and do not lift. */
  readonly speaking: boolean;
  /** The scene is on screen; false parks the loop and detaches the listeners. */
  readonly active: boolean;
  /** The last caption per prop id, shown beside the prop. */
  readonly captions: Readonly<Record<string, string>>;
  /** The Lantern component; mounts in the manifest's lantern plane. */
  readonly lanternSlot: ReactNode;
  /** The ceremony's LedgerStrip; mounts in the frame's left margin. */
  readonly ledgerSlot: ReactNode;
  /** The narrative: the Convener's frame, the options, the reply, the latch. */
  readonly children: ReactNode;
  /** A poke, with its point normalised 0..1 in stage space (the tableau). */
  readonly onPoke: (propId: string, gesture: PokeGesture, point: StagePoint) => void;
  /** The pointer in stage space and its speed in px/s, per pointermove. */
  readonly onPointerMotion?: (x: number, y: number, speed: number) => void;
  /**
   * The scene's name for the cartouche ("The River Gate"). The manifest has
   * no title and the stage never reads the instrument, so the page passes it.
   */
  readonly title?: string;
}

/** Where the carried light rests before the pointer arrives: the brightest practical, else the horizon's centre. */
export function restPointFor(lights: readonly StageLight[]): StagePoint {
  let best: StageLight | null = null;
  for (const light of lights) {
    if (best === null || light.intensity > best.intensity) best = light;
  }
  return best === null ? { x: 0.5, y: 0.58 } : { x: best.x, y: best.y };
}

function rectOf(element: HTMLElement | null): StageRect | null {
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

const FALLBACK_HUE_RGB = "227 155 58";

export function Stage({
  manifest, registry, lights, pokes, persisted, reducedMotion, speaking, active, captions,
  lanternSlot, ledgerSlot, children, onPoke, onPointerMotion, title,
}: StageProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const tableauRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StageRuntime | null>(null);
  runtimeRef.current ??= createStageRuntime({
    getRoot: () => rootRef.current,
    getTableauRect: () => rectOf(tableauRef.current),
  });
  const runtime = runtimeRef.current;
  const motionRef = useRef<PointerMotion>({ speed: 0 });
  const onPointerMotionRef = useRef(onPointerMotion);
  onPointerMotionRef.current = onPointerMotion;
  const restAt = useMemo(() => restPointFor(lights), [lights]);

  // ---- the html class: overscroll-behavior-y: none while the stage is up ----
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(STAGE_MOUNTED_CLASS);
    return () => { html.classList.remove(STAGE_MOUNTED_CLASS); };
  }, []);

  useEffect(() => () => { runtime.dispose(); }, [runtime]);

  // ---- the scene's one hue, for the light and the marks ----
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    root.style.setProperty("--stage-hue", manifest.hue);
    root.style.setProperty("--stage-hue-rgb", hexToRgbTriplet(manifest.hue) ?? FALLBACK_HUE_RGB);
  }, [manifest.hue]);

  // ---- the loop runs only while the scene is on screen and the tab visible ----
  useEffect(() => {
    const apply = (): void => { runtime.loop.setActive(active && !document.hidden); };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => { document.removeEventListener("visibilitychange", apply); };
  }, [active, runtime]);

  // ---- the pointer: one listener for the light, the look and the page ----
  useEffect(() => {
    if (!active) return undefined;
    let lastX = 0;
    let lastY = 0;
    let lastAt = 0;

    const onMove = (event: PointerEvent): void => {
      const now = performance.now();
      const speed = lastAt > 0 ? pointerSpeed(event.clientX - lastX, event.clientY - lastY, now - lastAt) : 0;
      lastX = event.clientX;
      lastY = event.clientY;
      lastAt = now;
      const rect = runtime.getTableauRect();
      const point = rect === null ? null : clientToStagePoint(event.clientX, event.clientY, rect);
      const x = point?.x ?? 0.5;
      const y = point?.y ?? 0.5;
      runtime.publishPointer({
        clientX: event.clientX,
        clientY: event.clientY,
        x,
        y,
        speed,
        fine: event.pointerType === "mouse" || event.pointerType === "pen",
      });
      const look = rect === null ? null : pointerToLook(event.clientX, event.clientY, rect);
      if (look !== null) runtime.publishLook(look, "pointer");
      onPointerMotionRef.current?.(x, y, speed);
    };

    const onLeave = (): void => {
      lastAt = 0;
      runtime.publishLook(LOOK_AT_REST, "rest");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [active, runtime]);

  // ---- the tilt: on coarse pointers the phone's hold is the look ----
  useEffect(() => {
    if (!active || !window.matchMedia("(pointer: coarse)").matches) return undefined;
    let restBeta: number | null = null;
    const onOrientation = (event: DeviceOrientationEvent): void => {
      if (event.gamma === null || event.beta === null) return;
      restBeta ??= event.beta;
      runtime.publishLook(orientationToLook(event.gamma, event.beta, restBeta), "orientation");
    };
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    return () => { window.removeEventListener("deviceorientation", onOrientation); };
  }, [active, runtime]);

  return (
    <StageRuntimeContext.Provider value={runtime}>
      <div
        ref={rootRef}
        className="stage-root"
        data-frame={manifest.frame}
        data-scene-index={manifest.sceneIndex}
        data-active={active ? "true" : "false"}
        data-speaking={speaking ? "true" : "false"}
        data-reduced-motion={reducedMotion ? "true" : "false"}
      >
        <div ref={tableauRef} className="stage-tableau">
          <PlaneStack
            planes={manifest.planes}
            registry={registry}
            pokes={pokes}
            persisted={persisted}
            reducedMotion={reducedMotion}
            active={active}
            lanternSlot={lanternSlot}
          />
          <PointerLight reducedMotion={reducedMotion} active={active} restAt={restAt} motionRef={motionRef} />
        </div>
        <DocumentFrame genre={manifest.frame} title={title} quarterDay={manifest.quarterDay} ledgerSlot={ledgerSlot} />
        <div className="stage-narrative">{children}</div>
        <PropToolbar
          props={manifest.props}
          pokes={pokes}
          captions={captions}
          speaking={speaking}
          reducedMotion={reducedMotion}
          onPoke={onPoke}
        />
      </div>
    </StageRuntimeContext.Provider>
  );
}
