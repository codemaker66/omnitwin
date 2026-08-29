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

import * as v2ManifestModule from "../grand-hall-t554-native-review-implementation-manifest-v2.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
  __testOnlyGrandHallT554NativeReviewImplementationManifestV2,
  assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2,
  isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2,
  reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV2,
  verifyGrandHallT554NativeReviewImplementationPackCandidateV2,
  type __GrandHallT554NativeReviewImplementationVerificationInputV2,
  type GrandHallT554NativeReviewImplementationDecoderClosureV2,
  type GrandHallT554NativeReviewImplementationManifestV2,
  type GrandHallT554NativeReviewImplementationMemberV2,
  type GrandHallT554NativeReviewImplementationRuntimeV2,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2,
} from "../grand-hall-t554-native-review-implementation-manifest-v2.js";
import {
  __internalObserveGrandHallT554NativeReviewRuntimeIdentity,
  type __GrandHallT554NativeReviewImplementationReviewedAnchor,
  type GrandHallT554ImplementationSha256,
} from "../grand-hall-t554-native-review-implementation-manifest.js";

const roots: string[] = [];
const COMPILED_BOOTSTRAP = Object.freeze({
  compiledJavascriptModule: true,
  execArgv: Object.freeze([]),
  nodeOptions: null,
  nodePath: null,
});

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

type ManifestMaterial = Omit<
  GrandHallT554NativeReviewImplementationManifestV2,
  "semanticSha256"
>;

interface Fixture {
  readonly root: string;
  readonly manifestPath: string;
  readonly gatePath: string;
  readonly corePath: string;
  readonly adapterPath: string;
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV2;
  readonly anchor: __GrandHallT554NativeReviewImplementationReviewedAnchor;
}

interface MemberInput {
  readonly relativePath: string;
  readonly kind: GrandHallT554NativeReviewImplementationMemberV2["kind"];
  readonly bytes: Buffer;
}

function sha256(bytes: Buffer): GrandHallT554ImplementationSha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function serializeCanonical(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

function sealManifest(
  material: ManifestMaterial,
): GrandHallT554NativeReviewImplementationManifestV2 {
  const placeholder: GrandHallT554NativeReviewImplementationManifestV2 = {
    ...material,
    semanticSha256: `sha256:${"0".repeat(64)}`,
  };
  return {
    ...material,
    semanticSha256:
      __testOnlyGrandHallT554NativeReviewImplementationManifestV2.computeManifestSemanticSha256(
        placeholder,
      ),
  };
}

function anchorFor(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
  bytes: Buffer,
): __GrandHallT554NativeReviewImplementationReviewedAnchor {
  return {
    manifestSemanticSha256: manifest.semanticSha256,
    manifestFileSha256: sha256(bytes),
    manifestFileByteLength: bytes.length,
  };
}

function materialOf(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): ManifestMaterial {
  const { semanticSha256: _semanticSha256, ...material } = manifest;
  return material;
}

function fixedWindowsRuntime(): GrandHallT554NativeReviewImplementationRuntimeV2 {
  return Object.freeze({
    ...__internalObserveGrandHallT554NativeReviewRuntimeIdentity(),
    platform: "win32",
    architecture: "x64",
  });
}

function gateBytes(): Buffer {
  return Buffer.from(
    `import { assertGrandHallT554NativeReviewFixedPackV2 } from "${GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2}";\nexport async function loadCore(pack) {\n  assertGrandHallT554NativeReviewFixedPackV2(pack);\n  return import("${GRAND_HALL_T554_NATIVE_REVIEW_GATE_CORE_IMPORT_V2}");\n}\n`,
    "utf8",
  );
}

function coreBytes(): Buffer {
  return Buffer.from(
    `import { assertGrandHallT554NativeReviewFixedPackV2 } from "${GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2}";\nimport { bindGrandHallT554NativeReviewTileToHttpResponseV2 } from "${GRAND_HALL_T554_NATIVE_REVIEW_CORE_HTTP_ADAPTER_IMPORT_V2}";\nimport sharp from "${GRAND_HALL_T554_NATIVE_REVIEW_SERVER_SHARP_LOADER_IMPORT_V2}";\nexport const authority = "none";\nexport const expectedOrigin = "http://127.0.0.1:43127";\nexport function createWorkbench(pack) {\n  assertGrandHallT554NativeReviewFixedPackV2(pack);\n  return { bindGrandHallT554NativeReviewTileToHttpResponseV2, sharp };\n}\n`,
    "utf8",
  );
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "t554-native-v2-manifest-"));
  roots.push(root);
  const runtime = fixedWindowsRuntime();
  const decoder: GrandHallT554NativeReviewImplementationDecoderClosureV2 = {
    schemaVersion:
      "venviewer.grand-hall-t554-native-review-decoder-closure.v1" as const,
    library: "sharp" as const,
    sharpVersion: "0.35.3",
    libvipsVersion: "8.18.3",
    platform: "win32",
    architecture: "x64",
    sourceJpegDecoderPipeline:
      "captured-jpeg-buffer-to-unrotated-rgb8.v1" as const,
    strictMaskPngDecoderPipeline:
      "canonical-grayscale8-source-grid-mask-and-reason-map.v2" as const,
    metadataMember: GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
    sharpRuntimeMembers: [GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2],
    sharpNativeAddonMember:
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
    libvipsNativeDependencyMembers: [
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
    ].sort(),
  };
  const memberInputs: readonly MemberInput[] = [
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2,
      kind: "module-metadata",
      bytes: serializeCanonical({
        name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
        private: true,
        type: "module",
        version: "2.0.0",
      }),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
      kind: "payload-admission-gate",
      bytes: gateBytes(),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
      kind: "payload-core",
      bytes: coreBytes(),
    },
    {
      relativePath:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      kind: "trusted-http-adapter",
      bytes: Buffer.from(
        "export const responseDeliveryAuthority = 'none';\n",
        "utf8",
      ),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
      kind: "runtime-bootstrap",
      bytes: Buffer.from(
        'import { createHash } from "node:crypto";\nexport const runtimeBootstrap = createHash("sha256");\n',
        "utf8",
      ),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
      kind: "static-asset",
      bytes: Buffer.from(
        '<!doctype html><link rel="stylesheet" href="/assets/t554-native-review-v2.css"><script type="module" src="/assets/t554-native-review-v2.js"></script>\n',
        "utf8",
      ),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
      kind: "static-asset",
      bytes: Buffer.from("html { background: #000; }\n", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
      kind: "static-asset",
      bytes: Buffer.from(
        'export async function refresh() { return fetch("/api/status"); }\n',
        "utf8",
      ),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
      kind: "decoder-closure-metadata",
      bytes: serializeCanonical(decoder),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
      kind: "sharp-runtime",
      bytes: Buffer.from(
        'import { createRequire } from "node:module";\nimport { dirname, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst require = createRequire(import.meta.url);\nconst loaderDirectory = dirname(fileURLToPath(import.meta.url));\nconst nativeAddonPath = resolve(loaderDirectory, "sharp-win32-x64-0.35.3.node");\nexport default require(nativeAddonPath);\n',
        "utf8",
      ),
    },
    {
      relativePath:
        GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
      kind: "sharp-native-addon",
      bytes: Buffer.from("fixture-sharp-native-addon", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
      kind: "libvips-native-dependency",
      bytes: Buffer.from("fixture-libvips-dll", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
      kind: "libvips-native-dependency",
      bytes: Buffer.from("fixture-libvips-cpp-dll", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
      kind: "runtime-inspector-addon",
      bytes: Buffer.from("fixture-runtime-inspector", "utf8"),
    },
    {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
      kind: "runtime-attestation-probe",
      bytes: Buffer.from(
        __testOnlyGrandHallT554NativeReviewImplementationManifestV2.constants
          .runtimeProbeBase64,
        "base64",
      ),
    },
  ];
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
    schemaVersion:
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_SCHEMA_V2,
    implementationId: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    sourceCount: 148,
    authority: "none",
    runtime,
    decoder,
    execution: {
      mode: "compiled-esm-fixed-admission-gated-private-local-review-payload.v2",
      moduleFormat: "esm",
      bindAddress: "127.0.0.1",
      browserTrust: "untrusted-display-and-input",
      dependencyClosure:
        "reviewed-pack-members-node-builtins-and-fixed-admission-capsule.v2",
      entryImportPolicy:
        "fixed-admission-capsule-verifies-entire-pack-before-gate-import.v2",
      standaloneProductionFactoryIncluded: false,
      fixedAdmissionGatedFactoryIncluded: true,
      httpLaunchIncluded: false,
      sourceMapsIncluded: false,
      tsxExecutionAuthorized: false,
      mixedSourceDistResolutionAuthorized: false,
      ambientExternalRuntimeModuleResolutionAuthorized: false,
      fixedAdmissionCapsuleExternalImportRequired: true,
      browserControlledTruthAuthorized: false,
      externalNetworkAuthorized: false,
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAdmissionAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
    },
    admission: {
      gateModule: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
      coreModule: GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
      trustedHttpAdapterModule:
        GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      runtimeBootstrapModule:
        GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
      documentHtmlMember:
        GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
      stylesheetCssMember:
        GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
      applicationJavascriptMember:
        GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
      fixedAdmissionAbiSchemaVersion:
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_ABI_SCHEMA_V2,
      fixedAdmissionCapsuleUrl:
        GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
    },
    memberCount: members.length,
    totalMemberBytes: members.reduce(
      (total, member) => total + member.byteLength,
      0,
    ),
    members,
  };
  const manifest = sealManifest(material);
  const manifestBytes = serializeCanonical(manifest);
  const manifestPath = resolve(
    root,
    GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  );
  await writeFile(manifestPath, manifestBytes, { flag: "wx" });
  return {
    root,
    manifestPath,
    gatePath: resolve(
      root,
      ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2.split("/"),
    ),
    corePath: resolve(
      root,
      ...GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2.split("/"),
    ),
    adapterPath: resolve(
      root,
      ...GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2.split(
        "/",
      ),
    ),
    manifest,
    anchor: anchorFor(manifest, manifestBytes),
  };
}

function verify(
  fixture: Fixture,
  overrides: Partial<__GrandHallT554NativeReviewImplementationVerificationInputV2> = {},
): Promise<GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2> {
  return __testOnlyGrandHallT554NativeReviewImplementationManifestV2.verifyCandidateWithObservations(
    {
      implementationPackRoot: fixture.root,
      reviewedAnchor: fixture.anchor,
      runtimeIdentity: fixture.manifest.runtime,
      bootstrapExecutionIdentity: COMPILED_BOOTSTRAP,
      seam: {},
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

async function replaceMemberBytes(
  fixture: Fixture,
  relativePath: string,
  bytes: Buffer,
): Promise<Fixture> {
  await writeFile(resolve(fixture.root, ...relativePath.split("/")), bytes);
  const members = fixture.manifest.members.map((member) =>
    member.relativePath === relativePath
      ? {
          ...member,
          sha256: sha256(bytes),
          byteLength: bytes.length,
        }
      : member,
  );
  return replaceManifest(fixture, {
    ...materialOf(fixture.manifest),
    members,
    totalMemberBytes: members.reduce(
      (total, member) => total + member.byteLength,
      0,
    ),
  });
}

async function addSelfConsistentDecoderMember(
  fixture: Fixture,
  relativePath: string,
  kind: "sharp-runtime" | "libvips-native-dependency",
  bytes: Buffer,
): Promise<Fixture> {
  const memberPath = resolve(fixture.root, ...relativePath.split("/"));
  await mkdir(dirname(memberPath), { recursive: true });
  await writeFile(memberPath, bytes, { flag: "wx" });

  const decoder: GrandHallT554NativeReviewImplementationDecoderClosureV2 =
    kind === "sharp-runtime"
      ? {
          ...fixture.manifest.decoder,
          sharpRuntimeMembers: [
            ...fixture.manifest.decoder.sharpRuntimeMembers,
            relativePath,
          ].sort(),
        }
      : {
          ...fixture.manifest.decoder,
          libvipsNativeDependencyMembers: [
            ...fixture.manifest.decoder.libvipsNativeDependencyMembers,
            relativePath,
          ].sort(),
        };
  const decoderBytes = serializeCanonical(decoder);
  await writeFile(
    resolve(
      fixture.root,
      ...GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2.split("/"),
    ),
    decoderBytes,
  );
  const members = [
    ...fixture.manifest.members.map((member) =>
      member.relativePath ===
      GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2
        ? {
            ...member,
            sha256: sha256(decoderBytes),
            byteLength: decoderBytes.length,
          }
        : member,
    ),
    {
      relativePath,
      kind,
      sha256: sha256(bytes),
      byteLength: bytes.length,
    },
  ].sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  return replaceManifest(fixture, {
    ...materialOf(fixture.manifest),
    decoder,
    memberCount: members.length,
    members,
    totalMemberBytes: members.reduce(
      (total, member) => total + member.byteLength,
      0,
    ),
  });
}

describe("Grand Hall T-554 native-review v2 implementation manifest", () => {
  it("verifies a path-free immutable candidate and binds only its same root", async () => {
    const fixture = await createFixture();
    const candidate = await verify(fixture);

    expect(candidate).toMatchObject({
      schemaVersion:
        "venviewer.grand-hall-t554-verified-native-review-implementation-pack-candidate.v2",
      manifestBinding: {
        schemaVersion:
          "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
        implementationId:
          GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_ID_V2,
        semanticSha256: fixture.anchor.manifestSemanticSha256,
        fileSha256: fixture.anchor.manifestFileSha256,
        byteLength: fixture.anchor.manifestFileByteLength,
      },
      memberCount: 15,
      concreteBytesVerified: true,
      runtimeIdentityVerified: true,
      bootstrapExecutionIdentityVerified: true,
      reviewedDecoderClosureBytesVerified: true,
      fixedAdmissionBindingVerified: true,
      executionPolicyManifestVerified: true,
      exactRootInventoryVerified: true,
      authority: "none",
      standaloneProductionFactoryAvailable: false,
      runtimeAuthorityAvailable: false,
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.manifest.members)).toBe(true);
    expect(JSON.stringify(candidate)).not.toContain(fixture.root);
    expect(candidate.copyExactManifestBytes()).toEqual(
      await readFile(fixture.manifestPath),
    );
    const destroyedCopy = candidate.copyExactManifestBytes();
    destroyedCopy.fill(0);
    expect(sha256(candidate.copyExactManifestBytes())).toBe(
      fixture.anchor.manifestFileSha256,
    );
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(
        candidate,
      ),
    ).toBe(true);
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2(
        candidate,
        fixture.root,
      );
    }).not.toThrow();

    const other = await createFixture();
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2(
        candidate,
        other.root,
      );
    }).toThrow(/different concrete root/u);
    const forged = { ...candidate };
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(forged),
    ).toBe(false);
  });

  it("does not brand generic exact-pack facts as a v2 candidate", async () => {
    const fixture = await createFixture();
    const facts =
      await __testOnlyGrandHallT554NativeReviewImplementationManifestV2.verifyExactPackWithObservations(
        {
          implementationPackRoot: fixture.root,
          reviewedAnchor: fixture.anchor,
          runtimeIdentity: fixture.manifest.runtime,
          bootstrapExecutionIdentity: COMPILED_BOOTSTRAP,
          seam: {},
        },
      );
    expect(Object.isFrozen(facts)).toBe(true);
    expect(JSON.stringify(facts)).not.toContain(fixture.root);
    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(facts),
    ).toBe(false);
    expect(() => {
      assertGrandHallT554VerifiedNativeReviewImplementationPackCandidateRootV2(
        facts,
        fixture.root,
      );
    }).toThrow(/not an exact same-instance verified handle/u);
  });

  it("exports no production verifier, fixed-root minter, or runtime minter", () => {
    expect(
      Reflect.get(
        v2ManifestModule,
        "verifyGrandHallT554NativeReviewImplementationPack",
      ),
    ).toBeUndefined();
    expect(
      Reflect.get(
        v2ManifestModule,
        "mintGrandHallT554LoadedNativeReviewImplementationRuntimeAuthorityV2",
      ),
    ).toBeUndefined();
    expect(
      Reflect.get(v2ManifestModule, "fixedProductionReviewedPack"),
    ).toBeUndefined();
    expect(verifyGrandHallT554NativeReviewImplementationPackCandidateV2).toHaveLength(
      1,
    );
    expect(
      reverifyGrandHallT554NativeReviewImplementationPackCandidateBytesV2,
    ).toHaveLength(1);
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
              '{"admission":',
              '{"authority":"none","admission":',
            ),
          "utf8",
        ),
    ],
  ])("rejects noncanonical %s manifest bytes", async (_label, mutate) => {
    const fixture = await createFixture();
    await writeFile(
      fixture.manifestPath,
      mutate(await readFile(fixture.manifestPath)),
    );
    await expect(verify(fixture)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it("rejects an extra manifest key, wrong semantic digest, and wrong reviewed anchor", async () => {
    const extra = await createFixture();
    const extraValue = {
      ...extra.manifest,
      payloadRoot: "C:\\caller-selected",
    };
    const extraBytes = serializeCanonical(extraValue);
    await writeFile(extra.manifestPath, extraBytes);
    await expect(
      verify(extra, {
        reviewedAnchor: {
          ...extra.anchor,
          manifestFileSha256: sha256(extraBytes),
          manifestFileByteLength: extraBytes.length,
        },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });

    const semantic = await createFixture();
    const invalid = {
      ...semantic.manifest,
      semanticSha256: `sha256:${"f".repeat(64)}` as const,
    };
    const invalidBytes = serializeCanonical(invalid);
    await writeFile(semantic.manifestPath, invalidBytes);
    await expect(
      verify(semantic, {
        reviewedAnchor: {
          manifestSemanticSha256: invalid.semanticSha256,
          manifestFileSha256: sha256(invalidBytes),
          manifestFileByteLength: invalidBytes.length,
        },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });

    const anchor = await createFixture();
    await expect(
      verify(anchor, {
        reviewedAnchor: {
          ...anchor.anchor,
          manifestFileSha256: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "REVIEWED_ANCHOR_MISMATCH" });
  });

  it("rejects unsorted inventories and a member relabelled into another role", async () => {
    const unsorted = await createFixture();
    const reversed = await replaceManifest(unsorted, {
      ...materialOf(unsorted.manifest),
      members: unsorted.manifest.members.slice().reverse(),
    });
    await expect(verify(reversed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });

    const role = await createFixture();
    const relabelled = role.manifest.members.map((member) =>
      member.relativePath ===
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2
        ? { ...member, kind: "payload-core" as const }
        : member,
    );
    const changed = await replaceManifest(role, {
      ...materialOf(role.manifest),
      members: relabelled,
    });
    await expect(verify(changed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it.each([
    {
      label: "third Sharp JSON runtime member",
      relativePath: "vendor/sharp/package.json",
      kind: "sharp-runtime" as const,
      bytes: Buffer.from("{}\n", "utf8"),
    },
    {
      label: "third libvips DLL member",
      relativePath: "vendor/libvips/libvips-extra.dll",
      kind: "libvips-native-dependency" as const,
      bytes: Buffer.from([0x00, 0xff, 0xfe, 0x80]),
    },
  ])("rejects a self-consistent $label", async ({ relativePath, kind, bytes }) => {
    const fixture = await createFixture();
    const changed = await addSelfConsistentDecoderMember(
      fixture,
      relativePath,
      kind,
      bytes,
    );

    await expect(verify(changed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it.each([
    GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
    GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
    GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
    GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
  ])("treats integrity-bound native binary %s as opaque bytes", async (member) => {
    const fixture = await createFixture();
    const changed = await replaceMemberBytes(
      fixture,
      member,
      Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41]),
    );

    expect(
      isGrandHallT554VerifiedNativeReviewImplementationPackCandidateV2(
        await verify(changed),
      ),
    ).toBe(true);
  });

  it("rejects missing, extra, empty-directory, and tampered members", async () => {
    const missing = await createFixture();
    await rm(missing.corePath);
    await expect(verify(missing)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const extra = await createFixture();
    await writeFile(resolve(extra.root, "server", "extra.js"), "export {};\n");
    await expect(verify(extra)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const empty = await createFixture();
    await mkdir(resolve(empty.root, "unreferenced"));
    await expect(verify(empty)).rejects.toMatchObject({
      code: "INVENTORY_MISMATCH",
    });

    const tampered = await createFixture();
    const bytes = await readFile(tampered.corePath);
    bytes[0] = bytes[0] === 0x69 ? 0x65 : 0x69;
    await writeFile(tampered.corePath, bytes);
    await expect(verify(tampered)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it("rejects a wrong fixed capsule, undeclared relative import, and server launch code", async () => {
    const wrongCapsule = await createFixture();
    const hostileGate = gateBytes().toString("utf8").replace(
      GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
      `${GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2}?candidate=1`,
    );
    const changedCapsule = await replaceMemberBytes(
      wrongCapsule,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
      Buffer.from(hostileGate, "utf8"),
    );
    await expect(verify(changedCapsule)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const ambient = await createFixture();
    const ambientCore = Buffer.concat([
      coreBytes(),
      Buffer.from('import "unreviewed-package";\n', "utf8"),
    ]);
    const changedAmbient = await replaceMemberBytes(
      ambient,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
      ambientCore,
    );
    await expect(verify(changedAmbient)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const listener = await createFixture();
    const changedListener = await replaceMemberBytes(
      listener,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      Buffer.from(
        "export function launch() { return createServer().listen(0); }\n",
        "utf8",
      ),
    );
    await expect(verify(changedListener)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const sharpAmbient = await createFixture();
    const sharpPath = resolve(
      sharpAmbient.root,
      ...GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2.split("/"),
    );
    const changedSharp = await replaceMemberBytes(
      sharpAmbient,
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
      Buffer.concat([
        await readFile(sharpPath),
        Buffer.from('import "ambient-sharp-package";\n', "utf8"),
      ]),
    );
    await expect(verify(changedSharp)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it.each([
    ["standaloneProductionFactoryIncluded", true],
    ["fixedAdmissionGatedFactoryIncluded", false],
    ["httpLaunchIncluded", true],
    ["sourceMapsIncluded", true],
    ["tsxExecutionAuthorized", true],
    ["mixedSourceDistResolutionAuthorized", true],
    ["ambientExternalRuntimeModuleResolutionAuthorized", true],
    ["fixedAdmissionCapsuleExternalImportRequired", false],
    ["browserControlledTruthAuthorized", true],
    ["externalNetworkAuthorized", true],
    ["acceptanceAuthorized", true],
    ["reconstructionAuthorized", true],
    ["runtimeAdmissionAuthorized", true],
    ["exportAuthorized", true],
    ["generatedContentAuthorized", true],
  ] as const)("rejects execution-policy drift in %s", async (field, value) => {
    const fixture = await createFixture();
    const changed = await replaceManifest(fixture, {
      ...materialOf(fixture.manifest),
      execution: {
        ...fixture.manifest.execution,
        [field]: value,
      },
    });
    await expect(verify(changed)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it("rejects fixed-admission binding drift and decoder-metadata drift", async () => {
    const admission = await createFixture();
    const changedAdmission = await replaceManifest(admission, {
      ...materialOf(admission.manifest),
      admission: {
        ...admission.manifest.admission,
        fixedAdmissionCapsuleUrl:
          `${GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2}#alias` as typeof GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
      },
    });
    await expect(verify(changedAdmission)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });

    const decoder = await createFixture();
    const changedDecoder = await replaceManifest(decoder, {
      ...materialOf(decoder.manifest),
      decoder: {
        ...decoder.manifest.decoder,
        libvipsVersion: "8.18.4",
      },
    });
    await expect(verify(changedDecoder)).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
    });
  });

  it("binds exact module metadata, decoder metadata, probe bytes, and browser-origin policy", async () => {
    const metadata = await createFixture();
    const changedMetadata = await replaceMemberBytes(
      metadata,
      GRAND_HALL_T554_NATIVE_REVIEW_PACKAGE_METADATA_MEMBER_V2,
      serializeCanonical({
        name: "@venviewer/grand-hall-t554-native-review-implementation-pack",
        private: true,
        type: "module",
        version: "2.0.1",
      }),
    );
    await expect(verify(changedMetadata)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const decoder = await createFixture();
    const changedDecoder = await replaceMemberBytes(
      decoder,
      GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
      serializeCanonical({ ...decoder.manifest.decoder, sharpVersion: "0.35.4" }),
    );
    await expect(verify(changedDecoder)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const probe = await createFixture();
    const changedProbe = await replaceMemberBytes(
      probe,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
      Buffer.from("not-the-reviewed-probe", "utf8"),
    );
    await expect(verify(changedProbe)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });

    const browser = await createFixture();
    const changedBrowser = await replaceMemberBytes(
      browser,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
      Buffer.from(
        'export async function escape() { return fetch("https://example.invalid"); }\n',
        "utf8",
      ),
    );
    await expect(verify(changedBrowser)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it.each([
    "//# sourceMappingURL=adapter.js.map",
    "export const runner = 'tsx';",
    "export const __testOnly = true;",
    "export const implementationPackRoot = '/caller-selected';",
    "export const request = fetch('/api/v2/state');",
    "export const ambient = import.meta.resolve('ambient-package');",
  ])("rejects forbidden server-output surface %s", async (snippet) => {
    const fixture = await createFixture();
    const changed = await replaceMemberBytes(
      fixture,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
      Buffer.from(`${snippet}\n`, "utf8"),
    );
    await expect(verify(changed)).rejects.toMatchObject({
      code: "MEMBER_INVALID",
    });
  });

  it("requires the current runtime identity and a clean compiled bootstrap", async () => {
    const fixture = await createFixture();
    await expect(
      verify(fixture, {
        runtimeIdentity: {
          ...fixture.manifest.runtime,
          nodeVersion: "v0.0.1",
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_MISMATCH" });

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
        nodeOptions: "",
        nodePath: null,
      },
      {
        compiledJavascriptModule: true,
        execArgv: [],
        nodeOptions: null,
        nodePath: "C:\\ambient-modules",
      },
    ] as const) {
      await expect(
        verify(fixture, { bootstrapExecutionIdentity }),
      ).rejects.toMatchObject({ code: "RUNTIME_MISMATCH" });
    }
  });

  it("rejects hard links and root aliases where the platform permits them", async () => {
    const hardLinked = await createFixture();
    await rm(hardLinked.adapterPath);
    await link(hardLinked.corePath, hardLinked.adapterPath);
    await expect(verify(hardLinked)).rejects.toMatchObject({
      code: "ROOT_UNSAFE",
    });

    const target = await createFixture();
    const aliasParent = await mkdtemp(join(tmpdir(), "t554-v2-alias-"));
    roots.push(aliasParent);
    const alias = resolve(aliasParent, "pack-alias");
    try {
      await symlink(
        target.root,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        return;
      }
      throw error;
    }
    await expect(
      verify(target, { implementationPackRoot: alias }),
    ).rejects.toMatchObject({ code: "ROOT_UNSAFE" });
  });

  it("rejects path, descriptor-growth, and final-inventory races", async () => {
    const pathRace = await createFixture();
    await expect(
      verify(pathRace, {
        seam: {
          afterInitialInventory: async () => {
            await writeFile(pathRace.corePath, "export const swapped = true;\n");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });

    const growthRace = await createFixture();
    await expect(
      verify(growthRace, {
        seam: {
          afterDescriptorOpened: async (relativePath) => {
            if (
              relativePath !==
              GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2
            ) {
              return;
            }
            await writeFile(
              growthRace.corePath,
              Buffer.concat([
                await readFile(growthRace.corePath),
                Buffer.from("// growth\n", "utf8"),
              ]),
            );
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });

    const finalRace = await createFixture();
    await expect(
      verify(finalRace, {
        seam: {
          afterMemberReads: async () => {
            await writeFile(resolve(finalRace.root, "late.js"), "export {};\n");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INVENTORY_MISMATCH" });
  });

  it("inherits exceptional descriptor-read buffer destruction from the shared verifier", async () => {
    const fixture = await createFixture();
    let destroyed = false;
    await expect(
      verify(fixture, {
        seam: {
          afterReadChunk: (relativePath) => {
            if (
              relativePath ===
              GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2
            ) {
              throw new Error("injected read failure");
            }
          },
          afterExceptionalReadBufferDestroyed: (facts) => {
            if (
              facts.relativePath ===
              GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2
            ) {
              destroyed = facts.bytesWereZeroed;
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
    expect(destroyed).toBe(true);
  });

  it("same-root reverification detects a post-verification mutation", async () => {
    const fixture = await createFixture();
    const candidate = await verify(fixture);
    await expect(
      __testOnlyGrandHallT554NativeReviewImplementationManifestV2.reverifyCandidateWithObservations(
        {
          implementationPackRoot: fixture.root,
          candidate,
        },
        fixture.manifest.runtime,
        COMPILED_BOOTSTRAP,
        {},
      ),
    ).resolves.toBeUndefined();

    await writeFile(
      fixture.corePath,
      Buffer.concat([
        await readFile(fixture.corePath),
        Buffer.from("// mutated after verification\n", "utf8"),
      ]),
    );
    await expect(
      __testOnlyGrandHallT554NativeReviewImplementationManifestV2.reverifyCandidateWithObservations(
        {
          implementationPackRoot: fixture.root,
          candidate,
        },
        fixture.manifest.runtime,
        COMPILED_BOOTSTRAP,
        {},
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/MEMBER_INVALID|PACK_CHANGED/u),
    });
  });

  it("rejects a descriptor/path replacement even when the old descriptor remains readable", async () => {
    const fixture = await createFixture();
    const displaced = resolve(fixture.root, "server", "displaced-v2.js");
    await expect(
      verify(fixture, {
        seam: {
          afterDescriptorOpened: async (relativePath) => {
            if (
              relativePath !==
              GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2
            ) {
              return;
            }
            await rename(fixture.adapterPath, displaced);
            await writeFile(
              fixture.adapterPath,
              "export const forged = true;\n",
            );
          },
        },
      }),
    ).rejects.toMatchObject({ code: "PACK_CHANGED" });
  });
});
