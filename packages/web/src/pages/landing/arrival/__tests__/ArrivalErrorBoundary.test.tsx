import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, lazy, type ErrorInfo, type ReactElement } from "react";
import { useArrivalStore } from "../arrival-store.js";
import { ArrivalErrorBoundary } from "../ArrivalErrorBoundary.js";
import { AppErrorBoundary } from "../../../../error-boundary.js";

// The observability layer is mocked, not exercised: it lazily imports
// @sentry/react and no-ops without a DSN, so calling the real one would prove
// nothing and load a large chunk. Both boundaries in this file — the arrival
// one and the app-level control below — report through this same helper, so
// one mock covers both.
const captureBoundaryErrorMock = vi.hoisted(() =>
  vi.fn<(error: Error, info: ErrorInfo, boundary?: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
);

vi.mock("../../../../observability/sentry.js", () => ({
  captureBoundaryError: captureBoundaryErrorMock,
}));

// -----------------------------------------------------------------------------
// ArrivalErrorBoundary (Task 12b) — the last piece of the spec §6 armor.
//
// Every failure the arrival store can NAME arrives as data through a callback
// (a gate result, a tiles `load-error`, a `webglcontextlost` event) and needs
// no boundary. What had no armor is a failure that arrives as a THROWN
// EXCEPTION out of React's render or commit: `<Suspense fallback={null}>` —
// what FreshPage wraps the lazy ArrivalHero in — is not an error boundary, so
// such a throw travelled up to the app-level catcher, AppErrorBoundary, which
// main.tsx:71-73 mounts above the entire router (router.tsx has no
// errorElement). That boundary replaces its whole subtree — the homepage
// included, hero photograph and all — with a full-screen "Something went
// wrong / Reload Page" panel. The final describe block below proves that by
// mounting the REAL AppErrorBoundary around the same throw, rather than
// asserting it or measuring a bare React root this app does not have.
//
// SCOPE, stated precisely because over-claiming armor is worse than having
// none. Two throw sites are proven contained here:
//   1. render phase      — a component that throws while rendering
//   2. lazy() chunk load — a rejected dynamic import, re-thrown by Suspense.
//      Not hypothetical: FreshPage mounts ArrivalHero via `lazy(() =>
//      import(...))` (FreshPage.tsx:136-137), and a deploy that purges the
//      previous build's chunk hashes makes that import reject in any tab
//      still holding the old index.html.
// A throw from a passive effect (useEffect) is NOT asserted here. react-dom
// 18.3.1 does route it to the nearest boundary — `commitPassiveMountEffects_
// complete` wraps each fiber in try/catch and calls captureCommitPhaseError
// (node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/
// cjs/react-dom.development.js:24928-24932) — but under @testing-library's
// `act()` the error is rethrown out of flushActQueue before the boundary's
// error re-render can flush, so a unit test cannot observe the containment
// that production gets. A test that appeared to prove it would be proving
// the harness, not the behaviour. See task-12b-report.md.
//
// Async rejections are absent by design: an error boundary cannot catch them,
// and the invalid-key path — which IS async — never produces an unhandled one
// (measured; see the report). This boundary is not the invalid-key fix.
// -----------------------------------------------------------------------------

function Boom(): ReactElement {
  throw new Error("boom during render");
}

/** Stands in for FreshPage's `<picture>` — the thing that must survive. */
function Photo(): ReactElement {
  return <img data-testid="hero-photo" alt="" src="/hero.jpg" />;
}

/**
 * A hand-rolled console.error capture rather than vi.spyOn: spyOn's return
 * type only resolves through its overloads when the spied property is a
 * concrete function type, and `console.error`'s (...data: any[]) signature
 * collapses it to `any` — which the repo's strictTypeChecked lint rejects
 * outright (no-unsafe-call / no-unsafe-member-access). Six honest lines beat
 * a file full of suppressions.
 */
function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  /* eslint-disable no-console -- capturing the channel IS the assertion here */
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
  /* eslint-enable no-console */
}

/** Only OUR diagnostics — React logs caught boundary errors on the same
 *  channel, and counting those would make "exactly once" meaningless. */
function arrivalLogs(calls: readonly unknown[][]): unknown[][] {
  return calls.filter((args) => typeof args[0] === "string" && args[0].startsWith("Arrival:"));
}

describe("ArrivalErrorBoundary", () => {
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    useArrivalStore.getState().reset();
    captureBoundaryErrorMock.mockClear();
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    cleanup();
    consoleError.restore();
  });

  it("renders its children untouched when nothing throws", () => {
    render(
      <ArrivalErrorBoundary>
        <div data-testid="hero" />
      </ArrivalErrorBoundary>,
    );
    expect(screen.getByTestId("hero")).not.toBeNull();
    // No failure means no store write at all — the phase machine is untouched.
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(useArrivalStore.getState().failReason).toBeNull();
  });

  it("a render-phase throw leaves the photo standing and lands the store in fallback", () => {
    render(
      <div>
        <Photo />
        <ArrivalErrorBoundary>
          <Boom />
        </ArrivalErrorBoundary>
      </div>,
    );
    expect(screen.getByTestId("hero-photo")).not.toBeNull();
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("crash");
  });

  it("renders nothing at all in place of the crashed subtree", () => {
    const { container } = render(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("a failed lazy() chunk load is caught (stale index.html after a deploy)", async () => {
    const Missing = lazy(() =>
      Promise.reject(new Error("Failed to fetch dynamically imported module")),
    );
    render(
      <div>
        <Photo />
        <ArrivalErrorBoundary>
          <Suspense fallback={null}>
            <Missing />
          </Suspense>
        </ArrivalErrorBoundary>
      </div>,
    );
    await waitFor(() => {
      expect(useArrivalStore.getState().failReason).toBe("crash");
    });
    expect(screen.getByTestId("hero-photo")).not.toBeNull();
  });

  it("says why, exactly once, naming the hero and carrying the real error", () => {
    render(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );
    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    const [message, error] = ours[0] as [string, unknown];
    expect(message).toContain("static hero photo");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom during render");
  });

  it("reports the crash to the observability layer, tagged as its own boundary", () => {
    // The console line is for a developer with devtools open. In production
    // nobody has. Before this boundary existed, a hero throw reached
    // AppErrorBoundary and therefore Sentry (error-boundary.tsx:49); catching
    // it here without reporting would have silently deleted that signal for a
    // failure no visitor can see, because the photograph carries the page.
    render(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );

    expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1);
    const call = captureBoundaryErrorMock.mock.calls.at(0);
    if (call === undefined) throw new Error("expected an observability capture call");
    const [error, info, boundary] = call;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom during render");
    expect(info.componentStack).toContain("Boom");
    // Distinct from AppErrorBoundary's own tag: an operator must be able to
    // tell "the hero died, the homepage is fine" from "the app fell over".
    expect(boundary).toBe("ArrivalErrorBoundary");
  });

  it("does not report anything when nothing throws", () => {
    render(
      <ArrivalErrorBoundary>
        <div data-testid="hero" />
      </ArrivalErrorBoundary>,
    );
    expect(captureBoundaryErrorMock).not.toHaveBeenCalled();
  });

  it("stays down after a crash — a parent re-render does not retry the crashing child", () => {
    const { rerender } = render(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );
    expect(arrivalLogs(consoleError.calls)).toHaveLength(1);
    rerender(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );
    // Still one: the boundary does not re-mount a subtree that just threw, so
    // a crash cannot turn into a log-spamming render loop.
    expect(arrivalLogs(consoleError.calls)).toHaveLength(1);
  });

  it("does not overwrite an earlier, more specific fail reason", () => {
    // fail() is first-reason-wins (arrival-store.ts). A crash that happens
    // while an already-failed hero unwinds must not relabel it "crash".
    useArrivalStore.getState().fail("webgl");
    render(
      <ArrivalErrorBoundary>
        <Boom />
      </ArrivalErrorBoundary>,
    );
    expect(useArrivalStore.getState().failReason).toBe("webgl");
    expect(useArrivalStore.getState().phase).toBe("fallback");
  });
});

// The control. Its whole value is that it models THIS app's structure and not
// React in the abstract: AppErrorBoundary is the real component main.tsx:71-73
// wraps the router in, imported here rather than re-implemented, so if its
// behaviour or its copy ever changes this control changes with it.
describe("ArrivalErrorBoundary — the control: what happens WITHOUT it", () => {
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    useArrivalStore.getState().reset();
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    cleanup();
    consoleError.restore();
  });

  it("PROOF the boundary is load-bearing: unguarded, the same throw takes the WHOLE page to an error screen", () => {
    // Not a redundant control — it is the entire justification for this
    // component. Unguarded, a hero throw does not stop at the hero: it
    // reaches AppErrorBoundary at the app root (nothing sits between — see
    // the file header), which swaps its entire subtree for the full-screen
    // error panel. The homepage, and the hero photograph that is supposed to
    // be the fallback, are inside that subtree.
    render(
      <AppErrorBoundary>
        <div>
          <Photo />
          <Boom />
        </div>
      </AppErrorBoundary>,
    );

    // The photograph — the thing spec §6 promises can never break — is gone.
    expect(screen.queryByTestId("hero-photo")).toBeNull();
    // And what replaced it is the app's own "everything is broken" screen,
    // for a failure of a decoration the visitor never asked for.
    expect(screen.getByTestId("error-boundary-render")).not.toBeNull();
    expect(screen.getByText("Something went wrong")).not.toBeNull();
    expect(screen.getByText("Reload Page")).not.toBeNull();
  });

  it("and with the boundary, the same throw under the same app root leaves the page intact", () => {
    // The other half of the control: identical tree, identical throw, one
    // added wrapper. AppErrorBoundary never fires, so the page — and the
    // photograph — survive. This is the A/B that makes the claim above a
    // measurement rather than a story.
    render(
      <AppErrorBoundary>
        <div>
          <Photo />
          <ArrivalErrorBoundary>
            <Boom />
          </ArrivalErrorBoundary>
        </div>
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId("hero-photo")).not.toBeNull();
    expect(screen.queryByTestId("error-boundary-render")).toBeNull();
    expect(useArrivalStore.getState().failReason).toBe("crash");
  });
});
