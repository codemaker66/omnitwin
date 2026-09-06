// -----------------------------------------------------------------------------
// plane-registry — how an SVG plane (drawn by code, provenance "Pr") plugs into
// the stage. A scene's art module exports a registry keyed by the manifest's
// `src` for each `kind: "svg"` plane; the stage renders the component inside
// the plane's parallax wrapper and passes it the live poke state so a chain can
// swing and a swallow can leave. The component must be pure over its props and
// must not read stores itself.
// -----------------------------------------------------------------------------
import type { ReactElement } from "react";
import type { PokeableState } from "../react/react-types.js";

export interface SvgPlaneProps {
  /** Per-prop poke state for this scene, keyed by prop id; absent means idle. */
  readonly pokes: Readonly<Record<string, PokeableState>>;
  /** The stage clock in ms (rAF-driven; frozen under reduced motion). */
  readonly nowMs: number;
  readonly reducedMotion: boolean;
  /** Run-persistent facts the plane may read (the persistence table in section 5). */
  readonly persisted: Readonly<Record<string, number | boolean>>;
  /** Viewport width in CSS px, so a plane can choose its phone crop. */
  readonly viewportWidth: number;
}

export type SvgPlaneComponent = (props: SvgPlaneProps) => ReactElement;

export type PlaneRegistry = Readonly<Record<string, SvgPlaneComponent>>;
