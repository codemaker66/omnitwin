import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim, type TwinScanNode } from "@omnitwin/types";
import { ROOM_DISPLAY_NAMES, ROOM_TRUTH_PROVENANCE, VERIFIED_ROOM_NODES } from "../twin-rooms.js";
import { ROOM_SELECTOR_ORDER, formatRoomComparison, pickRoomTarget } from "../room-selector.js";
import {
  ROOMS_SLOT,
  RoomSelector,
  TWIN_ROOMS_ARIA,
  TWIN_ROOMS_CLOSE,
  TWIN_ROOMS_FOOTNOTE,
  TWIN_ROOMS_HEADING,
  TWIN_ROOMS_HERE,
  TWIN_ROOMS_LEVEL_HERE,
  TWIN_ROOMS_TRIGGER,
  allRoomSelectorCopy,
  twinRoomsLevelAbove,
  twinRoomsLevelBelow,
  twinRoomsRowLabel,
  twinRoomsWalkLabel,
} from "../RoomSelector.js";

// -----------------------------------------------------------------------------
// RoomSelector — the panel that replaces 149 identical dots.
//
// What the dot cloud told a wedding customer was: nothing. Same mark for every
// viewpoint, two buttons reading "Floor -1" and "Floor 0", 120px wide on a phone
// where the dots became a smear — and on that phone it painted over the quick
// rail, because both sit at z-index 3 and the map mounted last. This panel
// answers the questions a venue customer actually has (which rooms, how big,
// same level?) with four rows and a handful of tab stops.
//
// Three properties are load-bearing and each has its own section below.
//
// IT CANNOT NAME A ROOM NOBODY VALIDATED. It takes no room list from its caller
// — unlike QuickActions, whose `destinations` prop exists to stop a caller
// inventing a name. Here the same guarantee comes from reading the frozen join
// directly, so there is no prop through which a fifth room could arrive.
//
// IT IS SILENT WHERE IT MUST BE. At 144 of 149 viewpoints no row is marked: no
// "Between rooms", no dimmed hedge. The level headings still render, because
// `floor` is real data at every node — which is the design's best moment, and
// the assertion that pins it is "still groups by level at an unvalidated
// viewpoint".
//
// IT COVERS NOTHING AT REST. happy-dom performs no layout, so a rendering test
// cannot see two panels overlapping. The HUD-slot section therefore does the
// arithmetic against the shipped stylesheets, in the idiom ViewpointPlan.test
// established: model every rectangle from CSS, pin every declaration the model
// used, prove disjointness.
// -----------------------------------------------------------------------------

function node(id: string, x: number, y: number, floor: number): TwinScanNode {
  return {
    id,
    index: Number(id.slice(-3)),
    pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] },
    floor,
    roomSlug: null,
  };
}

/** The five validated viewpoints at their real plan positions, plus one
 *  unvalidated node upstairs — the overwhelmingly common case. */
const NODES: readonly TwinScanNode[] = [
  node("scan_003", 2, 2, 0),
  node("scan_028", 14.9, -3.5, 0),
  node("scan_046", 5.6, -3.8, 0),
  node("scan_058", -2.3, 8.3, 0),
  node("scan_105", -0.3, -11.1, -1),
  node("scan_126", 13.9, 5.1, -1),
];

function mount(
  overrides: Partial<{ nodes: readonly TwinScanNode[]; currentId: string }> = {},
): { onWalkTo: ReturnType<typeof vi.fn>; outerClick: ReturnType<typeof vi.fn> } {
  const onWalkTo = vi.fn();
  const outerClick = vi.fn();
  render(
    // The outer div is not decoration: it is how "the backdrop swallows the
    // click" is proved. Click-anywhere travel is the walk's primary mechanic,
    // so a dismissing click that also reached the view would walk the visitor
    // somewhere they never chose.
    <div onClick={outerClick}>
      <RoomSelector
        nodes={overrides.nodes ?? NODES}
        currentId={overrides.currentId ?? "scan_028"}
        onWalkTo={onWalkTo}
      />
    </div>,
  );
  return { onWalkTo, outerClick };
}

function openPanel(): HTMLElement {
  fireEvent.click(screen.getByTestId("twin-rooms-trigger"));
  return screen.getByTestId("twin-rooms-panel");
}

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------------
// What it says, and what it refuses to say
// -----------------------------------------------------------------------------

describe("RoomSelector — the rooms it offers", () => {
  it("offers exactly the validated rooms, and no gallery", () => {
    mount();
    openPanel();
    for (const slug of ROOM_SELECTOR_ORDER) {
      expect(screen.getByText(ROOM_DISPLAY_NAMES[slug])).toBeTruthy();
    }
    expect(screen.queryByText(ROOM_DISPLAY_NAMES["north-gallery"])).toBeNull();
    expect(screen.queryByText(ROOM_DISPLAY_NAMES["south-gallery"])).toBeNull();
  });

  it("prints a comparison line joined from venue truth on every row", () => {
    mount();
    openPanel();
    for (const [nodeId, slug] of Object.entries(VERIFIED_ROOM_NODES)) {
      const comparison = formatRoomComparison(nodeId);
      expect(comparison).not.toBeNull();
      if (comparison !== null && ROOM_SELECTOR_ORDER.includes(slug)) {
        expect(screen.getAllByText(comparison).length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the comparison line on the row the visitor is standing in", () => {
    // Ragged rows do not compare. The current room loses its button, not its
    // figures — that is the entire reason the panel is worth opening.
    mount({ currentId: "scan_028" });
    openPanel();
    const here = screen.getByTestId("twin-rooms-here-grand-hall");
    expect(here.textContent).toContain(formatRoomComparison("scan_028"));
  });

  it("carries the venue's own provenance, verbatim, once", () => {
    mount();
    openPanel();
    expect(screen.getByText(ROOM_TRUTH_PROVENANCE)).toBeTruthy();
    expect(TWIN_ROOMS_FOOTNOTE).toBe(ROOM_TRUTH_PROVENANCE);
  });

  it("renders nothing at all when the bundle offers no room", () => {
    render(<RoomSelector nodes={[]} currentId="scan_028" onWalkTo={vi.fn()} />);
    expect(screen.queryByTestId("twin-rooms-trigger")).toBeNull();
  });
});

describe("RoomSelector — where you are, and the silence", () => {
  it("marks the room underfoot as a statement, not a disabled button", () => {
    // A disabled control invites a press that does nothing. The current room is
    // not a control at all.
    mount({ currentId: "scan_058" });
    openPanel();
    const here = screen.getByTestId("twin-rooms-here-saloon");
    expect(here.tagName).not.toBe("BUTTON");
    expect(here.getAttribute("aria-current")).toBe("location");
    expect(here.textContent).toContain(TWIN_ROOMS_HERE);
    expect(
      screen.queryByRole("button", { name: new RegExp(ROOM_DISPLAY_NAMES.saloon) }),
    ).toBeNull();
  });

  it("marks both ends of the Grand Hall, because they are one room", () => {
    for (const id of ["scan_028", "scan_046"]) {
      mount({ currentId: id });
      openPanel();
      expect(screen.getByTestId("twin-rooms-here-grand-hall")).toBeTruthy();
      cleanup();
    }
  });

  it("marks nothing, and hedges nothing, at an unvalidated viewpoint", () => {
    // 144 of 149. Four equal travel rows and no claim about where the visitor
    // is: no "Between rooms", no placeholder, no dimmed row.
    mount({ currentId: "scan_003" });
    const panel = openPanel();
    expect(panel.querySelector("[aria-current]")).toBeNull();
    expect(panel.textContent).not.toContain(TWIN_ROOMS_HERE);
    expect(screen.getAllByTestId(/^twin-rooms-row-/u)).toHaveLength(
      ROOM_SELECTOR_ORDER.length,
    );
  });

  it("still groups by level at an unvalidated viewpoint", () => {
    // The panel is MORE useful when you are lost than the dossier is, and it
    // makes no claim it cannot support: "the Saloon is on this level" is true at
    // all 149 viewpoints because `floor` is required data on every node.
    mount({ currentId: "scan_003" });
    openPanel();
    expect(screen.getByText(TWIN_ROOMS_LEVEL_HERE)).toBeTruthy();
    expect(screen.getByText(twinRoomsLevelBelow(1))).toBeTruthy();
  });
});

describe("RoomSelector — levels, named relationally", () => {
  it("groups the two storeys and leads with the visitor's own", () => {
    mount({ currentId: "scan_028" });
    const panel = openPanel();
    const headings = [...panel.querySelectorAll("[data-testid='twin-rooms-level']")].map(
      (element) => element.textContent,
    );
    expect(headings).toEqual([TWIN_ROOMS_LEVEL_HERE, twinRoomsLevelBelow(1)]);
  });

  it("says 'one level up' from downstairs", () => {
    mount({ currentId: "scan_105" });
    const panel = openPanel();
    const headings = [...panel.querySelectorAll("[data-testid='twin-rooms-level']")].map(
      (element) => element.textContent,
    );
    expect(headings).toEqual([TWIN_ROOMS_LEVEL_HERE, twinRoomsLevelAbove(1)]);
  });

  it("renders no heading when every room is on one level", () => {
    // A single-level bundle gets a flat list. A heading stating the obvious is
    // chrome, and this panel floats over a photograph.
    mount({ nodes: NODES.filter((entry) => entry.floor === 0), currentId: "scan_028" });
    const panel = openPanel();
    expect(panel.querySelector("[data-testid='twin-rooms-level']")).toBeNull();
  });

  it("never prints a storey number or the scanner's word for one", () => {
    // "Floor -1" is what the minimap printed at a wedding customer, and
    // "Ground floor" would be an inference about the building — the same class
    // of error as inferring a room.
    for (const line of [
      TWIN_ROOMS_LEVEL_HERE,
      twinRoomsLevelBelow(1),
      twinRoomsLevelBelow(2),
      twinRoomsLevelAbove(1),
      twinRoomsLevelAbove(3),
    ]) {
      expect(line.toLowerCase()).not.toContain("floor");
      expect(line.toLowerCase()).not.toContain("ground");
      expect(line.toLowerCase()).not.toContain("basement");
      for (const name of Object.values(ROOM_DISPLAY_NAMES)) {
        expect(line).not.toContain(name);
      }
    }
    expect(TWIN_ROOMS_LEVEL_HERE).not.toMatch(/\d/u);
    expect(twinRoomsLevelBelow(1)).not.toMatch(/\d/u);
    expect(twinRoomsLevelAbove(1)).not.toMatch(/\d/u);
  });

  it("counts in words at one storey and in numerals beyond", () => {
    expect(twinRoomsLevelBelow(1)).toBe("One level down");
    expect(twinRoomsLevelAbove(1)).toBe("One level up");
    expect(twinRoomsLevelBelow(2)).toContain("levels down");
    expect(twinRoomsLevelAbove(2)).toContain("levels up");
  });
});

// -----------------------------------------------------------------------------
// Travel
// -----------------------------------------------------------------------------

describe("RoomSelector — a press travels", () => {
  it("asks the host to glide to the nearer viewpoint of the room", () => {
    const { onWalkTo } = mount({ currentId: "scan_058" });
    openPanel();
    fireEvent.click(screen.getByTestId("twin-rooms-row-grand-hall"));
    expect(onWalkTo).toHaveBeenCalledTimes(1);
    expect(onWalkTo).toHaveBeenCalledWith(pickRoomTarget("grand-hall", "scan_058", NODES));
  });

  it("dismisses before it travels, so the visitor sees the walk start", () => {
    const { onWalkTo } = mount();
    openPanel();
    fireEvent.click(screen.getByTestId("twin-rooms-row-saloon"));
    expect(screen.queryByTestId("twin-rooms-panel")).toBeNull();
    expect(onWalkTo).toHaveBeenCalledTimes(1);
  });

  it("hands back a node id the join already carries", () => {
    // The one assertion that would catch a display string, an index, or a slug
    // reaching the Usher.
    const { onWalkTo } = mount({ currentId: "scan_003" });
    for (const slug of ROOM_SELECTOR_ORDER) {
      openPanel();
      fireEvent.click(screen.getByTestId(`twin-rooms-row-${slug}`));
    }
    expect(onWalkTo.mock.calls.length).toBe(ROOM_SELECTOR_ORDER.length);
    for (const call of onWalkTo.mock.calls) {
      expect(VERIFIED_ROOM_NODES[String(call[0])]).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// The dialog, and the keyboard
// -----------------------------------------------------------------------------

describe("RoomSelector — the trigger", () => {
  it("is always on screen and never changes its label", () => {
    // A trigger whose text is the room name changes width as you walk, and the
    // dossier already names the room prominently.
    for (const id of ["scan_028", "scan_058", "scan_003", "scan_126"]) {
      mount({ currentId: id });
      const trigger = screen.getByTestId("twin-rooms-trigger");
      expect(trigger.textContent).toContain(TWIN_ROOMS_TRIGGER);
      for (const name of Object.values(ROOM_DISPLAY_NAMES)) {
        expect(trigger.textContent).not.toContain(name);
      }
      cleanup();
    }
  });

  it("declares the dialog it opens", () => {
    mount();
    const trigger = screen.getByTestId("twin-rooms-trigger");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const panel = openPanel();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    const labelledBy = panel.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(String(labelledBy))?.textContent).toBe(
      TWIN_ROOMS_HEADING,
    );
  });

  it("is one tab stop at rest, and a handful when open — not a hundred and fifty", () => {
    // The headline accessibility win over the minimap's 149-option listbox.
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    openPanel();
    const stops = screen.getAllByRole("button").length;
    expect(stops).toBeGreaterThanOrEqual(2);
    expect(stops).toBeLessThanOrEqual(6);
  });
});

describe("RoomSelector — dismissal and focus", () => {
  it("moves the caret into the panel on open and returns it on close", () => {
    mount();
    const panel = openPanel();
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByLabelText(TWIN_ROOMS_CLOSE));
    expect(document.activeElement).toBe(screen.getByTestId("twin-rooms-trigger"));
  });

  it("closes on Escape and returns the caret", () => {
    mount();
    const panel = openPanel();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("twin-rooms-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("twin-rooms-trigger"));
  });

  it("closes on a backdrop press and swallows the click", () => {
    const { outerClick, onWalkTo } = mount();
    openPanel();
    fireEvent.click(screen.getByTestId("twin-rooms-backdrop"));
    expect(screen.queryByTestId("twin-rooms-panel")).toBeNull();
    expect(onWalkTo).not.toHaveBeenCalled();
    // The click never reaches the view beneath, so dismissing the panel cannot
    // walk the visitor somewhere they did not choose.
    expect(outerClick).not.toHaveBeenCalled();
  });

  it("traps the caret while it is open, because you are not walking", () => {
    // Unlike RoomDossier, which must NEVER trap — that panel is ambient chrome
    // over a live view and a visitor tabbing past it has to be able to keep
    // walking. This one is modal: there is exactly one thing to do in it.
    mount();
    const panel = openPanel();
    const stops = [...panel.querySelectorAll<HTMLElement>("button")];
    const first = stops[0];
    const last = stops[stops.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) {
      return;
    }
    last.focus();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("names each row with the same words it shows", () => {
    // WCAG 2.5.3 Label in Name, held by construction: the accessible name reuses
    // the visible comparison string byte-for-byte, so a speech-input user saying
    // what they can read reaches the control.
    mount({ currentId: "scan_003" });
    openPanel();
    for (const slug of ROOM_SELECTOR_ORDER) {
      const row = screen.getByTestId(`twin-rooms-row-${slug}`);
      const name = ROOM_DISPLAY_NAMES[slug];
      const comparison = formatRoomComparison(pickRoomTarget(slug, "scan_003", NODES) ?? "");
      expect(comparison).not.toBeNull();
      expect(row.textContent).toContain(comparison);
      expect(row.getAttribute("aria-label")).toBe(
        twinRoomsRowLabel(name, String(comparison)),
      );
      expect(row.getAttribute("aria-label")).toContain(twinRoomsWalkLabel(name));
    }
  });
});

// -----------------------------------------------------------------------------
// The copy sweep
// -----------------------------------------------------------------------------

describe("RoomSelector — copy", () => {
  it("passes the claim guard on every line it can render", () => {
    for (const line of allRoomSelectorCopy()) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });

  it("enumerates every room, rather than sampling one", () => {
    // The QuickActions principle. A sweep list that covers one example and
    // trusts the rest reports green over copy nobody checked — so a sixth room
    // added to twin-rooms cannot ship an unswept label or an unswept figure.
    const swept = allRoomSelectorCopy();
    for (const slug of ROOM_SELECTOR_ORDER) {
      expect(swept).toContain(twinRoomsWalkLabel(ROOM_DISPLAY_NAMES[slug]));
    }
    for (const nodeId of Object.keys(VERIFIED_ROOM_NODES)) {
      const comparison = formatRoomComparison(nodeId);
      expect(comparison).not.toBeNull();
      expect(swept.some((line) => line.includes(String(comparison)))).toBe(true);
    }
  });

  it("sweeps the composed figures, which the dossier's own list does not", () => {
    // allRoomDossierCopy() sweeps stat LABELS but never the composed values, so
    // "250 standing" is unswept there. This list is strictly stronger.
    const swept = allRoomSelectorCopy();
    const composed = formatRoomComparison("scan_028");
    expect(composed).not.toBeNull();
    expect(swept.some((line) => line.includes(String(composed)))).toBe(true);
  });

  it("publishes a non-empty list", () => {
    expect(allRoomSelectorCopy().length).toBeGreaterThan(0);
    expect(TWIN_ROOMS_ARIA.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// THE HUD SLOT — proved by arithmetic against the shipped stylesheets.
//
// happy-dom performs no layout: every getBoundingClientRect is 0×0, so a
// rendering test literally cannot see two panels on top of each other. That is
// how the minimap came to paint over the quick rail on a phone. The answer is
// not to give up on proving it — it is to model every HUD rectangle from the CSS
// that produces it, pin every placement number the model used, and do the sums.
//
// THIS MODEL SHIPPED A FALSE GREEN, and both reasons are fixed below rather than
// papered over. At 844×390 the Rooms pill really did sit on the room dossier's
// provenance sentence — MEASURED in Chromium, dossier [18,62,358,299] against
// trigger [18,259,186,294] — while this file reported no collision at all.
//
//   1. It never read room-dossier.css's `@media (max-height: 460px)` block,
//      which relaxes the card's cap from `100dvh - 200px` to `100dvh - 120px`.
//      A model that does not know a breakpoint exists cannot be conservative
//      about it: at 390px of height it under-read the cap by 70px.
//
//   2. Its dossier HEIGHT was that cap — a viewport figure — so the "deliberate
//      OVER-estimate" this banner used to claim was not an over-estimate in
//      either direction, merely a different number. The height is now derived
//      from the card's CONTENT and then clamped by whichever cap the media
//      queries leave standing, which is what a browser actually does.
//
// The matrix gained 844×390 and 667×375. Every collision ever found in this HUD
// has been at landscape-phone proportions, and a matrix holding no short
// viewport cannot find one.
//
// HEIGHTS remain the one part no stylesheet states. They are deliberate
// over-estimates from the declared padding, border and font-size — and the
// dossier's, the one that mattered, is pinned against heights measured off the
// shipped render, so that claim is now demonstrated rather than asserted.
// -----------------------------------------------------------------------------

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

const TWIN_CSS = readSource("src/twin/twin.css");
const DOSSIER_CSS = readSource("src/twin/shell/room-dossier.css");
const QUICK_CSS = readSource("src/twin/shell/quick-actions.css");
const ROOMS_CSS = readSource("src/twin/shell/room-selector.css");
/** The measure tool shares this pill's slot — one mode-appropriate occupant at a
 *  time — so both stylesheets are pinned to ONE set of numbers, here. */
const MEASURE_CSS = readSource("src/twin/measure/measure.css");

interface SlotRect {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Viewport {
  readonly w: number;
  readonly h: number;
}

function boxAt(name: string, left: number, top: number, width: number, height: number): SlotRect {
  return { name, left, top, right: left + width, bottom: top + height };
}

/** Two rects share area. Touching edges do not count — a 0px gap is a gap. */
function overlaps(a: SlotRect, b: SlotRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** A quick-action chip's outer height: padding + border + a 1.5 line box, rounded
 *  up. 0.72rem desktop, 0.62rem below 480px. */
const CHIP_H = 34;
const CHIP_H_PHONE = 31;
/** The 480px block wraps the rail in 6px of block padding when it becomes a
 *  scrolling row, so the rail's BOX is taller than its chip there. */
const RAIL_PAD_PHONE = 12;

/**
 * The room dossier's own height in CSS px, before any cap.
 *
 * Content-derived, which is the half of this model that was wrong. MEASURED
 * heights off the shipped render, taken in Chromium at deviceScaleFactor 1:
 *
 *   1440×900   [18,62,358,299]  → 237
 *   844×390    [18,62,358,299]  → 237
 *   390×844    [12,56,272,306]  → 250   (the phone card is the tallest)
 *
 * 264 clears the tallest of those by 14px, so the model errs towards reporting a
 * collision that is not there — which is the only direction a slot proof may
 * ever err. It is asserted against that 250 below rather than left as folklore:
 * a magic number nobody can re-derive is how the first version of this model
 * came to be believed.
 */
const DOSSIER_CONTENT_H = 264;

/** The tallest the dossier has ever been measured at. Pins the claim above. */
const DOSSIER_MEASURED_MAX_H = 250;

/**
 * The dossier's rendered height: its content, clamped by whichever `max-height`
 * the media queries actually leave standing.
 *
 * The short-viewport cap is the one the old model never read, and it is the
 * looser of the two — `100dvh - 120px` against `100dvh - 200px` — so missing it
 * made the card look 70px shorter than it is at 390px of height. That is the
 * whole 35px overlap, and then some.
 */
function dossierHeight(v: Viewport, phone: boolean): number {
  const cap = v.h - (v.h <= 460 ? 120 : phone ? 230 : 200);
  return Math.min(DOSSIER_CONTENT_H, cap);
}

/**
 * Every HUD rectangle except the Rooms trigger, in CSS px.
 *
 * `quickChips` is a parameter rather than a constant because it is the one thing
 * the parent controls: this panel ABSORBS the rail's "Walk to <room>" chips, and
 * the wiring change that drops them is what keeps the left column honest.
 * Passing it in turns the parent's obligation into something provable — see the
 * test below.
 *
 * THE MINIMAP IS ABSENT, and its absence is what makes the new slot work. It is
 * no longer mounted by TwinViewer; this panel replaces it. That frees the
 * bottom-right corner, which is where the trigger now lives.
 */
function occupiedHudRects(v: Viewport, quickChips: number): readonly SlotRect[] {
  const phone = v.w <= 700;
  const tiny = v.w <= 480;

  const dossierLeft = phone ? 12 : 18;
  const dossierWidth = phone ? Math.min(320, v.w - 130) : Math.min(340, v.w - 150);
  const dossierTop = phone ? 56 : 62;

  const chip = tiny ? CHIP_H_PHONE : CHIP_H;
  // Column above 480px (chips stacked, 8px gaps); one padded scrolling row below.
  const railHeight = tiny
    ? chip + RAIL_PAD_PHONE
    : quickChips * chip + Math.max(0, quickChips - 1) * 8;
  const railBottom = phone ? 88 : 56;
  const railWidth = phone ? Math.min(280, v.w - 170) : Math.min(300, v.w - 110);

  // twin.css switches the label, mode, surface, controls and disclosure at 480 —
  // NOT at the 700 the dossier and the rail use. Two breakpoints, and reading
  // one of them for all five is the same class of mistake as missing the
  // short-viewport block: the model has to speak each stylesheet's own dialect.
  const rightInset = tiny ? 12 : 18;

  return [
    boxAt("node label", tiny ? 12 : 18, tiny ? 12 : 18, v.w / 2, 34),
    boxAt("mode control", v.w - rightInset - 260, tiny ? 12 : 18, 260, 34),
    boxAt("surface", v.w - rightInset - 103, tiny ? 52 : 62, 103, 30),
    boxAt("utility rail", v.w - rightInset - 112, tiny ? 88 : 106, 112, 131),
    boxAt(
      "room dossier",
      dossierLeft,
      dossierTop,
      dossierWidth,
      dossierHeight(v, phone),
    ),
    boxAt(
      "quick actions",
      phone ? 12 : 18,
      v.h - railBottom - railHeight,
      railWidth,
      railHeight,
    ),
    boxAt(
      "viewer disclosure",
      tiny ? 12 : 18,
      v.h - (tiny ? 10 : 14) - 44,
      tiny ? v.w - 24 : 416,
      44,
    ),
    boxAt("coach hint", v.w / 2 - 190, v.h - 64 - 37, 380, 37),
  ];
}

/** The trigger's own rectangle, from ROOMS_SLOT — the same numbers both
 *  stylesheets are pinned to below. Width is its cap: the label is one word and
 *  never changes, so the cap is a gross over-estimate in the useful direction.
 *
 *  The short-viewport branch is not decoration. `@media (max-height: 460px)`
 *  is ordered after the width block in the stylesheet and therefore wins, so a
 *  model that applied the phone bottom at 667×375 would place the pill 90px
 *  above where it paints — and straight through the utility rail. */
function triggerRect(v: Viewport): SlotRect {
  const phone = v.w <= ROOMS_SLOT.phoneBreakpointPx;
  const short = v.h <= ROOMS_SLOT.shortBreakpointPx;
  const height = phone ? 33 : 36;
  const bottom = short
    ? ROOMS_SLOT.shortBottomPx
    : phone
      ? ROOMS_SLOT.phoneBottomPx
      : ROOMS_SLOT.bottomPx;
  const inset = phone ? ROOMS_SLOT.phoneRightPx : ROOMS_SLOT.rightPx;
  return boxAt(
    "rooms trigger",
    v.w - inset - ROOMS_SLOT.maxWidthPx,
    v.h - bottom - height,
    ROOMS_SLOT.maxWidthPx,
    height,
  );
}

const RENDERS_AT: readonly Viewport[] = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  // The two landscape phones. 844×390 is where the previous slot was caught
  // sitting on the dossier; 667×375 is where the phone bottom would put the
  // pill through the utility rail if the short-viewport rule went missing.
  { w: 844, h: 390 },
  { w: 667, h: 375 },
  { w: 390, h: 844 },
  { w: 360, h: 640 },
];

describe("RoomSelector — the HUD slot", () => {
  for (const viewport of RENDERS_AT) {
    it(`covers nothing at ${String(viewport.w)}×${String(viewport.h)}`, () => {
      const trigger = triggerRect(viewport);
      expect(trigger.left).toBeGreaterThanOrEqual(0);
      expect(trigger.right).toBeLessThanOrEqual(viewport.w);
      expect(trigger.top).toBeGreaterThan(0);
      expect(trigger.bottom).toBeLessThanOrEqual(viewport.h);

      const collisions = occupiedHudRects(viewport, 1)
        .filter((other) => overlaps(trigger, other))
        .map((other) => other.name);
      expect(collisions).toEqual([]);
    });
  }

  it("would have caught the landscape-phone collision that shipped", () => {
    // The regression, stated as the two numbers that made it: the dossier's own
    // stylesheet says its cap at 390px of height is `100dvh - 120px`, not the
    // `100dvh - 200px` the old model read — and the card is 237px of content
    // there, which the cap does not reach. Both facts are asserted, so a future
    // edit that reverts either one fails here rather than at a customer.
    const landscape: Viewport = { w: 844, h: 390 };
    expect(DOSSIER_CSS).toContain("@media (max-height: 460px)");
    expect(DOSSIER_CSS).toContain("max-height: calc(100dvh - 120px);");
    expect(dossierHeight(landscape, false)).toBe(DOSSIER_CONTENT_H);
    // The old slot: left column, bottom 96. Reconstructed rather than described,
    // so "it used to collide" is a computation and not a memory.
    const oldTrigger = boxAt("old rooms trigger", 18, 390 - 96 - 36, 168, 36);
    const dossier = occupiedHudRects(landscape, 1).find(
      (entry) => entry.name === "room dossier",
    );
    expect(dossier).toBeDefined();
    expect(dossier !== undefined && overlaps(oldTrigger, dossier)).toBe(true);
    // And the slot that shipped instead does not.
    expect(dossier !== undefined && overlaps(triggerRect(landscape), dossier)).toBe(false);
  });

  it("keeps the dossier model an over-estimate of the measured render", () => {
    // The banner claims these heights err towards a false collision. This is
    // that claim, checked: an under-estimate is what let the pill through.
    expect(DOSSIER_CONTENT_H).toBeGreaterThan(DOSSIER_MEASURED_MAX_H);
  });

  it("proves why the walk chips must leave the rail, not merely assert it", () => {
    // Four chips at 844×390 bury the room dossier. That is not a projection: the
    // shipped build MEASURES `.vv-twin-quick` at [18,169,261,334] against
    // `.vv-twin-dossier` at [18,62,358,299] — 130px of the dossier under the
    // rail, today, on the live dev server. Dropping the walk chips into the
    // Rooms panel is what resolves it, so the wiring change is a precondition
    // with a failing test behind it rather than a line in a handoff note.
    const landscape: Viewport = { w: 844, h: 390 };
    const crowded = occupiedHudRects(landscape, 4).find(
      (entry) => entry.name === "quick actions",
    );
    const dossier = occupiedHudRects(landscape, 4).find(
      (entry) => entry.name === "room dossier",
    );
    expect(crowded).toBeDefined();
    expect(dossier).toBeDefined();
    expect(crowded !== undefined && dossier !== undefined && overlaps(crowded, dossier)).toBe(
      true,
    );
  });

  it("stays clear of the controls a visitor reaches for most, at every size", () => {
    // Share, Fullscreen and Enquire live in the utility rail, and a panel that
    // disables one of them is the failure this whole section exists to prevent
    // (ViewpointPlan's first slot did exactly that, at top:150px right:18px).
    for (const viewport of RENDERS_AT) {
      const trigger = triggerRect(viewport);
      const rects = occupiedHudRects(viewport, 1);
      for (const name of [
        "utility rail",
        "mode control",
        "surface",
        "room dossier",
        "quick actions",
        "viewer disclosure",
        "coach hint",
        "node label",
      ]) {
        const other = rects.find((entry) => entry.name === name);
        expect(other).toBeDefined();
        expect(other !== undefined && overlaps(trigger, other)).toBe(false);
      }
    }
  });

  it("pins every placement number the model used to the stylesheet it came from", () => {
    for (const declaration of [
      "bottom: calc(64px + env(safe-area-inset-bottom));", // .vv-twin-coach
      "bottom: calc(14px + env(safe-area-inset-bottom));", // .vv-twin-viewer-disclosure
      "bottom: calc(10px + env(safe-area-inset-bottom));", // …at ≤480px
      "top: calc(106px + env(safe-area-inset-top));", // .vv-twin-controls
      "top: calc(88px + env(safe-area-inset-top));", // …at ≤480px
      "max-width: 26rem;", // .vv-twin-viewer-disclosure
    ]) {
      expect(TWIN_CSS).toContain(declaration);
    }

    for (const declaration of [
      "top: calc(62px + env(safe-area-inset-top));",
      "max-height: calc(100dvh - 200px);",
      "top: calc(56px + env(safe-area-inset-top));",
      "max-height: calc(100dvh - 230px);",
      // The override the old model never read. Its absence is half the defect.
      "max-height: calc(100dvh - 120px);",
    ]) {
      expect(DOSSIER_CSS).toContain(declaration);
    }

    for (const declaration of [
      "bottom: calc(56px + env(safe-area-inset-bottom));",
      "bottom: calc(88px + env(safe-area-inset-bottom));",
      "gap: 8px;",
      "padding: 6px 32px 6px 0;",
      "max-width: min(280px, calc(100vw - 170px));",
    ]) {
      expect(QUICK_CSS).toContain(declaration);
    }
  });

  it("spells ROOMS_SLOT into BOTH stylesheets that use it", () => {
    // The Rooms pill and the measure pill share this slot, one per mode. Two
    // pills in one corner differing by three pixels read as a bug, so the two
    // stylesheets are pinned to the same constant rather than to each other.
    for (const sheet of [ROOMS_CSS, MEASURE_CSS]) {
      expect(sheet).toContain(
        `right: calc(${String(ROOMS_SLOT.rightPx)}px + env(safe-area-inset-right));`,
      );
      expect(sheet).toContain(
        `bottom: calc(${String(ROOMS_SLOT.bottomPx)}px + env(safe-area-inset-bottom));`,
      );
      expect(sheet).toContain(`@media (max-width: ${String(ROOMS_SLOT.phoneBreakpointPx)}px)`);
      expect(sheet).toContain(
        `right: calc(${String(ROOMS_SLOT.phoneRightPx)}px + env(safe-area-inset-right));`,
      );
      expect(sheet).toContain(
        `bottom: calc(${String(ROOMS_SLOT.phoneBottomPx)}px + env(safe-area-inset-bottom));`,
      );
      expect(sheet).toContain(
        `@media (max-height: ${String(ROOMS_SLOT.shortBreakpointPx)}px)`,
      );
      expect(sheet).toContain(`max-width: ${String(ROOMS_SLOT.maxWidthPx)}px;`);
    }
  });

  it("no longer mounts the minimap it replaced, so the corner is really free", () => {
    // The whole disjointness argument for the new slot is that the bottom-right
    // corner is empty. That is only true while TwinViewer does not render the
    // map, so the wiring is asserted here rather than trusted.
    const viewer = readSource("src/twin/TwinViewer.tsx");
    expect(viewer).not.toContain("<TwinMinimap");
    expect(viewer).toContain("<RoomSelector");
  });
});

describe("RoomSelector — the stylesheet's own obligations", () => {
  it("positions both halves, because a flow-laid panel is clipped away", () => {
    // `.vv-twin-stage { overflow: hidden }` has eaten an unpositioned HUD panel
    // twice in this file's neighbourhood. The trigger is absolute inside the
    // viewer; the modal is fixed to the window, the .vv-twin-enq-overlay idiom.
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-trigger \{[^}]*position: absolute;/u);
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-backdrop \{[^}]*position: fixed;/u);
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-panel \{[^}]*position: fixed;/u);
  });

  it("stacks the trigger in the HUD and the modal above the coach", () => {
    // Trigger 3 (the HUD layer, alongside the rail); backdrop 12 and panel 13 —
    // above the coach hint at 4, below the enquiry modal at 20.
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-trigger \{[^}]*z-index: 3;/u);
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-backdrop \{[^}]*z-index: 12;/u);
    expect(ROOMS_CSS).toMatch(/\.vv-twin-rooms-panel \{[^}]*z-index: 13;/u);
    expect(TWIN_CSS).toContain("z-index: 20;");
  });

  it("resolves instantly to the final state under reduced motion", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/u.exec(
      ROOMS_CSS,
    );
    expect(reduced).not.toBeNull();
    const block = reduced?.[1] ?? "";
    expect(block).toContain("animation: none;");
    expect(block).toContain("transition: none;");
    expect(block).toContain("transform: none;");
  });

  it("keeps the dead space around the trigger click-through", () => {
    // The .vv-twin-controls contract: a click that lands beside a HUD control
    // still travels the walk. Only the pressable pill takes pointer events.
    expect(ROOMS_CSS).toContain("pointer-events: auto;");
  });
});
