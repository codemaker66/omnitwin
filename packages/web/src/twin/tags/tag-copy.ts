// -----------------------------------------------------------------------------
// tag-copy — every word the room-note layer can render, as data.
//
// Mirrors twin-copy.ts and measure-copy.ts: copy lives in a pure data module so
// one test can hold the whole script to the claim guard
// (findUnsupportedProposalClaim) and nothing is buried inside JSX where the
// sweep cannot see it. `allTagCopy()` is that sweep's target.
//
// THE EXAMPLE BODIES ARE IN HERE, AND THAT IS THE POINT. The shipped example
// notes are rendered to a guest, so they are copy, and copy that renders must be
// swept. Holding their strings here (and assembling the tags themselves in
// tag-model.ts) keeps the geometry module free of prose and keeps every
// renderable word inside one list, rather than splitting the script across two
// files where the sweep would silently cover half of it.
//
// WHY THE EXAMPLE WORDING IS SHAPED THE WAY IT IS. Each example body describes
// the KIND of fact that belongs in that note and says outright that the venue's
// own wording replaces it. It never states a fact about Trades Hall — not a
// socket count, not a door, not a load. This product's worst failure is telling
// a guest something confident and wrong about the building they are looking at,
// and a placeholder that reads like a fact is exactly that failure with a shrug
// attached. So the placeholders describe the slot, never the room.
// -----------------------------------------------------------------------------

/** Group name for the layer — announced before any individual pin, so each
 *  pin's own label can stay short without losing its context. */
export const TAG_GROUP_LABEL = "Room notes";

/** What one pin is called, in the singular, wherever a count is not involved. */
export const TAG_SINGULAR = "room note";

/**
 * A pin's accessible name. The kind leads the title because a screen-reader
 * user tabbing the layer hears a list, and "Power — " up front sorts that list
 * by category in the ear the way the glyphs sort it by eye.
 */
export function tagPinAria(kindLabel: string, title: string): string {
  return `${kindLabel} — ${title}. Open ${TAG_SINGULAR}.`;
}

/** Close control on the open card. Names the thing it closes, because the twin
 *  HUD has several dismissable surfaces and "Close" alone is ambiguous to a
 *  screen reader working through the page by accessible name. */
export const TAG_CLOSE_LABEL = "Close room note";

/** Walk to the viewpoint the note was authored from. Only rendered when the
 *  host supplies a handler AND the walk is not already standing there. */
export const TAG_GO_TO_BEST_VIEW = "Go to the best view of this";

/**
 * The badge on every example note. Short, because it sits in the card's header
 * beside the title; the sentence that explains it is below.
 */
export const TAG_EXAMPLE_BADGE = "Example";

/**
 * The sentence under an example note's body. This is the load-bearing piece of
 * the whole example set: without it a guest reads placeholder prose as venue
 * fact. It is rendered by the card for any tag whose provenance is "example",
 * and there is no route through the component that renders example content
 * without it — see TagLayer.tsx.
 */
export const TAG_EXAMPLE_DISCLOSURE =
  "This note demonstrates the format. The venue's own notes replace it before the walkthrough is published.";

// — kind labels — the five categories a venue planner actually asks about —

export const TAG_KIND_POWER_LABEL = "Power";
export const TAG_KIND_AV_LABEL = "AV";
export const TAG_KIND_ACCESS_LABEL = "Access";
export const TAG_KIND_SERVICE_LABEL = "Service";
export const TAG_KIND_FEATURE_LABEL = "Feature";

// — the example set's own words —
//
// Each title names a slot a planner would expect to find filled; each body says
// what would be written there and that the venue writes it. No figure, no
// fixture, no claim about this building.

export const TAG_EXAMPLE_POWER_TITLE = "Power drop";
export const TAG_EXAMPLE_POWER_BODY =
  "Where a note about the nearest supply would sit — what is on this wall, and what a stage or bar plugged into it would need. The venue's electrician supplies the wording.";

export const TAG_EXAMPLE_AV_TITLE = "Rig point";
export const TAG_EXAMPLE_AV_BODY =
  "Where a note about an overhead fixing would sit — what it is, what may hang from it, and who signs that off. Rigging figures come from the venue's own records, never from this model.";

export const TAG_EXAMPLE_ACCESS_TITLE = "Crew door";
export const TAG_EXAMPLE_ACCESS_BODY =
  "Where a note about a working entrance would sit — where it leads, what fits through it, and when caterers and crew may use it.";

export const TAG_EXAMPLE_FEATURE_TITLE = "Room feature";
export const TAG_EXAMPLE_FEATURE_BODY =
  "Where a note about something fixed in the room would sit — the thing itself, and whatever a planner has to design around it.";

/**
 * The polite live-region line, spoken when the set of pins on screen changes so
 * a screen-reader user learns the layer has content without having to tab into
 * it. Empty at zero, deliberately: an empty live region stays silent rather
 * than announcing an absence nobody asked about.
 */
export function tagCountAnnouncement(count: number): string {
  if (count <= 0) {
    return "";
  }
  return count === 1 ? `1 ${TAG_SINGULAR} in view` : `${String(count)} room notes in view`;
}

/**
 * Every user-visible string this layer can render — the claim-guard sweep
 * target, mirroring allTwinCopy() and allQuickActionCopy().
 *
 * The kind labels and the example bodies are enumerated rather than sampled:
 * both sets are finite and known here, so the sweep covers the layer exactly
 * instead of covering one specimen and trusting the rest. `tagPinAria` and
 * `tagCountAnnouncement` are included at representative arguments because their
 * only variable parts are a kind label and a title already in this list, and a
 * count, which carries no claim.
 */
export function allTagCopy(): readonly string[] {
  return [
    TAG_GROUP_LABEL,
    TAG_SINGULAR,
    TAG_CLOSE_LABEL,
    TAG_GO_TO_BEST_VIEW,
    TAG_EXAMPLE_BADGE,
    TAG_EXAMPLE_DISCLOSURE,
    TAG_KIND_POWER_LABEL,
    TAG_KIND_AV_LABEL,
    TAG_KIND_ACCESS_LABEL,
    TAG_KIND_SERVICE_LABEL,
    TAG_KIND_FEATURE_LABEL,
    TAG_EXAMPLE_POWER_TITLE,
    TAG_EXAMPLE_POWER_BODY,
    TAG_EXAMPLE_AV_TITLE,
    TAG_EXAMPLE_AV_BODY,
    TAG_EXAMPLE_ACCESS_TITLE,
    TAG_EXAMPLE_ACCESS_BODY,
    TAG_EXAMPLE_FEATURE_TITLE,
    TAG_EXAMPLE_FEATURE_BODY,
    tagPinAria(TAG_KIND_POWER_LABEL, TAG_EXAMPLE_POWER_TITLE),
    tagCountAnnouncement(1),
    tagCountAnnouncement(4),
  ];
}
