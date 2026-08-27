import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureBoundaryError } from "../../../observability/sentry.js";
import { useArrivalStore } from "./arrival-store.js";

// -----------------------------------------------------------------------------
// ArrivalErrorBoundary (Task 12b) — the last piece of the spec §6 armor.
//
// Everything the arrival store can NAME arrives as data and is handled by a
// callback: the pre-Canvas gate returns "no-key"/"poster-tier"
// (use-arrival-gate.ts), GoogleTilesStage turns the tiles renderer's
// `load-error` into fail("tiles"), ArrivalHero turns `webglcontextlost` into
// fail("webgl"). None of those is a throw, and none of them needs a boundary.
//
// What DID have no armor is a failure that arrives as a thrown exception out
// of React's own render or commit. `<Suspense fallback={null}>` — which is
// what FreshPage wraps the lazy ArrivalHero in — is not an error boundary, so
// such a throw propagated up until something caught it. In THIS app the
// catcher is AppErrorBoundary, which main.tsx:71-73 mounts above the whole
// router (router.tsx defines no errorElement, so nothing sits between). Its
// answer to a render error is to replace its entire subtree — every route,
// the whole page — with a full-screen "Something went wrong / Reload Page"
// panel. FreshPage's static hero photograph is inside that subtree, so a
// decorative hero throwing would have taken the homepage down to an error
// screen: "the photo never breaks" would have broken with it. (React 18's
// createRoot does unmount the entire root on an error nothing catches, but
// that is not this app's path and was never what a visitor here would have
// seen — the outcome is an error screen, not a blank page. Corrected after
// review; the earlier comment named the wrong mechanism.)
// ArrivalErrorBoundary.test.tsx's final block proves the real unguarded
// outcome by mounting the real AppErrorBoundary around the same throw.
//
// THIS IS NOT THE INVALID-API-KEY FIX, and must not be mistaken for one. An
// invalid, revoked, restricted or over-quota key fails ASYNCHRONOUSLY — a
// rejected promise inside 3d-tiles-renderer's session-token handling — which
// no error boundary can see. That path is already armored, by the library
// catching its own rejection and dispatching `load-error`, which
// GoogleTilesStage turns into fail("tiles"); see task-12b-report.md for the
// measured evidence and GoogleTilesStage.tsx for the diagnostic it now logs.
// This boundary covers the disjoint, previously-unarmored SYNCHRONOUS class:
//   - a throw while rendering anything under the hero (R3F/three/vendored
//     tiles code constructing objects, a future refactor of ArrivalHero)
//   - a rejected `lazy()` chunk import, which Suspense re-throws — a real
//     production shape whenever a deploy purges chunk hashes an already-open
//     tab's index.html still points at
// Both are proven by ArrivalErrorBoundary.test.tsx. A throw from a passive
// effect (useEffect) also reaches a boundary in react-dom 18.3.1 — see
// commitPassiveMountEffects_complete's per-fiber try/catch calling
// captureCommitPhaseError, react-dom.development.js:24928-24932 — but that
// one is asserted from the library's source, not from a test, because
// @testing-library's act() rethrows such an error before the boundary's
// error re-render can flush. Stated rather than quietly claimed.
//
// Deliberately NOT resettable. MeshErrorBoundary and PlannerCanvasBoundary
// both offer a retry because a person can meaningfully ask for one (a
// corrected mesh URL, "try 3D again"). Here there is no one to ask: the hero
// is decoration the visitor never requested, the store's fail() is
// first-reason-wins and permanent for the visit, and re-mounting a subtree
// that just threw would most likely throw again — one clean fall back to the
// photograph is the whole intent.
// -----------------------------------------------------------------------------

interface ArrivalErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ArrivalErrorBoundaryState {
  readonly crashed: boolean;
}

export class ArrivalErrorBoundary extends Component<
  ArrivalErrorBoundaryProps,
  ArrivalErrorBoundaryState
> {
  constructor(props: ArrivalErrorBoundaryProps) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): ArrivalErrorBoundaryState {
    // Render phase: decide what to show. The store write belongs in
    // componentDidCatch — mutating external state during render is exactly
    // the thing React's render phase forbids.
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Report it where an operator can see it. This is not optional politeness:
    // before this boundary existed, a throw under the hero reached
    // AppErrorBoundary, whose componentDidCatch calls this same helper
    // (error-boundary.tsx:49) — so every such crash produced a Sentry event.
    // Catching it here and only console.error-ing would have DELETED that
    // signal in production, where nobody has devtools open, and this failure
    // is invisible by construction: the photograph carries the page, so no
    // visitor will ever report it. Tagged with its own boundary name so it
    // reads as "the hero died, the homepage is fine", not "the app fell
    // over". void: fire-and-forget, exactly as error-boundary.tsx does — the
    // helper is internally guarded (no DSN / failed init → it returns without
    // throwing) and a monitoring hiccup must never become a second crash
    // inside a crash handler.
    void captureBoundaryError(error, info, "ArrivalErrorBoundary");

    // Say it once, and say it plainly. Swallowing a crash silently would make
    // this boundary indistinguishable from the bug it exists to contain.
    // eslint-disable-next-line no-console
    console.error(
      "Arrival: the hero flight crashed and has been removed — the static hero photo is " +
        "carrying the page. The rest of the homepage is unaffected. Component stack:" +
        (info.componentStack ?? " (unavailable)"),
      error,
    );
    // First reason wins (arrival-store.ts), so a crash that happens while an
    // already-failed hero is unwinding leaves the original, more specific
    // reason in place rather than relabelling it.
    useArrivalStore.getState().fail("crash");
  }

  override render(): ReactNode {
    // null, not a fallback element: the photograph beneath is the fallback,
    // and it is already on the page.
    return this.state.crashed ? null : this.props.children;
  }
}
