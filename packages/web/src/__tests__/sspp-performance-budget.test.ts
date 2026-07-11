import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function read(relPath: string): Promise<string> {
  return readFile(resolve(relPath), "utf-8");
}

function cssBlock(source: string, selector: string): string {
  const selectorStart = source.indexOf(`${selector} {`);

  if (selectorStart < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }

  const blockStart = source.indexOf("{", selectorStart);

  if (blockStart < 0) {
    throw new Error(`Missing CSS block for selector: ${selector}`);
  }

  let depth = 0;

  for (let index = blockStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(blockStart + 1, index);
      }
    }
  }

  throw new Error(`Unterminated CSS block for selector: ${selector}`);
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

  it("never display-hides the runtime evidence chip at any cockpit width (CARD A1)", async () => {
    const topBarCss = await read("src/components/editor/cockpit/CockpitTopBar.css");

    // The runtime chip is the planner's honest claim about the captured
    // layer. It may truncate, but it must never be display-hidden by a
    // responsive rule — an invisible honesty chip is a silent claim.
    const runtimeRules = topBarCss
      .split("\n")
      .filter((line) => line.includes("cockpit-topbar__cell--runtime"));
    expect(runtimeRules.length).toBeGreaterThan(0);

    const hiddenRuntimeRule = /cockpit-topbar__cell--runtime[^}]*display:\s*none/;
    expect(topBarCss).not.toMatch(hiddenRuntimeRule);
  });

  it("keeps the planner canvas hot path free of CSS compositor penalties", async () => {
    const appCss = await read("src/App.css");
    const stageBlock = cssBlock(appCss, ".planner-canvas-stage");
    const stageScrimBlock = cssBlock(appCss, ".planner-canvas-stage::before");
    const canvasBlock = cssBlock(appCss, ".planner-canvas-stage canvas");
    const canvasHostBlock = cssBlock(appCss, ".planner-scene-canvas-host");

    expect(stageBlock).toContain("touch-action: none");
    expect(stageBlock).toContain("overscroll-behavior: contain");
    expect(stageScrimBlock).not.toContain("mix-blend-mode");
    expect(canvasHostBlock).toContain("width: 100%");
    expect(canvasHostBlock).toContain("height: 100%");
    expect(canvasBlock).not.toMatch(/(^|\s)filter\s*:/u);
    expect(canvasBlock).toContain("touch-action: none");
    expect(canvasBlock).toContain("overscroll-behavior: contain");
  });

  it("measures the real planner camera gesture instead of left-drag selection", async () => {
    const frameBudgetScript = await read("scripts/frame-budget-pass.mjs");

    expect(frameBudgetScript).toContain("dispatchCdpMouseDrag");
    expect(frameBudgetScript).toContain('Input.dispatchMouseEvent');
    expect(frameBudgetScript).toContain('"right"');
    expect(frameBudgetScript).toContain('kind: "cdp-right-drag-camera-orbit"');
    expect(frameBudgetScript).toContain("pickCanvasPoint");
    expect(frameBudgetScript).toContain("elementFromPoint");
    expect(frameBudgetScript).toContain('FRAME_BUDGET_WARMUP_INTERACTION !== "false"');
    expect(frameBudgetScript).toContain("warmupInteraction: WARMUP_INTERACTION");
  });

  it("keeps planner performance and visual harnesses mocked for public and authenticated config routes", async () => {
    const frameBudgetScript = await read("scripts/frame-budget-pass.mjs");
    const visualCheckScript = await read("scripts/visual-check.mjs");

    for (const script of [frameBudgetScript, visualCheckScript]) {
      expect(script).toContain("/public/configurations/cfg-perf-grand-hall");
      expect(script).toContain("/configurations/cfg-perf-grand-hall");
      expect(script).toContain('/venues/${VENUE_ID}/spaces/${SPACE_ID}');
    }

    expect(visualCheckScript).toContain("/public/configurations/cfg-perf-grand-hall/objects/batch");
    expect(visualCheckScript).toContain("/configurations/cfg-perf-grand-hall/objects/batch");
  });
});
