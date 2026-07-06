// -----------------------------------------------------------------------------
// twin-copy — every line of copy on the public twin route, as data.
//
// Single source of truth for the page's words (mirrors rite-copy.ts) so tests
// can hold the whole script to the claim guard (findUnsupportedProposalClaim)
// and no copy is ever buried inside JSX. Measurement language stays
// planning-grade — the twin never claims survey certainty.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 6).
// -----------------------------------------------------------------------------

export const TWIN_TITLE = "The Twin — Trades Hall Glasgow";

/** Loading state — the manifest is being fetched. */
export const TWIN_LOADING_LINE = "Opening the twin. The hall is on its way.";

/** Error state — fetch or schema validation failed. */
export const TWIN_ERROR_LINE =
  "The twin could not be reached. The hall itself is unaffected.";
export const TWIN_RETRY_LABEL = "Try again";

/** Production posture while the bundle host is not yet published (Task 12). */
export const TWIN_PREPARING_LINE =
  "The twin is being prepared. Walk the photographs meanwhile.";

/** Always visible alongside the twin — claim-safe framing of what it shows. */
export const TWIN_DISCLOSURE =
  "Planning-grade twin — positions and dimensions are planning estimates; final details confirmed by the venue team.";

/** Ready-state placeholder stage line until the viewer lands (Task 9). */
export function twinStageLine(nodeCount: number): string {
  return `${String(nodeCount)} scan ${nodeCount === 1 ? "point" : "points"}, posed and waiting.`;
}

/** 1-based viewpoint number parsed off a scan id (scan_035 → 36), or null when
 *  the id carries no numeric suffix. The manifest guarantees id ↔ index. */
function viewpointNumber(nodeId: string): number | null {
  const digits = /(\d+)\s*$/.exec(nodeId)?.[1];
  return digits === undefined ? null : Number.parseInt(digits, 10) + 1;
}

/**
 * Viewer HUD label — where you are standing. Leads with the venue and an honest
 * 1-based viewpoint index; it must NEVER lead with the raw scan id ("scan_035"
 * reads like a debug tag at a guest — finding [1]/[22]). A real room name would
 * be better still, but the nodes carry no verified roomSlug yet and inventing
 * one would risk labelling the Saloon "Grand Hall"; when tagging lands, lead
 * with the room here. An id with no numeric suffix falls back to the venue name.
 */
export function twinNodeLabel(nodeId: string, venueName: string): string {
  const viewpoint = viewpointNumber(nodeId);
  return viewpoint === null ? venueName : `${venueName} · Viewpoint ${String(viewpoint)}`;
}

/** Accessible name for the walk region — announced when a screen-reader user
 *  tabs into the 3D viewer (finding [12]). */
export function twinViewerLabel(venueName: string): string {
  return `Interactive walkthrough of ${venueName}`;
}

/** aria-roledescription that humanises the viewer's "application" role. */
export const TWIN_VIEWER_ROLE = "Virtual walkthrough";

/** Polite live-region line, spoken on each arrival so a screen-reader user
 *  hears where the walk moved to (finding [10]). Empty when unparseable — an
 *  empty live region stays silent rather than announcing nonsense. */
export function twinViewpointAnnouncement(nodeId: string, nodeCount: number): string {
  const viewpoint = viewpointNumber(nodeId);
  return viewpoint === null ? "" : `Viewpoint ${String(viewpoint)} of ${String(nodeCount)}`;
}

/** View-mode segmented control (Phase 2, Task 5) — shown only with a mesh. */
export const TWIN_MODE_GROUP_LABEL = "View mode";
export const TWIN_MODE_WALK_LABEL = "Walk";
export const TWIN_MODE_DOLLHOUSE_LABEL = "Dollhouse";
export const TWIN_MODE_PLAN_LABEL = "Plan";
/** Walk-mode HUD: the reverse dive back up to the dollhouse (Task 6). */
export const TWIN_SURFACE_LABEL = "Surface";

/** First-run coach hint — how to move, shown once until first interaction
 *  (finding [3]). Sentence case, gestures separated by middots. */
export const TWIN_COACH_HINT = "Click to move · drag to look · WASD to walk";

// — viewer controls cluster (fullscreen / share / enquire) —

/** The primary CTA out of the twin — into the venue's real planning + enquiry
 *  funnel. Short visible label; the aria label names the venue. */
export const TWIN_ENQUIRE_LABEL = "Enquire";
export function twinEnquireAria(venueName: string): string {
  return `Enquire about hosting at ${venueName}`;
}

/** Share / copy-link control. `copied` is announced in a polite live region. */
export const TWIN_SHARE_LABEL = "Copy link to this walkthrough";
export const TWIN_SHARE_COPIED = "Link copied";

/** Fullscreen toggle — label reflects the action the press will take. */
export const TWIN_FULLSCREEN_ENTER = "Enter full screen";
export const TWIN_FULLSCREEN_EXIT = "Exit full screen";

/** Minimap compass anchor — screen-up is E57 +Y = north (finding [6]). */
export const TWIN_MINIMAP_NORTH = "N";

// — in-twin enquiry modal (one-click, venue-context; no planner needed) —

export const TWIN_ENQUIRE_EYEBROW = "Host your event here";
export function twinEnquireTitle(venueName: string): string {
  return `Enquire about ${venueName}`;
}
export const TWIN_ENQUIRE_SUBHEAD =
  "No account needed. The events team will get back to you with availability and pricing.";
export const TWIN_ENQUIRE_CTA = "Send to the events team";
export const TWIN_ENQUIRE_SENDING = "Sending your enquiry…";
export const TWIN_ENQUIRE_SUCCESS_TITLE = "Your enquiry is on its way";
export function twinEnquireSuccessBody(venueName: string): string {
  return `The ${venueName} events team has your enquiry and will be in touch at`;
}
export const TWIN_ENQUIRE_TRUST =
  "Your details are shared only with the venue's events team. No spam, ever.";
export const TWIN_ENQUIRE_EMAIL_INVALID =
  "We need a valid email so the events team can reach you.";
export const TWIN_ENQUIRE_GENERIC_ERROR = "Something went wrong — please try again.";
export const TWIN_ENQUIRE_CLOSE = "Close";
export const TWIN_ENQUIRE_DONE = "Back to the walkthrough";

/** Every user-visible twin string — the claim-guard sweep target. */
export function allTwinCopy(): readonly string[] {
  return [
    TWIN_TITLE,
    TWIN_LOADING_LINE,
    TWIN_ERROR_LINE,
    TWIN_RETRY_LABEL,
    TWIN_PREPARING_LINE,
    TWIN_DISCLOSURE,
    twinStageLine(1),
    twinStageLine(149),
    twinNodeLabel("scan_000", "Trades Hall Glasgow"),
    twinViewerLabel("Trades Hall Glasgow"),
    twinViewpointAnnouncement("scan_000", 149),
    TWIN_VIEWER_ROLE,
    TWIN_MODE_GROUP_LABEL,
    TWIN_MODE_WALK_LABEL,
    TWIN_MODE_DOLLHOUSE_LABEL,
    TWIN_MODE_PLAN_LABEL,
    TWIN_SURFACE_LABEL,
    TWIN_COACH_HINT,
    TWIN_ENQUIRE_LABEL,
    twinEnquireAria("Trades Hall Glasgow"),
    TWIN_SHARE_LABEL,
    TWIN_SHARE_COPIED,
    TWIN_FULLSCREEN_ENTER,
    TWIN_FULLSCREEN_EXIT,
    TWIN_ENQUIRE_EYEBROW,
    twinEnquireTitle("Trades Hall Glasgow"),
    TWIN_ENQUIRE_SUBHEAD,
    TWIN_ENQUIRE_CTA,
    TWIN_ENQUIRE_SUCCESS_TITLE,
    twinEnquireSuccessBody("Trades Hall Glasgow"),
    TWIN_ENQUIRE_TRUST,
  ] as const;
}
