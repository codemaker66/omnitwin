import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The HUD's stylesheets, read as text: the keyboard's ring, how far the
// screen's rules reach, and what a choice that cannot be taken looks like.
//
// A test's page lays nothing out and has no cascade to ask, so this holds the
// rules the look is made from; what a browser makes of them is looked at in a
// browser. Each rule here was a fault first (the release lead's delta review
// of #428, 16 Nov 2026):
//
// - The app draws the one focus ring there is (global.css), from tokens, and
//   on a key that is a stop in the Tab order its rule outranks a ring this
//   screen draws for itself. The HUD's radio groups have such stops, and wore
//   the app's copper ring; a chosen choice, marked by its own outline, lost
//   the mark while it had the keyboard.
// - The rules for "every key under the screen" also reached the keys the
//   scene draws in the room.
// - A choice that cannot be taken faded whole, its reason with it.
// ---------------------------------------------------------------------------

const SHEETS = ["hud.css", "hud-ground.css", "hud-plaque.css", "hud-first-open.css", "hud-notices.css"] as const;

interface StyleRule {
  readonly sheet: string;
  readonly selectors: readonly string[];
  /** Each declaration as "property: value", its spaces single. */
  readonly declarations: readonly string[];
}

/** The pieces of `text` between each `at` that stands outside brackets, trimmed, their spaces single. */
function splitOutside(text: string, at: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === at && depth === 0) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  parts.push(part);
  return parts.map((one) => one.trim().replace(/\s+/gu, " ")).filter((one) => one !== "");
}

/** Every style rule of a stylesheet, in order. A media query's rules are listed as its own; keyframes are passed over. */
function styleRules(sheet: string, css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules: StyleRule[] = [];
  let head = "";
  let selectors: readonly string[] = [];
  let body: string | null = null;
  let passingOver = 0;
  for (const char of text) {
    if (passingOver > 0) {
      if (char === "{") passingOver += 1;
      if (char === "}") passingOver -= 1;
    } else if (body !== null) {
      if (char === "}") {
        rules.push({ sheet, selectors, declarations: splitOutside(body, ";") });
        body = null;
      } else body += char;
    } else if (char === "{") {
      const prelude = head.trim();
      head = "";
      if (prelude.startsWith("@keyframes")) passingOver = 1;
      else if (!prelude.startsWith("@")) {
        selectors = splitOutside(prelude, ",");
        body = "";
      }
      // Any other at-rule only holds rules: its own braces are stepped through.
    } else if (char === "}" || char === ";") head = "";
    else head += char;
  }
  return rules;
}

async function rulesOf(path: string, sheet: string): Promise<StyleRule[]> {
  return styleRules(sheet, await readFile(resolve(path), "utf-8"));
}

async function hudRules(): Promise<StyleRule[]> {
  const read = await Promise.all(SHEETS.map((sheet) => rulesOf(`src/components/planner-hud/${sheet}`, sheet)));
  return read.flat();
}

/** What a rule sets a property to, or null. */
function set(rule: StyleRule | undefined, property: string): string | null {
  const found = rule?.declarations.find((one) => one.startsWith(`${property}:`));
  return found === undefined ? null : found.slice(property.length + 1).trim();
}

/** The rule with exactly these selectors, in this order. */
function ruleFor(rules: readonly StyleRule[], ...selectors: readonly string[]): StyleRule | undefined {
  return rules.find((rule) => rule.selectors.length === selectors.length && rule.selectors.every((one, index) => one === selectors[index]));
}

/** Where a rule stands in its stylesheet; -1 where it is not there. */
function placeOf(rules: readonly StyleRule[], rule: StyleRule | undefined): number {
  return rule === undefined ? -1 : rules.indexOf(rule);
}

const INK_RING = "var(--hud-chosen) solid var(--hud-ink)";

describe("the keyboard's ring under the HUD", () => {
  it("is the app's one ring, which the app draws from three tokens on every stop in the Tab order", async () => {
    const app = await rulesOf("src/global.css", "global.css");
    const ring = app.find((rule) => rule.selectors.includes('[tabindex]:not([tabindex="-1"]):focus-visible'));
    // The app's rule names a key that is a stop in the Tab order with more weight than a ring of the screen's own…
    expect(ring?.selectors ?? []).toContain("button:focus-visible");
    // …and draws from these. A screen that sets them is drawn its own ring, whichever rule wins.
    expect(set(ring, "outline")).toBe("var(--vv-focus-ring)");
    expect(set(ring, "outline-offset")).toBe("var(--vv-focus-ring-offset)");
    expect(set(ring, "box-shadow")).toBe("var(--vv-focus-halo)");
  });

  it("is told what to be on each of the screen's two grounds: the ink of the ground, clear of the key", async () => {
    const rules = await rulesOf("src/components/planner-hud/hud.css", "hud.css");
    const both = ruleFor(rules, ".hud-root .hud-bar", ".hud-root .hud-shelf");
    expect(both?.declarations ?? []).toEqual([
      `--vv-focus-ring: ${INK_RING}`,
      "--vv-focus-ring-offset: var(--hud-chosen)",
      "--vv-focus-halo: none",
    ]);
    // On the bar itself, not handed down from the screen: the bar's ink is the night's, and a token is worked out
    // where it is set. Set once on the screen, the bar's ring would be the shelf's dark ink on the night.
    expect(set(ruleFor(rules, ".hud-bar"), "--hud-ink")).toBe("var(--hud-night-ink)");
    expect(rules.filter((rule) => rule.selectors.includes(".hud-root") && set(rule, "--vv-focus-ring") !== null)).toEqual([]);
    // The bar's keys reach the screen's edges: their ring is drawn inside them. Said after the rule above, which it
    // outweighs by its place alone.
    const bar = ruleFor(rules, ".hud-root .hud-bar");
    expect(bar?.declarations ?? []).toEqual(["--vv-focus-ring-offset: calc(-1 * var(--hud-chosen))"]);
    expect(placeOf(rules, both)).toBeGreaterThanOrEqual(0);
    expect(placeOf(rules, bar)).toBeGreaterThan(placeOf(rules, both));
  });

  it("is the same ring on whatever else takes the keyboard there", async () => {
    const rules = await rulesOf("src/components/planner-hud/hud.css", "hud.css");
    const rest = ruleFor(rules, ".hud-root :where(.hud-bar, .hud-shelf) :focus-visible");
    expect(set(rest, "outline")).toBe("var(--vv-focus-ring)");
    expect(set(rest, "outline-offset")).toBe("var(--vv-focus-ring-offset)");
  });

  it("is the only thing a key's own outline is used for", async () => {
    const rules = await hudRules();
    // A part of a key may be outlined (a cloth's sample, a card's photograph); the key itself, never: its outline
    // is where the ring is drawn, and a second use would hide one or the other.
    const isAPart = (selector: string): boolean => /::(?:before|after)$/u.test(selector) || selector.endsWith(" .hud-card__art");
    const onAKey = rules
      .filter((rule) => set(rule, "outline") !== null || set(rule, "outline-offset") !== null)
      .filter((rule) => !rule.selectors.every(isAPart))
      .map((rule) => `${rule.selectors.join(", ")} { outline: ${set(rule, "outline") ?? "(unset)"} }`);
    expect(onAKey).toEqual([
      ".hud-root :where(.hud-bar, .hud-shelf) :focus-visible { outline: var(--vv-focus-ring) }",
      // A sheet's title takes focus to hand the keyboard on, and is not a key.
      ".hud-root .hud-sheet__title:focus-visible { outline: none }",
    ]);
  });

  it("leaves what is chosen in sight under it: a chosen key is framed by a part of its own", async () => {
    const rules = await rulesOf("src/components/planner-hud/hud.css", "hud.css");
    const frame = ruleFor(rules, '.hud-key[aria-pressed="true"]::after', '.hud-choice[aria-checked="true"]::after');
    expect(set(frame, "border")).toBe(INK_RING);
    // Just inside the key's edge, over its hairline, where the outline it replaces was drawn.
    expect(set(frame, "position")).toBe("absolute");
    expect(set(frame, "inset")).toBe("calc(-1 * var(--hud-hair))");
    expect(set(frame, "content")).toBe('""');
    // A press on the frame is a press on the key.
    expect(set(frame, "pointer-events")).toBe("none");
    expect(set(ruleFor(rules, ".hud-key"), "position")).toBe("relative");
    expect(set(ruleFor(rules, ".hud-choice"), "position")).toBe("relative");
  });
});

describe("the HUD's stylesheets keep to the screen", () => {
  it("begin every rule at the screen, at the plaque's own menu and tooltips, or at the page while a card is dragged", async () => {
    const rules = await hudRules();
    const begins = [/^\.hud-/u, /^body:has\(\.hud-root\) (?:\.pc-|:is\(\.pc-)/u, /^body\.hud-dragging-card(?: \*)?$/u];
    const elsewhere = rules.flatMap((rule) => rule.selectors.filter((selector) => !begins.some((begin) => begin.test(selector))).map((selector) => `${rule.sheet}: ${selector}`));
    expect(elsewhere).toEqual([]);
  });

  it("reach every key only on the screen's two surfaces, and never the room between them", async () => {
    const rules = await hudRules();
    // A rule that starts at the screen and then names no part of it reaches everything under it, the scene's own
    // keys in the room included. (The first step after the screen must name a class: a surface, or a part.)
    const afterTheScreen = (selector: string): string | null => /^\.hud-root(?:\[[^\]]*\])? (\S+(?:\([^)]*\))?)/u.exec(selector)?.[1] ?? null;
    const everywhere = rules.flatMap((rule) => rule.selectors.filter((selector) => {
      const next = afterTheScreen(selector);
      return next !== null && !next.includes(".");
    }));
    expect(everywhere).toEqual([]);

    // The rules for every key go by the two surfaces, through :where, which adds nothing to their weight.
    const all = rules.flatMap((rule) => rule.selectors);
    for (const reach of [":where(button, input)", ":focus-visible", ":is(button, input):disabled", '[aria-disabled="true"]']) {
      expect(all).toContain(`.hud-root :where(.hud-bar, .hud-shelf) ${reach}`);
    }
  });

  it("change only the pointer and the selection across the whole page, and only while a card is dragged", async () => {
    const rules = await hudRules();
    const dragging = ruleFor(rules, "body.hud-dragging-card", "body.hud-dragging-card *");
    expect((dragging?.declarations ?? []).map((one) => one.split(":")[0])).toEqual(["cursor", "user-select"]);
  });
});

describe("a choice that cannot be taken now", () => {
  it("keeps its reason at full strength: the choice does not fade, and only its name stands back", async () => {
    const rules = await rulesOf("src/components/planner-hud/hud.css", "hud.css");
    // Other keys fade whole while there is nothing for them to do…
    const fade = ruleFor(rules, ".hud-root :where(.hud-bar, .hud-shelf) :is(button, input):disabled", '.hud-root :where(.hud-bar, .hud-shelf) [aria-disabled="true"]');
    expect(set(fade, "opacity")).toBe("var(--hud-off)");
    // …and a choice does not, by a rule that outweighs that one (the screen, the choice and what it says of itself).
    expect(set(ruleFor(rules, '.hud-root .hud-choice[aria-disabled="true"]'), "opacity")).toBe("1");
    // Its name stands back as far as a faded key does, by its colour.
    expect(set(ruleFor(rules, '.hud-choice[aria-disabled="true"] .hud-choice__name'), "color")).toBe("color-mix(in srgb, var(--hud-ink) calc(var(--hud-off) * 100%), transparent)");
    // And no rule touches the reason under it.
    expect(rules.flatMap((rule) => rule.selectors).filter((selector) => selector.includes("aria-disabled") && selector.includes(".hud-choice__line"))).toEqual([]);
  });
});
