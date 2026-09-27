import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Every Diary label is at least 12 px (roadmap N3, readability). Contrast is
// measured where it can be, on the rendered board in the browser
// (e2e/diary-timetable.spec.ts); a size can be read off the sheet, so a
// label shrunk below 12 px fails here first.
//
// `font-size: 0` is not a label: it hides the phase band's words until the
// band is tall enough to carry them.
// ---------------------------------------------------------------------------

describe("the Diary sheet's type sizes", () => {
  it("sets no text below 12 px", async () => {
    const css = await readFile(resolve("src/pages/diary/diary-board.css"), "utf-8");
    const small: string[] = [];
    for (const rule of css.split("}")) {
      const selector = rule.split("{")[0]?.trim().replace(/\s+/gu, " ") ?? "";
      for (const match of rule.matchAll(/font(?:-size)?\s*:\s*([^;]*)/gu)) {
        for (const size of (match[1] ?? "").matchAll(/(\d+(?:\.\d+)?)px/gu)) {
          const px = Number(size[1]);
          if (px > 0 && px < 12) small.push(`${selector.slice(-60)}: ${String(px)}px`);
        }
      }
    }
    expect(small).toEqual([]);
  });
});
