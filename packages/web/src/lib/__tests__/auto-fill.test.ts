import { describe, expect, it } from "vitest";
import { TRADES_HALL_GRAND_HALL_DIMENSIONS, TRADES_HALL_SALOON_DIMENSIONS } from "@omnitwin/types";
import {
  BANQUET_CHAIR_CLEARANCE_M,
  autoFillActionLabel,
  autoFillBasis,
  autoFillPlacedLine,
  occasionPhrase,
  planAutoFill,
  planBanquetFill,
  publishedFigureFor,
  publishedFigureLine,
  roomAtSpacingLine,
  type BanquetFillPlan,
} from "../auto-fill.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { banquetSeatsPerTable, tableGroupPlanningRadius } from "../table-group.js";
import { computeCirculation, CIRCULATION_AISLE } from "../circulation.js";
import { PUBLISHED_CAPACITY_LABEL } from "../planner-truth.js";

// The Grand Hall's real interior, as the planner opens it (types/space.ts).
const HALL_W = TRADES_HALL_GRAND_HALL_DIMENSIONS.width; // 21 m
const HALL_L = TRADES_HALL_GRAND_HALL_DIMENSIONS.length; // 10.5 m
const PUBLISHED = { kind: "published", capacity: { theatre: 250, classroom: 80, dinner: 180, reception: 250 }, source: PUBLISHED_CAPACITY_LABEL } as const;

function banquet(guests: number, width = HALL_W, length = HALL_L): BanquetFillPlan {
  const plan = planAutoFill("dinner-rounds", guests, width, length);
  if (plan === null || plan.style !== "dinner-rounds") throw new Error("no banquet plan");
  return plan;
}

function whiteRound(): NonNullable<ReturnType<typeof getCatalogueItemBySlug>> {
  const table = getCatalogueItemBySlug("round-table-6ft-white");
  if (table === undefined) throw new Error("no 6 ft round");
  return table;
}

describe("auto-fill banquet in the Grand Hall (21 × 10.5 m)", () => {
  it("sets the 6 ft rounds for the ten the catalogue records, not eight", () => {
    expect(banquetSeatsPerTable(whiteRound())).toBe(10);
    expect(banquet(220).seatsPerTable).toBe(10);
  });

  it("places more than the 8 tables and 64 chairs it used to for 220 guests, and says the room is full at this spacing", () => {
    const plan = banquet(220);
    expect(plan.tableCount).toBe(14);
    expect(plan.chairs).toBe(140);
    expect(plan.roomForSeats).toBe(140);
    expect(plan.meetsTarget).toBe(false);
    expect(roomAtSpacingLine(plan, publishedFigureFor(PUBLISHED, "dinner")))
      .toBe("Room for 140 at this spacing; the venue publishes 180 for a seated dinner.");
  });

  it("places exactly enough whole tables when the room takes the guests", () => {
    for (const guests of [16, 60, 100, 133, 140]) {
      const plan = banquet(guests);
      expect(plan.meetsTarget).toBe(true);
      expect(plan.tableCount).toBe(Math.ceil(guests / 10));
      expect(plan.chairs).toBeGreaterThanOrEqual(guests);
      expect(roomAtSpacingLine(plan, publishedFigureFor(PUBLISHED, "dinner"))).toBeNull();
    }
  });

  it("keeps 0.6 m clear behind every chair: between neighbouring rounds and to every wall", () => {
    const plan = banquet(0);
    const radius = tableGroupPlanningRadius(whiteRound(), 10);
    expect(radius).toBeCloseTo(Math.hypot(1.83 / 2 + 0.05 + 0.58, 0.21), 6);
    for (const [i, a] of plan.tables.entries()) {
      expect(HALL_W / 2 - Math.abs(a.xM) - radius).toBeGreaterThanOrEqual(BANQUET_CHAIR_CLEARANCE_M - 1e-9);
      expect(HALL_L / 2 - Math.abs(a.zM) - radius).toBeGreaterThanOrEqual(BANQUET_CHAIR_CLEARANCE_M - 1e-9);
      for (const b of plan.tables.slice(i + 1)) {
        expect(Math.hypot(a.xM - b.xM, a.zM - b.zM) - 2 * radius).toBeGreaterThanOrEqual(BANQUET_CHAIR_CLEARANCE_M - 1e-9);
      }
    }
  });

  it("leaves the circulation check nothing to flag between the tables", () => {
    const plan = banquet(0);
    const report = computeCirculation(plan.tables.map((t, i) => ({
      id: `t${String(i)}`, label: "round", cx: t.xM, cz: t.zM, width: 1.83, depth: 1.83, rotation: 0,
    })));
    expect(report.tightestGapM).not.toBeNull();
    expect(report.tightestGapM ?? 0).toBeGreaterThanOrEqual(CIRCULATION_AISLE.comfortableM);
    expect(report.problemGaps).toHaveLength(0);
  });

  it("balances a partial fill about the middle of the room", () => {
    const plan = banquet(60);
    const sumX = plan.tables.reduce((sum, t) => sum + t.xM, 0);
    const sumZ = plan.tables.reduce((sum, t) => sum + t.zM, 0);
    expect(Math.abs(sumX)).toBeLessThan(1e-6);
    expect(Math.abs(sumZ)).toBeLessThan(1e-6);
  });

  it("says plainly what a smaller room takes, without claiming a capacity", () => {
    const saloon = banquet(60, TRADES_HALL_SALOON_DIMENSIONS.width, TRADES_HALL_SALOON_DIMENSIONS.length);
    expect(saloon.meetsTarget).toBe(false);
    const line = roomAtSpacingLine(saloon, { figure: 60, format: "dinner", source: PUBLISHED_CAPACITY_LABEL });
    expect(line).toBe(`Room for ${String(saloon.roomForSeats)} at this spacing; the venue publishes 60 for a seated dinner.`);
    expect(line).not.toMatch(/capacity|fits|over|tight/i);
  });

  it("states the room at this spacing alone when the venue publishes no figure", () => {
    expect(roomAtSpacingLine(banquet(220), null)).toBe("Room for 140 at this spacing.");
  });

  it("returns no plan for a standing poseur or a room too small for one round", () => {
    const poseur = getCatalogueItemBySlug("poseur-table");
    if (poseur === undefined) throw new Error("no poseur");
    expect(planBanquetFill(poseur, 40, 8, HALL_W, HALL_L)).toBeNull();
    expect(planAutoFill("dinner-rounds", 40, 3, 3)).toBeNull();
  });
});

describe("auto-fill theatre in the Grand Hall", () => {
  it("rounds up to whole rows of the default theatre spacing", () => {
    const plan = planAutoFill("theatre", 220, HALL_W, HALL_L);
    if (plan === null || plan.style !== "theatre") throw new Error("no theatre plan");
    expect(plan.chairs).toBe(224);
    expect(plan.rows).toBe(16);
    expect(plan.meetsTarget).toBe(true);
    expect(roomAtSpacingLine(plan, publishedFigureFor(PUBLISHED, "theatre"))).toBeNull();
  });

  it("says what the room takes when the rows run out", () => {
    const plan = planAutoFill("theatre", 400, HALL_W, HALL_L);
    if (plan === null || plan.style !== "theatre") throw new Error("no theatre plan");
    expect(plan.meetsTarget).toBe(false);
    expect(roomAtSpacingLine(plan, publishedFigureFor(PUBLISHED, "theatre")))
      .toBe(`Room for ${String(plan.roomForSeats)} at this spacing; the venue publishes 250 for theatre.`);
  });
});

describe("auto-fill words", () => {
  it("states the consequence on the button and the spacing beside it", () => {
    const plan = banquet(220);
    expect(autoFillActionLabel(plan)).toBe("Place 14 tables and 140 chairs");
    expect(autoFillBasis(plan)).toBe("Rounds of 10, with 0.6 m clear behind every chair.");
    expect(autoFillPlacedLine(plan)).toBe("Placed 14 round tables and 140 chairs.");
    const theatre = planAutoFill("theatre", 220, HALL_W, HALL_L);
    if (theatre === null) throw new Error("no theatre plan");
    expect(autoFillActionLabel(theatre)).toBe("Place 224 chairs in 16 rows");
    // 16 rows of 14 in the hall's chairs as recorded: 8 rows of the pink chair (112 of 120), 7 of the checked (98 of 106), 1 of the red.
    expect(autoFillBasis(theatre)).toBe("Rows 0.9 m apart, a 1.1 m centre aisle and 2.4 m clear at the front. The front rows take the pink chair, then the checked chair, then the red chair with gold legs, as the hall's own chairs run.");
  });

  it("names the published figure with who stated it", () => {
    const figure = publishedFigureFor(PUBLISHED, "dinner");
    expect(figure).toEqual({ figure: 180, format: "dinner", source: "Published guide · Trades Hall · 9 Jul 2026" });
    if (figure === null) return;
    expect(publishedFigureLine(figure)).toBe("The venue publishes 180 for a seated dinner.");
    expect(publishedFigureFor({ kind: "not-published" }, "dinner")).toBeNull();
    expect(publishedFigureFor({ kind: "reading" }, "dinner")).toBeNull();
  });

  it("speaks of occasions in the venue's words", () => {
    expect(occasionPhrase("dinner")).toBe("a seated dinner");
    expect(occasionPhrase("reception")).toBe("a standing reception");
    expect(occasionPhrase("theatre")).toBe("theatre");
    expect(occasionPhrase("classroom")).toBe("classroom");
  });

  it("uses no system words or praise", () => {
    const plan = banquet(220);
    const text = [
      autoFillActionLabel(plan), autoFillBasis(plan), autoFillPlacedLine(plan),
      roomAtSpacingLine(plan, publishedFigureFor(PUBLISHED, "dinner")) ?? "",
    ].join(" ");
    expect(text).not.toMatch(/hash|snapshot|token|handoff|great|perfect|awesome|!/i);
  });
});
