import { describe, it, expect } from "vitest";
import {
  ConfigurationSheetSnapshotSchema,
  isSnapshotApproved,
  type ConfigurationSheetSnapshot,
} from "../configuration-sheet-snapshot.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_UUID = "11111111-1111-4111-8111-111111111111";
const CONFIG_UUID = "22222222-2222-4222-8222-222222222222";
const USER_UUID = "33333333-3333-4333-8333-333333333333";
const DATETIME = "2026-04-18T12:00:00.000Z";
const SHA256 = "a".repeat(64);

const validPayload = {
  config: {
    id: CONFIG_UUID,
    name: "Test Wedding Reception",
    guestCount: 120,
    layoutStyle: "dinner-rounds" as const,
  },
  venue: {
    name: "Trades Hall Glasgow",
    address: "85 Glassford Street, Glasgow G1 1UH",
    timezone: "Europe/London",
  },
  space: {
    name: "Grand Hall",
    widthM: 21,
    lengthM: 10,
    heightM: 7,
  },
  timing: null,
  instructions: null,
  phases: [],
  totals: {
    entries: [],
    totalRows: 0,
    totalItems: 0,
  },
  diagramUrl: null,
  webViewUrl: "https://example.com/hallkeeper/abc",
  generatedAt: DATETIME,
  approval: null,
};

const validSnapshot: ConfigurationSheetSnapshot = {
  id: SNAPSHOT_UUID,
  configurationId: CONFIG_UUID,
  version: 1,
  payload: validPayload,
  diagramUrl: null,
  pdfUrl: null,
  sourceHash: SHA256,
  createdAt: DATETIME,
  createdBy: USER_UUID,
  approvedAt: null,
  approvedBy: null,
};

// ---------------------------------------------------------------------------
// Schema parse
// ---------------------------------------------------------------------------

describe("ConfigurationSheetSnapshotSchema", () => {
  it("accepts a valid un-approved snapshot", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("accepts a valid approved snapshot", () => {
    const approved: ConfigurationSheetSnapshot = {
      ...validSnapshot,
      approvedAt: DATETIME,
      approvedBy: USER_UUID,
    };
    expect(ConfigurationSheetSnapshotSchema.safeParse(approved).success).toBe(true);
  });

  it("accepts null createdBy (system-created)", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      createdBy: null,
    }).success).toBe(true);
  });

  it("rejects version < 1", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      version: 0,
    }).success).toBe(false);
  });

  it("rejects negative version", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      version: -1,
    }).success).toBe(false);
  });

  it("rejects float version", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      version: 1.5,
    }).success).toBe(false);
  });

  it("rejects sourceHash that is not 64 hex chars", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      sourceHash: "abc",
    }).success).toBe(false);
  });

  it("rejects sourceHash with uppercase hex", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      sourceHash: "A".repeat(64),
    }).success).toBe(false);
  });

  it("rejects sourceHash with non-hex chars", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      sourceHash: "g".repeat(64),
    }).success).toBe(false);
  });

  it("rejects non-UUID id", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      id: "not-a-uuid",
    }).success).toBe(false);
  });

  it("rejects non-URL diagramUrl", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      diagramUrl: "not a url",
    }).success).toBe(false);
  });

  it("accepts a URL diagramUrl", () => {
    expect(ConfigurationSheetSnapshotSchema.safeParse({
      ...validSnapshot,
      diagramUrl: "https://r2.example.com/diagrams/abc.png",
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isSnapshotApproved
// ---------------------------------------------------------------------------

describe("isSnapshotApproved", () => {
  it("returns false when both approval columns are null", () => {
    expect(isSnapshotApproved(validSnapshot)).toBe(false);
  });

  it("returns true when both approval columns are populated", () => {
    expect(isSnapshotApproved({
      ...validSnapshot,
      approvedAt: DATETIME,
      approvedBy: USER_UUID,
    })).toBe(true);
  });

  it("returns false when only approvedAt is populated", () => {
    expect(isSnapshotApproved({
      ...validSnapshot,
      approvedAt: DATETIME,
      approvedBy: null,
    })).toBe(false);
  });

  it("returns false when only approvedBy is populated", () => {
    expect(isSnapshotApproved({
      ...validSnapshot,
      approvedAt: null,
      approvedBy: USER_UUID,
    })).toBe(false);
  });
});
