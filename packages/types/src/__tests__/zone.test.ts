import { describe, it, expect } from "vitest";
import { ZONES, ZoneSchema } from "../zone.js";

// ---------------------------------------------------------------------------
// Zone — contract tests
//
// Module was extracted from hallkeeper-v2 to break a circular import
// between event-requirements and hallkeeper-v2. The contract is simply:
// the 7-zone enum must remain exactly that set, and ZoneSchema must
// accept each member + reject everything else.
// ---------------------------------------------------------------------------

describe("ZONES", () => {
  it("declares exactly 7 zones", () => {
    expect(ZONES).toHaveLength(7);
  });

  it("includes the four walls", () => {
    expect(ZONES).toContain("North wall");
    expect(ZONES).toContain("South wall");
    expect(ZONES).toContain("East wall");
    expect(ZONES).toContain("West wall");
  });

  it("includes the three region classifications", () => {
    expect(ZONES).toContain("Entrance");
    expect(ZONES).toContain("Perimeter");
    expect(ZONES).toContain("Centre");
  });
});

describe("ZoneSchema", () => {
  it("accepts every declared zone", () => {
    for (const zone of ZONES) {
      expect(ZoneSchema.safeParse(zone).success, zone).toBe(true);
    }
  });

  it("rejects an unknown zone string", () => {
    expect(ZoneSchema.safeParse("Galactic South Quadrant").success).toBe(false);
  });

  it("rejects case-mismatched names (the enum is case-sensitive)", () => {
    expect(ZoneSchema.safeParse("north wall").success).toBe(false);
    expect(ZoneSchema.safeParse("CENTRE").success).toBe(false);
  });

  it("rejects the empty string and whitespace", () => {
    expect(ZoneSchema.safeParse("").success).toBe(false);
    expect(ZoneSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(ZoneSchema.safeParse(null).success).toBe(false);
    expect(ZoneSchema.safeParse(undefined).success).toBe(false);
    expect(ZoneSchema.safeParse(42).success).toBe(false);
  });
});
