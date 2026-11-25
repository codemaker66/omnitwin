// ---------------------------------------------------------------------------
// Bundle splitting (#16) — structural tripwire
//
// The web bundle was a single 1564 KB minified chunk loaded for every route.
// The fix has two coordinated parts that must stay in lockstep:
//
// 1. router.tsx lazy-loads every page via React.lazy + Suspense, so the
//    editor's Three.js stack doesn't have to ship for /login, /dashboard,
//    or /hallkeeper/:configId. The `then(m => ({ default: m.X }))` form
//    lets pages keep their existing named exports.
//
// 2. vite.config.ts uses manualChunks to split four vendor groups out of
//    the route chunks: react-vendor (cacheable across deploys), three
//    (only loaded for 3D routes), spark (only loaded for splat routes),
//    and clerk (only loaded for auth
//    routes). Page chunks emit automatically from the lazy() calls.
//
// These tests pin both halves of the fix at the source-grep level. If
// either drifts, CI fails before the regression can ship. Behavioural
// "build size assertion" tests are flaky and slow — the structural
// assertions cover the configuration that produces the size win.
// ---------------------------------------------------------------------------

import { posix } from "node:path";
import { describe, it, expect } from "vitest";

async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const raw = await fs.readFile(path.resolve(relPath), "utf-8");
  const codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return { raw, codeOnly };
}

describe("router.tsx — lazy route loading (#16)", () => {
  const SRC = "src/router.tsx";

  it("imports lazy and Suspense from react", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/import\s+\{[^}]*\blazy\b[^}]*\}\s+from\s+["']react["']/);
    expect(codeOnly).toMatch(/import\s+\{[^}]*\bSuspense\b[^}]*\}\s+from\s+["']react["']/);
  });

  it("lazy-loads all route page components, including internal Gaussian routes", async () => {
    const { codeOnly } = await readSource(SRC);
    // Each page must be wrapped in lazy(() => import("./pages/X.js")),
    // optionally through the cockpitImport retry helper (Wave-A refactor).
    // Guarded pages use lazyWithPreload, which is React.lazy plus an early
    // request for the same chunk (pinned below).
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/LoginPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/RegisterPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/EditorPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/DashboardPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/HallkeeperPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/SplatFixturePage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/TradesHallVisualPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/TradesHallAssetStatusPage\.js["']/);
    // The designed not-found page replaced the `*` → `/` redirect (T-616), so
    // it is a route chunk like any other and must not ride in the main bundle.
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/NotFoundPage\.js["']/);
    expect(codeOnly).toMatch(/\blazy(?:WithPreload)?\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/PricingPage\.js["']/);
    // RoomShowcasePage left this list in T-616: its address redirects to `/`,
    // so the router imports the page nowhere and there is no chunk to split.
    // The component and its own suite stay, and the negative assertion below
    // still guards against a static import coming back.
  });

  it("builds preloadable pages on React.lazy, sharing one import with the early request", async () => {
    const { codeOnly } = await readSource("src/lib/lazy-with-preload.ts");
    expect(codeOnly).toMatch(/import\s+\{[^}]*\blazy\b[^}]*\}\s+from\s+["']react["']/);
    expect(codeOnly).toContain("lazy(loadOnce)");
  });

  it("wraps lazy elements in Suspense with a fallback", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("<Suspense");
    expect(codeOnly).toContain("fallback=");
  });

  it("does NOT use static page imports", async () => {
    const { codeOnly } = await readSource(SRC);
    // The static import form was the bug. Lazy-loaded pages must NOT also
    // be statically imported (which would force them into the main chunk
    // alongside the lazy-loaded version). Every lazy-loaded page gets a
    // negative assertion — a redundant static import alongside the lazy
    // form silently defeats the split for that page.
    const pages = [
      "LoginPage",
      "RegisterPage",
      "EditorPage",
      "DashboardPage",
      "HallkeeperPage",
      "SplatFixturePage",
      "TradesHallVisualPage",
      "TradesHallAssetStatusPage",
      "RoomShowcasePage",
      "NotFoundPage",
      "PricingPage",
    ] as const;
    for (const pageName of pages) {
      expect(codeOnly).not.toMatch(
        new RegExp(String.raw`^import\s+\{\s*${pageName}\s*\}\s+from\s+["']\./pages/${pageName}`, "m"),
      );
    }
  });
});

describe("vite.config.ts — manualChunks vendor split (#16)", () => {
  const SRC = "vite.config.ts";

  it("configures manualChunks under build.rollupOptions.output", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("manualChunks");
    expect(codeOnly).toContain("rollupOptions");
  });

  it("raises the chunk warning limit only for deliberate lazy 3D vendor chunks", async () => {
    const { raw } = await readSource(SRC);
    expect(raw).toMatch(/chunkSizeWarningLimit:\s*5_500/);
    expect(raw).toContain("Three.js chunks are intentionally large");
    expect(raw).toContain("absence of splat decoding from");
  });

  it("defines the three expected vendor chunk groups", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"react-vendor"`);
    expect(codeOnly).toContain(`"three"`);
    expect(codeOnly).toContain(`"clerk"`);
    expect(codeOnly).not.toContain(`"spark"`);
  });

  it("react-vendor chunk includes shared app runtime modules", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"vite/preload-helper"`);
    expect(codeOnly).toContain(`"/node_modules/react/"`);
    expect(codeOnly).toContain(`"/node_modules/react-dom/"`);
    expect(codeOnly).toContain(`"/node_modules/react-router-dom/"`);
    expect(codeOnly).toContain(`"/node_modules/scheduler/"`);
    expect(codeOnly).toContain(`"/node_modules/zustand/"`);
    expect(codeOnly).toContain(`return "react-vendor"`);
  });

  it("three chunk groups three.js with R3F, drei, and stdlib", async () => {
    const { codeOnly } = await readSource(SRC);
    // The shared 3D stack must be in the same chunk so 3D routes
    // download them as one cacheable unit and other routes don't
    // accidentally pull a fragment of the stack.
    expect(codeOnly).toContain(`"/node_modules/three/"`);
    expect(codeOnly).toContain(`"/node_modules/@react-three/fiber/"`);
    expect(codeOnly).toContain(`"/node_modules/@react-three/drei/"`);
    expect(codeOnly).toContain(`"/node_modules/three-stdlib/"`);
    expect(codeOnly).toContain(`return "three"`);
  });

  it("keeps the WebGPU renderer, TSL and splat addons in their own chunk", async () => {
    // The WebGL panorama tour needs only core three; NativeCanvas surfaces add
    // this chunk. Checked before the generic three rule, which would otherwise
    // claim these modules and ship them to every 3D route.
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"/node_modules/three/build/three.webgpu"`);
    expect(codeOnly).toContain(`"/node_modules/three/build/three.tsl"`);
    expect(codeOnly).toContain(`"/node_modules/three/examples/jsm/objects/GaussianSplat"`);
    expect(codeOnly).toContain(`"/node_modules/three/examples/jsm/gpgpu/"`);
    // TSL addons import both chunks; in "three" they made the chunks import
    // each other, which crashed the production planner on load.
    expect(codeOnly).toContain(`"/node_modules/three/examples/jsm/tsl/"`);
    const webgpuReturn = codeOnly.indexOf(`return "three-webgpu"`);
    expect(webgpuReturn).toBeGreaterThan(-1);
    expect(webgpuReturn).toBeLessThan(codeOnly.indexOf(`return "three"`));
  });

  it("does not ship a Spark renderer chunk", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).not.toContain(`"/node_modules/@sparkjsdev/spark/"`);
    expect(codeOnly).not.toContain(`return "spark"`);
  });

  it("clerk chunk isolates @clerk/react", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"/node_modules/@clerk/"`);
    expect(codeOnly).toContain(`return "clerk"`);
  });

  it("keeps Spark out of the normal app and editor route sources", async () => {
    const [{ codeOnly: appSource }, { codeOnly: editorSource }] = await Promise.all([
      readSource("src/App.tsx"),
      readSource("src/pages/EditorPage.tsx"),
    ]);
    expect(appSource).not.toContain("@sparkjsdev/spark");
    expect(editorSource).not.toContain("@sparkjsdev/spark");
  });
});

describe("planner — on-demand GDTF/MVR archive reader", () => {
  // zip.js is roughly 230 KB of source. A static import of the archive layer put
  // it in every planner load for a lighting-file import most sessions never use.
  async function sourceFiles(directory: string): Promise<string[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files: string[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") files.push(...await sourceFiles(entryPath));
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(entryPath.replace(/\\/g, "/"));
      }
    }
    return files;
  }

  it("imports the archive layer dynamically and keeps zip.js behind it", async () => {
    const staticArchiveImporters: string[] = [];
    const zipImporters: string[] = [];
    for (const file of await sourceFiles("src")) {
      const { codeOnly } = await readSource(file);
      if (/^\s*import\s[^;]*?from\s+["'][^"']*\/gdtf-archive\.js["']/m.test(codeOnly)) staticArchiveImporters.push(file);
      if (/from\s+["']@zip\.js\/zip\.js["']/.test(codeOnly)) zipImporters.push(file);
    }

    expect(staticArchiveImporters).toEqual([]);
    // The splat SOG reader runs only inside the decoder worker bundle.
    expect(zipImporters.sort()).toEqual(["src/lib/gdtf-archive.ts", "src/lib/native-splat-sog.ts"]);

    const [{ codeOnly: panel }, { codeOnly: mvr }] = await Promise.all([
      readSource("src/components/editor/cockpit/LightingLensPanel.tsx"),
      readSource("src/lib/mvr.ts"),
    ]);
    expect(panel).toMatch(/import\(\s*["']\.\.\/\.\.\/\.\.\/lib\/gdtf-archive\.js["']\s*\)/);
    expect(mvr).toMatch(/import\(\s*["']\.\/gdtf-archive\.js["']\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// The request slab travels with the Day Board (T-623)
//
// Lane 9 first mounted its requests provider in main.tsx and imported the
// Day Board's context from the page itself. Measured with `vite build`, that
// took the entry script every visitor loads from 59.4 kB to 278.5 kB: the Day
// Board page, the dashboard shell, zod, the request schemas and the API
// client, on the public front door. The provider now wraps the Day Board's
// route, and the slot contract is a leaf the provider can import without the
// page. These pin both halves.
// ---------------------------------------------------------------------------

describe("the request slab travels with the Day Board (T-623)", () => {
  it("keeps request machinery and page modules out of the app root", async () => {
    const { codeOnly } = await readSource("src/main.tsx");
    expect(codeOnly).not.toMatch(/from\s+["']\.\/components\/requests\//);
    expect(codeOnly).not.toMatch(/from\s+["']\.\/pages\//);
  });

  it("brings the requests provider with the Day Board's own lazy route", async () => {
    const { codeOnly: router } = await readSource("src/router.tsx");
    // Through the cockpit fonts, as every desk is: the board sets its type in Inter.
    expect(router).toMatch(/lazyWithPreload\(\(\)\s*=>\s*(?:cockpitImport\(\(\)\s*=>\s*)?import\(["']\.\/pages\/hallkeeper\/DayBoardRoute\.js["']/);
    expect(router).not.toMatch(/from\s+["']\.\/components\/requests\//);
    const { codeOnly: route } = await readSource("src/pages/hallkeeper/DayBoardRoute.tsx");
    expect(route).toContain("<RequestsProvider>");
  });

  it("gives the provider the slot contract without the page", async () => {
    const { codeOnly } = await readSource("src/components/requests/RequestsProvider.tsx");
    expect(codeOnly).toMatch(/from\s+["']\.\.\/\.\.\/pages\/hallkeeper\/lib\/slot-requests-contract\.js["']/);
    expect(codeOnly).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["'][^"']*\/DayBoardPage\.js["']/);
  });
});

// ---------------------------------------------------------------------------
// The staff shell stays out of the script every visitor loads
//
// The internal event pages' route guard is imported by the router directly,
// and once rendered the dashboard shell around its venue notice. Measured with
// `vite build`, that took the entry script from 62 kB to 252 kB (the shell,
// its notifications, zod and the API client) on the public front door too.
// The notice is now loaded when it is shown. Whatever the entry reaches by
// static imports must never reach the shell or the notice.
// ---------------------------------------------------------------------------

/** Every module `entry` reaches through static imports (type-only imports
 *  aside), as source paths. A relative specifier is followed whether it names
 *  `.js` or no extension at all (TypeScript's "bundler" resolution and Vite
 *  accept both), and one that resolves to no source file fails the walk rather
 *  than drop out of it unseen. Other files (CSS, images, `?inline`) are not
 *  modules of the graph. */
async function staticImportClosure(entry: string): Promise<ReadonlySet<string>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const seen = new Set<string>();
  const queue = [path.resolve(entry)];
  const runtimeImport = /(?:^|[;\n])\s*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+["'](\.{1,2}\/[^"']+)["']/gu;
  const sideEffectImport = /(?:^|[;\n])\s*import\s+["'](\.{1,2}\/[^"']+)["']/gu;
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const code = (await fs.readFile(file, "utf-8")).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
    const specifiers = [...code.matchAll(runtimeImport), ...code.matchAll(sideEffectImport)].map((match) => match[1] ?? "");
    for (const specifier of specifiers) {
      const named = specifier.endsWith(".js");
      if (!named && /\.[A-Za-z0-9]+(?:\?.*)?$/u.test(specifier)) continue;
      const base = path.resolve(path.dirname(file), named ? specifier.slice(0, -".js".length) : specifier);
      const candidates = named
        ? [`${base}.tsx`, `${base}.ts`]
        : [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")];
      let found: string | undefined;
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          found = candidate;
          break;
        } catch {
          // Not this one.
        }
      }
      if (found === undefined) throw new Error(`${path.relative(path.resolve("."), file)}: cannot resolve ${specifier}`);
      queue.push(found);
    }
  }
  return seen;
}

describe("the staff shell stays out of the entry script", () => {
  it("never reaches the dashboard shell or the venue notice from the entry by static imports", async () => {
    const path = await import("node:path");
    const reached = await staticImportClosure("src/main.tsx");
    expect(reached.has(path.resolve("src/router.tsx"))).toBe(true);
    expect(reached.has(path.resolve("src/components/auth/InternalEventRoute.tsx"))).toBe(true);
    expect(reached.has(path.resolve("src/components/auth/EventsNotConnected.tsx"))).toBe(false);
    // Of the dashboard, only the shell's small contract; of the API layer,
    // only the token bridge. The shell, its notifications, the API client and
    // the schemas they bring each load with the pages that use them.
    const relative = [...reached].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/"));
    expect(relative.filter((file) => file.startsWith("src/components/dashboard/"))).toEqual(["src/components/dashboard/staff-shell.ts"]);
    expect(relative.filter((file) => file.startsWith("src/api/"))).toEqual(["src/api/auth-bridge.ts"]);
  });
});

// ---------------------------------------------------------------------------
// Field web vitals stay out of the entry script (T-685)
//
// The reporter and the web-vitals library load only in a build that samples
// page loads, by the entry's one dynamic import. The entry itself carries two
// small modules for it (the landing-route recorder and the sample rate), and
// they must stay that small: no imports of their own, so nothing rides in
// with them. A source regex missed an import written across lines; the
// closure walk does not, nor one written without an extension.
// ---------------------------------------------------------------------------

describe("field web vitals stay out of the entry script", () => {
  it("never reaches the reporter from the entry, and the two modules the entry keeps import nothing", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const reached = await staticImportClosure("src/main.tsx");
    expect(reached.has(path.resolve("src/observability/web-vitals.ts"))).toBe(false);
    for (const file of ["src/observability/landing-route.ts", "src/observability/web-vitals-rate.ts"]) {
      expect(reached.has(path.resolve(file)), file).toBe(true);
      const code = (await fs.readFile(file, "utf-8")).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
      // Any runtime import at all, static, bare or dynamic, of this app or of
      // a package; `import type` is erased.
      expect(code, file).not.toMatch(/(?:^|[;\n])\s*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+["']|(?:^|[;\n])\s*import\s*["']|\bimport\s*\(/u);
    }
  });

  it("walks an import however it is written: across lines, without an extension, or re-exported", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "closure-"));
    try {
      await fs.writeFile(path.join(dir, "entry.ts"), "import {\n  a,\n} from \"./a.js\";\nimport { b } from \"./b\";\nexport { c } from \"./c.js\";\nimport \"./style.css\";\n");
      for (const name of ["a", "b", "c"]) await fs.writeFile(path.join(dir, `${name}.ts`), `export const ${name} = 1;\n`);
      const reached = await staticImportClosure(path.join(dir, "entry.ts"));
      expect([...reached].map((file) => path.basename(file)).sort()).toEqual(["a.ts", "b.ts", "c.ts", "entry.ts"]);
      // A specifier that resolves to no source file fails the walk, rather than drop out of it.
      await fs.writeFile(path.join(dir, "entry.ts"), "import { gone } from \"./gone\";\n");
      await expect(staticImportClosure(path.join(dir, "entry.ts"))).rejects.toThrow(/cannot resolve \.\/gone/u);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The planner's device drafts stay off every route's first load (T-671)
//
// Slice 7 first swept expired planner drafts from main.tsx with a static
// import, so every route, the walkable twin's included, loaded the draft
// module: the twin's byte budget (e2e/twin-performance, measured on the dev
// server) went 19 KB over. The sweep now loads its module late, by itself, and
// the save-conflict parsing lives apart from configurations.ts, which the
// twin's enquiry modal loads.
// ---------------------------------------------------------------------------

describe("the planner's device drafts stay off the app root (T-671)", () => {
  it("sweeps expired drafts through a late dynamic import, never a static one", async () => {
    const { codeOnly } = await readSource("src/main.tsx");
    expect(codeOnly).not.toMatch(/from\s+["']\.\/lib\/planner-draft-storage/);
    expect(codeOnly).toMatch(/import\(["']\.\/lib\/planner-draft-storage\.js["']\)/);
  });

  it("keeps the save-conflict parsing out of the configurations client the twin loads", async () => {
    const { codeOnly } = await readSource("src/api/configurations.ts");
    expect(codeOnly).not.toMatch(/parseRevisionConflict|RevisionConflictDetailsSchema/);
    const conflict = await readSource("src/api/configuration-conflict.ts");
    expect(conflict.codeOnly).toMatch(/export function parseRevisionConflict/);
  });

  it("loads the twin's enquiry form on demand, with the planner keys and configurations client it brings", async () => {
    const { codeOnly } = await readSource("src/twin/TwinViewerControls.tsx");
    expect(codeOnly).not.toMatch(/from\s+["']\.\/TwinEnquiryModal/);
    expect(codeOnly).toMatch(/import\(["']\.\/TwinEnquiryModal\.js["']\)/);
  });
});

// ---------------------------------------------------------------------------
// The new chrome stays behind its lazy import (T-671, #357)
//
// The default planner (EditorPage, App) loads the new chrome only behind
// `?chrome=v2`. A static import of any of its modules from the default path
// would put that code in every visitor's download, as round 1 of #357's review
// found. Surfaces.tsx is the one planner-chrome module master's GhostSet
// already reaches. This catches module-level leaks; an unused export of a
// shared module that only the new chrome reads is kept out by moving it to a
// module listed here (setup-card-ids, setup-card-previews, sheet-motion).
// ---------------------------------------------------------------------------

describe("the new chrome stays behind its lazy import (T-671)", () => {
  const V2_ONLY_LIB = [
    "src/lib/planner-edit-commands.ts",
    "src/lib/placement-moves.ts",
    "src/lib/live-aisles.ts",
    "src/lib/card-store-figures.ts",
    "src/lib/setup-card-previews.ts",
    "src/lib/setup-card-ids.ts",
    "src/lib/replace.ts",
    "src/lib/caption-model.ts",
    "src/lib/caption-placement.ts",
    "src/lib/card-defaults.ts",
    "src/lib/screen-anchors.ts",
    "src/stores/cards-store.ts",
    "src/stores/planner-chrome-store.ts",
    "src/api/venue-inventory.ts",
  ];

  for (const entry of ["src/pages/EditorPage.tsx", "src/App.tsx"]) {
    it(`never reaches the new chrome's modules from ${entry} by static imports`, async () => {
      const path = await import("node:path");
      const reached = [...await staticImportClosure(entry)].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/"));
      expect(reached.filter((file) => file.startsWith("src/components/planner-chrome/"))).toEqual(["src/components/planner-chrome/Surfaces.tsx"]);
      expect(reached.filter((file) => V2_ONLY_LIB.includes(file))).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// The set-down engine stays behind the scene's lazy import (T-700, R78)
//
// The planner always mounts SetDownSound, a small shell that hears the
// landings from its mount. The driver, and with it the engine's room models,
// bodies, surfaces and the Worker's client, load only through the shell's
// dynamic import: at the planner's first idle while sound is on, and at the
// first gesture at the latest. Of the engine, the planner's static graph may
// reach only the registry's ear fatigue, which the registry itself imports.
// ---------------------------------------------------------------------------

describe("the set-down engine stays behind the scene's lazy import (T-700, R78)", () => {
  const LAZY_SOUND = [
    "src/components/editor/set-down-driver.ts",
    "src/components/editor/set-down-policy.ts",
    "src/components/editor/set-down-ahead.ts",
    "src/components/editor/set-down-room.ts",
  ];

  for (const entry of ["src/components/editor/PlannerScene.tsx", "src/pages/EditorPage.tsx", "src/App.tsx", "src/components/planner-chrome/RoomStage.tsx"]) {
    it(`reaches only the registry's fatigue of the engine from ${entry} by static imports`, async () => {
      const path = await import("node:path");
      const reached = [...await staticImportClosure(entry)].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/"));
      expect(reached).toContain("src/components/editor/SetDownSound.tsx");
      expect(reached.filter((file) => file.startsWith("src/lib/set-down/"))).toEqual(["src/lib/set-down/fatigue.ts"]);
      expect(reached.filter((file) => LAZY_SOUND.includes(file))).toEqual([]);
    });
  }

  it("keeps the Worker to what it renders from: none of the catalogue, the rooms or any component (R101)", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const reached = await staticImportClosure("src/lib/set-down/set-down.worker.ts");
    const files = [...reached].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/"));
    // Exactly the modules it renders from, named one by one, so a module the Worker comes to import fails here by
    // name, not only through the chunks' total: never the catalogue (and the asset catalogue it loads), the rooms,
    // the Grand Hall's spec or the surfaces' room rules, which are the main thread's (it resolves a surface for a
    // room; the Worker only renders the input it is sent), nor any component.
    expect([...files].sort()).toEqual([
      "src/lib/planner-sound-recipes.ts",
      "src/lib/planner-sound-render.ts",
      "src/lib/set-down/analysis.ts",
      "src/lib/set-down/bands.ts",
      "src/lib/set-down/modes.ts",
      "src/lib/set-down/render.ts",
      "src/lib/set-down/respatialize.ts",
      "src/lib/set-down/set-down.worker.ts",
      "src/lib/set-down/surface-data.ts",
      "src/lib/set-down/tail.ts",
      "src/lib/set-down/worker-jobs.ts",
      "src/lib/set-down/worker-protocol.ts",
    ]);
    const packageImports: string[] = [];
    for (const file of reached) {
      const code = (await fs.readFile(file, "utf-8")).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
      if (/(?:^|[;\n])\s*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+["']@omnitwin\//u.test(code)) packageImports.push(path.basename(file));
    }
    expect(packageImports).toEqual([]);
  });

  it("loads the driver only by the shell's dynamic import", async () => {
    const { codeOnly } = await readSource("src/components/editor/SetDownSound.tsx");
    expect(codeOnly).toMatch(/\bimport\(["']\.\/set-down-driver\.js["']\)/);
    // Its types may be imported (`import type` is erased); nothing of it is imported at run time.
    expect(codeOnly).not.toMatch(/(?:^|[;\n])\s*(?:import|export)\s+(?!type\s)[^;]*?\bfrom\s+["']\.\/set-down-driver/);
  });
});

// ---------------------------------------------------------------------------
// The planner HUD stays behind its flag (T-723)
//
// The HUD is one of three chromes, shown only for `?chrome=hud` until it is
// made the default. A planner that does not ask for it must download none of
// it, and nothing more because of it (the release lead's ruling on flag-only
// code, 13 Nov 2026). Three things are held here, all read from the sources:
//
// 1. Its own modules are reached by two imports on demand and by nothing
//    else: the screen from EditorPage, and its parts of the room's scene from
//    PlannerScene. Whatever a module every planner loads imports statically
//    rides in that planner's files.
// 2. It is not the only production reader of anything in a shared module. The
//    bundler leaves out of a shared module whatever nothing in production
//    reads, and the first reader puts it back, into the file that module is
//    built into, for every page that fetches that file; a reader fetched on
//    demand does it as surely as any other. Building this branch and master
//    from one tree (14 Nov 2026) found three such reads. So every name the HUD
//    imports from a module the default planner already holds must be imported
//    by other production code too, or be on the short list of seams below.
//    The same holds for a package path: one only the HUD imports is built
//    into a vendor file everyone fetches.
// 3. It imports no shared table. The bundler keeps a table's entries one by
//    one, and a read of one can be written too many ways to tell from the
//    import (an alias, a destructuring), so the HUD keeps its own copies, each
//    held to the table by a test beside it.
//
// These read sources, so they are tripwires: they see imports, not what the
// bundler makes of them. What is built is checked from the build itself in
// hud-chunk-isolation.test.ts (the Build job), and the proof is two builds
// compared module by module, which is run by hand
// (docs/sessions/2026-11-13.md).
// ---------------------------------------------------------------------------

describe("the planner HUD stays behind its flag (T-723)", () => {
  /** The HUD's own modules, as paths from src/ with their .js ending. */
  const HUD_ONLY: readonly RegExp[] = [
    /^components\/planner-hud\//,
    /^lib\/hud\//,
    /^stores\/planner-hud-store\.js$/,
    /^components\/grand-hall\/HallStage\.js$/,
    /^components\/grand-hall\/hall-stage\.js$/,
    /^lib\/lens-shift\.js$/,
    /^components\/editor\/ChosenMarks\.js$/,
    /^lib\/chosen-mark\.js$/,
  ];

  /**
   * What the HUD alone imports from shared modules, on purpose, as "module name": each with what it is and what it
   * costs everyone. The two-build reading counts these as the flag's seams. Anything the HUD alone imports that is
   * not here fails the test below.
   */
  const SEAMS: ReadonlyMap<string, string> = new Map([
    ["lib/planner-features.js setPlannerChromeFeatures", "the chrome's own switches, set as it mounts and cleared as it leaves: about 70 bytes of the shared runtime file"],
    // (The seat line's spring hook, useSpringCssVariable, was listed here until 16 Nov 2026. The other new chrome
    // imports it in production since #357, so the HUD is no longer its only reader, and the last check below said so.)
  ]);

  function mentions(code: string, name: string): boolean {
    return new RegExp(`(?<![.\\w$])${name.replace(/[$]/g, "\\$&")}(?![\\w$])`).test(code);
  }

  /**
   * The names of a module that are built whatever the HUD does: those the rest of production imports, and whatever
   * those use in turn, down through the module's own top-level declarations. Importing one of these adds no code:
   * at most the name itself, to the list its file exports. A name that only a DROPPED part of the module uses is
   * not one of them (the picture version read only by the picture rule nobody else called): importing that brings
   * it back.
   *
   * Read from the text, so by the house's layout: a top-level declaration starts its line, and runs to the next.
   */
  function builtWithoutTheHud(code: string, importedElsewhere: ReadonlySet<string>): ReadonlySet<string> {
    const starts = [...code.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([\w$]+)/gm)];
    const declared = starts.map((match, index) => ({ name: match[1] ?? "", text: code.slice(match.index, starts[index + 1]?.index ?? code.length) }));
    const built = new Set<string>();
    const pending = declared.map((one) => one.name).filter((name) => importedElsewhere.has(name));
    while (pending.length > 0) {
      const name = pending.pop();
      if (name === undefined || built.has(name)) continue;
      built.add(name);
      for (const user of declared) {
        if (user.name !== name) continue;
        for (const other of declared) if (!built.has(other.name) && mentions(user.text, other.name)) pending.push(other.name);
      }
    }
    return built;
  }

  it("tells what a module builds anyway from what only a dropped part of it uses", () => {
    const code = [
      'import { thing } from "./thing.js";',
      "",
      'export const VERSION = "v2";',
      "const HIDDEN = 3;",
      "",
      "function helper(value: number): number {",
      "  return value * HIDDEN;",
      "}",
      "",
      "export function used(value: number): number {",
      "  return helper(value) + thing;",
      "}",
      "",
      "export function unused(): string {",
      "  return `picture-${VERSION}`;",
      "}",
      "",
      "export function alone(): number {",
      "  return 1;",
      "}",
    ].join("\n");
    // Production imports `used`: it, its helper and what the helper reads are built. `VERSION` is read only by
    // `unused`, which nobody imports, so neither is built; `alone` is simply not imported.
    expect([...builtWithoutTheHud(code, new Set(["used"]))].sort()).toEqual(["HIDDEN", "helper", "used"]);
    expect([...builtWithoutTheHud(code, new Set(["unused", "nothing-of-this-module"]))].sort()).toEqual(["VERSION", "unused"]);
    expect([...builtWithoutTheHud(code, new Set())]).toEqual([]);
  });

  /** Shared tables whose entries the bundler keeps one by one. The HUD imports none of them. */
  const TABLES: readonly string[] = ["SPRING_PRESETS"];

  function isHudOnly(modulePath: string): boolean {
    return HUD_ONLY.some((pattern) => pattern.test(modulePath));
  }

  interface Imported {
    readonly specifier: string;
    /** The names brought in: "default"; "*" for a whole namespace or an import on demand; none for a bare `import "x"`. */
    readonly names: readonly string[];
    readonly onDemand: boolean;
  }

  /**
   * Every import and re-export in `code` that brings a module in at run time, wherever on a line it stands. A
   * type-only import brings nothing, and neither does the type query `typeof import("x")`.
   */
  function importsIn(code: string): Imported[] {
    const found: Imported[] = [];
    for (const match of code.matchAll(/(?<![.\w$])(import|export)\s+(?!type\b)([^;'"()=]*?)\s*\bfrom\s*["']([^"']+)["']/g)) {
      const clause = match[2] ?? "";
      const names: string[] = [];
      for (const item of (/\{([^}]*)\}/.exec(clause)?.[1] ?? "").split(",")) {
        const words = item.trim().split(/\s+/);
        const first = words[0] ?? "";
        if (first !== "" && first !== "type") names.push(first);
      }
      const outsideBraces = clause.replace(/\{[^}]*\}/, "");
      if (outsideBraces.includes("*")) names.push("*");
      else if (match[1] === "import" && /[\w$]/.test(outsideBraces)) names.push("default");
      found.push({ specifier: match[3] ?? "", names, onDemand: false });
    }
    for (const match of code.matchAll(/(?<![.\w$])import\s*["']([^"']+)["']/g)) found.push({ specifier: match[1] ?? "", names: [], onDemand: false });
    for (const match of code.matchAll(/(?<!typeof\s)(?<![.\w$])import\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1] ?? "", names: ["*"], onDemand: true });
    return found;
  }

  /** A relative specifier as a module's path from src/ (queries dropped); null for a package. */
  function resolved(from: string, specifier: string): string | null {
    if (!specifier.startsWith(".")) return null;
    return posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\?.*$/, "")));
  }

  it("reads imports the way the bundler does: wherever they stand, with their names, and not types", () => {
    const code = [
      'import { a } from "./a.js"; import { Hand, type Card as C, deal as d } from "../planner-hud/Hand.js";',
      "import {",
      "  b,",
      '} from "../b.js";',
      'import "./side-effect.css";',
      'export { c } from "./c.js";',
      'export * from "./all.js";',
      'import React, { useState } from "react";',
      'import * as THREE from "three";',
      'import type { D } from "./types.js";',
      'export type { E } from "./types.js";',
      'const lazy = () => import("./lazy.js");',
      'void import("../planner-hud/PlannerHud.js");',
      'type F = typeof import("./never.js");',
      "const notOne = thing.import(\"./property.js\"); const reimport = 1;",
    ].join("\n");
    expect(importsIn(code)).toEqual([
      { specifier: "./a.js", names: ["a"], onDemand: false },
      { specifier: "../planner-hud/Hand.js", names: ["Hand", "deal"], onDemand: false },
      { specifier: "../b.js", names: ["b"], onDemand: false },
      { specifier: "./c.js", names: ["c"], onDemand: false },
      { specifier: "./all.js", names: ["*"], onDemand: false },
      { specifier: "react", names: ["useState", "default"], onDemand: false },
      { specifier: "three", names: ["*"], onDemand: false },
      { specifier: "./side-effect.css", names: [], onDemand: false },
      { specifier: "./lazy.js", names: ["*"], onDemand: true },
      { specifier: "../planner-hud/PlannerHud.js", names: ["*"], onDemand: true },
    ]);
  });

  /** The pages the router builds only in development: the imports on demand inside devFixtureRoutes, as modules. */
  async function developmentOnlyPages(): Promise<readonly string[]> {
    const router = await readSource("src/router.tsx");
    // The gate that keeps them out of every production build.
    expect(router.codeOnly).toMatch(/import\.meta\.env\.DEV\s*\?\s*devFixtureRoutes\(\)\s*:\s*\[\]/);
    const body = /function devFixtureRoutes\(\)[^{]*\{([\s\S]*?)\n\}/.exec(router.codeOnly)?.[1] ?? "";
    return Array.from(body.matchAll(/import\(["']\.\/(pages\/[^"']+\.js)["']\)/g), (match) => match[1] ?? "");
  }

  interface Sources {
    /** Every module of the app, not its tests, by its path from src/ with a .js ending, with what it imports. */
    readonly modules: ReadonlyMap<string, readonly Imported[]>;
    /** The pages no production build contains. */
    readonly devOnly: ReadonlySet<string>;
    /**
     * Every module a browser can be sent without the HUD: reached from the entry by imports, on demand or not, never
     * through a development page and never into the HUD.
     */
    readonly production: ReadonlySet<string>;
    /** Each module's own code, comments out. */
    readonly code: ReadonlyMap<string, string>;
  }

  let read: Promise<Sources> | null = null;
  function sources(): Promise<Sources> {
    read ??= (async (): Promise<Sources> => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const modules = new Map<string, readonly Imported[]>();
      const code = new Map<string, string>();
      for (const entry of await fs.readdir(path.resolve("src"), { recursive: true })) {
        const file = entry.replace(/\\/g, "/");
        if (!/\.tsx?$/.test(file) || /\.d\.ts$/.test(file) || /(^|\/)__tests__\//.test(file) || /\.test\.tsx?$/.test(file)) continue;
        const { codeOnly } = await readSource(`src/${file}`);
        modules.set(file.replace(/\.tsx?$/, ".js"), importsIn(codeOnly));
        code.set(file.replace(/\.tsx?$/, ".js"), codeOnly);
      }
      const devOnly = new Set(await developmentOnlyPages());
      const production = new Set<string>();
      const pending = ["main.js"];
      while (pending.length > 0) {
        const module = pending.pop();
        if (module === undefined || production.has(module)) continue;
        const imports = modules.get(module);
        if (imports === undefined) continue;
        production.add(module);
        for (const { specifier } of imports) {
          const target = resolved(module, specifier);
          if (target !== null && !devOnly.has(target) && !isHudOnly(target)) pending.push(target);
        }
      }
      return { modules, devOnly, production, code };
    })();
    return read;
  }

  it("reads the whole app: its entry, its pages and its planner, and no development page", async () => {
    const { modules, devOnly, production } = await sources();
    expect(modules.size).toBeGreaterThan(500);
    // The three lab pages are development's, and that is why their reads of shared code count for nothing below.
    for (const page of ["pages/PlannerLabPage.js", "pages/FurnitureLabPage.js", "pages/GrandHallLabPage.js"]) expect(devOnly.has(page), page).toBe(true);
    for (const reached of ["main.js", "router.js", "pages/EditorPage.js", "components/editor/PlannerScene.js", "components/SelectionSystem.js", "lib/springs.js", "lib/crafted-furniture.js", "components/grand-hall/hall-mood.js"]) {
      expect(production.has(reached), reached).toBe(true);
    }
    expect(production.size).toBeGreaterThan(400);
    expect([...production].filter((module) => devOnly.has(module) || isHudOnly(module))).toEqual([]);
    // Every relative import of a script was found: a reader that lost some would call their modules unread.
    const lost: string[] = [];
    for (const [module, imports] of modules) {
      for (const { specifier } of imports) {
        const target = resolved(module, specifier);
        if (target !== null && /\.js$/.test(target) && !modules.has(target)) lost.push(`${module} -> ${specifier}`);
      }
    }
    expect(lost).toEqual([]);
  });

  it("lets nothing outside the HUD import its modules, but the two imports on demand that fetch it", async () => {
    const { modules, devOnly } = await sources();
    const always: string[] = [];
    const onDemand: string[] = [];
    for (const [module, imports] of modules) {
      if (isHudOnly(module) || devOnly.has(module)) continue;
      for (const one of imports) {
        const target = resolved(module, one.specifier);
        if (target !== null && isHudOnly(target)) (one.onDemand ? onDemand : always).push(`${module} -> ${target}`);
      }
    }
    expect(always).toEqual([]);
    // A third import on demand (a warm-up, say) would fetch the screen for a planner that never asked for it.
    expect(onDemand.sort()).toEqual([
      "components/editor/PlannerScene.js -> components/planner-hud/hud-scene.js",
      "pages/EditorPage.js -> components/planner-hud/PlannerHud.js",
    ]);
  });

  it("fetches its parts of the scene only where a screen has asked for the stage or the mark", async () => {
    const scene = await readSource("src/components/editor/PlannerScene.tsx");
    expect(scene.codeOnly).toMatch(/=>\s*import\(["']\.\.\/planner-hud\/hud-scene\.js["']\)/);
    expect(scene.codeOnly).toMatch(/if\s*\(!hudSceneAsked\)\s*return/);
    expect(scene.codeOnly).toMatch(/const hudSceneAsked = hallStageAsked \|\| plannerFeatureEnabled\("chosenMark"\);/);
  });

  it("keeps the stage's measurements and lens out of what the hall's model, its views and the camera rig import", async () => {
    for (const file of ["src/components/grand-hall/GrandHallModel.tsx", "src/components/grand-hall/HallViewDirector.tsx", "src/stores/hall-view-store.ts", "src/components/CameraRig.tsx"]) {
      const { codeOnly } = await readSource(file);
      expect(codeOnly, file).not.toMatch(/from\s+["'][^"']*\/(?:hall-stage|HallStage|lens-shift|chosen-mark|ChosenMarks)\.js["']/);
    }
    // The two heights the hall's model does need are a module of their own.
    const model = await readSource("src/components/grand-hall/GrandHallModel.tsx");
    expect(model.codeOnly).toMatch(/from\s+["']\.\/hall-stage-cuts\.js["']/);
  });

  it("is not the only production reader of anything it imports from code the default planner already holds", async () => {
    const { modules, production, code } = await sources();
    // What the rest of production imports, by module or package path: its names, or "*" where it takes the lot.
    const readElsewhere = new Map<string, Set<string>>();
    for (const module of production) {
      for (const one of modules.get(module) ?? []) {
        const from = resolved(module, one.specifier) ?? one.specifier;
        const names = readElsewhere.get(from) ?? new Set<string>();
        for (const name of one.names) names.add(name);
        readElsewhere.set(from, names);
      }
    }
    const offenders: string[] = [];
    const seamsMet = new Set<string>();
    let hudModules = 0;
    let checked = 0;
    let builtAnyway = 0;
    for (const [module, imports] of modules) {
      if (!isHudOnly(module)) continue;
      hudModules += 1;
      for (const one of imports) {
        const target = resolved(module, one.specifier);
        const from = target ?? one.specifier;
        // Its own modules; and stylesheets and pictures, which are not scripts with names to keep or drop.
        if (target !== null && (isHudOnly(target) || !modules.has(target))) continue;
        const elsewhere = readElsewhere.get(from);
        if (elsewhere === undefined) {
          // Nothing else in production imports it. A module of the app then rides whole in the HUD's own files; a
          // package path is built into a vendor file everyone fetches.
          if (target === null) offenders.push(`${module}: the package path "${from}", which nothing else in production imports`);
          continue;
        }
        if (elsewhere.has("*")) continue;
        for (const name of one.names) {
          checked += 1;
          if (elsewhere.has(name)) continue;
          // A name the rest of production already builds, through what it imports, adds no code when the HUD imports it too.
          if (target !== null && builtWithoutTheHud(code.get(target) ?? "", elsewhere).has(name)) {
            builtAnyway += 1;
            continue;
          }
          const seam = `${from} ${name}`;
          if (SEAMS.has(seam)) seamsMet.add(seam);
          else offenders.push(`${module}: ${name === "*" ? "all of" : name} from ${from}, which nothing else in production imports`);
        }
      }
    }
    // The walk found the HUD's modules and weighed their imports (a wrong root would pass by reading nothing).
    expect(hudModules).toBeGreaterThanOrEqual(20);
    expect(checked).toBeGreaterThan(100);
    // Some of what it alone imports is built anyway (the piece's verbs are the keymap's own, used by its keys); the
    // check that lets those through is at work, and not letting everything through.
    expect(builtAnyway).toBeGreaterThan(0);
    expect(builtAnyway).toBeLessThan(20);
    expect(offenders).toEqual([]);
    // And the list of seams names nothing that is no longer one.
    expect([...SEAMS.keys()].filter((seam) => !seamsMet.has(seam))).toEqual([]);
  });

  it("imports no shared table whose entries the bundler keeps one by one", async () => {
    const { modules } = await sources();
    const offenders: string[] = [];
    for (const [module, imports] of modules) {
      if (!isHudOnly(module)) continue;
      for (const one of imports) {
        for (const table of TABLES) if (one.names.includes(table)) offenders.push(`${module} imports ${table} from ${one.specifier}`);
      }
    }
    expect(offenders).toEqual([]);
    // The table is still where this says it is, and others still read it: or this guards nothing.
    const springs = await readSource("src/lib/springs.ts");
    expect(springs.codeOnly).toMatch(/export const SPRING_PRESETS = \{/);
    const { production } = await sources();
    expect([...production].some((module) => (modules.get(module) ?? []).some((one) => one.names.includes("SPRING_PRESETS")))).toBe(true);
  });

  /**
   * What the HUD takes from the other new chrome's folder, on purpose: the plaque (that chrome's slate), the
   * slate's audience, the host of its tooltips, and the base stylesheet they are drawn in. That chrome's own room
   * frame, its caption and its tools are not this screen's. The frame was mounted here until it began to carry
   * that chrome's caption over a chosen piece (#357, 16 Nov 2026), which this screen then showed too: it frames the
   * scene itself now (planner-hud/HudRoom.tsx). Anything more taken from that folder is to be chosen, not caught.
   */
  const FROM_THE_OTHER_CHROME: readonly string[] = [
    "components/planner-chrome/Slate.js",
    "components/planner-chrome/Tooltip.js",
    "components/planner-chrome/chrome.css",
    "components/planner-chrome/slate-data.js",
  ];

  it("takes from the other new chrome's folder only what it reuses on purpose", async () => {
    const { modules } = await sources();
    const taken = new Set<string>();
    for (const [module, imports] of modules) {
      if (!isHudOnly(module)) continue;
      for (const one of imports) {
        const target = resolved(module, one.specifier);
        if (target?.startsWith("components/planner-chrome/") === true) taken.add(target);
      }
    }
    expect([...taken].sort()).toEqual([...FROM_THE_OTHER_CHROME].sort());
  });
});

// ---------------------------------------------------------------------------
// The sound setting reaches v1 without the new chrome (T-700, T-671)
//
// v1's two menus hold the planner's sound setting, and the scene's Shift M
// receipt is mounted for every chrome. They take it from a chrome-free core
// (the shortcut in lib, the setting in components/shared) dressed in v1's own
// look, never from planner-chrome: its modules would ship to every visitor,
// and its stylesheet is global and would restyle the default planner. The
// module walk skips stylesheets, so this also reads every reached module's
// own CSS imports. One already reaches v1 on master: GhostSet's MarkLabel is
// in Surfaces.tsx, the one planner-chrome module T-671 allows, and it imports
// chrome.css. Nothing else may.
// ---------------------------------------------------------------------------

/** The stylesheets under `dir` that `files` import by side effect, each as "<importer> -> <sheet>" in source paths. */
async function stylesheetsUnder(files: Iterable<string>, dir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const sideEffectImport = /(?:^|[;\n])\s*import\s+["'](\.{1,2}\/[^"']+\.css)["']/gu;
  const relative = (file: string): string => path.relative(path.resolve("."), file).split(path.sep).join("/");
  const found: string[] = [];
  for (const file of files) {
    const code = (await fs.readFile(file, "utf-8")).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
    for (const match of code.matchAll(sideEffectImport)) {
      const sheet = relative(path.resolve(path.dirname(file), match[1] ?? ""));
      if (sheet.startsWith(dir)) found.push(`${relative(file)} -> ${sheet}`);
    }
  }
  return found.sort();
}

describe("the sound setting reaches v1 without the new chrome (T-700, T-671)", () => {
  const relativeTo = async (files: Iterable<string>): Promise<string[]> => {
    const path = await import("node:path");
    return [...files].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/"));
  };

  for (const entry of ["src/pages/EditorPage.tsx", "src/App.tsx"]) {
    it(`gives ${entry} the menus' setting and the receipt's shortcut from the chrome-free core, and no stylesheet of the new chrome but master's one`, async () => {
      const reached = await staticImportClosure(entry);
      const files = await relativeTo(reached);
      expect(files).toEqual(expect.arrayContaining([
        "src/lib/planner-sound-shortcut.ts",
        "src/components/shared/SoundSettingsCore.tsx",
        "src/components/editor/MenuSoundSettings.tsx",
        "src/components/editor/PlannerSoundReceipt.tsx",
      ]));
      expect(await stylesheetsUnder(reached, "src/components/planner-chrome/")).toEqual([
        "src/components/planner-chrome/Surfaces.tsx -> src/components/planner-chrome/chrome.css",
      ]);
    });
  }

  it("keeps the core and the shortcut free of every chrome", async () => {
    for (const entry of ["src/components/shared/SoundSettingsCore.tsx", "src/lib/planner-sound-shortcut.ts"]) {
      const reached = await staticImportClosure(entry);
      const files = await relativeTo(reached);
      expect(files.filter((file) => file.startsWith("src/components/planner-chrome/") || file.startsWith("src/components/editor/")), entry).toEqual([]);
      expect(await stylesheetsUnder(reached, "src/components/"), entry).toEqual([]);
    }
  });

  it("finds a stylesheet a module imports, so the checks above mean something", async () => {
    const path = await import("node:path");
    expect(await stylesheetsUnder([path.resolve("src/components/planner-chrome/Kbd.tsx")], "src/components/planner-chrome/"))
      .toEqual(["src/components/planner-chrome/Kbd.tsx -> src/components/planner-chrome/chrome.css"]);
  });
});

// ---------------------------------------------------------------------------
// A surveyed room's code stays out of the planner every visitor loads (T-662)
//
// The planner draws a room as surveyed only where a device has turned the
// switch on (`?rooms=surveyed`) and the room has a survey. The mount first
// imported the model, the survey's loader and the opening fit into
// PlannerScene directly: measured from CI's build of #444, that put 33.24 kB
// (12.63 kB gzip) of survey parsing, relief decoding, geometry and materials
// into the EditorPage file for every planner visit, the switch off.
//
// The planner now keeps only the seam: what is asked and where the code is
// asked for (use-planner-surveyed-room.ts, with the registry it reads), and
// how the room stands (room-status.ts and its store, which the caption
// reads). Everything else arrives through one dynamic import, made only where
// a survey is asked for. These pin both halves, as the sections above do for
// other code a flag or a rare action brings.
// ---------------------------------------------------------------------------

describe("a surveyed room's code stays out of the default planner (T-662)", () => {
  const ROOM_FOLDER = "src/components/surveyed-room/";
  const SEAM = [
    "src/components/surveyed-room/room-registry.ts",
    "src/components/surveyed-room/room-status.ts",
    "src/components/surveyed-room/use-planner-surveyed-room.ts",
  ];
  const CODE = "src/components/surveyed-room/PlannerSurveyedRoom.tsx";

  async function reachedUnder(entry: string, folder: string): Promise<string[]> {
    const path = await import("node:path");
    const reached = await staticImportClosure(entry);
    return [...reached].map((file) => path.relative(path.resolve("."), file).split(path.sep).join("/")).filter((file) => file.startsWith(folder)).sort();
  }

  it("reaches only the seam from the planner's page by static imports", async () => {
    const path = await import("node:path");
    const reached = await staticImportClosure("src/pages/EditorPage.tsx");
    // The scene and the caption's store are in that closure: what is read below is the planner that ships.
    expect(reached.has(path.resolve("src/components/editor/PlannerScene.tsx"))).toBe(true);
    expect(reached.has(path.resolve("src/stores/surveyed-room-store.ts"))).toBe(true);
    expect(await reachedUnder("src/pages/EditorPage.tsx", ROOM_FOLDER)).toEqual(SEAM);
    // And nothing of a surveyed room is in the script every route loads.
    expect(await reachedUnder("src/main.tsx", ROOM_FOLDER)).toEqual([]);
  });

  it("asks for the rest in one place, on demand, through React.lazy", async () => {
    const dynamicImporters: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") await walk(entryPath);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const { codeOnly } = await readSource(entryPath);
          if (/import\(\s*["'][^"']*\/PlannerSurveyedRoom\.js["']\s*\)/.test(codeOnly)) dynamicImporters.push(entryPath);
        }
      }
    };
    await walk("src");
    expect(dynamicImporters).toEqual(["src/components/surveyed-room/use-planner-surveyed-room.ts"]);
    const { codeOnly: seam } = await readSource("src/components/surveyed-room/use-planner-surveyed-room.ts");
    expect(seam).toMatch(/import\s+\{[^}]*\blazy\b[^}]*\}\s+from\s+["']react["']/);
    expect(seam).toMatch(/\blazy\(/);
    // The scene itself names nothing of a surveyed room but the seam.
    const { codeOnly: scene } = await readSource("src/components/editor/PlannerScene.tsx");
    const named = [...scene.matchAll(/from\s+["']\.\.\/surveyed-room\/([^"']+)["']/g)].map((match) => match[1]);
    expect(named).toEqual(["use-planner-surveyed-room.js"]);
  });

  it("brings the model, the survey's loader and the opening fit with that import", async () => {
    // What the import carries: were one of these to move, or the code to stop reaching it, the list above would
    // be pinning nothing.
    const carried = await reachedUnder(CODE, ROOM_FOLDER);
    for (const file of ["SurveyedRoomModel.tsx", "use-surveyed-room.ts", "survey-record.ts", "room-geometry.ts", "room-materials.ts", "room-opening-view.ts"]) {
      expect(carried).toContain(`${ROOM_FOLDER}${file}`);
    }
    // The seam never reads the code. And the code takes nothing of the seam's folder at run time, only types:
    // a module is built whole into one file, so whatever the code read from a seam module would be kept in the
    // planner's own file for everyone (a survey file's URL was, until it moved to the survey's loader).
    for (const seamFile of SEAM) expect(await reachedUnder(seamFile, ROOM_FOLDER)).not.toContain(CODE);
    expect(carried.filter((file) => SEAM.includes(file))).toEqual([]);
  });
});
