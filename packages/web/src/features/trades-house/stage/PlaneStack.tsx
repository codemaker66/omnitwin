import { memo, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import type { PokeableState } from "../react/react-types.js";
import { LOOK_AT_REST, parallaxOffset, parallaxTransform, type Look } from "./parallax.js";
import type { PlaneRegistry, SvgPlaneComponent } from "./plane-registry.js";
import type { Plane } from "./stage-manifest.js";
import { useStageRuntime } from "./stage-runtime.js";

// -----------------------------------------------------------------------------
// PlaneStack — the three to seven planes of a tableau, farthest first.
//
// Each plane sits in a wrapper the parallax moves by its depth: the horizon
// (depth 0) is fixed, the near bank (depth 1) slides the full 7 px against
// the look, on SPRING_PRESETS.camera (120/14), stepped in the stage's one
// loop, parking on isSpringSettled. Under reduced motion the look is applied
// directly: the lag goes, the following stays (direct mode, never off).
//
// The three kinds: "svg" is resolved through the scene's PlaneRegistry and
// receives the live poke state and the stage clock so a chain can swing and a
// swallow can leave; "lantern" is a slot the page fills with the Lantern
// component (its own canvas, its own aria-hidden); "image" is an <img> that
// decodes off the main thread. The clock is a React state stepped per frame
// while the scene is active and not reduced; it is frozen otherwise, as the
// registry contract says. Transforms never enter React state.
// -----------------------------------------------------------------------------

/** Planes sorted farthest (depth 0) to nearest (depth 1), stable for equal depths. */
export function orderPlanesByDepth(planes: readonly Plane[]): readonly Plane[] {
  return planes
    .map((plane, index) => ({ plane, index }))
    .sort((a, b) => a.plane.depth - b.plane.depth || a.index - b.index)
    .map(({ plane }) => plane);
}

/** Look units; 0.002 of the range is 0.014 px at full depth, below a device pixel. */
const LOOK_SETTLE_EPSILON = 0.002;

export interface PlaneStackProps {
  readonly planes: readonly Plane[];
  readonly registry: PlaneRegistry;
  readonly pokes: Readonly<Record<string, PokeableState>>;
  readonly persisted: Readonly<Record<string, number | boolean>>;
  readonly reducedMotion: boolean;
  readonly active: boolean;
  readonly lanternSlot: ReactNode;
}

interface SvgPlaneProps {
  readonly component: SvgPlaneComponent;
  readonly pokes: Readonly<Record<string, PokeableState>>;
  readonly nowMs: number;
  readonly reducedMotion: boolean;
  readonly persisted: Readonly<Record<string, number | boolean>>;
  readonly viewportWidth: number;
}

const SvgPlane = memo(function SvgPlane({
  component: Component, pokes, nowMs, reducedMotion, persisted, viewportWidth,
}: SvgPlaneProps): ReactElement {
  return (
    <Component
      pokes={pokes}
      nowMs={nowMs}
      reducedMotion={reducedMotion}
      persisted={persisted}
      viewportWidth={viewportWidth}
    />
  );
});

const ImagePlane = memo(function ImagePlane({ src }: { readonly src: string }): ReactElement {
  return <img className="stage-plane-image" src={src} alt="" decoding="async" draggable={false} />;
});

function readViewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export function PlaneStack({
  planes, registry, pokes, persisted, reducedMotion, active, lanternSlot,
}: PlaneStackProps): ReactElement {
  const runtime = useStageRuntime();
  const wrappersRef = useRef(new Map<string, HTMLDivElement>());
  const depthsRef = useRef(new Map<string, number>());
  const [nowMs, setNowMs] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);

  const ordered = orderPlanesByDepth(planes);
  depthsRef.current = new Map(ordered.map((plane) => [plane.id, plane.depth]));

  // ---- the stage clock the SVG planes read; frozen when reduced or inactive ----
  useEffect(() => {
    if (!active || reducedMotion) return undefined;
    const remove = runtime.loop.add((frameMs) => {
      setNowMs(frameMs);
      return true;
    });
    return remove;
  }, [active, reducedMotion, runtime]);

  // ---- the look: two springs on camera, written straight to the wrappers ----
  useEffect(() => {
    if (!active) return undefined;
    const lx: SpringState = { value: 0, velocity: 0 };
    const ly: SpringState = { value: 0, velocity: 0 };
    let target: Look = LOOK_AT_REST;
    let removeStep: (() => void) | null = null;

    const write = (look: Look): void => {
      for (const [id, wrapper] of wrappersRef.current) {
        const depth = depthsRef.current.get(id) ?? 0;
        wrapper.style.transform = parallaxTransform(parallaxOffset(depth, look));
      }
    };

    const step = (_nowMs: number, dt: number): boolean => {
      stepSpring(lx, target.lx, dt, SPRING_PRESETS.camera);
      stepSpring(ly, target.ly, dt, SPRING_PRESETS.camera);
      write({ lx: lx.value, ly: ly.value });
      if (isSpringSettled(lx, target.lx, LOOK_SETTLE_EPSILON) && isSpringSettled(ly, target.ly, LOOK_SETTLE_EPSILON)) {
        removeStep = null;
        return false;
      }
      return true;
    };

    const unsubscribe = runtime.onLook((look) => {
      target = look;
      if (reducedMotion) {
        // Direct mode: the planes sit where the look says, with no lag and no loop.
        lx.value = look.lx;
        ly.value = look.ly;
        lx.velocity = 0;
        ly.velocity = 0;
        write(look);
        return;
      }
      removeStep ??= runtime.loop.add(step);
    });

    write(LOOK_AT_REST);
    return () => {
      unsubscribe();
      if (removeStep !== null) removeStep();
    };
  }, [active, reducedMotion, runtime]);

  // ---- the phone crop is the plane's to choose; it needs the width ----
  useEffect(() => {
    const onResize = (): void => { setViewportWidth(readViewportWidth()); };
    window.addEventListener("resize", onResize, { passive: true });
    return () => { window.removeEventListener("resize", onResize); };
  }, []);

  const setWrapper = (id: string) => (element: HTMLDivElement | null): void => {
    if (element === null) wrappersRef.current.delete(id);
    else wrappersRef.current.set(id, element);
  };

  return (
    <div className="stage-planes" aria-hidden="true">
      {ordered.map((plane) => {
        const svgComponent = plane.kind === "svg" ? registry[plane.src] : undefined;
        return (
          <div
            key={plane.id}
            ref={setWrapper(plane.id)}
            className={`stage-plane stage-plane--${plane.kind}`}
            data-plane-id={plane.id}
            data-depth={plane.depth.toFixed(2)}
            data-missing={plane.kind === "svg" && svgComponent === undefined ? "true" : undefined}
          >
            {plane.kind === "lantern" ? lanternSlot : null}
            {plane.kind === "image" ? <ImagePlane src={plane.src} /> : null}
            {svgComponent !== undefined ? (
              <SvgPlane
                component={svgComponent}
                pokes={pokes}
                nowMs={nowMs}
                reducedMotion={reducedMotion}
                persisted={persisted}
                viewportWidth={viewportWidth}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
