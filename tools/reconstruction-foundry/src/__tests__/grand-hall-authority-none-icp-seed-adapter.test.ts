import {
  CanonicalJsonValueSchema,
  GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
  GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
  GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
  GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX,
  GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256,
  GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS,
  GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS,
  GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS,
  GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
  GrandHallRegistrationSeedV1Schema,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "@omnitwin/types";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_V1,
  GrandHallAuthorityNoneIcpSeedAdapterError,
  buildGrandHallRegistrationSeedFromVerifiedTwoProcessProof,
} from "../grand-hall-authority-none-icp-seed-adapter.js";

function bareDigest(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

function unprefixedDigest(value: `sha256:${string}`): string {
  return value.slice("sha256:".length);
}

function receiptObject(): CanonicalJsonValue {
  const algorithmDigest = unprefixedDigest(
    GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
  );
  const iterations =
    GRAND_HALL_REGISTRATION_SEED_MUTUAL_CORRESPONDENCE_COUNTS.map(
      (mutualCorrespondenceCount, index) => ({
        iterationOrdinal: index + 1,
        thresholdMetresFloat64Hex:
          index < 8
            ? "3fe3333333333333"
            : index < 20
              ? "3fd6666666666666"
              : index < 32
                ? "3fc999999999999a"
                : "3fbeb851eb851eb8",
        sourceVertexCount: 24_977,
        targetVertexCount: 59_049,
        mutualCorrespondenceCount,
        correspondencePairInventoryRawSha256: unprefixedDigest(
          GRAND_HALL_REGISTRATION_SEED_CORRESPONDENCE_PAIR_RAW_SHA256[index]!,
        ),
      }),
    );
  const adapter = {
    schemaVersion: GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_V1,
    workerSchemaVersion: "venviewer.grand-hall.authority-none-icp-replay.v1",
    authority: "none",
    architecturalEvidence: false,
    humanReviewRequiredBeforeAnyPromotion: true,
    algorithmCanonicalJsonSha256: algorithmDigest,
    source: {
      fileSha256:
        "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
      fileSizeBytes: 2_222_742,
      orderedVertexCount: 34_040,
      orderedTriangleCount: 59_763,
      orderedVerticesPackedLittleEndianFloat64RawSha256:
        "94515cd5c338cae7b774c698cc880b31c85035f45247aab98f2847a5f4bfdb9e",
      selectedVertexCount: 24_977,
      selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256:
        "dd4472d4ae5a0c3a926e69565733923a464a0779e16f37963889184e0db3035d",
      selectedOriginalVerticesPackedLittleEndianFloat64RawSha256:
        "337109fc3a5b0224df6ef6d90c2e799f31ce9c613d34cb94b666e1382dadefd6",
    },
    target: {
      fileSha256:
        "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      fileSizeBytes: 38_381_816,
      allOrderedVertexCount: 237_561,
      globalFaceCount: 474_049,
      allOrderedVerticesPackedLittleEndianFloat64RawSha256:
        "6131e230ef394052f760be75bc2b8dcf7812dafe405dad3b22f1fd049cf7a72f",
      selectedFaceCount: 119_564,
      selectedVertexCount: 59_049,
      selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256:
        "91f810dcec2873d9e3d072b3f53b393f82f1ea62c0fc5b1f0095cfbb7db6e917",
      selectedOrderedVerticesPackedLittleEndianFloat64RawSha256:
        "27e7d980d3e535dad43d59af4c17ff3d8152c0138d5c8904eb2e2e319d5acdde",
    },
    iterations,
    lastFitInput: {
      iterationOrdinal: 40,
      correspondenceCount: 8_294,
      correspondencePairInventoryRawSha256:
        iterations[39]!.correspondencePairInventoryRawSha256,
      distanceInventoryRawSha256:
        "61f56f6eb0c80e805bf33563d4ca9d8844b15fecfc74bdf18c04855a3d3e112a",
      metrics: { ...GRAND_HALL_REGISTRATION_SEED_LAST_FIT_METRICS },
    },
    candidateArfToCvfRowMajorMatrixFloat64Hex: [
      ...GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX,
    ],
    finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256:
      "c2cd63576b9227ed27a136ff87a4823e6401b5318de27f046a0c05567e0c7d2a",
    postfitAllSourceToTarget: {
      sourceVertexCount: 24_977,
      distanceInventoryRawSha256:
        "db86df37dcdab47a1f8e6f146cab61e6a02b5f87dc1b4a0345dbd82972ebb7d4",
      metrics: {
        ...GRAND_HALL_REGISTRATION_SEED_ALL_SOURCE_TO_TARGET_METRICS,
      },
    },
    postfitMutualAudit: {
      thresholdMetresFloat64Hex: "3fbeb851eb851eb8",
      correspondenceCount: 8_290,
      correspondencePairInventoryRawSha256:
        "9ee8d05eab0925f04734700ccd1eeebb7612bc2f81a3a9fd039e6f3f9b0bcc5e",
      distanceInventoryRawSha256:
        "373711d105def9ab5992788e8ab4bbe05697ceeddce117ba3781477f55a413bd",
      metrics: { ...GRAND_HALL_REGISTRATION_SEED_POSTFIT_MUTUAL_METRICS },
      exactNearestNeighbourTies: [
        {
          direction: "source_to_target",
          tiedQueryVertexCount: 1,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            "07e48e05237181ba2b3b532ee75511b2c10e7d8be4b2b30b551ecbb80e622c20",
        },
        {
          direction: "target_to_source",
          tiedQueryVertexCount: 1_002,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            "2463918bd6d02825251cb09d67087a86802cbf5c42c0b55f5994c41636a4746e",
        },
      ],
    },
  };
  return {
    schemaVersion: "venviewer.grand-hall.authority-none-icp-replay.v1",
    authority: {
      classification: "none",
      acceptedTransform: false,
      architecturalEvidence: false,
      claim: "recovered-historical-diagnostic-replay-only",
      humanReviewRequiredBeforeAnyPromotion: true,
    },
    runtime: {
      pythonVersion: "3.13.6",
      numpyVersion: "2.4.2",
      scipyVersion: "1.17.0",
      trimeshVersion: "4.11.2",
      bitExactComparisonRequiresSamePinnedNumericalRuntime: true,
    },
    algorithmCanonicalJsonSha256: algorithmDigest,
    seedAdapterV1: adapter,
    guardrails: {
      pathsIncludedInReceipt: false,
      timestampsIncludedInReceipt: false,
      writesFiles: false,
      fixedIterationCount: true,
      failsOnNonFiniteValues: true,
      nearestNeighbourTiesInventoried: true,
      nearestNeighbourTiesAloneRejected: false,
      exactSameProcessRepeatedReceiptRequired: true,
      failsOnRankDeficientKabschInputs: true,
      doesNotInferArchitecture: true,
      doesNotClaimRegistrationAcceptance: true,
    },
  };
}

function fixtureCanonicalJson(url: URL): string {
  const text = readFileSync(url, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1);
}

const seedAdapterFixtureUrl = new URL(
  "./fixtures/grand-hall-authority-none-icp-seed-adapter-v1.json",
  import.meta.url,
);
const proofFixtureUrl = new URL(
  "../../../../docs/operations/grand-hall-authority-none-icp-two-process-proof-v1.json",
  import.meta.url,
);
const persistedRegistrationSeedUrl = new URL(
  "../../../../docs/operations/grand-hall-authority-none-registration-seed-v1.json",
  import.meta.url,
);

function build(
  canonicalSeedAdapterJson = fixtureCanonicalJson(seedAdapterFixtureUrl),
  twoProcessProofCanonicalJson = fixtureCanonicalJson(proofFixtureUrl),
  artifactId = "grand-hall-historical-registration-seed-001",
  createdAt = "2026-08-28T14:00:00.000Z",
) {
  return buildGrandHallRegistrationSeedFromVerifiedTwoProcessProof({
    canonicalSeedAdapterJson,
    twoProcessProofCanonicalJson,
    workerImplementationBytes: readFileSync(
      new URL(
        "../../scripts/grand_hall_authority_none_icp_replay.py",
        import.meta.url,
      ),
    ),
    processedBigInventorySha256:
      GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
    artifactId,
    createdAt,
  });
}

describe("Grand Hall authority-none ICP seed adapter", () => {
  it("binds the compact real two-process proof without embedding source paths or the full receipt", () => {
    const canonicalProofJson = fixtureCanonicalJson(proofFixtureUrl);
    const proof = CanonicalJsonValueSchema.parse(
      JSON.parse(canonicalProofJson) as unknown,
    );
    expect(stableCanonicalJson(proof)).toBe(canonicalProofJson);
    expect(`sha256:${sha256Hex(canonicalProofJson)}`).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
    );
    if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
      throw new Error("two-process proof root must be an object");
    }
    expect(Reflect.get(proof, "schemaVersion")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
    );
    expect(Reflect.get(proof, "canonicalWorkerReceiptByteLength")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
    );
    expect(Reflect.get(proof, "canonicalWorkerReceiptIncluded")).toBe(false);
    expect(Reflect.get(proof, "canonicalWorkerReceiptSha256")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256.slice(
        "sha256:".length,
      ),
    );
    expect(Reflect.get(proof, "seedAdapterV1CanonicalJsonSha256")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256.slice(
        "sha256:".length,
      ),
    );
    const bindings = Reflect.get(proof, "implementationBindings");
    if (
      typeof bindings !== "object" ||
      bindings === null ||
      Array.isArray(bindings)
    ) {
      throw new Error("two-process proof implementation bindings are absent");
    }
    expect(Reflect.get(bindings, "childEntryImplementationSha256")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256.slice(
        "sha256:".length,
      ),
    );
    expect(Reflect.get(bindings, "twoProcessRunnerImplementationSha256")).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256.slice(
        "sha256:".length,
      ),
    );
    expect(
      `sha256:${sha256Hex(
        readFileSync(
          new URL(
            "../../scripts/grand_hall_authority_none_icp_replay.py",
            import.meta.url,
          ),
        ),
      )}`,
    ).toBe(GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256);
    expect(
      `sha256:${sha256Hex(
        readFileSync(
          new URL(
            "../../scripts/grand_hall_authority_none_icp_child_entry.py",
            import.meta.url,
          ),
        ),
      )}`,
    ).toBe(GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256);
    expect(
      `sha256:${sha256Hex(
        readFileSync(
          new URL(
            "../../scripts/grand_hall_authority_none_icp_two_process_runner.py",
            import.meta.url,
          ),
        ),
      )}`,
    ).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
    );
    const processEvidence = Reflect.get(proof, "processEvidence");
    if (
      typeof processEvidence !== "object" ||
      processEvidence === null ||
      Array.isArray(processEvidence)
    ) {
      throw new Error("two-process proof process evidence is absent");
    }
    expect(processEvidence).toEqual({
      canonicalWorkerReceiptBytesIdentical: true,
      childProcessCount: 2,
      distinctChildProcessIdsWithinParentRun: true,
      distinctLauncherProcessIdsWithinParentRun: true,
      launcherWorkerProcessChainsValidated: true,
      launchProcessModels: [
        "python-launcher-redirected-worker-child",
        "python-launcher-redirected-worker-child",
      ],
    });
    const reviewedInputBindings = Reflect.get(proof, "reviewedInputBindings");
    expect(reviewedInputBindings).toEqual({
      bindingsReverifiedAfterBothChildrenExited: true,
      source: {
        byteLength: 2_222_742,
        sha256:
          "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
      },
      target: {
        byteLength: 38_381_816,
        sha256:
          "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      },
    });
    expect(Reflect.get(proof, "guardrails")).toMatchObject({
      machineIdentifiersIncludedInProof: false,
      processIdentifiersIncludedInProof: false,
      reviewedInputBytesValidatedBeforeChildLaunch: true,
    });
    expect(Reflect.get(proof, "determinismBoundary")).toMatchObject({
      classification:
        "reported-worker-versions-and-explicit-child-launch-controls-only",
      effectiveInterpreterBinaryVerified: false,
      explicitChildLaunchControlsApplied: true,
      reportedWorkerVersionsEqualAcrossChildren: true,
      environmentLockDocumentApplied: false,
      installedDependencyTreesVerified: false,
      loadedNativeClosureVerified: false,
      operatingSystemOrCpuIdentityVerified: false,
    });
    expect(canonicalProofJson).not.toContain("C:\\");
    expect(canonicalProofJson).not.toContain("F:\\");
    expect(canonicalProofJson).not.toMatch(
      /"(?:pid|ppid|runnerProcessId|launcherProcessId|reportedParentProcessId|workerProcessId)"/u,
    );
  });

  it("maps the path-free Python golden adapter payload without semantic drift", () => {
    const canonicalAdapterJson = fixtureCanonicalJson(seedAdapterFixtureUrl);
    const adapter = CanonicalJsonValueSchema.parse(
      JSON.parse(canonicalAdapterJson) as unknown,
    );
    expect(stableCanonicalJson(adapter)).toBe(canonicalAdapterJson);
    expect(sha256Hex(canonicalAdapterJson)).toBe(
      "5f84fa5a63f9d8fabda0f1a689d15a6c4046fd11e8d1813a53c2544bade798a6",
    );

    const workerReceipt = structuredClone(receiptObject());
    if (
      typeof workerReceipt !== "object" ||
      workerReceipt === null ||
      Array.isArray(workerReceipt)
    ) {
      throw new Error("fixture root must be an object");
    }
    expect(stableCanonicalJson(Reflect.get(workerReceipt, "seedAdapterV1"))).toBe(
      canonicalAdapterJson,
    );
    const seed = build(canonicalAdapterJson);

    expect(seed.finalResult.lastFitInput.correspondenceCount).toBe(8_294);
    expect(seed.finalResult.postfitAudit.correspondenceCount).toBe(8_290);
    expect(seed.finalResult.candidateArfToCvfRowMajorMatrixFloat64Hex).toEqual(
      GRAND_HALL_REGISTRATION_SEED_CANDIDATE_MATRIX_FLOAT64_HEX,
    );
  });

  it("maps the exact proof-bound projection into one strict authority-none seed", () => {
    const seed = build();
    expect(seed.repeatability.runs[0].workerCanonicalReceiptSha256).toBe(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
    );
    expect(seed.repeatability.runs[1].replayResultSha256).toBe(
      seed.repeatability.runs[0].replayResultSha256,
    );
    expect(seed.finalResult.lastFitInput.correspondenceCount).toBe(8_294);
    expect(seed.finalResult.postfitAudit.correspondenceCount).toBe(8_290);
    expect(seed.guardrails.acceptedTransform).toBeNull();
  });

  it("exactly regenerates the persisted canonical registration seed", () => {
    const canonicalSeedJson = fixtureCanonicalJson(
      persistedRegistrationSeedUrl,
    );
    expect(sha256Hex(canonicalSeedJson)).toBe(
      "ddd20078d3a61415d506b002f89fde146d28742d79a2f66ec0192923ef7f5a72",
    );
    const persistedSeed = GrandHallRegistrationSeedV1Schema.parse(
      JSON.parse(canonicalSeedJson) as unknown,
    );
    expect(stableCanonicalJson(persistedSeed)).toBe(canonicalSeedJson);

    const regeneratedSeed = build(
      undefined,
      undefined,
      "grand-hall-authority-none-registration-seed-2026-08-28-v1",
      "2026-08-28T07:04:19.149Z",
    );
    expect(regeneratedSeed).toEqual(persistedSeed);
    expect(regeneratedSeed.guardrails.authority).toBe("none");
    expect(regeneratedSeed.guardrails.acceptedTransform).toBeNull();
    expect(regeneratedSeed.guardrails.permitsCoordinateAcceptance).toBe(false);
    expect(regeneratedSeed.guardrails.permitsRuntimeUse).toBe(false);
  });

  it("rejects a canonical proof that differs by one reviewed byte", () => {
    const changed = JSON.parse(fixtureCanonicalJson(proofFixtureUrl)) as unknown;
    if (
      typeof changed !== "object" ||
      changed === null ||
      Array.isArray(changed)
    ) {
      throw new Error("fixture root must be an object");
    }
    Reflect.set(changed, "extra", true);
    expect(() =>
      build(
        undefined,
        stableCanonicalJson(CanonicalJsonValueSchema.parse(changed)),
      ),
    ).toThrow(
      "exact proof contract",
    );
  });

  it("rejects a resealed proof with forged receipt or process evidence", () => {
    const forgedReceipt = CanonicalJsonValueSchema.parse(
      JSON.parse(fixtureCanonicalJson(proofFixtureUrl)) as unknown,
    );
    if (
      typeof forgedReceipt !== "object" ||
      forgedReceipt === null ||
      Array.isArray(forgedReceipt)
    ) {
      throw new Error("proof root must be an object");
    }
    Reflect.set(forgedReceipt, "canonicalWorkerReceiptSha256", bareDigest(777));
    expect(() =>
      build(undefined, stableCanonicalJson(forgedReceipt)),
    ).toThrow("exact proof contract");

    const forgedProcesses = CanonicalJsonValueSchema.parse(
      JSON.parse(fixtureCanonicalJson(proofFixtureUrl)) as unknown,
    );
    if (
      typeof forgedProcesses !== "object" ||
      forgedProcesses === null ||
      Array.isArray(forgedProcesses)
    ) {
      throw new Error("proof root must be an object");
    }
    const evidence = Reflect.get(forgedProcesses, "processEvidence");
    if (
      typeof evidence !== "object" ||
      evidence === null ||
      Array.isArray(evidence)
    ) {
      throw new Error("process evidence must be an object");
    }
    Reflect.set(evidence, "distinctChildProcessIdsWithinParentRun", false);
    expect(() =>
      build(undefined, stableCanonicalJson(forgedProcesses)),
    ).toThrow("exact proof contract");
  });

  it("rejects legacy raw process identifiers and child records", () => {
    const legacyRunnerProcess = CanonicalJsonValueSchema.parse(
      JSON.parse(fixtureCanonicalJson(proofFixtureUrl)) as unknown,
    );
    if (
      typeof legacyRunnerProcess !== "object" ||
      legacyRunnerProcess === null ||
      Array.isArray(legacyRunnerProcess)
    ) {
      throw new Error("proof root must be an object");
    }
    const runnerEvidence = Reflect.get(
      legacyRunnerProcess,
      "processEvidence",
    );
    if (
      typeof runnerEvidence !== "object" ||
      runnerEvidence === null ||
      Array.isArray(runnerEvidence)
    ) {
      throw new Error("process evidence must be an object");
    }
    Reflect.set(runnerEvidence, "runnerProcessId", 1234);
    expect(() =>
      build(undefined, stableCanonicalJson(legacyRunnerProcess)),
    ).toThrow("exact proof contract");

    const legacyChildren = CanonicalJsonValueSchema.parse(
      JSON.parse(fixtureCanonicalJson(proofFixtureUrl)) as unknown,
    );
    if (
      typeof legacyChildren !== "object" ||
      legacyChildren === null ||
      Array.isArray(legacyChildren)
    ) {
      throw new Error("proof root must be an object");
    }
    const childrenEvidence = Reflect.get(legacyChildren, "processEvidence");
    if (
      typeof childrenEvidence !== "object" ||
      childrenEvidence === null ||
      Array.isArray(childrenEvidence)
    ) {
      throw new Error("process evidence must be an object");
    }
    Reflect.set(childrenEvidence, "children", []);
    expect(() =>
      build(undefined, stableCanonicalJson(legacyChildren)),
    ).toThrow("exact proof contract");
  });

  it("rejects pretty-printed or otherwise non-canonical JSON", () => {
    const pretty = JSON.stringify(
      JSON.parse(fixtureCanonicalJson(seedAdapterFixtureUrl)),
      null,
      2,
    );
    expect(() => build(pretty)).toThrow("exact canonical JSON representation");
  });

  it("rejects a forged exact source identity before seed construction", () => {
    const changed = JSON.parse(
      fixtureCanonicalJson(seedAdapterFixtureUrl),
    ) as unknown;
    if (
      typeof changed !== "object" ||
      changed === null ||
      Array.isArray(changed)
    ) {
      throw new Error("fixture root must be an object");
    }
    const source = Reflect.get(changed, "source");
    if (
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source)
    ) {
      throw new Error("fixture source must be an object");
    }
    Reflect.set(source, "fileSha256", bareDigest(999));
    expect(() =>
      build(stableCanonicalJson(CanonicalJsonValueSchema.parse(changed))),
    ).toThrow(
      GrandHallAuthorityNoneIcpSeedAdapterError,
    );
  });
});
