// ---------------------------------------------------------------------------
// What the front door knows about each captured room.
//
// The home page's room cards need a room's slug, whether its mesh frame can be
// trusted, its extent and its splat count. The bundle manifest holds those and
// every tile digest besides (about 215 KB), so reading them from it put the
// whole manifest on the first load. They live in a generated module of their
// own instead; front-door-weight.test.ts fails if it drifts from the manifest.
// Anything that needs tiles, transforms or levels still reads
// room-splat-bundles.ts.
// ---------------------------------------------------------------------------

import { ROOM_CARD_FACTS, type RoomCardFacts } from "./generated/room-card-facts.js";

export type { RoomCardFacts };

/**
 * What the card copy reads about a room. A full splat bundle has all three,
 * so the walk's callers pass theirs unchanged.
 */
export type RoomCardMeasures = Pick<RoomCardFacts, "alignmentConfidence" | "extentM" | "finestLevelSplats">;

export function roomCardFacts(roomSlug: string): RoomCardFacts | null {
  return ROOM_CARD_FACTS.find((facts) => facts.roomSlug === roomSlug) ?? null;
}

export function roomsWithCardFacts(): readonly string[] {
  return ROOM_CARD_FACTS.map((facts) => facts.roomSlug);
}
