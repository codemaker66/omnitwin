import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
  type RoomDimensions,
} from "../../../lib/trades-hall-venue-truth.js";
import { metres, ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "../twin-rooms.js";
import {
  RoomDossier,
  STAT_LABEL_CEILING,
  TWIN_DOSSIER_COLLAPSE_LABEL,
  TWIN_DOSSIER_EXPAND_LABEL,
  TWIN_DOSSIER_FOOTNOTE,
  TWIN_DOSSIER_LEAVE_MS,
  twinDossierActionLabel,
  twinDossierArrival,
} from "../RoomDossier.js";

// -----------------------------------------------------------------------------
// RoomDossier — the panel that finally names a room.
//
// Plain DOM under happy-dom: nothing here touches three.js, so no R3F mocks.
//
// Not a single figure is written literally below. Every expected number is read
// back out of trades-hall-venue-truth.ts, because a test that hard-coded 250
// would keep agreeing with itself after the venue revised its capacities — it
// would pin the test to the past instead of pinning the panel to the truth.
//
// The other thing on trial is silence. scan_003 is a real viewpoint with no
// validated room, and the panel must render literally nothing there: not a
// skeleton, not a hedge, not an empty card.
// -----------------------------------------------------------------------------

const VENUE = "Trades Hall Glasgow";
/** Validated against ground-truth photography by another lane. */
const GRAND_HALL_NODE = "scan_028";
/** A second validated viewpoint, in a different room — the walk's next arrival. */
const SALOON_NODE = "scan_058";
/** A real viewpoint whose room nobody has confirmed — the common case. */
const UNVERIFIED_NODE = "scan_003";
/** Two more of the 144, for walking ON while an exit is already running. */
const UNVERIFIED_NEXT = "scan_004";
const UNVERIFIED_AFTER = "scan_005";

const GRAND_HALL: PublishedRoomSlug = "grand-hall";
const SALOON: PublishedRoomSlug = "saloon";

/**
 * Pin the motion preference for the test rather than inheriting happy-dom's
 * default. The house idiom, lifted from twin/__tests__/useTwinWalk.test.ts.
 *
 * Both settings are stubbed explicitly, never just the `true` one: a motion
 * assertion that silently depends on the environment answering "no preference"
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

/** The fold wrapper, found the way a screen reader finds it: through the
 *  toggle's aria-controls, so the wiring is exercised rather than assumed. */
function foldWrapper(): HTMLElement | null {
  const toggle = screen.getByRole("button", {
    name: new RegExp(`${TWIN_DOSSIER_COLLAPSE_LABEL}|${TWIN_DOSSIER_EXPAND_LABEL}`),
  });
  return document.getElementById(toggle.getAttribute("aria-controls") ?? "");
}

/**
 * The one measurement the component takes, made observable.
 *
 * happy-dom lays nothing out, so every real getBoundingClientRect here reads
 * back 0 — which is why the height the fold travels was, until now, pinned only
 * as "0px": true of a correct measurement and equally true of a measurement
 * taken at the wrong moment. This stub reports a height that depends on whether
 * the body still HAS its contents, which is what makes the asymmetry visible:
 * the collapse has to measure while they are there, the expansion only once
 * they are back. A measurement on the wrong side of either commit reads 0.
 *
 * `filled` is deliberately fractional. The component does not round, on the
 * stated grounds that rounding puts a sub-pixel snap at the end of every
 * expansion, and a whole-number fixture could not tell the difference.
 */
function stubMeasuredHeight(body: HTMLElement, filled: number): void {
  body.getBoundingClientRect = (): DOMRect => {
    const height = body.childElementCount === 0 ? 0 : filled;
    const narrow: Pick<DOMRect, "height" | "width" | "top" | "bottom"> = {
      height,
      width: 0,
      top: 0,
      bottom: height,
    };
    const widened: unknown = narrow;
    return widened as DOMRect;
  };
}

/** Read published dimensions without a non-null assertion, failing loudly if the
 *  truth module ever stops publishing them for a room that had them. */
function publishedDimensions(slug: PublishedRoomSlug): RoomDimensions {
  const dimensions = TRADES_HALL_ROOM_DIMENSIONS[slug];
  if (dimensions === undefined) {
    throw new Error(`venue truth publishes no dimensions for ${slug}`);
  }
  return dimensions;
}

describe("RoomDossier", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("names the Grand Hall and states its published figures", () => {
    const capacities = TRADES_HALL_ROOM_CAPACITIES[GRAND_HALL];
    const dimensions = publishedDimensions(GRAND_HALL);

    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      ROOM_DISPLAY_NAMES[GRAND_HALL],
    );
    expect(screen.getByText(VENUE)).toBeTruthy();

    // The four stats, each against the imported figure — never a literal, and
    // formatted with the SAME helper production uses. Rebuilding the expected
    // string with String() would agree only until the venue publishes a third
    // decimal, at which point the suite would fail at the assertion rather than
    // at the rounding and the tempting repair would be to loosen the test.
    expect(
      screen.getByText(`${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} m`),
    ).toBeTruthy();
    expect(screen.getByText(`${String(capacities.reception)} standing`)).toBeTruthy();
    expect(screen.getByText(`${String(capacities.dinner)} seated`)).toBeTruthy();

    // The venue's own qualifier travels with the figure it qualifies, and the
    // SEPARATOR between them is pinned here on purpose: asserting the note
    // alone passed happily while the panel rendered "7 ma further 7 m under the
    // dome", because a bare inline span contributes no whitespace of its own.
    const note = dimensions.note;
    if (note === undefined) {
      throw new Error("venue truth no longer publishes the Grand Hall's dome note");
    }
    const ceiling = screen.getByText(STAT_LABEL_CEILING).nextElementSibling;
    expect(ceiling?.textContent).toBe(`${metres(dimensions.heightM)} m — ${note}`);

    expect(screen.getByText(TWIN_DOSSIER_FOOTNOTE)).toBeTruthy();
  });

  it("says nothing at all at a viewpoint whose room is unverified", () => {
    const { container } = render(
      <RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("twin-room-dossier")).toBeNull();
  });

  it("carries an accessible name and takes no focus on arrival", () => {
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    // The region is named by the room heading, so a screen-reader user meets
    // "Grand Hall", not an anonymous group of numbers.
    const heading = screen.getByRole("heading", { level: 2 });
    const labelled = document.querySelector(`[aria-labelledby="${heading.id}"]`);
    expect(labelled).not.toBeNull();
    expect(labelled?.tagName.toLowerCase()).toBe("section");

    // Ambient chrome over a live walkthrough: it must never grab the caret.
    expect(document.activeElement).toBe(document.body);
  });

  it("collapses and expands from a keyboard-reachable button, still naming the room", () => {
    const capacities = TRADES_HALL_ROOM_CAPACITIES[GRAND_HALL];
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    const collapse = screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL });
    // A native button, so it is in the tab order for free — no roving tabindex,
    // no key handler of our own to get wrong.
    expect(collapse.tagName).toBe("BUTTON");
    expect(collapse.getAttribute("tabindex")).toBeNull();
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    collapse.focus();
    expect(document.activeElement).toBe(collapse);

    fireEvent.click(collapse);

    const expand = screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(`${String(capacities.reception)} standing`)).toBeNull();
    expect(screen.queryByText(TWIN_DOSSIER_FOOTNOTE)).toBeNull();

    // Folded away, it still answers the only question that matters.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      ROOM_DISPLAY_NAMES[GRAND_HALL],
    );
    // aria-controls must resolve even while the body is empty.
    expect(document.getElementById(expand.getAttribute("aria-controls") ?? "")).not.toBeNull();

    fireEvent.click(expand);
    expect(screen.getByText(`${String(capacities.reception)} standing`)).toBeTruthy();
  });

  it("renders no action at all when the host wires none", () => {
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    expect(
      screen.queryByText(twinDossierActionLabel(ROOM_DISPLAY_NAMES[GRAND_HALL])),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /enquire/i })).toBeNull();
    // The collapse toggle is the only control on the panel.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("invokes the wired action, which names the room where it can be read", () => {
    const onCompose = vi.fn();
    render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} onCompose={onCompose} />,
    );

    const label = twinDossierActionLabel(ROOM_DISPLAY_NAMES[GRAND_HALL]);
    const action = screen.getByRole("button", { name: label });
    // Visible text and accessible name are the same string — Label in Name
    // (WCAG 2.5.3), so a speech-input user can say what they can see.
    expect(action.textContent).toBe(label);
    expect(action.getAttribute("aria-label")).toBeNull();
    fireEvent.click(action);
    expect(onCompose).toHaveBeenCalledTimes(1);
  });

  it("announces the room politely, one tick after the region exists", async () => {
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    const live = screen.getByTestId("twin-room-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    // Empty on the first commit: a live region that mounts already carrying its
    // text is silent in most screen readers.
    expect(live.textContent).toBe("");

    await waitFor(() => {
      expect(live.textContent).toBe(
        twinDossierArrival(ROOM_DISPLAY_NAMES[GRAND_HALL], VENUE),
      );
    });
  });
});

// -----------------------------------------------------------------------------
// Motion.
//
// The panel used to appear and vanish on a frame boundary. Everything below is
// about the two seams where that showed: walking into a named room, and walking
// out of one.
//
// Note what is NOT asserted: pixels, easing curves, durations in flight. happy-dom
// lays nothing out and runs no animations, so every measured height here reads
// back 0 and no animationend fires unless a test fires one. What CAN be pinned is
// the mechanism — which class the stylesheet is handed, which custom property the
// measurement lands in, whether the element survives long enough to be seen out,
// and whether a visitor who asked for less motion gets the final state at once
// rather than a shorter version of the same journey. Those are the parts that
// break silently; the curve itself is visible to anyone who opens /tour.
// -----------------------------------------------------------------------------

describe("RoomDossier motion", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sees the panel out of the room it named, then removes it", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();

    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // The walk steps out of the Grand Hall into a viewpoint nobody has validated.
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);

    const card = document.querySelector(".vv-twin-dossier-card");
    expect(card?.classList.contains("vv-twin-dossier-card--leaving")).toBe(true);
    // Still showing the room it is leaving — that is what is fading out. It is
    // no longer a CLAIM about where the visitor is, though, so it leaves the
    // accessibility tree at once: getByRole ignores aria-hidden subtrees, and
    // the room name being unreachable by role while still readable as text is
    // exactly the distinction being pinned here.
    expect(screen.getByText(ROOM_DISPLAY_NAMES[GRAND_HALL])).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(TWIN_DOSSIER_LEAVE_MS);
    });
    expect(screen.queryByTestId("twin-room-dossier")).toBeNull();
  });

  // — the anti-blink guarantee, and exactly how far this environment can pin it —
  //
  // The departure logic exists for one reason: the panel must never be yanked off
  // the screen on the frame the walk steps out of a room. Two halves of that are
  // observable here and are pinned below — the card is held, unbroken, for the
  // exit's own duration however far the walk goes on; and an arrival catches the
  // card mid-exit rather than letting it die and building a new one.
  //
  // The third half is NOT observable, and saying so is worth more than a test
  // that pretends otherwise. That the departure is detected in a LAYOUT effect
  // rather than a passive one is what keeps the swap off the paint, and it was
  // measured here: swapping useLayoutEffect for useEffect leaves every test in
  // this file green, under act(), under flushSync, and under a default-lane
  // render observed across macrotask boundaries. React 18.3.1's own commit path
  // is why — `includesSomeLane(pendingPassiveEffectsLanes, SyncLane)` flushes
  // passive effects at the end of a sync commit "so that the result is
  // immediately observable", and happy-dom's scheduler drains the render task
  // and the passive-effect task together for the rest. There is no frame in a
  // DOM that never paints. That claim is defended by the component's comment and
  // by the browser; what follows pins everything around it.
  it("holds the panel unbroken across the exit, however far the walk goes on", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();

    const { rerender } = render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    /** The card, and what it is doing — read at every step a frame could land on. */
    const state = (): string => {
      const card = document.querySelector(".vv-twin-dossier-card");
      if (card === null) {
        return "gone";
      }
      return card.classList.contains("vv-twin-dossier-card--leaving") ? "leaving" : "present";
    };

    // Out of the Grand Hall, and then on through two more of the 144 viewpoints
    // nobody has validated — which is what walking away from a room actually
    // looks like, and the case a timer keyed on the viewpoint gets wrong twice
    // over: its cleanup cancels the exit on the next step and nothing re-arms
    // it, or it re-arms and the card sits over the view long after it went
    // transparent, holding its own pointer-events hole open.
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    expect(state()).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(state()).toBe("leaving");

    rerender(<RoomDossier currentId={UNVERIFIED_NEXT} venueName={VENUE} />);
    expect(state()).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<RoomDossier currentId={UNVERIFIED_AFTER} venueName={VENUE} />);
    expect(state()).toBe("leaving");

    // One millisecond short of the settling time the stylesheet was solved for:
    // still there, so nothing has cut the exit off part-way through.
    act(() => {
      vi.advanceTimersByTime(TWIN_DOSSIER_LEAVE_MS - 201);
    });
    expect(state()).toBe("leaving");

    // And gone on the millisecond it lands — the exit's clock measures from the
    // departure, not from the last step of the walk.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(state()).toBe("gone");
  });

  it("catches the very card it was seeing out when the walk turns back", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();

    const { rerender } = render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // The departure deliberately builds a fresh card — that is how the exit
    // animation is guaranteed to start from its first keyframe — so the element
    // on trial here is the one that is FADING, captured now.
    const card = document.querySelector(".vv-twin-dossier-card--leaving");
    expect(card).not.toBeNull();

    // Back into the room it was leaving, by its other end. The card the visitor
    // was watching fade must be CAUGHT — same element, arrival not replayed —
    // rather than torn down and rebuilt, which would read as a blink in the one
    // place the visitor is already looking.
    rerender(<RoomDossier currentId="scan_046" venueName={VENUE} />);
    const caught = document.querySelector(".vv-twin-dossier-card");
    expect(caught).toBe(card);
    expect(caught?.classList.contains("vv-twin-dossier-card--leaving")).toBe(false);

    // The abandoned exit must not fire from under them. Past the moment its
    // clock would have run out, the panel is simply still here.
    act(() => {
      vi.advanceTimersByTime(TWIN_DOSSIER_LEAVE_MS);
    });
    expect(document.querySelector(".vv-twin-dossier-card")).toBe(card);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      ROOM_DISPLAY_NAMES[GRAND_HALL],
    );
  });

  it("removes the panel instantly when the visitor asks for reduced motion", () => {
    stubReducedMotion(true);

    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );
    expect(screen.getByTestId("twin-room-dossier")).toBeTruthy();

    // The final state, on the same commit — not a shorter exit, no exit at all.
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    expect(screen.queryByTestId("twin-room-dossier")).toBeNull();
  });

  it("hands the stylesheet the same exit duration the component times", () => {
    stubReducedMotion(false);
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    // One number, published to CSS rather than restated in it. If they drifted,
    // the panel would either be cut off mid-exit or sit invisible for the
    // remainder — and neither shows up in a screenshot.
    expect(
      screen.getByTestId("twin-room-dossier").style.getPropertyValue("--vv-dossier-leave"),
    ).toBe(`${String(TWIN_DOSSIER_LEAVE_MS)}ms`);
  });

  it("folds from the height the body had, and releases the pin when it lands", () => {
    stubReducedMotion(false);
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    const body = foldWrapper();
    expect(body?.className).toBe("vv-twin-dossier-body");

    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    expect(body?.className).toContain("vv-twin-dossier-body--folding");
    // The collapse has to measure BEFORE React removes the contents; by the time
    // the class lands there is nothing left to measure. happy-dom lays nothing
    // out, so the honest value here is 0px — the point is that a measurement
    // was taken and handed to the stylesheet at all.
    expect(body?.style.getPropertyValue("--vv-dossier-fold-h")).toBe("0px");

    // Landing releases the class, so nothing is left pinned to a stale pixel
    // height that would stop the panel reflowing.
    if (body !== null) {
      fireEvent.animationEnd(body);
    }
    expect(body?.className).toBe("vv-twin-dossier-body");

    // The expansion measures in the other direction: the contents exist by the
    // time the wrapper can be asked how tall they are.
    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL }));
    expect(body?.className).toContain("vv-twin-dossier-body--unfolding");
    expect(body?.style.getPropertyValue("--vv-dossier-fold-h")).toBe("0px");
  });

  it("hands the fold the body's real height, from the side of the commit that has it", () => {
    stubReducedMotion(false);
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    const body = foldWrapper();
    if (body === null) {
      throw new Error("the toggle's aria-controls no longer resolves to the fold wrapper");
    }
    // 148.5, not 148: the component states that it does not round, because a
    // whole-pixel target snaps at the end of every expansion. A fixture of 148
    // would agree with a rounded implementation and this claim would be free.
    const MEASURED = 148.5;
    stubMeasuredHeight(body, MEASURED);

    // Collapsing. The measurement is the entire reason this component needs
    // script — CSS cannot animate from `auto` — and it has to be taken while
    // the contents are still mounted. Moving it into a layout effect, which is
    // where an expansion's measurement correctly lives, reads back an empty
    // wrapper and hands the stylesheet 0: the panel would jump shut instead of
    // folding, and every other assertion in this file would still pass.
    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    expect(body.style.getPropertyValue("--vv-dossier-fold-h")).toBe(`${String(MEASURED)}px`);
    // ...and by the time anyone could have measured after the fact, there was
    // nothing left to measure. This is what makes the line above a statement
    // about WHEN, not just about the number.
    expect(body.childElementCount).toBe(0);

    fireEvent.animationEnd(body);

    // Expanding, and the asymmetry: the contents this fold has to make room for
    // do not exist until React commits, so measuring in the click handler — the
    // correct side for the collapse — would hand over the empty wrapper's 0 and
    // the body would unfold to nothing at all.
    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL }));
    expect(body.style.getPropertyValue("--vv-dossier-fold-h")).toBe(`${String(MEASURED)}px`);
    expect(body.childElementCount).toBeGreaterThan(0);
  });

  it("collapses with no transition at all under reduced motion", () => {
    stubReducedMotion(true);
    const capacities = TRADES_HALL_ROOM_CAPACITIES[GRAND_HALL];
    render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    // No animation class means no animation to shorten — the wrapper is simply
    // in its final state, which is the whole of what the preference asks for.
    expect(foldWrapper()?.className).toBe("vv-twin-dossier-body");
    expect(screen.queryByText(`${String(capacities.reception)} standing`)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL }));
    expect(foldWrapper()?.className).toBe("vv-twin-dossier-body");
    expect(screen.getByText(`${String(capacities.reception)} standing`)).toBeTruthy();
  });

  it("still announces every arrival, including the one after a departure", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();

    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("twin-room-live").textContent).toBe(
      twinDossierArrival(ROOM_DISPLAY_NAMES[GRAND_HALL], VENUE),
    );

    // Mid-exit the region empties. A panel that is visibly leaving must not go
    // on asserting a room to anyone listening rather than looking.
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    expect(screen.getByTestId("twin-room-live").textContent).toBe("");

    // Arriving somewhere new interrupts the exit and announces afresh.
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector(".vv-twin-dossier-card--leaving")).toBeNull();
    expect(screen.getByTestId("twin-room-live").textContent).toBe(
      twinDossierArrival(ROOM_DISPLAY_NAMES[SALOON], VENUE),
    );
  });

  it("greets each new room open, however the last one was left", () => {
    stubReducedMotion(true);
    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );

    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    expect(screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL })).toBeTruthy();

    // Returning null does NOT unmount this component — the host renders it for
    // the whole of walk mode — so a collapse survives the walk between rooms
    // unless something resets it. Left alone, the Saloon would be greeted shut
    // for a reason the visitor could not trace back to the Grand Hall.
    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);

    expect(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL })).toBeTruthy();
    expect(screen.getByText(ROOM_DISPLAY_NAMES[SALOON])).toBeTruthy();
    expect(screen.getByText(TWIN_DOSSIER_FOOTNOTE)).toBeTruthy();
  });

  it("never carries a half-finished fold into the next room", () => {
    stubReducedMotion(false);
    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );

    // Collapse and walk straight out. The exit tears the wrapper out of the DOM
    // mid-fold, so its animationend never fires and the phase is never released
    // the usual way — the exact sequence that would otherwise greet the Saloon
    // by folding its panel shut against a height measured in the Grand Hall.
    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    expect(foldWrapper()?.className).toContain("vv-twin-dossier-body--folding");

    rerender(<RoomDossier currentId={UNVERIFIED_NODE} venueName={VENUE} />);
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);

    expect(foldWrapper()?.className).toBe("vv-twin-dossier-body");
    expect(screen.getByText(TWIN_DOSSIER_FOOTNOTE)).toBeTruthy();
  });

  it("keeps a collapse the visitor chose while they move inside one room", () => {
    stubReducedMotion(true);
    const { rerender } = render(
      <RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />,
    );

    fireEvent.click(screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL }));
    // scan_046 is the Grand Hall's other end — the same room, a different
    // viewpoint. Re-opening the panel here would undo a choice the visitor made
    // seconds ago for no reason they could see.
    rerender(<RoomDossier currentId="scan_046" venueName={VENUE} />);

    expect(screen.getByRole("button", { name: TWIN_DOSSIER_EXPAND_LABEL })).toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// The arrival, at every transition the validated map can actually produce.
//
// This is the seam the panel exists for and it was, until this suite, the one
// the panel silently did not do. A CSS animation plays when its element is
// created; an element that survives a render and merely changes its text plays
// nothing. Walking from one named room straight into another re-used the same
// <section>, so the arrival ran exactly once — on the first named viewpoint of
// the session — and never again for a room reached from another room. All twenty
// ordered pairs below were measured in that state and all twenty kept the same
// element.
//
// What is asserted per transition is therefore element IDENTITY, and that is not
// a proxy for the motion: in a browser it is the whole of what decides whether
// the arrival plays. happy-dom runs no animations and asserting a computed
// animation-name here would be asserting a stylesheet nothing has loaded, so the
// mechanism is pinned where it actually lives and the curve stays visible to
// anyone who opens /tour.
//
// The enumeration is derived from VERIFIED_ROOM_NODES rather than listed, so a
// sixth validated viewpoint is covered the day it is added — which is the point
// of that map being a one-line change.
// -----------------------------------------------------------------------------

interface RoomTransition {
  readonly from: string;
  readonly fromSlug: PublishedRoomSlug;
  readonly to: string;
  readonly toSlug: PublishedRoomSlug;
}

const VALIDATED_VIEWPOINTS: readonly (readonly [string, PublishedRoomSlug])[] =
  Object.entries(VERIFIED_ROOM_NODES);

const ROOM_TRANSITIONS: readonly RoomTransition[] = VALIDATED_VIEWPOINTS.flatMap(
  ([from, fromSlug]) =>
    VALIDATED_VIEWPOINTS.filter(([to]) => to !== from).map(([to, toSlug]) => ({
      from,
      fromSlug,
      to,
      toSlug,
    })),
);

describe("RoomDossier arrival, viewpoint by viewpoint", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("enumerates every ordered pair of validated viewpoints", () => {
    // Without this, a map that shrank to a single entry would leave the it.each
    // below with nothing to run and the suite would report green on an empty
    // enumeration — the failure mode of every table-driven test.
    const count = VALIDATED_VIEWPOINTS.length;
    expect(count).toBeGreaterThan(1);
    expect(ROOM_TRANSITIONS).toHaveLength(count * (count - 1));
  });

  it.each(ROOM_TRANSITIONS)(
    "$from → $to lands in a card of its own",
    ({ from, to, fromSlug, toSlug }) => {
      stubReducedMotion(false);
      const { rerender } = render(<RoomDossier currentId={from} venueName={VENUE} />);
      const before = document.querySelector(".vv-twin-dossier-card");
      expect(before).not.toBeNull();

      // Straight from one validated viewpoint to another, which is what the nav
      // graph does between two ends of a doorway — no unvalidated viewpoint in
      // between to unmount the card and cover the seam.
      rerender(<RoomDossier currentId={to} venueName={VENUE} />);
      const after = document.querySelector(".vv-twin-dossier-card");

      expect(after).not.toBeNull();
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        ROOM_DISPLAY_NAMES[toSlug],
      );
      // A room is greeted open and greeted arriving, never mid-exit.
      expect(after?.classList.contains("vv-twin-dossier-card--leaving")).toBe(false);
      expect(after?.classList.contains("vv-twin-dossier-card--collapsed")).toBe(false);

      if (fromSlug === toSlug) {
        // The two ends of the Grand Hall. Nothing arrives here — the visitor
        // never left the room — and re-playing the animation for a walk across
        // one room would be the opposite mistake, so the card must be the SAME
        // element, which is also what keeps a collapse they chose.
        expect(after).toBe(before);
        return;
      }
      expect(after).not.toBe(before);
    },
  );

  it("never lets a new room's live region be born naming the last one", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();

    const { rerender } = render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("twin-room-live").textContent).toBe(
      twinDossierArrival(ROOM_DISPLAY_NAMES[GRAND_HALL], VENUE),
    );

    // Room to room with nothing in between, so nothing clears the announcement
    // on the way. The new room gets a new card and therefore a new live region,
    // and a region that comes into existence already carrying text is silent in
    // most screen readers — but the ones that do read it would be reading the
    // room the visitor has just left.
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);
    expect(screen.getByTestId("twin-room-live").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("twin-room-live").textContent).toBe(
      twinDossierArrival(ROOM_DISPLAY_NAMES[SALOON], VENUE),
    );
  });

  it("carries the caret into the new room's toggle", () => {
    stubReducedMotion(false);
    const { rerender } = render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);

    const toggle = screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // Travel keys are on window (WalkControls), so a visitor can be holding the
    // caret here at the moment the room changes. The card is keyed on the room,
    // so this toggle is torn out — and dropping them to the top of the document
    // for walking through a doorway is not an acceptable price for an animation.
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);

    const arrived = screen.getByRole("button", { name: TWIN_DOSSIER_COLLAPSE_LABEL });
    expect(arrived).not.toBe(toggle);
    expect(document.activeElement).toBe(arrived);
  });

  it("takes no caret it was not given", () => {
    stubReducedMotion(false);
    const { rerender } = render(<RoomDossier currentId={GRAND_HALL_NODE} venueName={VENUE} />);
    expect(document.activeElement).toBe(document.body);

    // The other half of the handoff. Ambient chrome over a live view may hand
    // back a caret it was holding; it may never take one it never had, or every
    // room change would yank a keyboard visitor out of whatever they were on.
    rerender(<RoomDossier currentId={SALOON_NODE} venueName={VENUE} />);
    expect(document.activeElement).toBe(document.body);
  });
});
