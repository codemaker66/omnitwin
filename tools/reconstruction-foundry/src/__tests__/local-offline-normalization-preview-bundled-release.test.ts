import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  dssePreAuthenticationEncoding,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { describe, expect, it } from "vitest";
import {
  LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_DSSE_PAYLOAD_TYPE,
  LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1,
  LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1,
  computeLocalOfflinePreviewBundledReleaseManifestSha256,
  computeLocalOfflinePreviewContainerConfigurationSha256,
  computeLocalOfflinePreviewLiveQualificationReportSha256,
  getLocalOfflinePreviewBundledReleaseAuthority,
  isLocalOfflinePreviewBundledReleaseAuthority,
  readLocalOfflinePreviewBundledReleaseMaterial,
  verifyLocalOfflinePreviewBundledRelease,
  type LocalOfflinePreviewBundledPermitKeyV1,
  type LocalOfflinePreviewBundledReleaseManifestPayloadV1,
  type LocalOfflinePreviewLiveQualificationReportPayloadV1,
} from "../local-offline-normalization-preview-bundled-release.js";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
  type LocalOfflinePreviewContainerConfiguration,
} from "../local-offline-normalization-preview-container-preflight.js";

const DOCKER_PATH = resolve("fixtures", "docker.exe");
const SECCOMP_PATH = resolve("fixtures", "offline-preview-seccomp.json");
const RELEASE_KEY_ID = "offline-preview-release-a";
const RELEASE_SIGNER = generateKeyPairSync("ed25519");
const WRONG_RELEASE_SIGNER = generateKeyPairSync("ed25519");

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function publicKeyRecord(
  keyId: string,
  publicKey: KeyObject,
): LocalOfflinePreviewBundledPermitKeyV1 {
  const spki = publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.isBuffer(spki)) throw new TypeError("Expected DER SPKI bytes.");
  return {
    purpose: "offline_normalization_preview_permit",
    algorithm: "Ed25519",
    keyId,
    publicKeySpkiDerBase64: spki.toString("base64"),
    publicKeySpkiSha256: sha256(spki),
  };
}

const PERMIT_KEY = publicKeyRecord(
  "offline-preview-permit-a",
  generateKeyPairSync("ed25519").publicKey,
);

function validConfiguration(): LocalOfflinePreviewContainerConfiguration {
  const memoryBytes = 768 * 1024 * 1024;
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V2,
    authority: "none",
    fallbackPolicy: "block",
    containerPlatform: "linux/amd64",
    dockerExecutablePath: DOCKER_PATH,
    seccompProfilePath: SECCOMP_PATH,
    seccompProfileSha256: sha256("fixture seccomp profile"),
    seccompDefaultAction: "SCMP_ACT_ERRNO",
    imageReference:
      `local/offline-preview@${sha256("fixture image repository")}`,
    imageId: sha256("fixture image id"),
    imagePullPolicy: "never",
    networkMode: "none",
    rootFilesystem: "read_only",
    mountPolicy: "none",
    capabilityPolicy: "drop_all",
    noNewPrivileges: true,
    userId: 10_001,
    groupId: 10_001,
    workerKind: "offline_normalization_preview",
    workerProtocolSha256: sha256("fixture worker protocol"),
    workerArtifactSha256: sha256("fixture worker artifact"),
    fixedEntrypoint: LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
    runtimeWatchdog: {
      kind: "busybox_timeout_pid1_wall_clock",
      executablePath: "/bin/busybox",
      artifactSha256: sha256("fixture busybox artifact"),
      coverage: "stdin_worker_stdout",
      terminationSignal: "SIGKILL",
      independentOfHostProcess: true,
      maximumRuntimeMilliseconds: 60_000,
    },
    resourceLimits: {
      cpuCores: 2,
      memoryBytes,
      memorySwapBytes: memoryBytes,
      pidsLimit: 32,
      maximumInputBytes: 64 * 1024 * 1024,
      maximumOutputBytes: 64 * 1024 * 1024,
      maximumRuntimeMilliseconds: 60_000,
    },
  };
}

function validReportPayload(
  configuration: LocalOfflinePreviewContainerConfiguration =
    validConfiguration(),
): LocalOfflinePreviewLiveQualificationReportPayloadV1 {
  const configurationSha256 =
    computeLocalOfflinePreviewContainerConfigurationSha256(configuration);
  if (configurationSha256 === null) {
    throw new TypeError("Expected a valid container configuration.");
  }
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_LIVE_QUALIFICATION_REPORT_V1,
    status: "qualified",
    qualifiedAt: "2026-07-18T12:00:00.000Z",
    imageReference: configuration.imageReference,
    imageId: configuration.imageId,
    imageApprovalScope:
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
    imageBuildQualificationStatus:
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
    containerConfigurationSha256: configurationSha256,
    dockerExecutableArtifactSha256: sha256("fixture Docker executable"),
    workerProtocolSha256: configuration.workerProtocolSha256,
    workerArtifactSha256: configuration.workerArtifactSha256,
    seccompProfileSha256: configuration.seccompProfileSha256,
    watchdogArtifactSha256:
      configuration.runtimeWatchdog.artifactSha256,
    checks: {
      successfulTransformAndFreshVerificationRuns: 3,
      successfulCancellationRuns: 2,
      networkModeNoneObserved: true,
      readOnlyRootFilesystemObserved: true,
      noHostMountsObserved: true,
      nonRootUserObserved: true,
      pid1WatchdogObserved: true,
      freshContainerPerPhaseObserved: true,
      cleanupAbsenceProved: true,
    },
  };
}

function reportFor(
  reportPayload: LocalOfflinePreviewLiveQualificationReportPayloadV1,
): Readonly<{
  payload: LocalOfflinePreviewLiveQualificationReportPayloadV1;
  reportSha256: string;
}> {
  const reportSha256 =
    computeLocalOfflinePreviewLiveQualificationReportSha256(reportPayload);
  if (reportSha256 === null) {
    throw new TypeError("Expected a valid live qualification report.");
  }
  return { payload: reportPayload, reportSha256 };
}

function validPayload(): LocalOfflinePreviewBundledReleaseManifestPayloadV1 {
  const configuration = validConfiguration();
  const reportPayload = validReportPayload(configuration);
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_MANIFEST_V1,
    releaseId: "offline-preview-fixture-2026-07-18",
    qualification: {
      kind: "docker_live_offline_preview_v1",
      report: reportFor(reportPayload),
    },
    dockerExecutable: {
      path: DOCKER_PATH,
      artifactSha256: reportPayload.dockerExecutableArtifactSha256,
    },
    containerConfiguration: configuration,
    imageRuntimeContract: {
      environment: LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
      workingDirectory: LOCAL_OFFLINE_PREVIEW_CONTAINER_WORKING_DIRECTORY_V2,
      stopSignal: LOCAL_OFFLINE_PREVIEW_CONTAINER_STOP_SIGNAL_V2,
    },
    trustedPermitKeys: [PERMIT_KEY],
  };
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(stableCanonicalJson(toCanonicalJson(value)), "utf8");
}

function envelopeForBytes(
  payloadBytes: Buffer,
  signer: KeyObject = RELEASE_SIGNER.privateKey,
  keyId = RELEASE_KEY_ID,
): Readonly<{
  payloadType: string;
  payload: string;
  signatures: readonly [{ readonly keyid: string; readonly sig: string }];
}> {
  return {
    payloadType: LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_DSSE_PAYLOAD_TYPE,
    payload: payloadBytes.toString("base64"),
    signatures: [{
      keyid: keyId,
      sig: sign(
        null,
        dssePreAuthenticationEncoding(
          LOCAL_OFFLINE_PREVIEW_BUNDLED_RELEASE_DSSE_PAYLOAD_TYPE,
          payloadBytes,
        ),
        signer,
      ).toString("base64"),
    }],
  };
}

function signedEnvelope(
  payload: unknown = validPayload(),
  signer: KeyObject = RELEASE_SIGNER.privateKey,
  keyId = RELEASE_KEY_ID,
): ReturnType<typeof envelopeForBytes> {
  return envelopeForBytes(canonicalBytes(payload), signer, keyId);
}

function trustedReleaseKeys(
  key: KeyObject = RELEASE_SIGNER.publicKey,
): ReadonlyMap<string, KeyObject> {
  return new Map([[RELEASE_KEY_ID, key]]);
}

function verify(
  envelope: unknown,
  keys: unknown = trustedReleaseKeys(),
): ReturnType<typeof verifyLocalOfflinePreviewBundledRelease> {
  return verifyLocalOfflinePreviewBundledRelease(envelope, keys);
}

function rejectionCode(envelope: unknown, keys?: unknown): string | null {
  const result = verify(envelope, keys ?? trustedReleaseKeys());
  return result.status === "unavailable" ? result.rejectionCode : null;
}

describe("local offline preview signed bundled release authority", () => {
  it("keeps the generated production bundle and trust root null/fail-closed", async () => {
    const lookup = getLocalOfflinePreviewBundledReleaseAuthority();

    expect(lookup).toMatchObject({
      status: "unavailable",
      code: "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE",
      capability: null,
      rejectionCode: null,
    });
    expect(getLocalOfflinePreviewBundledReleaseAuthority()).toBe(lookup);
    expect(JSON.parse(JSON.stringify(lookup))).toEqual({
      liveAuthorityCapable: false,
      authority: "none",
      claimStatus: "unauthenticated_integrity_claim",
      attestationAuthority: "none",
      cryptographicallyAuthenticated: false,
    });

    const generated = await readFile(new URL(
      "../local-offline-normalization-preview-bundled-release.generated.ts",
      import.meta.url,
    ), "utf8");
    expect(generated).toMatch(
      /LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST:\s*unknown = null;/u,
    );
    expect(generated).toMatch(
      /LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_TRUST_ROOT:\s*unknown = null;/u,
    );
  });

  it("accepts one exact signed bundle only with its explicit trusted key", () => {
    const payload = validPayload();
    const envelope = signedEnvelope(payload);

    expect(rejectionCode(envelope, new Map())).toBe(
      "MANIFEST_TRUST_ROOT_REJECTED",
    );
    expect(rejectionCode(
      envelope,
      trustedReleaseKeys(WRONG_RELEASE_SIGNER.publicKey),
    )).toBe("MANIFEST_SIGNATURE_REJECTED");

    const accepted = verify(envelope);
    expect(accepted).toMatchObject({
      status: "available",
      code: "SIGNED_BUNDLED_DOCKER_QUALIFICATION_AVAILABLE",
    });
    if (accepted.status !== "available") {
      throw new TypeError("Expected the signed bundle to verify.");
    }
    expect(accepted.capability.authority).toBe(
      "cryptographically_verified_bundled_release",
    );
    expect(accepted.capability.verifiedReleaseSigningKeyIds).toEqual([
      RELEASE_KEY_ID,
    ]);
    expect(isLocalOfflinePreviewBundledReleaseAuthority(
      accepted.capability,
    )).toBe(true);
    const material = readLocalOfflinePreviewBundledReleaseMaterial(
      accepted.capability,
    );
    expect(material).not.toBeNull();
    expect(material).toMatchObject({
      releaseId: payload.releaseId,
      qualificationReportSha256:
        payload.qualification.report.reportSha256,
      dockerExecutableArtifactSha256:
        payload.dockerExecutable.artifactSha256,
    });
    expect(material?.releaseManifestSha256).toBe(
      sha256(canonicalBytes(payload)),
    );
    expect(material?.pinnedTrustedPermitKeys.get(PERMIT_KEY.keyId)
      ?.asymmetricKeyType).toBe("ed25519");
  });

  it("rejects unsigned and old self-digest-only release claims", () => {
    const payload = validPayload();
    const selfDigest =
      computeLocalOfflinePreviewBundledReleaseManifestSha256(payload);
    expect(selfDigest).not.toBeNull();

    expect(rejectionCode(payload)).toBe("MANIFEST_SHAPE_REJECTED");
    expect(rejectionCode({ payload, manifestSha256: selfDigest })).toBe(
      "MANIFEST_SHAPE_REJECTED",
    );
  });

  it("rejects a report hash string in place of the complete live report", () => {
    const payload = validPayload();
    const stringOnly = {
      ...payload,
      qualification: {
        kind: "docker_live_offline_preview_v1",
        report: payload.qualification.report.reportSha256,
      },
    };

    expect(rejectionCode(signedEnvelope(stringOnly))).toBe(
      "QUALIFICATION_REPORT_REJECTED",
    );
  });

  it("rejects a tampered report even when the attacker recomputes its self-digest", () => {
    const originalPayload = validPayload();
    const originalEnvelope = signedEnvelope(originalPayload);
    const tamperedReportPayload = {
      ...originalPayload.qualification.report.payload,
      qualifiedAt: "2026-07-18T12:00:01.000Z",
    };
    const tamperedPayload = {
      ...originalPayload,
      qualification: {
        ...originalPayload.qualification,
        report: reportFor(tamperedReportPayload),
      },
    };
    const replacementBytes = canonicalBytes(tamperedPayload);
    const envelopeWithOriginalSignature = {
      ...originalEnvelope,
      payload: replacementBytes.toString("base64"),
    };

    expect(rejectionCode(envelopeWithOriginalSignature)).toBe(
      "MANIFEST_SIGNATURE_REJECTED",
    );
  });

  it("rehashes the fully parsed report before trusting its signed binding", () => {
    const payload = validPayload();
    const wrongReportDigest = {
      ...payload,
      qualification: {
        ...payload.qualification,
        report: {
          ...payload.qualification.report,
          reportSha256: sha256("attacker asserted report digest"),
        },
      },
    };
    expect(rejectionCode(signedEnvelope(wrongReportDigest))).toBe(
      "QUALIFICATION_REPORT_DIGEST_MISMATCH",
    );
  });

  it.each([
    [
      "image ID",
      (payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1): unknown => {
        const reportPayload = {
          ...payload.qualification.report.payload,
          imageId: sha256("different image ID"),
        };
        return {
          ...payload,
          qualification: {
            ...payload.qualification,
            report: reportFor(reportPayload),
          },
        };
      },
      "QUALIFICATION_REPORT_BINDING_MISMATCH",
    ],
    [
      "digest-pinned image reference",
      (payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1): unknown => {
        const reportPayload = {
          ...payload.qualification.report.payload,
          imageReference:
            `local/offline-preview@${sha256("different repository digest")}`,
        };
        return {
          ...payload,
          qualification: {
            ...payload.qualification,
            report: reportFor(reportPayload),
          },
        };
      },
      "QUALIFICATION_REPORT_BINDING_MISMATCH",
    ],
    [
      "build-owned approval scope",
      (payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1): unknown => ({
        ...payload,
        qualification: {
          ...payload.qualification,
          report: {
            payload: {
              ...payload.qualification.report.payload,
              imageApprovalScope: "test_only_non_authoritative",
            },
            reportSha256: payload.qualification.report.reportSha256,
          },
        },
      }),
      "QUALIFICATION_REPORT_REJECTED",
    ],
    [
      "honest unqualified build label",
      (payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1): unknown => ({
        ...payload,
        qualification: {
          ...payload.qualification,
          report: {
            payload: {
              ...payload.qualification.report.payload,
              imageBuildQualificationStatus: "qualified",
            },
            reportSha256: payload.qualification.report.reportSha256,
          },
        },
      }),
      "QUALIFICATION_REPORT_REJECTED",
    ],
    [
      "container configuration digest",
      (payload: LocalOfflinePreviewBundledReleaseManifestPayloadV1): unknown => {
        const reportPayload = {
          ...payload.qualification.report.payload,
          containerConfigurationSha256: sha256("different configuration"),
        };
        return {
          ...payload,
          qualification: {
            ...payload.qualification,
            report: reportFor(reportPayload),
          },
        };
      },
      "QUALIFICATION_REPORT_BINDING_MISMATCH",
    ],
  ])("rejects a trusted signature over a mismatched %s", (
    _description,
    mutate,
    code,
  ) => {
    expect(rejectionCode(signedEnvelope(mutate(validPayload())))).toBe(code);
  });

  it("requires every live isolation and cleanup check to be positively proved", () => {
    const payload = validPayload();
    const weakReport = {
      ...payload.qualification.report.payload,
      checks: {
        ...payload.qualification.report.payload.checks,
        cleanupAbsenceProved: false,
      },
    };
    const weakPayload = {
      ...payload,
      qualification: {
        ...payload.qualification,
        report: {
          payload: weakReport,
          reportSha256: payload.qualification.report.reportSha256,
        },
      },
    };

    expect(rejectionCode(signedEnvelope(weakPayload))).toBe(
      "QUALIFICATION_REPORT_REJECTED",
    );
  });

  it("rejects non-canonical signed JSON and duplicate-key ambiguity", () => {
    const payload = validPayload();
    const nonCanonical = Buffer.from(JSON.stringify(payload), "utf8");
    expect(nonCanonical.equals(canonicalBytes(payload))).toBe(false);
    expect(rejectionCode(envelopeForBytes(nonCanonical))).toBe(
      "MANIFEST_CANONICAL_BYTES_REJECTED",
    );

    const canonical = canonicalBytes(payload).toString("utf8");
    const duplicateReleaseId = canonical.replace(
      `"releaseId":"${payload.releaseId}"`,
      `"releaseId":"attacker","releaseId":"${payload.releaseId}"`,
    );
    expect(rejectionCode(envelopeForBytes(
      Buffer.from(duplicateReleaseId, "utf8"),
    ))).toBe("MANIFEST_CANONICAL_BYTES_REJECTED");
  });

  it("rejects signatures with the wrong payload type or unknown key ID", () => {
    const envelope = signedEnvelope();
    expect(rejectionCode({
      ...envelope,
      payloadType: "application/vnd.attacker.release+json",
    })).toBe("MANIFEST_SIGNATURE_REJECTED");
    expect(rejectionCode(signedEnvelope(
      validPayload(),
      RELEASE_SIGNER.privateKey,
      "unknown-release-key",
    ))).toBe("MANIFEST_SIGNATURE_REJECTED");
  });

  it("rejects a structurally convincing forged capability", () => {
    const forgedCapability = Object.freeze({
      authority: "cryptographically_verified_bundled_release",
      liveAuthorityCapable: true,
      releaseId: validPayload().releaseId,
      releaseManifestSha256: sha256("forged manifest"),
      verifiedReleaseSigningKeyIds: [RELEASE_KEY_ID],
      toJSON: (): Record<string, unknown> => ({ authority: "forged" }),
    });

    expect(isLocalOfflinePreviewBundledReleaseAuthority(
      forgedCapability,
    )).toBe(false);
    expect(readLocalOfflinePreviewBundledReleaseMaterial(
      forgedCapability,
    )).toBeNull();
  });

  it("does not expose the old self-mint and serializes no positive authority", async () => {
    const source = await readFile(new URL(
      "../local-offline-normalization-preview-bundled-release.ts",
      import.meta.url,
    ), "utf8");
    expect(source).not.toContain("bundledReleaseAuthorityMint");
    expect(source).not.toContain('authority: "app_bundled_release"');
    expect(source).toContain("verifyDsseEnvelope");

    const accepted = verify(signedEnvelope());
    if (accepted.status !== "available") {
      throw new TypeError("Expected the signed bundle to verify.");
    }
    const serialized = JSON.stringify(accepted.capability);
    expect(JSON.parse(serialized)).toEqual({
      liveAuthorityCapable: false,
      authority: "none",
      claimStatus: "unauthenticated_integrity_claim",
      attestationAuthority: "none",
      cryptographicallyAuthenticated: false,
    });
    expect(serialized).not.toContain(DOCKER_PATH);
    expect(serialized).not.toContain(RELEASE_KEY_ID);
    expect(serialized).not.toContain(PERMIT_KEY.keyId);
  });

  it("turns hostile accessors, proxies, and private-key trust roots into rejection", () => {
    const accessorEnvelope = signedEnvelope();
    Object.defineProperty(accessorEnvelope, "payload", {
      enumerable: true,
      get: (): never => {
        throw new Error("caller-controlled getter");
      },
    });
    const hostileProxy = new Proxy<Record<string, unknown>>({}, {
      ownKeys: (): never => {
        throw new Error("caller-controlled proxy");
      },
    });

    expect(rejectionCode(accessorEnvelope)).toBe("MANIFEST_SHAPE_REJECTED");
    expect(rejectionCode(hostileProxy)).toBe("MANIFEST_SHAPE_REJECTED");
    expect(rejectionCode(
      signedEnvelope(),
      new Map([[RELEASE_KEY_ID, RELEASE_SIGNER.privateKey]]),
    )).toBe("MANIFEST_TRUST_ROOT_REJECTED");
  });
});
