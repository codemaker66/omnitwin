import { describe, it, expect } from "vitest";
import {
  ZONES,
  ZoneSchema,
  ManifestRowV2Schema,
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
    space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
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
  };

  it("parses a full sample payload", () => {
    expect(HallkeeperSheetV2Schema.safeParse(SAMPLE).success).toBe(true);
  });

  it("accepts timing=null (unscheduled config)", () => {
    const parsed = HallkeeperSheetV2Schema.safeParse({ ...(SAMPLE as Record<string, unknown>), timing: null });
    expect(parsed.success).toBe(true);
  });
});
