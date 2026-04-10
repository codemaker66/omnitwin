import { describe, it, expect } from "vitest";
import { generateManifest, type ManifestObject } from "../services/manifest-generator.js";
import { classifyPosition, type RoomLayout } from "../services/spatial-classifier.js";
import type { SheetData } from "../services/hallkeeper-sheet-v2.js";
import { generateSheetPdf } from "../services/hallkeeper-sheet-v2.js";

// ---------------------------------------------------------------------------
// Integration tests — end-to-end hallkeeper sheet pipeline
// ---------------------------------------------------------------------------

const ROOM: RoomLayout = {
  widthM: 21,
  lengthM: 10.5,
  features: [
    { name: "entrance", x: 0, z: -5.25 },
    { name: "stage", x: 0, z: 4.5 },
  ],
};

function makeSheetData(objects: readonly ManifestObject[]): SheetData {
  const manifest = generateManifest(objects, ROOM);
  return {
    venue: { id: "test-venue-id", name: "Trades Hall Glasgow", address: "85 Glassford Street, Glasgow G1 1UH", logoUrl: null },
    space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
    config: { id: "test-config-id", userId: "test-user-id", name: "Wedding Reception", layoutStyle: "dinner-rounds", guestCount: 120 },
    manifest,
    diagramUrl: null,
    webViewUrl: "https://omnitwin.com/hallkeeper/test-config-id",
    generatedAt: new Date().toISOString(),
  };
}

function makeTable(id: string, groupId: string, x: number, z: number): ManifestObject {
  return { id, assetName: "6ft Round Table", assetCategory: "table", positionX: x, positionY: 0, positionZ: z, rotationY: 0, chairCount: 0, groupId };
}

function makeChair(id: string, groupId: string): ManifestObject {
  return { id, assetName: "Banquet Chair", assetCategory: "chair", positionX: 0, positionY: 0, positionZ: 0, rotationY: 0, chairCount: 0, groupId };
}

// ---------------------------------------------------------------------------
// Full pipeline tests
// ---------------------------------------------------------------------------

describe("hallkeeper sheet integration", () => {
  it("typical wedding: 10 tables × 8 chairs + stage + AV → compact manifest", () => {
    const objects: ManifestObject[] = [];

    // Stage
    objects.push({ id: "s1", assetName: "Platform", assetCategory: "stage", positionX: 0, positionY: 0, positionZ: 4, rotationY: 0, chairCount: 0, groupId: null });

    // 10 tables with 8 chairs each
    for (let i = 0; i < 10; i++) {
      const groupId = `group-${String(i)}`;
      const x = (i % 5) * 4 - 8;
      const z = i < 5 ? -2 : 1;
      objects.push(makeTable(`t${String(i)}`, groupId, x, z));
      for (let c = 0; c < 8; c++) {
        objects.push(makeChair(`c${String(i)}-${String(c)}`, groupId));
      }
    }

    // AV
    objects.push({ id: "av1", assetName: "Projector Screen", assetCategory: "av", positionX: 0, positionY: 0, positionZ: 3, rotationY: 0, chairCount: 0, groupId: null });
    objects.push({ id: "av2", assetName: "Laser Projector", assetCategory: "av", positionX: 0, positionY: 0.76, positionZ: -1, rotationY: 0, chairCount: 0, groupId: null });

    // Lectern
    objects.push({ id: "l1", assetName: "Lectern", assetCategory: "lectern", positionX: -3, positionY: 0, positionZ: 4, rotationY: 0, chairCount: 0, groupId: null });

    const manifest = generateManifest(objects, ROOM);

    // Manifest should be compact (not 93 rows)
    expect(manifest.rows.length).toBeLessThan(25);

    // Total chairs = 80
    expect(manifest.totals.totalChairs).toBe(80);

    // Setup sequence: stage first
    expect(manifest.rows[0]!.setupGroup).toBe("stage");

    // Has AV items
    const avRows = manifest.rows.filter((r) => r.setupGroup === "av");
    expect(avRows.length).toBe(2);

    // Has lectern
    const lecternRows = manifest.rows.filter((r) => r.setupGroup === "lectern");
    expect(lecternRows.length).toBe(1);

    // Spatial descriptions are human-readable
    for (const row of manifest.rows) {
      expect(row.position.length).toBeGreaterThan(5);
      expect(row.position).not.toContain("NaN");
    }
  });

  it("spatial classifier produces consistent descriptions across room", () => {
    // Sample 25 positions across the room
    for (let xi = -2; xi <= 2; xi++) {
      for (let zi = -2; zi <= 2; zi++) {
        const x = xi * 4;
        const z = zi * 2;
        const result = classifyPosition(x, z, ROOM);
        expect(result.description.length).toBeGreaterThan(5);
        expect(result.nearestWallDistanceM).toBeGreaterThanOrEqual(0);
        expect(["north", "south", "east", "west"]).toContain(result.nearestWall);
      }
    }
  });

  it("PDF generation returns valid PDF buffer (check magic bytes)", async () => {
    const objects: ManifestObject[] = [
      { id: "t1", assetName: "Round Table", assetCategory: "table", positionX: 0, positionY: 0, positionZ: 0, rotationY: 0, chairCount: 0, groupId: null },
    ];
    const data = makeSheetData(objects);

    const pdf = await generateSheetPdf(data);

    // PDF magic bytes: %PDF
    expect(pdf.length).toBeGreaterThan(100);
    const header = pdf.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("PDF generation succeeds with empty configuration", async () => {
    const data = makeSheetData([]);
    const pdf = await generateSheetPdf(data);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("PDF generation succeeds with large configuration (50 tables)", async () => {
    const objects: ManifestObject[] = [];
    for (let i = 0; i < 50; i++) {
      const groupId = `g${String(i)}`;
      objects.push(makeTable(`t${String(i)}`, groupId, (i % 10) * 2 - 9, Math.floor(i / 10) * 2 - 4));
      for (let c = 0; c < 8; c++) {
        objects.push(makeChair(`c${String(i)}-${String(c)}`, groupId));
      }
    }
    const data = makeSheetData(objects);
    const pdf = await generateSheetPdf(data);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("chair count is conserved through the pipeline", () => {
    const objects: ManifestObject[] = [];
    const chairCounts = [6, 8, 10, 4, 12];
    for (let i = 0; i < chairCounts.length; i++) {
      const groupId = `g${String(i)}`;
      objects.push(makeTable(`t${String(i)}`, groupId, i * 3 - 6, 0));
      const count = chairCounts[i]!;
      for (let c = 0; c < count; c++) {
        objects.push(makeChair(`c${String(i)}-${String(c)}`, groupId));
      }
    }

    const totalInputChairs = chairCounts.reduce((a, b) => a + b, 0);
    const manifest = generateManifest(objects, ROOM);
    expect(manifest.totals.totalChairs).toBe(totalInputChairs);
  });
});
