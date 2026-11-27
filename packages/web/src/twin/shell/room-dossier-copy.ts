import { lookUpRoom, ROOM_TRUTH_PROVENANCE, VERIFIED_ROOM_NODES } from "./twin-rooms.js";

// -----------------------------------------------------------------------------
// room-dossier-copy — every word the room dossier says, as data.
//
// It lives beside its component rather than inside it for the reason
// measure-copy.ts records: the component imports its stylesheet for the side
// effect, and nothing outside a bundler can load that import. Node-side
// readers of these words (the unit suites' copy sweep, and the Playwright
// specs that assert the rendered room dossier against them) import this module
// instead, so no reader ever needs a second copy of a phrase.
// No figure lives here: the dossier's numbers arrive joined from twin-rooms
// at render time.
// -----------------------------------------------------------------------------

/** Toggle labels, phrased as the action the press will take — the house idiom
 *  from TWIN_FULLSCREEN_ENTER / TWIN_FULLSCREEN_EXIT. */
export const TWIN_DOSSIER_COLLAPSE_LABEL = "Hide room details";
export const TWIN_DOSSIER_EXPAND_LABEL = "Show room details";

/** The honest qualifier beneath the figures: who confirmed them, when, and what
 *  still moves them.
 *
 *  Taken verbatim from the venue-truth module rather than reworded, so this
 *  panel and the public room cards make byte-identical provenance claims. A
 *  paraphrase is a second claim about someone else's data: it can quietly firm
 *  up "planning guide", or outlive the date it cites, and no test would catch
 *  either. */
export const TWIN_DOSSIER_FOOTNOTE = ROOM_TRUTH_PROVENANCE;

/**
 * Primary action, rendered only when the host wires `onCompose` — so the label
 * can promise something the twin actually does.
 *
 * It names the room in its VISIBLE text rather than hiding the room in an
 * aria-label over a generic "Enquire about this room". A hidden name that
 * disagrees with the visible one fails Label in Name (WCAG 2.5.3): a speech-input
 * user who says what they can read would miss the control entirely. It is also
 * simply better copy — the button says what it does when the card is skimmed.
 */
export function twinDossierActionLabel(roomName: string): string {
  return `Enquire about the ${roomName}`;
}

/** Polite arrival line. The room leads, because the room is the news; the venue
 *  follows so the announcement stands alone if it is all a visitor hears. */
export function twinDossierArrival(roomName: string, venueName: string): string {
  return `${roomName}, ${venueName}`;
}

/** Quiet labels for the four published facts, in the venue's own vocabulary —
 *  "Reception" and "Dinner" are the venue's format names (CAPACITY_FORMATS),
 *  not our paraphrase of them. */
export const STAT_LABEL_DIMENSIONS = "Dimensions";
export const STAT_LABEL_RECEPTION = "Reception";
export const STAT_LABEL_DINNER = "Dinner";
/** A test locates the ceiling row by this label and asserts the COMPOSED
 *  value — figure plus the venue's qualifier plus the separator between them,
 *  which is the part that silently broke. */
export const STAT_LABEL_CEILING = "Ceiling";

/**
 * Every user-facing string this panel can render, for the copy-claim sweep in
 * shell/__tests__/shell-copy-claims.test.ts. That guard is the repo's only
 * enforcement of the banned certainty phrases, and it can only check strings it
 * is handed — a surface that keeps its copy to itself is simply unguarded.
 *
 * It is swept there rather than being spliced into twin-copy.ts's allTwinCopy()
 * because the walkthrough's copy sits beneath the shell: twin-copy.ts reads
 * only the room oracle, and importing a panel's copy into it would invert that
 * dependency.
 *
 * The two parameterised lines are sampled with a real room name so the sweep
 * sees the sentence a visitor sees, not a template.
 */
export function allRoomDossierCopy(): readonly string[] {
  return [
    TWIN_DOSSIER_COLLAPSE_LABEL,
    TWIN_DOSSIER_EXPAND_LABEL,
    TWIN_DOSSIER_FOOTNOTE,
    STAT_LABEL_DIMENSIONS,
    STAT_LABEL_RECEPTION,
    STAT_LABEL_DINNER,
    STAT_LABEL_CEILING,
    twinDossierActionLabel("Grand Hall"),
    twinDossierArrival("Grand Hall", "Trades Hall Glasgow"),
    ...roomRemarks(),
    ...roomSections(),
  ];
}

/** Every section name a verified room's stats can be labelled with, once each. */
function roomSections(): readonly string[] {
  const sections = new Set<string>();
  for (const nodeId of Object.keys(VERIFIED_ROOM_NODES)) {
    for (const extent of lookUpRoom(nodeId)?.dimensions?.extents ?? []) {
      if (extent.section !== undefined) sections.add(extent.section);
    }
  }
  return [...sections];
}

/** Every remark a verified room's footnote can lead with, once each. */
function roomRemarks(): readonly string[] {
  const remarks = new Set<string>();
  for (const nodeId of Object.keys(VERIFIED_ROOM_NODES)) {
    const remark = lookUpRoom(nodeId)?.dimensions?.remark;
    if (remark !== undefined) remarks.add(remark);
  }
  return [...remarks];
}
