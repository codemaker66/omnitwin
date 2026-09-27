import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The request slab's summary line ("2 requests · 1 waiting") is the words that
// carry the slab's meaning, and the reduced-motion experience entire. It does
// not sit on a dark request card: it stands on the Day Board slot's own light
// ground. Written for the dark tablet arrangement it was paper on ivory (about
// 1.1:1) and bright copper on ivory (about 2.2:1), which a rendered-board check
// found and no unit test could. This reads the three stylesheets that decide
// it and holds both summary colours, and the line that says the requests
// could not be loaded, to AA on every ground a slot can take.
// A failure is said on the dark grounds, on a request card or in the composer
// beside "Send it", so its words are held to AA there too.
// ---------------------------------------------------------------------------

function css(path: string): string {
  return readFileSync(resolve(path), "utf8").replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

type Rgb = readonly [number, number, number];

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/iu.exec(value.trim());
  if (match === null) throw new Error(`Not an opaque #rrggbb colour: ${value}`);
  const raw = match[1] ?? "";
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The register's own values, as the six hallkeeper surfaces receive them. */
function registerTokens(): ReadonlyMap<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css("src/styles/hallkeeper-register.css").matchAll(/(--hk-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/giu)) {
    tokens.set(match[1] ?? "", match[2] ?? "");
  }
  return tokens;
}

/** A `var(--hk-x, #fallback)` colour, resolved the way the page resolves it. */
function colourOf(declaration: string, tokens: ReadonlyMap<string, string>): Rgb {
  const variable = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(#[0-9a-f]{6}))?\s*\)/iu.exec(declaration);
  if (variable === null) return hex(declaration);
  const value = tokens.get(variable[1] ?? "") ?? variable[2];
  if (value === undefined) throw new Error(`Unresolved colour: ${declaration}`);
  return hex(value);
}

function colourRule(source: string, selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(source)?.[1] ?? "";
  const colour = /(?:^|[;\s])color\s*:\s*([^;]+);/u.exec(body)?.[1];
  if (colour === undefined) throw new Error(`${selector} declares no colour`);
  return colour.trim();
}

function backgroundRule(source: string, selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(source)?.[1] ?? "";
  const background = /(?:^|[;\s])background\s*:\s*([^;]+);/u.exec(body)?.[1];
  if (background === undefined) throw new Error(`${selector} declares no background`);
  return background.trim();
}

/** The last background each slot selector declares: the ivory block is
 *  unconditional and comes last, so that is what renders. */
function slotGrounds(): readonly (readonly [string, Rgb])[] {
  const board = css("src/pages/hallkeeper/day-board.css");
  return [".dayboard-slot", ".dayboard-tone-red", ".dayboard-tone-live"].map((selector) => {
    const escaped = selector.replaceAll(".", "\\.");
    const backgrounds = [...board.matchAll(new RegExp(`${escaped}\\s*\\{[^}]*?background\\s*:\\s*(#[0-9a-f]{6})`, "giu"))];
    const last = backgrounds.at(-1)?.[1];
    if (last === undefined) throw new Error(`${selector} declares no background`);
    return [selector, hex(last)] as const;
  });
}

describe("the request slab's words on a Day Board slot's own ground", () => {
  const tokens = registerTokens();
  const slab = css("src/components/requests/slot-requests.css");

  it.each([
    [".vv-requests-summary", "quiet"],
    ['.vv-requests-summary[data-urgent="true"]', "urgent"],
    [".vv-requests-unavailable", "could not be loaded"],
  ])("keeps the %s words (%s) at AA on every slot ground", (selector) => {
    const ink = colourOf(colourRule(slab, selector), tokens);
    for (const [ground, colour] of slotGrounds()) {
      // 13px at weight 600 is normal-size text: the 4.5:1 bar.
      expect(contrast(ink, colour), `${selector} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the words that say something could not be sent", () => {
  const tokens = registerTokens();
  const slab = css("src/components/requests/slot-requests.css");

  it.each([".vv-request", ".vv-request-composer"])("stay at AA on the %s ground", (ground) => {
    const ink = colourOf(colourRule(slab, ".vv-request-error"), tokens);
    const background = colourOf(backgroundRule(slab, ground), tokens);
    // 12px is normal-size text: the 4.5:1 bar.
    expect(contrast(ink, background), `.vv-request-error on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });
});
