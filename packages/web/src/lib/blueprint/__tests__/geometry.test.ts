import { describe, it, expect } from "vitest";
import {
  DEFAULT_PIXELS_PER_METRE,
  computeFitScale,
  computeStatusMetrics,
  countByKind,
  distanceToItemM,
  doorPoint,
  fireEgressClear,
  floorUsedPercent,
  formatDimensions,
  getLayerRows,
  inspectorTitle,
  isRoundTable,
  itemAreaM2,
  itemBoundingBox,
  metresToPixels,
  pixelsToMetres,
  relativeTimeShort,
  roundCount,
  totalSeats,
} from "../geometry.js";
import type { BlueprintItem, BlueprintScene, RoundTableItem } from "../types.js";
import { DEMO_SCENE } from "../demo-scene.js";

const round = (id: string, x: number, y: number, seats = 10): RoundTableItem => ({
  id,
  kind: "round-table",
  shape: "round",
  center: { x, y },
  diameterM: 1.8,
  seats,
  linen: "Ivory",
  centrepiece: "Low floral",
});

describe("metresToPixels / pixelsToMetres", () => {
  it("round-trips a value", () => {
    const m = 3.5;
    expect(pixelsToMetres(metresToPixels(m))).toBeCloseTo(m, 9);
  });

  it("uses the default scale when none provided", () => {
    expect(metresToPixels(1)).toBe(DEFAULT_PIXELS_PER_METRE);
  });

  it("respects a custom scale", () => {
    expect(metresToPixels(2, 100)).toBe(200);
    expect(pixelsToMetres(50, 100)).toBe(0.5);
  });
});

describe("doorPoint", () => {
  const room = { widthM: 21, lengthM: 10 };
  it("north wall: y=0, x=distance", () => {
    expect(doorPoint("north", 4, room)).toEqual({ x: 4, y: 0 });
  });
  it("south wall: y=lengthM, x=distance", () => {
    expect(doorPoint("south", 17.5, room)).toEqual({ x: 17.5, y: 10 });
  });
  it("west wall: x=0, y=distance", () => {
    expect(doorPoint("west", 3, room)).toEqual({ x: 0, y: 3 });
  });
  it("east wall: x=widthM, y=distance", () => {
    expect(doorPoint("east", 2, room)).toEqual({ x: 21, y: 2 });
  });
});

describe("itemBoundingBox", () => {
  it("round table: centre minus radius, diameter for both sides", () => {
    const bb = itemBoundingBox(round("t", 5, 5));
    expect(bb.x).toBeCloseTo(4.1, 9);
    expect(bb.y).toBeCloseTo(4.1, 9);
    expect(bb.width).toBe(1.8);
    expect(bb.height).toBe(1.8);
  });

  it("rect item: topLeft, widthM x lengthM", () => {
    const bb = itemBoundingBox({
      id: "stage",
      kind: "stage",
      shape: "rect",
      topLeft: { x: 1, y: 1 },
      widthM: 8,
      lengthM: 3,
    });
    expect(bb).toEqual({ x: 1, y: 1, width: 8, height: 3 });
  });
});

describe("itemAreaM2", () => {
  it("round table uses π r²", () => {
    expect(itemAreaM2(round("t", 0, 0))).toBeCloseTo(Math.PI * 0.9 * 0.9, 9);
  });

  it("rect item = width × length", () => {
    const stage: BlueprintItem = {
      id: "stage", kind: "stage", shape: "rect",
      topLeft: { x: 0, y: 0 }, widthM: 8, lengthM: 3,
    };
    expect(itemAreaM2(stage)).toBe(24);
  });
});

describe("totalSeats / roundCount / countByKind", () => {
  const scene: BlueprintScene = {
    ...DEMO_SCENE,
    items: [
      round("r1", 1, 1, 8),
      round("r2", 2, 2, 10),
      {
        id: "top",
        kind: "top-table",
        shape: "rect",
        topLeft: { x: 0, y: 0 },
        widthM: 10,
        lengthM: 1.3,
        seats: 14,
      },
      {
        id: "floor",
        kind: "dancefloor",
        shape: "dancefloor",
        topLeft: { x: 0, y: 0 },
        widthM: 6,
        lengthM: 4,
      },
    ],
  };

  it("totalSeats sums round seats + rect seats", () => {
    expect(totalSeats(scene.items)).toBe(8 + 10 + 14);
  });

  it("roundCount counts only round-table kind", () => {
    expect(roundCount(scene.items)).toBe(2);
  });

  it("countByKind returns 0 for missing kinds", () => {
    expect(countByKind(scene.items, "bar")).toBe(0);
    expect(countByKind(scene.items, "round-table")).toBe(2);
    expect(countByKind(scene.items, "dancefloor")).toBe(1);
  });
});

describe("floorUsedPercent", () => {
  it("returns integer between 0 and 100", () => {
    const pct = floorUsedPercent(DEMO_SCENE);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    expect(Number.isInteger(pct)).toBe(true);
  });

  it("returns 0 for an empty scene", () => {
    const empty: BlueprintScene = { ...DEMO_SCENE, items: [] };
    expect(floorUsedPercent(empty)).toBe(0);
  });

  it("returns 0 when room has zero area", () => {
    const degenerate: BlueprintScene = {
      ...DEMO_SCENE,
      room: { widthM: 0, lengthM: 0 },
    };
    expect(floorUsedPercent(degenerate)).toBe(0);
  });
});

describe("distanceToItemM", () => {
  it("is 0 inside a round table", () => {
    const t = round("t", 5, 5);
    expect(distanceToItemM({ x: 5, y: 5 }, t)).toBe(0);
    expect(distanceToItemM({ x: 5.5, y: 5 }, t)).toBe(0);
  });

  it("is centre-distance minus radius outside a round table", () => {
    const t = round("t", 5, 5);
    expect(distanceToItemM({ x: 10, y: 5 }, t)).toBeCloseTo(5 - 0.9, 6);
  });

  it("is 0 inside a rect, positive outside", () => {
    const rect: BlueprintItem = {
      id: "r", kind: "stage", shape: "rect",
      topLeft: { x: 1, y: 1 }, widthM: 4, lengthM: 2,
    };
    expect(distanceToItemM({ x: 2, y: 2 }, rect)).toBe(0);
    // Point at (0,0) with rect starting at (1,1) → nearest corner sqrt(2).
    expect(distanceToItemM({ x: 0, y: 0 }, rect)).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe("fireEgressClear", () => {
  it("returns true for a scene with no doors", () => {
    const noDoors: BlueprintScene = {
      ...DEMO_SCENE,
      room: { ...DEMO_SCENE.room, doors: [] },
      items: DEMO_SCENE.items,
    };
    expect(fireEgressClear(noDoors)).toBe(true);
  });

  it("returns false when a table sits on a door", () => {
    const blocked: BlueprintScene = {
      ...DEMO_SCENE,
      items: [round("t", 4, 0.5)], // Directly under a north-wall door at x=4
    };
    expect(fireEgressClear(blocked)).toBe(false);
  });
});

describe("computeStatusMetrics", () => {
  it("returns the composite metric shape", () => {
    const m = computeStatusMetrics(DEMO_SCENE);
    expect(m).toHaveProperty("totalSeats");
    expect(m).toHaveProperty("roundCount");
    expect(m).toHaveProperty("floorUsedPercent");
    expect(m).toHaveProperty("fireEgressClear");
    expect(typeof m.totalSeats).toBe("number");
    expect(typeof m.fireEgressClear).toBe("boolean");
  });

  it("matches manually-computed seats on DEMO_SCENE", () => {
    // 12 rounds × 10 seats + 1 top table × 14 seats = 134
    const m = computeStatusMetrics(DEMO_SCENE);
    expect(m.totalSeats).toBe(12 * 10 + 14);
    expect(m.roundCount).toBe(12);
  });
});

describe("computeFitScale", () => {
  it("returns a positive pixels-per-metre", () => {
    const scale = computeFitScale({ widthM: 21, lengthM: 10 }, { widthPx: 1200, heightPx: 600 });
    expect(scale).toBeGreaterThan(0);
  });

  it("respects tiny viewports without collapsing", () => {
    const scale = computeFitScale({ widthM: 21, lengthM: 10 }, { widthPx: 50, heightPx: 50 });
    expect(scale).toBeGreaterThanOrEqual(1);
  });

  it("picks the smaller of width-fit / height-fit", () => {
    const tallRoom = { widthM: 1, lengthM: 100 };
    const viewport = { widthPx: 600, heightPx: 400 };
    const scale = computeFitScale(tallRoom, viewport);
    // lengthM dominates — much smaller than 600/1.
    expect(scale).toBeLessThan(10);
  });
});

describe("relativeTimeShort", () => {
  const now = 1_800_000_000_000;
  it("null → Not saved", () => {
    expect(relativeTimeShort(null, now)).toBe("Not saved");
  });
  it("<60s → just now", () => {
    expect(relativeTimeShort(now - 20_000, now)).toBe("just now");
  });
  it("<60m → Xm ago", () => {
    expect(relativeTimeShort(now - 2 * 60_000, now)).toBe("2m ago");
  });
  it("<24h → Xh ago", () => {
    expect(relativeTimeShort(now - 3 * 60 * 60_000, now)).toBe("3h ago");
  });
  it(">=24h → Xd ago", () => {
    expect(relativeTimeShort(now - 5 * 24 * 60 * 60_000, now)).toBe("5d ago");
  });
  it("negative diffs clamp to 'just now'", () => {
    expect(relativeTimeShort(now + 60_000, now)).toBe("just now");
  });
});

describe("inspectorTitle / formatDimensions / isRoundTable", () => {
  it("round-table title includes seat count", () => {
    expect(inspectorTitle(round("t", 5, 5, 10))).toBe("ROUND TABLE · 10");
  });

  it("stage title includes dimensions", () => {
    const stage: BlueprintItem = {
      id: "s", kind: "stage", shape: "rect",
      topLeft: { x: 0, y: 0 }, widthM: 8, lengthM: 3,
    };
    expect(inspectorTitle(stage)).toBe("STAGE · 8×3m");
  });

  it("formatDimensions emits decimal only when needed", () => {
    const thin: BlueprintItem = {
      id: "thin", kind: "top-table", shape: "rect",
      topLeft: { x: 0, y: 0 }, widthM: 10, lengthM: 1.3, seats: 14,
    };
    expect(formatDimensions(thin)).toBe("10×1.3m");
  });

  it("round formatDimensions uses diameter glyph", () => {
    expect(formatDimensions(round("t", 0, 0))).toBe("1.8m ⌀");
  });

  it("isRoundTable narrows the union", () => {
    const r = round("t", 0, 0);
    expect(isRoundTable(r)).toBe(true);
    const bar: BlueprintItem = {
      id: "b", kind: "bar", shape: "bar",
      topLeft: { x: 0, y: 0 }, widthM: 6, lengthM: 1,
    };
    expect(isRoundTable(bar)).toBe(false);
  });
});

describe("getLayerRows", () => {
  it("orders items top-to-bottom (last item of the array first)", () => {
    const rows = getLayerRows(DEMO_SCENE);
    expect(rows.length).toBe(DEMO_SCENE.items.length);
    // DEMO_SCENE's last items are [...rounds, dancefloor, bar].
    expect(rows[0]?.id).toBe("bar");
    expect(rows[1]?.id).toBe("dancefloor");
  });

  it("flags the selected ids", () => {
    const rows = getLayerRows(DEMO_SCENE, ["bar", "stage"]);
    const bar = rows.find((r) => r.id === "bar");
    const stage = rows.find((r) => r.id === "stage");
    const top = rows.find((r) => r.id === "top-table");
    expect(bar?.selected).toBe(true);
    expect(stage?.selected).toBe(true);
    expect(top?.selected).toBe(false);
  });

  it("reflects the locked flag", () => {
    const scene: BlueprintScene = {
      ...DEMO_SCENE,
      items: DEMO_SCENE.items.map((it) =>
        it.id === "stage" ? { ...it, locked: true } : it,
      ) as BlueprintScene["items"],
    };
    const rows = getLayerRows(scene);
    const stage = rows.find((r) => r.id === "stage");
    const bar = rows.find((r) => r.id === "bar");
    expect(stage?.locked).toBe(true);
    expect(bar?.locked).toBe(false);
  });

  it("produces human labels per kind", () => {
    const rows = getLayerRows(DEMO_SCENE);
    expect(rows.find((r) => r.id === "stage")?.label).toMatch(/^Stage ·/);
    expect(rows.find((r) => r.id === "bar")?.label).toMatch(/^Bar ·/);
    expect(rows.find((r) => r.id === "dancefloor")?.label).toMatch(/^Dancefloor ·/);
    expect(rows.find((r) => r.id === "top-table")?.label).toMatch(/^Top table ·/);
    const anyRound = rows.find((r) => r.kind === "round-table");
    expect(anyRound?.label).toMatch(/^Round table ·/);
  });

  it("handles an empty selection array safely", () => {
    const rows = getLayerRows(DEMO_SCENE, []);
    expect(rows.every((r) => !r.selected)).toBe(true);
  });
});
