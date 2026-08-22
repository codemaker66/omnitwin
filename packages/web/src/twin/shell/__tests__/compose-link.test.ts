import { describe, expect, it } from "vitest";
import { TRADES_HALL_VENUE_SLUG } from "@omnitwin/types";
import type { Venue } from "../../../api/spaces.js";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  type PublishedRoomSlug,
} from "../../../lib/trades-hall-venue-truth.js";
import { TRADES_HALL_ROOM_SHOWCASE_PROFILES } from "../../../lib/trades-hall-room-showcase.js";
import { composePlannerHandoff, type TwinVenueIdentity } from "../compose-link.js";

// -----------------------------------------------------------------------------
// compose-link — the twin → planner handoff, on trial.
//
// THE SLUG CROSSING is what this file mostly exists to hold down. The twin's
// manifest says "trades-hall"; the planner route resolves against a `venues`
// row, and the only spelling of that row written anywhere in this repo is
// "trades-hall-glasgow" in packages/api/src/db/seed.ts:62 — a LOCAL SEED, never
// confirmed against production. Sending the twin's spelling into the planner
// route lands the visitor on "venue not found"; that same confusion already
// cost a live 404 on the enquiry endpoint, and a mocked suite saw nothing.
//
// So the module resolves the slug by JOINING the rows GET /venues returned
// (public, unauthenticated — packages/api/src/routes/venues.ts:41) rather than
// keeping a table of its own, and these tests hand it API-SHAPED rows and pin
// what comes out. The "trades-hall-glasgow" literal appears below only as the
// contents of a fixture row standing in for what the server sends — it is
// never a value the module may produce from thin air, and the refusal tests
// prove the module cannot invent it.
//
// The rows are typed as `Venue` — the exact type `listVenues()` resolves to
// (api/spaces.ts:25) — so if the API's venue shape ever loses `slug` or `name`,
// this file stops compiling instead of the join quietly going missing.
//
// Also pinned:
//  * The URL contract with EditorPage. The room travels in `?space=`, read at
//    pages/EditorPage.tsx:165 as `searchParams.get("space")` and matched by
//    string equality against `space.slug`. The literal "space" is written out
//    below rather than imported from the module under test: a test that read the
//    same constant the code writes would agree happily with a rename that broke
//    the planner.
//  * Silence where the room is unknown. 144 of 149 viewpoints carry no verified
//    room, and a handoff from one of those must not smuggle a room slug into the
//    URL. It composes a VENUE-scoped link and reports `scope: "venue"`, so a
//    caller cannot dress a venue-scoped link in a room's name.
// -----------------------------------------------------------------------------

/** The venue-truth room slugs, read off the truth module rather than restated. */
function publishedSlugs(): PublishedRoomSlug[] {
  return Object.keys(TRADES_HALL_ROOM_CAPACITIES) as PublishedRoomSlug[];
}

/**
 * A row shaped like one from GET /venues. `slug` and `name` are the join keys;
 * the rest is filled so the fixture is a real `Venue`, not a convenient subset.
 */
function venueRow(overrides: Partial<Venue> & Pick<Venue, "slug" | "name">): Venue {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    address: "85 Glassford Street, Glasgow G1 1UH",
    logoUrl: null,
    brandColour: null,
    ...overrides,
  };
}

/**
 * The flagship row as packages/api/src/db/seed.ts:59-64 writes it — the same
 * name and slug, because that seed is the only evidence in the repo of what the
 * server returns. The point of the fixture is that the module reads the slug OFF
 * IT rather than knowing it.
 */
const SEEDED_TRADES_HALL = venueRow({ slug: "trades-hall-glasgow", name: "Trades Hall Glasgow" });

/** How the shipped twin manifest names the venue — packages/web/public/twin/
 *  trades-hall/manifest.json, mirrored by twin/__fixtures__/twin-fixture.ts. */
const TRADES_HALL_TWIN: TwinVenueIdentity = {
  venueSlug: TRADES_HALL_VENUE_SLUG,
  name: "Trades Hall Glasgow",
};

/** The query half of a composed href, as the browser would read it. */
function queryOf(href: string | undefined): URLSearchParams {
  return new URLSearchParams(href?.split("?")[1] ?? "");
}

describe("the venue-slug crossing", () => {
  it("writes the row's slug into the URL, never the twin's", () => {
    const handoff = composePlannerHandoff({
      venues: [SEEDED_TRADES_HALL],
      twin: TRADES_HALL_TWIN,
      roomSlug: "grand-hall",
    });
    // The whole contract in one string: the /v/:venueSlug/plan route
    // (router.tsx:264), the DATABASE-namespace slug taken off the row, and
    // ?space= as EditorPage reads it.
    expect(handoff?.href).toBe("/v/trades-hall-glasgow/plan?space=grand-hall");
    // Belt and braces, in case a future edit makes the assertion above pass for
    // the wrong reason: the asset spelling must not sit in the venue segment.
    expect(handoff?.href).not.toContain(`/${TRADES_HALL_VENUE_SLUG}/plan`);
  });

  it("keeps the two namespaces distinct — they are not the same string", () => {
    // If this ever passes trivially, the crossing has been "simplified" away and
    // most of this file has quietly stopped guarding anything.
    expect(TRADES_HALL_VENUE_SLUG).not.toBe(SEEDED_TRADES_HALL.slug);
  });

  it("cannot invent a slug the server did not send", () => {
    // No rows at all: there is no fallback spelling to reach for. A module with
    // a private table would happily answer here — that is the bug this shape
    // removes, and the reason it is asserted rather than assumed.
    expect(
      composePlannerHandoff({ venues: [], twin: TRADES_HALL_TWIN, roomSlug: "grand-hall" }),
    ).toBeNull();

    // A row exists, but it is somebody else's venue — neither key matches.
    expect(
      composePlannerHandoff({
        venues: [venueRow({ slug: "city-rooms", name: "City Rooms" })],
        twin: TRADES_HALL_TWIN,
        roomSlug: "grand-hall",
      }),
    ).toBeNull();
  });

  it("joins on slug when the two namespaces already agree", () => {
    // The intended end state: a venue whose bundle and row share a spelling
    // needs no name matching at all, and must resolve even if its display name
    // has since been edited.
    const handoff = composePlannerHandoff({
      venues: [venueRow({ slug: TRADES_HALL_VENUE_SLUG, name: "Renamed Since Capture" })],
      twin: TRADES_HALL_TWIN,
      roomSlug: "saloon",
    });
    expect(handoff?.href).toBe(`/v/${TRADES_HALL_VENUE_SLUG}/plan?space=saloon`);
  });

  it("prefers the slug match over a name match when both exist", () => {
    // Two rows, each matching on one key. Slug is the identity the planner route
    // itself resolves on, so it wins; picking the name row would send the
    // visitor to a different building.
    const handoff = composePlannerHandoff({
      venues: [
        venueRow({ slug: "some-other-slug", name: "Trades Hall Glasgow" }),
        venueRow({ slug: TRADES_HALL_VENUE_SLUG, name: "Not The Manifest Name" }),
      ],
      twin: TRADES_HALL_TWIN,
      roomSlug: "grand-hall",
    });
    expect(handoff?.href).toBe(`/v/${TRADES_HALL_VENUE_SLUG}/plan?space=grand-hall`);
  });

  it("refuses an ambiguous name rather than picking the first row", () => {
    // `venues.name` has no unique constraint (packages/api/src/db/schema.ts:92),
    // so two venues trading under one name is a legal database state. Guessing
    // between them is how a visitor ends up planning in the wrong building; no
    // control at all is the honest answer.
    expect(
      composePlannerHandoff({
        venues: [
          venueRow({ id: "a", slug: "trades-hall-glasgow", name: "Trades Hall Glasgow" }),
          venueRow({ id: "b", slug: "trades-hall-glasgow-2", name: "Trades Hall Glasgow" }),
        ],
        twin: TRADES_HALL_TWIN,
        roomSlug: "grand-hall",
      }),
    ).toBeNull();
  });

  it("does not slugify, suffix-strip, or otherwise approximate a match", () => {
    // Every one of these is a plausible-looking near-miss that a "helpful"
    // matcher would resolve. Each would be a slug this codebase has no authority
    // to invent, and the planner would answer with "venue not found".
    for (const row of [
      venueRow({ slug: "trades-hall-glasgow", name: "Trades Hall, Glasgow" }),
      venueRow({ slug: "trades-hall-glasgow", name: "trades hall glasgow" }),
      venueRow({ slug: "trades-hall-glasgow", name: "The Trades Hall of Glasgow" }),
      venueRow({ slug: "tradeshall", name: "Trades Hall Edinburgh" }),
    ]) {
      expect(
        composePlannerHandoff({ venues: [row], twin: TRADES_HALL_TWIN, roomSlug: "grand-hall" }),
        `approximated a match on ${row.slug} / ${row.name}`,
      ).toBeNull();
    }
  });

  it("is not fooled by a twin identity carrying prototype-shaped strings", () => {
    // The twin slug arrives from a route param. The join is a filter over real
    // rows rather than a property lookup, so there is no inherited key to hit —
    // this pins that property rather than trusting it.
    for (const venueSlug of ["toString", "constructor", "__proto__", ""]) {
      expect(
        composePlannerHandoff({
          venues: [SEEDED_TRADES_HALL],
          twin: { venueSlug, name: "" },
          roomSlug: "grand-hall",
        }),
        `resolved a venue for twin slug ${JSON.stringify(venueSlug)}`,
      ).toBeNull();
    }
  });

  it("escapes a venue slug that would otherwise break out of its path segment", () => {
    // `venues.slug` is regex-guarded on create (routes/venues.ts CreateVenueBody)
    // but this value arrives over the wire, and a slash in it would silently
    // repoint the whole route.
    const handoff = composePlannerHandoff({
      venues: [venueRow({ slug: "a/../b", name: "Trades Hall Glasgow" })],
      twin: TRADES_HALL_TWIN,
      roomSlug: null,
    });
    expect(handoff?.href).toBe("/v/a%2F..%2Fb/plan");
  });
});

describe("composePlannerHandoff — the room is known", () => {
  it("names every published room without inventing a seventh", () => {
    for (const slug of publishedSlugs()) {
      const handoff = composePlannerHandoff({
        venues: [SEEDED_TRADES_HALL],
        twin: TRADES_HALL_TWIN,
        roomSlug: slug,
      });
      // Verbatim: the planner matches `space.slug` by string equality, so any
      // transformation here silently falls through to its default room.
      expect(queryOf(handoff?.href).get("space")).toBe(slug);
      expect(handoff?.scope).toBe("room");
    }
  });

  it("speaks the same ?space= vocabulary as the public room showcase", () => {
    // The showcase's planningHref (lib/trades-hall-room-showcase.ts) is the
    // repo's existing shipped planner link. Two surfaces naming the same room
    // to the same planner must name it identically — this is the drift gate
    // between them, and it reads the showcase rather than restating it.
    for (const slug of publishedSlugs()) {
      const shippedHref = TRADES_HALL_ROOM_SHOWCASE_PROFILES[slug].planningHref;
      if (shippedHref === null) {
        continue;
      }
      const handoff = composePlannerHandoff({
        venues: [SEEDED_TRADES_HALL],
        twin: TRADES_HALL_TWIN,
        roomSlug: slug,
      });
      expect(queryOf(handoff?.href).get("space"), `space drift on ${slug}`)
        .toBe(queryOf(shippedHref).get("space"));
    }
  });

  it("carries nothing but the room — no params a planner cannot read", () => {
    // EditorPage's bootstrap redirects to /plan/<configId> with replace:true and
    // drops the query string (EditorPage.tsx:232-239), so any extra param is
    // unreadable one render after arrival. `space` is the only one that is
    // consumed, and therefore the only one that ships.
    const handoff = composePlannerHandoff({
      venues: [SEEDED_TRADES_HALL],
      twin: TRADES_HALL_TWIN,
      roomSlug: "grand-hall",
    });
    expect([...queryOf(handoff?.href).keys()]).toEqual(["space"]);
  });
});

describe("composePlannerHandoff — the room is not known", () => {
  it("composes a venue-scoped link and says so, rather than guessing a room", () => {
    const handoff = composePlannerHandoff({
      venues: [SEEDED_TRADES_HALL],
      twin: TRADES_HALL_TWIN,
      roomSlug: null,
    });
    expect(handoff?.href).toBe("/v/trades-hall-glasgow/plan");
    expect(handoff?.scope).toBe("venue");
  });

  it("omits ?space= entirely — never an empty one", () => {
    const handoff = composePlannerHandoff({
      venues: [SEEDED_TRADES_HALL],
      twin: TRADES_HALL_TWIN,
      roomSlug: null,
    });
    // `space=` with an empty value is not silence: EditorPage reads "" and falls
    // through its default chain having been handed a claim it cannot use.
    expect(handoff?.href).not.toContain("space");
    expect(handoff?.href).not.toContain("?");
  });

  it("treats a room slug the venue does not publish as no room at all", () => {
    // The cast is the point: PublishedRoomSlug is a compile-time promise, and
    // this module is reachable from data that has been cast out of its type.
    // "lady-convenors-room" is a real runtime room slug that the venue-truth
    // module deliberately does not publish.
    const handoff = composePlannerHandoff({
      venues: [SEEDED_TRADES_HALL],
      twin: TRADES_HALL_TWIN,
      roomSlug: "lady-convenors-room" as PublishedRoomSlug,
    });
    expect(handoff?.scope).toBe("venue");
    expect(handoff?.href).not.toContain("lady-convenors-room");
  });

  it("treats an inherited key as no room at all", () => {
    // `Object.hasOwn`, not truthiness: on a plain record `capacities["toString"]`
    // is a function, and a truthy check would ship ?space=toString.
    for (const rogue of ["toString", "constructor", "__proto__"]) {
      const handoff = composePlannerHandoff({
        venues: [SEEDED_TRADES_HALL],
        twin: TRADES_HALL_TWIN,
        roomSlug: rogue as PublishedRoomSlug,
      });
      expect(handoff?.scope, `admitted ${rogue} as a room`).toBe("venue");
    }
  });
});
