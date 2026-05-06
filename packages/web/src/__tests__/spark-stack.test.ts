import { describe, expect, it } from "vitest";

async function readJson(relPath: string): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return JSON.parse(await fs.readFile(path.resolve(relPath), "utf-8")) as unknown;
}

function asPackageJson(value: unknown): {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("package.json did not parse as an object");
  }
  return value as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
  };
}

describe("T-087 Spark renderer dependency unit", () => {
  it("pins Three.js to the 0.180 compatibility line required by Spark 2.0", async () => {
    const pkg = asPackageJson(await readJson("package.json"));
    expect(pkg.dependencies?.["three"]).toBe("^0.180.0");
    expect(pkg.devDependencies?.["@types/three"]).toBe("^0.180.0");
  });

  it("uses the React 18-compatible R3F/drei line while adding Spark 2.0", async () => {
    const pkg = asPackageJson(await readJson("package.json"));
    expect(pkg.dependencies?.["@react-three/fiber"]).toBe("^8.18.0");
    expect(pkg.dependencies?.["@react-three/drei"]).toBe("^9.122.0");
    expect(pkg.dependencies?.["@sparkjsdev/spark"]).toBe("2.0.0");
  });

  it("does not import drei's banned Splat helper in the Spark fixture", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/pages/SplatFixturePage.tsx"), "utf-8");
    expect(source).toContain("@sparkjsdev/spark");
    expect(source).not.toContain("<Splat");
    expect(source).not.toMatch(/import\s+\{[^}]*\bSplat\b[^}]*\}\s+from\s+["']@react-three\/drei["']/);
  });

  it("loads real runtime assets through Spark's SplatMesh API, not textSplats", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const componentSource = await fs.readFile(path.resolve("src/components/scene/SparkSplatLayer.tsx"), "utf-8");
    const routeSource = await fs.readFile(path.resolve("src/pages/TradesHallVisualPage.tsx"), "utf-8");

    expect(componentSource).toContain("@sparkjsdev/spark");
    expect(componentSource).toContain("SplatMesh");
    expect(componentSource).not.toContain("textSplats");
    expect(routeSource).not.toContain("textSplats");
    expect(componentSource).not.toMatch(/import\s+\{[^}]*\bSplat\b[^}]*\}\s+from\s+["']@react-three\/drei["']/);
    expect(routeSource).not.toMatch(/import\s+\{[^}]*\bSplat\b[^}]*\}\s+from\s+["']@react-three\/drei["']/);
  });

  it("keeps the Trades Hall visual layer behind a lazy internal route", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.resolve("src/router.tsx"), "utf-8");

    expect(source).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/TradesHallVisualPage\.js["']/);
    expect(source).toContain('path: "/dev/trades-hall-visual"');
    expect(source).not.toMatch(/^import\s+\{\s*TradesHallVisualPage\s*\}\s+from\s+["']\.\/pages\/TradesHallVisualPage/m);
  });
});
