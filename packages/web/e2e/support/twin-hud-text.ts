import { expect, type ElementHandle, type Locator, type Page } from "@playwright/test";
import {
  STAT_LABEL_CEILING,
  STAT_LABEL_DIMENSIONS,
  STAT_LABEL_DINNER,
  STAT_LABEL_RECEPTION,
} from "../../src/twin/shell/room-dossier-copy.js";
import {
  lookUpRoom,
  metres,
  VERIFIED_ROOM_NODES,
  type VerifiedRoom,
} from "../../src/twin/shell/twin-rooms.js";

// ---------------------------------------------------------------------------
// The tour HUD's words and figures, read as TEXT (T-758).
//
// WHY THIS EXISTS. A screenshot baseline cannot hold a figure. The twin-visual
// comparison passed all three rooms baselines with a room's size deleted from
// its line: the change moved 237 pixels in a 72 x 8 box, pixelmatch counted 89
// of them (its anti-alias detection drops edge pixels outright, whatever the
// threshold), and the budget was 648 pixels at 1440 x 900 and 164 at the phone
// sizes. At 844 x 390 the row was below the panel's fold and moved no pixel at
// all. So the rule, from the release lead: a screenshot baseline is never the
// only proof of a figure or a word. Every figure and word the baselines show is
// asserted here as DOM text, built from the source the UI renders.
//
// WHAT "TEXT" MEANS HERE. The text nodes inside an element, joined as
// textContent joins them, with runs of ASCII whitespace collapsed, leaving out
// only decorative glyphs: a text node under an aria-hidden subtree that holds
// no letter and no digit (the Surface arrow, the close cross, the dossier's
// fold sign). aria-hidden text that holds a letter or a digit is read like any
// other. aria-hidden says what a screen reader hears, not what is drawn: the
// measure tool draws its headline figure aria-hidden so that it is not heard
// twice, and it is still a figure. U+00A0 is NOT collapsed: the room lines hold
// a figure to its unit with it, and a line that lost it would wrap inside a
// figure, so it is compared byte for byte.
//
// WHAT THE SWEEP BELOW CANNOT READ, and what stands guard instead. Text that is
// not a text node in the light DOM: CSS generated content (::before and ::after
// are checked, and any that holds a letter or a digit fails the sweep; ::marker
// and counters in list markers are not checked), text inside a shadow root or an
// iframe (the sweep fails if the page holds either), form-control values and
// placeholders (no control is open in these states), canvas text (every canvas
// is hidden in twin-visual) and text drawn inside images.
// ---------------------------------------------------------------------------

/** U+00A0, written as an escape: the room list holds each floor together with it. */
export const NO_BREAK_SPACE = "\u00a0";
/** The room list's separator between figures, the plan's times sign, and the
 *  dash that joins a ceiling height to what it is measured to. */
const MIDDLE_DOT = "\u00b7";
const TIMES = "\u00d7";
const EM_DASH = "\u2014";

/**
 * A room's line in the Rooms panel, rebuilt from venue truth without the
 * formatter the panel uses (formatRoomComparison): the two capacities, then
 * each floor the room shows a size for. A room with no size on record is its
 * capacities alone. It shares two helpers with the panel, lookUpRoom (the
 * door to venue truth) and metres() (the rounding), and nothing else, so the
 * composition (order, separators, no-break spaces, which floors) cannot pass
 * by being the same code. metres() is pinned by literal outputs in
 * twin-rooms.test.ts.
 */
export function expectedRoomLine(slug: string): string {
  const nodeId = Object.keys(VERIFIED_ROOM_NODES).find((id) => VERIFIED_ROOM_NODES[id] === slug);
  const room = nodeId === undefined ? null : lookUpRoom(nodeId);
  if (room === null) throw new Error(`${slug} has no validated viewpoint to read its figures at.`);
  const head = `${String(room.capacities.reception)} standing ${MIDDLE_DOT} ${String(room.capacities.dinner)} seated`;
  const floors = (room.dimensions?.extents ?? []).map((extent) => {
    const plan = `${metres(extent.lengthM)} ${TIMES} ${metres(extent.widthM)} m`;
    const named = extent.section === undefined ? plan : `${extent.section} ${plan}`;
    return named.split(" ").join(NO_BREAK_SPACE);
  });
  return floors.length === 0
    ? head
    : `${head} ${MIDDLE_DOT} ${floors.join(` and${NO_BREAK_SPACE}`)}`;
}

/** One of the dossier's stats as a visitor reads it: the label, then a line
 *  per value (one for a room given as a whole, one per published section). */
export interface ExpectedStat {
  readonly label: string;
  readonly lines: readonly string[];
}

/**
 * The dossier's stats for a room, in the order it shows them, rebuilt from
 * venue truth rather than through RoomDossier's own composition: Dimensions
 * when the room shows a size, then the two capacities, then Ceiling when a
 * height is published. A section's name leads its line; a height's qualifier
 * follows it after a spaced em dash.
 */
export function expectedDossierStats(room: VerifiedRoom): readonly ExpectedStat[] {
  const extents = room.dimensions?.extents ?? [];
  const named = (section: string | undefined, value: string): string =>
    section === undefined ? value : `${section} ${value}`;
  const stats: ExpectedStat[] = [];
  if (extents.length > 0) {
    stats.push({
      label: STAT_LABEL_DIMENSIONS,
      lines: extents.map((extent) =>
        named(extent.section, `${metres(extent.lengthM)} ${TIMES} ${metres(extent.widthM)} m`),
      ),
    });
  }
  stats.push({ label: STAT_LABEL_RECEPTION, lines: [`${String(room.capacities.reception)} standing`] });
  stats.push({ label: STAT_LABEL_DINNER, lines: [`${String(room.capacities.dinner)} seated`] });
  const ceilings = extents.flatMap((extent) => {
    if (extent.heightM === undefined) return [];
    const height = named(extent.section, `${metres(extent.heightM)} m`);
    return [extent.note === undefined ? height : `${height} ${EM_DASH} ${extent.note}`];
  });
  if (ceilings.length > 0) {
    stats.push({ label: STAT_LABEL_CEILING, lines: ceilings });
  }
  return stats;
}

/**
 * Every assertion the ledger makes reads text through this, in the page.
 * Kept as one function so "the text of an element" has one meaning in this
 * file.
 */
function readTextOf(elements: Element[]): string[] {
  return elements.map((element) => {
    let text = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.nodeValue ?? "";
      // A decorative glyph: hidden from screen readers AND holding no letter
      // and no digit. aria-hidden text that holds either is still read.
      const hidden = (node.parentElement?.closest('[aria-hidden="true"]') ?? null) !== null;
      if (hidden && !/[\p{L}\p{N}]/u.test(value)) continue;
      text += value;
    }
    return text.replace(/[ \t\n\r\f]+/gu, " ").trim();
  });
}

/**
 * Asserts the text of each HUD surface, then proves nothing drawn was left out.
 *
 * The second half is the point. A list of assertions written by hand is
 * complete only on the day it is written: the next label added to the HUD
 * would be pinned by the screenshot alone, which is the exact gap this closes.
 * So after the surfaces are asserted, `expectNothingElse` walks every text node
 * the page draws and fails on any that no assertion covered. Drawn means:
 * rendered (checkVisibility with opacity and visibility), not inside
 * `.vv-sr-only` (global.css's screen-reader-only class, the HUD's only way of
 * hiding text from sight), and not a decorative glyph as defined at the top of
 * this file. A row scrolled below a panel's fold is still drawn, and still has
 * to be asserted, although no screenshot of the frame can show it. The sweep
 * also fails on generated content that holds a letter or a digit, and on any
 * shadow root or iframe, whose text it could not read.
 */
export class HudTextLedger {
  private readonly covered: ElementHandle[] = [];

  constructor(private readonly page: Page) {}

  /** Each element the locator matches holds exactly this text, in order. */
  async expectText(locator: Locator, expected: string | readonly string[], what: string): Promise<void> {
    const lines = typeof expected === "string" ? [expected] : expected;
    await expect(locator, `${what}: element count`).toHaveCount(lines.length);
    expect(await locator.evaluateAll(readTextOf), what).toEqual(lines);
    this.covered.push(...(await locator.elementHandles()));
  }

  /** No drawn text sits outside every element an assertion has covered. */
  async expectNothingElse(): Promise<void> {
    const uncovered = await this.page.evaluate((owners: Node[]) => {
      const asserted = new Set<Node>(owners);
      const meaningful = /[\p{L}\p{N}]/u;
      const drawn = (element: Element): boolean =>
        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const name = (element: Element): string =>
        [element.tagName.toLowerCase(), ...element.classList].join(".");
      const found: string[] = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.nodeValue ?? "").replace(/[ \t\n\r\f]+/gu, " ").trim();
        const parent = node.parentElement;
        if (text === "" || parent === null) continue;
        if (parent.closest("script, style, noscript, template") !== null) continue;
        // Decorative glyphs only; aria-hidden text with a letter or digit counts.
        if (parent.closest('[aria-hidden="true"]') !== null && !meaningful.test(text)) continue;
        // Screen-reader text (global.css). The class, not a size heuristic: a
        // box's clip does not reach a positioned descendant it does not contain.
        if (parent.closest(".vv-sr-only") !== null) continue;
        if (!drawn(parent)) continue;
        let owned = false;
        for (let at: Element | null = parent; at !== null && !owned; at = at.parentElement) {
          owned = asserted.has(at);
        }
        if (!owned) found.push(text);
      }

      // Drawn text that is not a light-DOM text node, which the walk cannot read.
      for (const element of document.body.querySelectorAll("*")) {
        if (element.shadowRoot !== null) found.push(`a shadow root on ${name(element)}`);
        if (element.tagName === "IFRAME") found.push(`an iframe: ${name(element)}`);
        if (!drawn(element)) continue;
        for (const pseudo of ["::before", "::after"]) {
          const content = getComputedStyle(element, pseudo).content.replace(/url\([^)]*\)/gu, "");
          if (content !== "none" && content !== "normal" && meaningful.test(content)) {
            found.push(`${pseudo} content on ${name(element)}: ${content}`);
          }
        }
      }
      return found;
    }, this.covered);
    await Promise.all(this.covered.map((handle) => handle.dispose()));
    this.covered.length = 0;
    expect(uncovered, "every word and figure the page draws must be asserted as text").toEqual([]);
  }
}
