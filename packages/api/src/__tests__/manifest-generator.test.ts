import { describe, it, expect } from "vitest";
import { generateManifest, type ManifestObject } from "../services/manifest-generator.js";
import type { RoomLayout } from "../services/spatial-classifier.js";

// ---------------------------------------------------------------------------
// Test room
// ---------------------------------------------------------------------------

const ROOM: RoomLayout = {
  widthM: 21,
  lengthM: 10.5,
  features: [
    { name: "entrance", x: 0, z: -5.25 },
    { name: "stage", x: 0, z: 4.5 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTable(id: string, name: string, groupId: string | null, x = 0, z = 0): ManifestObject {
  return {
    id, assetName: name, assetCategory: "table",
    positionX: x, positionY: 0, positionZ: z,
    rotationY: 0, chairCount: 0, groupId,
  };
}

function makeChair(id: string, groupId: string | null, x = 0, z = 0): ManifestObject {
  return {
    id, assetName: "Banquet Chair", assetCategory: "chair",
    positionX: x, positionY: 0, positionZ: z,
    rotationY: 0, chairCount: 0, groupId,
  };
}

function makeOther(id: string, name: string, category: string, x = 0, z = 0): ManifestObject {
  return {
    id, assetName: name, assetCategory: category,
    positionX: x, positionY: 0, positionZ: z,
    rotationY: 0, chairCount: 0, groupId: null,
  };
}

// ---------------------------------------------------------------------------
// Empty configuration
// ---------------------------------------------------------------------------

describe("generateManifest", () => {
  it("empty configuration → empty manifest", () => {
    const result = generateManifest([], ROOM);
    expect(result.rows).toHaveLength(0);
    expect(result.totals.entries).toHaveLength(0);
    expect(result.totals.totalChairs).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Single items
  // -----------------------------------------------------------------------

  it("single table → one manifest row", () => {
    const objects = [makeTable("t1", "6ft Round Table", null)];
    const result = generateManifest(objects, ROOM);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    const tableRow = result.rows.find((r) => r.code === "T1");
    expect(tableRow).toBeDefined();
    expect(tableRow!.item).toContain("6ft Round Table");
  });

  it("single stage → one manifest row with S prefix", () => {
    const objects = [makeOther("s1", "Platform", "stage")];
    const result = generateManifest(objects, ROOM);
    const stageRow = result.rows.find((r) => r.code === "S1");
    expect(stageRow).toBeDefined();
    expect(stageRow!.item).toBe("Platform");
  });

  it("single lectern → one manifest row with L prefix", () => {
    const objects = [makeOther("l1", "Lectern", "lectern")];
    const result = generateManifest(objects, ROOM);
    const row = result.rows.find((r) => r.code === "L1");
    expect(row).toBeDefined();
  });

  it("single AV item → one manifest row with AV prefix", () => {
    const objects = [makeOther("av1", "Projector Screen", "av")];
    const result = generateManifest(objects, ROOM);
    const row = result.rows.find((r) => r.code === "AV1");
    expect(row).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Chair aggregation — the critical test
  // -----------------------------------------------------------------------

  it("10 round tables with 8 chairs each → NOT 80 individual chair rows", () => {
    const objects: ManifestObject[] = [];
    for (let i = 0; i < 10; i++) {
      const groupId = `group-${String(i)}`;
      const x = (i % 5) * 3 - 6;
      const z = i < 5 ? -2 : 2;
      objects.push(makeTable(`t${String(i)}`, "6ft Round Table", groupId, x, z));
      for (let c = 0; c < 8; c++) {
        objects.push(makeChair(`c${String(i)}-${String(c)}`, groupId, x, z));
      }
    }

    const result = generateManifest(objects, ROOM);
    // Should have ~10 table rows + 1 chair summary row, NOT 80+ rows
    expect(result.rows.length).toBeLessThan(20);
    // Chair summary row should show total = 80
    const chairRow = result.rows.find((r) => r.code === "CH");
    expect(chairRow).toBeDefined();
    expect(chairRow!.qty).toBe(80);
  });

  it("chair count in manifest equals input chair count (property test)", () => {
    const objects: ManifestObject[] = [];
    const groupId = "g1";
    objects.push(makeTable("t1", "Table", groupId));
    for (let i = 0; i < 12; i++) {
      objects.push(makeChair(`c${String(i)}`, groupId));
    }

    const result = generateManifest(objects, ROOM);
    expect(result.totals.totalChairs).toBe(12);
  });

  it("ungrouped chairs appear as standalone row", () => {
    const objects = [
      makeChair("c1", null, -3, 0),
      makeChair("c2", null, 3, 0),
    ];
    const result = generateManifest(objects, ROOM);
    const standalone = result.rows.find((r) => r.item.includes("Standalone"));
    expect(standalone).toBeDefined();
    expect(standalone!.qty).toBe(2);
  });

  it("table with chairs shows chair count in item name", () => {
    const groupId = "g1";
    const objects = [
      makeTable("t1", "6ft Round Table", groupId),
      ...Array.from({ length: 8 }, (_, i) => makeChair(`c${String(i)}`, groupId)),
    ];
    const result = generateManifest(objects, ROOM);
    const tableRow = result.rows.find((r) => r.code === "T1");
    expect(tableRow).toBeDefined();
    expect(tableRow!.item).toContain("with 8 chairs");
  });

  // -----------------------------------------------------------------------
  // Setup sequence ordering
  // -----------------------------------------------------------------------

  it("stage comes before tables in manifest", () => {
    const objects = [
      makeTable("t1", "Table", null),
      makeOther("s1", "Platform", "stage"),
    ];
    const result = generateManifest(objects, ROOM);
    const stageIdx = result.rows.findIndex((r) => r.setupGroup === "stage");
    const tableIdx = result.rows.findIndex((r) => r.setupGroup === "table");
    expect(stageIdx).toBeLessThan(tableIdx);
  });

  it("tables come before AV equipment", () => {
    const objects = [
      makeOther("av1", "Projector", "av"),
      makeTable("t1", "Table", null),
    ];
    const result = generateManifest(objects, ROOM);
    const tableIdx = result.rows.findIndex((r) => r.setupGroup === "table");
    const avIdx = result.rows.findIndex((r) => r.setupGroup === "av");
    expect(tableIdx).toBeLessThan(avIdx);
  });

  it("AV comes before lectern", () => {
    const objects = [
      makeOther("l1", "Lectern", "lectern"),
      makeOther("av1", "Projector", "av"),
    ];
    const result = generateManifest(objects, ROOM);
    const avIdx = result.rows.findIndex((r) => r.setupGroup === "av");
    const lecIdx = result.rows.findIndex((r) => r.setupGroup === "lectern");
    expect(avIdx).toBeLessThan(lecIdx);
  });

  // -----------------------------------------------------------------------
  // Codes are sequential and unique
  // -----------------------------------------------------------------------

  it("codes are unique", () => {
    const objects = [
      makeOther("s1", "Platform", "stage"),
      makeOther("s2", "Platform", "stage"),
      makeTable("t1", "Round Table", null),
      makeTable("t2", "Trestle Table", null),
      makeOther("av1", "Projector", "av"),
    ];
    const result = generateManifest(objects, ROOM);
    const codes = result.rows.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("sequential codes within same group (S1, S2, S3)", () => {
    const objects = [
      makeOther("s1", "Platform", "stage"),
      makeOther("s2", "Platform", "stage"),
      makeOther("s3", "Platform", "stage"),
    ];
    const result = generateManifest(objects, ROOM);
    expect(result.rows[0]!.code).toBe("S1");
    expect(result.rows[1]!.code).toBe("S2");
    expect(result.rows[2]!.code).toBe("S3");
  });

  // -----------------------------------------------------------------------
  // Position descriptions
  // -----------------------------------------------------------------------

  it("each row has a non-empty position string", () => {
    const objects = [
      makeOther("s1", "Platform", "stage", 0, 3),
      makeTable("t1", "Table", null, -5, -2),
    ];
    const result = generateManifest(objects, ROOM);
    for (const row of result.rows) {
      expect(row.position.length).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // Totals
  // -----------------------------------------------------------------------

  it("totals include all non-chair items", () => {
    const objects = [
      makeTable("t1", "Round Table", null),
      makeTable("t2", "Round Table", null),
      makeOther("s1", "Platform", "stage"),
    ];
    const result = generateManifest(objects, ROOM);
    expect(result.totals.entries.length).toBe(2); // "Round Table" × 2 and "Platform" × 1
    const tableEntry = result.totals.entries.find((e) => e.item === "Round Table");
    expect(tableEntry).toBeDefined();
    expect(tableEntry!.qty).toBe(2);
  });

  it("totals.totalChairs counts all chairs", () => {
    const groupId = "g1";
    const objects = [
      makeTable("t1", "Table", groupId),
      makeChair("c1", groupId),
      makeChair("c2", groupId),
      makeChair("c3", null), // ungrouped
    ];
    const result = generateManifest(objects, ROOM);
    expect(result.totals.totalChairs).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Large configuration (stress test)
  // -----------------------------------------------------------------------

  it("handles 500 objects without error", () => {
    const objects: ManifestObject[] = [];
    for (let i = 0; i < 50; i++) {
      const groupId = `g${String(i)}`;
      objects.push(makeTable(`t${String(i)}`, "Round Table", groupId, (i % 10) * 2 - 9, Math.floor(i / 10) * 2 - 4));
      for (let c = 0; c < 8; c++) {
        objects.push(makeChair(`c${String(i)}-${String(c)}`, groupId));
      }
    }
    // 50 tables + 400 chairs = 450
    objects.push(makeOther("s1", "Platform", "stage"));
    objects.push(makeOther("av1", "Projector", "av"));

    const result = generateManifest(objects, ROOM);
    expect(result.rows.length).toBeLessThan(100); // well below 450
    expect(result.totals.totalChairs).toBe(400);
  });
});
