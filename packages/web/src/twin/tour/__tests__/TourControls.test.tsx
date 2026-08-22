import { useRef, useState, type ReactElement } from "react";
import type { TwinNavEdge } from "@omnitwin/types";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_DISPLAY_NAMES } from "../../shell/twin-rooms.js";
import { TourControls } from "../TourControls.js";
import {
  TOUR_ENDED_NOTE,
  TOUR_GROUP_LABEL,
  TOUR_NEXT_LABEL,
  TOUR_PAUSED_NOTE,
  TOUR_PAUSE_LABEL,
  TOUR_PLAY_LABEL,
  TOUR_PREVIOUS_LABEL,
  TOUR_REPLAY_LABEL,
  tourStopLabel,
} from "../tour-copy.js";
import { DEFAULT_DWELL_MS, buildDefaultTour, type TourLeg, type TourStop } from "../tour-model.js";

// -----------------------------------------------------------------------------
// TourControls — the player, tested the way it is used.
//
// Pure DOM under happy-dom: this component imports nothing from R3F, which is
// itself part of the design — the player is HUD, not scene. What it DOES have is
// a host contract (currentNodeId / travelling in, onGoToStop out), and the tests
// below drive that contract through a small stand-in host rather than asserting
// on props in isolation. The bugs worth catching here are all timing bugs across
// that boundary — a dwell that starts before the walk arrives, a journey
// re-issued on every frame of the route it asked for, a resumed clock that
// inherited the previous stop's remainder — and none of them are visible from a
// single render.
//
// The interruption suite is the one that matters most. A tour that keeps moving
// the camera after the visitor has grabbed it is worse than no tour, and the
// failure mode of a naive fix is equally bad: pausing on the press of Next.
// -----------------------------------------------------------------------------

/** The same synthetic topology tour-model.test.ts uses:
 *  scan_126 — hall_a — scan_058 — scan_028 — scan_046 — hall_b — scan_105 */
const EDGES: readonly TwinNavEdge[] = [
  { a: "scan_126", b: "hall_a", distanceM: 2 },
  { a: "hall_a", b: "scan_058", distanceM: 2 },
  { a: "scan_058", b: "scan_028", distanceM: 3 },
  { a: "scan_028", b: "scan_046", distanceM: 8 },
  { a: "scan_046", b: "hall_b", distanceM: 2 },
  { a: "hall_b", b: "scan_105", distanceM: 2 },
];

/** How long the stand-in host pretends a journey takes. Any value works; a round
 *  number well under the dwell keeps the arithmetic in the assertions readable. */
const TRAVEL_MS = 300;

const TOUR = buildDefaultTour();

/**
 * Pin the motion preference rather than inheriting happy-dom's default. The
 * house idiom, lifted from RoomDossier.test.tsx.
 *
 * Both settings are stubbed explicitly, never just the `true` one: a motion
 * assertion that silently depended on the environment answering "no preference"
 * would go green for the wrong reason the day that default changed.
 */
function stubReducedMotion(matches: boolean): void {
  const factory = (query: string): MediaQueryList => {
    const narrow: Pick<MediaQueryList, "matches" | "media"> = { matches, media: query };
    const widened: unknown = narrow;
    return widened as MediaQueryList;
  };
  vi.stubGlobal("matchMedia", factory);
}

interface HostProps {
  readonly startAt?: string;
  readonly onGoToStop?: (stop: TourStop, leg: TourLeg) => void;
  readonly onPlayingChange?: (playing: boolean) => void;
  readonly onEnded?: () => void;
  readonly loop?: boolean;
}

/**
 * A stand-in for TwinViewer: it holds the walk's position, reports `travelling`
 * while a journey is in flight, and arrives TRAVEL_MS later.
 *
 * Deliberately the smallest thing that honours the real contract, so a test
 * passing here is a statement about the contract rather than about a fixture. It
 * also re-renders on a timer, which is what makes the "one journey per stop"
 * guarantee testable at all: a player that re-issued travel on every parent
 * render would issue several per stop here.
 */
function TourHost({
  startAt = "scan_126",
  onGoToStop,
  onPlayingChange,
  onEnded,
  loop,
}: HostProps): ReactElement {
  const [nodeId, setNodeId] = useState(startAt);
  const [travelling, setTravelling] = useState(false);
  const timerRef = useRef<number | null>(null);

  return (
    <TourControls
      tour={TOUR}
      currentNodeId={nodeId}
      travelling={travelling}
      edges={EDGES}
      loop={loop}
      onPlayingChange={onPlayingChange}
      onEnded={onEnded}
      onGoToStop={(stop, leg) => {
        onGoToStop?.(stop, leg);
        if (leg.mode === "stay") {
          return;
        }
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        setTravelling(true);
        timerRef.current = window.setTimeout(() => {
          setNodeId(leg.nodeId);
          setTravelling(false);
        }, TRAVEL_MS);
      }}
    />
  );
}

/** Advance the clock inside act(), so the state the timers set is flushed before
 *  anything is asserted. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** One whole stop: travel out, then stand there for the full dwell. */
function playOneStop(): void {
  tick(TRAVEL_MS);
  tick(DEFAULT_DWELL_MS);
}

function play(): void {
  fireEvent.click(screen.getByRole("button", { name: TOUR_PLAY_LABEL }));
}

function caption(): string {
  const node = document.querySelector(".vv-twin-tour-caption");
  return node?.textContent ?? "";
}

describe("TourControls", () => {
  beforeEach(() => {
    stubReducedMotion(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders no player at all for a tour with no stops", () => {
    // Not an empty group: a screen reader must not be walked into "Guided tour"
    // and find nothing inside it. The quick rail keeps the same rule.
    const { container } = render(
      <TourControls
        tour={{ id: "empty", title: "Nothing", stops: [] }}
        currentNodeId="scan_126"
        travelling={false}
        edges={EDGES}
        onGoToStop={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("names the cluster so its controls are announced in context", () => {
    render(<TourHost />);
    expect(screen.getByRole("group", { name: TOUR_GROUP_LABEL })).toBeTruthy();
  });

  it("touches nothing until the visitor presses play", () => {
    const onGoToStop = vi.fn();
    render(<TourHost onGoToStop={onGoToStop} />);

    // An idle player is an invitation, not a claim about where anyone is
    // standing: the tour's own title, and how long it takes.
    expect(caption()).toBe(TOUR.title);
    expect(screen.getByTestId("twin-tour-length").textContent).toMatch(/^About \d+ min$/);
    tick(20_000);
    expect(onGoToStop).not.toHaveBeenCalled();
  });

  it("goes to the first stop on play, and names it once the walk arrives", () => {
    const onGoToStop = vi.fn();
    render(<TourHost startAt="scan_028" onGoToStop={onGoToStop} />);

    play();

    expect(onGoToStop).toHaveBeenCalledTimes(1);
    const [stop, leg] = onGoToStop.mock.calls[0] as [TourStop, TourLeg];
    expect(stop.nodeId).toBe("scan_126");
    // Started from the Grand Hall, so this is a real corridor walk, not a cut.
    expect(leg.mode).toBe("glide");
    expect(leg.hops).toEqual(["scan_058", "hall_a", "scan_126"]);

    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[0]?.caption);
  });

  it("holds the clock until the walk has actually arrived", () => {
    render(<TourHost startAt="scan_028" />);
    play();

    // The host arrives at TRAVEL_MS, so a dwell that had (wrongly) started at
    // the press would have expired inside this window and moved the tour on.
    tick(DEFAULT_DWELL_MS);
    expect(caption()).toBe(TOUR.stops[0]?.caption);
    // The dwell that did start, started on arrival — so a WHOLE one is still
    // owed from here, and only then does the tour move.
    tick(DEFAULT_DWELL_MS);
    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[1]?.caption);
  });

  it("never names the room it is heading for while another one is on screen", () => {
    // The room-identity rule applied to time. `index` moves on the press; the
    // walk takes a corridor to catch up, and for the whole of that journey the
    // card must still describe the room the visitor can see.
    render(<TourHost />);
    play();
    tick(DEFAULT_DWELL_MS);

    // In flight to stop 2, standing in stop 1's room.
    expect(caption()).toBe(TOUR.stops[0]?.caption);
    // The press IS acknowledged — by the marker, and by the camera setting off.
    const second = TOUR.stops[1];
    expect(second).toBeDefined();
    if (second === undefined) {
      return;
    }
    expect(screen.getByTestId(`twin-tour-tick-${second.nodeId}`).className).toContain("--current");

    tick(TRAVEL_MS);
    expect(caption()).toBe(second.caption);
  });

  it("walks the whole sequence on its own and then hands the building back", () => {
    const onEnded = vi.fn();
    render(<TourHost onEnded={onEnded} />);
    play();

    // Standing on stop 1 already, so it is a "stay" — no travel, straight to dwell.
    expect(caption()).toBe(TOUR.stops[0]?.caption);
    tick(DEFAULT_DWELL_MS);

    // Every stop after that is a journey that lands, then a dwell that expires.
    for (let position = 1; position < TOUR.stops.length; position += 1) {
      tick(TRAVEL_MS);
      expect(caption()).toBe(TOUR.stops[position]?.caption);
      expect(onEnded).not.toHaveBeenCalled();
      tick(DEFAULT_DWELL_MS);
    }

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("twin-tour-note").textContent).toBe(TOUR_ENDED_NOTE);
    expect(screen.getByRole("button", { name: TOUR_REPLAY_LABEL })).toBeTruthy();
  });

  it("issues exactly one journey per stop, however often the host re-renders", () => {
    const onGoToStop = vi.fn();
    render(<TourHost startAt="scan_028" onGoToStop={onGoToStop} />);

    play();
    // The host re-renders on arrival and again on every timer flush. A player
    // that depended on currentNodeId, or on the host's inline callbacks, would
    // re-issue the journey it is already making — once per hop, forever.
    tick(TRAVEL_MS);
    tick(1000);

    expect(onGoToStop).toHaveBeenCalledTimes(1);
  });

  it("plays the tour again from the top after it has ended", () => {
    const onGoToStop = vi.fn();
    render(<TourHost onGoToStop={onGoToStop} />);
    play();
    tick(DEFAULT_DWELL_MS);
    for (let stop = 0; stop < 4; stop += 1) {
      playOneStop();
    }

    expect(screen.getByRole("button", { name: TOUR_REPLAY_LABEL })).toBeTruthy();
    onGoToStop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: TOUR_REPLAY_LABEL }));

    // The index is already 0 after the run ended, so a naive request guard would
    // swallow this and the replay would sit in the Robert Adam Room forever.
    expect(onGoToStop).toHaveBeenCalledTimes(1);
    expect((onGoToStop.mock.calls[0] as [TourStop, TourLeg])[0].nodeId).toBe("scan_126");
  });
});

describe("TourControls yields the view the moment it is touched", () => {
  beforeEach(() => {
    stubReducedMotion(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it.each([
    ["a drag on the view", () => fireEvent.pointerDown(document.body)],
    ["a wheel zoom", () => fireEvent.wheel(document.body)],
    ["a walk key", () => fireEvent.keyDown(document.body, { key: "w" })],
    ["a touch", () => fireEvent.touchStart(document.body)],
  ])("pauses on %s", (_name, interrupt) => {
    render(<TourHost />);
    play();
    expect(screen.getByRole("button", { name: TOUR_PAUSE_LABEL })).toBeTruthy();

    act(() => {
      interrupt();
    });

    expect(screen.getByRole("button", { name: TOUR_PLAY_LABEL })).toBeTruthy();
    expect(screen.getByTestId("twin-tour-note").textContent).toBe(TOUR_PAUSED_NOTE);
  });

  it("stops advancing once paused", () => {
    render(<TourHost />);
    play();
    act(() => {
      fireEvent.pointerDown(document.body);
    });

    tick(DEFAULT_DWELL_MS * 4);
    expect(caption()).toBe(TOUR.stops[0]?.caption);
  });

  it("does NOT pause on a press of its own controls", () => {
    // The failure mode of a naive window listener: Next is a pointerdown too, so
    // the button meant to advance the tour would stop it instead.
    render(<TourHost />);
    play();

    act(() => {
      fireEvent.pointerDown(screen.getByRole("button", { name: TOUR_NEXT_LABEL }));
    });

    expect(screen.getByRole("button", { name: TOUR_PAUSE_LABEL })).toBeTruthy();
  });

  it("tells the host every time the play state changes", () => {
    // TwinViewer uses this to drop an in-flight Usher queue; a missed report
    // leaves the camera gliding after the visitor has taken hold of it.
    const onPlayingChange = vi.fn();
    render(<TourHost onPlayingChange={onPlayingChange} />);

    play();
    expect(onPlayingChange.mock.calls).toEqual([[true]]);

    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(onPlayingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("resumes the stop where it was paused rather than from the top", () => {
    render(<TourHost />);
    play();

    // A third of the way through the first stop, then held for a long while.
    tick(DEFAULT_DWELL_MS / 3);
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    tick(60_000);
    expect(caption()).toBe(TOUR.stops[0]?.caption);

    play();
    // Two thirds are left. Just short of it, nothing has moved.
    tick(DEFAULT_DWELL_MS / 3);
    expect(caption()).toBe(TOUR.stops[0]?.caption);
    // Past it, the tour goes on — from where it was, not from six seconds again.
    tick(DEFAULT_DWELL_MS / 3);
    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[1]?.caption);
  });

  it("gives a stop chosen by hand its whole dwell, not the last one's remainder", () => {
    render(<TourHost />);
    play();
    tick(DEFAULT_DWELL_MS - 200);
    act(() => {
      fireEvent.pointerDown(document.body);
    });

    // Stop 1 had 200 ms left on it. Moving to stop 2 and playing must not inherit
    // that — the remainder is tagged with the stop it belonged to.
    fireEvent.click(screen.getByRole("button", { name: TOUR_NEXT_LABEL }));
    play();
    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[1]?.caption);
    tick(DEFAULT_DWELL_MS - 400);
    expect(caption()).toBe(TOUR.stops[1]?.caption);
  });
});

describe("TourControls transport and markers", () => {
  beforeEach(() => {
    stubReducedMotion(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("cannot step back from the first stop, or on from the last", () => {
    render(<TourHost />);

    expect(screen.getByRole("button", { name: TOUR_PREVIOUS_LABEL })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: TOUR_NEXT_LABEL })).toHaveProperty("disabled", false);

    for (let step = 0; step < TOUR.stops.length - 1; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: TOUR_NEXT_LABEL }));
      tick(TRAVEL_MS);
    }
    expect(screen.getByRole("button", { name: TOUR_NEXT_LABEL })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: TOUR_PREVIOUS_LABEL })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("wraps in both directions when the host asks for a loop", () => {
    render(<TourHost loop />);
    expect(screen.getByRole("button", { name: TOUR_PREVIOUS_LABEL })).toHaveProperty(
      "disabled",
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: TOUR_PREVIOUS_LABEL }));
    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[TOUR.stops.length - 1]?.caption);
  });

  it("names every marker by its room so choosing one is a decision", () => {
    render(<TourHost />);

    TOUR.stops.forEach((stop, position) => {
      const label = tourStopLabel(position + 1, ROOM_DISPLAY_NAMES[stop.slug]);
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    });
  });

  it("marks where the tour is, for a screen reader as well as for the eye", () => {
    render(<TourHost />);
    const first = TOUR.stops[0];
    const third = TOUR.stops[2];
    expect(first).toBeDefined();
    expect(third).toBeDefined();
    if (first === undefined || third === undefined) {
      return;
    }

    expect(screen.getByTestId(`twin-tour-tick-${first.nodeId}`).className).toContain("--current");
    expect(screen.getByTestId(`twin-tour-tick-${first.nodeId}`).getAttribute("aria-current")).toBe(
      "true",
    );

    fireEvent.click(screen.getByTestId(`twin-tour-tick-${third.nodeId}`));
    tick(TRAVEL_MS);
    expect(caption()).toBe(third.caption);
    expect(screen.getByTestId(`twin-tour-tick-${third.nodeId}`).className).toContain("--current");
    expect(screen.getByTestId(`twin-tour-tick-${first.nodeId}`).className).toContain("--seen");
  });

  it("announces each arrival politely, naming the stop and the count", () => {
    render(<TourHost />);
    play();
    tick(1);

    const live = screen.getByTestId("twin-tour-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe(`${TOUR.stops[0]?.caption ?? ""} Stop 1 of 5.`);
  });
});

describe("TourControls under prefers-reduced-motion", () => {
  beforeEach(() => {
    stubReducedMotion(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("cuts to each stop instead of gliding a route", () => {
    const onGoToStop = vi.fn();
    render(<TourHost startAt="scan_028" onGoToStop={onGoToStop} />);
    play();

    const [, leg] = onGoToStop.mock.calls[0] as [TourStop, TourLeg];
    expect(leg.mode).toBe("jump");
    expect(leg.hops).toEqual([]);
    // The route still exists — the preference changed how we travel it, not
    // whether the building connects.
    expect(leg.reachable).toBe(true);
  });

  it("draws no sweeping dwell bar, because a sweep has no final state", () => {
    render(<TourHost />);
    play();
    expect(screen.queryByTestId("twin-tour-dwell")).toBeNull();
  });

  it("keeps the dwell — the preference is about motion, not about being hurried", () => {
    render(<TourHost />);
    play();

    tick(DEFAULT_DWELL_MS - 100);
    expect(caption()).toBe(TOUR.stops[0]?.caption);
    tick(100);
    tick(TRAVEL_MS);
    expect(caption()).toBe(TOUR.stops[1]?.caption);
  });
});

describe("TourControls draws the dwell bar when motion is welcome", () => {
  beforeEach(() => {
    stubReducedMotion(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("runs the bar on the stop's own duration and holds it on pause", () => {
    render(<TourHost />);
    play();

    const bar = screen.getByTestId("twin-tour-dwell");
    // One number, shared by the CSS sweep and the JS clock — a second literal in
    // the stylesheet would drift and nothing would notice.
    expect(bar.style.getPropertyValue("--vv-tour-dwell")).toBe(`${String(DEFAULT_DWELL_MS)}ms`);
    expect(bar.className).not.toContain("--paused");

    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.getByTestId("twin-tour-dwell").className).toContain("--paused");
  });
});
