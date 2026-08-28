import {
  CanonicalJsonValueSchema,
  GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
  GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1,
  GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_UNVALIDATED_WORKER_RECEIPT_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
  GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
  GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE,
  GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
  GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema,
  GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema,
  GrandHallRegistrationSeedV1MaterialSchema,
  GrandHallRegistrationSeedV1Schema,
  computeGrandHallRegistrationSeedIterationSha256,
  computeGrandHallRegistrationSeedMatrixSha256,
  computeGrandHallRegistrationSeedMetricsSha256,
  computeGrandHallRegistrationSeedReplayResultSha256,
  computeGrandHallRegistrationSeedTraceSha256,
  computeGrandHallRegistrationSeedV1Sha256,
  sha256Hex,
  stableCanonicalJson,
  type GrandHallRegistrationSeedV1,
} from "@omnitwin/types";
import { z } from "zod";

export const GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_V1 =
  "venviewer.grand-hall.authority-none-icp-seed-adapter.v1";

const BareSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const AdapterIterationSchema = z
  .object({
    iterationOrdinal: z.number().int().min(1).max(40),
    thresholdMetresFloat64Hex: z.string().regex(/^[0-9a-f]{16}$/u),
    sourceVertexCount: z.literal(24_977),
    targetVertexCount: z.literal(59_049),
    mutualCorrespondenceCount: z.number().int().min(3),
    correspondencePairInventoryRawSha256: BareSha256Schema,
  })
  .strict();

const AdapterCorrespondenceSchema = z
  .object({
    correspondenceCount: z.number().int().min(3),
    correspondencePairInventoryRawSha256: BareSha256Schema,
    distanceInventoryRawSha256: BareSha256Schema,
    metrics: GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema,
  })
  .strict();

const SeedAdapterSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_V1),
    workerSchemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1),
    authority: z.literal("none"),
    architecturalEvidence: z.literal(false),
    humanReviewRequiredBeforeAnyPromotion: z.literal(true),
    algorithmCanonicalJsonSha256: BareSha256Schema,
    source: z
      .object({
        fileSha256: z.literal(
          "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
        ),
        fileSizeBytes: z.literal(2_222_742),
        orderedVertexCount: z.literal(34_040),
        orderedTriangleCount: z.literal(59_763),
        orderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
          "94515cd5c338cae7b774c698cc880b31c85035f45247aab98f2847a5f4bfdb9e",
        ),
        selectedVertexCount: z.literal(24_977),
        selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256: z.literal(
          "dd4472d4ae5a0c3a926e69565733923a464a0779e16f37963889184e0db3035d",
        ),
        selectedOriginalVerticesPackedLittleEndianFloat64RawSha256: z.literal(
          "337109fc3a5b0224df6ef6d90c2e799f31ce9c613d34cb94b666e1382dadefd6",
        ),
      })
      .strict(),
    target: z
      .object({
        fileSha256: z.literal(
          "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
        ),
        fileSizeBytes: z.literal(38_381_816),
        allOrderedVertexCount: z.literal(237_561),
        globalFaceCount: z.literal(474_049),
        allOrderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
          "6131e230ef394052f760be75bc2b8dcf7812dafe405dad3b22f1fd049cf7a72f",
        ),
        selectedFaceCount: z.literal(119_564),
        selectedVertexCount: z.literal(59_049),
        selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256:
          z.literal(
            "91f810dcec2873d9e3d072b3f53b393f82f1ea62c0fc5b1f0095cfbb7db6e917",
          ),
        selectedOrderedVerticesPackedLittleEndianFloat64RawSha256: z.literal(
          "27e7d980d3e535dad43d59af4c17ff3d8152c0138d5c8904eb2e2e319d5acdde",
        ),
      })
      .strict(),
    iterations: z.array(AdapterIterationSchema).length(40),
    lastFitInput: AdapterCorrespondenceSchema.extend({
      iterationOrdinal: z.literal(40),
      correspondenceCount: z.literal(8_294),
    }).strict(),
    candidateArfToCvfRowMajorMatrixFloat64Hex:
      GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema,
    finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256:
      BareSha256Schema,
    postfitAllSourceToTarget: z
      .object({
        sourceVertexCount: z.literal(24_977),
        distanceInventoryRawSha256: BareSha256Schema,
        metrics: GrandHallRegistrationSeedDistanceMetricsFloat64HexSchema,
      })
      .strict(),
    postfitMutualAudit: AdapterCorrespondenceSchema.extend({
      thresholdMetresFloat64Hex: z.literal("3fbeb851eb851eb8"),
      correspondenceCount: z.literal(8_290),
      exactNearestNeighbourTies: z.tuple([
        z
          .object({
            direction: z.literal("source_to_target"),
            tiedQueryVertexCount: z.literal(1),
            tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
              BareSha256Schema,
          })
          .strict(),
        z
          .object({
            direction: z.literal("target_to_source"),
            tiedQueryVertexCount: z.literal(1_002),
            tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
              BareSha256Schema,
          })
          .strict(),
      ]),
    }).strict(),
  })
  .strict();

const WorkerRuntimeSchema = z
  .object({
    pythonVersion: z.literal("3.13.6"),
    numpyVersion: z.literal("2.4.2"),
    scipyVersion: z.literal("1.17.0"),
    trimeshVersion: z.literal("4.11.2"),
    bitExactComparisonRequiresSamePinnedNumericalRuntime: z.literal(true),
  })
  .strict();

const LaunchProcessModelSchema = z.union([
  z.literal("direct-python-child"),
  z.literal("python-launcher-redirected-worker-child"),
]);

const TwoProcessProofSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_V1),
    workerReceiptSchemaVersion: z.literal(GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1),
    authority: z
      .object({
        acceptedTransform: z.literal(false),
        architecturalEvidence: z.literal(false),
        claim: z.literal(
          "two-separate-os-process-diagnostic-repeatability-proof-only",
        ),
        classification: z.literal("none"),
        humanReviewRequiredBeforeAnyPromotion: z.literal(true),
        registrationAcceptance: z.literal(false),
      })
      .strict(),
    canonicalWorkerReceiptByteLength: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_CANONICAL_WORKER_RECEIPT_BYTE_LENGTH,
    ),
    canonicalWorkerReceiptIncluded: z.literal(false),
    canonicalWorkerReceiptSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256.slice(
        "sha256:".length,
      ),
    ),
    seedAdapterV1CanonicalJsonSha256: z.literal(
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256.slice(
        "sha256:".length,
      ),
    ),
    workerRuntime: WorkerRuntimeSchema,
    sameProcessRepeatedReplayValidation: z
      .object({
        requiredForEachChild: z.literal(true),
        sameProcessRunCountPerChild: z.literal(2),
        canonicalUnvalidatedReceiptBytesIdenticalWithinEachChild: z.literal(true),
        canonicalUnvalidatedReceiptSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_UNVALIDATED_WORKER_RECEIPT_SHA256.slice(
            "sha256:".length,
          ),
        ),
        scope: z.literal(
          "exact-full-receipt-including-correspondence-and-matrix-bytes",
        ),
      })
      .strict(),
    determinismBoundary: z
      .object({
        classification: z.literal(
          "reported-worker-versions-and-explicit-child-launch-controls-only",
        ),
        crossHostExactReplayClaimed: z.literal(false),
        crossPlatformExactReplayClaimed: z.literal(false),
        crossRuntimeExactReplayClaimed: z.literal(false),
        twoSeparateOsProcesses: z.literal(true),
        effectiveInterpreterBinaryVerified: z.literal(false),
        reportedWorkerVersionsEqualAcrossChildren: z.literal(true),
        explicitChildLaunchControlsApplied: z.literal(true),
        childPythonFlags: z.tuple([z.literal("-I"), z.literal("-B")]),
        threadEnvironmentControls: z
          .object({
            MKL_NUM_THREADS: z.literal("1"),
            NUMEXPR_NUM_THREADS: z.literal("1"),
            OMP_NUM_THREADS: z.literal("1"),
            OPENBLAS_NUM_THREADS: z.literal("1"),
          })
          .strict(),
        environmentLockDocumentApplied: z.literal(false),
        installedDependencyTreesVerified: z.literal(false),
        loadedNativeClosureVerified: z.literal(false),
        operatingSystemOrCpuIdentityVerified: z.literal(false),
      })
      .strict(),
    guardrails: z
      .object({
        canonicalWorkerReceiptOmittedFromProof: z.literal(true),
        completeWorkerEvidenceBoundByCanonicalReceiptSha256: z.literal(true),
        doesNotInferArchitecture: z.literal(true),
        doesNotClaimRegistrationAcceptance: z.literal(true),
        machineIdentifiersIncludedInProof: z.literal(false),
        processIdentifiersIncludedInProof: z.literal(false),
        implementationLocationsIncludedInProof: z.literal(false),
        reviewedInputBytesValidatedBeforeChildLaunch: z.literal(true),
        sourceLocationsIncludedInProof: z.literal(false),
        sourceLocationsPassedOnlyThroughChildStandardInput: z.literal(true),
        timestampsIncludedInProof: z.literal(false),
        writesProofFiles: z.literal(false),
        writesSourceFiles: z.literal(false),
      })
      .strict(),
    reviewedInputBindings: z
      .object({
        source: z
          .object({
            byteLength: z.literal(2_222_742),
            sha256: z.literal(
              "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
            ),
          })
          .strict(),
        target: z
          .object({
            byteLength: z.literal(38_381_816),
            sha256: z.literal(
              "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
            ),
          })
          .strict(),
        bindingsReverifiedAfterBothChildrenExited: z.literal(true),
      })
      .strict(),
    implementationBindings: z
      .object({
        bindingsReverifiedAfterBothChildrenExited: z.literal(true),
        childEntryImplementationSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_CHILD_ENTRY_IMPLEMENTATION_SHA256.slice(
            "sha256:".length,
          ),
        ),
        twoProcessRunnerImplementationSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_RUNNER_IMPLEMENTATION_SHA256.slice(
            "sha256:".length,
          ),
        ),
        workerImplementationSha256: z.literal(
          GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256.slice(
            "sha256:".length,
          ),
        ),
      })
      .strict(),
    processEvidence: z
      .object({
        canonicalWorkerReceiptBytesIdentical: z.literal(true),
        childProcessCount: z.literal(2),
        launchProcessModels: z.tuple([
          LaunchProcessModelSchema,
          LaunchProcessModelSchema,
        ]),
        distinctChildProcessIdsWithinParentRun: z.literal(true),
        distinctLauncherProcessIdsWithinParentRun: z.literal(true),
        launcherWorkerProcessChainsValidated: z.literal(true),
      })
      .strict(),
  })
  .strict();

export interface BuildGrandHallRegistrationSeedOptions {
  readonly canonicalSeedAdapterJson: string;
  readonly twoProcessProofCanonicalJson: string;
  readonly workerImplementationBytes: Uint8Array;
  readonly processedBigInventorySha256: typeof GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256;
  readonly artifactId: string;
  readonly createdAt: string;
}

export class GrandHallAuthorityNoneIcpSeedAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrandHallAuthorityNoneIcpSeedAdapterError";
  }
}

function prefixedSha256(value: string): `sha256:${string}` {
  return `sha256:${BareSha256Schema.parse(value)}`;
}

function parseCanonicalJson(text: string, label: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const canonical = CanonicalJsonValueSchema.safeParse(decoded);
  if (!canonical.success) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `${label} is not finite canonical-JSON material.`,
    );
  }
  if (stableCanonicalJson(canonical.data) !== text) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `${label} bytes are not the exact canonical JSON representation.`,
    );
  }
  return canonical.data;
}

function parseCanonicalSeedAdapter(text: string) {
  const parsed = SeedAdapterSchema.safeParse(
    parseCanonicalJson(text, "Seed-adapter projection"),
  );
  if (!parsed.success) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `Seed-adapter projection does not satisfy the exact mapping contract: ${parsed.error.message}`,
    );
  }
  const digest = prefixedSha256(sha256Hex(text));
  if (digest !== GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      "Seed-adapter projection does not match the reviewed exact digest.",
    );
  }
  return parsed.data;
}

function parseCanonicalTwoProcessProof(text: string) {
  const parsed = TwoProcessProofSchema.safeParse(
    parseCanonicalJson(text, "Two-process proof"),
  );
  if (!parsed.success) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `Two-process proof does not satisfy the exact proof contract: ${parsed.error.message}`,
    );
  }
  const digest = prefixedSha256(sha256Hex(text));
  if (digest !== GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      "Two-process proof does not match the reviewed exact canonical digest.",
    );
  }
  return parsed.data;
}

function stageForIteration(iterationOrdinal: number) {
  const stage = GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE.find(
    (candidate) =>
      iterationOrdinal >= candidate.firstIteration &&
      iterationOrdinal <= candidate.lastIteration,
  );
  if (stage === undefined) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      `No fixed ICP stage exists for iteration ${String(iterationOrdinal)}.`,
    );
  }
  return stage;
}

export function buildGrandHallRegistrationSeedFromVerifiedTwoProcessProof(
  options: BuildGrandHallRegistrationSeedOptions,
): GrandHallRegistrationSeedV1 {
  z.literal(GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256).parse(
    options.processedBigInventorySha256,
  );
  const proof = parseCanonicalTwoProcessProof(
    options.twoProcessProofCanonicalJson,
  );
  const adapter = parseCanonicalSeedAdapter(options.canonicalSeedAdapterJson);
  const twoProcessProofCanonicalJsonSha256 = prefixedSha256(
    sha256Hex(options.twoProcessProofCanonicalJson),
  );
  const proofCanonicalJsonVerified =
    stableCanonicalJson(proof) === options.twoProcessProofCanonicalJson &&
    twoProcessProofCanonicalJsonSha256 ===
      GRAND_HALL_AUTHORITY_NONE_ICP_TWO_PROCESS_PROOF_CANONICAL_JSON_SHA256;
  const proofReceiptBindingVerified =
    proof.seedAdapterV1CanonicalJsonSha256 ===
      sha256Hex(options.canonicalSeedAdapterJson) &&
    proof.canonicalWorkerReceiptSha256 ===
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256.slice(
        "sha256:".length,
      );
  if (!proofCanonicalJsonVerified || !proofReceiptBindingVerified) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      "Canonical proof bytes do not bind the reviewed worker receipt and seed-adapter projection.",
    );
  }
  const workerReceiptSha256 =
    GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256;
  const implementationSha256 = prefixedSha256(
    sha256Hex(options.workerImplementationBytes),
  );
  const algorithmCanonicalJsonSha256 = prefixedSha256(
    adapter.algorithmCanonicalJsonSha256,
  );
  const seedAdapterCanonicalJsonSha256 = prefixedSha256(
    sha256Hex(stableCanonicalJson(adapter)),
  );
  if (
    implementationSha256 !==
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256 ||
    algorithmCanonicalJsonSha256 !==
      GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256 ||
    seedAdapterCanonicalJsonSha256 !==
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256 ||
    proof.seedAdapterV1CanonicalJsonSha256 !==
      seedAdapterCanonicalJsonSha256.slice("sha256:".length)
  ) {
    throw new GrandHallAuthorityNoneIcpSeedAdapterError(
      "Proof, worker implementation, algorithm, receipt, or mapped adapter digest is not the reviewed exact replay identity.",
    );
  }

  const iterations = adapter.iterations.map((iteration, index) => {
    const stage = stageForIteration(iteration.iterationOrdinal);
    if (
      iteration.iterationOrdinal !== index + 1 ||
      iteration.thresholdMetresFloat64Hex !==
        stage.maximumCorrespondenceDistanceMetresFloat64Hex
    ) {
      throw new GrandHallAuthorityNoneIcpSeedAdapterError(
        "Worker iteration adapter is incomplete, reordered, or differently thresholded.",
      );
    }
    const material = {
      iterationOrdinal: iteration.iterationOrdinal,
      stageOrdinal: stage.stageOrdinal,
      maximumCorrespondenceDistanceMetresFloat64Hex:
        iteration.thresholdMetresFloat64Hex,
      sourceVertexCount: iteration.sourceVertexCount,
      targetVertexCount: iteration.targetVertexCount,
      mutualCorrespondenceCount: iteration.mutualCorrespondenceCount,
      correspondencePairInventoryRawSha256: prefixedSha256(
        iteration.correspondencePairInventoryRawSha256,
      ),
    };
    return {
      ...material,
      iterationSha256:
        computeGrandHallRegistrationSeedIterationSha256(material),
    };
  });
  const traceMaterial = { iterationCount: 40 as const, iterations };
  const iterationTrace = {
    ...traceMaterial,
    traceSha256: computeGrandHallRegistrationSeedTraceSha256(traceMaterial),
  };
  const candidateMatrix =
    GrandHallRegistrationSeedCandidateMatrixFloat64HexSchema.parse(
      adapter.candidateArfToCvfRowMajorMatrixFloat64Hex,
    );
  const lastFitMetrics = adapter.lastFitInput.metrics;
  const postfitMetrics = adapter.postfitMutualAudit.metrics;
  const allSourceMetrics = adapter.postfitAllSourceToTarget.metrics;
  const replayBindings = {
    workerSchemaVersion: GRAND_HALL_AUTHORITY_NONE_ICP_REPLAY_V1,
    implementationSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_IMPLEMENTATION_SHA256,
    environmentLockSha256: GRAND_HALL_AUTHORITY_NONE_ICP_ENVIRONMENT_LOCK_SHA256,
    environmentLockAppliedToExecution: false,
    loadedRuntimeClosureVerifiedAgainstLock: false,
    algorithmCanonicalJsonSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_ALGORITHM_CANONICAL_JSON_SHA256,
    seedAdapterCanonicalJsonSha256:
      GRAND_HALL_AUTHORITY_NONE_ICP_SEED_ADAPTER_CANONICAL_JSON_SHA256,
    determinismScope: "same_runtime_same_host_only" as const,
  } as const;
  const sourceOrdinals = prefixedSha256(
    adapter.source.selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256,
  );
  const sourceCoordinates = prefixedSha256(
    adapter.source.selectedOriginalVerticesPackedLittleEndianFloat64RawSha256,
  );
  const targetOrdinals = prefixedSha256(
    adapter.target
      .selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256,
  );
  const targetCoordinates = prefixedSha256(
    adapter.target.selectedOrderedVerticesPackedLittleEndianFloat64RawSha256,
  );
  const ties = adapter.postfitMutualAudit.exactNearestNeighbourTies;
  const finalResult = {
    lastFitInput: {
      iterationOrdinal: 40 as const,
      correspondenceCount: adapter.lastFitInput.correspondenceCount,
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256: prefixedSha256(
        adapter.lastFitInput.correspondencePairInventoryRawSha256,
      ),
      distancesPackedLittleEndianFloat64RawSha256: prefixedSha256(
        adapter.lastFitInput.distanceInventoryRawSha256,
      ),
      metrics: lastFitMetrics,
    },
    candidateArfToCvfRowMajorMatrixFloat64Hex: candidateMatrix,
    finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256:
      prefixedSha256(
        adapter.finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256,
      ),
    postfitAllSourceToTargetAudit: {
      sourceVertexCount: adapter.postfitAllSourceToTarget.sourceVertexCount,
      distancesPackedLittleEndianFloat64RawSha256: prefixedSha256(
        adapter.postfitAllSourceToTarget.distanceInventoryRawSha256,
      ),
      metrics: allSourceMetrics,
    },
    postfitAudit: {
      maximumCorrespondenceDistanceMetresFloat64Hex:
        adapter.postfitMutualAudit.thresholdMetresFloat64Hex,
      correspondenceCount: adapter.postfitMutualAudit.correspondenceCount,
      orderedSourceTargetPairsPackedLittleEndianInt64RawSha256: prefixedSha256(
        adapter.postfitMutualAudit.correspondencePairInventoryRawSha256,
      ),
      distancesPackedLittleEndianFloat64RawSha256: prefixedSha256(
        adapter.postfitMutualAudit.distanceInventoryRawSha256,
      ),
      metrics: postfitMetrics,
      exactNearestNeighbourTies: [
        {
          direction: ties[0].direction,
          tiedQueryVertexCount: ties[0].tiedQueryVertexCount,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            prefixedSha256(
              ties[0].tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
            ),
        },
        {
          direction: ties[1].direction,
          tiedQueryVertexCount: ties[1].tiedQueryVertexCount,
          tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256:
            prefixedSha256(
              ties[1].tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
            ),
        },
      ] as const,
    },
    termination: "fixed_40_iterations" as const,
    convergenceClaimed: false as const,
  };
  const replayResultMaterial = {
    workerSchemaVersion: replayBindings.workerSchemaVersion,
    implementationSha256: replayBindings.implementationSha256,
    environmentLockSha256: replayBindings.environmentLockSha256,
    environmentLockAppliedToExecution:
      replayBindings.environmentLockAppliedToExecution,
    loadedRuntimeClosureVerifiedAgainstLock:
      replayBindings.loadedRuntimeClosureVerifiedAgainstLock,
    algorithmCanonicalJsonSha256: replayBindings.algorithmCanonicalJsonSha256,
    seedAdapterCanonicalJsonSha256:
      replayBindings.seedAdapterCanonicalJsonSha256,
    sourceSelectedOrdinalInventoryRawSha256: sourceOrdinals,
    sourceSelectedCoordinateInventoryRawSha256: sourceCoordinates,
    targetSelectedOrdinalInventoryRawSha256: targetOrdinals,
    targetSelectedCoordinateInventoryRawSha256: targetCoordinates,
    iterationTraceSha256: iterationTrace.traceSha256,
    lastFitInputCorrespondenceInventoryRawSha256:
      finalResult.lastFitInput
        .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256,
    lastFitInputDistanceInventoryRawSha256:
      finalResult.lastFitInput.distancesPackedLittleEndianFloat64RawSha256,
    lastFitInputCorrespondenceCount:
      finalResult.lastFitInput.correspondenceCount,
    lastFitInputMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(lastFitMetrics),
    finalMatrixSha256:
      computeGrandHallRegistrationSeedMatrixSha256(candidateMatrix),
    finalTransformedSelectedSourceRawSha256:
      finalResult.finalTransformedSelectedSourcePackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetDistanceInventoryRawSha256:
      finalResult.postfitAllSourceToTargetAudit
        .distancesPackedLittleEndianFloat64RawSha256,
    postfitAllSourceToTargetMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(allSourceMetrics),
    postfitCorrespondenceInventoryRawSha256:
      finalResult.postfitAudit
        .orderedSourceTargetPairsPackedLittleEndianInt64RawSha256,
    postfitCorrespondenceDistanceInventoryRawSha256:
      finalResult.postfitAudit.distancesPackedLittleEndianFloat64RawSha256,
    postfitCorrespondenceCount: finalResult.postfitAudit.correspondenceCount,
    postfitMetricsSha256:
      computeGrandHallRegistrationSeedMetricsSha256(postfitMetrics),
    sourceToTargetTieCount: ties[0].tiedQueryVertexCount,
    sourceToTargetTieOrdinalInventoryRawSha256:
      finalResult.postfitAudit.exactNearestNeighbourTies[0]
        .tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
    targetToSourceTieCount: ties[1].tiedQueryVertexCount,
    targetToSourceTieOrdinalInventoryRawSha256:
      finalResult.postfitAudit.exactNearestNeighbourTies[1]
        .tiedQueryVertexOrdinalsPackedLittleEndianInt64RawSha256,
    workerCanonicalReceiptSha256:
      workerReceiptSha256 as typeof GRAND_HALL_AUTHORITY_NONE_ICP_WORKER_CANONICAL_RECEIPT_SHA256,
  };
  const replayResultSha256 =
    computeGrandHallRegistrationSeedReplayResultSha256(replayResultMaterial);
  const run = (replayOrdinal: 1 | 2) => ({
    replayOrdinal,
    ...replayResultMaterial,
    replayResultSha256,
  });

  const material = GrandHallRegistrationSeedV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ARF_CVF_REGISTRATION_SEED_V1,
    artifactId: options.artifactId,
    createdAt: options.createdAt,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    classification: "historical_replay_candidate",
    source: {
      frame: "ARF",
      coordinateConvention: "xgrids_big_obj_native_source_z_up",
      exactBigObj: {
        sha256: prefixedSha256(adapter.source.fileSha256),
        byteLength: adapter.source.fileSizeBytes,
        vertexRecordCount: adapter.source.orderedVertexCount,
        faceRecordCount: adapter.source.orderedTriangleCount,
        orderedVerticesPackedLittleEndianFloat64RawSha256: prefixedSha256(
          adapter.source.orderedVerticesPackedLittleEndianFloat64RawSha256,
        ),
        boundsMetres: {
          min: [-31.858929, -23.662237, -6.327585],
          max: [3.825, 4.925, 8.617472],
        },
      },
      upstreamLineage: {
        rawXgridsReceiptSha256:
          "sha256:dc2259089043ae4a1d95663f251d4bd94699124cd49baa3b8958a0d668389b8a",
        rawXgridsInventorySha256:
          "sha256:6e6fe18c4944cb5a0e68a69c3bc9dbb808835be6293465f50652d47e8df68236",
        rawXgridsXbinSha256:
          "sha256:42aac50bea3e4fb526536101d140af379c0c0cb87094e3a25379e6cf617bbfe0",
        processedBigModelGuid: "2d483e031ad40e259c75f765d6f5fcbb",
        processedBigInventorySha256: options.processedBigInventorySha256,
        historicalSogCoreInventorySha256:
          "sha256:4585ff38e79858c35c4c1774a29a759ff85881bf5ee3d46bd7f96cae40e69c5a",
        historicalSogManifestSha256:
          "sha256:927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
        historicalFrontierReceiptSha256:
          "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
      },
      selection: {
        rule: "all_big_obj_vertices_whose_fixed_initial_placement_is_within_expanded_room9_vertex_aabb",
        initialPlacement: {
          operationOrder: "positive_90_degrees_about_z_then_translate",
          translationMetres: [0, 0, 2.3],
          rowMajorMatrixFloat64Hex: [
            "0000000000000000",
            "bff0000000000000",
            "0000000000000000",
            "0000000000000000",
            "3ff0000000000000",
            "0000000000000000",
            "0000000000000000",
            "0000000000000000",
            "0000000000000000",
            "0000000000000000",
            "3ff0000000000000",
            "4002666666666666",
            "0000000000000000",
            "0000000000000000",
            "0000000000000000",
            "3ff0000000000000",
          ],
        },
        targetEnvelopeBasis: "exact_room9_unique_face_referenced_vertex_aabb",
        aabbExpansionMetresFloat64Hex: "3fe8000000000000",
        boundaryComparison: "inclusive_on_all_three_axes",
        ordering:
          "trimesh_loaded_vertex_ordinal_ascending_with_process_false_and_maintain_order_true",
        expectedSelectedVertexCount: adapter.source.selectedVertexCount,
        selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256:
          sourceOrdinals,
        selectedOriginalVerticesPackedLittleEndianFloat64RawSha256:
          sourceCoordinates,
        selectedVertexInventoryCount: adapter.source.selectedVertexCount,
      },
    },
    target: {
      frame: "CVF",
      coordinateConvention: "matterpak_local_metres_right_handed_z_up",
      exactMatterPakObj: {
        sha256: prefixedSha256(adapter.target.fileSha256),
        byteLength: adapter.target.fileSizeBytes,
        vertexRecordCount: adapter.target.allOrderedVertexCount,
        faceRecordCount: adapter.target.globalFaceCount,
        orderedVerticesPackedLittleEndianFloat64RawSha256: prefixedSha256(
          adapter.target.allOrderedVerticesPackedLittleEndianFloat64RawSha256,
        ),
        boundsMetres: {
          min: [-6.166, -12.362, -4.151],
          max: [21.365002, 13.696001, 9.05],
        },
      },
      exactRoom9: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
        groupCount: 43,
        faceCount: adapter.target.selectedFaceCount,
        uniqueGlobalFaceReferencedVertexCount:
          adapter.target.selectedVertexCount,
        connectedComponentCount: 90,
        verticesSharedWithOtherRoomGroups: 174,
        vertexAabbMetres: {
          min: [-2.425, -11.334001, -1.02],
          max: [19.695002, 1.553, 9.05],
        },
        faceOrdinalInventorySha256:
          "sha256:bdad33cd4525d7b2edba37a8b7ee730ea0ba184b32e24e43123a0ad2bc4e4d75",
      },
      upstreamLineage: {
        matterPakE57ReceiptSha256:
          "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
        room9BoundaryEvidenceSha256:
          "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4",
        room9BoundaryManifestSha256:
          "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3",
        interfaceAtlasSha256:
          "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc",
        scopeReviewPackSha256:
          "sha256:0906aeba265aea9879a65c5e7d698ddaaa5e54912d7024868c1a1abaaf618530",
      },
      selection: {
        rule: "unique_global_vertices_referenced_by_all_exact_room9_faces",
        faceSelectionPredicate:
          "active_obj_group_string_ends_with__group001_sub009",
        deduplicationKey: "matterpak_obj_global_vertex_ordinal",
        ordering: "matterpak_obj_global_vertex_ordinal_ascending",
        selectedOrderedGlobalVertexIndicesPackedLittleEndianUint64RawSha256:
          targetOrdinals,
        selectedOrderedVerticesPackedLittleEndianFloat64RawSha256:
          targetCoordinates,
        selectedVertexInventoryCount: adapter.target.selectedVertexCount,
      },
    },
    replayBindings,
    schedule: {
      method: "mutual_nearest_neighbor_point_to_point_icp",
      iterationCount: 40,
      stages: GRAND_HALL_REGISTRATION_SEED_FIXED_SCHEDULE.map((stage) => ({
        ...stage,
      })),
    },
    iterationTrace,
    finalResult,
    repeatability: {
      method: "two_separate_os_process_replays_with_identical_bound_inputs",
      replayCount: 2,
      twoProcessProofSchemaVersion: proof.schemaVersion,
      twoProcessProofCanonicalJsonSha256,
      twoProcessProofCanonicalJsonVerified: proofCanonicalJsonVerified,
      twoProcessProofReceiptBindingVerified: proofReceiptBindingVerified,
      childEntryImplementationSha256: prefixedSha256(
        proof.implementationBindings.childEntryImplementationSha256,
      ),
      twoProcessRunnerImplementationSha256: prefixedSha256(
        proof.implementationBindings.twoProcessRunnerImplementationSha256,
      ),
      canonicalWorkerReceiptByteLength:
        proof.canonicalWorkerReceiptByteLength,
      canonicalWorkerReceiptIncludedInProof:
        proof.canonicalWorkerReceiptIncluded,
      runs: [run(1), run(2)],
      determinismScope: "same_runtime_same_host_only",
      bitExactCanonicalWorkerReceipt:
        proof.processEvidence.canonicalWorkerReceiptBytesIdentical,
      bitExactMappedIterationTrace: proofReceiptBindingVerified,
      completeWorkerIterationEvidenceBoundByCanonicalReceipt:
        proof.guardrails.completeWorkerEvidenceBoundByCanonicalReceiptSha256,
      bitExactFinalCorrespondences: proofReceiptBindingVerified,
      bitExactFinalMatrix: proofReceiptBindingVerified,
      bitExactFinalMetrics: proofReceiptBindingVerified,
    },
    guardrails: {
      authority: "none",
      architecturalEvidence: false,
      humanReviewRequiredBeforeAnyPromotion: true,
      productionTrust: null,
      roomMembershipAuthority: "none",
      sourceSelectionIsGrandHallMask: false,
      cleanupDecisionAccepted: false,
      matrixPermittedUse: "historical_candidate_nomination_aid_only",
      matrixUsedAsMeasurement: false,
      matrixUsedAsSolverInput: false,
      coordinatePairs: null,
      acceptedTransform: null,
      outputMask: null,
      runtimeAdmission: null,
      deploymentAuthorization: null,
      publicationAuthorization: null,
      permitsCoordinateAcceptance: false,
      permitsTransformAcceptance: false,
      permitsOutputMasking: false,
      permitsRuntimeUse: false,
      permitsDeployment: false,
      permitsPublication: false,
    },
  });
  return GrandHallRegistrationSeedV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallRegistrationSeedV1Sha256(material),
  });
}
