import { describe, it, expect } from "vitest";
import {
  generateManifestV2,
  manifestKey,
  type ManifestObjectV2,
} from "../services/manifest-generator-v2.js";

const ROOM = { widthM: 21, lengthM: 10 };

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
    const out = generateManifestV2([], ROOM);
    expect(out.phases).toHaveLength(0);
    expect(out.totals.totalRows).toBe(0);
    expect(out.totals.totalItems).toBe(0);
  });
});

describe("generateManifestV2 — single round table with chairs", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c1", assetName: "Chiavari Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c2", assetName: "Chiavari Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
  ];

  const out = generateManifestV2(placed, ROOM);

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
  const out = generateManifestV2(placed, ROOM);

  it("two same-zone tables produce ONE cloth row with qty=2, not two rows", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const clothRows = dress?.zones.flatMap((z) => z.rows).filter((r) => r.name === "Ivory Tablecloth");
    expect(clothRows).toHaveLength(1);
    expect(clothRows?.[0]?.qty).toBe(2);
  });
});

describe("generateManifestV2 — distinct zones do NOT collapse", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: -4.8 }),   // North wall
    obj({ id: "t2", assetName: "6ft Round Table", assetCategory: "table", groupId: "g2", positionX: 0, positionZ: 4.5 }),    // South wall
  ];
  const out = generateManifestV2(placed, ROOM);

  it("two different-zone tables produce two cloth rows (one per zone)", () => {
    const dress = out.phases.find((p) => p.phase === "dress");
    const clothRows = dress?.zones.flatMap((z) => z.rows).filter((r) => r.name === "Ivory Tablecloth");
    expect(clothRows).toHaveLength(2);
    expect(clothRows?.every((r) => r.qty === 1)).toBe(true);
  });
});

describe("generateManifestV2 — PA speakers imply mics", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "pa1", assetName: "PA Speaker", assetCategory: "av", positionX: -8, positionZ: -4.8 }),
    obj({ id: "pa2", assetName: "PA Speaker", assetCategory: "av", positionX: 8, positionZ: -4.8 }),
  ];
  const out = generateManifestV2(placed, ROOM);

  it("lands PAs in technical phase North wall", () => {
    const tech = out.phases.find((p) => p.phase === "technical");
    const pa = tech?.zones.flatMap((z) => z.rows).find((r) => r.name === "PA Speaker");
    expect(pa?.qty).toBe(2);
  });

  it("emits 2 wireless microphones (one per PA) in the SAME zone, technical phase", () => {
    const tech = out.phases.find((p) => p.phase === "technical");
    const mic = tech?.zones.flatMap((z) => z.rows).find((r) => r.name === "Wireless Microphone");
    expect(mic?.qty).toBe(2);
  });
});

describe("generateManifestV2 — totals", () => {
  const placed: readonly ManifestObjectV2[] = [
    obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    obj({ id: "c1", assetName: "Chiavari Chair", assetCategory: "chair", groupId: "g1", positionX: 0, positionZ: 0 }),
  ];
  const out = generateManifestV2(placed, ROOM);

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

describe("generateManifestV2 — stable keys survive re-save", () => {
  it("same placement input produces identical keys across two calls", () => {
    const placed: readonly ManifestObjectV2[] = [
      obj({ id: "t1", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1", positionX: 0, positionZ: 0 }),
    ];
    const a = generateManifestV2(placed, ROOM);
    const b = generateManifestV2(placed, ROOM);
    const keysA = a.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key)));
    const keysB = b.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key)));
    expect(keysA).toEqual(keysB);
  });

  it("re-saving with a different placed-object id does NOT change the keys", () => {
    const a = generateManifestV2(
      [obj({ id: "first", assetName: "6ft Round Table", assetCategory: "table", groupId: "g1" })],
      ROOM,
    );
    const b = generateManifestV2(
      [obj({ id: "second-after-save", assetName: "6ft Round Table", assetCategory: "table", groupId: "g9" })],
      ROOM,
    );
    const keysA = a.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key))).sort();
    const keysB = b.phases.flatMap((p) => p.zones.flatMap((z) => z.rows.map((r) => r.key))).sort();
    expect(keysA).toEqual(keysB);
  });
});
