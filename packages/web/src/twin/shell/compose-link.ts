import type { Venue } from "../../api/spaces.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  type PublishedRoomSlug,
} from "../../lib/trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// compose-link — the door between the showroom and the workshop.
//
// The twin is where someone falls for the room; the planner is where they lay
// it out. Given the venue rows the API has already returned and the room
// underfoot, this module answers one question: which planner URL opens that
// room. Nothing else.
//
// THE SLUG CROSSING, which is the whole reason this is a module and not an
// inline template string:
//
//   The twin's venue slug is an ASSET-namespace slug. It names a bundle on
//   disk — /twin/trades-hall/manifest.json — and arrives from the
//   /venues/:venueSlug/twin route param (manifest.venueSlug).
//
//   The planner's venue slug is a DATABASE slug. `/v/:venueSlug/plan` reaches
//   resolvePlannerVenue(), which does `venues.find(v => v.slug === requested)`
//   over the rows GET /venues returned (lib/planner-venue-resolution.ts:30,
//   pages/EditorPage.tsx:208-209).
//
// They are two names for one building and they are NOT interchangeable. Posting
// the asset spelling to a database-slug endpoint has already cost this repo a
// live 404 on the public enquiry route, and the failure is invisible to a fully
// mocked suite because no unit test ever resolves a slug against a real row.
//
// So this module does not keep a table of the crossing. There is nowhere
// truthful to keep one: `venues` (packages/api/src/db/schema.ts:90-113) has a
// `slug` and nothing that names a twin bundle, so the database itself holds no
// mapping, and the only spelling written down anywhere in this repo —
// "trades-hall-glasgow" in packages/api/src/db/seed.ts:62 — is a LOCAL SEED.
// Production's row was never confirmed against it. A literal copied out of a
// dev seed and shipped in the web bundle is a guess wearing a constant's
// clothes, and it is the exact shape of the failure above.
//
// What the API does own is the answer: GET /venues is public and unauthenticated
// (packages/api/src/routes/venues.ts:41-62) and returns the live rows, slug
// included. So the crossing is a JOIN performed against those rows at runtime,
// and the composer will only ever emit a slug that came back from the server.
// Where the join finds nothing it returns null — no control at all — rather
// than a URL that lands on the planner's "venue not found" screen at the exact
// moment someone tried to book.
//
// The room travels as `?space=`, which is what EditorPage.tsx:165 reads
// (`searchParams.get("space")`) and matches against `space.slug` by string
// equality — no normalisation, so this module passes the published slug through
// verbatim.
//
// WHY THE VENUE-EXPLICIT ROUTE, when three shipped surfaces use `/plan?space=`
// (lib/trades-hall-room-showcase.ts, pages/landing/rite-copy.ts,
// pages/living-hall/living-hall-copy.ts): `/plan` with no venue segment opens
// `venues[0]` — the oldest row, whichever venue that is. For a page that is
// already single-tenant marketing that is a fair shortcut. For a link composed
// from a SPECIFIC venue's walkthrough it is a coincidence dressed as a
// statement: the day a second venue exists, "plan the Grand Hall" from venue B's
// twin would open venue A's Grand Hall. The explicit route can only open the
// right venue or refuse out loud, so it is the one used here. If a future reader
// "harmonises" this with the marketing links, that is the property being given
// up.
//
// WHAT THIS LINK IS NOT: it is not the enquiry. RoomDossier's `onCompose`
// renders a button whose VISIBLE label is "Enquire about the <Room>"
// (RoomDossier.tsx:149) and whose promise is that a human at the venue will
// read a message. Wiring this href to that callback would leave the label
// saying one thing and the control doing another — a broken promise to the
// visitor, and a Label-in-Name failure for anyone driving the page by voice.
// This href needs its OWN control with its own honest label. See the note above
// composePlannerHandoff for what the host has to add.
//
// Nothing else travels in this URL. An earlier draft carried `?from=`, `?node=`
// and `?look=` as a "return anchor" for a planner-side way back to the
// walkthrough. No such consumer can exist on this route: EditorPage's bootstrap
// navigates to `/plan/<configId>` with `replace: true` and does not carry the
// query string over (EditorPage.tsx:232-239), so those params are gone one
// render after arrival. Params nothing can read are not provenance, they are
// litter — and an inverse parser for them was pure ceremony.
// -----------------------------------------------------------------------------

/** The planner's venue-explicit route: `/v/:venueSlug/plan` (router.tsx:264). */
const PLANNER_ROUTE_PREFIX = "v";
const PLANNER_ROUTE_LEAF = "plan";

/** The room param EditorPage reads. */
const PARAM_SPACE = "space";

/**
 * How the twin names its own venue: the two fields a twin manifest carries
 * about the building (TwinManifestSchema, packages/types/src/twin.ts:94-95).
 *
 * Both are here because both are join keys, and neither is reliable alone —
 * see resolvePlannerVenue below.
 */
export interface TwinVenueIdentity {
  /** ASSET-namespace slug — `manifest.venueSlug`, e.g. "trades-hall". Never a
   *  `venues.slug`, and never to be written into a planner URL directly. */
  readonly venueSlug: string;
  /** The venue's display name — `manifest.name`, e.g. "Trades Hall Glasgow". */
  readonly name: string;
}

/**
 * Whether a raw string is a room the venue actually publishes.
 *
 * Keyed off the capacities table so the set of rooms has exactly one definition
 * in the codebase. `Object.hasOwn` rather than a truthiness check: this is
 * reachable from data that has been cast out of its type, and inherited keys are
 * not rooms.
 */
function isPublishedRoomSlug(value: string): value is PublishedRoomSlug {
  return Object.hasOwn(TRADES_HALL_ROOM_CAPACITIES, value);
}

/**
 * Find the `venues` row this twin belongs to, or null.
 *
 * Two passes, both exact equality against fields the SERVER supplied, and both
 * requiring exactly one match:
 *
 *  1. `slug`. This is the identity the planner route itself resolves on, so a
 *     venue whose bundle and row agree needs no cleverness at all. Slugs are
 *     unique in the schema (venues.slug is .notNull().unique()), but the rows
 *     arrive over the wire, so the count is checked rather than assumed.
 *
 *  2. `name`. The manifest's `name` is the venue's display name and the seeded
 *     row carries the same string; where the two slug namespaces disagree this
 *     is the only join key the twin and the API share. Names are NOT unique in
 *     the schema, so two rows answering to one name is an ambiguity, and an
 *     ambiguous join is refused rather than resolved by picking the first.
 *
 * A name is editable from the dashboard (PATCH /venues accepts it), so renaming
 * a venue can take this link away until the slugs agree. That is the failure
 * chosen deliberately: the control disappears, which a visitor never notices,
 * instead of pointing somewhere wrong, which is how the 404 above happened.
 *
 * There is no third pass. No suffix-stripping, no slugifying the name, no
 * "close enough" — every one of those would invent a slug this codebase has no
 * authority to invent.
 */
function resolvePlannerVenue(
  venues: readonly Venue[],
  twin: TwinVenueIdentity,
): Venue | null {
  const bySlug = venues.filter((venue) => venue.slug === twin.venueSlug);
  if (bySlug.length === 1) {
    return bySlug[0] ?? null;
  }

  const byName = venues.filter((venue) => venue.name === twin.name);
  if (byName.length === 1) {
    return byName[0] ?? null;
  }

  return null;
}

/** Where the visitor is standing, and what the API has said about the venue. */
export interface ComposeHandoffInput {
  /** The rows from `listVenues()` (api/spaces.ts:77 → public GET /venues). The
   *  planner slug can only ever come from here. */
  readonly venues: readonly Venue[];
  /** How the twin's own manifest names this venue. */
  readonly twin: TwinVenueIdentity;
  /** The verified room underfoot, or null where the viewpoint's room has not
   *  been confirmed — the overwhelmingly common case (144 of 149). */
  readonly roomSlug: PublishedRoomSlug | null;
}

/** What the caller may do with the handoff, and what it is allowed to claim. */
export interface PlannerHandoff {
  /** Route-relative href, ready for `navigate()` or an anchor. */
  readonly href: string;
  /** "room" when the link opens a named room; "venue" when it opens the venue
   *  and lets the planner choose. A caller must not label a venue-scoped link
   *  with a room's name — that is the whole reason this field exists. */
  readonly scope: "room" | "venue";
}

/**
 * The planner URL that opens where the visitor is standing, or null when the
 * venue rows do not identify this twin's venue.
 *
 * Null is the useful answer, not a failure: the host renders no control without
 * an href, so an unresolved venue shows nothing at all rather than a control
 * that lands on "venue not found".
 *
 * A room the venue does not publish is treated as no room — the same silence
 * twin-rooms.ts keeps at an unverified viewpoint. The type says
 * PublishedRoomSlug, but a type is not a runtime guarantee once something has
 * cast it away, and the cost of being wrong here is a guest planning a room the
 * venue does not offer.
 *
 * FOR THE HOST WIRING THIS: it needs a control of its own. Do not hang it on
 * RoomDossier's `onCompose` — that button reads "Enquire about the <Room>" and
 * must keep meaning it. The new control needs (a) a visible label that says it
 * opens the planner, matching its accessible name; (b) that label registered in
 * an `all…Copy()` export so the shell's copy-claim sweep can see it; and (c)
 * room-scoped wording only when `scope === "room"`.
 */
export function composePlannerHandoff(input: ComposeHandoffInput): PlannerHandoff | null {
  const venue = resolvePlannerVenue(input.venues, input.twin);
  if (venue === null) {
    return null;
  }

  const roomSlug =
    input.roomSlug !== null && isPublishedRoomSlug(input.roomSlug) ? input.roomSlug : null;

  const base = `/${PLANNER_ROUTE_PREFIX}/${encodeURIComponent(venue.slug)}/${PLANNER_ROUTE_LEAF}`;
  if (roomSlug === null) {
    return { href: base, scope: "venue" };
  }

  const params = new URLSearchParams();
  params.set(PARAM_SPACE, roomSlug);
  return { href: `${base}?${params.toString()}`, scope: "room" };
}
