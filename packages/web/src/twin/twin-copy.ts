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

/**
 * Viewer HUD label — where you are standing. Leads with the venue and an honest
 * 1-based viewpoint index; it must NEVER lead with the raw scan id ("scan_035"
 * reads like a debug tag at a guest — finding [1]/[22]). A real room name would
 * be better still, but the nodes carry no verified roomSlug yet and inventing
 * one would risk labelling the Saloon "Grand Hall"; when tagging lands, lead
 * with the room here. The digits come off the node id (scan_NNN → viewpoint
 * NNN+1); an id with no numeric suffix falls back to the venue name alone.
 */
export function twinNodeLabel(nodeId: string, venueName: string): string {
  const digits = /(\d+)\s*$/.exec(nodeId)?.[1];
  if (digits === undefined) {
    return venueName;
  }
  const viewpoint = Number.parseInt(digits, 10) + 1;
  return `${venueName} · Viewpoint ${String(viewpoint)}`;
}

/** View-mode segmented control (Phase 2, Task 5) — shown only with a mesh. */
export const TWIN_MODE_GROUP_LABEL = "View mode";
export const TWIN_MODE_WALK_LABEL = "Walk";
export const TWIN_MODE_DOLLHOUSE_LABEL = "Dollhouse";
export const TWIN_MODE_PLAN_LABEL = "Plan";
/** Walk-mode HUD: the reverse dive back up to the dollhouse (Task 6). */
export const TWIN_SURFACE_LABEL = "Surface";

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
    TWIN_MODE_GROUP_LABEL,
    TWIN_MODE_WALK_LABEL,
    TWIN_MODE_DOLLHOUSE_LABEL,
    TWIN_MODE_PLAN_LABEL,
    TWIN_SURFACE_LABEL,
  ] as const;
}
