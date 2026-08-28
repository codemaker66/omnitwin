import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ErrorInfo, ReactElement } from "react";
import { useArrivalStore } from "../arrival-store.js";

// -----------------------------------------------------------------------------
// arrival-frame-guard — containment for a throw inside a useFrame callback
// (branch review, "important").
//
// WHAT IS REAL HERE AND WHAT IS NOT, stated up front because this is exactly
// the kind of test that can be written to pass while proving nothing. The
// THROW is real (a genuine `throw` inside a genuine frame callback), the
// guard is real, the store is real, and the console channel is captured
// rather than faked. What is mocked is @react-three/fiber — as in every other
// suite in this directory, since happy-dom has no WebGL and no rAF loop — so
// the test drives the registered callback itself, which is precisely what
// R3F's loop does with it (`advance` calls each subscriber directly; see the
// guard module's header for why nothing in that path catches).
//
// The one thing a unit test CANNOT reproduce is R3F's real loop aborting
// mid-iteration and starving later subscribers — that is a property of the
// renderer, not of this code. What it can prove, and does below, is that the
// callback no longer throws OUT of the guard, which is the only precondition
// that abort has.
//
// The observability layer is mocked (the ArrivalErrorBoundary.test.tsx
// convention): the real helper lazily imports @sentry/react and no-ops
// without a DSN, so calling it would prove nothing and load a large chunk.
// -----------------------------------------------------------------------------

const captureBoundaryErrorMock = vi.hoisted(() =>
  vi.fn<(error: Error, info: ErrorInfo, boundary?: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
);
vi.mock("../../../../observability/sentry.js", () => ({
  captureBoundaryError: captureBoundaryErrorMock,
}));

const frameCallbacks: ((state: unknown, delta: number) => void)[] = [];
vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: (state: unknown, delta: number) => void): void => {
    frameCallbacks.push(callback);
  },
}));

const { useArrivalFrame } = await import("../arrival-frame-guard.js");

/** Hand-rolled rather than vi.spyOn: console.error's `(...data: any[])`
 *  signature collapses spyOn's return type to `any`, which this repo's
 *  strictTypeChecked lint rejects outright. */
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

function arrivalLogs(calls: readonly unknown[][]): unknown[][] {
  return calls.filter((args) => typeof args[0] === "string" && args[0].startsWith("Arrival:"));
}

const bodyCalls = vi.fn<(delta: number) => void>();

function ThrowingLoop({ thrown }: { readonly thrown: unknown }): ReactElement {
  useArrivalFrame("ExplodedHall", (_state, delta) => {
    bodyCalls(delta);
    throw thrown;
  });
  return <div data-testid="loop" />;
}

function HealthyLoop(): ReactElement {
  useArrivalFrame("FlightCamera", (_state, delta) => {
    bodyCalls(delta);
  });
  return <div data-testid="loop" />;
}

/** The most recently registered callback — real R3F replaces the subscription
 *  every render; this mock only appends. */
function latestFrame(): (state: unknown, delta: number) => void {
  const cb = frameCallbacks.at(-1);
  if (cb === undefined) {
    throw new Error("no useFrame callback registered");
  }
  return cb;
}

describe("useArrivalFrame", () => {
  let consoleError: { calls: unknown[][]; restore: () => void };

  beforeEach(() => {
    useArrivalStore.getState().reset();
    frameCallbacks.length = 0;
    bodyCalls.mockClear();
    captureBoundaryErrorMock.mockClear();
    consoleError = captureConsoleError();
  });

  afterEach(() => {
    cleanup();
    consoleError.restore();
  });

  it("passes state and delta straight through when nothing throws", () => {
    render(<HealthyLoop />);
    latestFrame()(undefined, 0.016);
    latestFrame()(undefined, 0.032);
    expect(bodyCalls.mock.calls).toEqual([[0.016], [0.032]]);
    // A healthy loop must not touch the phase machine at all.
    expect(useArrivalStore.getState().phase).toBe("loading");
    expect(arrivalLogs(consoleError.calls)).toHaveLength(0);
  });

  it("does not let the throw escape the frame callback", () => {
    // THE defect. Unguarded, this call throws out into R3F's rAF loop, which
    // has no catch: it aborts the frame mid-iteration, starving every
    // subscriber and every R3F root after it, and does it again next frame,
    // forever. React's error boundaries never see it.
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    expect(() => {
      latestFrame()(undefined, 0.016);
    }).not.toThrow();
    expect(bodyCalls).toHaveBeenCalledTimes(1); // it really did run, and really did throw
  });

  it("fails the hero to its own fallback, so the static photo carries the page", () => {
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    latestFrame()(undefined, 0.016);
    expect(useArrivalStore.getState().phase).toBe("fallback");
    expect(useArrivalStore.getState().failReason).toBe("frame-crash");
  });

  it("names its OWN reason, distinct from the render boundary's", () => {
    // Branch review round 2, "important": both this guard and
    // ArrivalErrorBoundary used to call fail("crash"), so once the photograph
    // had taken over, failReason could no longer say WHICH machine died —
    // R3F's rAF loop or React's render — even though the two have different
    // remedies. The Sentry tags were already distinct ("ArrivalFrameLoop" vs
    // "ArrivalErrorBoundary"); the store now agrees with them.
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    latestFrame()(undefined, 0.016);
    expect(useArrivalStore.getState().failReason).not.toBe("crash");
    expect(useArrivalStore.getState().failReason).toBe("frame-crash");
  });

  it("stops running the loop after the first throw, rather than throwing every frame", () => {
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    latestFrame()(undefined, 0.016);
    latestFrame()(undefined, 0.016);
    latestFrame()(undefined, 0.016);
    expect(bodyCalls).toHaveBeenCalledTimes(1);
  });

  it("says it once, in English, however many frames follow", () => {
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    latestFrame()(undefined, 0.016);
    latestFrame()(undefined, 0.016);

    const ours = arrivalLogs(consoleError.calls);
    expect(ours).toHaveLength(1);
    const [message, reported] = ours[0] as [string, unknown];
    // Names WHICH loop died — three of them exist, with different remedies.
    expect(message).toContain("ExplodedHall");
    // …says what happened to the page, so nobody hunts a broken homepage…
    expect(message).toContain("static hero photo");
    // …and that it will not be retried, so a single line is not read as a
    // sampled one.
    expect(message).toContain("not retried");
    // The error itself travels with the message, never instead of it.
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("boom in the frame loop");
  });

  it("reports to Sentry once, under its own boundary tag", () => {
    render(<ThrowingLoop thrown={new Error("boom in the frame loop")} />);
    latestFrame()(undefined, 0.016);
    latestFrame()(undefined, 0.016);

    expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1);
    const [error, info, boundary] = captureBoundaryErrorMock.mock.calls[0] as [
      Error,
      ErrorInfo,
      string,
    ];
    expect(error.message).toBe("boom in the frame loop");
    // A DISTINCT tag: "the hero's animation loop threw" and "the hero's
    // render threw" (ArrivalErrorBoundary) have different remedies and must
    // not merge into one Sentry issue.
    expect(boundary).toBe("ArrivalFrameLoop");
    expect(boundary).not.toBe("ArrivalErrorBoundary");
    // Which loop, again — the tag alone cannot say.
    expect(info.componentStack).toContain("ExplodedHall");
  });

  it("survives a non-Error throw without losing the payload", () => {
    // `throw "string"` and `throw undefined` are legal JavaScript, and a
    // vendored library is exactly where they turn up. Sentry wants an Error.
    render(<ThrowingLoop thrown="a bare string, thrown" />);
    latestFrame()(undefined, 0.016);

    expect(useArrivalStore.getState().failReason).toBe("frame-crash");
    const reported = captureBoundaryErrorMock.mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect(reported?.message).toBe("a bare string, thrown");
  });

  it("does not relabel an already-failed hero (first reason wins)", () => {
    // A tiles failure that is already unwinding must keep ITS reason — the
    // frame loop throwing on the way down is a symptom, not the cause.
    useArrivalStore.getState().fail("tiles");
    render(<ThrowingLoop thrown={new Error("boom during the unwind")} />);
    latestFrame()(undefined, 0.016);
    expect(useArrivalStore.getState().failReason).toBe("tiles");
    // …but it is still reported, never swallowed.
    expect(captureBoundaryErrorMock).toHaveBeenCalledTimes(1);
  });

  it("each loop is contained independently — one dying does not disable the others", () => {
    render(
      <>
        <ThrowingLoop thrown={new Error("boom in the frame loop")} />
        <HealthyLoop />
      </>,
    );
    const [throwing, healthy] = frameCallbacks as [
      (state: unknown, delta: number) => void,
      (state: unknown, delta: number) => void,
    ];
    throwing(undefined, 0.016);
    bodyCalls.mockClear();
    healthy(undefined, 0.05);
    expect(bodyCalls.mock.calls).toEqual([[0.05]]);
  });
});
