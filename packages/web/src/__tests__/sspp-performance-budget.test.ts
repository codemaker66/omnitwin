import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function read(relPath: string): Promise<string> {
  return readFile(resolve(relPath), "utf-8");
}

describe("SS++ performance and visual hardening guardrails", () => {
  it("documents route, bundle, splat, planner frame, and large-layout budgets", async () => {
    const doc = await read("../../docs/operations/performance-budgets.md");

    expect(doc).toContain("Route Load Budgets");
    expect(doc).toContain("Bundle Budgets");
    expect(doc).toContain("Planner Frame Budget");
    expect(doc).toContain("Large Layout Object Count");
    expect(doc).toContain("Splat Lazy Loading");
  });

  it("keeps Spark isolated from normal editor sources", async () => {
    const mainSource = await read("src/main.tsx");
    const appSource = await read("src/App.tsx");
    const editorSource = await read("src/pages/EditorPage.tsx");
    const cockpitSplatLayerSource = await read("src/components/editor/CockpitSplatLayer.tsx");
    const tradesHallVisualSource = await read("src/pages/TradesHallVisualPage.tsx");
    const verticalToolboxSource = await read("src/components/editor/VerticalToolbox.tsx");
    const clerkRouteProviderSource = await read("src/components/auth/ClerkRouteProvider.tsx");
    const viteConfig = await read("vite.config.ts");

    expect(mainSource).not.toContain("@clerk/react");
    expect(clerkRouteProviderSource).toContain("@clerk/react");
    expect(verticalToolboxSource).not.toMatch(/import\s+\{[^}]*AuthModal[^}]*\}\s+from\s+["']\.\/AuthModal\.js["']/u);
    expect(verticalToolboxSource).toContain('import("./AuthModal.js")');
    expect(verticalToolboxSource).toContain('import("../auth/ClerkRouteProvider.js")');
    expect(appSource).not.toContain("@sparkjsdev/spark");
    expect(editorSource).not.toContain("@sparkjsdev/spark");
    expect(cockpitSplatLayerSource).not.toMatch(/import\s+\{[^}]*SparkSplatLayer[^}]*\}\s+from\s+["']\.\.\/scene\/SparkSplatLayer\.js["']/u);
    expect(tradesHallVisualSource).not.toMatch(/import\s+\{[^}]*SparkSplatLayer[^}]*\}\s+from\s+["']\.\.\/components\/scene\/SparkSplatLayer\.js["']/u);
    expect(cockpitSplatLayerSource).toContain('import("../scene/SparkSplatLayer.js")');
    expect(tradesHallVisualSource).toContain('import("../components/scene/SparkSplatLayer.js")');
    expect(viteConfig).toContain('"/node_modules/react/"');
    expect(viteConfig).toContain('"/node_modules/react-dom/"');
    expect(viteConfig).toContain('"/node_modules/zustand/"');
    expect(viteConfig).toContain('"vite/preload-helper"');
    expect(viteConfig).toContain('"/node_modules/@sparkjsdev/spark/"');
    expect(viteConfig).toMatch(/chunkSizeWarningLimit:\s*5_500/u);
  });

  it("pins screenshot coverage for the requested hardening routes", async () => {
    const spec = await read("e2e/sspp-hardening.spec.ts");

    expect(spec).toContain("/plan/${CONFIG_ID}");
    expect(spec).toContain("/dev/trades-hall-visual");
    expect(spec).toContain("sspp-room-showcase.png");
    expect(spec).toContain("sspp-public-room-route.png");
    expect(spec).toContain("/proposal/hardening-share");
    expect(spec).toContain("sspp-dashboard-pipeline.png");
    expect(spec).toContain("sspp-pricing.png");
    expect(spec).toContain("sspp-hallkeeper.png");
  });

  it("keeps compositor-heavy cockpit filters disabled on the planner shell", async () => {
    const cockpitCss = await read("src/components/editor/cockpit/PlannerCockpit.css");

    expect(cockpitCss).toContain(".cockpit-shell *::before");
    expect(cockpitCss).toContain("-webkit-backdrop-filter: none !important");
    expect(cockpitCss).toContain("backdrop-filter: none !important");
    expect(cockpitCss).toContain("filter: none !important");
  });
});
