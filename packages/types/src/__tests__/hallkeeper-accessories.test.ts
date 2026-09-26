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
  // The venue's own equipment document (2026-09-05) states 16 black round
  // table linens and 10 black poseur linens. Those two are the only implied
  // dressings, because they are the only ones with a stated quantity.
  it("6ft Round Table implies one black round linen and nothing else", () => {
    const rules = accessoriesFor("6ft Round Table");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("Black Round Table Linen");
    expect(rules[0]?.quantityPerParent).toBe(1);
    expect(rules[0]?.phase).toBe("dress");
    expect(rules[0]?.afterDepth).toBe(0);
  });

  it("Poseur Table implies one black poseur linen", () => {
    const rules = accessoriesFor("Poseur Table");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("Black Poseur Table Linen");
  });

  it("a cloth-variant table implies nothing — its cloth is the catalogue item", () => {
    expect(accessoriesFor("Poseur Table (Black)")).toEqual([]);
    expect(accessoriesFor("Poseur Table (White)")).toEqual([]);
  });

  it("chairs imply no covering — 104 covers cannot dress every chair", () => {
    expect(accessoriesFor("Banquet Chair")).toEqual([]);
    expect(accessoriesFor("Chiavari Wedding Chair")).toEqual([]);
  });

  it("AV and stage items imply nothing; their consequences are equipment tags", () => {
    expect(accessoriesFor("Laser Projector")).toEqual([]);
    expect(accessoriesFor("Lectern")).toEqual([]);
    expect(accessoriesFor("Platform")).toEqual([]);
    expect(accessoriesFor("Narrow Platform")).toEqual([]);
  });

  // The regression this block exists to prevent: a hallkeeper sheet that
  // sends staff to fetch dressing Trades Hall does not own.
  it("names no dressing that is absent from the venue's equipment document", () => {
    const unowned = [
      "Ivory Tablecloth", "Rectangular Ivory Tablecloth", "Gold Organza Runner",
      "Floral Centrepiece (low)", "Acrylic Table Number", "LED Pillar Candle",
      "Gold Chair Sash", "Black Stage Skirt", "HDMI Cable (5m)", "Bottled Water (500ml)",
    ];
    const declared = Object.values(ACCESSORY_RULES)
      .flatMap((rules) => rules.map((rule) => rule.name));
    for (const name of unowned) {
      expect(declared, `${name} is not venue stock`).not.toContain(name);
    }
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
