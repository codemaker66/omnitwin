import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { seatsFor } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { CATALOGUE_ITEMS } from "../catalogue.js";
import { isDiningTableItem } from "../furniture-semantics.js";
import { banquetSeatsPerTable, chairCountRange, seatCapacity } from "../table-group.js";

// ---------------------------------------------------------------------------
// Seat truth (card-dock spec §17.2, Q-09): one reader, every asset.
// ---------------------------------------------------------------------------

describe.each(CATALOGUE_ITEMS.map((item) => [item.slug, item] as const))("seat truth: %s", (_slug, item) => {
  it("is set for seats exactly when it is seated dining, and never more than fit", () => {
    const seats = seatsFor(item);
    if (!isDiningTableItem(item)) {
      expect(seats).toBeNull();
      return;
    }
    if (seats === null) throw new Error(`${item.slug} is a dining table without seat truth`);
    expect(seats.max).toBeLessThanOrEqual(seatCapacity(item));
    expect(banquetSeatsPerTable(item)).toBe(seats.default);
    expect(chairCountRange(item, seatCapacity(item))).toEqual({ min: seats.min, max: seats.max, initial: seats.default });
  });
});

describe("chairCountRange", () => {
  const round = CATALOGUE_ITEMS.find((item) => item.slug === "round-table-6ft-black");
  if (round === undefined) throw new Error("round fixture missing");

  it("holds seat truth's range to what physically fits", () => {
    expect(chairCountRange(round, 9)).toEqual({ min: 8, max: 9, initial: 9 });
    expect(chairCountRange(round, 5)).toEqual({ min: 5, max: 5, initial: 5 });
  });

  it("offers table-only when no chair fits", () => {
    expect(chairCountRange(round, 0)).toEqual({ min: 0, max: 0, initial: 0 });
  });
});

// ---------------------------------------------------------------------------
// The guard: no other module states or computes a table's seats.
// ---------------------------------------------------------------------------

const WEB_SRC = fileURLToPath(new URL("../../", import.meta.url));
const TYPES_SRC = fileURLToPath(new URL("../../../../types/src/", import.meta.url));

/**
 * Modules that read a `seatCount` that is not a dining table's seats: the
 * saved asset definition's seated capacity (the timeline and blueprint
 * replay saved layouts as they were stored) and fill plans' own totals.
 */
const SEAT_COUNT_READERS = new Set([
  "lib/auto-fill.ts",
  "lib/blueprint/adapt.ts",
  "lib/room-layout-timeline-ui.ts",
  "lib/theatre-layout.ts",
]);

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") found.push(...sourceFiles(path));
    } else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function rel(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

describe("seat truth has one home", () => {
  it("states no seat figure as 'up to N' anywhere", () => {
    for (const [root, files] of [[WEB_SRC, sourceFiles(WEB_SRC)], [TYPES_SRC, sourceFiles(TYPES_SRC)]] as const) {
      for (const file of files) {
        expect(readFileSync(file, "utf8"), rel(root, file)).not.toMatch(/seats up to|up to \d+ seats/iu);
      }
    }
  });

  it("reads seatCount only where it means something else", () => {
    const readers = sourceFiles(WEB_SRC)
      .filter((file) => /\.seatCount\b/u.test(readFileSync(file, "utf8")))
      .map((file) => rel(WEB_SRC, file));
    for (const reader of readers) expect(SEAT_COUNT_READERS, reader).toContain(reader);
  });
});
