import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The fold's CSS keeps the house's laws (T-680; spec 8): transform and opacity
// only, no blur or filter (the cockpit's GPU guard), motion only in the fold
// states so every unit keeps its own CSS at rest, the crest left standing on a
// cleared screen, and reduced motion keeping the fade alone. happy-dom renders
// no CSS, so these read the text the browser will.
// ---------------------------------------------------------------------------

let css = "";
let assemblyCss = "";

beforeAll(async () => {
  css = await readFile(resolve("src/components/editor/cockpit/ChromeFold.css"), "utf8");
  assemblyCss = await readFile(resolve("src/floor/assembly/assembly.css"), "utf8");
});

/** A selector list's own selectors: commas inside :is() or :not() do not split it. */
function topLevelSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** The declarations of every rule whose selector mentions `needle`. */
function rulesFor(needle: string): string[] {
  const rules: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const [, selector = "", body = ""] = match;
    if (selector.includes(needle)) rules.push(body);
  }
  return rules;
}

describe("the fold's CSS", () => {
  it("no blur or filter", () => {
    expect(css).not.toMatch(/(?:^|[^-])filter\s*:/mu);
    expect(css).not.toMatch(/backdrop-filter/u);
    expect(css).not.toMatch(/blur\(/u);
  });

  it("moves with translate and scale, never transform", () => {
    expect(css).not.toMatch(/(?:^|[\s;{])transform\s*:/mu);
    expect(css).toMatch(/translate:\s*-12px 0/u);
    expect(css).toMatch(/scale:\s*0\.96/u);
  });

  it("runs 180 ms out and 240 ms in on the house's ease-out", () => {
    expect(css).toMatch(/--planner-chrome-out:\s*var\(--house-motion-reveal, 180ms\)/u);
    expect(css).toMatch(/--planner-chrome-in:\s*var\(--house-motion-deliberate, 240ms\)/u);
    expect(css).toMatch(/--planner-chrome-ease:\s*var\(--house-ease-out/u);
  });

  it("puts motion on the units only while they fold, unfold, clear or restore", () => {
    // Rules that set a unit's own transition (not a fold mark's or a spine's,
    // which are this feature's own elements) all sit under a fold state.
    const unitTransitions = [...css.matchAll(/([^{}]+)\{([^{}]*\btransition:[^{}]*)\}/gu)]
      .map(([, selector = ""]) => selector)
      .flatMap((selector) => topLevelSelectors(selector))
      .filter((selector) => !/chrome-fold-mark|chrome-spine|chrome-clear-hint|chrome-save-word|reference-crest|:root/u.test(selector))
      .filter((selector) => /\.reference-left-dock|\.planner-tool-pill|\.cockpit-bottom|\.reference-layer-controls/u.test(selector));
    expect(unitTransitions.length).toBeGreaterThan(0);
    for (const selector of unitTransitions) {
      expect(selector, selector).toMatch(/data-planner-(fold-[a-z]+|chrome)(-motion)?/u);
    }
  });

  it("hides opted-in surfaces and the When ribbon when cleared", () => {
    expect(css).toMatch(/html\[data-planner-chrome="cleared"\][^{]*\[data-chrome-surface\]/u);
    expect(css).toMatch(/html\[data-planner-chrome="cleared"\][^{]*\.reference-when-ribbon/u);
  });

  it("never folds the phase-preview lock", () => {
    // Every hiding rule that names the right dock's lens panels excludes the lock.
    const hiding = [...css.matchAll(/([^{}]+)\{([^{}]*visibility:\s*hidden[^{}]*)\}/gu)]
      .map(([, selector = ""]) => selector)
      .filter((selector) => selector.includes(".cockpit-panel"));
    expect(hiding.length).toBeGreaterThan(0);
    for (const selector of hiding) {
      expect(selector.match(/\.cockpit-panel(?!:not\(\.cockpit-preview-lock\))/gu), selector).toBeNull();
    }
  });

  it("keeps the crest visible while cleared", () => {
    const crest = rulesFor('html[data-planner-chrome="cleared"] .reference-crest');
    expect(crest.join("\n")).toMatch(/visibility:\s*visible/u);
    expect(crest.join("\n")).toMatch(/pointer-events:\s*auto/u);
  });

  it("makes the keyboard instant and keeps only the fade under reduced motion", () => {
    expect(css).toMatch(/html\[data-planner-chrome-motion="instant"\][^{]*\{\s*transition:\s*none;/u);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/translate:\s*none;/u);
    expect(reduced).toMatch(/scale:\s*none;/u);
  });

  it("folds the Grand Assembly's Replay away at rest, but never its Skip", () => {
    expect(assemblyCss).toMatch(/html\[data-planner-chrome="cleared"\] \.assembly-replay\[data-playing="false"\]/u);
    expect(assemblyCss).not.toMatch(/data-playing="true"\][^{]*\{[^}]*visibility:\s*hidden/u);
  });
});

// Review findings, 28 Oct (wf_8ab21f9e-0b4).
describe("the fold's CSS after review", () => {
  /** Every top-level selector of the rules whose declarations match `body`. */
  function selectorsWhere(body: RegExp): string[] {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .filter(([, , declarations = ""]) => body.test(declarations))
      .flatMap(([, selector = ""]) => topLevelSelectors(selector));
  }

  const hiding = (): string[] => selectorsWhere(/visibility:\s*hidden/u);

  it("lets a phase preview keep its one exit and the right-hand column, whatever the folds", () => {
    // A folded bottom bar hid "Exit preview" with no spine to bring it back.
    const folding = selectorsWhere(/visibility:\s*hidden|translate:(?!\s*none)/u);
    const bottom = folding.filter((s) => s.startsWith('html[data-planner-fold-bottom="folded"]') && s.includes(".cockpit-bottom"));
    expect(bottom.length).toBeGreaterThan(0);
    for (const s of bottom) expect(s, s).toContain('.reference-viewer:where(:not([data-layout-timeline-preview="true"])) > .cockpit-bottom');
    const right = folding.filter((s) => s.startsWith('html[data-planner-fold-right="folded"]') && s.includes(".reference-view-switch"));
    expect(right.length).toBeGreaterThan(0);
    for (const s of right) expect(s, s).toContain(':where(:not(:has(.reference-viewer[data-layout-timeline-preview="true"])))');
  });

  it("folds the '…' tools with the tool bar and clears them, and the review pill, with the rest", () => {
    expect(hiding().some((s) => s.startsWith('html[data-planner-fold-top="folded"]') && s.includes(".reference-extra-tools"))).toBe(true);
    expect(hiding().some((s) => s.startsWith('html[data-planner-chrome="cleared"]') && s.includes(".reference-extra-tools"))).toBe(true);
    expect(hiding().some((s) => s.startsWith('html[data-planner-chrome="cleared"]') && s.includes(".submit-review"))).toBe(true);
  });

  it("only fades what is not a unit, so nothing placed by its own transform drifts", () => {
    const moving = selectorsWhere(/scale:\s*0\.96|translate:(?!\s*none)/u);
    expect(moving.length).toBeGreaterThan(0);
    for (const s of moving) expect(s, s).not.toMatch(/vv-floating-widget|data-chrome-surface|submit-review|reference-when-ribbon/u);
  });

  it("brings each unit back from the corner it left from", () => {
    expect(css).toMatch(/html:is\(\[data-planner-fold-right="unfolding"\], \[data-planner-chrome="restoring"\]\)[^{]*\{\s*transform-origin: right center;/u);
    expect(css).toMatch(/html:is\(\[data-planner-fold-top="unfolding"\], \[data-planner-chrome="restoring"\]\)[^{]*\{\s*transform-origin: left top;/u);
    expect(css).toMatch(/html:is\(\[data-planner-fold-bottom="unfolding"\], \[data-planner-chrome="restoring"\]\)[^{]*\{\s*transform-origin: left bottom;/u);
  });

  it("keeps every mark at least 24 px and every spine at least 36 px across (WCAG 2.5.8; spec)", () => {
    const px = (needle: string, property: string): number => {
      for (const body of rulesFor(needle)) {
        const value = new RegExp(`(?:^|;|\\s)${property}:\\s*(\\d+)px`, "u").exec(body)?.[1];
        if (value !== undefined) return Number(value);
      }
      return 0;
    };
    for (const unit of ["left", "right", "top", "bottom"]) {
      expect(px(`.chrome-fold-mark--${unit}`, "width"), unit).toBeGreaterThanOrEqual(24);
      expect(px(`.chrome-fold-mark--${unit}`, "height"), unit).toBeGreaterThanOrEqual(24);
    }
    expect(px(".chrome-spine--left", "width")).toBeGreaterThanOrEqual(36);
    expect(px(".chrome-spine--right", "width")).toBeGreaterThanOrEqual(36);
    expect(px(".chrome-spine--top", "height")).toBeGreaterThanOrEqual(36);
    expect(px(".chrome-spine--bottom", "height")).toBeGreaterThanOrEqual(36);
  });

  it("sets the side marks on the docks' inner edges, outside the dock that clips and the rail that runs to its foot", () => {
    expect(css).not.toMatch(/\.reference-left-dock\s*>\s*\.chrome-fold-mark/u);
    expect(rulesFor(".chrome-fold-mark--left")[0]).toMatch(/left:\s*var\(--reference-left\)/u);
    expect(rulesFor(".chrome-fold-mark--right")[0]).toMatch(/right:\s*calc\(var\(--reference-right\) \+ 2px\)/u);
  });

  it("names the crest with a real element Esc can put away, not a pseudo-element", () => {
    expect(css).not.toMatch(/reference-crest::after/u);
    expect(css).toMatch(/\.reference-crest__label\[data-shown="true"\]\s*\{\s*opacity:\s*1;\s*pointer-events:\s*auto;/u);
  });

  it("keeps the note's and the save word's voices in the accessibility tree", () => {
    // Only the ink fades: neither ever goes visibility: hidden.
    for (const body of [...rulesFor(".chrome-clear-hint"), ...rulesFor(".chrome-save-word")]) {
      expect(body).not.toMatch(/visibility:\s*hidden/u);
    }
  });
});
