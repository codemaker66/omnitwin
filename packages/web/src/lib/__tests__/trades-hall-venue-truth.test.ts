import { describe, expect, it } from "vitest";
import {
  TRADES_HALL_PUBLISHED_ROOM_NAMES,
  TRADES_HALL_ROOM_CAPACITIES,
} from "@omnitwin/types";
import { publicRoomSelectionCards } from "../trades-hall-room-showcase.js";
import { ROOM_CHAPTERS } from "../../pages/landing/rite-copy.js";
import { ENQUIRY_ROOM_NAMES } from "../../pages/fresh/enquiry-fit.js";

// ---------------------------------------------------------------------------
// The venue truth lives in @omnitwin/types (trades-hall-venue-truth.ts), where
// its own tests pin the figures to the client's 2026-07-09 message. These pin
// the web's surfaces to it, so no page can drift from the shared figures.
// ---------------------------------------------------------------------------

describe("web surfaces read the shared venue truth", () => {
  it("uses slugs that resolve to real room showcase cards", () => {
    const known = new Set(publicRoomSelectionCards.map((c) => c.canonicalRoomSlug ?? c.id));
    for (const slug of Object.keys(TRADES_HALL_ROOM_CAPACITIES)) {
      expect(known.has(slug), `showcase card missing for ${slug}`).toBe(true);
    }
  });

  it("agrees with the Rite's chapter figures — no drift between surfaces", () => {
    for (const chapter of ROOM_CHAPTERS) {
      const truth = TRADES_HALL_ROOM_CAPACITIES[chapter.slug as keyof typeof TRADES_HALL_ROOM_CAPACITIES];
      expect(truth, `venue truth missing for chapter room ${chapter.slug}`).toBeTruthy();
      expect(chapter.standing).toBe(truth.reception);
      expect(chapter.banquet).toBe(truth.dinner);
    }
  });

  it("names rooms in the enquiry composer exactly as the shared truth does", () => {
    expect(ENQUIRY_ROOM_NAMES).toBe(TRADES_HALL_PUBLISHED_ROOM_NAMES);
  });
});
