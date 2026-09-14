import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// IMMERSIVE MODE — fullscreen shows the photograph and nothing else.
//
// The rule lives in CSS, so these assertions read the shipped source rather
// than a render: happy-dom applies no stylesheets, so a DOM test here would
// assert nothing at all and quietly pass forever. Same idiom as the measure
// tool's own stylesheet tests.
//
// What is actually worth pinning is not "a rule exists" but the SHAPE of the
// rule. It is written as "hide every sibling of the stage", so its exception
// list is the entire contract: anything named there survives fullscreen, and
// anything not named there disappears, including chrome that does not exist
// yet. A future edit that adds a class to that list is the edit that silently
// re-admits a pill over the photograph, so the list is asserted exactly.
// -----------------------------------------------------------------------------

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

const TWIN_CSS = source("src/twin/twin.css");
const VIEWER_SOURCE = source("src/twin/TwinViewer.tsx");

/**
 * Every stylesheet and component the twin ships, concatenated — the corpus for
 * "is this class name real?". Tests are excluded on purpose: a chrome name that
 * survives only because a test still mentions it is exactly the stale name this
 * check exists to catch. Chrome lives across several files (the plan HUD is in
 * plan.css, the measure trigger in measure.css), so narrowing this to twin.css
 * silently passes names that no longer exist.
 */
function twinSources(dir = resolve(process.cwd(), "src/twin")): string {
  let out = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "__fixtures__") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out += twinSources(path);
    } else if (/\.(css|tsx|ts)$/.test(entry.name)) {
      out += readFileSync(path, "utf8");
    }
  }
  return out;
}

const TWIN_SOURCES = twinSources();

/** The stage's class, as the viewer hands it to the R3F Canvas. */
const STAGE_CLASS = "vv-twin-stage";

/** Everything the immersive rule is allowed to spare, and nothing else. */
const SPARED = [
  STAGE_CLASS,
  "vv-sr-only",
  "vv-twin-vignette",
  "vv-twin-first-light",
] as const;

/** The immersive rule's selector, as one whitespace-collapsed string. */
function immersiveSelector(): string {
  const start = TWIN_CSS.indexOf(".vv-twin-viewer:fullscreen");
  expect(start, "no :fullscreen rule in twin.css").toBeGreaterThan(-1);
  const open = TWIN_CSS.indexOf("{", start);
  return TWIN_CSS.slice(start, open).replace(/\s+/g, " ").trim();
}

describe("fullscreen is immersive", () => {
  it("gives the canvas a class the rule can keep", () => {
    // Without this the rule would hide the stage along with the chrome, and
    // fullscreen would be a black screen.
    expect(VIEWER_SOURCE).toContain(`className="${STAGE_CLASS}"`);
  });

  it("hides every sibling of the stage rather than a list of known chrome", () => {
    const selector = immersiveSelector();
    expect(selector).toContain(".vv-twin-viewer:fullscreen");
    // The child combinator is what makes it "every sibling": a descendant
    // selector would also reach inside the stage and blank the canvas.
    expect(selector).toContain(">");
    expect(TWIN_CSS).toMatch(/\.vv-twin-viewer:fullscreen[\s\S]{0,240}display:\s*none/);
  });

  it("spares exactly the four elements that are not chrome", () => {
    const selector = immersiveSelector();
    const excepted = [...selector.matchAll(/:not\(\s*\.([\w-]+)\s*\)/g)].map((m) => m[1]);
    expect(excepted.sort()).toEqual([...SPARED].sort());
  });

  it("does not spare any control — the rail, the modes and the labels all go", () => {
    const selector = immersiveSelector();
    // Every one of these is chrome the viewer paints over the photograph.
    const chrome = [
      "vv-twin-node-label",
      "vv-twin-mode",
      "vv-twin-surface",
      "vv-twin-controls",
      "vv-twin-disclosure",
      "vv-twin-measure-trigger",
      "vv-twin-plan-hud",
      "vv-twin-plan-labels",
    ];
    for (const name of chrome) {
      expect(selector, `${name} must not be spared`).not.toContain(`.${name})`);
      // ...and it must really be chrome this viewer paints, not a stale name.
      expect(TWIN_SOURCES, `${name} is not used anywhere`).toContain(name);
    }
  });

  it("keeps the screen-reader live region, so hiding chrome is not silencing", () => {
    // The arrival announcements live in a .vv-sr-only paragraph. Hiding it
    // would make fullscreen a downgrade for anyone listening rather than
    // looking, which a visual preference has no business causing.
    expect(SPARED).toContain("vv-sr-only");
    expect(VIEWER_SOURCE).toContain('className="vv-sr-only" aria-live="polite"');
  });

  it("sizes the stage to the fullscreen box explicitly", () => {
    expect(TWIN_CSS).toMatch(
      /\.vv-twin-viewer:fullscreen\s*>\s*\.vv-twin-stage\s*\{[^}]*height:\s*100%/,
    );
  });

  it("also silences the overlays three.js draws, which no stylesheet can reach", () => {
    // The half a CSS rule cannot do. Each of these is painted into the canvas,
    // so the only way to remove it is to stop mounting it — and the first pass
    // of this feature shipped without them, hiding every pill while leaving
    // gold nav lines printed across the parquet.
    const gated = ["FloorConstellation", "NavMarkers"];
    for (const name of gated) {
      const mount = VIEWER_SOURCE.indexOf(`<${name}`);
      expect(mount, `${name} is not mounted`).toBeGreaterThan(-1);
      // The guard sits immediately before the mount, inside the same branch.
      const preceding = VIEWER_SOURCE.slice(Math.max(0, mount - 200), mount);
      expect(preceding, `${name} renders in immersive mode`).toContain("!immersive");
    }
    // The reticle and the dollhouse dots are gated inside their own
    // components, so the viewer's job is only to pass the flag down.
    expect(VIEWER_SOURCE).toContain("immersive={immersive}");
    expect(source("src/twin/TravelControls.tsx")).toContain("!enabled || immersive");
    expect(source("src/twin/DollhouseStage.tsx")).toContain("{!immersive && (");
  });

  it("unmounts those overlays rather than hiding them", () => {
    // An invisible dot still owns its hit disc: the model would keep answering
    // clicks with a dive the visitor cannot see coming. Same for the reticle.
    const dollhouse = source("src/twin/DollhouseStage.tsx");
    expect(dollhouse).not.toMatch(/immersive[^\n]*visible=\{false\}/);
    expect(dollhouse).toContain("{!immersive && (");
  });

  it("leaves travel itself alone — only the ink goes", () => {
    // Removing the affordance must not remove the ability. Click-travel and
    // WASD live in effects that are not gated on immersive.
    const travel = source("src/twin/TravelControls.tsx");
    const guard = travel.indexOf("!enabled || immersive");
    const keyEffect = travel.indexOf('window.addEventListener("keydown"');
    const clickEffect = travel.indexOf('element.addEventListener("click"');
    expect(keyEffect, "keyboard travel missing").toBeGreaterThan(-1);
    expect(clickEffect, "click travel missing").toBeGreaterThan(-1);
    // Both are wired above the early return, so neither is skipped by it.
    expect(keyEffect).toBeLessThan(guard);
    expect(clickEffect).toBeLessThan(guard);
  });

  it("needs no !important to win, and uses none", () => {
    const start = TWIN_CSS.indexOf(".vv-twin-viewer:fullscreen");
    const block = TWIN_CSS.slice(start, start + 600);
    expect(block).not.toContain("!important");
  });
});
