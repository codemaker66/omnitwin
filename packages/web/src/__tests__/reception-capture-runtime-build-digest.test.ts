import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS,
  assertReceptionCaptureRuntimeVersions,
  computeFileSetSha256,
  computeReceptionCaptureRuntimeEnvironmentDigest,
  computeReceptionCaptureRuntimeBuildDigest,
  receptionCaptureRuntimeEnvironment,
  receptionCaptureRuntimeBuildInputs,
} from "../../scripts/reception-capture-runtime-build-digest.mjs";

const temporaryDirectories: string[] = [];
const REQUIRED_PRODUCTION_INPUTS = [
  "package.json",
  "packages/types/dist/artifact-manifest.js",
  "packages/types/dist/asset-version.js",
  "packages/types/dist/canonical-layout-snapshot.js",
  "packages/types/dist/runtime-venue-manifest.js",
  "packages/types/dist/index.js",
  "packages/types/package.json",
  "packages/types/src/canonical-layout-snapshot.ts",
  "packages/web/index.html",
  "packages/web/package.json",
  "packages/web/scripts/reception-capture-runtime-build-digest.mjs",
  "packages/web/src/api/auth-bridge.ts",
  "packages/web/src/api/client.ts",
  "packages/web/src/api/runtime-packages.ts",
  "packages/web/src/components/scene/SparkSplatLayer.tsx",
  "packages/web/src/components/scene/spark-splat-source.ts",
  "packages/web/src/config/env.ts",
  "packages/web/src/data/room-geometries.ts",
  "packages/web/src/lib/layout-capacity.ts",
  "packages/web/src/lib/proposal-capacity-note.ts",
  "packages/web/src/lib/runtime-visual-asset.ts",
  "packages/web/src/lib/production-env.ts",
  "packages/web/src/lib/trades-hall-room-showcase.ts",
  "packages/web/src/lib/trades-hall-venue-truth.ts",
  "packages/web/src/pages/landing/rite-copy.ts",
  "packages/web/src/pages/landing/useReducedMotion.ts",
  "packages/web/src/pages/living-hall/GoldInkTable.tsx",
  "packages/web/src/pages/living-hall/LivingHallLocalPreflightPage.tsx",
  "packages/web/src/pages/living-hall/LivingHallPage.tsx",
  "packages/web/src/pages/living-hall/LivingHallScene.tsx",
  "packages/web/src/pages/living-hall/ReceptionCaptureAdapter.tsx",
  "packages/web/src/pages/living-hall/TurnSheet.tsx",
  "packages/web/src/pages/living-hall/YourTable.tsx",
  "packages/web/src/pages/living-hall/crane.ts",
  "packages/web/src/pages/living-hall/gold-ink.ts",
  "packages/web/src/pages/living-hall/living-hall-copy.ts",
  "packages/web/src/pages/living-hall/living-hall.css",
  "packages/web/src/pages/living-hall/reception-capture-binding-v1.json",
  "packages/web/src/pages/living-hall/reception-capture-contract.ts",
  "packages/web/src/pages/living-hall/reception-dolly-path.ts",
  "packages/web/src/pages/living-hall/reception-experimental-camera.ts",
  "packages/web/src/pages/living-hall/reception-local-preflight.ts",
  "packages/web/src/pages/living-hall/reception-review-views.ts",
  "packages/web/src/pages/living-hall/reception-runtime-profiles.ts",
  "packages/web/src/pages/living-hall/reception-viewer-profile.ts",
  "packages/web/src/pages/living-hall/turn.ts",
  "packages/web/src/pages/living-hall/useLivingHallRuntimeAsset.ts",
  "packages/web/src/pages/living-hall/useLivingHallScroll.ts",
  "packages/web/src/pages/living-hall/useSectionScrollProgress.ts",
  "packages/web/src/router.tsx",
  "packages/web/src/global.css",
  "packages/web/src/main.tsx",
  "packages/web/src/styles/house-tokens.css",
  "packages/web/tsconfig.json",
  "packages/web/vite.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
] as const;

async function makeInputTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-capture-build-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "packages", "web", "src", "pages", "living-hall"), { recursive: true });
  await writeFile(join(root, "packages", "web", "package.json"), JSON.stringify({
    version: "1.0.0",
    dependencies: {
      three: "0.180.0",
      "@sparkjsdev/spark": "2.0.0",
      "@react-three/fiber": "8.18.0",
    },
    devDependencies: {
      vite: "6.4.3",
      "@vitejs/plugin-react": "4.3.4",
      "@playwright/test": "1.59.1",
    },
  }));
  await writeFile(
    join(root, "packages", "web", "src", "pages", "living-hall", "reception-capture-binding-v1.json"),
    JSON.stringify({
      lockedRuntimeVersions: {
        three: "0.180.0",
        spark: "2.0.0",
        reactThreeFiber: "8.18.0",
        vite: "6.4.3",
        viteReactPlugin: "4.3.4",
        playwrightTest: "1.59.1",
      },
    }),
  );
  const installedPackages = [
    ["three", "three", "0.180.0"],
    [join("@sparkjsdev", "spark"), "@sparkjsdev/spark", "2.0.0"],
    [join("@react-three", "fiber"), "@react-three/fiber", "8.18.0"],
    ["vite", "vite", "6.4.3"],
    [join("@vitejs", "plugin-react"), "@vitejs/plugin-react", "4.3.4"],
    [join("@playwright", "test"), "@playwright/test", "1.59.1"],
  ] as const;
  for (const [packagePath, name, version] of installedPackages) {
    const directory = join(root, "packages", "web", "node_modules", packagePath);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }));
  }
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("Reception capture runtime build digest inputs", () => {
  const inputs = ["packages/web/package.json", "pnpm-lock.yaml"] as const;

  it("is deterministic and changes when a package version changes", async () => {
    const root = await makeInputTree();
    const first = computeFileSetSha256(root, inputs);
    expect(computeFileSetSha256(root, inputs)).toBe(first);

    await writeFile(join(root, "packages", "web", "package.json"), '{"version":"1.0.1"}');
    expect(computeFileSetSha256(root, inputs)).not.toBe(first);
  });

  it("changes when the dependency lock changes", async () => {
    const root = await makeInputTree();
    const first = computeFileSetSha256(root, inputs);
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");
    expect(computeFileSetSha256(root, inputs)).not.toBe(first);
  });

  it("rejects a renderer package version that differs from the binding lock", async () => {
    const root = await makeInputTree();
    expect(() => { assertReceptionCaptureRuntimeVersions(root); }).not.toThrow();
    await writeFile(join(root, "packages", "web", "package.json"), JSON.stringify({
      dependencies: {
        three: "0.181.0",
        "@sparkjsdev/spark": "2.0.0",
        "@react-three/fiber": "8.18.0",
      },
      devDependencies: {
        vite: "6.4.3",
        "@vitejs/plugin-react": "4.3.4",
        "@playwright/test": "1.59.1",
      },
    }));
    expect(() => { assertReceptionCaptureRuntimeVersions(root); }).toThrow(/three/u);
  });

  it("rejects an installed renderer version that differs from the binding lock", async () => {
    const root = await makeInputTree();
    await writeFile(
      join(root, "packages", "web", "node_modules", "@sparkjsdev", "spark", "package.json"),
      JSON.stringify({ name: "@sparkjsdev/spark", version: "2.0.1" }),
    );
    expect(() => { assertReceptionCaptureRuntimeVersions(root); }).toThrow(/spark/u);
  });

  it("fingerprints only the two normalized non-secret capture origins", () => {
    const environment = {
      VITE_RECEPTION_MOBILE_ORIGIN: "http://127.0.0.1:5182/",
      VITE_RECEPTION_QUALITY_ORIGIN: "http://127.0.0.1:5181",
      DATABASE_PASSWORD: "must-never-enter-the-manifest",
    };
    expect(receptionCaptureRuntimeEnvironment(environment)).toEqual({
      mobileOrigin: "http://127.0.0.1:5182",
      qualityOrigin: "http://127.0.0.1:5181",
    });
    expect(computeReceptionCaptureRuntimeEnvironmentDigest(environment)).toBe(
      computeReceptionCaptureRuntimeEnvironmentDigest({
        VITE_RECEPTION_MOBILE_ORIGIN: "http://127.0.0.1:5182",
        VITE_RECEPTION_QUALITY_ORIGIN: "http://127.0.0.1:5181/",
      }),
    );
    expect(computeReceptionCaptureRuntimeEnvironmentDigest(environment)).not.toBe(
      computeReceptionCaptureRuntimeEnvironmentDigest({}),
    );
    expect(receptionCaptureRuntimeEnvironment({})).toEqual({
      mobileOrigin: "http://127.0.0.1:4174",
      qualityOrigin: "",
    });
    expect(() => receptionCaptureRuntimeEnvironment({
      VITE_RECEPTION_QUALITY_ORIGIN: "http://127.0.0.1:5181/not-an-origin",
    })).toThrow(/explicit 127\.0\.0\.1 HTTP port/u);
    expect(() => receptionCaptureRuntimeEnvironment({
      VITE_RECEPTION_QUALITY_ORIGIN: "https://example.com:5181",
    })).toThrow(/explicit 127\.0\.0\.1 HTTP port/u);
  });

  it("stops clearly when a required input is missing", async () => {
    const root = await makeInputTree();
    expect(() => computeFileSetSha256(root, ["missing.ts", ...inputs]))
      .toThrow("Cannot fingerprint required Reception capture build input: missing.ts");
  });

  it("rejects duplicate, unsorted, absolute, and escaping paths", async () => {
    const root = await makeInputTree();
    expect(() => computeFileSetSha256(root, [inputs[0], inputs[0]]))
      .toThrow("must not contain duplicate paths");
    expect(() => computeFileSetSha256(root, [...inputs].reverse()))
      .toThrow("must be sorted by repository path");
    expect(() => computeFileSetSha256(root, [root]))
      .toThrow("must be a repository-relative path");
    expect(() => computeFileSetSha256(root, ["../outside.txt"]))
      .toThrow("leaves the repository");
  });
});

describe("Reception capture production build identity", () => {
  it("discovers all runtime source files, stays sorted, and produces a SHA-256 digest", () => {
    const repositoryRoot = resolve(process.cwd(), "../..");
    const inputs = receptionCaptureRuntimeBuildInputs(repositoryRoot);
    expect(RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS)
      .toEqual([...RECEPTION_CAPTURE_RUNTIME_BUILD_FIXED_INPUTS].sort());
    expect(inputs).toEqual([...inputs].sort());
    expect(new Set(inputs).size).toBe(inputs.length);
    expect(inputs).toEqual(expect.arrayContaining([...REQUIRED_PRODUCTION_INPUTS]));
    expect(inputs.some((input) => /(?:__tests__|__mocks__|\.(?:spec|stories|test)\.)/u.test(input)))
      .toBe(false);
    expect(computeReceptionCaptureRuntimeBuildDigest(repositoryRoot))
      .toMatch(/^[a-f0-9]{64}$/u);
  });

  it("injects and declares the exact build digest constant", async () => {
    const [viteConfig, viteTypes] = await Promise.all([
      readFile(resolve(process.cwd(), "vite.config.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/vite-env.d.ts"), "utf8"),
    ]);
    expect(viteConfig).toContain("computeReceptionCaptureRuntimeBuildDigest(repositoryRoot)");
    expect(viteConfig).toContain(
      "computeReceptionCaptureRuntimeEnvironmentDigest(receptionCaptureEnvironment)",
    );
    expect(viteConfig).toContain("__VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__");
    expect(viteConfig).toContain("__VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__");
    expect(viteTypes).toContain(
      "declare const __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__: string;",
    );
    expect(viteTypes).toContain(
      "declare const __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__: string;",
    );
  });
});
