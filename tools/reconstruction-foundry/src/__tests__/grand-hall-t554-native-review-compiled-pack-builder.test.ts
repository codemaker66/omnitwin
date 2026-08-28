import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildGrandHallT554NativeReviewCompiledPackV1,
  type GrandHallT554NativeReviewCompiledPackBuildResultV1,
} from "../grand-hall-t554-native-review-compiled-pack-builder.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  __testOnlyGrandHallT554NativeReviewImplementationManifest,
  isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
  isGrandHallT554VerifiedNativeReviewImplementationPackV1,
} from "../grand-hall-t554-native-review-implementation-manifest.js";
import {
  attestGrandHallT554NativeReviewRuntimeCandidateV1,
  attestGrandHallT554NativeReviewProductionRuntimeAuthorityV1,
  isGrandHallT554NativeReviewRuntimeAttestationCandidateV1,
} from "../grand-hall-t554-native-review-runtime-attestation.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const FORBIDDEN_COMPILED_CORE_TEST_AUTHORITY_SYMBOLS = Object.freeze([
  "__testOnlyGrandHallT554MediaValidation",
  "__testOnlyGrandHallT554NativeMaskRevisionStore",
  "__testOnlyGrandHallT554NativeMediaKernel",
  "__testOnlyGrandHallT554NativeReviewImplementationManifest",
  "__testOnlyGrandHallT554NativeReviewRegistry",
  "__testOnlyGrandHallT554NativeReviewSessionOwnerV2",
  "__testOnlyGrandHallT554NativeReviewSessionStoreV2",
  "__testOnlyGrandHallT554NativeReviewSessionV1",
  "__testOnlyGrandHallT554NativeSourceEpochV1",
  "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_IDENTITIES",
  "LOADED_IMPLEMENTATION_RUNTIME_AUTHORITY_PACKS",
  "VERIFIED_IMPLEMENTATION_PACK_IDENTITIES",
  "fixedProductionReviewedPack",
  "verifyCallerAnchoredImplementationPackCandidate",
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
): Promise<GrandHallT554NativeReviewCompiledPackBuildResultV1> {
  const parent = await mkdtemp(join(tmpdir(), "t554-compiled-pack-test-"));
  roots.push(parent);
  return buildGrandHallT554NativeReviewCompiledPackV1({
    workspaceRoot: resolve(process.cwd(), "..", ".."),
    outputRoot: resolve(parent, leaf),
  });
}

function isModuleRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function exactEsmExportNames(source: string): readonly string[] {
  const match = /export\{([^{}]+)\};?\s*$/u.exec(source);
  if (match?.[1] === undefined) {
    throw new Error("Compiled ESM bundle has no exact terminal export list.");
  }
  return Object.freeze(
    match[1]
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/u).at(-1))
      .filter((entry): entry is string => entry !== undefined)
      .sort(),
  );
}

describe.runIf(process.platform === "win32" && process.arch === "x64")(
  "Grand Hall T-554 compiled implementation-pack builder",
  () => {
    it("builds, fully byte-verifies, then imports only the safe compiled entrypoints", async () => {
      const pack = await buildPack("pack");

      expect(pack.verifiedCandidate).toMatchObject({
        schemaVersion:
          "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v1",
        concreteBytesVerified: true,
        exactRootInventoryVerified: true,
        runtimeIdentityVerified: true,
        authority: "none",
        productionFactoryAvailable: false,
        releaseReady: false,
      });
      expect(
        isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(
          pack.verifiedCandidate,
        ),
      ).toBe(true);
      expect(
        isGrandHallT554VerifiedNativeReviewImplementationPackV1(
          pack.verifiedCandidate,
        ),
      ).toBe(false);
      expect(pack.runtimeAttestationStatus).toBe("attested-candidate");
      expect(pack.runtimeAttestationCandidate).not.toBeNull();
      if (pack.runtimeAttestationCandidate === null) {
        throw new Error("Authority-none runtime attestation candidate is missing.");
      }
      expect(
        isGrandHallT554NativeReviewRuntimeAttestationCandidateV1(
          pack.runtimeAttestationCandidate,
        ),
      ).toBe(true);
      expect(pack.runtimeAttestationCandidate).toMatchObject({
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-runtime-attestation-candidate.v1",
        diagnosticOnly: true,
        authority: "none",
        productionRuntimeAuthorityMinted: false,
        bootstrap: {
          sharpVersion: "0.35.3",
          libvipsVersion: "8.18.3",
          targetNativeModulesAbsentBeforeSharpImport: true,
          exactReviewedNativeModuleMultiplicityVerified: true,
          loadedModuleInventoryStableAcrossDecode: true,
          loadedModuleInventoryStableAfterDllDirectoryRemoval: true,
          dllDirectoryConfiguredBeforeSharpImport: true,
          dllDirectoryRevalidatedBeforeSharpImport: true,
          dllDirectoryRevalidatedAfterDecode: true,
          dllDirectoryRemoved: true,
          authority: "none",
        },
        processIsolation: {
          freshChildProcess: true,
          execArgvEmpty: true,
          environmentCleared: true,
          cwdBoundToPackRoot: true,
          entryArgvBoundToAttestor: true,
          commonJsResolutionRestrictedToBuiltinsAndExactReviewedNativeAddons:
            true,
          selectedNetworkEntrypointsPatched: true,
          dynamicEsmImportsBoundToExactPackMembers: true,
          postImportPackReverified: true,
        },
      });
      expect(Object.isFrozen(pack.runtimeAttestationCandidate)).toBe(true);
      expect(Object.isFrozen(pack.runtimeAttestationCandidate.bootstrap)).toBe(
        true,
      );
      expect(
        isGrandHallT554NativeReviewRuntimeAttestationCandidateV1({
          ...pack.runtimeAttestationCandidate,
        }),
      ).toBe(false);
      expect(JSON.stringify(pack.runtimeAttestationCandidate)).not.toContain(
        pack.packRoot,
      );
      expect(
        isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
          pack.runtimeAttestationCandidate,
        ),
      ).toBe(false);
      await expect(
        attestGrandHallT554NativeReviewProductionRuntimeAuthorityV1(),
      ).rejects.toMatchObject({ code: "REVIEWED_PACK_NOT_CONFIGURED" });
      await expect(
        attestGrandHallT554NativeReviewRuntimeCandidateV1({
          implementationPackRoot: pack.packRoot,
          candidate: { ...pack.verifiedCandidate },
        }),
      ).rejects.toMatchObject({ code: "CANDIDATE_UNVERIFIED" });
      expect(pack.manifest).toMatchObject({
        memberCount: 15,
        sourceCount: 148,
        authority: "none",
        decoder: {
          sharpVersion: "0.35.3",
          libvipsVersion: "8.18.3",
          platform: "win32",
          architecture: "x64",
          sharpNativeAddonMember:
            "vendor/sharp/sharp-win32-x64-0.35.3.node",
          libvipsNativeDependencyMembers: [
            "vendor/libvips/libvips-42.dll",
            "vendor/libvips/libvips-cpp-8.18.3.dll",
          ],
        },
        execution: {
          productionFactoryIncluded: false,
          httpLaunchIncluded: false,
          browserControlledTruthAuthorized: false,
          acceptanceAuthorized: false,
          reconstructionAuthorized: false,
          runtimeAdmissionAuthorized: false,
          exportAuthorized: false,
          generatedContentAuthorized: false,
        },
      });
      expect(pack.manifest.totalMemberBytes).toBeLessThan(128 * 1_024 * 1_024);
      expect(pack.coreExternalImports).toContain(
        "../vendor/sharp/loader.js",
      );
      expect(
        pack.coreExternalImports.every(
          (specifier) =>
            specifier.startsWith("node:") ||
            specifier === "../vendor/sharp/loader.js",
        ),
      ).toBe(true);
      expect(
        pack.httpAdapterExternalImports.every((specifier) =>
          specifier.startsWith("node:"),
        ),
      ).toBe(true);
      expect(
        pack.runtimeAttestorExternalImports.every((specifier) =>
          specifier.startsWith("node:"),
        ),
      ).toBe(true);
      expect(
        pack.runtimeBootstrapExternalImports.every((specifier) =>
          specifier.startsWith("node:"),
        ),
      ).toBe(true);
      expect(
        pack.sharpLoaderExternalImports.every((specifier) =>
          specifier.startsWith("node:"),
        ),
      ).toBe(true);
      const executableBundleTexts = await Promise.all(
        [
          pack.manifest.serverBundleModule,
          "server/native-review-runtime-attestor.js",
          "server/native-review-runtime-bootstrap.js",
        ].map((member) => readFile(resolve(pack.packRoot, member), "utf8")),
      );
      for (const executableBundleText of executableBundleTexts) {
        for (const forbiddenSymbol of FORBIDDEN_COMPILED_CORE_TEST_AUTHORITY_SYMBOLS) {
          expect(executableBundleText).not.toContain(forbiddenSymbol);
        }
        expect(
          [
            ...new Set(
              executableBundleText.match(/\b__testOnly[A-Za-z0-9_]*/gu) ?? [],
            ),
          ].sort(),
        ).toEqual([]);
      }
      const serverBundleText = executableBundleTexts[0];
      const runtimeBootstrapText = executableBundleTexts[2];
      expect(serverBundleText).toBeDefined();
      expect(runtimeBootstrapText).toBeDefined();
      if (serverBundleText === undefined || runtimeBootstrapText === undefined) {
        throw new Error("Compiled server/bootstrap bundle text is missing.");
      }
      expect(runtimeBootstrapText).not.toContain("toLocaleLowerCase");
      expect(runtimeBootstrapText).toContain(
        "loaded-module inventory is not stable",
      );
      expect(runtimeBootstrapText).toContain("revalidateDllDirectory");
      expect(runtimeBootstrapText).toContain(
        "runtime DLL directory changed before the Sharp import boundary",
      );
      expect(runtimeBootstrapText).toContain(
        "runtime DLL directory changed after the decoder proof boundary",
      );
      const compiledCoreExportNames = exactEsmExportNames(serverBundleText);
      for (const requiredExport of [
        "acquireGrandHallT554NativeReviewSessionOwnerV2",
        "assertGrandHallT554NativeReviewSessionOwnerV2",
        "explicitlyTakeOverGrandHallT554NativeReviewSessionOwnerAfterCrashV2",
        "inspectGrandHallT554NativeReviewPriorOwnerV2",
        "openGrandHallT554NativeReviewSessionStoreV2",
        "releaseGrandHallT554NativeReviewSessionOwnerV2",
        "verifyGrandHallT554NativeMaskStateReplayV2",
      ]) {
        expect(compiledCoreExportNames).toContain(requiredExport);
      }
      for (const forbiddenExport of [
        "createGrandHallT554NativeReviewDurableJournalV2",
        "openGrandHallT554NativeReviewDurableJournalV2",
        "openGrandHallT554NativeReviewVerifiedDurableChildEvidenceV2",
        "GrandHallT554NativeMaskRevisionStore",
      ]) {
        expect(compiledCoreExportNames).not.toContain(forbiddenExport);
      }
      const sharpLoaderText = await readFile(
        resolve(pack.packRoot, "vendor", "sharp", "loader.js"),
        "utf8",
      );
      expect(sharpLoaderText).not.toMatch(
        /process\.env(?:\[\s*["']PATH["']\s*\]|\.PATH)\s*=/u,
      );
      expect(sharpLoaderText).not.toContain("libvipsDirectory");
      // The dynamic imports are intentionally below the completed whole-pack
      // verification assertions. The core must still fail before the reviewed
      // DLL-directory registration gate; only the native-free adapter imports.
      const childScript = `import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.T554_PACK_ROOT;
if (!root) throw new Error("T554_PACK_ROOT is missing");
const manifest = JSON.parse(await readFile(resolve(root, "grand-hall-t554-native-review-implementation-manifest.json"), "utf8"));
const originalPath = process.env.PATH;
let coreImportRejected = false;
try {
  await import(pathToFileURL(resolve(root, manifest.serverBundleModule)).href);
} catch {
  coreImportRejected = true;
}
const pathUnchanged = process.env.PATH === originalPath;
const adapter = await import(pathToFileURL(resolve(root, manifest.trustedHttpAdapterModule)).href);
const response = new (class extends EventEmitter { writableFinished = false; })();
let recordCount = 0;
const lifecycle = adapter.recordGrandHallT554NativeReviewTileDeliveryAfterResponseFinish({
  response,
  recordTileDelivery: () => { recordCount += 1; }
});
response.emit("finish");
const outcome = await lifecycle.completion;
process.stdout.write(JSON.stringify({
  coreImportRejected,
  pathUnchanged,
  recordCount,
  outcome
}));
`;
      const child = await execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", childScript],
        {
          cwd: pack.packRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_OPTIONS: "",
            NODE_PATH: "",
            PATH: "C:\\unreviewed-path-contamination",
            T554_PACK_ROOT: pack.packRoot,
          },
          maxBuffer: 1_024 * 1_024,
          windowsHide: true,
        },
      );
      const childResult = JSON.parse(child.stdout) as unknown;
      expect(isModuleRecord(childResult)).toBe(true);
      if (!isModuleRecord(childResult)) {
        throw new Error("Compiled entrypoint child result is invalid.");
      }
      expect(childResult).toMatchObject({
        coreImportRejected: true,
        pathUnchanged: true,
        recordCount: 1,
        outcome: { status: "recorded" },
      });
    }, 120_000);

    it("ignores contaminated parent resolution, proxy, and PATH variables in the attestor child", async () => {
      const keys = [
        "ALL_PROXY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NODE_PATH",
        "PATH",
      ] as const;
      const previous = new Map(
        keys.map((key) => [key, process.env[key]] as const),
      );
      for (const key of keys) {
        process.env[key] = "C:\\unreviewed-runtime-contamination";
      }
      let pack: GrandHallT554NativeReviewCompiledPackBuildResultV1 | undefined;
      try {
        pack = await buildPack("pack-contaminated-environment");
      } finally {
        for (const key of keys) {
          const value = previous.get(key);
          if (value === undefined) Reflect.deleteProperty(process.env, key);
          else process.env[key] = value;
        }
      }
      if (pack === undefined) {
        throw new Error("Contaminated-environment pack build did not complete.");
      }
      expect(pack.runtimeAttestationStatus).toBe("attested-candidate");
      expect(pack.runtimeAttestationCandidate).toMatchObject({
        authority: "none",
        productionRuntimeAuthorityMinted: false,
        processIsolation: {
          environmentCleared: true,
          commonJsResolutionRestrictedToBuiltinsAndExactReviewedNativeAddons:
            true,
          selectedNetworkEntrypointsPatched: true,
        },
      });
    }, 120_000);

    it("rejects tampered loader, addon, DLL, inspector, and probe members before runtime use", async () => {
      const pack = await buildPack("pack-tamper");
      const members = [
        "vendor/sharp/loader.js",
        "vendor/sharp/sharp-win32-x64-0.35.3.node",
        "vendor/libvips/libvips-42.dll",
        "vendor/runtime-inspector/grand-hall-t554-runtime-inspector.node",
        "vendor/runtime-attestation/decoder-probe.jpg",
      ] as const;
      for (const member of members) {
        const path = resolve(pack.packRoot, ...member.split("/"));
        const original = await readFile(path);
        try {
          await writeFile(path, Buffer.concat([original, Buffer.from([0])]));
          await expect(
            attestGrandHallT554NativeReviewRuntimeCandidateV1({
              implementationPackRoot: pack.packRoot,
              candidate: pack.verifiedCandidate,
            }),
          ).rejects.toMatchObject({ code: "CANDIDATE_MISMATCH" });
        } finally {
          await writeFile(path, original);
          original.fill(0);
        }
      }
      const reverified =
        await __testOnlyGrandHallT554NativeReviewImplementationManifest.verifyCallerAnchoredImplementationPackCandidate({
          implementationPackRoot: pack.packRoot,
          reviewedAnchor: pack.reviewedAnchorCandidate,
          bootstrapExecutionIdentity: {
            compiledJavascriptModule: true,
            execArgv: [],
            nodeOptions: null,
            nodePath: null,
          },
        });
      expect(
        isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(
          reverified,
        ),
      ).toBe(true);
    }, 120_000);

    it("emits deterministic bytes into independent roots and refuses replacement", async () => {
      const first = await buildPack("pack-a");
      const second = await buildPack("pack-b");
      const firstManifestBytes = await readFile(
        resolve(
          first.packRoot,
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
        ),
      );
      const secondManifestBytes = await readFile(
        resolve(
          second.packRoot,
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
        ),
      );

      expect(secondManifestBytes).toEqual(firstManifestBytes);
      expect(second.manifest.semanticSha256).toBe(
        first.manifest.semanticSha256,
      );
      expect(second.manifest.members).toEqual(first.manifest.members);
      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot: first.packRoot,
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    }, 120_000);

    it("reports cleanup residue while refusing an attacker replacement of its unpredictable staging root", async () => {
      const parent = await mkdtemp(join(tmpdir(), "t554-pack-race-test-"));
      roots.push(parent);
      const outputRoot = resolve(parent, "pack");
      const attackerRoot = resolve(parent, "attacker-root");
      const displacedOwnedRoot = resolve(parent, "displaced-owned-root");
      await mkdir(attackerRoot);
      await writeFile(resolve(attackerRoot, "attacker-marker.txt"), "keep\n");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            afterStagingRootCreated: async (stagingRoot) => {
              await rename(stagingRoot, displacedOwnedRoot);
              await symlink(attackerRoot, stagingRoot, "junction");
            },
          },
        }),
      ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE" });

      expect(await readFile(resolve(attackerRoot, "attacker-marker.txt"), "utf8"))
        .toBe("keep\n");
      expect((await lstat(displacedOwnedRoot)).isDirectory()).toBe(true);
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("never overwrites or deletes an output target that appears before atomic publication", async () => {
      const parent = await mkdtemp(join(tmpdir(), "t554-pack-publish-race-"));
      roots.push(parent);
      const outputRoot = resolve(parent, "pack");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot,
          __testOnlySeam: {
            beforeAtomicPublish: async () => {
              await mkdir(outputRoot);
              await writeFile(resolve(outputRoot, "attacker-marker.txt"), "keep\n");
            },
          },
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });

      expect(await readFile(resolve(outputRoot, "attacker-marker.txt"), "utf8"))
        .toBe("keep\n");
      await expect(
        lstat(
          resolve(
            outputRoot,
            GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }, 120_000);

    it("rejects an output parent reached through a junction before creating staging bytes", async () => {
      const realParent = await mkdtemp(join(tmpdir(), "t554-pack-real-parent-"));
      const aliasParent = await mkdtemp(join(tmpdir(), "t554-pack-alias-parent-"));
      roots.push(realParent, aliasParent);
      const alias = resolve(aliasParent, "alias");
      await symlink(realParent, alias, "junction");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot: resolve(alias, "pack"),
        }),
      ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
      expect(await readdir(realParent)).toEqual([]);
    });

    it("rejects a workspace root reached through a junction before creating output bytes", async () => {
      const realWorkspace = resolve(process.cwd(), "..", "..");
      const aliasParent = await mkdtemp(join(tmpdir(), "t554-workspace-alias-"));
      const outputParent = await mkdtemp(join(tmpdir(), "t554-workspace-output-"));
      roots.push(aliasParent, outputParent);
      const workspaceAlias = resolve(aliasParent, "workspace");
      const outputRoot = resolve(outputParent, "pack");
      await symlink(realWorkspace, workspaceAlias, "junction");

      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: workspaceAlias,
          outputRoot,
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
      await expect(lstat(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects forward-slash UNC workspace and output spellings", async () => {
      const outputParent = await mkdtemp(join(tmpdir(), "t554-unc-spelling-"));
      roots.push(outputParent);
      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: "//server/share/workspace",
          outputRoot: resolve(outputParent, "pack"),
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
      await expect(
        buildGrandHallT554NativeReviewCompiledPackV1({
          workspaceRoot: resolve(process.cwd(), "..", ".."),
          outputRoot: "//server/share/pack",
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    });
  },
);
