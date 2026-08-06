import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as productionFacade from
  "../local-offline-normalization-preview-docker-sandbox-production.js";

const ALLOWED_RUNTIME_EXPORTS = Object.freeze([
  "createLocalOfflineNormalizationPreviewDockerSandbox",
  "isLocalOfflinePreviewDockerSandboxLiveWitness",
  "localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence",
]);

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIRECTORY = resolve(TEST_DIRECTORY, "..");
const REPOSITORY_ROOT = resolve(TEST_DIRECTORY, "..", "..", "..", "..");
const ESBUILD_MODULE = resolve(
  REPOSITORY_ROOT,
  "node_modules",
  ".pnpm",
  "esbuild@0.25.0",
  "node_modules",
  "esbuild",
  "lib",
  "main.js",
);

function objectValue(value: unknown, label: string): object {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} was not an object.`);
  }
  return value;
}

describe("production Docker sandbox facade", () => {
  it("exports exactly the production runtime surface", () => {
    const runtimeExports = Object.keys(productionFacade).sort();
    expect(runtimeExports).toEqual([...ALLOWED_RUNTIME_EXPORTS].sort());
    expect(runtimeExports.some((name) => name.startsWith("__testOnly"))).toBe(false);
  });

  it("does not retain the test factory in an esbuild dynamic chunk", async () => {
    const esbuildModule: unknown = await import(pathToFileURL(ESBUILD_MODULE).href);
    const build: unknown = Reflect.get(objectValue(esbuildModule, "esbuild module"), "build");
    if (typeof build !== "function") throw new TypeError("esbuild.build was unavailable.");

    const result: unknown = await Reflect.apply(build, undefined, [{
      stdin: {
        contents: [
          "export async function loadProductionDockerSandbox() {",
          "  return await import('./local-offline-normalization-preview-docker-sandbox-production.js');",
          "}",
        ].join("\n"),
        resolveDir: SOURCE_DIRECTORY,
        sourcefile: "production-docker-sandbox-dynamic-entry.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      splitting: true,
      outdir: "in-memory-production-docker-sandbox-bundle",
      write: false,
      packages: "external",
      treeShaking: true,
      logLevel: "silent",
    }]);
    const outputFiles: unknown = Reflect.get(objectValue(result, "esbuild result"), "outputFiles");
    if (!Array.isArray(outputFiles)) throw new TypeError("esbuild outputFiles were unavailable.");
    const bundledText = outputFiles.map((file, index) => {
      const text: unknown = Reflect.get(objectValue(file, `output file ${String(index)}`), "text");
      if (typeof text !== "string") throw new TypeError("esbuild output text was unavailable.");
      return text;
    }).join("\n");

    expect(outputFiles.length).toBeGreaterThan(1);
    expect(bundledText).toContain("createLocalOfflineNormalizationPreviewDockerSandbox");
    expect(bundledText).not.toContain(
      "__testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox",
    );
  });
});
