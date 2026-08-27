import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense, lazy, type ReactElement } from "react";
import { useArrivalStore } from "../arrival-store.js";
import { ArrivalErrorBoundary } from "../ArrivalErrorBoundary.js";

// -----------------------------------------------------------------------------
// ArrivalErrorBoundary (Task 12b) — the last piece of the spec §6 armor.
//
// Every failure the arrival store can NAME arrives as data through a callback
// (a gate result, a tiles `load-error`, a `webglcontextlost` event) and needs
// no boundary. What had no armor is a failure that arrives as a THROWN
// EXCEPTION out of React's render or commit: `<Suspense fallback={null}>` —
// what FreshPage wraps the lazy ArrivalHero in — is not an error boundary, so
// such a throw reached the app root, and React 18's createRoot answers an
// uncaught render error by unmounting the ENTIRE root. FreshPage's static
// hero photo lives in that same root. The final describe block below proves
// that unguarded behaviour directly rather than asserting it.
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

// MUST STAY LAST IN THIS FILE. The render below deliberately lets an error
// escape React's act() queue, which leaves react-dom's internal executionContext
// dirty for the remainder of the module — every later render in the same file
// then fails with "Should not already be working." Hence its own hooks, no
// @testing-library cleanup(), and last position.
describe("ArrivalErrorBoundary — the control: what happens WITHOUT it", () => {
  it("PROOF the boundary is load-bearing: the same throw unguarded destroys the whole tree", () => {
    // Not a redundant control. It is the entire justification for this
    // component: React 18's createRoot unmounts the whole root on an uncaught
    // render error, so an unguarded ArrivalHero throw blanks FreshPage — the
    // hero photograph included. If a future React stops doing that, this test
    // failing is the signal that the justification changed.
    const spy = captureConsoleError();
    try {
      expect(() =>
        render(
          <div>
            <Photo />
            <Boom />
          </div>,
        ),
      ).toThrow("boom during render");
      expect(screen.queryByTestId("hero-photo")).toBeNull();
    } finally {
      spy.restore();
      document.body.innerHTML = "";
    }
  });
});
