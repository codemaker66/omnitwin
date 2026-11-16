import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// The planner HUD stays behind its flag, in the bundle that is built (T-723).
//
// bundle-splitting.test.ts holds the flag from the sources: what imports what.
// A source cannot say what the bundler made of it. This reads the files a
// browser is sent, which exist only after a build (dist/), and asks of them
// what the release lead's ruling asks: a visitor who has not asked for the HUD
// is sent none of it, and nothing more because of it.
//
// The build is walked twice from the page's own scripts. Once through every
// import, on demand or not, EXCEPT the three imports on demand that a flag asks
// for: that is what a visitor with no flag can be sent. Once through every
// import there is: what is reached only the second time goes to a flag alone.
// No file is known by its name but the three a flag asks for, so the bundler is
// free to gather what the flags share however it likes.
//
// 1. Each of the three is asked for on demand, and never imported outright.
// 2. No file sent without a flag holds the HUD's own words (its root, shelf,
//    sheets, first screen), nor the room's frame the two new chromes share.
// 3. No file sent without a flag holds what the HUD was once the first to read
//    from shared modules: the setup cards' picture rule and the spring the
//    stage squares up on. Both were found in files everyone fetches on
//    14 Nov 2026, by building this branch and master from one tree, and must
//    be found only in files a flag fetches.
//
// What this cannot do is compare with master: it sees one build. That
// comparison (no module the branch did not edit may render differently) is run
// by hand, and its reading is in docs/sessions/2026-11-13.md.
//
// dist/ may be absent locally, or older than the HUD: then these skip. CI's
// Build job builds and then runs this file with REQUIRE_WEB_DIST=1, where a
// missing build fails instead (as twin-chunk-budget.test.ts).
// -----------------------------------------------------------------------------

const DIST = resolve("dist");
const ASSETS = resolve("dist/assets");
const REQUIRE_WEB_DIST = process.env["REQUIRE_WEB_DIST"] === "1";

/** The files a flag's own import on demand asks for, by the names the build gives them: the HUD's screen, its parts of the room's scene, and the other new chrome. */
const FLAG_ENTRIES: readonly string[] = ["PlannerHud", "hud-scene", "PlannerChromeV2"];
/** Words only the HUD's own code holds. */
const HUD_WORDS: readonly string[] = ["hud-root", "hud-shelf", "hud-sheet", "hud-first-open", "planner-hud"];
/** A word only the room's frame holds, which the two new chromes share (planner-chrome/RoomStage.tsx): wherever the bundler puts it, it goes to a flag alone. */
const SHARED_FRAME_WORD = "planner-room-stage";
/** What the HUD was once the first production reader of, as the minifier leaves each. */
const ONCE_SHARED: readonly { readonly what: string; readonly text: string }[] = [
  { what: "the setup cards' picture rule", text: "/models/furniture/setup-" },
  { what: "the spring the stage squares up on", text: "stiffness:300,damping:30" },
];
/** The vendor files the build's own configuration names (vite.config.ts, manualChunks). */
const VENDOR: readonly string[] = ["react-vendor", "three", "three-webgpu", "clerk"];

/** A built file's name without its hash and ending: "hud-scene-DqQUCszP.js" is "hud-scene". */
function plainName(file: string): string {
  return file.replace(/\.(?:js|css)$/u, "").replace(/-[\w-]{8}$/u, "");
}

function built(ending: ".js" | ".css"): readonly string[] {
  return existsSync(ASSETS) ? readdirSync(ASSETS).filter((name) => name.endsWith(ending)) : [];
}

const scripts = built(".js");
const hasHudBuild = existsSync(resolve(DIST, "index.html")) && scripts.some((file) => plainName(file) === "PlannerHud");

function read(file: string): string {
  return readFileSync(resolve(ASSETS, file), "utf-8");
}

// `import ... from "./x.js"`, `import "./x.js"` and `export ... from "./x.js"`: each fetches x with the file it is in.
const IMPORTED = /(?:import|export)\s*(?:(?:\{[^}]*\}|\*\s*as\s*[\w$]+|\*|[\w$]+)\s*from\s*)?["']\.\/([^"']+\.js)["']/g;
const ON_DEMAND = /import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g;

interface Walk {
  readonly files: ReadonlySet<string>;
  /** A file walked that imports one of the three outright. */
  readonly outright: readonly string[];
  /** Which file walked asks for which of the three on demand (where those are not followed). */
  readonly asks: readonly string[];
}

/** From the page's own scripts through every import; the three a flag asks for on demand are followed only if told to. */
function walk(intoFlags: boolean): Walk {
  const page = readFileSync(resolve(DIST, "index.html"), "utf-8");
  const pending = Array.from(page.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g), (match) => match[1] ?? "");
  const files = new Set<string>();
  const outright: string[] = [];
  const asks = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    const code = read(file);
    for (const match of code.matchAll(IMPORTED)) {
      const to = match[1] ?? "";
      if (FLAG_ENTRIES.includes(plainName(to))) outright.push(`${plainName(file)} imports ${plainName(to)}`);
      pending.push(to);
    }
    for (const match of code.matchAll(ON_DEMAND)) {
      const to = match[1] ?? "";
      if (!FLAG_ENTRIES.includes(plainName(to)) || intoFlags) pending.push(to);
      else asks.add(`${plainName(file)} asks for ${plainName(to)}`);
    }
  }
  return { files, outright, asks: [...asks].sort() };
}

interface Reach {
  /** Every script a visitor with no flag can be sent. */
  readonly reached: ReadonlySet<string>;
  /** Every script only a flag's own import on demand leads to: the three, and whatever they alone share. */
  readonly flagOnly: readonly string[];
  /** A file sent without a flag that imports one of the three outright: the flag defeated. */
  readonly outright: readonly string[];
  /** Which file sent without a flag asks for which of the three on demand. */
  readonly asks: readonly string[];
}

let found: Reach | null = null;
function reach(): Reach {
  if (found !== null) return found;
  const withoutAFlag = walk(false);
  const everything = walk(true);
  found = {
    reached: withoutAFlag.files,
    flagOnly: [...everything.files].filter((file) => !withoutAFlag.files.has(file)).sort(),
    outright: withoutAFlag.outright,
    asks: withoutAFlag.asks,
  };
  return found;
}

describe.runIf(REQUIRE_WEB_DIST)("the build this checks", () => {
  it("is there, with the HUD's own files in it", () => {
    expect(hasHudBuild, `no page or no PlannerHud file under ${DIST}`).toBe(true);
  });
});

describe("the planner HUD in the built bundle (T-723)", () => {
  it("names a built file without its hash", () => {
    expect(plainName("hud-scene-DqQUCszP.js")).toBe("hud-scene");
    expect(plainName("three-webgpu-B_k9-x2Q.js")).toBe("three-webgpu");
    expect(plainName("PlannerHud-C5TT8B8B.css")).toBe("PlannerHud");
    expect(plainName("cloth-geometry-DAUYs6la.js")).toBe("cloth-geometry");
  });

  it.skipIf(!hasHudBuild)("is asked for on demand, by files a visitor without a flag is sent, and by nothing outright", () => {
    const { reached, asks, outright } = reach();
    // The walk read the app: its entry, its planner and its vendor files (a wrong start would pass by reading nothing).
    expect(reached.size).toBeGreaterThan(100);
    for (const name of ["index", "EditorPage", "react-vendor", "three"]) expect([...reached].some((file) => plainName(file) === name), name).toBe(true);
    // Each of the three is asked for, and only on demand.
    const asked = [...new Set(asks.map((line) => line.slice(line.lastIndexOf(" ") + 1)))].sort();
    expect(asked, asks.join("; ")).toEqual([...FLAG_ENTRIES].sort());
    expect(outright).toEqual([]);
  });

  it.skipIf(!hasHudBuild)("sends a visitor without a flag none of the flag's files", () => {
    const { reached, flagOnly } = reach();
    expect([...reached].map(plainName).filter((name) => FLAG_ENTRIES.includes(name))).toEqual([]);
    // Each of the three is in the build once, and goes to a flag alone.
    for (const name of FLAG_ENTRIES) {
      expect(scripts.filter((file) => plainName(file) === name), name).toHaveLength(1);
      expect(flagOnly.map(plainName).includes(name), name).toBe(true);
    }
    // So does the room's frame the two new chromes share, wherever the bundler has put it.
    const frame = scripts.filter((file) => read(file).includes(SHARED_FRAME_WORD));
    expect(frame.length, "a file that holds the shared room frame").toBeGreaterThan(0);
    expect(frame.filter((file) => reached.has(file)).map(plainName)).toEqual([]);
  });

  it.skipIf(!hasHudBuild)("sends a visitor without a flag none of the HUD's own code", () => {
    const { reached } = reach();
    const held: string[] = [];
    for (const file of reached) {
      const code = read(file);
      for (const word of HUD_WORDS) if (code.includes(word)) held.push(`${plainName(file)} holds "${word}"`);
    }
    expect(held).toEqual([]);
    // The words are still the HUD's: its own file holds every one of them.
    const hud = read(scripts.find((file) => plainName(file) === "PlannerHud") ?? "");
    for (const word of HUD_WORDS) expect(hud.includes(word), word).toBe(true);
  });

  it.skipIf(!hasHudBuild)("keeps what it once made everyone fetch in files only a flag fetches", () => {
    const { reached, flagOnly } = reach();
    for (const { what, text } of ONCE_SHARED) {
      const sentToEveryone = [...reached].filter((file) => read(file).includes(text)).map(plainName);
      expect(sentToEveryone, what).toEqual([]);
      // Still written as this looks for it, in a file a flag fetches: or the check has gone blind.
      expect(flagOnly.some((file) => read(file).includes(text)), what).toBe(true);
    }
  });

  it.skipIf(!hasHudBuild)("keeps its stylesheet to itself", () => {
    const withHudRules = built(".css").filter((file) => readFileSync(resolve(ASSETS, file), "utf-8").includes(".hud-root")).map(plainName);
    expect(withHudRules).toEqual(["PlannerHud"]);
  });

  it.skipIf(!hasHudBuild)("brings no vendor file of its own", () => {
    const { reached, flagOnly } = reach();
    // The vendor files are the four the build's configuration names: one of each, all sent without a flag.
    for (const name of VENDOR) {
      const files = scripts.filter((file) => plainName(file) === name);
      expect(files, name).toHaveLength(1);
      expect(reached.has(files[0] ?? ""), name).toBe(true);
    }
    expect(flagOnly.map(plainName).filter((name) => VENDOR.includes(name))).toEqual([]);
  });
});
