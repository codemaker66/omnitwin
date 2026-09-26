import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_COLOURS, type WorkspaceColour } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// T-635 — the workspace register (design system §2).
//
//   1. house-tokens.css declares every WORKSPACE_COLOURS value as
//      --house-<key>, byte for byte, so the web, the emails and the PDFs
//      cannot drift apart.
//   2. Every pairing the design system allows (§2.3, §2.4) meets WCAG AA:
//      4.5:1 for text, 3:1 for control boundaries, focus rings and marks
//      that stand alone.
//   3. The registers in workspace.css re-declare the focus ring in their own
//      ink, 2px and without a halo, which is what lets every element inside a
//      register inherit the right ring.
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const raw = match[1] ?? "";
  return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16)];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(hexToRgb(foreground)), luminance(hexToRgb(background))].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const colour = (key: WorkspaceColour): string => WORKSPACE_COLOURS[key];

async function declarations(relPath: string, selector?: string): Promise<Map<string, string>> {
  let css = await readFile(resolve(relPath), "utf-8");
  if (selector !== undefined) {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`Missing ${selector} block in ${relPath}`);
    css = css.slice(start, css.indexOf("\n}", start));
  }
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) found.set(match[1], match[2].trim());
  }
  return found;
}

describe("workspace register — one set of values", () => {
  it("declares every shared workspace colour in house-tokens.css, byte for byte", async () => {
    const css = await declarations("src/styles/house-tokens.css");
    for (const [key, value] of Object.entries(WORKSPACE_COLOURS)) {
      expect(css.get(`--house-${key}`), `--house-${key}`).toBe(value);
    }
  });
});

describe("workspace register — contrast of every allowed pairing (design system §2.3, §2.4)", () => {
  const text = (fg: WorkspaceColour, bg: WorkspaceColour, minimum = 4.5): void => {
    expect(contrast(colour(fg), colour(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(minimum);
  };

  it("ivory: all three inks on the sheet, its hover and selected states, paper and overlay", () => {
    for (const bg of ["sheet", "sheet-hover", "sheet-selected", "paper", "overlay"] as const) {
      for (const fg of ["ink-1", "ink-2", "ink-3"] as const) text(fg, bg);
    }
  });

  it("the copper plane carries ink-1, its own ink, the attention count and the alert", () => {
    for (const fg of ["ink-1", "plane-ink", "plane-attention", "brick-strong"] as const) text(fg, "plane");
    text("plane-ink", "plane-hover");
  });

  it("forest: its three inks on forest and deep, and on the field well", () => {
    for (const bg of ["forest", "forest-deep", "forest-field"] as const) {
      for (const fg of ["forest-ink-1", "forest-ink-2", "forest-ink-3"] as const) text(fg, bg);
    }
  });

  it("the cream primary carries ink-1 at rest and on hover", () => {
    text("ink-1", "cream");
    text("ink-1", "cream-hover");
  });

  it("every tone reads as text on the sheet, as chip text on its wash, and lit on forest", () => {
    for (const tone of ["copper", "amber", "sage", "brick", "slate"] as const) {
      text(`${tone}-text` as WorkspaceColour, "sheet");
      text(`${tone}-lit` as WorkspaceColour, "forest");
    }
    for (const tone of ["copper", "amber", "sage", "brick"] as const) {
      text(`${tone}-chip` as WorkspaceColour, `${tone}-wash` as WorkspaceColour);
    }
    text("slate-text", "slate-wash");
  });

  it("control boundaries and focus rings reach 3:1 on every surface they sit on", () => {
    for (const bg of ["sheet", "sheet-hover", "sheet-selected", "paper", "overlay"] as const) text("edge", bg, 3);
    for (const bg of ["forest", "forest-deep", "forest-field"] as const) text("forest-edge", bg, 3);
    for (const bg of ["sheet", "sheet-hover", "sheet-selected", "paper", "plane"] as const) text("ink-1", bg, 3);
    for (const bg of ["forest", "forest-deep", "forest-field"] as const) text("cream", bg, 3);
  });

  it("stage marks on the plane and the standalone amber mark reach 3:1", () => {
    for (const dot of ["plane-dot-new", "plane-dot-review", "plane-dot-approved", "plane-dot-declined", "plane-dot-withdrawn"] as const) {
      text(dot, "plane", 3);
    }
    text("amber-mark", "sheet", 3);
  });

  it("keeps the ground and the decorative rules out of any role that needs contrast", () => {
    // The sage ground never carries text; the rules are decoration only. Both
    // are below the thresholds on purpose, and this pins that they stay there
    // rather than creeping up into a role they cannot serve.
    expect(contrast(colour("ink-1"), colour("ground"))).toBeLessThan(4.5);
    expect(contrast(colour("rule"), colour("sheet"))).toBeLessThan(3);
    expect(contrast(colour("forest-rule"), colour("forest"))).toBeLessThan(3);
  });
});

describe("workspace registers — the focus ring follows the register", () => {
  for (const [register, ink] of [["ivory", "--house-ink-1"], ["forest", "--house-cream"]] as const) {
    it(`${register}: a 2px ring in its own ink, with no halo`, async () => {
      const block = await declarations("src/styles/workspace.css", `[data-register="${register}"]`);
      expect(block.get("--reg-focus")).toBe(`var(${ink})`);
      expect(block.get("--vv-focus-ring")).toBe("2px solid var(--reg-focus)");
      expect(block.get("--vv-focus-halo")).toBe("none");
    });
  }
});
