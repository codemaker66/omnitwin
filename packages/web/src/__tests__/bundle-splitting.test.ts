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
// 2. vite.config.ts uses manualChunks to split three vendor groups out of
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

  it("lazy-loads all five page components", async () => {
    const { codeOnly } = await readSource(SRC);
    // Each page must be wrapped in lazy(() => import("./pages/X.js"))
    expect(codeOnly).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/LoginPage\.js["']/);
    expect(codeOnly).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/RegisterPage\.js["']/);
    expect(codeOnly).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/EditorPage\.js["']/);
    expect(codeOnly).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/DashboardPage\.js["']/);
    expect(codeOnly).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/HallkeeperPage\.js["']/);
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
    // alongside the lazy-loaded version).
    expect(codeOnly).not.toMatch(/^import\s+\{\s*LoginPage\s*\}\s+from\s+["']\.\/pages\/LoginPage/m);
    expect(codeOnly).not.toMatch(/^import\s+\{\s*EditorPage\s*\}\s+from\s+["']\.\/pages\/EditorPage/m);
    expect(codeOnly).not.toMatch(/^import\s+\{\s*DashboardPage\s*\}\s+from\s+["']\.\/pages\/DashboardPage/m);
  });
});

describe("vite.config.ts — manualChunks vendor split (#16)", () => {
  const SRC = "vite.config.ts";

  it("configures manualChunks under build.rollupOptions.output", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("manualChunks");
    expect(codeOnly).toContain("rollupOptions");
  });

  it("defines the three expected vendor chunk groups", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"react-vendor"`);
    expect(codeOnly).toContain(`"three"`);
    expect(codeOnly).toContain(`"clerk"`);
    expect(codeOnly).toContain(`"spark"`);
  });

  it("react-vendor chunk includes react, react-dom, and react-router-dom", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/"react-vendor":\s*\[[^\]]*"react"[^\]]*"react-dom"[^\]]*"react-router-dom"[^\]]*\]/);
  });

  it("three chunk groups three.js with R3F, drei, and stdlib", async () => {
    const { codeOnly } = await readSource(SRC);
    // The shared 3D stack must be in the same chunk so 3D routes
    // download them as one cacheable unit and other routes don't
    // accidentally pull a fragment of the stack.
    expect(codeOnly).toMatch(/"three":\s*\[[^\]]*"three"[^\]]*"@react-three\/fiber"[^\]]*"@react-three\/drei"[^\]]*"three-stdlib"[^\]]*\]/);
  });

  it("spark chunk isolates the Spark renderer from normal editor loads", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/"spark":\s*\[[^\]]*"@sparkjsdev\/spark"[^\]]*\]/);
  });

  it("clerk chunk isolates @clerk/react", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/"clerk":\s*\[[^\]]*"@clerk\/react"[^\]]*\]/);
  });
});
