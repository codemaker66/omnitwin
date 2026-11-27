import { ROOM_DISPLAY_NAMES } from "./twin-rooms.js";

// -----------------------------------------------------------------------------
// quick-actions-copy — every word the quick-action rail says, as data.
//
// It lives beside its component rather than inside it for the reason
// measure-copy.ts records: the component imports its stylesheet for the side
// effect, and nothing outside a bundler can load that import. Node-side
// readers of these words (the unit suites' copy sweep, and the Playwright
// specs that assert the rendered quick-action rail against them) import this module
// instead, so no reader ever needs a second copy of a phrase.
// -----------------------------------------------------------------------------

/** Group name for the rail — screen readers announce the cluster first, so each
 *  chip's own label can stay short without losing its context. */
export const TWIN_QUICK_GROUP_LABEL = "Quick actions";

/** Switch the viewer out of the walk and into the overhead read of the hall. */
export const TWIN_QUICK_PLAN_LABEL = "See the plan";

/** Share the exact view. Worded distinctly from the utility rail's "Copy link
 *  to this walkthrough" so the two never read as one control to a screen reader
 *  working through the page by accessible name. */
export const TWIN_QUICK_SHARE_LABEL = "Share this view";

/** The way out into the venue's events team. Names the act, not the venue — the
 *  venue is already named by the HUD label above the rail. */
export const TWIN_QUICK_ENQUIRE_LABEL = "Enquire about hosting";

/**
 * A destination chip's visible text. The whole phrase is rendered, rather than a
 * bare room name behind an aria-label, so the accessible name and the visible
 * label are the same string — voice-control users say what they can see.
 */
export function twinQuickWalkLabel(destination: string): string {
  return `Walk to ${destination}`;
}

/** Every user-visible string this rail can render, for the copy-claim sweep
 *  (mirrors allTwinCopy() in twin-copy.ts; the orchestrator splices this in).
 *
 *  Every destination label is enumerated rather than sampled. Because a
 *  destination is a slug and the label is looked up, the set of renderable
 *  phrases is finite and known here — so the sweep covers the rail exactly,
 *  instead of covering one example and trusting the rest. */
export function allQuickActionCopy(): readonly string[] {
  return [
    TWIN_QUICK_GROUP_LABEL,
    TWIN_QUICK_PLAN_LABEL,
    TWIN_QUICK_SHARE_LABEL,
    TWIN_QUICK_ENQUIRE_LABEL,
    ...Object.values(ROOM_DISPLAY_NAMES).map(twinQuickWalkLabel),
  ];
}
