import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

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
// Five suites read every file under src/. Walking it once, here, keeps that
// cost out of any single test's timeout — on a loaded machine the first walk
// alone was overrunning the 20s default and failing tests that had found
// nothing wrong.
beforeAll(async () => {
  await readSrcFiles();
}, 180_000);

let srcFilesCache: Promise<readonly (readonly [string, string])[]> | null = null;

/** Memoised: five suites share one walk of src/, which each was repeating. */
async function readSrcFiles(): Promise<readonly (readonly [string, string])[]> {
  srcFilesCache ??= readSrcFilesUncached();
  return srcFilesCache;
}

async function readSrcFilesUncached(): Promise<readonly (readonly [string, string])[]> {
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

// One focus ring, expressed as tokens so a component can tighten the offset
// without inventing a colour: 2px, offset 2px, no halo (design system §2.10).
// A workspace register re-declares the ring in its own ink (workspace.css).
const FOCUS_RING: Readonly<Record<string, string>> = {
  "--vv-focus": "#A9622F",
  "--vv-focus-ring": "2px solid var(--vv-focus)",
  "--vv-focus-ring-offset": "2px",
  "--vv-focus-halo": "none",
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

// ---------------------------------------------------------------------------
// T-615 fix round 1 — audit VALUES, not names.
//
// The first pass shipped three checks written against the naming convention:
// a retirement test that only matched `--house-*brass*`, a type floor that
// only searched `font-size:`, and token audits that could not see a hardcoded
// hue at all. Each passed while the thing it forbids survived — a gold
// `--brass` on the public front door, `font: 600 9px/1` in the cockpit, a
// second oxblood inside the shared primitives.
//
// These three look at what renders instead:
//   * every colour LITERAL, classified by hue, so the next gold gradient fails
//     whatever hex it is written as — #f0cf84, rgba(219,190,91,…), or a value
//     nobody has typed yet;
//   * every size in all three syntaxes CSS and React can express;
//   * every brass-named token by the value it resolves to rather than its
//     spelling (two of them live in other lanes' files and cannot be renamed
//     here, so the name is allowed and the hue is not).
// ---------------------------------------------------------------------------

/** Paths whose colours are deliberately outside the register. */
const REGISTER_EXEMPT: readonly RegExp[] = [
  /__tests__/,
  // Trades House campaign collateral keeps the venue's own brand register.
  /features[\\/]trades-house/,
  /pages[\\/]TradesHouse/,
  // Materials inside the 3D viewport, not chrome. Moving these changes what a
  // selected table or a laser mark looks like — a separate decision.
  /components[\\/]meshes/,
  /PlacedFurniture\.tsx/,
  /MarkupLayer\.tsx/,
  /hallkeeper-geometry\.ts/,
  /DollhouseStage\.tsx/,
  /NavMarkers\.tsx/,
  /TravelControls\.tsx/,
  /TwinMinimap\.tsx/,
  /CockpitEvidenceBeam\.tsx/,
  // Fix round 2: the same rule, applied to the venue's OWN materials and the
  // in-scene affordances drawn beside them. Round 1's by-hue sweep reached
  // these — the dome gilt, the mural gold, the bronze fittings, the parquet
  // board gradient, the selection outline, the placement ghost — and left the
  // modelled hall disagreeing with itself (a copper dome ring above #8b5a22
  // ribs) for no chrome gain. Every literal below was restored byte for byte
  // to its value at release/r1 `0ef12a8a` and is named here so the next sweep
  // cannot reach it. The register is the CHROME register; what the venue is
  // made of is a decision about the room, not a token rename.
  /GrandHallDome\.tsx/,
  /GrandHallOrnaments\.tsx/,
  /constants[\\/]colors\.ts/,
  /grand-hall-textures\.ts/,
  /furniture-selection-outline\.ts/,
  /PlacementGhost\.tsx/,
  /MeasurementTool\.tsx/,
  /CockpitSceneOverlays\.tsx/,
  /LayoutPlanThumbnail\.tsx/,
  // T-629 split the ornament description out of GrandHallOrnaments.tsx into
  // data; the same gilt, avodire and oak, so the same rule.
  /grand-hall-ornament-parts\.ts/,
  // T-634's twenty-second profiler: an instrument launched on demand, not
  // chrome, and its warning hue is the instrument's own.
  /PerfOverlay\.css/,
  // Disclosed exceptions: a minified sheet on an admin-gated route, and the
  // print stylesheet, which works in its own mm scale.
  /demo-showcase\.css/,
  /hallkeeper-sheet\.css/,
];

/**
 * Files that still carry gold, with the lane that owns them. T-615 may not
 * edit these, so they are recorded rather than fixed — but the SET is frozen:
 * gold appearing in any other file fails, and a lane clearing its own file
 * makes this list wrong and fails too. Neither can pass quietly.
 */
const GOLD_HANDOFF: Readonly<Record<string, string>> = {
  "components/dashboard/NotificationCenter.tsx": "Lane 9",
  "pages/landing/rite.css": "Lane 2 (retired page, redirected in R1)",
  "pages/living-hall/living-hall.css": "Lane 2 (retired page, redirected in R1)",
  "twin/measure/measure.css": "Lane 3",
  "twin/shell/FloorConstellation.tsx": "Lane 3",
  "twin/shell/quick-actions.css": "Lane 3",
  "twin/shell/room-dossier.css": "Lane 3",
  "twin/shell/room-selector.css": "Lane 3",
  "twin/shell/viewpoint-plan.css": "Lane 3",
  "twin/tags/tags.css": "Lane 3",
  "twin/tour/tour.css": "Lane 3",
  "twin/twin.css": "Lane 3",
  // T-635: these import three, so Lane 1's copper for them is GPU-scoped
  // (.github/gpu/gpu-scope.mjs) and travels with the 3D batch.
  "components/editor/TimelinePreviewFurniture.tsx": "T-635 3D batch",
  "pages/SplatFixturePage.tsx": "T-635 3D batch",
  "pages/TradesHallVisualPage.tsx": "T-635 3D batch",
};

/** Paths exempt from the 11px floor, each for a reason stated in the PR. */
const TYPE_FLOOR_EXEMPT: readonly RegExp[] = [
  /__tests__/,
  /PerfOverlay\.css/,     // T-634's profiler: a dense instrument, launched on demand
  /features[\\/]trades-house/,
  /pages[\\/]TradesHouse/,
  /demo-showcase\.css/,    // minified, admin-gated, not visually verifiable here
  /hallkeeper-sheet\.css/, // print sheet in its own scale
  /twin[\\/]/,             // reverted: raising it broke the HUD geometry test
];

/**
 * Fix round 2 — the FOURTH syntax. Round 1 covered `font-size: Npx`, the
 * `font:` shorthand and inline `fontSize`, and disclosed `rem` as unguarded
 * debt. Round 1's own list of that debt said 26 declarations; it was wrong,
 * because its grep only matched a leading `0.` — the true figure by the same
 * rule is 30, the four extra being `.66rem`/`.65rem` in OnboardingView.css
 * and `.66rem`/`.68rem` in CaptureIntakePage.css. 29 are swept; the one below
 * is in a file this lane may not edit, and is frozen in both directions like
 * GOLD_HANDOFF: another sub-floor rem anywhere fails, and Lane 2 fixing this
 * one makes the list wrong and fails too.
 */
const REM_FLOOR_HANDOFF: Readonly<Record<string, string>> = {
  "pages/RoomsHomePage.css": "Lane 2 — .rooms__state, 0.68rem = 10.88px on the public rooms home",
};

/**
 * T-635: Lane 1 raised these two planner labels to 11px, but both files
 * import three, so the change is GPU-scoped and travels with the 3D batch.
 * Frozen like GOLD_HANDOFF: any other sub-floor size fails, and the batch
 * landing makes this list wrong and fails too.
 */
const PX_FLOOR_HANDOFF: readonly string[] = [
  "components/TapeMeasure.tsx:52 inline fontSize 10px",
  "components/WallTogglePanel.tsx:107 inline fontSize 10px",
];

const TYPE_FLOOR_PX = 11;

/** Nothing in the app moves the root font-size, so 1rem renders at 16px. */
const ROOT_FONT_PX = 16;

function hslOf([r, g, b]: Rgb): readonly [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
    else hue = 60 * ((rn - gn) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [hue, saturation * 100, lightness * 100];
}

/**
 * Amber is a status tone — "pending elsewhere": in review, a 1st option,
 * awaiting the client — not decoration (design system §2.3). Its mid-tone
 * values sit inside the gold band, so the register admits them only as these
 * named tokens in house-tokens.css; written as a literal anywhere else they
 * fail like any gold. workspace-tokens.test.ts pins their exact values.
 */
const STATUS_AMBER_TOKENS = ["--house-amber-dot", "--house-amber-mark", "--house-amber-lit", "--house-plane-dot-review"] as const;

function withoutStatusAmberTokens(path: string, text: string): string {
  if (path !== "styles/house-tokens.css") return text;
  return text.replace(new RegExp(`(?:${STATUS_AMBER_TOKENS.join("|")})\\s*:\\s*#[0-9a-fA-F]{6}\\s*;`, "g"), "");
}

/**
 * Gold as a region of colour space, not a list of hexes. The copper scale sits
 * at hue 24–27 and the House amber at 34, so the band opens at 36.
 *
 * The saturation floor and lightness ceiling are not decoration. A first pass
 * used 25 / 80 and swallowed things that are warm but plainly not gold: the
 * planner's paper backdrop `rgba(221, 208, 184)` (s 35, l 79) and seven
 * procedural room-texture colours in `lib/grand-hall-textures.ts`. Sweeping
 * those turned the Grand Hall's floor orange — caught in the screenshot, not
 * by any assertion. Real gold is saturated and mid-toned: every literal this
 * lane retired measures s 44–89 and l 42–76.
 */
function isGoldFamily(rgb: Rgb): boolean {
  const [hue, saturation, lightness] = hslOf(rgb);
  return hue >= 36 && hue <= 70 && saturation >= 40 && lightness >= 25 && lightness <= 76;
}

/** Every #rrggbb, rgb() and rgba() literal in a file, as rgb triples. */
function colourLiterals(text: string): readonly Rgb[] {
  const out: Rgb[] = [];
  for (const match of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const raw = match[1] ?? "";
    out.push([
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16),
    ]);
  }
  for (const match of text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
    out.push([Number(match[1] ?? "0"), Number(match[2] ?? "0"), Number(match[3] ?? "0")]);
  }
  return out;
}

describe("the register is enforced by value, not by name", () => {
  it("has no gold-family colour literal outside the recorded handoff list", async () => {
    const offenders = new Set<string>();
    for (const [path, text] of await readSrcFiles()) {
      if (REGISTER_EXEMPT.some((rule) => rule.test(path))) continue;
      if (colourLiterals(withoutStatusAmberTokens(path, text)).some(isGoldFamily)) offenders.add(path);
    }
    expect([...offenders].sort()).toEqual(Object.keys(GOLD_HANDOFF).sort());
  });

  // The NAME may survive where another lane owns the file and T-615 may not
  // rename it (RoomsHomePage, RoomWalkPage) — and the Diary has called its
  // forest greens --diary-brass-* since long before the register existed. What
  // may not survive is a brass-named token still holding a brass HUE, which is
  // precisely the defect the House-prefixed name test could not see.
  it("lets no brass-NAMED token hold a gold value", async () => {
    const wrong: string[] = [];
    for (const [path, text] of await readSrcFiles()) {
      for (const match of text.matchAll(/(--[a-z0-9-]*brass[a-z0-9-]*)\s*:\s*([^;]+);/g)) {
        const value = (match[2] ?? "").trim();
        if (value.startsWith("var(")) continue;
        if (colourLiterals(value).some(isGoldFamily)) {
          wrong.push(`${path}: ${match[1] ?? ""} = ${value}`);
        }
      }
    }
    expect(wrong, "a brass NAME may survive; a brass HUE may not").toEqual([]);
  });

  it("keeps every type size at or above the 11px floor, in all three syntaxes", async () => {
    const tooSmall: string[] = [];
    for (const [path, text] of await readSrcFiles()) {
      if (TYPE_FLOOR_EXEMPT.some((rule) => rule.test(path))) continue;
      text.split("\n").forEach((line, index) => {
        const at = `${path}:${String(index + 1)}`;
        const record = (size: string, syntax: string): void => {
          if (Number(size) < TYPE_FLOOR_PX) tooSmall.push(`${at} ${syntax} ${size}px`);
        };
        if (path.endsWith(".css")) {
          for (const m of line.matchAll(/font-size:\s*([0-9.]+)px/g)) record(m[1] ?? "0", "font-size");
          // The shorthand is the syntax the first pass never searched.
          for (const m of line.matchAll(/font:[^;{}]*?\b([0-9.]+)px/g)) record(m[1] ?? "0", "font: shorthand");
        } else {
          for (const m of line.matchAll(/fontSize:\s*"?([0-9.]+)(?:px)?"?/g)) record(m[1] ?? "0", "inline fontSize");
        }
      });
    }
    expect([...tooSmall].sort()).toEqual([...PX_FLOOR_HANDOFF].sort());
  });

  it("keeps every rem type size at or above the 11px floor too", async () => {
    // `rem` is the fourth syntax, and the one the px floor could never see.
    // Both forms are read: `0.66rem` and the leading-dot `.66rem` that round
    // 1's own audit grep missed. Anything inside a font declaration counts,
    // including the floor of a clamp(), because that floor is what renders on
    // a narrow phone.
    const offenders = new Set<string>();
    for (const [path, text] of await readSrcFiles()) {
      if (TYPE_FLOOR_EXEMPT.some((rule) => rule.test(path))) continue;
      for (const declaration of text.matchAll(/(?:font-size:|font:)[^;{}]*/g)) {
        for (const size of declaration[0].matchAll(/(?<![\w.])([0-9]*\.?[0-9]+)rem/g)) {
          if (Number(size[1] ?? "0") * ROOT_FONT_PX < TYPE_FLOOR_PX) offenders.add(path);
        }
      }
    }
    expect([...offenders].sort()).toEqual(Object.keys(REM_FLOOR_HANDOFF).sort());
  });
});

// ---------------------------------------------------------------------------
// T-615 fix round 2 — ONE accent, but not one colour.
//
// Retiring gold by hue moved every amber signal onto the single copper, and
// nothing in the suite could see it: both value audits classify a colour by
// its hue band, and a state painted the same as the ordinary case is inside
// every band it is supposed to be in. The defect it let through was concrete
// — the Day Board's own legend, the footer whose entire job is to say what
// the colours mean, drew "Booking starts soon" and "Scheduled event" as
// identical dots, and a planner's "Awaiting Review" and "Changes Requested"
// became the same ink.
//
// These assertions read RELATIONS between colours instead of colours: two
// entries of one legend may not be equal, and two states a person has to tell
// apart may not be equal. They would have failed on the round-1 head.
// ---------------------------------------------------------------------------

/** CSS with block comments removed, so prose cannot be read as a value. */
function stripCssComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

/** TS/TSX with whole-line `//` comments removed, for the same reason. */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/** Every value a custom property is given, in cascade order. */
function declarationsOf(css: string, token: string): readonly string[] {
  const pattern = new RegExp(`${token}\\s*:\\s*([^;]+);`, "g");
  return [...css.matchAll(pattern)].map((match) => (match[1] ?? "").trim());
}

function firstDuplicate(entries: ReadonlyMap<string, string>): string | null {
  const seen = new Map<string, string>();
  for (const [name, value] of entries) {
    const owner = seen.get(value);
    if (owner !== undefined) return `${owner} and ${name} are both ${value}`;
    seen.set(value, name);
  }
  return null;
}

describe("one accent, but never one colour for two states", () => {
  it("gives every Day Board legend entry its own swatch, on both grounds", async () => {
    const page = await readFile(resolve("src/pages/hallkeeper/DayBoardPage.tsx"), "utf-8");
    const css = stripCssComments(await readFile(resolve("src/pages/hallkeeper/day-board.css"), "utf-8"));

    // The legend is the footer that explains the colours; read the chip
    // classes out of it rather than hard-coding them, so a Lane 6 edit that
    // adds a fifth entry is audited too.
    const legend = /<footer className="dayboard-legend"[\s\S]*?<\/footer>/.exec(page);
    expect(legend, "DayBoardPage must still render the colour legend").not.toBeNull();
    const chipClasses = [...(legend?.[0] ?? "").matchAll(/dayboard-chip-([a-z-]+)/g)]
      .map((match) => match[1] ?? "")
      .filter((name) => name !== "dot");
    expect(chipClasses.length, "the legend should carry several entries").toBeGreaterThan(2);

    // .dayboard-chip-live points at --db-gilt, not at --db-live: follow the
    // indirection instead of assuming the names line up.
    const first = new Map<string, string>();
    const effective = new Map<string, string>();
    for (const chip of chipClasses) {
      const tone = new RegExp(`\\.dayboard-chip-${chip}\\s*\\{\\s*--db-chip-tone:\\s*var\\((--db-[a-z-]+)\\)`).exec(css);
      expect(tone, `.dayboard-chip-${chip} must declare a tone`).not.toBeNull();
      const values = declarationsOf(css, tone?.[1] ?? "--db-none");
      expect(values.length, `${tone?.[1] ?? ""} must be defined`).toBeGreaterThan(0);
      first.set(chip, values[0] ?? "");
      // The ivory workspace block is unconditional and comes last, so the last
      // declaration is what actually renders.
      effective.set(chip, values[values.length - 1] ?? "");
    }
    expect(firstDuplicate(first), "two legend entries share a colour in the base block").toBeNull();
    expect(firstDuplicate(effective), "two legend entries share a colour as rendered").toBeNull();
  });

  it("keeps the review statuses a planner must tell apart on different colours", async () => {
    const panel = stripLineComments(
      await readFile(resolve("src/components/editor/SubmitForReviewPanel.tsx"), "utf-8"),
    );
    const visuals = new Map<string, string>();
    for (const entry of panel.matchAll(/^\s{2}([a-z_]+):\s*\{([^}]*)\},/gm)) {
      const key = entry[1] ?? "";
      const body = entry[2] ?? "";
      const colour = /\bcolor:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
      const background = /\bbackground:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
      const border = /\bborderColor:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
      if (colour !== "") visuals.set(key, `${background} ${colour} ${border}`);
    }
    for (const status of ["submitted", "changes_requested", "approved", "rejected"]) {
      expect(visuals.has(status), `STATUS_VISUALS must define ${status}`).toBe(true);
    }
    // No two statuses may be indistinguishable as a whole.
    expect(firstDuplicate(visuals), "two review statuses render identically").toBeNull();
    // And the four a planner acts on must differ in the ink, not only the ground.
    const inks = new Map<string, string>();
    for (const status of ["submitted", "under_review", "approved", "changes_requested", "rejected"]) {
      const body = new RegExp(`^\\s{2}${status}:\\s*\\{([^}]*)\\},`, "m").exec(panel)?.[1] ?? "";
      inks.set(status, /\bcolor:\s*"([^"]+)"/.exec(body)?.[1] ?? "");
    }
    expect(firstDuplicate(inks), "two actionable review statuses share an ink").toBeNull();
  });

  it("keeps the hallkeeper's banner statuses on different colours", async () => {
    const banner = stripLineComments(
      await readFile(resolve("src/components/hallkeeper/HallkeeperStatusBanner.tsx"), "utf-8"),
    );
    const inks = new Map<string, string>();
    for (const status of ["submitted", "under_review", "approved", "changes_requested", "rejected"]) {
      const block = new RegExp(`case "${status}":[\\s\\S]{0,900}?color:\\s*"([^"]+)"`).exec(banner);
      expect(block, `describeStatus must still handle ${status}`).not.toBeNull();
      inks.set(status, block?.[1] ?? "");
    }
    expect(firstDuplicate(inks), "two banner statuses share an ink").toBeNull();
  });

  it("keeps the cockpit's attention state off the panel accent", async () => {
    const css = stripCssComments(
      await readFile(resolve("src/components/editor/cockpit/LensPanel.css"), "utf-8"),
    );
    const accent = /\.lens-panel__eyebrow\s*\{[^}]*color:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? "";
    const attention = /\.lens-panel__chip--attention\s*\{[^}]*color:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? "";
    expect(accent, "the panel eyebrow carries the accent").not.toBe("");
    expect(attention, "the attention chip carries the attention hue").not.toBe("");
    expect(attention, "attention may not be the accent wearing another name").not.toBe(accent);

    // A gradient whose two stops are equal is not a gradient; round 1 left
    // `linear-gradient(90deg, #dca475, #dca475)` on both attention fills.
    for (const fill of ["meter-fill--attention", "circuit-fill--attention"]) {
      const rule = new RegExp(`\\.lens-panel__${fill}\\s*\\{[^}]*background:\\s*linear-gradient\\(([^)]*)\\)`).exec(css);
      expect(rule, `.lens-panel__${fill} must still be a gradient`).not.toBeNull();
      const stops = (rule?.[1] ?? "").split(",").map((part) => part.trim()).slice(1);
      expect(stops.length, `${fill} needs two stops`).toBe(2);
      expect(stops[0], `${fill} is a flat gradient`).not.toBe(stops[1]);
    }
  });
});
