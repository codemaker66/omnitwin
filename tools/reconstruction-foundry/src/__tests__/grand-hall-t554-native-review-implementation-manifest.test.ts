import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER,
  __internalVerifyGrandHallT554NativeReviewExactImplementationPack,
  __testOnlyGrandHallT554NativeReviewImplementationManifest,
  assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1,
  assertGrandHallT554VerifiedNativeReviewImplementationPackV1,
  isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1,
  isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1,
  isGrandHallT554VerifiedNativeReviewImplementationPackV1,
  verifyGrandHallT554NativeReviewImplementationPack,
  verifyGrandHallT554NativeReviewImplementationPackCandidateV1,
  type __GrandHallT554NativeReviewImplementationReviewedAnchor,
  type __GrandHallT554NativeReviewImplementationVerificationInput,
  type GrandHallT554ImplementationSha256,
  type GrandHallT554NativeReviewImplementationManifestV1,
} from "../grand-hall-t554-native-review-implementation-manifest.js";

const SEMANTIC_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_V1";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .reverse()
      .map(async (root) => {
        await rm(root, { force: true, recursive: true });
      }),
  );
});

interface Fixture {
  readonly root: string;
  readonly manifestPath: string;
  readonly controllerPath: string;
  readonly kernelPath: string;
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV1;
  readonly anchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
}

type ManifestMaterial = Omit<
  GrandHallT554NativeReviewImplementationManifestV1,
  "semanticSha256"
>;

function sha256(bytes: Buffer): GrandHallT554ImplementationSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticSha256(value: unknown): GrandHallT554ImplementationSha256 {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(
    Buffer.from(
      `${SEMANTIC_DIGEST_DOMAIN}\n${stableCanonicalJson(canonical)}`,
      "utf8",
    ),
  );
}

function sealManifest(
  material: ManifestMaterial,
): GrandHallT554NativeReviewImplementationManifestV1 {
  return {
    ...material,
    semanticSha256: semanticSha256(material),
  };
}

function serializeCanonical(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

function anchorFor(
  manifest: GrandHallT554NativeReviewImplementationManifestV1,
  bytes: Buffer,
): __GrandHallT554NativeReviewImplementationReviewedAnchor {
  return {
    manifestSemanticSha256: manifest.semanticSha256,
    manifestFileSha256: sha256(bytes),
    manifestFileByteLength: bytes.length,
  };
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "t554-native-implementation-"));
  roots.push(root);
  const controllerPath = resolve(root, "server", "review-http-adapter.js");
  const kernelPath = resolve(root, "server", "native-review-server-bundle.js");
  const nativeAddonName = `sharp-${process.platform}-${process.arch}.node`;
  const libvipsName =
    process.platform === "win32"
      ? "libvips.dll"
      : process.platform === "darwin"
        ? "libvips.dylib"
        : "libvips.so.42";
  const sharpRuntimePath = "vendor/sharp/index.js";
  const sharpNativeAddonPath = `vendor/sharp/${nativeAddonName}`;
  const libvipsPath = `vendor/libvips/${libvipsName}`;
  const runtime =
    __testOnlyGrandHallT554NativeReviewImplementationManifest.currentRuntimeIdentity();
  const decoder = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-decoder-closure.v1" as const,
    library: "sharp" as const,
    sharpVersion: "0.35.3",
    libvipsVersion: "8.17.3",
    platform: runtime.platform,
    architecture: runtime.architecture,
    sourceJpegDecoderPipeline:
      "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
    strictMaskPngDecoderPipeline:
      "canonical-grayscale8-source-grid-mask-and-reason-map.v2" as const,
    metadataMember: "vendor/decoder-runtime.json" as const,
    sharpRuntimeMembers: [sharpRuntimePath],
    sharpNativeAddonMember: sharpNativeAddonPath,
    libvipsNativeDependencyMembers: [libvipsPath],
  };
  const controllerBytes = Buffer.from(
    "export const authority = 'none';\n",
    "utf8",
  );
  const kernelBytes = Buffer.from(
    "export const generatedContentAuthorized = false;\n",
    "utf8",
  );
  const runtimeProbeBytes = Buffer.from(
    GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_BASE64,
    "base64",
  );
  const memberInputs = [
    {
      relativePath: "package.json",
      kind: "module-metadata" as const,
      bytes: serializeCanonical({
        name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
        private: true,
        type: "module",
        version: "1.0.0",
      }),
    },
    {
      relativePath: "server/native-review-server-bundle.js",
      kind: "server-bundle" as const,
      bytes: kernelBytes,
    },
    {
      relativePath: "server/review-http-adapter.js",
      kind: "trusted-http-adapter" as const,
      bytes: controllerBytes,
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_ATTESTOR_MEMBER,
      kind: "runtime-attestation-module" as const,
      bytes: Buffer.from("export const runtimeAttestor = true;\n", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER,
      kind: "runtime-attestation-module" as const,
      bytes: Buffer.from("export const runtimeBootstrap = true;\n", "utf8"),
    },
    {
      relativePath: "static/index.html",
      kind: "static-asset" as const,
      bytes: Buffer.from("<!doctype html><title>T-554</title>\n", "utf8"),
    },
    {
      relativePath: "static/review.css",
      kind: "static-asset" as const,
      bytes: Buffer.from("html { background: #000; }\n", "utf8"),
    },
    {
      relativePath: "static/review.js",
      kind: "static-asset" as const,
      bytes: Buffer.from("export const browserTruth = false;\n", "utf8"),
    },
    {
      relativePath: "vendor/decoder-runtime.json",
      kind: "decoder-closure-metadata" as const,
      bytes: serializeCanonical(decoder),
    },
    {
      relativePath: libvipsPath,
      kind: "libvips-native-dependency" as const,
      bytes: Buffer.from("fixture-libvips-native-bytes", "utf8"),
    },
    {
      relativePath: sharpRuntimePath,
      kind: "sharp-runtime" as const,
      bytes: Buffer.from("export const fixtureSharpRuntime = true;\n", "utf8"),
    },
    {
      relativePath: sharpNativeAddonPath,
      kind: "sharp-native-addon" as const,
      bytes: Buffer.from("fixture-sharp-native-addon", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER,
      kind: "runtime-inspector-addon" as const,
      bytes: Buffer.from("fixture-unreviewed-runtime-inspector", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER,
      kind: "runtime-attestation-probe" as const,
      bytes: runtimeProbeBytes,
    },
  ] as const;
  await Promise.all(
    memberInputs.map(async (member) => {
      const path = resolve(root, ...member.relativePath.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, member.bytes, { flag: "wx" });
    }),
  );
  const members = memberInputs
    .map((member) => ({
      relativePath: member.relativePath,
      kind: member.kind,
      sha256: sha256(member.bytes),
      byteLength: member.bytes.length,
    }))
    .sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
  const material: ManifestMaterial = {
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA,
    implementationId: "grand-hall-t554-native-review-workbench-v1",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    sourceCount: 148,
    authority: "none",
    runtime,
    decoder,
    execution: {
      mode: "compiled-esm-private-local-review-core.v1",
      moduleFormat: "esm",
      bindAddress: "127.0.0.1",
      browserTrust: "untrusted-display-and-input",
      dependencyClosure: "reviewed-pack-members-plus-node-builtins.v1",
      entryImportPolicy: "verify-entire-pack-before-import.v1",
      productionFactoryIncluded: false,
      httpLaunchIncluded: false,
      sourceMapsIncluded: false,
      tsxExecutionAuthorized: false,
      mixedSourceDistResolutionAuthorized: false,
      externalRuntimeModuleResolutionAuthorized: false,
      browserControlledTruthAuthorized: false,
      externalNetworkAuthorized: false,
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAdmissionAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
    },
    serverBundleModule: "server/native-review-server-bundle.js",
    trustedHttpAdapterModule: "server/review-http-adapter.js",
    memberCount: members.length,
    totalMemberBytes: members.reduce(
      (total, member) => total + member.byteLength,
      0,
    ),
    members,
  };
  const manifest = sealManifest(material);
  const bytes = serializeCanonical(manifest);
  const manifestPath = resolve(
    root,
    GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
  );
  await writeFile(manifestPath, bytes, { flag: "wx" });
  return {
    root,
    manifestPath,
    controllerPath,
    kernelPath,
    manifest,
    anchor: anchorFor(manifest, bytes),
  };
}

function verify(
  fixture: Fixture,
  overrides: Partial<__GrandHallT554NativeReviewImplementationVerificationInput> = {},
) {
  return __testOnlyGrandHallT554NativeReviewImplementationManifest.verifyCallerAnchoredImplementationPackCandidate(
    {
      implementationPackRoot: fixture.root,
      reviewedAnchor: fixture.anchor,
      bootstrapExecutionIdentity: {
        compiledJavascriptModule: true,
        execArgv: [],
        nodeOptions: null,
        nodePath: null,
      },
      ...overrides,
    },
  );
}

async function replaceManifest(
  fixture: Fixture,
  material: ManifestMaterial,
): Promise<Fixture> {
  const manifest = sealManifest(material);
  const bytes = serializeCanonical(manifest);
  await writeFile(fixture.manifestPath, bytes);
  return {
    ...fixture,
    manifest,
    anchor: anchorFor(manifest, bytes),
  };
}

function materialOf(
  manifest: GrandHallT554NativeReviewImplementationManifestV1,
): ManifestMaterial {
  const { semanticSha256: _semanticSha256, ...material } = manifest;
  return material;
}

describe("Grand Hall T-554 native-review implementation manifest", () => {
  it("keeps the production verifier zero-argument and unavailable without a reviewed pack", async () => {
    expect(verifyGrandHallT554NativeReviewImplementationPack).toHaveLength(0);
    await expect(
      verifyGrandHallT554NativeReviewImplementationPack(),
    ).rejects.toMatchObject({ code: "REVIEWED_PACK_NOT_CONFIGURED" });
  });

  it("ignores smuggled runtime, bootstrap, and verifier-seam fields on the safe candidate surface", async () => {
    const fixture = await createFixture();
    let seamCalled = false;
    await expect(
      Reflect.apply(
        verifyGrandHallT554NativeReviewImplementationPackCandidateV1,
        undefined,
        [
          {
            implementationPackRoot: fixture.root,
            reviewedAnchor: fixture.anchor,
            runtimeIdentity: fixture.manifest.runtime,
            bootstrapExecutionIdentity: {
              compiledJavascriptModule: true,
              execArgv: [],
              nodeOptions: null,
              nodePath: null,
            },
            seam: {
              afterInitialInventory: () => {
                seamCalled = true;
              },
            },
          },
        ],
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_MISMATCH" });
    expect(seamCalled).toBe(false);
  });

  it("verifies an immutable candidate without minting production admission", async () => {
    const fixture = await createFixture();
    const candidate = await verify(fixture);
    expect(candidate).toMatchObject({
      schemaVersion:
        "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v1",
      manifestBinding: {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
        implementationId: "grand-hall-t554-native-review-workbench-v1",
        semanticSha256: fixture.anchor.manifestSemanticSha256,
        fileSha256: fixture.anchor.manifestFileSha256,
        byteLength: fixture.anchor.manifestFileByteLength,
      },
      memberCount: 14,
      totalMemberBytes: fixture.manifest.totalMemberBytes,
      concreteBytesVerified: true,
      runtimeIdentityVerified: true,
      reviewedDecoderClosureBytesVerified: true,
      decoderDependencyGraphVerified: false,
      decoderRuntimeLoaded: false,
      safeEntrypointImportAvailable: false,
      platformAliasAuditComplete: false,
      releaseReady: false,
      executionPolicyManifestVerified: true,
      exactRootInventoryVerified: true,
      authority: "none",
      productionFactoryAvailable: false,
    });
    expect(candidate.memberInventorySha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.manifest.members)).toBe(true);
    expect(JSON.stringify(candidate)).not.toContain(fixture.root);
    const copiedBytes = candidate.copyExactManifestBytes();
    expect(copiedBytes).toEqual(await readFile(fixture.manifestPath));
    copiedBytes.fill(0);
    expect(sha256(candidate.copyExactManifestBytes())).toBe(
      fixture.anchor.manifestFileSha256,
    );
    expect(() => {
      Object.defineProperty(candidate.manifest.members, "0", {
        value: { relativePath: "substituted.js" },
      });
    }).toThrow();
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(candidate),
    ).toBe(true);
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
        candidate,
        fixture.root,
      );
    }).not.toThrow();
    const otherRoot = await createFixture();
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
        candidate,
        otherRoot.root,
      );
    }).toThrow(/different concrete root/u);
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackV1(candidate),
    ).toBe(false);
    const clonedData = structuredClone({
      manifest: candidate.manifest,
      manifestBinding: candidate.manifestBinding,
      memberInventorySha256: candidate.memberInventorySha256,
    });
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(clonedData),
    ).toBe(false);
    const forged = { ...candidate };
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(forged),
    ).toBe(false);
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackV1(forged);
    }).toThrow(/not admitted by the module-private fixed reviewed-pack verifier/u);
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackV1(candidate);
    }).toThrow(/not admitted by the module-private fixed reviewed-pack verifier/u);
    expect(
      isGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV1(
        candidate,
      ),
    ).toBe(false);
  });

  it("keeps generic exact-pack facts unbranded and without root authority", async () => {
    const fixture = await createFixture();
    const expectedManifestBytes = await readFile(fixture.manifestPath);
    const facts =
      await __internalVerifyGrandHallT554NativeReviewExactImplementationPack({
        implementationPackRoot: fixture.root,
        reviewedAnchor: fixture.anchor,
        manifestFilename:
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME,
          parseCanonicalManifestBytes: (bytes) => {
            if (!bytes.equals(expectedManifestBytes)) {
              throw new Error(
                "Generic verifier observed unexpected manifest bytes.",
              );
            }
            return structuredClone(fixture.manifest);
          },
        assertRuntime: () => undefined,
        assertMemberContentPolicy: () => undefined,
        computeMemberInventorySha256:
          __testOnlyGrandHallT554NativeReviewImplementationManifest.computeMemberInventorySha256,
      });

    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.manifest)).toBe(true);
    expect(facts.copyExactManifestBytes()).toEqual(expectedManifestBytes);
    expect(JSON.stringify(facts)).not.toContain(fixture.root);
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV1(facts),
    ).toBe(false);
    expect(isGrandHallT554VerifiedNativeReviewImplementationPackV1(facts)).toBe(
      false,
    );
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV1(
        facts,
        fixture.root,
      );
    }).toThrow(/not an exact same-instance verified handle/u);
  });

  it.each([
    [
      "pretty JSON",
      (bytes: Buffer) =>
        Buffer.from(
          `${JSON.stringify(JSON.parse(bytes.toString("utf8")), null, 2)}\n`,
          "utf8",
        ),
    ],
    [
      "CRLF",
      (bytes: Buffer) =>
        Buffer.concat([
          bytes.subarray(0, bytes.length - 1),
          Buffer.from("\r\n", "utf8"),
        ]),
    ],
    [
      "trailing bytes",
      (bytes: Buffer) => Buffer.concat([bytes, Buffer.from(" ", "utf8")]),
    ],
    [
      "UTF-8 BOM",
      (bytes: Buffer) =>
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    ],
    [
      "duplicate key",
      (bytes: Buffer) =>
        Buffer.from(
          bytes
            .toString("utf8")
            .replace(
              '{"authority":"none"',
              '{"authority":"none","authority":"none"',
            ),
          "utf8",
        ),
    ],
    [
      "prototype key",
      (bytes: Buffer) =>
        Buffer.from(
          bytes
            .toString("utf8")
            .replace(
              '{"authority":"none"',
              '{"__proto__":null,"authority":"none"',
            ),
          "utf8",
        ),
    ],
  ])(
    "rejects %s rather than normalizing manifest bytes",
    async (_label, mutate) => {
      const fixture = await createFixture();
      await writeFile(
        fixture.manifestPath,
        mutate(await readFile(fixture.manifestPath)),
      );
      await expect(verify(fixture)).rejects.toMatchObject({
        code: "MANIFEST_INVALID",
      });
    },
  );

  it("rejects either a semantic or exact-file reviewed-anchor substitution", async () => {
    const semantic = await createFixture();
    await expect(
      verify(semantic, {
        reviewedAnchor: {
          ...semantic.anchor,
          manifestSemanticSha256: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "REVIEWED_ANCHOR_MISMATCH" });

    const raw = await createFixture();
    await expect(
      verify(raw, {
        reviewedAnchor: {
          ...raw.anchor,
          manifestFileSha256: `sha256:${"f".repeat(64)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "REVIEWED_ANCHOR_MISMATCH" });
  });

  it("rejects a wrong self semantic digest even when the raw reviewed anchor matches", async () => {
    const fixture = await createFixture();
    const invalidManifest = {
      ...fixture.manifest,
      semanticSha256: `sha256:${"0".repeat(64)}` as const,
    };
    const bytes = serializeCanonical(invalidManifest);
    await writeFile(fixture.manifestPath, bytes);
    await expect(
      verify(fixture, {
        reviewedAnchor: {
          manifestSemanticSha256: invalidManifest.semanticSha256,
          manifestFileSha256: sha256(bytes),
          manifestFileByteLength: bytes.length,
        },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });

  it("rejects a re-sealed manifest that enables any forbidden authority", async () => {
    const fixture = await createFixture();
    const hostile = {
      ...materialOf(fixture.manifest),
      execution: {
        ...fixture.manifest.execution,
        generatedContentAuthorized: true,
      },
    };
    const hostileManifest = {
      ...hostile,
      semanticSha256: semanticSha256(hostile),
    };
    const bytes = serializeCanonical(hostileManifest);
    await writeFile(fixture.manifestPath, bytes);
    await expect(
      verify(fixture, {
        reviewedAnchor: {
          manifestSemanticSha256: hostileManifest.semanticSha256,
          manifestFileSha256: sha256(bytes),
          manifestFileByteLength: bytes.length,
        },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });

  it("requires the full server, HTTP, static, Sharp, addon, and libvips member closure", async () => {
    const fixture = await createFixture();
    const omitted = fixture.manifest.members.find(
      (member) => member.kind === "sharp-native-addon",
    );
    expect(omitted).toBeDefined();
    if (omitted === undefined)
      throw new Error("Fixture omitted its Sharp addon.");
    const members = fixture.manifest.members.filter(
      (member) => member !== omitted,
    );
    await rm(resolve(fixture.root, ...omitted.relativePath.split("/")));
    const changed = await replaceManifest(fixture, {
      ...materialOf(fixture.manifest),
      memberCount: members.length,
      totalMemberBytes: members.reduce(
        (total, member) => total + member.byteLength,
        0,
      ),
      members,
    });
    await expect(verify(changed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it("derives compiled ESM execution mode from the exact module metadata bytes", async () => {
    const fixture = await createFixture();
    const packagePath = resolve(fixture.root, "package.json");
    const hostileBytes = serializeCanonical({
      name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
      private: true,
      type: "commonjs",
      version: "1.0.0",
    });
    await writeFile(packagePath, hostileBytes);
    const members = fixture.manifest.members.map((member) =>
      member.kind === "module-metadata"
        ? {
            ...member,
            sha256: sha256(hostileBytes),
            byteLength: hostileBytes.length,
          }
        : member,
    );
    const changed = await replaceManifest(fixture, {
      ...materialOf(fixture.manifest),
      totalMemberBytes: members.reduce(
        (total, member) => total + member.byteLength,
        0,
      ),
      members,
    });
    await expect(verify(changed)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it("rejects self-consistent Node, ABI, platform, or architecture drift", async () => {
    const fixture = await createFixture();
    const drifted = await replaceManifest(fixture, {
      ...materialOf(fixture.manifest),
      runtime: {
        ...fixture.manifest.runtime,
        nodeVersion: "v0.0.1",
      },
    });
    await expect(verify(drifted)).rejects.toMatchObject({
      code: "RUNTIME_MISMATCH",
    });

    const decoder = await createFixture();
    await expect(
      verify(decoder, {
        runtimeIdentity: {
          ...decoder.manifest.runtime,
          nodeModulesAbi: `${decoder.manifest.runtime.nodeModulesAbi}-drift`,
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_MISMATCH" });
  });

  it("rejects decoder claims that drift from the exact pack-internal closure metadata", async () => {
    const fixture = await createFixture();
    const drifted = await replaceManifest(fixture, {
      ...materialOf(fixture.manifest),
      decoder: {
        ...fixture.manifest.decoder,
        sharpVersion: `${fixture.manifest.decoder.sharpVersion}-drift`,
      },
    });
    await expect(verify(drifted)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it("rejects source execution and Node preload or external-resolution injection", async () => {
    const fixture = await createFixture();
    for (const bootstrapExecutionIdentity of [
      {
        compiledJavascriptModule: false,
        execArgv: [],
        nodeOptions: null,
        nodePath: null,
      },
      {
        compiledJavascriptModule: true,
        execArgv: ["--import", "tsx"],
        nodeOptions: null,
        nodePath: null,
      },
      {
        compiledJavascriptModule: true,
        execArgv: [],
        nodeOptions: "--require hostile.cjs",
        nodePath: null,
      },
      {
        compiledJavascriptModule: true,
        execArgv: [],
        nodeOptions: null,
        nodePath: "C:\\unreviewed-modules",
      },
    ] as const) {
      await expect(
        verify(fixture, {
          bootstrapExecutionIdentity,
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_MISMATCH" });
    }
  });

  it("rejects unsorted, duplicate, case-colliding, unsafe, and excessive member inventories", async () => {
    const unsorted = await createFixture();
    const reversedMembers = unsorted.manifest.members.slice().reverse();
    const reversed = await replaceManifest(unsorted, {
      ...materialOf(unsorted.manifest),
      members: reversedMembers,
    });
    await expect(verify(reversed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });

    const collision = await createFixture();
    const collisionMembers = [
      ...collision.manifest.members,
      {
        ...collision.manifest.members[1]!,
        relativePath: "server/Native-review-server-bundle.js",
      },
    ].sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
    const collided = await replaceManifest(collision, {
      ...materialOf(collision.manifest),
      memberCount: collisionMembers.length,
      totalMemberBytes: collisionMembers.reduce(
        (total, member) => total + member.byteLength,
        0,
      ),
      members: collisionMembers,
    });
    await expect(verify(collided)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });

    const unsafe = await createFixture();
    const unsafeMembers = unsafe.manifest.members.map((member, index) =>
      index === 0 ? { ...member, relativePath: "../escape.js" } : member,
    );
    const escaped = await replaceManifest(unsafe, {
      ...materialOf(unsafe.manifest),
      members: unsafeMembers,
    });
    await expect(verify(escaped)).rejects.toMatchObject({
      code: expect.stringMatching(/MANIFEST_INVALID|ROOT_UNSAFE/u),
    });

    const excessive = await createFixture();
    const excessiveMembers = Array.from({ length: 129 }, (_, index) => ({
      relativePath: `server/member-${String(index).padStart(3, "0")}.js`,
      sha256: excessive.manifest.members[0]!.sha256,
      byteLength: 1,
    }));
    const excessiveMaterial = {
      ...materialOf(excessive.manifest),
      serverBundleModule: excessiveMembers[0]!.relativePath,
      trustedHttpAdapterModule: excessiveMembers[1]!.relativePath,
      memberCount: excessiveMembers.length,
      totalMemberBytes: excessiveMembers.length,
      members: excessiveMembers,
    };
    const excessiveManifest = {
      ...excessiveMaterial,
      semanticSha256: semanticSha256(excessiveMaterial),
    };
    const excessiveBytes = serializeCanonical(excessiveManifest);
    await writeFile(excessive.manifestPath, excessiveBytes);
    await expect(
      verify(excessive, {
        reviewedAnchor: {
          manifestSemanticSha256: excessiveManifest.semanticSha256,
          manifestFileSha256: sha256(excessiveBytes),
          manifestFileByteLength: excessiveBytes.length,
        },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });

  it("rejects missing, extra, empty-directory, and tampered members", async () => {
    const missing = await createFixture();
    await rm(missing.kernelPath);
    await expect(verify(missing)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const extra = await createFixture();
    await writeFile(resolve(extra.root, "server", "extra.js"), "export {};\n");
    await expect(verify(extra)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const emptyDirectory = await createFixture();
    await mkdir(resolve(emptyDirectory.root, "unreferenced"));
    await expect(verify(emptyDirectory)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const tampered = await createFixture();
    const original = await readFile(tampered.kernelPath);
    const changed = Buffer.from(original);
    changed[0] = changed[0] === 0x65 ? 0x66 : 0x65;
    await writeFile(tampered.kernelPath, changed);
    await expect(verify(tampered)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it("bounds recursive root enumeration before accepting a large extra inventory", async () => {
    const fixture = await createFixture();
    await Promise.all(
      Array.from({ length: 130 }, async (_, index) =>
        writeFile(
          resolve(fixture.root, `extra-${String(index).padStart(2, "0")}.js`),
          "export {};\n",
        ),
      ),
    );
    await expect(verify(fixture)).rejects.toMatchObject({
      code: "ROOT_UNSAFE",
    });
  });

  it("rejects hard links and non-regular members before trusting their bytes", async () => {
    const hardLinked = await createFixture();
    await rm(hardLinked.controllerPath);
    await link(hardLinked.kernelPath, hardLinked.controllerPath);
    await expect(verify(hardLinked)).rejects.toMatchObject({
      code: "ROOT_UNSAFE",
    });

    const directory = await createFixture();
    await rm(directory.controllerPath);
    await mkdir(directory.controllerPath);
    await expect(verify(directory)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });
  });

  it("rejects a symlink or junction used as the fixed root", async () => {
    const fixture = await createFixture();
    const aliasParent = await mkdtemp(join(tmpdir(), "t554-native-alias-"));
    roots.push(aliasParent);
    const alias = resolve(aliasParent, "pack-alias");
    await symlink(
      fixture.root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      verify(fixture, {
        implementationPackRoot: alias,
      }),
    ).rejects.toMatchObject({ code: "ROOT_UNSAFE" });
  });

  it("rejects a nested directory junction before reading its member bytes", async () => {
    const fixture = await createFixture();
    const outsideParent = await mkdtemp(
      join(tmpdir(), "t554-native-nested-alias-"),
    );
    roots.push(outsideParent);
    const staticDirectory = resolve(fixture.root, "static");
    const outsideStatic = resolve(outsideParent, "static-target");
    await rename(staticDirectory, outsideStatic);
    await symlink(
      outsideStatic,
      staticDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(verify(fixture)).rejects.toMatchObject({
      code: "ROOT_UNSAFE",
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects actual case-colliding root members on case-sensitive filesystems",
    async () => {
      const fixture = await createFixture();
      await Promise.all([
        writeFile(resolve(fixture.root, "Extra.js"), "export {};\n"),
        writeFile(resolve(fixture.root, "extra.js"), "export {};\n"),
      ]);
      await expect(verify(fixture)).rejects.toMatchObject({
        code: "ROOT_UNSAFE",
      });
    },
  );

  it("rejects a path substitution between inventory and descriptor open", async () => {
    const fixture = await createFixture();
    let changed = false;
    await expect(
      verify(fixture, {
        seam: {
          afterInitialInventory: async () => {
            await writeFile(
              fixture.kernelPath,
              "export const substituted = true;\n",
            );
            changed = true;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
    expect(changed).toBe(true);
  });

  it("uses a trailing probe and rejects growth after descriptor size capture", async () => {
    const fixture = await createFixture();
    let attacked = false;
    await expect(
      verify(fixture, {
        seam: {
          afterDescriptorOpened: async (relativePath) => {
            if (relativePath !== "server/native-review-server-bundle.js")
              return;
            await writeFile(
              fixture.kernelPath,
              Buffer.concat([
                await readFile(fixture.kernelPath),
                Buffer.from("// appended\n", "utf8"),
              ]),
            );
            attacked = true;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
    expect(attacked).toBe(true);
  });

  it("zeroes a partially read member buffer when descriptor reading fails", async () => {
    const fixture = await createFixture();
    let injected = false;
    let destroyed = false;
    await expect(
      verify(fixture, {
        seam: {
          afterReadChunk: (relativePath) => {
            if (relativePath !== "server/native-review-server-bundle.js")
              return;
            injected = true;
            throw new Error("injected descriptor read failure");
          },
          afterExceptionalReadBufferDestroyed: (facts) => {
            if (facts.relativePath !== "server/native-review-server-bundle.js")
              return;
            destroyed = facts.bytesWereZeroed;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
    expect(injected).toBe(true);
    expect(destroyed).toBe(true);
  });

  it("rejects descriptor/path replacement and final-inventory races", async () => {
    const descriptorRace = await createFixture();
    const displaced = resolve(descriptorRace.root, "server", "displaced.js");
    let swapped = false;
    await expect(
      verify(descriptorRace, {
        seam: {
          afterDescriptorOpened: async (relativePath) => {
            if (relativePath !== "server/review-http-adapter.js") return;
            await rename(descriptorRace.controllerPath, displaced);
            await writeFile(
              descriptorRace.controllerPath,
              "export const authority = 'forged';\n",
            );
            swapped = true;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
    expect(swapped).toBe(true);

    const finalRace = await createFixture();
    let added = false;
    await expect(
      verify(finalRace, {
        seam: {
          afterMemberReads: async () => {
            await writeFile(resolve(finalRace.root, "late.js"), "export {};\n");
            added = true;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INVENTORY_MISMATCH" });
    expect(added).toBe(true);
  });

  it("rejects relative, UNC, extended, and device roots before filesystem access", async () => {
    const fixture = await createFixture();
    for (const root of [
      "relative-pack",
      "\\\\server\\share\\pack",
      "\\\\?\\C:\\pack",
      "\\\\.\\C:\\pack",
    ]) {
      await expect(
        verify(fixture, {
          implementationPackRoot: root,
        }),
      ).rejects.toMatchObject({ code: "ARGUMENT_INVALID" });
    }
  });
});
