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
