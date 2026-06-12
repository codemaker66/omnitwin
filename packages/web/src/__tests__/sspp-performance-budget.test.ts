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
    const appSource = await read("src/App.tsx");
    const editorSource = await read("src/pages/EditorPage.tsx");
    const viteConfig = await read("vite.config.ts");

    expect(appSource).not.toContain("@sparkjsdev/spark");
    expect(editorSource).not.toContain("@sparkjsdev/spark");
    expect(viteConfig).toContain('"spark": ["@sparkjsdev/spark"]');
    expect(viteConfig).toMatch(/chunkSizeWarningLimit:\s*5_500/u);
  });

  it("pins screenshot coverage for the requested hardening routes", async () => {
    const spec = await read("e2e/sspp-hardening.spec.ts");

    expect(spec).toContain("/plan/${CONFIG_ID}");
    expect(spec).toContain("/dev/trades-hall-visual");
    expect(spec).toContain("sspp-room-showcase.png");
    expect(spec).toContain("/proposal/hardening-share");
    expect(spec).toContain("sspp-dashboard-pipeline.png");
  });
});
