import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("web startup guardrails", () => {
  it("mounts React before starting the optional Sentry chunk", async () => {
    const source = await readFile(resolve("src/main.tsx"), "utf-8");
    const mountIndex = source.indexOf("createRoot(rootElement).render(");
    const sentryIndex = source.indexOf("void initBrowserSentry();");

    expect(mountIndex).toBeGreaterThan(-1);
    expect(sentryIndex).toBeGreaterThan(mountIndex);
    expect(source).not.toContain("await initBrowserSentry()");
  });

  it("fails targeted Vitest runs when no test file matches", async () => {
    const source = await readFile(resolve("vitest.config.ts"), "utf-8");
    expect(source).not.toContain("passWithNoTests");
  });
});
