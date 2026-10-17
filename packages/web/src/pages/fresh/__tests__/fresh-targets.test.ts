import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// /fresh's targets are 44 px (goals/01), with the words kept at their size.
//
// Measured on 17 October 2026 with getBoundingClientRect at 1024 and 375 px
// (E:/claude/build-20261016/integration-report.md): "See the rooms" and
// "Panorama tour" were 23 px tall, the four "Open the room" buttons 23 px,
// the contact block's "Ask about a date" 23 px, the telephone and address
// links 31 px at 375, the legal links 24 px and "Skip to the rooms" 43 px.
// The room dossier's Close, which that walk did not open, measured 37 px.
//
// The browser audit measures the rendered page; this suite pins the rules the
// targets were fixed with, so a later edit fails in the unit run. The first
// test also reads every classed <a> and <button> in the page's own source, so
// a new target without a 44 px rule fails here instead of shipping small.
// ---------------------------------------------------------------------------

const read = (path: string): string => readFileSync(path, "utf8");
const FRESH = read("src/pages/fresh/fresh.css");
const PAGE = read("src/pages/fresh/FreshPage.tsx");
const DOSSIER = read("src/pages/fresh/RoomDossier.tsx");

/** The declarations inside the first top-level rule whose selector is exactly
 *  `selector`. Anchored to the start of a line, so ".fr-room-open" does not
 *  match inside ".fr-room:hover .fr-room-open" or an indented media rule. */
function rule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped} \\{`, "mu").exec(sheet);
  if (match === null) throw new Error(`No rule for ${selector}`);
  return sheet.slice(match.index, sheet.indexOf("}", match.index));
}

/** A declared pixel value, or null when the rule does not declare it. */
function px(declarations: string, property: string): number | null {
  const match = new RegExp(`(?<![\\w-])${property}\\s*:\\s*(-?[\\d.]+)px`, "u").exec(declarations);
  return match === null ? null : Number(match[1]);
}

/** The rule that sets each classed target's size, by the target's first class.
 *  The primary nav's links take their size from the nav's own rule. */
const TARGET_RULES: Readonly<Record<string, string>> = {
  "fr-skip": ".fr-skip",
  "fr-theme-cycle": ".fr-theme-cycle",
  "fr-header-cta": ".fr-header-cta",
  "fr-primary-plan": ".fr-primary-nav a",
  "fr-primary-login": ".fr-primary-nav a",
  "fr-cta": ".fr-cta",
  "fr-cta-quiet": ".fr-cta-quiet",
  "fr-room-open": ".fr-room-open",
  "fr-dossier-close": ".fr-dossier-close",
};

/** The first class of every <a> and <button> that carries a className. */
function classedTargets(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/<(?:a|button)\b[^>]*?className="([^"]+)"/gu)) {
    const first = (match[1] ?? "").split(/\s+/u)[0];
    if (first !== undefined && first !== "") found.push(first);
  }
  return found;
}

describe("/fresh's targets are 44 px", () => {
  it("every classed link and button on the page and in the dossier has a 44 px rule", () => {
    const classes = [...new Set([...classedTargets(PAGE), ...classedTargets(DOSSIER)])].sort();
    expect(classes).toEqual(Object.keys(TARGET_RULES).sort());
    for (const name of classes) {
      const declarations = rule(FRESH, TARGET_RULES[name] ?? "");
      expect(px(declarations, "min-height"), name).toBeGreaterThanOrEqual(44);
    }
  });

  it("the theme buttons, the contact links and the legal links, which carry no class of their own", () => {
    expect(PAGE).toContain('<fieldset className="fr-theme"');
    expect(px(rule(FRESH, ".fr-theme button"), "min-height")).toBeGreaterThanOrEqual(44);
    expect(PAGE).toContain('<p className="fr-contact-way">');
    expect(px(rule(FRESH, ".fr-contact-way a"), "min-height")).toBeGreaterThanOrEqual(44);
    expect(PAGE).toContain('<nav className="fr-legal"');
    const legal = rule(FRESH, ".fr-legal a");
    expect(px(legal, "min-height")).toBeGreaterThanOrEqual(44);
    // "Terms" alone is narrower than 44 px.
    expect(px(legal, "min-width")).toBeGreaterThanOrEqual(44);
  });

  it('"Ask about a date" in the contact block keeps the 44 px row it shares with the other contact links', () => {
    const ask = rule(FRESH, ".fr-contact-way .fr-contact-address + a");
    expect(ask).not.toMatch(/min-height|max-height|(?<![\w-])height\s*:|display\s*:/u);
  });

  it("the hit areas grew, not the type: the small links keep their 13 and 14 px words", () => {
    expect(px(rule(FRESH, ".fr-skip"), "font-size")).toBe(13);
    expect(px(rule(FRESH, ".fr-cta-quiet"), "font-size")).toBe(14);
    expect(px(rule(FRESH, ".fr-room-open"), "font-size")).toBe(14);
    expect(px(rule(FRESH, ".fr-dossier-close"), "font-size")).toBe(13);
    expect(px(rule(FRESH, ".fr-legal a"), "font-size")).toBe(13);
  });

  it("the skip link, now 44 px tall, still hides fully above the page until it is focused", () => {
    const skip = rule(FRESH, ".fr-skip");
    const top = px(skip, "top") ?? Number.NaN;
    const hidden = /transform:\s*translateY\((-[\d.]+)px\)/u.exec(skip)?.[1];
    expect(hidden).toBeDefined();
    // Its bottom edge (top + 44 px) must clear the viewport's top edge.
    expect(top + 44 + Number(hidden)).toBeLessThan(0);
    expect(rule(FRESH, ".fr-skip:focus-visible")).toContain("transform: none");
  });
});
