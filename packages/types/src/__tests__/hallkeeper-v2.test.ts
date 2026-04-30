import { describe, it, expect } from "vitest";
import {
  ZONES,
  ZoneSchema,
  ManifestRowV2Schema,
  RowPositionSchema,
  PhaseZoneSchema,
  PhaseSchema,
  TimingSchema,
  HallkeeperSheetV2Schema,
} from "../hallkeeper-v2.js";

const SAMPLE_ROW = {
  key: "furniture|North wall|6ft Round Table|0",
  name: "6ft Round Table",
  category: "table",
  qty: 1,
  afterDepth: 0,
  isAccessory: false,
  notes: "",
  positions: [],
} as const;

describe("ZoneSchema", () => {
  it("accepts all 7 declared zones", () => {
    for (const z of ZONES) {
      expect(ZoneSchema.safeParse(z).success).toBe(true);
    }
  });

  it("rejects typo'd zones", () => {
    expect(ZoneSchema.safeParse("north wall").success).toBe(false); // lowercase
    expect(ZoneSchema.safeParse("Middle").success).toBe(false);
  });
});

describe("ManifestRowV2Schema", () => {
  it("accepts a minimal valid row", () => {
    expect(ManifestRowV2Schema.safeParse(SAMPLE_ROW).success).toBe(true);
  });

  it("defaults notes to '' when omitted", () => {
    const { notes: _drop, ...rest } = SAMPLE_ROW;
    const parsed = ManifestRowV2Schema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notes).toBe("");
  });

  it("rejects negative qty", () => {
    expect(ManifestRowV2Schema.safeParse({ ...SAMPLE_ROW, qty: -1 }).success).toBe(false);
  });

  it("rejects afterDepth > 5 (sanity cap)", () => {
    expect(ManifestRowV2Schema.safeParse({ ...SAMPLE_ROW, afterDepth: 6 }).success).toBe(false);
  });

  it("requires key to be non-empty", () => {
    expect(ManifestRowV2Schema.safeParse({ ...SAMPLE_ROW, key: "" }).success).toBe(false);
  });
});

describe("RowPositionSchema", () => {
  const VALID = {
    objectId: "00000000-0000-0000-0000-000000000001",
    x: 5.5,
    z: -3.2,
    rotationY: 1.5708,
  };

  it("accepts valid coordinates", () => {
    expect(RowPositionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects non-UUID objectId", () => {
    expect(RowPositionSchema.safeParse({ ...VALID, objectId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts negative coordinates (floor plan can straddle origin)", () => {
    expect(RowPositionSchema.safeParse({ ...VALID, x: -10, z: -10 }).success).toBe(true);
  });
});

describe("ManifestRowV2Schema — positions", () => {
  it("defaults positions to [] when omitted", () => {
    const { positions: _drop, ...rest } = SAMPLE_ROW;
    const parsed = ManifestRowV2Schema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.positions).toEqual([]);
  });

  it("accepts multiple positions on an aggregated row", () => {
    const parsed = ManifestRowV2Schema.safeParse({
      ...SAMPLE_ROW,
      qty: 3,
      positions: [
        { objectId: "00000000-0000-0000-0000-00000000000a", x: 1, z: 2, rotationY: 0 },
        { objectId: "00000000-0000-0000-0000-00000000000b", x: 3, z: 4, rotationY: 0 },
        { objectId: "00000000-0000-0000-0000-00000000000c", x: 5, z: 6, rotationY: 0 },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("PhaseZoneSchema + PhaseSchema", () => {
  it("accepts a phase with one zone and one row", () => {
    const parsed = PhaseSchema.safeParse({
      phase: "furniture",
      zones: [{ zone: "North wall", rows: [SAMPLE_ROW] }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a zone with an invalid name", () => {
    const parsed = PhaseZoneSchema.safeParse({ zone: "Nowhere", rows: [] });
    expect(parsed.success).toBe(false);
  });

  it("allows an empty zones array (a phase can have no items)", () => {
    expect(PhaseSchema.safeParse({ phase: "final", zones: [] }).success).toBe(true);
  });
});

describe("TimingSchema", () => {
  it("accepts a valid timing block", () => {
    const parsed = TimingSchema.safeParse({
      eventStart: "2026-06-15T18:00:00.000Z",
      setupBy: "2026-06-15T16:30:00.000Z",
      bufferMinutes: 90,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-ISO datetimes", () => {
    expect(TimingSchema.safeParse({
      eventStart: "2026-06-15 18:00",
      setupBy: "2026-06-15 16:30",
      bufferMinutes: 90,
    }).success).toBe(false);
  });

  it("rejects negative buffer", () => {
    expect(TimingSchema.safeParse({
      eventStart: "2026-06-15T18:00:00.000Z",
      setupBy: "2026-06-15T18:30:00.000Z",
      bufferMinutes: -30,
    }).success).toBe(false);
  });
});

describe("HallkeeperSheetV2Schema — full roundtrip", () => {
  const SAMPLE: unknown = {
    config: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Anderson Reception",
      guestCount: 120,
      layoutStyle: "dinner-rounds",
    },
    venue: { name: "Trades Hall Glasgow", address: "85 Glassford St", logoUrl: null },
    space: { name: "Grand Hall", widthM: 21, lengthM: 10.5, heightM: 7 },
    timing: {
      eventStart: "2026-06-15T18:00:00.000Z",
      setupBy: "2026-06-15T16:30:00.000Z",
      bufferMinutes: 90,
    },
    phases: [
      { phase: "furniture", zones: [{ zone: "Centre", rows: [SAMPLE_ROW] }] },
      { phase: "dress", zones: [] },
    ],
    totals: {
      entries: [{ name: "6ft Round Table", category: "table", qty: 1 }],
      totalRows: 1,
      totalItems: 1,
    },
    diagramUrl: null,
    webViewUrl: "http://localhost:5173/hallkeeper/cfg",
    generatedAt: "2026-04-15T10:00:00.000Z",
    instructions: null,
    approval: null,
  };

  it("parses a full sample payload", () => {
    expect(HallkeeperSheetV2Schema.safeParse(SAMPLE).success).toBe(true);
  });

  it("accepts an approval stamp", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({
      ...(SAMPLE as Record<string, unknown>),
      approval: {
        version: 3,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an approval with version < 1", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({
      ...(SAMPLE as Record<string, unknown>),
      approval: {
        version: 0,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts timing=null (unscheduled config)", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({ ...(SAMPLE as Record<string, unknown>), timing: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts a populated instructions block", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({
      ...(SAMPLE as Record<string, unknown>),
      instructions: {
        specialInstructions: "Fire exits must remain clear at all times.",
        dayOfContact: { name: "Sarah Wright", role: "Planner", phone: "+44 7700 900000", email: "" },
        phaseDeadlines: [
          { phase: "structure", deadline: "2026-06-15T14:00:00.000Z", reason: "" },
        ],
        accessNotes: "Service entrance at south door.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  // ---- Pre-Phase-4c snapshot compatibility + jsonb guard contracts --
  //
  // `loadLatestApprovedSnapshotPayload` in the api package parses stored
  // jsonb against this schema after backfilling `approval: null` for
  // snapshots written before Phase 4c added the required key. These
  // tests pin the two corners of that contract: pre-4c payloads accept
  // after backfill; garbage payloads reject.

  it("rejects a payload missing the required `approval` key (unfilled)", () => {
    const pre4c = { ...(SAMPLE as Record<string, unknown>) };
    delete pre4c["approval"];
    expect(HallkeeperSheetV2Schema.safeParse(pre4c).success).toBe(false);
  });

  it("accepts a pre-4c payload after `approval: null` backfill", () => {
    const pre4c = { ...(SAMPLE as Record<string, unknown>) };
    delete pre4c["approval"];
    const backfilled = { ...pre4c, approval: null };
    expect(HallkeeperSheetV2Schema.safeParse(backfilled).success).toBe(true);
  });

  it("rejects garbage jsonb (wrong phases shape)", () => {
    const garbage = { ...(SAMPLE as Record<string, unknown>), phases: "not-an-array" };
    expect(HallkeeperSheetV2Schema.safeParse(garbage).success).toBe(false);
  });

  it("rejects an approval with a non-ISO approvedAt", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({
      ...(SAMPLE as Record<string, unknown>),
      approval: {
        version: 1,
        approvedAt: "yesterday afternoon",
        approverName: "Catherine Tait",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an approval with an empty approverName", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({
      ...(SAMPLE as Record<string, unknown>),
      approval: {
        version: 1,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "",
      },
    });
    expect(parsed.success).toBe(false);
  });
});
