import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// T-635 N1 — the grep gates of the calm foundation's acceptance.
//
// The cyan focus ring was replaced by the house ring (copper on ivory, cream
// on the dark grounds), the dead status chip was deleted, and the staff
// surfaces set their words in Newsreader and Inter. None of the three may
// come back. Georgia may still stand after Newsreader in a font stack; what
// is gated is Georgia named first, outside the voices that keep their own
// type until their redesigns (the planner, question 4; the Trades House
// campaign, its quiz and leaflet, questions 11 and 15; the internal demo and
// visual tools; the twin, held for the 3D batch).
// ---------------------------------------------------------------------------

const OWN_TYPE_UNTIL_REDESIGN = [
  /^App\.css$/,
  /^components\/editor\//,
  /^components\/PlacementHint\.tsx$/,
  /^features\/trades-house\//,
  /^pages\/TradesHouse[A-Za-z]*\.(?:tsx|css)$/,
  /^pages\/TradesHallVisualPage\.(?:tsx|css)$/,
  /^pages\/demo\//,
  /^twin\//,
];

async function sourceFiles(): Promise<readonly (readonly [string, string])[]> {
  const root = resolve("src");
  const out: (readonly [string, string])[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") await walk(full);
      } else if (/\.(?:css|tsx?)$/.test(entry.name)) {
        out.push([full.slice(root.length + 1).replaceAll("\\", "/"), await readFile(full, "utf-8")]);
      }
    }
  }
  await walk(root);
  return out;
}

/** Georgia named as the first family, in a stylesheet or an inline style. */
const GEORGIA_FIRST = [
  /font-family\s*:\s*["']?Georgia\b/i,
  /\bfont\s*:[^;{}]*?\d(?:px|rem|em|%)?(?:\s*\/\s*[\d.]+(?:px|rem|em)?)?\s+["']?Georgia\b/i,
  /fontFamily\s*:\s*["'`]\s*["']?Georgia\b/,
];

describe("N1 grep gates", () => {
  it("has no cyan focus ring anywhere", async () => {
    const offenders = (await sourceFiles())
      .filter(([, text]) => /#87e7f0|135\s*,\s*231\s*,\s*240/i.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("has no status chip left over from the old grammar", async () => {
    const offenders = (await sourceFiles()).filter(([, text]) => text.includes("vv-status-chip")).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("names Georgia first only in the voices that keep their own type until their redesigns", async () => {
    const offenders = (await sourceFiles())
      .filter(([path]) => !OWN_TYPE_UNTIL_REDESIGN.some((rule) => rule.test(path)))
      .filter(([, text]) => GEORGIA_FIRST.some((rule) => rule.test(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("sets the working capsule in the house sans, not a monospace", async () => {
    const css = await readFile(resolve("src/components/shared/Activity.css"), "utf-8");
    const panel = /\.vv-activity-status--panel\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(panel).toContain("font-family: var(--house-sans);");
    expect(panel).not.toMatch(/monospace/u);
  });

  it("recognises Georgia named first, and not Georgia standing after Newsreader", () => {
    expect(GEORGIA_FIRST.some((rule) => rule.test("font-family: Georgia, serif;"))).toBe(true);
    expect(GEORGIA_FIRST.some((rule) => rule.test("font: 600 24px/1.08 Georgia, serif;"))).toBe(true);
    expect(GEORGIA_FIRST.some((rule) => rule.test('fontFamily: "Georgia, \\"Times New Roman\\", serif"'))).toBe(true);
    expect(GEORGIA_FIRST.some((rule) => rule.test('--house-serif: "Newsreader", Georgia, "Times New Roman", serif;'))).toBe(false);
    expect(GEORGIA_FIRST.some((rule) => rule.test("font-family: var(--house-serif);"))).toBe(false);
  });
});
