import { ROOM_DISPLAY_NAMES, ROOM_TRUTH_PROVENANCE, VERIFIED_ROOM_NODES } from "./twin-rooms.js";
import { ROOM_SELECTOR_ORDER, formatRoomComparison } from "./room-selector.js";

// -----------------------------------------------------------------------------
// room-selector-copy — every word the Rooms panel says, as data.
//
// It lives beside its component rather than inside it for the reason
// measure-copy.ts records: the component imports its stylesheet for the side
// effect, and nothing outside a bundler can load that import. Node-side
// readers of these words (the unit suites' copy sweep, and the Playwright
// specs that assert the rendered Rooms panel against them) import this module
// instead, so no reader ever needs a second copy of a phrase.
// -----------------------------------------------------------------------------

/** The pill's label. One word, and it never changes as the visitor walks: a
 *  trigger that names the current room changes width every few steps, and the
 *  dossier already states the room prominently a few hundred pixels away. */
export const TWIN_ROOMS_TRIGGER = "Rooms";

/** The dialog's own heading. Same word as the trigger, deliberately — the panel
 *  a press opened should be recognisable as the thing that was pressed. */
export const TWIN_ROOMS_HEADING = "Rooms";

/** The list's accessible name, said once for the group so each row's own label
 *  can stay short. Worded distinctly from the quick rail's "Quick actions" so a
 *  screen reader working by accessible name never meets two identical groups. */
export const TWIN_ROOMS_ARIA = "Rooms in this walkthrough";

/** Names the act and its object: "Close" alone is ambiguous on a screen holding
 *  a dossier, an enquiry modal and a walkthrough. */
export const TWIN_ROOMS_CLOSE = "Close the room list";

/** The marker on the room underfoot. A visible string, not a colour: the row is
 *  the only one in the list that is not pressable, and that has to be legible
 *  without seeing the gold rule beside it. */
export const TWIN_ROOMS_HERE = "You are here";

/** The visitor's own storey. Relational, so it stays true whatever the forge's
 *  bucket numbering does. */
export const TWIN_ROOMS_LEVEL_HERE = "On this level";

/** A storey below the visitor's, counted in storeys and never named. */
export function twinRoomsLevelBelow(levels: number): string {
  return levels === 1 ? "One level down" : `${String(levels)} levels down`;
}

/** A storey above the visitor's. */
export function twinRoomsLevelAbove(levels: number): string {
  return levels === 1 ? "One level up" : `${String(levels)} levels up`;
}

/**
 * The act a row performs. Kept as its own exported function — rather than
 * inlined into the row label — because it is the phrase the quick rail used to
 * render, and the copy sweep's guarantee that every nameable room has a swept
 * walk label follows this string wherever it lives.
 */
export function twinRoomsWalkLabel(roomName: string): string {
  return `Walk to ${roomName}`;
}

/**
 * A row's accessible name: the act, then the same figures the row shows.
 *
 * The comparison is spliced in BYTE-IDENTICALLY rather than reformatted, which
 * is what makes Label in Name (WCAG 2.5.3) hold by construction: a speech-input
 * user saying what they can read reaches the control, and no second formatter
 * exists to drift from the first. A room with no published figures gets the act
 * alone rather than a dangling dash.
 */
export function twinRoomsRowLabel(roomName: string, comparison: string): string {
  const act = twinRoomsWalkLabel(roomName);
  return comparison === "" ? act : `${act} — ${comparison}`;
}

/** Who confirmed the figures, when, and what still moves them — verbatim from
 *  the venue-truth module, so this panel and the dossier and the public room
 *  cards all make byte-identical provenance claims. */
export const TWIN_ROOMS_FOOTNOTE = ROOM_TRUTH_PROVENANCE;

/**
 * Every user-visible string this panel can render, for the copy-claim sweep.
 *
 * ENUMERATED, not sampled — the QuickActions principle. Because the room set is
 * the frozen join and the comparison lines are composed from it, the full set of
 * renderable phrases is finite and knowable here, so the sweep covers the panel
 * exactly instead of covering one example and trusting the rest. That makes this
 * list strictly stronger than allRoomDossierCopy(), which sweeps the stat
 * LABELS but never the composed values — so "250 standing" is unswept there and
 * swept here.
 */
export function allRoomSelectorCopy(): readonly string[] {
  const lines: string[] = [
    TWIN_ROOMS_TRIGGER,
    TWIN_ROOMS_HEADING,
    TWIN_ROOMS_ARIA,
    TWIN_ROOMS_CLOSE,
    TWIN_ROOMS_HERE,
    TWIN_ROOMS_LEVEL_HERE,
    TWIN_ROOMS_FOOTNOTE,
  ];
  // Three storeys each way covers any capture this bundle format carries today;
  // the phrasing is uniform beyond one, so a fourth adds no new shape.
  for (const distance of [1, 2, 3]) {
    lines.push(twinRoomsLevelBelow(distance), twinRoomsLevelAbove(distance));
  }
  for (const slug of ROOM_SELECTOR_ORDER) {
    lines.push(twinRoomsWalkLabel(ROOM_DISPLAY_NAMES[slug]));
  }
  // Per VIEWPOINT, not per room: both validated ends of the Grand Hall compose
  // the same line today, and sweeping the viewpoints is what keeps that a
  // demonstrated fact rather than an assumption.
  for (const [nodeId, slug] of Object.entries(VERIFIED_ROOM_NODES)) {
    const comparison = formatRoomComparison(nodeId);
    if (comparison !== null) {
      lines.push(comparison, twinRoomsRowLabel(ROOM_DISPLAY_NAMES[slug], comparison));
    }
  }
  return lines;
}
