import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The enquiry composer's problem words hold 4.5:1 in every theme /fresh offers.
//
// a11y-3: ".fr-enq-problem" ("Enter a valid email address.", "Enquiry not
// sent. Try again, or call the hall.") and the invalid field's underline read
// var(--fr-alert, #9a3412), and nothing declared --fr-alert, so dark theme got
// the light theme's rust on near-black paper: 2.44:1 for 13 px words, under
// the 4.5:1 WCAG 1.4.3 asks, and under 3:1 for the underline (1.4.11). The
// home page pins light, so it never showed there.
//
// jsdom and happy-dom do not apply this stylesheet, so this reads it the way
// the cascade does: the base .fr-root tokens, overridden in dark theme by the
// block for the OS setting and by the block for the page's own Dark choice,
// each resolving var() (and its fallback) against that theme. Contrast is the
// WCAG 2.x ratio of relative luminances.
// ---------------------------------------------------------------------------

const FRESH = readFileSync("src/pages/fresh/fresh.css", "utf8");

/** The declarations of the first rule whose selector starts a line, exactly. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*${escaped} \\{`, "mu").exec(FRESH);
  if (match === null) throw new Error(`No rule for ${selector}`);
  return FRESH.slice(match.index + match[0].length, FRESH.indexOf("}", match.index));
}

function customProperties(declarations: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of declarations.matchAll(/(?<![\w-])(--[\w-]+)\s*:\s*([^;]+);/gu)) {
    found.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return found;
}

function property(declarations: string, name: string): string {
  const match = new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`, "u").exec(declarations);
  if (match === null) throw new Error(`No ${name} declared`);
  return (match[1] ?? "").trim();
}

const BASE = customProperties(rule(".fr-root"));
const THEMES: Readonly<Record<string, ReadonlyMap<string, string>>> = {
  light: BASE,
  "dark, from the device's setting": new Map([...BASE, ...customProperties(rule('.fr-root:not([data-theme="light"])'))]),
  "dark, chosen on the page": new Map([...BASE, ...customProperties(rule('.fr-root[data-theme="dark"]'))]),
};

/** A colour value with its var() references resolved in one theme. */
function resolve(value: string, theme: ReadonlyMap<string, string>): string {
  const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/u.exec(value);
  if (reference === null) return value;
  const declared = theme.get(reference[1] ?? "");
  if (declared !== undefined) return resolve(declared, theme);
  if (reference[2] === undefined) throw new Error(`${reference[1] ?? ""} is not declared in this theme`);
  return resolve(reference[2].trim(), theme);
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
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
}

const PROBLEM_INK = property(rule(".fr-enq-problem"), "color");
const INVALID_LINE = property(rule('.fr-enq-field input[aria-invalid="true"]'), "border-bottom-color");

describe("the enquiry composer's problem words in every theme", () => {
  it.each(Object.entries(THEMES))("hold 4.5:1 on both papers, %s", (_theme, tokens) => {
    const ink = resolve(PROBLEM_INK, tokens);
    for (const paper of ["--fr-paper", "--fr-paper-2"]) {
      expect(contrast(ink, resolve(`var(${paper})`, tokens)), `${ink} on ${paper}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(Object.entries(THEMES))("mark an invalid field at 3:1 or more on both papers, %s", (_theme, tokens) => {
    const line = resolve(INVALID_LINE, tokens);
    for (const paper of ["--fr-paper", "--fr-paper-2"]) {
      expect(contrast(line, resolve(`var(${paper})`, tokens)), `${line} on ${paper}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keep the light theme's words as they were", () => {
    expect(resolve(PROBLEM_INK, BASE)).toBe("#9a3412");
  });
});
