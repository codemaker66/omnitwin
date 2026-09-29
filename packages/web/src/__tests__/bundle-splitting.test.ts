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
    expect(router).toMatch(/lazyWithPreload\(\(\)\s*=>\s*import\(["']\.\/pages\/hallkeeper\/DayBoardRoute\.js["']/);
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
 *  aside), as source paths. */
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
      if (!specifier.endsWith(".js")) continue;
      const base = path.resolve(path.dirname(file), specifier.slice(0, -".js".length));
      for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
        try {
          await fs.access(candidate);
          queue.push(candidate);
          break;
        } catch {
          // Not this extension.
        }
      }
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
