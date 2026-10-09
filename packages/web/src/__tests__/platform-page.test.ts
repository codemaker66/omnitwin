import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// /platform is a static page outside the app bundle, and it is the website the
// Claude Startups application names. Nothing compiles it, so this guard holds
// what would otherwise rot silently: every file it references exists, every
// in-page link has a target, the story keeps its order, the truth labels and
// the founder's disclosure stay, its counts agree with each other, and the
// page stays light and readable without its script.
// ---------------------------------------------------------------------------

const root = join(import.meta.dirname, "..", "..");
const html = readFileSync(join(root, "public", "platform", "index.html"), "utf8");
const parserWindow = new Window({ settings: {
  disableCSSFileLoading: true,
  disableJavaScriptFileLoading: true,
  enableJavaScriptEvaluation: false,
} });
afterAll(async () => { await parserWindow.happyDOM.close(); });
const doc = new parserWindow.DOMParser().parseFromString(html, "text/html");

const STORY = ["room", "event", "venue", "claude", "engineering", "founder"] as const;
const SCRIPT_BUDGET_BYTES = 10 * 1024;

/** Every URL the page asks for: src, poster, href and each srcset candidate. */
function referencedUrls(): string[] {
  const urls: string[] = [];
  for (const element of doc.querySelectorAll("[src], [poster], [href], [srcset], [data-full]")) {
    for (const name of ["src", "poster", "href", "data-full"]) {
      const value = element.getAttribute(name);
      if (value !== null) urls.push(value);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== null) {
      for (const candidate of srcset.split(",")) {
        const url = candidate.trim().split(/\s+/u)[0];
        if (url !== undefined && url !== "") urls.push(url);
      }
    }
  }
  return urls;
}

/** An element's text, whitespace folded. Typed by what it reads, so it takes
 *  happy-dom's elements as well as the DOM's. */
function text(element: { readonly textContent: string | null } | null | undefined): string {
  return element?.textContent?.replace(/\s+/gu, " ") ?? "";
}

describe("/platform page", () => {
  it("references only files that exist in public/", () => {
    const local = referencedUrls()
      .filter((url) => url.startsWith("/") && !url.startsWith("//"))
      .map((url) => url.split(/[?#]/u)[0] ?? "")
      // A folder link names its index page; "/" itself is the app's route.
      .map((path) => (path.endsWith("/") && path !== "/" ? `${path}index.html` : path))
      .filter((path) => /\.[a-z0-9]+$/iu.test(path));
    expect(local.length).toBeGreaterThan(10);
    const missing = local.filter((path) => !existsSync(join(root, "public", decodeURI(path))));
    expect(missing).toEqual([]);
  });

  it("links only to anchors that exist", () => {
    const anchors = referencedUrls().filter((url) => url.startsWith("#") && url.length > 1);
    expect(anchors.length).toBeGreaterThan(3);
    const missing = anchors.filter((anchor) => doc.getElementById(anchor.slice(1)) === null);
    expect(missing).toEqual([]);
  });

  it("tells the story in order: the room, one wedding, the venue, Claude, the engineering, the founder", () => {
    const order = Array.from(doc.querySelectorAll("main > section[id]")).map((section) => section.id);
    expect(order.filter((id) => (STORY as readonly string[]).includes(id))).toEqual([...STORY]);
  });

  it("keeps the truth labels and the founder's disclosure", () => {
    expect(text(doc.getElementById("claude"))).toContain("not yet switched on for venue use");
    expect(text(doc.getElementById("event"))).toContain("sample data");
    expect(text(doc.querySelector("footer")).toLowerCase()).toContain("concept film");
    expect(text(doc.getElementById("founder"))).toContain("Its chief executive is my father.");
    // The wedding drawn in the hero is a sample, not a client.
    expect(text(doc.querySelector('.hall__drawn[data-for="breakfast"]'))).toContain("a sample wedding breakfast");
    // The planner draws a scale model of each room; the rooms' captures are
    // not yet in it, so the page must never say layouts are planned in them.
    expect(html).not.toMatch(/3D captures? of the real rooms/iu);
  });

  it("draws both layouts for each hero camera, and the plan in the last step", () => {
    for (const camera of ["desktop", "phone"]) {
      for (const scene of ["breakfast", "ceremony"]) {
        const ink = doc.querySelector(`.hall-ink--${camera} .ink[data-scene="${scene}"]`);
        expect(ink?.querySelectorAll("ellipse").length ?? 0, `${camera} ${scene}`).toBeGreaterThan(100);
      }
    }
    expect(doc.querySelectorAll('.hall-ink--night .ink[data-scene="breakfast"] ellipse').length).toBeGreaterThan(100);
  });

  it("states each count once, the same everywhere it appears", () => {
    for (const kind of ["commits", "claude"]) {
      const values = Array.from(doc.querySelectorAll(`[data-count="${kind}"]`)).map((element) => text(element));
      expect(values.length, kind).toBeGreaterThan(1);
      expect(new Set(values).size, kind).toBe(1);
    }
    expect(text(doc.querySelector("#pace-desc"))).toContain(text(doc.querySelector('[data-count="commits"]')));
  });

  it("gives every image a description and its size, so nothing jumps as it loads", () => {
    const images = Array.from(doc.querySelectorAll("img"));
    expect(images.length).toBeGreaterThan(5);
    for (const image of images) {
      expect(image.getAttribute("alt"), image.getAttribute("src") ?? "").not.toBeNull();
      if (image.classList.contains("viewer__img")) continue;
      expect(Number(image.getAttribute("width")), image.getAttribute("src") ?? "").toBeGreaterThan(0);
      expect(Number(image.getAttribute("height")), image.getAttribute("src") ?? "").toBeGreaterThan(0);
    }
  });

  it("keeps its one script deferred and under 10 KB, with no inline handlers", () => {
    const scripts = Array.from(doc.querySelectorAll("script[src]"));
    expect(scripts.map((script) => script.getAttribute("src"))).toEqual(["/platform/platform.js"]);
    expect(scripts[0]?.hasAttribute("defer")).toBe(true);
    expect(statSync(join(root, "public", "platform", "platform.js")).size).toBeLessThan(SCRIPT_BUDGET_BYTES);
    expect(html).not.toMatch(/\son[a-z]+=/u);
  });

  it("shows each Claude case as the record has it: run 1, its time and its pass count, and the table's counts", () => {
    interface RunRecord { summary: { passed: number; perCase?: { id: string; runs: number; passed: number }[] }; results: { id: string; sample: number; latencyMs: number }[] }
    const record = (id: string): RunRecord => JSON.parse(readFileSync(join(root, "public", "platform", "evaluation", "data", `${id}.json`), "utf8")) as RunRecord;
    const opus = record("heldout-opus");
    const CASES: Readonly<Record<string, string>> = {
      "case-agreement": "ho-claimed-agreement", "case-tag": "ho-closing-tag", "case-occasion": "ho-occasion-field",
      "case-dietary": "ho-dietary-detail", "case-contacts": "ho-contacts-in-long-message",
    };
    for (const [panelId, caseId] of Object.entries(CASES)) {
      const panel = doc.getElementById(panelId);
      expect(text(panel?.querySelector(".case__draft .case__label")), panelId).toContain("run 1");
      const first = opus.results.find((result) => result.id === caseId && result.sample === 1);
      expect(first, caseId).toBeDefined();
      expect(text(panel?.querySelector(".case__checks")), panelId).toContain(`${((first?.latencyMs ?? 0) / 1000).toFixed(1)} s`);
      const counted = opus.summary.perCase?.find((entry) => entry.id === caseId);
      expect(text(panel?.querySelector(".case__tally")), panelId).toContain(`${String(counted?.passed)} of this case’s ${String(counted?.runs)} runs`);
    }
    const passed = Array.from(doc.querySelectorAll(".results tbody tr")).map((row) => text(row.querySelector('[data-label="Passed every check"]')));
    expect(passed.slice(0, 3)).toEqual([opus, record("heldout-sonnet-x5"), record("heldout-haiku-x5")].map((run) => String(run.summary.passed)));
  });

  it("gives each story step its own note for the frame", () => {
    const steps = Array.from(doc.querySelectorAll(".story__steps .step"));
    expect(steps.length).toBe(6);
    for (const step of steps) expect(step.getAttribute("data-note") ?? "", text(step.querySelector("h3"))).toMatch(/sample data/u);
  });

  it("reads completely without its script and carries no placeholder text", () => {
    for (const id of STORY) expect(text(doc.getElementById(id)).length, id).toBeGreaterThan(120);
    expect(html).not.toMatch(/lorem|ipsum|\bTODO\b|\bTBD\b/iu);
  });
});
