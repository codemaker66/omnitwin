import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The new chrome's clear-all keeps the fold's laws (T-680 spec 8, in T-671's
// chrome): transform and opacity only, no blur or filter, motion only while
// the chrome is cleared or coming back, the crest left standing, what says
// what is safe never hidden, and reduced motion a short fade. happy-dom draws
// no CSS, so these read the text the browser will.
// ---------------------------------------------------------------------------

let fold = "";
let slate = "";

beforeAll(async () => {
  fold = await readFile(resolve("src/components/planner-chrome/fold.css"), "utf8");
  slate = await readFile(resolve("src/components/planner-chrome/slate.css"), "utf8");
});

/** The stylesheet without its comments, so a rule's words in prose never count. */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Every rule, at any depth: the innermost `selector { body }` pairs. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const match of code(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    out.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return out;
}

function hides(rule: Rule): boolean {
  return /(?:^|;|\s)opacity:\s*0\s*(?:;|$)/u.test(rule.body) || /visibility:\s*hidden/u.test(rule.body);
}

const LEAVING_ZONES = ["top-centre", "utilities", "left", "right", "dock", "next-step"] as const;

describe("the new chrome's clear-all CSS", () => {
  it("no blur, filter or transform: movement is translate and scale", () => {
    const text = code(fold);
    expect(text).not.toMatch(/(?:^|[^-])filter\s*:/mu);
    expect(text).not.toMatch(/blur\(/u);
    expect(text).not.toMatch(/(?:^|[\s;{])transform\s*:/mu);
    expect(text).toMatch(/translate:\s*-12px 0/u);
    expect(text).toMatch(/translate:\s*12px 0/u);
    expect(text).toMatch(/translate:\s*0 -12px/u);
    expect(text).toMatch(/translate:\s*0 12px/u);
    expect(text).toMatch(/scale:\s*0\.96/u);
  });

  it("moves only while the chrome is cleared or coming back", () => {
    for (const rule of rules(fold)) {
      if (!/translate|scale|transition/u.test(rule.body)) continue;
      if (rule.selector.startsWith(".pc-crest-note")) continue;
      expect(rule.selector, rule.selector).toMatch(/html\[data-planner-chrome(?:-motion)?/u);
    }
  });

  it("every zone but the slate and the line above the dock leaves, toward its own edge", () => {
    const cleared = rules(fold).filter((rule) => rule.selector.startsWith('html[data-planner-chrome="cleared"]'));
    const leaving = cleared.find((rule) => hides(rule) && rule.selector.includes(".pc-zone--dock"));
    expect(leaving).toBeDefined();
    for (const zone of LEAVING_ZONES) expect(leaving?.selector, zone).toContain(`.pc-zone--${zone}`);
    expect(leaving?.selector).not.toContain(".pc-zone--slate");
    expect(leaving?.selector).not.toContain(".pc-zone--above-dock");
    const edge = (zone: string): string => cleared.find((rule) => rule.selector.includes(`.pc-zone--${zone}`) && /translate:/u.test(rule.body))?.body ?? "";
    expect(edge("top-centre")).toMatch(/translate:\s*0 -12px/u);
    expect(edge("utilities")).toMatch(/translate:\s*0 -12px/u);
    expect(edge("left")).toMatch(/translate:\s*-12px 0/u);
    expect(edge("right")).toMatch(/translate:\s*12px 0/u);
    expect(edge("dock")).toMatch(/translate:\s*0 12px/u);
    expect(edge("next-step")).toMatch(/translate:\s*0 12px/u);
  });

  it("makes what has gone unreachable once it has gone, and reachable at once when it comes back", () => {
    for (const rule of rules(fold).filter((entry) => entry.selector.startsWith('html[data-planner-chrome="cleared"]') && /visibility:\s*hidden/u.test(entry.body))) {
      expect(rule.body, rule.selector).toMatch(/visibility 0s linear var\(--pc-fold-out\)/u);
    }
    for (const rule of rules(fold).filter((entry) => entry.selector.startsWith('html[data-planner-chrome="restoring"]'))) {
      expect(rule.body, rule.selector).toMatch(/visibility 0s linear 0s/u);
    }
  });

  it("never hides what says what is safe: the slate's notice, a receipt, the door notice's voice", () => {
    for (const rule of rules(fold).filter(hides)) {
      expect(rule.selector, rule.selector).not.toMatch(/pc-slate__notice|pc-receipt|pc-zone--above-dock|door-clear-notice/u);
      // Nor the slate whole, which holds its notice: only its plate's words and its plane go.
      for (const selector of rule.selector.split(",").map((part) => part.trim())) {
        expect(selector).not.toMatch(/\.pc-slate\s*$|\.pc-slate\s*>\s*\*\s*$|\.pc-zone--slate\s*>\s*\*\s*$/u);
      }
    }
    // Above the dock, only an opted-in surface (the door notice's card) goes.
    expect(rules(fold).some((rule) => hides(rule) && rule.selector.includes("[data-chrome-surface]"))).toBe(true);
  });

  it("leaves the crest standing on a plate that has gone", () => {
    const plate = rules(fold).find((rule) => rule.selector === 'html[data-planner-chrome="cleared"] .pc-slate__plate');
    expect(plate?.body).toMatch(/visibility:\s*hidden/u);
    expect(plate?.body).toMatch(/--pc-plate-presence:\s*0%/u);
    const words = rules(fold).find((rule) => rule.selector.includes(".pc-slate__plate > :not(.pc-slate__crest-seat)") && hides(rule));
    expect(words).toBeDefined();
    const seat = rules(fold).find((rule) => rule.selector === 'html[data-planner-chrome="cleared"] .pc-slate__crest-seat');
    expect(seat?.body).toMatch(/visibility:\s*visible/u);
  });

  it("fades the lacquer through a registered figure, and is the plate's own lacquer at rest", () => {
    expect(fold).toMatch(/@property --pc-plate-presence\s*\{[^}]*syntax:\s*"<percentage>";[^}]*initial-value:\s*100%;/u);
    for (const rule of rules(fold).filter((entry) => entry.body.includes("var(--pc-plate-presence)"))) {
      expect(rule.selector).toMatch(/^html\[data-planner-chrome\]/u);
    }
  });

  it("is instant from the keyboard", () => {
    const instant = rules(fold).find((rule) => rule.selector.startsWith('html[data-planner-chrome-motion="instant"][data-planner-chrome]'));
    expect(instant?.body).toMatch(/transition:\s*none/u);
    for (const part of [".pc-zone > *", ".pc-slate__plate", ".pc-slate > .pc-plane", "[data-chrome-surface]"]) {
      expect(instant?.selector, part).toContain(part);
    }
  });

  it("keeps a 120 ms fade and no movement under reduced motion", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/u.exec(code(fold))?.[1] ?? "";
    expect(reduced).toMatch(/--pc-fold-out:\s*120ms/u);
    expect(reduced).toMatch(/--pc-fold-in:\s*120ms/u);
    expect(reduced).toMatch(/translate:\s*none/u);
    expect(reduced).toMatch(/scale:\s*none/u);
  });

  it("gives the crest a 36 px press, 44 px for a finger, without moving the plate's words", () => {
    const button = rules(slate).find((rule) => rule.selector === ".pc-slate__crest");
    expect(button?.body).toMatch(/width:\s*36px/u);
    expect(button?.body).toMatch(/margin:\s*-3px/u);
    const finger = /@media \(pointer: coarse\)\s*\{\s*\.pc-slate__crest\s*\{([^}]*)\}/u.exec(code(slate))?.[1] ?? "";
    expect(finger).toMatch(/width:\s*44px/u);
    expect(finger).toMatch(/margin:\s*-7px/u);
  });
});
