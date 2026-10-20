/**
 * Write the front door's room-card facts from the generated splat bundles.
 *
 *   node scripts/derive-room-card-facts.mjs
 *
 * The bundle manifest (data/generated/trades-hall-splat-bundles.ts) is about
 * 215 KB of tile names, sizes and digests that only the walk and the planner
 * need. The home page's room cards read a few values per room from it, and
 * importing the manifest put all of it, 40 KB brotli, on every visitor's first
 * load. This copies those values into a module of their own.
 * front-door-weight.test.ts fails when the two disagree, so regenerate after any
 * `lcc2 stage` run.
 *
 * Needs Node 22.18 or newer: it imports the manifest's TypeScript source
 * directly, which Node strips of its types.
 */
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = await import(pathToFileURL(resolve(here, "../src/data/generated/trades-hall-splat-bundles.ts")).href);

const { TRADES_HALL_RUNTIME_ROOMS } = await import("@omnitwin/types");
const displayNames = new Map(TRADES_HALL_RUNTIME_ROOMS.map((room) => [room.slug, room.displayName]));

const facts = manifest.GENERATED_ROOM_SPLAT_BUNDLES.map((bundle) => ({
  roomSlug: bundle.roomSlug,
  displayName: displayNames.get(bundle.roomSlug) ?? bundle.roomSlug,
  alignmentConfidence: bundle.alignmentConfidence,
  extentM: bundle.extentM,
  finestLevelSplats: bundle.finestLevelSplats,
}));

const output = `// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by scripts/derive-room-card-facts.mjs from
// ./trades-hall-splat-bundles.ts and @omnitwin/types. The front door's room
// cards need these five values per room; the manifest they come from is far
// larger and loads only with the walk and the planner. front-door-weight.test.ts
// holds them together.

export interface RoomCardFacts {
  readonly roomSlug: string;
  /** The room's name as @omnitwin/types publishes it. */
  readonly displayName: string;
  readonly alignmentConfidence: "confident" | "review";
  /** Width, height, depth in metres, from the room's derived frame. */
  readonly extentM: readonly [number, number, number];
  /** Splats in the finest level, the reconstruction a visitor sees. */
  readonly finestLevelSplats: number;
}

export const ROOM_CARD_FACTS: readonly RoomCardFacts[] = ${JSON.stringify(facts, null, 2)};
`;

const target = resolve(here, "../src/data/generated/room-card-facts.ts");
await writeFile(target, output, "utf8");
process.stdout.write(`${facts.length} rooms -> ${target}\n`);
