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

const STORY = ["room", "event", "claude", "engineering", "venue", "founder"] as const;
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

function text(element: Element | null | undefined): string {
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

  it("tells the story in order: the room, one wedding, Claude, the engineering, the venue, the founder", () => {
    const order = Array.from(doc.querySelectorAll("main > section[id]")).map((section) => section.id);
    expect(order.filter((id) => (STORY as readonly string[]).includes(id))).toEqual([...STORY]);
  });

  it("keeps the truth labels and the founder's disclosure", () => {
    expect(text(doc.getElementById("claude"))).toContain("not yet switched on for venue use");
    expect(text(doc.getElementById("event"))).toContain("sample data");
    expect(text(doc.querySelector("footer")).toLowerCase()).toContain("concept film");
    expect(text(doc.getElementById("founder"))).toContain("Its chief executive is my father.");
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

  it("reads completely without its script and carries no placeholder text", () => {
    for (const id of STORY) expect(text(doc.getElementById(id)).length, id).toBeGreaterThan(120);
    expect(html).not.toMatch(/lorem|ipsum|\bTODO\b|\bTBD\b/iu);
  });
});
