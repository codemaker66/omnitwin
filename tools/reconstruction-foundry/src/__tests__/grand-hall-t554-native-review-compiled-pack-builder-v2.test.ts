import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  __testOnlyGrandHallT554NativeReviewCompiledPackBuilderV2,
  buildGrandHallT554NativeReviewCompiledPackV2,
  type GrandHallT554NativeReviewCompiledPackBuildResultV2,
} from "../grand-hall-t554-native-review-compiled-pack-builder.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
  isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2,
} from "../grand-hall-t554-native-review-implementation-manifest-v2.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

const EXACT_MEMBER_KINDS = Object.freeze({
  "package.json": "module-metadata",
  "server/grand-hall-t554-native-review-http-response-adapter-v2.js":
    "trusted-http-adapter",
  "server/grand-hall-t554-native-review-payload-core-v2.js": "payload-core",
  "server/grand-hall-t554-native-review-payload-gate-v2.js":
    "payload-admission-gate",
  "server/native-review-runtime-bootstrap.js": "runtime-bootstrap",
  "static/index.html": "static-asset",
  "static/review.css": "static-asset",
  "static/review.js": "static-asset",
  "vendor/decoder-runtime.json": "decoder-closure-metadata",
  "vendor/libvips/libvips-42.dll": "libvips-native-dependency",
  "vendor/libvips/libvips-cpp-8.18.3.dll": "libvips-native-dependency",
  "vendor/runtime-attestation/decoder-probe.jpg": "runtime-attestation-probe",
  "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node":
    "runtime-inspector-addon",
  "vendor/sharp/loader.js": "sharp-runtime",
  "vendor/sharp/sharp-win32-x64-0.35.3.node": "sharp-native-addon",
});

const FORBIDDEN_V1_AUTHORITY_SURFACES = Object.freeze([
  "VERIFIED_IMPLEMENTATION_PACK_IDENTITIES",
  "VERIFIED_IMPLEMENTATION_PACK_CANDIDATE_IDENTITIES",
  "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_IDENTITIES",
  "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_PACKS",
  "fixedProductionReviewedPack",
  "verifyGrandHallT554NativeReviewImplementationPack",
  "verifyCallerAnchoredImplementationPackCandidate",
  "__testOnlyGrandHallT554NativeReviewImplementationManifest",
]);

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .reverse()
      .map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

async function buildPack(
  leaf: string,
): Promise<GrandHallT554NativeReviewCompiledPackBuildResultV2> {
  const parent = await mkdtemp(joinTempPrefix());
  roots.push(parent);
  return buildGrandHallT554NativeReviewCompiledPackV2({
    workspaceRoot: resolve(process.cwd(), "..", ".."),
    outputRoot: resolve(parent, leaf),
  });
}

function joinTempPrefix(): string {
  return resolve(tmpdir(), "t554-compiled-pack-v2-test-");
}

function occurrences(source: string, literal: string): number {
  return source.split(literal).length - 1;
}

function nonBuiltinImports(imports: readonly string[]): readonly string[] {
  return imports.filter((specifier) => !specifier.startsWith("node:")).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

describe.runIf(process.platform === "win32" && process.arch === "x64")(
  "Grand Hall T-554 fixed-admission compiled payload-pack V2 builder",
  () => {
    it.each([
      "../ambient/node_modules/zod/lib/index.mjs",
      "packages/types/src/index.ts",
    ])("rejects an injected unreviewed metafile input %s", (injected) => {
      const reviewed =
        __testOnlyGrandHallT554NativeReviewCompiledPackBuilderV2.reviewedCoreMetafileInputKeys();
      expect(() => {
        __testOnlyGrandHallT554NativeReviewCompiledPackBuilderV2.assertExactCoreMetafileInputClosure(
          [...reviewed, injected],
        );
      }).toThrowError(
        expect.objectContaining({ code: "DEPENDENCY_CLOSURE_INVALID" }),
      );
    });

    it("builds the exact authority-none closure twice and fails closed when the capsule cannot resolve", async () => {
      const first = await buildPack("pack-a");
      const second = await buildPack("pack-b");

      expect(first.verifiedCandidate).toMatchObject({
        schemaVersion:
          "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v2",
        concreteBytesVerified: true,
        exactRootInventoryVerified: true,
        fixedAdmissionBindingVerified: true,
        authority: "none",
        standaloneProductionFactoryAvailable: false,
        runtimeAuthorityAvailable: false,
      });
      expect(
        isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(
          first.verifiedCandidate,
        ),
      ).toBe(true);
      expect(first.manifest).toMatchObject({
        authority: "none",
        memberCount: 15,
        execution: {
          fixedAdmissionGatedFactoryIncluded: true,
          standaloneProductionFactoryIncluded: false,
          httpLaunchIncluded: false,
          sourceMapsIncluded: false,
          externalNetworkAuthorized: false,
          acceptanceAuthorized: false,
          reconstructionAuthorized: false,
          runtimeAdmissionAuthorized: false,
          exportAuthorized: false,
          generatedContentAuthorized: false,
        },
      });

      expect(
        Object.fromEntries(
          first.manifest.members.map((member) => [
            member.relativePath,
            member.kind,
          ]),
        ),
      ).toEqual(EXACT_MEMBER_KINDS);
      expect(nonBuiltinImports(first.gateExternalImports)).toEqual(
        [
          GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ].sort(),
      );
      expect(nonBuiltinImports(first.coreExternalImports)).toEqual(
        [
          GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ].sort(),
      );
      expect(nonBuiltinImports(first.httpAdapterExternalImports)).toEqual([]);
      expect(nonBuiltinImports(first.runtimeBootstrapExternalImports)).toEqual(
        [],
      );
      expect(nonBuiltinImports(first.sharpLoaderExternalImports)).toEqual([]);
      expect(first.gateOutputImports).toEqual(
        expect.arrayContaining([
          {
            path: GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
            kind: "import-statement",
            external: true,
          },
          {
            path: GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
            kind: "dynamic-import",
            external: true,
          },
        ]),
      );
      expect(first.coreOutputImports).toEqual(
        expect.arrayContaining([
          {
            path: GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
            kind: "import-statement",
            external: true,
          },
          {
            path: GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
            kind: "import-statement",
            external: true,
          },
          {
            path: GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
            kind: "import-statement",
            external: true,
          },
        ]),
      );
      expect(first.gateExports).toEqual([
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_ABI_WITNESS_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_POLICY_V2",
        "loadGrandHallT554NativeReviewPayloadCoreV2",
      ]);
      expect(first.coreExports).toEqual([
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_ABI_WITNESS_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_POLICY_V2",
        "GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_V2",
        "createGrandHallT554NativeReviewPayloadWorkbenchV2",
      ]);
      expect(first.httpAdapterExports).toEqual([
        "GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_V2",
        "GrandHallT554NativeReviewHttpResponseAdapterErrorV2",
        "bindGrandHallT554NativeReviewTileToHttpResponseV2",
      ]);
      expect(first.runtimeBootstrapExports).toEqual([
        "runGrandHallT554NativeReviewRuntimeBootstrap",
      ]);
      expect(first.sharpLoaderExports).toEqual(["default"]);

      const [gateSource, coreSource, adapterSource] = await Promise.all([
        readFile(
          resolve(first.packRoot, first.manifest.admission.gateModule),
          "utf8",
        ),
        readFile(
          resolve(first.packRoot, first.manifest.admission.coreModule),
          "utf8",
        ),
        readFile(
          resolve(
            first.packRoot,
            first.manifest.admission.trustedHttpAdapterModule,
          ),
          "utf8",
        ),
      ]);
      expect(
        occurrences(
          gateSource,
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ),
      ).toBe(1);
      expect(
        occurrences(
          coreSource,
          GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
        ),
      ).toBe(1);
      expect(
        occurrences(
          gateSource,
          GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
        ),
      ).toBe(1);
      expect(
        occurrences(
          coreSource,
          GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
        ),
      ).toBe(1);
      expect(
        occurrences(
          coreSource,
          GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
        ),
      ).toBe(1);
      expect(adapterSource).not.toContain(
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
      );
      for (const source of [gateSource, coreSource, adapterSource]) {
        expect(source).not.toContain("sourceMappingURL");
        for (const forbidden of FORBIDDEN_V1_AUTHORITY_SURFACES) {
          expect(source).not.toContain(forbidden);
        }
      }

      const firstManifestBytes = await readFile(
        resolve(
          first.packRoot,
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
        ),
      );
      const secondManifestBytes = await readFile(
        resolve(
          second.packRoot,
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
        ),
      );
      expect(secondManifestBytes).toEqual(firstManifestBytes);
      expect(second.manifest.semanticSha256).toBe(
        first.manifest.semanticSha256,
      );
      expect(second.manifest.members).toEqual(first.manifest.members);
      for (const member of first.manifest.members) {
        expect(
          await readFile(resolve(second.packRoot, member.relativePath)),
        ).toEqual(await readFile(resolve(first.packRoot, member.relativePath)));
      }

      const denialLoaderPath = resolve(
        first.packRoot,
        "..",
        "deny-fixed-capsule-loader.mjs",
      );
      await writeFile(
        denialLoaderPath,
        `const BLOCKED = ${JSON.stringify(GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === BLOCKED) throw new Error("FIXED_CAPSULE_UNAVAILABLE");
  return nextResolve(specifier, context);
}
`,
        { encoding: "utf8", flag: "wx" },
      );
      const sessionRoot = resolve(
        first.packRoot,
        "operator-session-must-not-exist",
      );
      const childScript = `import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.T554_PACK_ROOT;
if (!root) throw new Error("T554_PACK_ROOT is missing");
const originalPath = process.env.PATH;
const outcomes = {};
for (const [label, member] of Object.entries({
  gate: ${JSON.stringify(first.manifest.admission.gateModule)},
  core: ${JSON.stringify(first.manifest.admission.coreModule)}
})) {
  try {
    await import(pathToFileURL(resolve(root, member)).href);
    outcomes[label] = "imported";
  } catch (error) {
    outcomes[label] = error instanceof Error ? error.message : "rejected";
  }
}
process.stdout.write(JSON.stringify({ outcomes, pathUnchanged: process.env.PATH === originalPath }));
`;
      const child = await execFileAsync(
        process.execPath,
        [
          "--experimental-loader",
          pathToFileURL(denialLoaderPath).href,
          "--input-type=module",
          "--eval",
          childScript,
        ],
        {
          cwd: first.packRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_OPTIONS: "",
            NODE_PATH: "",
            PATH: "C:\\unreviewed-path-contamination",
            T554_PACK_ROOT: first.packRoot,
            T554_SESSION_ROOT: sessionRoot,
          },
          maxBuffer: 1_024 * 1_024,
          windowsHide: true,
        },
      );
      const childResult = JSON.parse(child.stdout) as unknown;
      expect(isRecord(childResult)).toBe(true);
      if (!isRecord(childResult)) {
        throw new Error("The denied-capsule child result is invalid.");
      }
      expect(childResult).toMatchObject({
        outcomes: {
          gate: "FIXED_CAPSULE_UNAVAILABLE",
          core: "FIXED_CAPSULE_UNAVAILABLE",
        },
        pathUnchanged: true,
      });
      await expect(lstat(sessionRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }, 180_000);

    it("never overwrites a destination created immediately before publish", async () => {
      const parent = await mkdtemp(joinTempPrefix());
      roots.push(parent);
      const outputRoot = resolve(parent, "attacker-owned-destination");
      const attackerBytes = "attacker-owned-destination\n";

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV2({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            async beforeAtomicPublish() {
              await writeFile(outputRoot, attackerBytes, { flag: "wx" });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
      await expect(readFile(outputRoot, "utf8")).resolves.toBe(attackerBytes);
    }, 180_000);

    it("does not clean an attacker replacement of its staging root", async () => {
      const parent = await mkdtemp(joinTempPrefix());
      roots.push(parent);
      const outputRoot = resolve(parent, "must-not-publish");
      let replacementMarker: string | undefined;

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV2({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            async afterStagingRootCreated(stagingRoot) {
              await rm(stagingRoot, { force: true, recursive: true });
              await mkdir(stagingRoot);
              replacementMarker = resolve(stagingRoot, "attacker-marker.txt");
              await writeFile(replacementMarker, "attacker-owned\n", {
                flag: "wx",
              });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE" });
      expect(replacementMarker).toBeDefined();
      if (replacementMarker === undefined) {
        throw new Error("The staging replacement seam did not run.");
      }
      await expect(readFile(replacementMarker, "utf8")).resolves.toBe(
        "attacker-owned\n",
      );
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }, 180_000);

    it("removes its published root when post-rename verification fails", async () => {
      const parent = await mkdtemp(joinTempPrefix());
      roots.push(parent);
      const outputRoot = resolve(parent, "post-rename-verification-failure");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV2({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            async afterAtomicPublish(facts) {
              await writeFile(
                resolve(facts.outputRoot, "unexpected-member.txt"),
                "invalidates exact inventory\n",
                { flag: "wx" },
              );
            },
          },
        }),
      ).rejects.toMatchObject({ code: "BUILD_FAILED" });
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }, 180_000);

    it("does not clean an attacker replacement of its published root", async () => {
      const parent = await mkdtemp(joinTempPrefix());
      roots.push(parent);
      const outputRoot = resolve(parent, "published-root-replacement");
      const displacedRoot = resolve(parent, "displaced-owned-pack");
      const replacementMarker = resolve(outputRoot, "attacker-marker.txt");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV2({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            async afterAtomicPublish(facts) {
              await rename(facts.outputRoot, displacedRoot);
              await mkdir(facts.outputRoot);
              await writeFile(replacementMarker, "attacker-owned\n", {
                flag: "wx",
              });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE" });
      await expect(readFile(replacementMarker, "utf8")).resolves.toBe(
        "attacker-owned\n",
      );
      expect((await lstat(displacedRoot)).isDirectory()).toBe(true);
    }, 180_000);
  },
);
