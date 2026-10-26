import { describe, it, expect } from "vitest";
import {
  generateManifestV2,
  manifestKey,
  type ManifestObjectV2,
  type AccessoryMap,
  type AccessoryRule,
} from "../services/manifest-generator-v2.js";

const ROOM = { widthM: 21, lengthM: 10.5 };

function obj(partial: Partial<ManifestObjectV2> & { id: string; assetName: string; assetCategory: string }): ManifestObjectV2 {
  return {
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationY: 0,
    chairCount: 0,
    groupId: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Test accessory map — matches the Trades Hall seed data.
// In production this comes from the asset_accessories DB table.
// ---------------------------------------------------------------------------

function buildTestAccessories(): AccessoryMap {
  const m = new Map<string, AccessoryRule[]>();
  m.set("6ft Round Table", [
    { name: "Ivory Tablecloth", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
    { name: "Gold Organza Runner", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 1 },
    { name: "Floral Centrepiece (low)", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 2 },
    { name: "Acrylic Table Number", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 2 },
    { name: "LED Pillar Candle", category: "decor", quantityPerParent: 3, phase: "final", afterDepth: 0 },
  ]);
  m.set("Banquet Chair", [
    { name: "Gold Chair Sash", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 },
  ]);
  m.set("Laser Projector", [
    { name: "HDMI Cable (5m)", category: "av", quantityPerParent: 1, phase: "technical", afterDepth: 1 },
  ]);
  return m;
}

const ACC = buildTestAccessories();

describe("manifestKey — stability", () => {
  it("produces the same key across equivalent rows", () => {
    const a = manifestKey({ phase: "furniture", zone: "Centre", name: "6ft Round Table with 10 chairs", afterDepth: 0 });
    const b = manifestKey({ phase: "furniture", zone: "Centre", name: "6ft Round Table with 10 chairs", afterDepth: 0 });
    expect(a).toBe(b);
  });

  it("differs when any field differs", () => {
    const base = { phase: "furniture", zone: "Centre", name: "X", afterDepth: 0 } as const;
    expect(manifestKey(base)).not.toBe(manifestKey({ ...base, phase: "dress" }));
    expect(manifestKey(base)).not.toBe(manifestKey({ ...base, zone: "North wall" }));
    expect(manifestKey(base)).not.toBe(manifestKey({ ...base, name: "Y" }));
    expect(manifestKey(base)).not.toBe(manifestKey({ ...base, afterDepth: 1 }));
  });
});

describe("generateManifestV2 — empty input", () => {
  it("returns zero phases, zero totals", () => {
    const out = generateManifestV2([], ROOM, ACC);
    expect(out.phases).toHaveLength(0);
    expect(out.totals.totalRows).toBe(0);
    expect(out.totals.totalItems).toBe(0);
  });
});

describe("generateManifestV2 — single round table with chairs", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c1", assetName: "Banquet Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c2", assetName: "Banquet Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
  ];

  const out = generateManifestV2(placed, ROOM, ACC);

  it("emits a furniture phase with one table row named 'with 2 chairs'", () => {
    const furniture = out.phases.find((p) => p.phase === "furniture");
    expect(furniture).toBeDefined();
    const row = furniture?.zones.flatMap((z) => z.rows).find((r) => !r.isAccessory);
    expect(row?.name).toBe("6ft Round Table with 2 chairs");
    expect(row?.qty).toBe(1);
  });

  it("emits a dress phase with cloth/runner/centrepiece (accessories)", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    expect(dress).toBeDefined();
    const names = dress?.zones.flatMap((z) => z.rows.map((r) => r.name)) ?? [];
    expect(names).toContain("Ivory Tablecloth");
    expect(names).toContain("Gold Organza Runner");
    expect(names).toContain("Floral Centrepiece (low)");
  });

  it("emits exactly 2 chair sashes (one per chair) in the dress phase", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const sashRow = dress?.zones.flatMap((z) => z.rows).find((r) => r.name === "Gold Chair Sash");
    expect(sashRow).toBeDefined();
    expect(sashRow?.qty).toBe(2);
  });

  it("emits LED candles in the final phase (qty = 3 per table)", () => {
    const final = out.phases.find((p) => p.phase === "final");
    const candles = final?.zones.flatMap((z) => z.rows).find((r) => r.name === "LED Pillar Candle");
    expect(candles?.qty).toBe(3);
  });

  it("within the dress zone, afterDepth 0 rows come before afterDepth 1 rows", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const rows = dress?.zones[0]?.rows ?? [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (prev === undefined || curr === undefined) continue;
      expect(prev.afterDepth).toBeLessThanOrEqual(curr.afterDepth);
    }
  });
});

describe("generateManifestV2 — accessories collapse across same-zone parents", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "t2", assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", positionX: 1, positionZ: 0.5 }),
  ];
  const out = generateManifestV2(placed, ROOM, ACC);

  it("two same-zone tables produce ONE cloth row with qty=2, not two rows", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const clothRows = dress?.zones.flatMap((z) => z.rows).filter((r) => r.name === "Ivory Tablecloth");
    expect(clothRows).toHaveLength(1);
    expect(clothRows?.[0]?.qty).toBe(2);
  });
});

describe("generateManifestV2 — distinct zones do NOT collapse", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: -4.8 }),
    obj({ id: "t2", assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", positionX: 0, positionZ: 4.5 }),
  ];
  const out = generateManifestV2(placed, ROOM, ACC);

  it("two different-zone tables produce two cloth rows (one per zone)", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const clothRows = dress?.zones.flatMap((z) => z.rows).filter((r) => r.name === "Ivory Tablecloth");
    expect(clothRows).toHaveLength(2);
    expect(clothRows?.every((r) => r.qty === 1)).toBe(true);
  });
});

describe("generateManifestV2 — Laser Projectors imply HDMI cables", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "proj1", assetName: "Laser Projector", assetCategory: "av", positionX: -8, positionZ: -4.8 }),
    obj({ id: "proj2", assetName: "Laser Projector", assetCategory: "av", positionX: 8, positionZ: -4.8 }),
  ];
  const out = generateManifestV2(placed, ROOM, ACC);

  it("lands projectors in technical phase North wall", () => {
    const tech = out.phases.find((p) => p.phase === "technical");
    const proj = tech?.zones.flatMap((z) => z.rows).find((r) => r.name === "Laser Projector");
    expect(proj?.qty).toBe(2);
  });

  it("emits 2 HDMI cables (one per projector) in the SAME zone, technical phase", () => {
    const tech = out.phases.find((p) => p.phase === "technical");
    const cable = tech?.zones.flatMap((z) => z.rows).find((r) => r.name === "HDMI Cable (5m)");
    expect(cable?.qty).toBe(2);
  });
});

describe("generateManifestV2 — empty accessory map produces no accessories", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table" }),
  ];
  const out = generateManifestV2(placed, ROOM, new Map());

  it("only the parent item appears, no accessories", () => {
    const allRows = out.phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.isAccessory).toBe(false);
  });
});

describe("generateManifestV2 — a chair not grouped with a table", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "h1", assetName: "Banquet Chair", assetCategory: "chair", positionX: 0, positionZ: 0 }),
  ];
  const out = generateManifestV2(placed, ROOM, ACC);
  const rows = out.phases.flatMap((p) => p.zones.flatMap((z) => z.rows));

  it("is listed once, as one chair", () => {
    const chairRows = rows.filter((r) => r.name === "Banquet Chair");
    expect(chairRows).toHaveLength(1);
    expect(chairRows[0]?.qty).toBe(1);
  });

  it("brings its accessories once", () => {
    expect(rows.find((r) => r.name === "Gold Chair Sash")?.qty).toBe(1);
    expect(out.totals.totalItems).toBe(2);
  });
});

describe("generateManifestV2 — totals", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c1", assetName: "Banquet Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
  ];
  const out = generateManifestV2(placed, ROOM, ACC);

  it("totalRows matches the number of distinct (phase, zone, name, depth) rows", () => {
    let count = 0;
    for (const p of out.phases) for (const z of p.zones) count += z.rows.length;
    expect(out.totals.totalRows).toBe(count);
  });

  it("totalItems sums qty across every row", () => {
    let sum = 0;
    for (const p of out.phases) for (const z of p.zones) for (const r of z.rows) sum += r.qty;
    expect(out.totals.totalItems).toBe(sum);
  });

  it("entries contains one record per distinct item name, summed", () => {
    const cloth = out.totals.entries.find((e) => e.name === "Ivory Tablecloth");
    expect(cloth?.qty).toBe(1);
  });
});

describe("generateManifestV2 — per-row positions", () => {
  const UUID_A = "00000000-0000-4000-8000-00000000000a";
  const UUID_B = "00000000-0000-4000-8000-00000000000b";
  const UUID_C = "00000000-0000-4000-8000-00000000000c";

  it("emits one position per non-accessory placement, none per accessory", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: UUID_A, assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 2, positionZ: 1, rotationY: 0.5 }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const furniture = out.phases.find((p) => p.phase === "furniture");
    const tableRow = furniture?.zones.flatMap((z) => z.rows).find((r) => !r.isAccessory);
    expect(tableRow?.positions).toHaveLength(1);
    expect(tableRow?.positions[0]?.objectId).toBe(UUID_A);
    expect(tableRow?.positions[0]?.x).toBe(2);
    expect(tableRow?.positions[0]?.z).toBe(1);
    expect(tableRow?.positions[0]?.rotationY).toBe(0.5);

    const dress = out.phases.find((p) => p.phase === "dress");
    const cloth = dress?.zones.flatMap((z) => z.rows).find((r) => r.name === "Ivory Tablecloth");
    expect(cloth?.positions).toEqual([]);
  });

  it("aggregated parent rows accumulate one position per placement", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: UUID_A, assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
      obj({ id: UUID_B, assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", positionX: 0.2, positionZ: 0.2 }),
      obj({ id: UUID_C, assetName: "6ft Round Table", assetCategory: "table", groupId: "g3", positionX: -0.2, positionZ: -0.2 }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const furniture = out.phases.find((p) => p.phase === "furniture");
    const tableRow = furniture?.zones.flatMap((z) => z.rows).find((r) => !r.isAccessory);
    expect(tableRow?.qty).toBe(3);
    expect(tableRow?.positions).toHaveLength(3);
    const ids = tableRow?.positions.map((p) => p.objectId).sort();
    expect(ids).toEqual([UUID_A, UUID_B, UUID_C].sort());
  });
});

describe("generateManifestV2 — per-row notes", () => {
  const UUID_A = "00000000-0000-4000-8000-00000000000a";
  const UUID_B = "00000000-0000-4000-8000-00000000000b";

  it("row notes carry the planner's annotation", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({
        id: UUID_A,
        assetName: "6ft Round Table",
        assetCategory: "table",
        groupId: "g1",
        notes: "VIP table — reserved for the Anderson family",
      }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const tableRow = out.phases.find((p) => p.phase === "furniture")?.zones[0]?.rows[0];
    expect(tableRow?.notes).toBe("VIP table — reserved for the Anderson family");
  });

  it("accessories inherit the parent's note (so the hallkeeper knows the VIP tablecloth is VIP too)", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({
        id: UUID_A,
        assetName: "6ft Round Table",
        assetCategory: "table",
        groupId: "g1",
        notes: "VIP table",
      }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const cloth = out.phases.find((p) => p.phase === "dress")?.zones.flatMap((z) => z.rows).find((r) => r.name === "Ivory Tablecloth");
    expect(cloth?.notes).toBe("VIP table");
  });

  it("distinct notes from aggregated placements are joined with a separator", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: UUID_A, assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", notes: "VIP" }),
      obj({ id: UUID_B, assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", notes: "Needs extra chair" }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const tableRow = out.phases.find((p) => p.phase === "furniture")?.zones[0]?.rows[0];
    expect(tableRow?.notes).toContain("VIP");
    expect(tableRow?.notes).toContain("Needs extra chair");
    expect(tableRow?.notes).toContain(" · ");
  });

  it("duplicate notes are deduplicated", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: UUID_A, assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", notes: "VIP" }),
      obj({ id: UUID_B, assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", notes: "VIP" }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const tableRow = out.phases.find((p) => p.phase === "furniture")?.zones[0]?.rows[0];
    expect(tableRow?.notes).toBe("VIP");
  });

  it("empty / whitespace notes are ignored", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: UUID_A, assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", notes: "   " }),
      obj({ id: UUID_B, assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", notes: null }),
    ];
    const out = generateManifestV2(placed, ROOM, ACC);
    const tableRow = out.phases.find((p) => p.phase === "furniture")?.zones[0]?.rows[0];
    expect(tableRow?.notes).toBe("");
  });
});

describe("generateManifestV2 — stable keys survive re-save", () => {
  it("same placement input produces identical keys across two calls", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    ];
    const a = generateManifestV2(placed, ROOM, ACC);
    const b = generateManifestV2(placed, ROOM, ACC);
    const keysA = a.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key)));
    const keysB = b.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key)));
    expect(keysA).toEqual(keysB);
  });

  it("re-saving with a different placed-object id does NOT change the keys", () => {
    const a = generateManifestV2(
      [obj({ id: "first", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1" })],
      ROOM, ACC,
    );
    const b = generateManifestV2(
      [obj({ id: "second-after-save", assetName: "6ft Round Table", assetCategory: "table", groupId: "g9" })],
      ROOM, ACC,
    );
    const keysA = a.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key))).sort();
    const keysB = b.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key))).sort();
    expect(keysA).toEqual(keysB);
  });
});

// ---------------------------------------------------------------------------
// Release audit hallkeeper-ops-3 / planner-qol E-13: every chair the planner
// placed is on the sheet once, at the right table, and the crew can read the
// tables' numbers and the dance floor's size.
// ---------------------------------------------------------------------------

/** Chairs the sheet asks for: "with N chairs" rows and the chairs listed as themselves. */
function chairsOnSheet(result: ReturnType<typeof generateManifestV2>): number {
  let total = 0;
  for (const phase of result.phases) for (const zone of phase.zones) for (const row of zone.rows) {
    if (row.isAccessory) continue;
    const seated = /^.* with (\d+) chairs?$/u.exec(row.name);
    if (seated?.[1] !== undefined) total += row.qty * Number(seated[1]);
    else if (row.category === "chair") total += row.qty;
  }
  return total;
}

describe("generateManifestV2 — chairs grouped with no table", () => {
  const rowOfChairs = Array.from({ length: 12 }, (_, seat) => obj({
    id: `c${String(seat).padStart(2, "0")}`, assetName: "Banquet Chair", assetCategory: "chair",
    groupId: "ceremony-row", positionX: -3 + seat * 0.5, positionZ: 0,
  }));

  it("keeps every chair on the sheet, listed as chairs", () => {
    const result = generateManifestV2(rowOfChairs, ROOM, ACC);
    const chairRows = result.phases.flatMap((p) => p.zones.flatMap((z) => z.rows))
      .filter((row) => row.name === "Banquet Chair" && !row.isAccessory);
    expect(chairRows.reduce((sum, row) => sum + row.qty, 0)).toBe(12);
    expect(chairsOnSheet(result)).toBe(12);
  });
});

describe("generateManifestV2 — two tables in one group", () => {
  const layout = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: -2, positionZ: 0 }),
    obj({ id: "t2", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 2, positionZ: 0 }),
    ...Array.from({ length: 4 }, (_, seat) => obj({ id: `a${String(seat)}`, assetName: "Banquet Chair", assetCategory: "chair", groupId: "g1", positionX: -2.9, positionZ: -0.6 + seat * 0.4 })),
    ...Array.from({ length: 6 }, (_, seat) => obj({ id: `b${String(seat)}`, assetName: "Banquet Chair", assetCategory: "chair", groupId: "g1", positionX: 2.9, positionZ: -1 + seat * 0.4 })),
  ];

  it("counts each table's own chairs, not the whole group's twice", () => {
    const result = generateManifestV2(layout, ROOM, ACC);
    const names = result.phases.flatMap((p) => p.zones.flatMap((z) => z.rows)).filter((row) => row.category === "table").map((row) => row.name).sort();
    expect(names).toEqual(["6ft Round Table with 4 chairs", "6ft Round Table with 6 chairs"]);
    expect(chairsOnSheet(result)).toBe(10);
  });
});

describe("generateManifestV2 — the sheet's chairs equal the chairs placed", () => {
  it("holds for 200 random layouts of tables, chairs and groups", () => {
    // A small seeded generator, so a failure names a layout that can be replayed.
    let seed = 20261026;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let layoutIndex = 0; layoutIndex < 200; layoutIndex += 1) {
      const objects: ManifestObjectV2[] = [];
      let chairs = 0;
      const groups = Math.floor(next() * 6);
      for (let group = 0; group < groups; group += 1) {
        const groupId = `g${String(group)}`;
        const tables = Math.floor(next() * 3);
        for (let table = 0; table < tables; table += 1) {
          objects.push(obj({ id: `${groupId}t${String(table)}`, assetName: "6ft Round Table", assetCategory: "table", groupId, positionX: next() * 18 - 9, positionZ: next() * 8 - 4 }));
        }
        const seats = Math.floor(next() * 12);
        for (let seat = 0; seat < seats; seat += 1) {
          objects.push(obj({ id: `${groupId}c${String(seat)}`, assetName: "Banquet Chair", assetCategory: "chair", groupId, positionX: next() * 18 - 9, positionZ: next() * 8 - 4 }));
          chairs += 1;
        }
      }
      const loose = Math.floor(next() * 5);
      for (let seat = 0; seat < loose; seat += 1) {
        objects.push(obj({ id: `loose${String(seat)}`, assetName: "Banquet Chair", assetCategory: "chair", positionX: next() * 18 - 9, positionZ: next() * 8 - 4 }));
        chairs += 1;
      }
      expect(chairsOnSheet(generateManifestV2(objects, ROOM, ACC)), `layout ${String(layoutIndex)}`).toBe(chairs);
    }
  });
});

describe("generateManifestV2 — a laid dance floor", () => {
  const panel = (i: number, j: number, groupId: string | null = "floor"): ManifestObjectV2 => obj({
    id: `p${String(i)}${String(j)}`, assetName: "Parquet Dance Floor Panel", assetCategory: "stage", groupId,
    positionX: 2 + i * 0.91, positionZ: -1 + j * 0.91, widthM: 0.91, depthM: 0.91, scale: 1,
  });
  const grid = (cols: number, rows: number): ManifestObjectV2[] =>
    Array.from({ length: cols }, (_, i) => Array.from({ length: rows }, (_, j) => panel(i, j))).flat();

  it("is one row of its panels, with the floor's size as it is built", () => {
    const rows = generateManifestV2(grid(6, 4), ROOM, ACC).phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Parquet Dance Floor Panel", qty: 24, labels: ["Laid as one floor, 6 × 4 panels, 5.46 × 3.64 m"] });
    expect(rows[0]?.positions).toHaveLength(24);
  });

  it("says only that it is one floor when the panels do not make a rectangle", () => {
    const rows = generateManifestV2(grid(6, 4).slice(1), ROOM, ACC).phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 23, labels: ["Laid as one floor"] });
  });

  it("leaves loose panels as they were", () => {
    const rows = generateManifestV2([panel(0, 0, null), panel(9, 0, null)], ROOM, ACC).phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    expect(rows.every((row) => row.labels === undefined)).toBe(true);
  });
});

describe("generateManifestV2 — the planner's table numbers", () => {
  it("carries each table's name on its row, and none on the linen", () => {
    const tables = [1, 2, 3].map((n) => obj({ id: `t${String(n)}`, assetName: "6ft Round Table", assetCategory: "table", positionX: 0, positionZ: 0, displayLabel: `Table ${String(n)}` }));
    const rows = generateManifestV2(tables, ROOM, ACC).phases.flatMap((p) => p.zones.flatMap((z) => z.rows));
    const tableRow = rows.find((row) => row.category === "table");
    expect(tableRow?.labels).toEqual(["Table 1", "Table 2", "Table 3"]);
    expect(rows.filter((row) => row.isAccessory).every((row) => row.labels === undefined)).toBe(true);
  });
});
