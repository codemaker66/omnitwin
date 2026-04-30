import { describe, it, expect } from "vitest";
import {
  BRAND,
  INK,
  DARK,
  SEVERITY_PALETTE,
  TRUTH_MODE_TOKENS,
  SHEET_TYPE,
  SHEET_SPACING,
} from "../design-tokens.js";
import { TRUTH_MODE_TOKEN_CATEGORIES } from "../truth-mode.js";

// ---------------------------------------------------------------------------
// design-tokens — contract tests
//
// These tokens feed BOTH the pdfkit PDF renderer and the React tablet
// renderer. A silent type/value change here would immediately produce
// visual drift across every consumer. The tests pin:
//
//   1. Every token is a valid hex string (catches a stray `null`, empty
//      string, or tailwind-class fragment slipping in)
//   2. Every named token in a record-style map is present (catches an
//      accidental rename that breaks downstream lookup)
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("BRAND", () => {
  it("every brand color is a 6-char hex string", () => {
    for (const [key, value] of Object.entries(BRAND)) {
      expect(value, `BRAND.${key}`).toMatch(HEX);
    }
  });

  it("declares the required brand roles", () => {
    expect(BRAND).toHaveProperty("gold");
    expect(BRAND).toHaveProperty("goldPrint");
    expect(BRAND).toHaveProperty("goldLight");
    expect(BRAND).toHaveProperty("navy");
    expect(BRAND).toHaveProperty("green");
    expect(BRAND).toHaveProperty("greenDeep");
  });

  it("gold (screen) and goldPrint (paper) are intentionally distinct", () => {
    // See the `design-tokens.ts` module header comment — the two-gold
    // design is deliberate; merging them would regress paper reflectance.
    expect(BRAND.gold).not.toBe(BRAND.goldPrint);
  });
});

describe("INK (paper palette)", () => {
  it("every ink color is a 6-char hex string", () => {
    for (const [key, value] of Object.entries(INK)) {
      expect(value, `INK.${key}`).toMatch(HEX);
    }
  });

  it("declares the required paper text/rule roles", () => {
    expect(INK).toHaveProperty("onPaper");
    expect(INK).toHaveProperty("onPaperDim");
    expect(INK).toHaveProperty("onPaperFaint");
    expect(INK).toHaveProperty("paperRule");
    expect(INK).toHaveProperty("paperRowShade");
  });
});

describe("DARK (tablet palette)", () => {
  it("every dark-theme color is a valid hex string", () => {
    for (const [key, value] of Object.entries(DARK)) {
      // Short hex shorthand (#111) is allowed in dark palette — several
      // entries use it intentionally. Match 3 OR 6 char hex.
      expect(value, `DARK.${key}`).toMatch(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/);
    }
  });
});

describe("SEVERITY_PALETTE", () => {
  it("covers all four severity tones", () => {
    expect(SEVERITY_PALETTE).toHaveProperty("critical");
    expect(SEVERITY_PALETTE).toHaveProperty("warning");
    expect(SEVERITY_PALETTE).toHaveProperty("info");
    expect(SEVERITY_PALETTE).toHaveProperty("success");
  });

  it("every tone exposes background + border + foreground", () => {
    for (const [tone, entry] of Object.entries(SEVERITY_PALETTE)) {
      expect(entry, `${tone}.background`).toHaveProperty("background");
      expect(entry, `${tone}.border`).toHaveProperty("border");
      expect(entry, `${tone}.foreground`).toHaveProperty("foreground");
      expect(entry.background, `${tone}.background`).toMatch(HEX);
      expect(entry.border, `${tone}.border`).toMatch(HEX);
      expect(entry.foreground, `${tone}.foreground`).toMatch(HEX);
    }
  });

  it("critical and success have distinguishable borders (ops eye-track)", () => {
    // If these ever collide, the accessibility critical band and the
    // approval success banner look identical to a hallkeeper glancing
    // across the sheet.
    expect(SEVERITY_PALETTE.critical.border).not.toBe(SEVERITY_PALETTE.success.border);
  });
});

describe("TRUTH_MODE_TOKENS", () => {
  it("covers every semantic Truth Mode token category", () => {
    expect(Object.keys(TRUTH_MODE_TOKENS)).toEqual([...TRUTH_MODE_TOKEN_CATEGORIES]);
  });

  it("every token exposes a valid color triplet and accent", () => {
    for (const [category, token] of Object.entries(TRUTH_MODE_TOKENS)) {
      expect(token.background, `${category}.background`).toMatch(HEX);
      expect(token.border, `${category}.border`).toMatch(HEX);
      expect(token.foreground, `${category}.foreground`).toMatch(HEX);
      expect(token.accent, `${category}.accent`).toMatch(HEX);
    }
  });

  it("no truth category relies on color alone", () => {
    for (const [category, token] of Object.entries(TRUTH_MODE_TOKENS)) {
      expect(token.nonColorEncodings.length, `${category}.nonColorEncodings`).toBeGreaterThan(0);
      expect(token.badge.length, `${category}.badge`).toBeGreaterThan(0);
      expect(token.label.length, `${category}.label`).toBeGreaterThan(0);
    }
  });
});

describe("SHEET_TYPE", () => {
  it("declares the required typography steps", () => {
    expect(SHEET_TYPE).toHaveProperty("label");
    expect(SHEET_TYPE).toHaveProperty("h1");
    expect(SHEET_TYPE).toHaveProperty("h2");
    expect(SHEET_TYPE).toHaveProperty("h3");
    expect(SHEET_TYPE).toHaveProperty("body");
    expect(SHEET_TYPE).toHaveProperty("caption");
    expect(SHEET_TYPE).toHaveProperty("quantity");
  });

  it("every step has a positive integer size and a valid weight", () => {
    const validWeights = new Set([400, 500, 600, 700, 800]);
    for (const [name, step] of Object.entries(SHEET_TYPE)) {
      expect(step.size, `${name}.size`).toBeGreaterThan(0);
      expect(validWeights.has(step.weight), `${name}.weight`).toBe(true);
    }
  });

  it("h1 > h2 > h3 > body > caption (visual hierarchy)", () => {
    expect(SHEET_TYPE.h1.size).toBeGreaterThan(SHEET_TYPE.h2.size);
    expect(SHEET_TYPE.h2.size).toBeGreaterThan(SHEET_TYPE.h3.size);
    expect(SHEET_TYPE.h3.size).toBeGreaterThan(SHEET_TYPE.body.size);
    expect(SHEET_TYPE.body.size).toBeGreaterThanOrEqual(SHEET_TYPE.caption.size);
  });
});

describe("SHEET_SPACING", () => {
  it("declares the required spacing steps", () => {
    expect(SHEET_SPACING).toHaveProperty("xs");
    expect(SHEET_SPACING).toHaveProperty("sm");
    expect(SHEET_SPACING).toHaveProperty("md");
    expect(SHEET_SPACING).toHaveProperty("lg");
    expect(SHEET_SPACING).toHaveProperty("xl");
    expect(SHEET_SPACING).toHaveProperty("xxl");
  });

  it("steps are monotonically increasing (xs < sm < … < xxl)", () => {
    const { xs, sm, md, lg, xl, xxl } = SHEET_SPACING;
    expect(xs).toBeLessThan(sm);
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
    expect(lg).toBeLessThan(xl);
    expect(xl).toBeLessThan(xxl);
  });
});
