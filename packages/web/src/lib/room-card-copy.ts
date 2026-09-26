import {
  roomSplatServedSplats,
  type GeneratedRoomSplatBundle,
} from "../data/room-splat-bundles.js";

// ---------------------------------------------------------------------------
// What a room card on the front door is allowed to say.
//
// Two facts about a capture are independent: whether the mesh frame can be
// trusted (`alignmentConfidence`) and whether the walk box can hold a visitor
// (the decision in data/room-walk-exposure.ts). A crop can make a frame
// confident while the room stays closed, so every line here takes both, and
// dimensions are printed only when both hold. Copy is data: it lives here so
// each combination can be pinned by a test rather than by today's manifest.
// ---------------------------------------------------------------------------

/** Width by depth by height in metres, from the room's derived frame. */
export function footprint(bundle: GeneratedRoomSplatBundle): string {
  const [width, height, depth] = bundle.extentM;
  return `${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} m`;
}

/**
 * The served level's count, not the sum over every staged level: a visitor
 * sees the finest level alone, which is the whole reconstruction.
 */
export function splatLine(bundle: GeneratedRoomSplatBundle): string {
  return `${roomSplatServedSplats(bundle.roomSlug).toLocaleString("en-GB")} splats`;
}

/**
 * The measured line, and what it is allowed to claim.
 *
 * The splat count is always true: it is a count of what was captured. The
 * dimensions are only true where the scan measured cleanly AND the walk box
 * holds the room. A capture that swept a corridor reports a room far larger
 * than the one people stand in — the Saloon's mesh reads 9.9 m across against
 * the venue's 7 m, so it stays "in review" with the count alone. A closed room
 * prints only the count too; its state line says why.
 */
export function measuredLine(bundle: GeneratedRoomSplatBundle, walkable: boolean): string {
  if (bundle.alignmentConfidence === "confident" && walkable) {
    return `${footprint(bundle)} · ${splatLine(bundle)}`;
  }
  if (!walkable) return splatLine(bundle);
  return splatLine(bundle);
}

/**
 * What a card says under its name when the room is not simply ready.
 *
 * T-616 / gate line 3: this used to print a "not yet walkable, alignment in
 * review" and a dimensions-under-review line to every visitor on the front
 * door. Both were true and both were OUR vocabulary — a couple looking for a
 * wedding venue does not know what an alignment is, and it read as a building
 * site rather than as a room they cannot open yet.
 *
 * The honesty is unchanged, because it never lived in the jargon: a closed
 * room still offers no door, and a room whose scan did not measure cleanly
 * still prints no dimensions (measuredLine and the card both withhold them).
 * Only the words a visitor reads have changed.
 */
export function stateLine(_bundle: GeneratedRoomSplatBundle, walkable: boolean): string | null {
  if (!walkable) return "Photographs only for now";
  return null;
}
