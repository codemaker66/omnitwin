import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CARD A3 (G2a): the House token layer. This suite is the card's DoD gate:
//   1. House token names carry 02-DESIGN-LANGUAGE's exact BOH values.
//   2. Chrome text meets WCAG: text/1 and text/2 ≥ 4.5:1 on every BOH
//      background; text/3 (hints) and all non-text hues ≥ 3:1.
//   3. Legacy `--vv-*` tokens keep today's exact values (zero visual
//      regression) — high-delta tokens stay literal with migration notes;
//      only sub-pixel-diff-threshold tokens alias House names.
// The audit runs over the token FILE (source of truth), not a rendered DOM,
// so it gates values before any surface consumes them.

type Rgb = readonly [number, number, number];
interface Rgba {
  readonly rgb: Rgb;
  readonly alpha: number;
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const raw = hex[1] ?? "";
    return {
      rgb: [
        Number.parseInt(raw.slice(0, 2), 16),
        Number.parseInt(raw.slice(2, 4), 16),
        Number.parseInt(raw.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/.exec(value.trim());
  if (rgba !== null) {
    return {
      rgb: [Number(rgba[1] ?? "0"), Number(rgba[2] ?? "0"), Number(rgba[3] ?? "0")],
      alpha: Number(rgba[4] ?? "1"),
    };
  }
  throw new Error(`Unparseable color for contrast audit: ${value}`);
}

function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  const mix = (c: number, b: number): number => fg.alpha * c + (1 - fg.alpha) * b;
  return [mix(fg.rgb[0], bg[0]), mix(fg.rgb[1], bg[1]), mix(fg.rgb[2], bg[2])];
}

function linearChannel(channel: number): number {
  const s = channel / 255;
  // 0.04045 is the correct sRGB (IEC 61966-2-1) threshold; WCAG 2.x's
  // published 0.03928 is a known erratum — do not "fix" this back.
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
}

/** WCAG 2.x contrast ratio; rgba foregrounds are composited over the bg. */
function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  if (bg.alpha !== 1) throw new Error(`Backgrounds must be opaque: ${background}`);
  const fg = compositeOver(parseColor(foreground), bg.rgb);
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg.rgb)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

async function readTokens(relPath: string, prefix: string): Promise<Map<string, string>> {
  const css = await readFile(resolve(relPath), "utf-8");
  const tokens = new Map<string, string>();
  const pattern = new RegExp(`(${prefix}[a-z0-9-]+)\\s*:\\s*([^;]+);`, "g");
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const value = match[2];
    // Last declaration wins, matching the real CSS cascade.
    if (name !== undefined && value !== undefined) {
      tokens.set(name, value.trim());
    }
  }
  return tokens;
}

function tokenValue(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing token: ${name}`);
  return value;
}

const HOUSE_CSS = "src/styles/house-tokens.css";

/**
 * Every source file under src/ that Vite can ship, as [path, text] pairs.
 * Test files are included on purpose: a stale token name in a test is still a
 * stale token name, and this suite is the only thing that will notice.
 */
async function readSrcFiles(): Promise<readonly (readonly [string, string])[]> {
  const root = resolve("src");
  const out: (readonly [string, string])[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
        out.push([full.slice(root.length + 1).replaceAll("\\", "/"), await readFile(full, "utf-8")]);
      }
    }
  }
  await walk(root);
  return out;
}

/** "<relative path>: <match>" for every hit of `pattern` under src/. */
async function grepSrc(pattern: RegExp): Promise<readonly string[]> {
  const hits: string[] = [];
  for (const [path, text] of await readSrcFiles()) {
    for (const match of text.matchAll(pattern)) hits.push(`${path}: ${match[0]}`);
  }
  return hits;
}

// 02 §3 BOH canon — these values may not drift from the design language.
// T-615: the brass accent token is GONE (not aliased) and copper took its
// place; --house-text-0 was consumed by FurnitureInspectionDock.css with no
// definition anywhere, and is now defined.
const HOUSE_CANON: Readonly<Record<string, string>> = {
  "--house-bg-0": "#0B0A09",
  "--house-bg-1": "#131110",
  "--house-bg-2": "#1B1917",
  "--house-hairline": "rgba(245, 240, 232, 0.08)",
  "--house-hairline-hover": "rgba(245, 240, 232, 0.12)",
  "--house-text-0": "#FFFAF0",
  "--house-text-1": "#F4EFE6",
  "--house-text-2": "rgba(244, 239, 230, 0.62)",
  "--house-text-3": "rgba(244, 239, 230, 0.38)",
  "--house-accent-copper": "#C98A5B",
  "--house-accent-copper-bright": "#DCA475",
  "--house-accent-copper-deep": "#7E4620",
  "--house-status-sage": "#8FAE8B",
  "--house-status-amber": "#C99A5B",
  "--house-status-grey": "rgba(244, 239, 230, 0.38)",
  "--house-status-oxblood": "#B25454",
  "--house-status-cyan": "#6FB7C9",
  "--house-status-violet": "#9D8BC9",
};

// T-615 — THE REGISTER (FOH). Blake's 14 September decision: ivory, forest
// green, copper, sage. These are the light-surface canon; the audit below
// holds them to the same contrast law as the BOH set, on the ivory grounds.
const REGISTER_CANON: Readonly<Record<string, string>> = {
  "--vv-ivory": "#F2EDDA",
  "--vv-ivory-2": "#E6E1CF",
  "--vv-ivory-3": "#FBF8EE",
  "--vv-forest": "#1B3A2F",
  "--vv-forest-2": "#294B3B",
  "--vv-forest-soft": "#4C6055",
  "--vv-copper": "#A9622F",
  "--vv-copper-ink": "#7E4620",
  "--vv-sage": "#8FAE8B",
  "--vv-sage-ink": "#4A6650",
  "--vv-rule": "#BFC4B2",
};

// 02 §3 ghost material + §6 motion tiers (deliberate pinned at Materialize's
// 240 ms; cinematic at the 500–800 ms band's midpoint).
const HOUSE_CONSTANTS: Readonly<Record<string, string>> = {
  "--house-ghost-fill-opacity": "0.32",
  "--house-ghost-stroke-width": "1px",
  "--house-ghost-breath-duration": "3s",
  "--house-ghost-breath-amplitude": "0.04",
  "--house-motion-instant": "100ms",
  "--house-motion-deliberate": "240ms",
  "--house-motion-cinematic": "650ms",
};

// Zero-visual-regression law: legacy tokens whose House counterparts differ
// visibly keep today's exact values until their consuming surfaces migrate.
// T-615 removed --vv-gold, --vv-gold-2 and --vv-focus from this list on
// purpose: the register decision is a deliberate visual change, and those
// three now resolve to copper (see LEGACY_ALIASES and FOCUS_RING).
const LEGACY_LITERALS: Readonly<Record<string, string>> = {
  "--vv-muted": "rgba(246, 241, 232, 0.68)",
  "--vv-cyan": "#6bd9e8",
  "--vv-danger": "#f19a8f",
  "--vv-success": "#8fd19e",
  "--vv-panel": "rgba(18, 16, 13, 0.92)",
  "--vv-panel-soft": "rgba(255, 249, 236, 0.08)",
};

// Sub-threshold aliases: adopting the House value moves these ≤ 3 units per
// channel, invisible to the pixel-diff suites. (--vv-cinema-* deliberately
// absent: App.css owns those, scoped to its own shell.)
// The two gold names are aliases rather than deletions because ~200 call
// sites consumed them; pointing the names at copper moved every one of those
// sites onto the register in a single edit.
const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  "--vv-ink": "var(--house-bg-0)",
  "--vv-ink-2": "var(--house-bg-1)",
  "--vv-cream": "var(--house-text-1)",
  "--vv-gold": "var(--house-accent-copper)",
  "--vv-gold-2": "var(--house-accent-copper-deep)",
};

// One focus ring, expressed as three tokens so a component can tighten the
// offset without inventing a colour.
const FOCUS_RING: Readonly<Record<string, string>> = {
  "--vv-focus": "#A9622F",
  "--vv-focus-ring": "3px solid var(--vv-focus)",
  "--vv-focus-ring-offset": "2px",
};

describe("house-tokens.css — canon", () => {
  it("defines every 02 §3 BOH token at its exact canonical value", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--house-");
    for (const [name, value] of Object.entries(HOUSE_CANON)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("defines the ghost-material and motion-tier constants", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--house-");
    for (const [name, value] of Object.entries(HOUSE_CONSTANTS)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("defines the ivory/forest/copper/sage register at its exact values", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    for (const [name, value] of Object.entries(REGISTER_CANON)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("defines one focus ring, and it is the copper one", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    for (const [name, value] of Object.entries(FOCUS_RING)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("retires brass: no --house-*brass* token is defined or consumed anywhere in src", async () => {
    const offenders = await grepSrc(/--house-[a-z0-9-]*brass/g);
    expect(offenders, "brass is retired — use the copper scale").toEqual([]);
  });
});

describe("house-tokens.css — dark-theme contrast audit (02 §3 color-blind law)", () => {
  const backgrounds = ["--house-bg-0", "--house-bg-1", "--house-bg-2"] as const;

  it("keeps primary and secondary chrome text ≥ 4.5:1 on every BOH background", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--house-");
    for (const textToken of ["--house-text-0", "--house-text-1", "--house-text-2"] as const) {
      for (const bgToken of backgrounds) {
        const ratio = contrastRatio(tokenValue(tokens, textToken), tokenValue(tokens, bgToken));
        expect(ratio, `${textToken} on ${bgToken}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps hint text and every status/accent hue ≥ 3:1 on every BOH background", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--house-");
    const hues = [
      "--house-text-3",
      "--house-accent-copper",
      "--house-accent-copper-bright",
      "--house-status-sage",
      "--house-status-amber",
      "--house-status-grey",
      "--house-status-oxblood",
      "--house-status-cyan",
      "--house-status-violet",
    ] as const;
    for (const hueToken of hues) {
      for (const bgToken of backgrounds) {
        const ratio = contrastRatio(tokenValue(tokens, hueToken), tokenValue(tokens, bgToken));
        expect(ratio, `${hueToken} on ${bgToken}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("pins status-grey to text/3 (02 §3: Stale uses the muted text tier)", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--house-");
    expect(tokenValue(tokens, "--house-status-grey")).toBe(tokenValue(tokens, "--house-text-3"));
  });
});

describe("house-tokens.css — zero-visual-regression aliases", () => {
  it("keeps every high-delta legacy token at today's exact value", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    for (const [name, value] of Object.entries(LEGACY_LITERALS)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("aliases only the sub-threshold legacy tokens onto House names", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    for (const [name, value] of Object.entries(LEGACY_ALIASES)) {
      expect(tokenValue(tokens, name), name).toBe(value);
    }
  });

  it("moves token ownership out of global.css (house-tokens is the single source)", async () => {
    const globalCss = await readFile(resolve("src/global.css"), "utf-8");
    expect(globalCss).toContain('@import "./styles/house-tokens.css";');
    expect(globalCss).not.toMatch(/--vv-ink\s*:\s*#/);
    expect(globalCss).not.toMatch(/--vv-gold\s*:\s*#/);
  });

  it("proves the consumption path: planner chrome consumes House names directly", async () => {
    const cockpitCss = await readFile(
      resolve("src/components/editor/cockpit/PlannerCockpit.css"),
      "utf-8",
    );
    expect(cockpitCss).toContain("var(--house-bg-0");
    expect(cockpitCss).toContain("var(--house-text-1");
  });
});

// ---------------------------------------------------------------------------
// T-615 — the register on ivory. The original suite only audited the dark
// chrome, which is why an ivory surface could ship forest-on-ivory at any
// ratio it liked. Same law, other ground.
// ---------------------------------------------------------------------------
describe("house-tokens.css — light-register contrast audit", () => {
  const grounds = ["--vv-ivory", "--vv-ivory-2", "--vv-ivory-3"] as const;

  it("keeps every ink tier ≥ 4.5:1 on every ivory ground", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    const inks = ["--vv-forest", "--vv-forest-2", "--vv-forest-soft", "--vv-copper-ink", "--vv-sage-ink"] as const;
    for (const ink of inks) {
      for (const ground of grounds) {
        const ratio = contrastRatio(tokenValue(tokens, ink), tokenValue(tokens, ground));
        expect(ratio, `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the accent and the focus ring ≥ 3:1 on every ivory ground", async () => {
    const tokens = await readTokens(HOUSE_CSS, "--vv-");
    for (const hue of ["--vv-copper", "--vv-focus"] as const) {
      for (const ground of grounds) {
        const ratio = contrastRatio(tokenValue(tokens, hue), tokenValue(tokens, ground));
        expect(ratio, `${hue} on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the ONE focus ring legible on the graphite grounds too", async () => {
    const vv = await readTokens(HOUSE_CSS, "--vv-");
    const house = await readTokens(HOUSE_CSS, "--house-");
    for (const bg of ["--house-bg-0", "--house-bg-1", "--house-bg-2"] as const) {
      const ratio = contrastRatio(tokenValue(vv, "--vv-focus"), tokenValue(house, bg));
      expect(ratio, `--vv-focus on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// T-615 — the resolution gate. Four `--house-*` names were consumed by
// cockpit CSS with no definition anywhere, so those rules silently fell back
// to their inline literal (or to nothing). A token that does not resolve is a
// colour no one chose; this suite makes that a failing test rather than a
// visual surprise.
// ---------------------------------------------------------------------------
describe("house-tokens.css — every consumed var(--house-*) resolves", () => {
  it("defines every House token consumed anywhere under src/", async () => {
    const defined = new Set((await readTokens(HOUSE_CSS, "--house-")).keys());
    const unresolved = new Map<string, string[]>();
    for (const [path, text] of await readSrcFiles()) {
      for (const match of text.matchAll(/var\(\s*(--house-[a-z0-9-]+)/g)) {
        const name = match[1];
        if (name === undefined || defined.has(name)) continue;
        const where = unresolved.get(name) ?? [];
        if (!where.includes(path)) where.push(path);
        unresolved.set(name, where);
      }
    }
    const report = [...unresolved].map(([name, files]) => `${name} <- ${files.join(", ")}`);
    expect(report, "consumed but undefined in house-tokens.css").toEqual([]);
  });

  it("defines every register token consumed anywhere under src/", async () => {
    const defined = new Set((await readTokens(HOUSE_CSS, "--vv-")).keys());
    // App.css scopes its own --vv-cinema-* to .venviewer-planner-shell, and
    // Activity.css its own --vv-activity-* / --vv-sphere-* / --vv-ring /
    // --vv-helix / --vv-depth to the indicator. Those are subsystem-local by
    // design and are not root tokens.
    const scoped = /^--vv-(cinema|activity|sphere|ring|helix|depth|dossier|tag|tour)-?/;
    const unresolved = new Map<string, string[]>();
    for (const [path, text] of await readSrcFiles()) {
      for (const match of text.matchAll(/var\(\s*(--vv-[a-z0-9-]+)/g)) {
        const name = match[1];
        if (name === undefined || defined.has(name) || scoped.test(name)) continue;
        const where = unresolved.get(name) ?? [];
        if (!where.includes(path)) where.push(path);
        unresolved.set(name, where);
      }
    }
    const report = [...unresolved].map(([name, files]) => `${name} <- ${files.join(", ")}`);
    expect(report, "consumed but undefined in house-tokens.css").toEqual([]);
  });
});
