import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Client surfaces at 7:1, and the front door's 44 px targets.
//
// goals/01 sets 7:1 for the body text clients, couples and suppliers read, and
// 44 px for every target. The live audit (e2e/accessibility-route-audit.spec.ts
// with contrastTarget "client") measures the rendered routes; this suite pins
// the token values those routes were fixed with, so a later edit to one CSS
// value fails here, in the unit run, before a browser is ever started.
//
// Measured on 17 October 2026 with the audit's own collector at 7:1: the
// front door's secondary ink #5a5244 was 6.26:1, its copper text 6.55:1 and
// the masthead's venue line 5.3:1; the proposal's second ink 6.55:1, its venue
// line 5.55:1 and its total label 6.41:1; the supplier pack's muted ink 6.1 to
// 6.8:1 and its copper labels 5.07:1.
// ---------------------------------------------------------------------------

const css = (path: string): string => readFileSync(path, "utf8");
const HOUSE = css("src/styles/house-tokens.css");
const FRESH = css("src/pages/fresh/fresh.css");
const HOME = css("src/pages/RoomsHomePage.css");
const PROPOSAL = css("src/components/proposal/ProposalDocument.css");
const SUPPLIER = css("src/pages/SupplierPortalPage.css");

/** The first declaration of a custom property in a stylesheet. */
function token(sheet: string, name: string): string {
  // Names are [\w-] only, so they need no escaping; the lookbehind keeps
  // "--ink" from matching inside "--fr-ink-2" or "--house-ink-1".
  const match = new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`, "u").exec(sheet);
  if (match === null) throw new Error(`No declaration of ${name}`);
  const value = (match[1] ?? "").trim();
  // One level of var() into the house tokens, which is all these use.
  const alias = /^var\((--[\w-]+)\)$/u.exec(value);
  return alias === null ? value : token(HOUSE, alias[1] ?? "");
}

/** The declarations inside the first rule whose selector is exactly `selector`. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No rule for ${selector}`);
  return sheet.slice(start, sheet.indexOf("}", start));
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? "0", 16));
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("client surfaces hold 7:1", () => {
  it("the front door's secondary ink, on both of its papers", () => {
    const ink = token(FRESH, "--fr-ink-2");
    for (const paper of ["--fr-paper", "--fr-paper-2"]) {
      expect(contrast(ink, token(FRESH, paper)), paper).toBeGreaterThanOrEqual(7);
    }
  });

  it("the front door's copper words on the photographed stage", () => {
    const copperText = token(HOME, "--copper-text");
    for (const ground of ["--ink", "--ink-raised"]) {
      expect(contrast(copperText, token(HOME, ground)), ground).toBeGreaterThanOrEqual(7);
    }
    expect(rule(HOME, ".rooms__state")).toContain("color: var(--copper-text)");
    expect(rule(HOME, ".rooms__enter")).toContain("color: var(--copper-text)");
  });

  it("the masthead's venue line", () => {
    const masthead = /background:\s*(#[0-9a-f]{6})/iu.exec(rule(HOME, ".rooms__masthead"))?.[1] ?? "";
    expect(rule(HOME, ".rooms__venue")).toContain("color: var(--vv-forest-2)");
    expect(contrast(token(HOUSE, "--vv-forest-2"), masthead)).toBeGreaterThanOrEqual(7);
  });

  it("the proposal's second ink, venue line and total label", () => {
    expect(PROPOSAL).toContain('.pd-page[data-register="ivory"] { --reg-text-2: var(--vv-forest-2); }');
    const second = token(HOUSE, "--vv-forest-2");
    for (const ground of ["--house-sheet", "--house-paper"]) {
      expect(contrast(second, token(HOUSE, ground)), ground).toBeGreaterThanOrEqual(7);
    }
    expect(rule(PROPOSAL, ".pd-venue")).toContain("color: var(--reg-text-2)");
    expect(PROPOSAL).toMatch(/\.pd-total span \{ color: var\(--reg-text-1\)/u);
    expect(contrast(token(HOUSE, "--house-ink-1"), token(HOUSE, "--house-plane"))).toBeGreaterThanOrEqual(7);
  });

  it("the supplier's page: the house inks on its paper", () => {
    // The dark pack measured above was redesigned (PR #106, "A door for
    // everyone outside"): ivory paper and the house inks replace its supplier
    // tokens, so the 7:1 rule is held on the tokens the page now uses.
    expect(rule(SUPPLIER, ".supplier-pass")).toContain("color: var(--house-ink-1)");
    expect(rule(SUPPLIER, ".supplier-pass__sheet")).toContain("background: var(--house-paper)");
    for (const ink of ["--house-ink-1", "--house-ink-2"]) {
      expect(contrast(token(HOUSE, ink), token(HOUSE, "--house-paper")), `${ink} on paper`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("the front door's targets are 44 px", () => {
  it("the occasion pills and the legal links", () => {
    expect(rule(FRESH, ".fr-enq-pills button")).toContain("min-height: 44px");
    const legal = rule(HOME, ".rooms__footLegal a");
    expect(legal).toContain("min-height: 44px");
    expect(legal).toContain("min-width: 44px");
  });

  it("the privacy link's hit area reaches 44 px (13 px text plus 14 px above and below)", () => {
    expect(rule(FRESH, ".fr-enq-privacy a")).toContain("padding-block: 14px");
  });

  it("every enquiry field takes the full width on a phone", () => {
    const phone = FRESH.slice(FRESH.indexOf("On a phone every field takes the column's full width"));
    expect(phone).toMatch(/@media \(max-width: 640px\)/u);
    expect(phone).toMatch(/\.fr-enq-field input,[\s\S]*?width: 100%;/u);
  });
});
