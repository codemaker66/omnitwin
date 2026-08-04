import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
  type RoomDimensions,
} from "../../../lib/trades-hall-venue-truth.js";
import { metres, ROOM_DISPLAY_NAMES } from "../twin-rooms.js";
import {
  RoomDossier,
  STAT_LABEL_CEILING,
  TWIN_DOSSIER_COLLAPSE_LABEL,
  TWIN_DOSSIER_EXPAND_LABEL,
  TWIN_DOSSIER_FOOTNOTE,
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
/** A real viewpoint whose room nobody has confirmed — the common case. */
const UNVERIFIED_NODE = "scan_003";

const GRAND_HALL: PublishedRoomSlug = "grand-hall";

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
