import { describe, it, expect } from "vitest";
import {
  HallkeeperSheetIdSchema,
  ManifestItemSchema,
  HallkeeperSheetSchema,
  GenerateHallkeeperSheetRequestSchema,
} from "../hallkeeper.js";
import { FURNITURE_CATEGORIES } from "../furniture.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_CONFIG_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validManifestItem = {
  furnitureName: "Round Table (6ft)",
  category: "table" as const,
  quantity: 12,
  notes: "Linen covers required",
};

const validHallkeeperSheet = {
  id: VALID_UUID,
  configurationId: VALID_CONFIG_UUID,
  generatedAt: VALID_DATETIME,
  pdfUrl: "https://cdn.omnitwin.com/sheets/abc123.pdf",
  manifest: [validManifestItem],
  qrCodeData: "https://app.omnitwin.com/sheets/abc123",
  topDownDiagramUrl: "https://cdn.omnitwin.com/diagrams/abc123.png",
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

// ---------------------------------------------------------------------------
// HallkeeperSheetIdSchema
// ---------------------------------------------------------------------------

describe("HallkeeperSheetIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(HallkeeperSheetIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(HallkeeperSheetIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(HallkeeperSheetIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ManifestItemSchema
// ---------------------------------------------------------------------------

describe("ManifestItemSchema", () => {
  it("accepts a valid manifest item", () => {
    const result = ManifestItemSchema.safeParse(validManifestItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.furnitureName).toBe("Round Table (6ft)");
      expect(result.data.quantity).toBe(12);
    }
  });

  it("accepts item without notes (defaults to empty string)", () => {
    const { notes: _, ...noNotes } = validManifestItem;
    const result = ManifestItemSchema.safeParse(noNotes);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe("");
    }
  });

  it("trims whitespace from furnitureName", () => {
    const result = ManifestItemSchema.safeParse({ ...validManifestItem, furnitureName: "  Table  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.furnitureName).toBe("Table");
    }
  });

  it("trims whitespace from notes", () => {
    const result = ManifestItemSchema.safeParse({ ...validManifestItem, notes: "  Some notes  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe("Some notes");
    }
  });

  it("rejects empty furnitureName", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, furnitureName: "" }).success).toBe(false);
  });

  it("rejects whitespace-only furnitureName", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, furnitureName: "   " }).success).toBe(false);
  });

  it("rejects furnitureName exceeding 200 characters", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, furnitureName: "A".repeat(201) }).success).toBe(false);
  });

  it.each([...FURNITURE_CATEGORIES])("accepts category '%s'", (category) => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, category }).success).toBe(true);
  });

  it("rejects invalid category", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, category: "sofa" }).success).toBe(false);
  });

  it("rejects zero quantity", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: 0 }).success).toBe(false);
  });

  it("rejects negative quantity", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: -1 }).success).toBe(false);
  });

  it("rejects float quantity", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: 2.5 }).success).toBe(false);
  });

  it("accepts quantity of 1 (minimum)", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: 1 }).success).toBe(true);
  });

  it("accepts quantity of 10000 (maximum)", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: 10000 }).success).toBe(true);
  });

  it("rejects quantity of 10001 (over max)", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: 10001 }).success).toBe(false);
  });

  it("rejects notes exceeding 500 characters", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, notes: "A".repeat(501) }).success).toBe(false);
  });

  it("accepts notes of exactly 500 characters", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, notes: "A".repeat(500) }).success).toBe(true);
  });

  it("rejects missing furnitureName", () => {
    const { furnitureName: _, ...noName } = validManifestItem;
    expect(ManifestItemSchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing category", () => {
    const { category: _, ...noCat } = validManifestItem;
    expect(ManifestItemSchema.safeParse(noCat).success).toBe(false);
  });

  it("rejects missing quantity", () => {
    const { quantity: _, ...noQty } = validManifestItem;
    expect(ManifestItemSchema.safeParse(noQty).success).toBe(false);
  });

  it("rejects NaN quantity", () => {
    expect(ManifestItemSchema.safeParse({ ...validManifestItem, quantity: NaN }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HallkeeperSheetSchema
// ---------------------------------------------------------------------------

describe("HallkeeperSheetSchema", () => {
  it("accepts a fully valid hallkeeper sheet", () => {
    const result = HallkeeperSheetSchema.safeParse(validHallkeeperSheet);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifest).toHaveLength(1);
      expect(result.data.qrCodeData).toBe("https://app.omnitwin.com/sheets/abc123");
    }
  });

  it("accepts manifest with multiple items", () => {
    const multiManifest = {
      ...validHallkeeperSheet,
      manifest: [
        validManifestItem,
        { furnitureName: "Chair (gold)", category: "chair" as const, quantity: 96 },
        { furnitureName: "Stage Section", category: "stage" as const, quantity: 4, notes: "Connect in 2x2 grid" },
      ],
    };
    const result = HallkeeperSheetSchema.safeParse(multiManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifest).toHaveLength(3);
    }
  });

  it("rejects empty manifest array", () => {
    expect(HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, manifest: [] }).success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...noId } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects invalid UUID for id", () => {
    expect(HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, id: "bad" }).success).toBe(false);
  });

  it("rejects missing configurationId", () => {
    const { configurationId: _, ...noConfig } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noConfig).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, configurationId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing generatedAt", () => {
    const { generatedAt: _, ...noGen } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noGen).success).toBe(false);
  });

  it("rejects invalid datetime for generatedAt", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, generatedAt: "nope" }).success,
    ).toBe(false);
  });

  it("rejects missing pdfUrl", () => {
    const { pdfUrl: _, ...noPdf } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noPdf).success).toBe(false);
  });

  it("rejects invalid pdfUrl", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, pdfUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects missing qrCodeData", () => {
    const { qrCodeData: _, ...noQr } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noQr).success).toBe(false);
  });

  it("rejects empty qrCodeData", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, qrCodeData: "" }).success,
    ).toBe(false);
  });

  it("rejects qrCodeData exceeding 2000 characters", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, qrCodeData: "A".repeat(2001) }).success,
    ).toBe(false);
  });

  it("accepts qrCodeData of exactly 2000 characters", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, qrCodeData: "A".repeat(2000) }).success,
    ).toBe(true);
  });

  it("rejects missing topDownDiagramUrl", () => {
    const { topDownDiagramUrl: _, ...noDiagram } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noDiagram).success).toBe(false);
  });

  it("rejects invalid topDownDiagramUrl", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, topDownDiagramUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreated } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noCreated).success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, createdAt: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdated } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noUpdated).success).toBe(false);
  });

  it("rejects invalid datetime for updatedAt", () => {
    expect(
      HallkeeperSheetSchema.safeParse({ ...validHallkeeperSheet, updatedAt: "bad" }).success,
    ).toBe(false);
  });

  it("rejects missing manifest", () => {
    const { manifest: _, ...noManifest } = validHallkeeperSheet;
    expect(HallkeeperSheetSchema.safeParse(noManifest).success).toBe(false);
  });

  it("rejects manifest with invalid item", () => {
    expect(
      HallkeeperSheetSchema.safeParse({
        ...validHallkeeperSheet,
        manifest: [{ furnitureName: "", category: "chair", quantity: 1 }],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GenerateHallkeeperSheetRequestSchema
// ---------------------------------------------------------------------------

describe("GenerateHallkeeperSheetRequestSchema", () => {
  it("accepts a valid configuration ID", () => {
    expect(
      GenerateHallkeeperSheetRequestSchema.safeParse({ configurationId: VALID_CONFIG_UUID }).success,
    ).toBe(true);
  });

  it("rejects missing configurationId", () => {
    expect(GenerateHallkeeperSheetRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects invalid UUID for configurationId", () => {
    expect(
      GenerateHallkeeperSheetRequestSchema.safeParse({ configurationId: "bad" }).success,
    ).toBe(false);
  });

  it("rejects empty string for configurationId", () => {
    expect(
      GenerateHallkeeperSheetRequestSchema.safeParse({ configurationId: "" }).success,
    ).toBe(false);
  });

  it("rejects null for configurationId", () => {
    expect(
      GenerateHallkeeperSheetRequestSchema.safeParse({ configurationId: null }).success,
    ).toBe(false);
  });

  it("strips extra fields", () => {
    const result = GenerateHallkeeperSheetRequestSchema.safeParse({
      configurationId: VALID_CONFIG_UUID,
      extra: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extra" in result.data).toBe(false);
    }
  });
});
