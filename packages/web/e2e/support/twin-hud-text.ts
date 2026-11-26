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
// WHAT "TEXT" MEANS HERE. The text nodes inside an element that are not under
// an aria-hidden subtree, joined as textContent joins them, with runs of ASCII
// whitespace collapsed. aria-hidden is how this HUD marks its decorative glyphs
// (the Surface arrow, the close cross, the dossier's fold sign), and a glyph is
// neither a word nor a figure. U+00A0 is NOT collapsed: the room lines hold a
// figure to its unit with it, and a line that lost it would wrap inside a
// figure, so it is compared byte for byte.
// ---------------------------------------------------------------------------

/** U+00A0, written as an escape: the room list holds each floor together with it. */
export const NO_BREAK_SPACE = "\u00a0";
/** The room list's separator between figures, the plan's times sign, and the
 *  dash that joins a ceiling height to what it is measured to. */
const MIDDLE_DOT = "\u00b7";
const TIMES = "\u00d7";
const EM_DASH = "\u2014";

/**
 * A room's line in the Rooms panel, rebuilt from venue truth through
 * lookUpRoom and not through the formatter the panel uses, so the two cannot
 * agree by being the same code: the two capacities, then each floor the room
 * shows a size for. A room with no size on record is its capacities alone.
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
      if (node.parentElement?.closest('[aria-hidden="true"]') !== null) continue;
      text += node.nodeValue ?? "";
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
 * the page draws and fails on any that no assertion covered. Drawn means: not
 * under aria-hidden, rendered (checkVisibility with opacity and visibility),
 * and not clipped to a 1 px box the way `.vv-sr-only` hides screen-reader
 * text. A row scrolled below a panel's fold is still drawn, and still has to
 * be asserted, although no screenshot of the frame can show it.
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
      // `.vv-sr-only` (global.css) is a 1 px box that hides its overflow; a
      // drawn label is never that small.
      const clippedAway = (element: Element): boolean => {
        for (let at: Element | null = element; at !== null; at = at.parentElement) {
          const box = at.getBoundingClientRect();
          const style = getComputedStyle(at);
          const hides = style.overflowX === "hidden" || style.overflowY === "hidden";
          if ((box.width <= 1 || box.height <= 1) && hides) return true;
        }
        return false;
      };
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.nodeValue ?? "").replace(/[ \t\n\r\f]+/gu, " ").trim();
        const parent = node.parentElement;
        if (text === "" || parent === null) continue;
        if (parent.closest('[aria-hidden="true"], script, style, noscript, template') !== null) continue;
        if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        if (clippedAway(parent)) continue;
        let owned = false;
        for (let at: Element | null = parent; at !== null && !owned; at = at.parentElement) {
          owned = asserted.has(at);
        }
        if (!owned) found.push(text);
      }
      return found;
    }, this.covered);
    await Promise.all(this.covered.map((handle) => handle.dispose()));
    this.covered.length = 0;
    expect(uncovered, "every word and figure the page draws must be asserted as text").toEqual([]);
  }
}
