import { describe, it, expect } from "vitest";
import {
  SETUP_PHASES,
  SetupPhaseSchema,
  ACCESSORY_RULES,
  accessoriesFor,
  defaultPhaseForCategory,
  ImpliedAccessorySchema,
} from "../hallkeeper-accessories.js";

describe("SetupPhaseSchema", () => {
  it("accepts every declared phase", () => {
    for (const phase of SETUP_PHASES) {
      expect(SetupPhaseSchema.safeParse(phase).success).toBe(true);
    }
  });

  it("rejects unknown phases", () => {
    expect(SetupPhaseSchema.safeParse("teardown").success).toBe(false);
    expect(SetupPhaseSchema.safeParse("").success).toBe(false);
  });

  it("phase order is stable and matches physical dependency", () => {
    expect(SETUP_PHASES).toEqual(["structure", "furniture", "dress", "technical", "final"]);
  });
});

describe("defaultPhaseForCategory", () => {
  it.each([
    ["stage", "structure"],
    ["table", "furniture"],
    ["chair", "furniture"],
    ["lectern", "furniture"],
    ["av", "technical"],
    ["lighting", "technical"],
    ["decor", "dress"],
  ])("maps %s -> %s", (cat, phase) => {
    expect(defaultPhaseForCategory(cat)).toBe(phase);
  });

  it("falls back to 'final' for unknown categories", () => {
    expect(defaultPhaseForCategory("unknown")).toBe("final");
    expect(defaultPhaseForCategory("")).toBe("final");
  });
});

describe("ACCESSORY_RULES — shape integrity", () => {
  it("every rule entry parses as an array of ImpliedAccessory", () => {
    for (const [assetName, rules] of Object.entries(ACCESSORY_RULES)) {
      for (const rule of rules) {
        const parsed = ImpliedAccessorySchema.safeParse(rule);
        expect(parsed.success, `rule under ${assetName} failed to parse`).toBe(true);
      }
    }
  });

  it("quantityPerParent is always positive", () => {
    for (const rules of Object.values(ACCESSORY_RULES)) {
      for (const rule of rules) {
        expect(rule.quantityPerParent).toBeGreaterThan(0);
      }
    }
  });

  it("afterDepth is always non-negative and small", () => {
    for (const rules of Object.values(ACCESSORY_RULES)) {
      for (const rule of rules) {
        expect(rule.afterDepth).toBeGreaterThanOrEqual(0);
        expect(rule.afterDepth).toBeLessThanOrEqual(5);
      }
    }
  });

  it("a parent never generates the same (name + depth) twice", () => {
    for (const [assetName, rules] of Object.entries(ACCESSORY_RULES)) {
      const seen = new Set<string>();
      for (const rule of rules) {
        const key = `${rule.name}|${String(rule.afterDepth)}`;
        expect(seen.has(key), `duplicate ${key} under ${assetName}`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("ACCESSORY_RULES — contents spot-check (canonical names)", () => {
  it("6ft Round Table generates a cloth, a runner (after cloth), candles", () => {
    const rules = accessoriesFor("6ft Round Table");
    const cloth = rules.find((r) => r.name === "Ivory Tablecloth");
    const runner = rules.find((r) => r.name === "Gold Organza Runner");
    const candles = rules.find((r) => r.name === "LED Pillar Candle");
    expect(cloth).toBeDefined();
    expect(runner).toBeDefined();
    expect(candles).toBeDefined();
    expect(cloth?.afterDepth).toBe(0);
    expect(runner?.afterDepth).toBe(1);
    expect(candles?.quantityPerParent).toBe(3);
  });

  it("Banquet Chair implies a sash per chair", () => {
    const rules = accessoriesFor("Banquet Chair");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("Gold Chair Sash");
    expect(rules[0]?.quantityPerParent).toBe(1);
  });

  it("Laser Projector implies an HDMI cable in technical phase", () => {
    const rules = accessoriesFor("Laser Projector");
    expect(rules.find((r) => r.name === "HDMI Cable (5m)")?.phase).toBe("technical");
  });

  it("Platform implies a stage skirt in dress phase", () => {
    const rules = accessoriesFor("Platform");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("Black Stage Skirt");
    expect(rules[0]?.phase).toBe("dress");
  });
});

describe("accessoriesFor", () => {
  it("returns [] for unknown assets (never throws)", () => {
    expect(accessoriesFor("Not A Real Thing")).toEqual([]);
    expect(accessoriesFor("")).toEqual([]);
  });

  it("returns the static list verbatim for known assets", () => {
    const a = accessoriesFor("6ft Trestle Table");
    const b = accessoriesFor("6ft Trestle Table");
    expect(a).toBe(b); // same readonly reference — the lookup is not cloned
  });
});
