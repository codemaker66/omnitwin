import { afterEach, describe, expect, it } from "vitest";
import type { Rollup } from "vite";
import {
  HOME_ROUTE_PRELOAD_MARKER,
  PLANNER_PATH_PATTERN,
  homeRoutePreload,
  homeRoutePreloadScript,
  injectHomeRoutePreload,
  plannerRoutePreload,
  plannerRoutePreloadScript,
} from "../home-route-preload-plugin.js";

// A chunk graph in miniature: the entry loads react-vendor; the home route adds
// its own page, two data chunks and a stylesheet, and also imports react-vendor.
function chunk(fileName: string, imports: string[], extra: Partial<Rollup.OutputChunk> = {}): Rollup.OutputChunk {
  return {
    type: "chunk", fileName, name: fileName, imports, dynamicImports: [], isEntry: false, isDynamicEntry: false,
    isImplicitEntry: false, facadeModuleId: null, exports: [], importedBindings: {}, implicitlyLoadedBefore: [],
    moduleIds: [], modules: {}, referencedFiles: [], code: "", map: null, sourcemapFileName: null, preliminaryFileName: fileName,
    viteMetadata: { importedAssets: new Set(), importedCss: new Set() },
    ...extra,
  } as Rollup.OutputChunk;
}

function graph(): { readonly bundle: Rollup.OutputBundle; readonly entry: Rollup.OutputChunk } {
  const vendor = chunk("assets/react-vendor-a.js", []);
  const entry = chunk("assets/index-b.js", [vendor.fileName], { isEntry: true });
  const copy = chunk("assets/home-copy-c.js", [vendor.fileName]);
  const data = chunk("assets/fresh-copy-d.js", [copy.fileName]);
  const page = chunk("assets/RoomsHomePage-e.js", [vendor.fileName, copy.fileName, data.fileName], {
    facadeModuleId: "C:\\repo\\packages\\web\\src\\pages\\RoomsHomePage.tsx",
    isDynamicEntry: true,
    viteMetadata: { importedAssets: new Set(), importedCss: new Set(["assets/RoomsHomePage-f.css"]) },
  });
  const other = chunk("assets/EditorPage-g.js", [vendor.fileName], { facadeModuleId: "/repo/packages/web/src/pages/EditorPage.tsx" });
  const bundle: Rollup.OutputBundle = {};
  for (const item of [vendor, entry, copy, data, page, other]) bundle[item.fileName] = item;
  return { bundle, entry };
}

describe("homeRoutePreload", () => {
  it("lists the home route's static closure less what the entry already loads", () => {
    const { bundle, entry } = graph();
    const preload = homeRoutePreload(bundle, entry);
    expect(preload.modules).toEqual(["assets/RoomsHomePage-e.js", "assets/home-copy-c.js", "assets/fresh-copy-d.js"]);
    expect(preload.styles).toEqual(["assets/RoomsHomePage-f.css"]);
  });

  it("never lists another route's chunks", () => {
    const { bundle, entry } = graph();
    expect(homeRoutePreload(bundle, entry).modules).not.toContain("assets/EditorPage-g.js");
  });

  it("fails the build when the home page has no chunk, rather than shipping no preload", () => {
    const { bundle, entry } = graph();
    delete bundle["assets/RoomsHomePage-e.js"];
    expect(() => homeRoutePreload(bundle, entry)).toThrow(/no chunk for \/src\/pages\/RoomsHomePage\.tsx/u);
  });

  it.each([
    ["Clerk", "C:\\repo\\node_modules\\.pnpm\\@clerk+react@6\\node_modules\\@clerk\\react\\dist\\hooks.mjs"],
    ["the splat tile manifest", "/repo/packages/web/src/data/generated/trades-hall-splat-bundles.ts"],
    ["its re-export", "/repo/packages/web/src/data/room-splat-bundles.ts"],
  ])("fails the build when the home route reaches %s", (_name, moduleId) => {
    const { bundle, entry } = graph();
    const heavy = chunk("assets/heavy-h.js", [], { moduleIds: [moduleId] });
    bundle[heavy.fileName] = heavy;
    (bundle["assets/fresh-copy-d.js"] as Rollup.OutputChunk).imports.push(heavy.fileName);
    expect(() => homeRoutePreload(bundle, entry)).toThrow(/the home route loads assets\/heavy-h\.js/u);
  });

  it("fails the build when the entry itself reaches Clerk", () => {
    const { bundle, entry } = graph();
    const clerk = chunk("assets/clerk-i.js", [], { moduleIds: ["/repo/node_modules/@clerk/react/dist/index.mjs"] });
    bundle[clerk.fileName] = clerk;
    entry.imports.push(clerk.fileName);
    expect(() => homeRoutePreload(bundle, entry)).toThrow(/the entry loads assets\/clerk-i\.js/u);
  });

  it("allows heavy modules in chunks only other routes load", () => {
    const { bundle, entry } = graph();
    const clerk = chunk("assets/clerk-i.js", [], { moduleIds: ["/repo/node_modules/@clerk/react/dist/index.mjs"] });
    bundle[clerk.fileName] = clerk;
    (bundle["assets/EditorPage-g.js"] as Rollup.OutputChunk).imports.push(clerk.fileName);
    expect(homeRoutePreload(bundle, entry).modules).not.toContain(clerk.fileName);
  });
});

describe("injectHomeRoutePreload", () => {
  const preload = { modules: ["assets/a.js"], styles: [] };

  it("writes the script where the marker is", () => {
    const html = injectHomeRoutePreload(`<head>${HOME_ROUTE_PRELOAD_MARKER}<link rel="stylesheet" href="/x.css"></head>`, preload, "/");
    expect(html).toMatch(/^<head><script>\nif \(location\.pathname === "\/"\)/u);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('rel="stylesheet"'));
    expect(html).not.toContain(HOME_ROUTE_PRELOAD_MARKER);
  });

  it("fails the build when index.html has lost the marker, rather than shipping no preload", () => {
    expect(() => injectHomeRoutePreload("<head></head>", preload, "/")).toThrow(/no <!-- home-route-preload -->/u);
  });
});

describe("homeRoutePreloadScript", () => {
  const script = homeRoutePreloadScript({ modules: ["assets/a.js"], styles: ["assets/a.css"] }, "/");

  it("runs on the front door only", () => {
    expect(script.startsWith('if (location.pathname === "/") {')).toBe(true);
  });

  it("preloads modules and styles from the site root with the credentials mode the loader uses", () => {
    expect(script).toContain('["/assets/a.js"]');
    expect(script).toContain('["/assets/a.css"]');
    expect(script).toContain('link.rel = modulepreload ? "modulepreload" : "preload"');
    expect(script).toContain('link.rel = "preload"; link.as = "style"');
    expect(script.match(/link\.crossOrigin = ""/gu)).toHaveLength(2);
  });

  it("falls back to preload as=script where the browser has no modulepreload, as Vite's helper does", () => {
    expect(script).toContain('relList.supports("modulepreload")');
    expect(script).toContain('if (!modulepreload) link.as = "script";');
  });

  it("preloads no fonts", () => {
    expect(script).not.toMatch(/woff2?|as = "font"/u);
  });

  it("joins a base without a trailing slash", () => {
    expect(homeRoutePreloadScript({ modules: ["assets/a.js"], styles: [] }, "/app")).toContain('["/app/assets/a.js"]');
  });
});

// T-685: the planner's chunks start with the entry's on a planner address, and
// the front door's Plan links can fetch them for the next page.
describe("plannerRoutePreload", () => {
  it("lists the planner's closure less what the entry loads, tile manifest included", () => {
    const { bundle, entry } = graph();
    const manifest = chunk("assets/room-splat-bundles-j.js", [], { moduleIds: ["/repo/packages/web/src/data/room-splat-bundles.ts"] });
    bundle[manifest.fileName] = manifest;
    (bundle["assets/EditorPage-g.js"] as Rollup.OutputChunk).imports.push(manifest.fileName);
    expect(plannerRoutePreload(bundle, entry).modules).toEqual(["assets/EditorPage-g.js", "assets/room-splat-bundles-j.js"]);
  });

  it("fails the build when the planner has no chunk, rather than shipping no preload", () => {
    const { bundle, entry } = graph();
    delete bundle["assets/EditorPage-g.js"];
    expect(() => plannerRoutePreload(bundle, entry)).toThrow(/no chunk for \/src\/pages\/EditorPage\.tsx/u);
  });
});

describe("plannerRoutePreloadScript", () => {
  const planner = { modules: ["assets/EditorPage-g.js", "assets/three-k.js"], styles: ["assets/EditorPage-l.css"] };
  const script = plannerRoutePreloadScript(planner, "/");

  /** Runs the inline script as the browser does, at an address, and returns the links it added. */
  function run(path: string): HTMLLinkElement[] {
    window.history.replaceState({}, "", path);
    document.head.innerHTML = "";
    Reflect.deleteProperty(window, "__vvPlannerPrefetch");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- the inline script, as index.html runs it
    new Function(script)();
    return [...document.head.querySelectorAll("link")];
  }

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    document.head.innerHTML = "";
    Reflect.deleteProperty(window, "__vvPlannerPrefetch");
  });

  it.each(["/plan", "/plan/", "/plan/TH-4K2Q", "/plan/0b9a6a52-61f4-4a0e-9f0c-0d6a2f1c6e11", "/v/trades-hall-glasgow/plan"])(
    "starts the planner's files on %s, at low priority behind the entry",
    (path) => {
      const links = run(path);
      expect(links.map((link) => link.getAttribute("href"))).toEqual(["/assets/EditorPage-g.js", "/assets/three-k.js", "/assets/EditorPage-l.css"]);
      for (const link of links) {
        expect(["modulepreload", "preload"]).toContain(link.rel);
        expect(link.getAttribute("fetchpriority")).toBe("low");
        expect(link.getAttribute("crossorigin")).toBe("");
      }
      expect(links[2]?.getAttribute("as")).toBe("style");
    },
  );

  it.each(["/", "/planner", "/plan/TH-4K2Q/extra", "/plan-view/abc", "/v/trades-hall-glasgow", "/room/grand-hall"])(
    "fetches nothing on %s until someone reaches for a Plan link",
    (path) => {
      expect(run(path)).toHaveLength(0);
      expect(new RegExp(PLANNER_PATH_PATTERN, "u").test(path)).toBe(false);
    },
  );

  it("fetches the planner's files for the next page when the front door asks, once", () => {
    run("/");
    window.__vvPlannerPrefetch?.();
    window.__vvPlannerPrefetch?.();
    const links = [...document.head.querySelectorAll("link")];
    expect(links.map((link) => link.rel)).toEqual(["prefetch", "prefetch", "prefetch"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/assets/EditorPage-g.js", "/assets/three-k.js", "/assets/EditorPage-l.css"]);
  });

  it("is written after the home route's script, at the same marker", () => {
    const html = injectHomeRoutePreload(`<head>${HOME_ROUTE_PRELOAD_MARKER}</head>`, { modules: ["assets/a.js"], styles: [] }, "/", planner);
    expect(html.indexOf('if (location.pathname === "/")')).toBeLessThan(html.indexOf("__vvPlannerPrefetch"));
    expect(html.match(/<script>/gu)).toHaveLength(2);
  });
});
