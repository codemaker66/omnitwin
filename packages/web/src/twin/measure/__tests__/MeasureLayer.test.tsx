import { TwinTierSchema, findUnsupportedProposalClaim } from "@omnitwin/types";
import { useCallback, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { measureBetween } from "../measure-math.js";
import {
  MEASURE_CENTRE_PICK_LABEL,
  MEASURE_CLEAR_LABEL,
  MEASURE_CONFIDENCE_NOTE,
  MEASURE_DONE_LABEL,
  MEASURE_FIRST_PROMPT,
  MEASURE_GROUP_LABEL,
  MEASURE_RISE_LEVEL,
  MEASURE_SECOND_PROMPT,
  MEASURE_STAT_PLAN,
  MEASURE_STAT_STRAIGHT,
  allMeasureCopy,
  measureAnnouncement,
  measureRiseWord,
} from "../measure-copy.js";
import { MeasureLayer, type MeasurePoint } from "../MeasureLayer.js";

// -----------------------------------------------------------------------------
// MeasureLayer — the tool a venue actually touches, on trial for the two ways a
// measure tool lies.
//
// THE FIRST LIE IS A NUMBER THAT ISN'T ONE. The refuted revision printed
// "6.40 m ± 3 cm", where the ± was derived from the manifest `tier` — an argv
// default in the forge CLI, never measured. The component no longer accepts a
// tier at all, and the tests below hold that shut from both ends: every figure
// read off the DOM is read back through `measureBetween`, and the whole rendered
// text is swept for an interval in any spelling.
//
// THE SECOND LIE IS A CLAIM. "survey-grade" is on the claim guard's banned list
// (PROPOSAL_UNSUPPORTED_CLAIM_PHRASES) and was, until this revision, also the
// literal tier value this component was handed on every render. The sweep pushes
// the component's whole rendered text through the guard rather than trusting the
// copy list — a component can render a string the copy list never heard of, and
// that is exactly the string that would hurt.
//
// AND THE INTEGRATION. The final block drives a host double that owns the picks
// the way a real host must, because unit-testing a presentational component in
// isolation left the feature's actual contract — arm, pick, pick, read, clear,
// close — entirely unexercised. See the honesty note above that block for what
// it does and does not cover.
//
// Plain DOM under happy-dom: the layer draws its segment as an SVG overlay in
// normalised stage coordinates supplied by the host, so nothing here needs R3F,
// a canvas, or a camera.
// -----------------------------------------------------------------------------

/** A 3-4-5 in plan with a clean rise: every figure is exact, so the assertions
 *  pin the arithmetic rather than a rounding window. */
const FROM: MeasurePoint = { world: [0, 0, 0], screen: { x: 0.25, y: 0.5 } };
const TO: MeasurePoint = { world: [3, 2, 4], screen: { x: 0.75, y: 0.25 } };

const SPAN = measureBetween(FROM.world, TO.world);

/** Every spelling of an interval this tool must never render. */
const INTERVAL_SHAPES: readonly RegExp[] = [
  /±/,
  /\+\/-/,
  /\bplus or minus\b/i,
  /\d+\s*cm\b/i,
  /\d+\s*mm\b/i,
  /\bto within\b/i,
  /\baccurate to\b/i,
];

function expectNoInterval(text: string): void {
  for (const shape of INTERVAL_SHAPES) {
    expect(text).not.toMatch(shape);
  }
}

/**
 * Assert an element is actually SHOWN, not merely present in the DOM.
 *
 * Added after mutation testing: hiding the stats block with `hidden` +
 * `display: none` left every `getByText` assertion in this file green, because
 * Testing Library's text queries match hidden nodes. A measuring tool whose
 * figures are in the DOM and invisible is indistinguishable, to the suite, from
 * one that works — so presence is not the assertion, visibility is.
 *
 * happy-dom has no layout engine, so this checks the two things that can hide a
 * node without one (the `hidden` attribute and an inline `display: none`), and
 * walks ancestors because either can be applied to a wrapper instead.
 */
function expectShown(node: Element | null | undefined): void {
  expect(node).toBeTruthy();
  let current: HTMLElement | null = node as HTMLElement;
  while (current !== null && current !== document.body) {
    expect(current.hidden).toBe(false);
    expect(current.style.display).not.toBe("none");
    expect(current.style.visibility).not.toBe("hidden");
    current = current.parentElement;
  }
}

describe("MeasureLayer", () => {
  afterEach(() => {
    cleanup();
  });

  it("asks for the first point, and shows no figures before it has any", () => {
    const { container } = render(<MeasureLayer points={[]} onDismiss={vi.fn()} />);

    expect(screen.getByRole("group", { name: MEASURE_GROUP_LABEL })).toBeTruthy();
    expect(screen.getByText(MEASURE_FIRST_PROMPT)).toBeTruthy();
    // No segment, no numbers — an empty measurement must not render a skeleton
    // that reads as a result of zero.
    expect(container.querySelector('[data-testid="twin-measure-segment"]')).toBeNull();
    expect(screen.queryByText(MEASURE_STAT_STRAIGHT)).toBeNull();
    expect(container.textContent).not.toContain("≈");
  });

  it("asks for the second point once one is placed, still without a figure", () => {
    const { container } = render(<MeasureLayer points={[FROM]} onDismiss={vi.fn()} />);

    expect(screen.getByText(MEASURE_SECOND_PROMPT)).toBeTruthy();
    expect(container.querySelector('[data-testid="twin-measure-point-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="twin-measure-segment"]')).toBeNull();
    expect(container.textContent).not.toContain("≈");
  });

  it("draws the segment between the two supplied stage positions", () => {
    const { container } = render(<MeasureLayer points={[FROM, TO]} onDismiss={vi.fn()} />);

    const segment = container.querySelector('[data-testid="twin-measure-segment"]');
    expect(segment).not.toBeNull();
    // Percentages of the stage, so the overlay needs no pixel size of its own
    // and survives a resize without the host re-projecting anything.
    expect(segment?.getAttribute("x1")).toBe("25%");
    expect(segment?.getAttribute("y1")).toBe("50%");
    expect(segment?.getAttribute("x2")).toBe("75%");
    expect(segment?.getAttribute("y2")).toBe("25%");

    // The headline figure rides the segment, where the eye already is.
    const tag = container.querySelector('[data-testid="twin-measure-tag"]');
    expect(tag?.textContent).toBe(SPAN.straightLabel);
    // Even the decorative tag carries the mark. It is the one figure a visitor
    // reads without the panel in their eyeline, so it may not be the one that
    // ships bare.
    expect(tag?.textContent).toContain("≈");
  });

  it("keeps the figure on stage when the segment runs off it", () => {
    // A midpoint behind the visitor's shoulder would park the number outside
    // the clipped stage and lose it entirely; clamping keeps the answer
    // readable even when the line it belongs to is mostly gone.
    const offStage: MeasurePoint = { world: [3, 2, 4], screen: { x: -0.9, y: -0.7 } };
    const { container } = render(
      <MeasureLayer
        points={[{ ...FROM, screen: { x: -0.5, y: -0.5 } }, offStage]}
        onDismiss={vi.fn()}
      />,
    );

    const tag = container.querySelector('[data-testid="twin-measure-tag"]');
    expect(tag).not.toBeNull();
    expect((tag as HTMLElement).style.left).toBe("2%");
    expect((tag as HTMLElement).style.top).toBe("2%");
  });

  it("states the straight line, the plan distance and the rise, visibly", () => {
    render(<MeasureLayer points={[FROM, TO]} onDismiss={vi.fn()} />);

    const straight = screen.getByText(MEASURE_STAT_STRAIGHT).nextElementSibling;
    const plan = screen.getByText(MEASURE_STAT_PLAN).nextElementSibling;
    const rise = screen.getByText(measureRiseWord(SPAN.riseM)).nextElementSibling;

    expect(straight?.textContent).toBe(SPAN.straightLabel);
    expect(plan?.textContent).toBe(SPAN.planLabel);
    expect(rise?.textContent).toBe(SPAN.riseLabel);

    // In the DOM is not the same as on the screen — see expectShown.
    expectShown(straight);
    expectShown(plan);
    expectShown(rise);
  });

  it("renders the confidence note with the figures, and only with them", () => {
    // The invariant the panel's structure exists to make testable: the
    // qualification appears on this screen if and only if there is a
    // measurement for it to qualify. Deleting the note — the mutant that turns
    // three figures over a photograph into an unqualified claim — fails here.
    const empty = render(<MeasureLayer points={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByText(MEASURE_CONFIDENCE_NOTE)).toBeNull();
    empty.unmount();

    const half = render(<MeasureLayer points={[FROM]} onDismiss={vi.fn()} />);
    expect(screen.queryByText(MEASURE_CONFIDENCE_NOTE)).toBeNull();
    half.unmount();

    render(<MeasureLayer points={[FROM, TO]} onDismiss={vi.fn()} />);
    const note = screen.getByText(MEASURE_CONFIDENCE_NOTE);
    expectShown(note);
    // The three clauses that make it true, checked individually so a rewrite
    // that quietly drops the call to action cannot pass on a prefix match.
    expect(note.textContent).toMatch(/surveyor's instrument/);
    expect(note.textContent).toMatch(/on site/);
    expect(note.textContent).toMatch(/events team/);
  });

  it("prints no interval anywhere on the screen, in any spelling", () => {
    const { container } = render(
      <MeasureLayer
        points={[FROM, TO]}
        onDismiss={vi.fn()}
        onClear={vi.fn()}
        onPickAtCentre={vi.fn()}
      />,
    );
    expectNoInterval(container.textContent ?? "");
  });

  it("keeps the figures when a point projects off-camera and no segment can be drawn", () => {
    const { container } = render(
      <MeasureLayer points={[FROM, { ...TO, screen: null }]} onDismiss={vi.fn()} />,
    );

    // The measurement is still true — only its drawing is impossible.
    expect(container.querySelector('[data-testid="twin-measure-segment"]')).toBeNull();
    expect(container.querySelector('[data-testid="twin-measure-tag"]')).toBeNull();
    expect(screen.getByText(MEASURE_STAT_STRAIGHT).nextElementSibling?.textContent).toBe(
      SPAN.straightLabel,
    );
    // And it is still qualified. Losing the drawing must not lose the caveat.
    expect(screen.getByText(MEASURE_CONFIDENCE_NOTE)).toBeTruthy();
  });

  it("dismisses from a keyboard-reachable button and from Escape", () => {
    const onDismiss = vi.fn();
    render(<MeasureLayer points={[]} onDismiss={onDismiss} />);

    const done = screen.getByRole("button", { name: MEASURE_DONE_LABEL });
    expect(done.tagName).toBe("BUTTON");
    expect(done.getAttribute("tabindex")).toBeNull();
    fireEvent.click(done);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Nothing picked, so Escape has nothing to cancel and leaves the tool.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("ignores keys that are not Escape", () => {
    const onDismiss = vi.fn();
    render(<MeasureLayer points={[]} onDismiss={onDismiss} />);
    for (const key of ["Enter", "Esc", "e", " ", "Tab"]) {
      fireEvent.keyDown(window, { key });
    }
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cancels the picks first and leaves the tool second", () => {
    const onDismiss = vi.fn();
    const onClear = vi.fn();
    render(<MeasureLayer points={[FROM, TO]} onDismiss={onDismiss} onClear={onClear} />);

    // The two-stage Escape every drawing tool uses: the first press throws away
    // the work in hand, not the tool. Exiting on the first press would make an
    // accidental Escape cost the visitor their place as well as their picks.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: MEASURE_CLEAR_LABEL }));
    expect(onClear).toHaveBeenCalledTimes(2);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("offers no Clear before anything is picked, even when the host wires one", () => {
    // `canClear` is `onClear !== undefined && pickCount > 0`. A Clear control
    // with nothing to clear is the dead-control failure the QuickActions rule
    // bans, and Escape must fall straight through to dismissal.
    const onDismiss = vi.fn();
    const onClear = vi.fn();
    render(<MeasureLayer points={[]} onDismiss={onDismiss} onClear={onClear} />);

    expect(screen.queryByRole("button", { name: MEASURE_CLEAR_LABEL })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClear).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("falls through to dismissal when the host wires no way to clear", () => {
    const onDismiss = vi.fn();
    render(<MeasureLayer points={[FROM, TO]} onDismiss={onDismiss} />);

    // No Clear control at all rather than a dead one — the QuickActions rule.
    expect(screen.queryByRole("button", { name: MEASURE_CLEAR_LABEL })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stops listening for Escape once it is put away", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<MeasureLayer points={[]} onDismiss={onDismiss} />);
    unmount();

    // A window listener that outlives its component would swallow Escape for
    // the fullscreen control and the enquiry modal alike.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("offers a keyboard route to placing a point only when the host can serve it", () => {
    const withoutPick = render(<MeasureLayer points={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: MEASURE_CENTRE_PICK_LABEL })).toBeNull();
    withoutPick.unmount();

    const onPickAtCentre = vi.fn();
    render(<MeasureLayer points={[]} onDismiss={vi.fn()} onPickAtCentre={onPickAtCentre} />);
    const place = screen.getByRole("button", { name: MEASURE_CENTRE_PICK_LABEL });
    place.focus();
    expect(document.activeElement).toBe(place);
    fireEvent.click(place);
    expect(onPickAtCentre).toHaveBeenCalledTimes(1);
  });

  it("measures the first two picks when a buggy host sends more", () => {
    // A third dot beside a figure computed from the first two would be the
    // drawing disagreeing with the number — the one inconsistency a measuring
    // tool cannot afford. It is a host bug either way; the layer does not throw
    // over a visitor's view.
    const third: MeasurePoint = { world: [99, 99, 99], screen: { x: 0.9, y: 0.9 } };
    const { container } = render(
      <MeasureLayer points={[FROM, TO, third]} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText(MEASURE_STAT_STRAIGHT).nextElementSibling?.textContent).toBe(
      SPAN.straightLabel,
    );
    expect(container.querySelector('[data-testid="twin-measure-point-2"]')).toBeNull();
  });

  it("announces the completed measurement politely, one tick after mounting", async () => {
    render(<MeasureLayer points={[FROM, TO]} onDismiss={vi.fn()} />);

    const live = screen.getByTestId("twin-measure-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    // Empty on the first commit: a live region that mounts already carrying its
    // text is silent in most screen readers.
    expect(live.textContent).toBe("");

    await waitFor(() => {
      expect(live.textContent).toBe(measureAnnouncement(SPAN));
    });
    // Spoken, the qualification is a word, not a symbol a reader may drop.
    expect(live.textContent).toContain("approximately");
    expectNoInterval(live.textContent ?? "");
  });

  it("never renders a tier, and never renders a claim the guard bans", () => {
    const { container } = render(
      <MeasureLayer
        points={[FROM, TO]}
        onDismiss={vi.fn()}
        onClear={vi.fn()}
        onPickAtCentre={vi.fn()}
      />,
    );
    const rendered = container.textContent ?? "";

    // It cannot render one — there is no longer a prop to render — but the
    // sweep stays, because the cheap way to reintroduce the hazard is a copy
    // string, not a prop.
    for (const tier of TwinTierSchema.options) {
      expect(rendered).not.toContain(tier);
    }
    expect(findUnsupportedProposalClaim(rendered)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The integration, as far as this directory can reach it.
//
// HONESTY NOTE, and it is the important part of this file. `MeasureLayer` has NO
// consumer in the product: nothing under packages/web imports it outside these
// tests, and wiring it into TwinViewer.tsx is another lane's change. So the
// mutant "delete the whole feature" still survives this suite — deleting
// measure/ breaks only measure/'s own tests, and the /tour build is unaffected
// because /tour never used it. No test written inside this directory can close
// that; only the wiring can, and the props it needs are in the handoff.
//
// What the block below DOES close is the next-worst gap: every unit test above
// hands the component a frozen `points` array, so nothing exercised the loop the
// feature actually is — arm, pick, pick, read, clear, close — or proved the
// callbacks compose into it. `MeasureHost` is the smallest honest stand-in for
// the real host: it owns the picks, replaces the array on every pick exactly as
// the real one must, and wires all three callbacks. Mutants that survived a
// prop-driven suite (a Clear that clears nothing, a dismissal that fires but
// changes nothing, a live region that never re-announces) die here.
// -----------------------------------------------------------------------------

/** Where the host would raycast to. Fixed points, in pick order, so the journey
 *  below asserts against the same arithmetic the panel runs. */
const HOST_PICKS: readonly MeasurePoint[] = [FROM, TO];

function MeasureHost({ onClosed }: { readonly onClosed: () => void }): ReactElement | null {
  const [points, setPoints] = useState<readonly MeasurePoint[]>([]);
  const [open, setOpen] = useState(true);

  // The real host replaces the whole array on every pick (pick order is
  // identity; there is no reordering to survive), so the double does too.
  const pick = useCallback(() => {
    setPoints((current) => {
      const next = HOST_PICKS[current.length];
      return next === undefined ? current : [...current, next];
    });
  }, []);

  if (!open) {
    return null;
  }
  return (
    <MeasureLayer
      points={points}
      onPickAtCentre={pick}
      onClear={() => {
        setPoints([]);
      }}
      onDismiss={() => {
        setOpen(false);
        onClosed();
      }}
    />
  );
}

describe("MeasureLayer — driven by a host that owns the picks", () => {
  afterEach(() => {
    cleanup();
  });

  it("walks arm → pick → pick → read → clear → close", async () => {
    const onClosed = vi.fn();
    render(<MeasureHost onClosed={onClosed} />);

    // Armed, nothing picked.
    expect(screen.getByText(MEASURE_FIRST_PROMPT)).toBeTruthy();
    expect(screen.queryByText(MEASURE_CONFIDENCE_NOTE)).toBeNull();

    const place = screen.getByRole("button", { name: MEASURE_CENTRE_PICK_LABEL });

    // First pick: the prompt advances and still no figure exists.
    fireEvent.click(place);
    expect(screen.getByText(MEASURE_SECOND_PROMPT)).toBeTruthy();
    expect(screen.queryByText(MEASURE_STAT_STRAIGHT)).toBeNull();

    // Second pick: the measurement appears, computed from the picks the host
    // pushed, and qualified.
    fireEvent.click(place);
    expect(screen.getByText(MEASURE_STAT_STRAIGHT).nextElementSibling?.textContent).toBe(
      SPAN.straightLabel,
    );
    expect(screen.getByText(MEASURE_STAT_PLAN).nextElementSibling?.textContent).toBe(
      SPAN.planLabel,
    );
    expect(screen.getByText(MEASURE_CONFIDENCE_NOTE)).toBeTruthy();

    // Spoken once it settles.
    await waitFor(() => {
      expect(screen.getByTestId("twin-measure-live").textContent).toBe(
        measureAnnouncement(SPAN),
      );
    });

    // Clear really clears: the figures go, the prompt returns, the tool stays.
    fireEvent.click(screen.getByRole("button", { name: MEASURE_CLEAR_LABEL }));
    expect(screen.getByText(MEASURE_FIRST_PROMPT)).toBeTruthy();
    expect(screen.queryByText(MEASURE_STAT_STRAIGHT)).toBeNull();
    expect(screen.queryByText(MEASURE_CONFIDENCE_NOTE)).toBeNull();
    expect(screen.getByRole("group", { name: MEASURE_GROUP_LABEL })).toBeTruthy();

    // And the live region empties, so a screen reader is not left holding a
    // measurement that is no longer on screen.
    await waitFor(() => {
      expect(screen.getByTestId("twin-measure-live").textContent).toBe("");
    });

    // Close really closes.
    fireEvent.click(screen.getByRole("button", { name: MEASURE_DONE_LABEL }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("twin-measure")).toBeNull();
  });

  it("re-announces a fresh measurement after a clear", async () => {
    // The live region is keyed off the announcement text, so a second identical
    // measurement must still be spoken: the visitor cleared and re-picked, and
    // silence would read as the tool having failed.
    render(<MeasureHost onClosed={vi.fn()} />);
    const place = screen.getByRole("button", { name: MEASURE_CENTRE_PICK_LABEL });
    const live = screen.getByTestId("twin-measure-live");

    fireEvent.click(place);
    fireEvent.click(place);
    await waitFor(() => {
      expect(live.textContent).toBe(measureAnnouncement(SPAN));
    });

    fireEvent.click(screen.getByRole("button", { name: MEASURE_CLEAR_LABEL }));
    await waitFor(() => {
      expect(live.textContent).toBe("");
    });

    fireEvent.click(place);
    fireEvent.click(place);
    await waitFor(() => {
      expect(live.textContent).toBe(measureAnnouncement(SPAN));
    });
  });

  it("closes on the second Escape and releases the key", () => {
    const onClosed = vi.fn();
    render(<MeasureHost onClosed={onClosed} />);
    const place = screen.getByRole("button", { name: MEASURE_CENTRE_PICK_LABEL });

    fireEvent.click(place);
    // First Escape: picks only.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByText(MEASURE_FIRST_PROMPT)).toBeTruthy();

    // Second Escape: the tool.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("twin-measure")).toBeNull();

    // Unmounted, so Escape belongs to the rest of the viewer again.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("costs the host nothing to re-render at frame rate", () => {
    // The layer's contract asks the host to push camera-projected screen
    // positions, which on a moving camera means a React render per frame. This
    // pins that the layer itself is cheap enough for that to be a reasonable
    // thing to ask: 120 re-renders (two seconds of travel at 60 fps) with fresh
    // screen positions each time. It is a ceiling, not a benchmark — loose
    // enough not to flake on a loaded CI box, and its job is to fail loudly if
    // somebody ever puts real work on this path.
    const { rerender } = render(<MeasureLayer points={[FROM, TO]} onDismiss={vi.fn()} />);
    const started = performance.now();
    act(() => {
      for (let frame = 0; frame < 120; frame += 1) {
        const t = frame / 120;
        rerender(
          <MeasureLayer
            points={[
              { ...FROM, screen: { x: 0.25 + t * 0.1, y: 0.5 - t * 0.1 } },
              { ...TO, screen: { x: 0.75 - t * 0.1, y: 0.25 + t * 0.1 } },
            ]}
            onDismiss={vi.fn()}
          />,
        );
      }
    });
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe("measure copy", () => {
  afterEach(() => {
    cleanup();
  });

  it("passes the claim guard", () => {
    for (const line of allMeasureCopy()) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });

  it("states no interval in any line it can render", () => {
    for (const line of allMeasureCopy()) {
      expectNoInterval(line);
    }
  });

  it("publishes a non-empty list that carries what the layer actually renders", () => {
    // A sweep list that drifts from the rendered copy is worse than no sweep:
    // it reports green over strings nobody checked.
    const swept = allMeasureCopy();
    expect(swept.length).toBeGreaterThan(0);
    for (const line of [
      MEASURE_GROUP_LABEL,
      MEASURE_FIRST_PROMPT,
      MEASURE_SECOND_PROMPT,
      MEASURE_STAT_STRAIGHT,
      MEASURE_STAT_PLAN,
      MEASURE_CLEAR_LABEL,
      MEASURE_DONE_LABEL,
      MEASURE_CENTRE_PICK_LABEL,
      MEASURE_CONFIDENCE_NOTE,
      measureRiseWord(SPAN.riseM),
    ]) {
      expect(swept).toContain(line);
    }
  });

  it("sweeps every string the layer can put on screen", () => {
    // The structural half of the guarantee: whatever the component renders in
    // its fullest state must be findable in the sweep list, so a new string
    // cannot reach a visitor unswept. Figures are excluded — they are generated
    // per measurement and are covered by the interval sweep instead.
    const { container } = render(
      <MeasureLayer
        points={[FROM, TO]}
        onDismiss={vi.fn()}
        onClear={vi.fn()}
        onPickAtCentre={vi.fn()}
      />,
    );
    const swept = allMeasureCopy();
    const figures = [SPAN.straightLabel, SPAN.planLabel, SPAN.riseLabel];

    for (const node of container.querySelectorAll("p, dt, dd, button")) {
      const text = node.textContent?.trim() ?? "";
      if (text === "" || figures.includes(text)) {
        continue;
      }
      expect(swept).toContain(text);
    }
  });

  it("speaks all three figures, and never a bare one", () => {
    // Asserted against the SENTENCE, not against measureAnnouncement — every
    // other check of the live region compares it to that same function, so a
    // clause dropped from the builder would mutate both sides and pass. This is
    // the one place that says what the sentence must contain.
    //
    // The spoken form is where a bare figure would do the most damage: a
    // listener cannot glance back at the panel's note, so every figure has to
    // arrive already qualified.
    const rising = measureBetween([0, 0, 0], [3, 2, 4]);
    const falling = measureBetween([3, 2, 4], [0, 0, 0]);
    const level = measureBetween([0, 0, 0], [3, 0, 4]);

    for (const [span, direction] of [
      [rising, "higher"],
      [falling, "lower"],
    ] as const) {
      const said = measureAnnouncement(span);
      expect(said).toMatch(/^Straight line approximately /);
      expect(said).toContain("In plan approximately");
      expect(said).toContain(direction);
      // Three figures spoken, three qualifications spoken.
      expect(said.match(/approximately/g)).toHaveLength(3);
      expectNoInterval(said);
    }

    // Level is the one case with two figures rather than three, because there
    // is no height to state — but it still says so out loud rather than going
    // silent about the axis.
    const flat = measureAnnouncement(level);
    expect(flat).toContain("level");
    expect(flat.match(/approximately/g)).toHaveLength(2);
    expect(flat).not.toContain("higher");
    expect(flat).not.toContain("lower");
    expectNoInterval(flat);
  });

  it("names the rise by its direction, and calls it level when it prints as zero", () => {
    expect(measureRiseWord(1.9)).toBe(measureRiseWord(2.4));
    expect(measureRiseWord(-1.9)).not.toBe(measureRiseWord(1.9));
    // A height difference that renders as 0.00 m is not a rise of 3 mm; naming
    // it one would name a number we are not printing.
    expect(measureRiseWord(0.003)).toBe(MEASURE_RISE_LEVEL);
    expect(measureRiseWord(-0.003)).toBe(MEASURE_RISE_LEVEL);
    expect(measureRiseWord(0.02)).not.toBe(MEASURE_RISE_LEVEL);
  });
});
