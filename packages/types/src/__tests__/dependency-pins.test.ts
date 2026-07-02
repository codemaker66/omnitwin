import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DependencyMap = Record<string, string>;

interface PackageManifest {
  readonly dependencies?: DependencyMap;
  readonly devDependencies?: DependencyMap;
  readonly peerDependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../../..");

const MANIFESTS = [
  "packages/api/package.json",
  "packages/types/package.json",
  "packages/web/package.json",
] as const;

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDependencyMap(value: unknown): DependencyMap | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Dependency block is not an object");

  const entries = Object.entries(value).map(([name, specifier]) => {
    if (typeof specifier !== "string") {
      throw new Error(`Dependency ${name} has a non-string specifier`);
    }
    return [name, specifier] as const;
  });

  return Object.fromEntries(entries);
}

async function readManifest(relativePath: string): Promise<PackageManifest> {
  const raw = await readFile(path.join(REPO_ROOT, relativePath), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error(`${relativePath} is not a JSON object`);

  return {
    dependencies: readDependencyMap(parsed["dependencies"]),
    devDependencies: readDependencyMap(parsed["devDependencies"]),
    peerDependencies: readDependencyMap(parsed["peerDependencies"]),
    optionalDependencies: readDependencyMap(parsed["optionalDependencies"]),
  };
}

function directDependencyBlocks(manifest: PackageManifest): readonly DependencyMap[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].filter((block): block is DependencyMap => block !== undefined);
}

function isAllowedSpecifier(specifier: string): boolean {
  return specifier === "workspace:*" || EXACT_VERSION_PATTERN.test(specifier);
}

describe("direct dependency reproducibility", () => {
  it("pins every direct workspace package dependency to an exact version", async () => {
    const violations: string[] = [];

    for (const manifestPath of MANIFESTS) {
      const manifest = await readManifest(manifestPath);
      for (const block of directDependencyBlocks(manifest)) {
        for (const [name, specifier] of Object.entries(block)) {
          if (!isAllowedSpecifier(specifier)) {
            violations.push(`${manifestPath} ${name}: ${specifier}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the Spark/Three renderer matrix pinned together", async () => {
    const web = await readManifest("packages/web/package.json");

    expect(web.dependencies?.["@sparkjsdev/spark"]).toBe("2.0.0");
    expect(web.dependencies?.["three"]).toBe("0.180.0");
    expect(web.devDependencies?.["@types/three"]).toBe("0.180.0");
    expect(web.dependencies?.["@react-three/fiber"]).toBe("8.18.0");
    expect(web.dependencies?.["@react-three/drei"]).toBe("9.122.0");
  });

  it("keeps auth and build tooling on exact audited pins", async () => {
    const api = await readManifest("packages/api/package.json");
    const web = await readManifest("packages/web/package.json");

    expect(api.dependencies?.["@clerk/backend"]).toBe("3.4.1");
    expect(api.dependencies?.["@clerk/fastify"]).toBe("3.1.19");
    // 6.11.0 audited with the OAuth consent route work (9fcfe339, 2026-06-25).
    expect(web.dependencies?.["@clerk/react"]).toBe("6.11.0");
    expect(web.devDependencies?.["vite"]).toBe("6.4.3");
    expect(web.devDependencies?.["vitest"]).toBe("4.1.8");
    expect(api.devDependencies?.["vitest"]).toBe("4.1.8");
  });
});
