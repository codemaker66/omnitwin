import { TransformArtifactV0Schema } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
  FOUNDRY_METRIC_REGISTRATION_MAX_ABS_COORDINATE,
  FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES,
  FoundryMetricRegistrationProposalPayloadV0Schema,
  FoundryMetricRegistrationProposalV0Schema,
  compileFoundryMetricRegistrationProposalV0,
  computeFoundryMetricRegistrationProposalSha256,
  verifyFoundryMetricRegistrationProposalV0,
} from "../metric-registration-proposal.js";

const SOURCE_ROOT_DIGEST = `sha256:${"1".repeat(64)}`;
const SOURCE_FRAME_DIGEST = `sha256:${"2".repeat(64)}`;
const TARGET_ROOT_DIGEST = `sha256:${"3".repeat(64)}`;
const TARGET_FRAME_DIGEST = `sha256:${"4".repeat(64)}`;

type MutableFixture = ReturnType<typeof fixture>;

function sourcePoints(): Array<readonly [number, number, number]> {
  return [
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
    [1, 1, 1],
    [2, -1, 0.5],
  ];
}

function targetOf(
  point: readonly [number, number, number],
): [number, number, number] {
  return [10 - 2 * point[1], -3 + 2 * point[0], 5 + 2 * point[2]];
}

function fixture() {
  const points = sourcePoints();
  return {
    schemaVersion: FOUNDRY_METRIC_REGISTRATION_INPUT_V0,
    proposalId: "grand-hall-source-registration-v0",
    source: {
      rootId: "grand-hall-colmap-root",
      rootSha256: SOURCE_ROOT_DIGEST,
      frame: {
        frameId: "colmap-world",
        frameSha256: SOURCE_FRAME_DIGEST,
        units: "unitless" as const,
        handedness: "right" as const,
        upAxis: "z" as const,
        axisConvention: "arbitrary right-handed COLMAP world axes",
      },
    },
    target: {
      rootId: "grand-hall-e57-root",
      rootSha256: TARGET_ROOT_DIGEST,
      frame: {
        frameId: "grand-hall-cvf",
        frameSha256: TARGET_FRAME_DIGEST,
        units: "meters" as const,
        handedness: "right" as const,
        upAxis: "z" as const,
        axisConvention: "right-handed XYZ, Z up",
      },
    },
    correspondences: points.map((source, index) => ({
      correspondenceId: `control-${String(index).padStart(2, "0")}`,
      source: {
        pointId: `colmap-control-${String(index).padStart(2, "0")}`,
        evidenceSha256: `sha256:${"56789a"[index]?.repeat(64) ?? "a".repeat(64)}`,
        coordinates: source,
      },
      target: {
        pointId: `cvf-control-${String(index).padStart(2, "0")}`,
        evidenceSha256: `sha256:${"123456"[index]?.repeat(64) ?? "6".repeat(64)}`,
        coordinates: targetOf(source),
      },
      lineageClassification:
        index === 5 ? ("independent" as const) : ("shared_lineage" as const),
    })),
    partitions: {
      declaration: "fixed_before_solve" as const,
      fitCorrespondenceIds: [
        "control-00",
        "control-01",
        "control-02",
        "control-03",
        "control-04",
      ],
      heldOutCorrespondenceIds: ["control-05"],
    },
  };
}

function expectIntegrityCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

function reseal(proposal: ReturnType<typeof compileFoundryMetricRegistrationProposalV0>) {
  const { proposalSha256: _proposalSha256, ...payload } = proposal;
  const parsedPayload = FoundryMetricRegistrationProposalPayloadV0Schema.parse(payload);
  return FoundryMetricRegistrationProposalV0Schema.parse({
    ...parsedPayload,
    proposalSha256:
      computeFoundryMetricRegistrationProposalSha256(parsedPayload),
  });
}

function evaluationWithIdentityTransform(
  evaluation: ReturnType<
    typeof compileFoundryMetricRegistrationProposalV0
  >["fitEvaluation"],
) {
  const records = evaluation.records.map((record) => {
    const predicted: [number, number, number] = [...record.sourceCoordinates];
    const residualVector: [number, number, number] = [
      predicted[0] - record.targetCoordinatesM[0],
      predicted[1] - record.targetCoordinatesM[1],
      predicted[2] - record.targetCoordinatesM[2],
    ];
    return {
      ...record,
      predictedTargetCoordinatesM: predicted,
      residualVectorM: residualVector,
      residualMeters: Math.hypot(...residualVector),
    };
  });
  const values = records
    .map(({ residualMeters }) => residualMeters)
    .sort((left, right) => left - right);
  const percentile = (fraction: number): number => {
    const position = (values.length - 1) * fraction;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = values[lowerIndex] ?? 0;
    const upper = values[upperIndex] ?? lower;
    return lower + (upper - lower) * (position - lowerIndex);
  };
  return {
    ...evaluation,
    records,
    stats: {
      count: values.length,
      meanMeters:
        values.reduce((total, value) => total + value, 0) / values.length,
      medianMeters: percentile(0.5),
      rmseMeters: Math.sqrt(
        values.reduce((total, value) => total + value * value, 0) /
          values.length,
      ),
      p95Meters: percentile(0.95),
      maxMeters: values.at(-1) ?? 0,
    },
  };
}

describe("metric source-registration proposal", () => {
  it("solves a deterministic proper column-major similarity without granting authority", () => {
    const input = fixture();
    const first = compileFoundryMetricRegistrationProposalV0(input);
    const second = compileFoundryMetricRegistrationProposalV0(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: "local_unverified_registration_proposal",
      source: input.source,
      target: input.target,
      partitions: input.partitions,
      solve: {
        method: "proper_3d_similarity_horn_jacobi",
        matrixLayout: "4x4_column_major",
        uniformScaleTargetMetersPerSourceUnit: 2,
        rotationDeterminant: 1,
      },
      sourceOverlap: {
        status: "not_computed",
        overlapFraction: null,
        evidenceSha256: null,
      },
      reviewedTransformArtifact: "not_created",
      authority: {
        movableContent: "none",
        measurement: "none",
        export: "none",
        runtime: "none",
      },
      releaseEligibility: "blocked",
    });
    expect(first.solve.matrixColumnMajor).toHaveLength(16);
    expect(first.solve.matrixColumnMajor[0]).toBeCloseTo(0, 12);
    expect(first.solve.matrixColumnMajor[1]).toBeCloseTo(2, 12);
    expect(first.solve.matrixColumnMajor[4]).toBeCloseTo(-2, 12);
    expect(first.solve.matrixColumnMajor[5]).toBeCloseTo(0, 12);
    expect(first.solve.matrixColumnMajor[10]).toBeCloseTo(2, 12);
    expect(first.solve.matrixColumnMajor[12]).toBeCloseTo(10, 12);
    expect(first.solve.matrixColumnMajor[13]).toBeCloseTo(-3, 12);
    expect(first.solve.matrixColumnMajor[14]).toBeCloseTo(5, 12);
    expect(first.fitEvaluation.records.map(({ correspondenceId }) => correspondenceId)).toEqual(
      input.partitions.fitCorrespondenceIds,
    );
    expect(first.heldOutEvaluation.records.map(({ correspondenceId }) => correspondenceId)).toEqual(
      input.partitions.heldOutCorrespondenceIds,
    );
    expect(first.fitEvaluation.stats.rmseMeters).toBeLessThan(1e-12);
    expect(first.heldOutEvaluation.stats.rmseMeters).toBeLessThan(1e-12);
    expect(first.fitEvaluation.lineageClassification).toBe("shared_lineage");
    expect(first.heldOutEvaluation.lineageClassification).toBe("independent");
    expect(TransformArtifactV0Schema.safeParse(first).success).toBe(false);
    expect(verifyFoundryMetricRegistrationProposalV0(first, input)).toEqual(first);
  });

  it("keeps the held-out partition out of the solve while evaluating it", () => {
    const originalInput = fixture();
    const changedInput = structuredClone(originalInput);
    const heldOut = changedInput.correspondences[5];
    if (heldOut === undefined) throw new Error("fixture requires a held-out control");
    heldOut.target.coordinates = [100, -100, 50];
    const original = compileFoundryMetricRegistrationProposalV0(originalInput);
    const changed = compileFoundryMetricRegistrationProposalV0(changedInput);

    expect(changed.solve).toEqual(original.solve);
    expect(changed.fitEvaluation).toEqual(original.fitEvaluation);
    expect(changed.heldOutEvaluation.stats.rmseMeters).toBeGreaterThan(100);
    expect(changed.registrationInputSha256).not.toBe(original.registrationInputSha256);
    expect(changed.proposalSha256).not.toBe(original.proposalSha256);
  });

  it("binds exact ordered correspondence identities, frames, roots, and units", () => {
    const input = fixture();
    const proposal = compileFoundryMetricRegistrationProposalV0(input);
    const reordered = structuredClone(input);
    reordered.correspondences.reverse();
    const reorderedProposal = compileFoundryMetricRegistrationProposalV0(reordered);
    expect(reorderedProposal.solve).toEqual(proposal.solve);
    expect(reorderedProposal.correspondenceOrder.map(({ correspondenceId }) => correspondenceId)).toEqual(
      reordered.correspondences.map(({ correspondenceId }) => correspondenceId),
    );
    expect(reorderedProposal.registrationInputSha256).not.toBe(
      proposal.registrationInputSha256,
    );
    expect(() =>
      verifyFoundryMetricRegistrationProposalV0(proposal, reordered),
    ).toThrowError(/does not reproduce from the exact roots/u);

    const substituted = structuredClone(input);
    substituted.correspondences[0]!.source.evidenceSha256 =
      `sha256:${"f".repeat(64)}`;
    expect(() =>
      verifyFoundryMetricRegistrationProposalV0(proposal, substituted),
    ).toThrowError(/does not reproduce from the exact roots/u);

    const changedFrame = structuredClone(input);
    changedFrame.source.frame.frameSha256 = `sha256:${"e".repeat(64)}`;
    expect(() =>
      verifyFoundryMetricRegistrationProposalV0(proposal, changedFrame),
    ).toThrowError(/does not reproduce from the exact roots/u);
  });

  it("rejects duplicate point or correspondence IDs and holdout leakage", () => {
    const duplicateCorrespondence: MutableFixture = structuredClone(fixture());
    duplicateCorrespondence.correspondences[1]!.correspondenceId = "control-00";
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(duplicateCorrespondence),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const duplicatePoint: MutableFixture = structuredClone(fixture());
    duplicatePoint.correspondences[1]!.source.pointId = "colmap-control-00";
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(duplicatePoint),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const leaked: MutableFixture = structuredClone(fixture());
    leaked.partitions.heldOutCorrespondenceIds = ["control-04"];
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(leaked),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const substituted: MutableFixture = structuredClone(fixture());
    substituted.partitions.heldOutCorrespondenceIds = ["unknown-control"];
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(substituted),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );
  });

  it("rejects collinear and coincident fit geometry", () => {
    const collinear = fixture();
    for (let index = 0; index < 5; index += 1) {
      const correspondence = collinear.correspondences[index];
      if (correspondence === undefined) throw new Error("fixture fit control missing");
      correspondence.source.coordinates = [index, 0, 0];
      correspondence.target.coordinates = [2 * index, 0, 0];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(collinear),
      "METRIC_REGISTRATION_DEGENERATE_POINTS",
    );

    const coincident = fixture();
    for (let index = 0; index < 5; index += 1) {
      const correspondence = coincident.correspondences[index];
      if (correspondence === undefined) throw new Error("fixture fit control missing");
      correspondence.source.coordinates = [0, 0, 0];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(coincident),
      "METRIC_REGISTRATION_DEGENERATE_POINTS",
    );
  });

  it("rejects full-rank mirrored target correspondence geometry", () => {
    const mirrored = fixture();
    for (const correspondence of mirrored.correspondences) {
      const [x, y, z] = correspondence.source.coordinates;
      correspondence.target.coordinates = [-x, y, z];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(mirrored),
      "METRIC_REGISTRATION_REFLECTION_FORBIDDEN",
    );
  });

  it("rejects numerically unstable scale and mismatched geometric rank", () => {
    const unstableScale = fixture();
    const tinySource: Array<readonly [number, number, number]> = [
      [0, 0, 0],
      [1e-8, 0, 0],
      [0, 2e-8, 0],
      [0, 0, 3e-8],
      [1e-8, 1e-8, 1e-8],
    ];
    for (let index = 0; index < tinySource.length; index += 1) {
      const correspondence = unstableScale.correspondences[index];
      const source = tinySource[index];
      if (correspondence === undefined || source === undefined) {
        throw new Error("fixture fit control missing");
      }
      correspondence.source.coordinates = source;
      correspondence.target.coordinates = [
        source[0] * 2e9,
        source[1] * 2e9,
        source[2] * 2e9,
      ];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(unstableScale),
      "METRIC_REGISTRATION_SCALE_UNSTABLE",
    );

    const scaledFixture = (scale: number) => {
      const input = fixture();
      const controls = sourcePoints();
      for (let index = 0; index < input.correspondences.length; index += 1) {
        const correspondence = input.correspondences[index];
        const control = controls[index];
        if (correspondence === undefined || control === undefined) {
          throw new Error("fixture control missing");
        }
        correspondence.source.coordinates = [
          control[0] * 1e8,
          control[1] * 1e8,
          control[2] * 1e8,
        ];
        correspondence.target.coordinates = [
          control[0] * 1e8 * scale,
          control[1] * 1e8 * scale,
          control[2] * 1e8 * scale,
        ];
      }
      return input;
    };
    for (const rejectedScale of [1e-10, 1e-9]) {
      expectIntegrityCode(
        () =>
          compileFoundryMetricRegistrationProposalV0(
            scaledFixture(rejectedScale),
          ),
        "METRIC_REGISTRATION_SCALE_UNSTABLE",
      );
    }
    expect(
      compileFoundryMetricRegistrationProposalV0(scaledFixture(1e-8)).solve
        .uniformScaleTargetMetersPerSourceUnit,
    ).toBeCloseTo(1e-8, 16);

    const precisionUnsafe = fixture();
    const localControls = sourcePoints();
    const coordinateBase = 999_999_000;
    for (let index = 0; index < precisionUnsafe.correspondences.length; index += 1) {
      const correspondence = precisionUnsafe.correspondences[index];
      const control = localControls[index];
      if (correspondence === undefined || control === undefined) {
        throw new Error("fixture control missing");
      }
      const translated: [number, number, number] = [
        coordinateBase + control[0] * 1e-6,
        coordinateBase + control[1] * 1e-6,
        coordinateBase + control[2] * 1e-6,
      ];
      correspondence.source.coordinates = translated;
      correspondence.target.coordinates = [...translated];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(precisionUnsafe),
      "METRIC_REGISTRATION_PRECISION_UNSAFE",
    );

    const mismatchedRank = fixture();
    for (let index = 0; index < 5; index += 1) {
      const correspondence = mismatchedRank.correspondences[index];
      if (correspondence === undefined) throw new Error("fixture fit control missing");
      correspondence.target.coordinates = [
        correspondence.source.coordinates[0],
        correspondence.source.coordinates[1],
        0,
      ];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(mismatchedRank),
      "METRIC_REGISTRATION_DIMENSIONALITY_MISMATCH",
    );

    const unstableRotation = fixture();
    const permutedTargetIndices = [1, 3, 4, 2, 0] as const;
    const controls = sourcePoints();
    for (let index = 0; index < permutedTargetIndices.length; index += 1) {
      const correspondence = unstableRotation.correspondences[index];
      const targetIndex = permutedTargetIndices[index];
      const target =
        targetIndex === undefined ? undefined : controls[targetIndex];
      if (correspondence === undefined || target === undefined) {
        throw new Error("fixture fit control missing");
      }
      correspondence.target.coordinates = [target[0], target[1], target[2]];
    }
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(unstableRotation),
      "METRIC_REGISTRATION_ROTATION_UNSTABLE",
    );
  });

  it("rejects non-finite, out-of-range, unknown, and unbounded input", () => {
    const nonFinite: unknown = {
      ...fixture(),
      correspondences: fixture().correspondences.map((correspondence, index) =>
        index === 0
          ? {
              ...correspondence,
              source: { ...correspondence.source, coordinates: [Number.NaN, 0, 0] },
            }
          : correspondence,
      ),
    };
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(nonFinite),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const outOfRange = fixture();
    outOfRange.correspondences[0]!.source.coordinates = [
      FOUNDRY_METRIC_REGISTRATION_MAX_ABS_COORDINATE + 1,
      0,
      0,
    ];
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(outOfRange),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const unknown = { ...fixture(), unexpectedAuthority: "measurement" };
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(unknown),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );

    const bounded = fixture();
    const first = bounded.correspondences[0]!;
    bounded.correspondences = Array.from(
      { length: FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1 },
      (_, index) => ({
        ...structuredClone(first),
        correspondenceId: `bounded-${String(index)}`,
        source: { ...structuredClone(first.source), pointId: `source-${String(index)}` },
        target: { ...structuredClone(first.target), pointId: `target-${String(index)}` },
      }),
    );
    expectIntegrityCode(
      () => compileFoundryMetricRegistrationProposalV0(bounded),
      "METRIC_REGISTRATION_INPUT_INVALID",
    );
  });

  it("detects matrix, metric, and digest tampering including caller resealing", () => {
    const input = fixture();
    const proposal = compileFoundryMetricRegistrationProposalV0(input);
    const matrixTamper = structuredClone(proposal);
    matrixTamper.solve.matrixColumnMajor[12] =
      (matrixTamper.solve.matrixColumnMajor[12] ?? 0) + 1;
    expect(FoundryMetricRegistrationProposalV0Schema.safeParse(matrixTamper).success).toBe(false);

    const metricTamper = structuredClone(proposal);
    metricTamper.heldOutEvaluation.stats.rmseMeters += 1;
    expect(FoundryMetricRegistrationProposalV0Schema.safeParse(metricTamper).success).toBe(false);

    const digestTamper = { ...proposal, proposalSha256: `sha256:${"0".repeat(64)}` };
    expect(FoundryMetricRegistrationProposalV0Schema.safeParse(digestTamper).success).toBe(false);

    expect(() =>
      reseal({
        ...proposal,
        solve: {
          ...proposal.solve,
          matrixColumnMajor: proposal.solve.matrixColumnMajor.map((value, index) =>
            index === 12 ? value + 1 : value,
          ),
        },
      }),
    ).toThrowError(/prediction must use the declared column-major transform/u);

    expect(() =>
      reseal({
        ...proposal,
        heldOutEvaluation: {
          ...proposal.heldOutEvaluation,
          stats: {
            ...proposal.heldOutEvaluation.stats,
            rmseMeters: proposal.heldOutEvaluation.stats.rmseMeters + 1,
          },
        },
      }),
    ).toThrowError(/rmseMeters must be derived from the exact residual records/u);

    expect(() =>
      reseal({
        ...proposal,
        conditioning: {
          ...proposal.conditioning,
          sourceRmsRadius: 999_999,
          targetRmsRadiusM: 0.000_001,
          sourceEigenvalueRatios: [1, 0.5, 0.25],
          targetEigenvalueRatios: [1, 0.6, 0.3],
          crossCovarianceSingularValueRatios: [1, 0.7, 0.4],
          crossCovarianceDeterminant: -123_456,
        },
      }),
    ).toThrowError(/conditioning must be recomputed from the exact frozen fit/u);

    const identityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    expect(() =>
      reseal({
        ...proposal,
        solve: {
          ...proposal.solve,
          uniformScaleTargetMetersPerSourceUnit: 1,
          rotationDeterminant: 1,
          matrixColumnMajor: identityMatrix,
        },
        fitEvaluation: evaluationWithIdentityTransform(
          proposal.fitEvaluation,
        ),
        heldOutEvaluation: {
          ...evaluationWithIdentityTransform({
            ...proposal.heldOutEvaluation,
            partition: "fit",
          }),
          partition: "held_out",
        },
      }),
    ).toThrowError(/deterministic proper similarity optimum/u);

    const extremeInput = fixture();
    const extremeControls = sourcePoints();
    for (let index = 0; index < 5; index += 1) {
      const correspondence = extremeInput.correspondences[index];
      const control = extremeControls[index];
      if (correspondence === undefined || control === undefined) {
        throw new Error("fixture fit control missing");
      }
      correspondence.target.coordinates = [
        control[0] * 2e8,
        control[1] * 2e8,
        control[2] * 2e8,
      ];
    }
    const extremeHeldOut = extremeInput.correspondences[5];
    if (extremeHeldOut === undefined) {
      throw new Error("fixture held-out control missing");
    }
    extremeHeldOut.source.coordinates = [1e9, -1e9, 1e9];
    extremeHeldOut.target.coordinates = [0, 0, 0];
    const extremeProposal =
      compileFoundryMetricRegistrationProposalV0(extremeInput);
    const tolerantFalsification = structuredClone(extremeProposal);
    const falsifiedRecord = tolerantFalsification.heldOutEvaluation.records[0];
    if (falsifiedRecord === undefined) {
      throw new Error("extreme held-out record missing");
    }
    falsifiedRecord.predictedTargetCoordinatesM[0] =
      (falsifiedRecord.predictedTargetCoordinatesM[0] ?? 0) + 1e7;
    falsifiedRecord.residualVectorM[0] =
      (falsifiedRecord.residualVectorM[0] ?? 0) + 1e7;
    falsifiedRecord.residualMeters = Math.hypot(
      ...falsifiedRecord.residualVectorM,
    );
    tolerantFalsification.heldOutEvaluation.stats = {
      count: 1,
      meanMeters: falsifiedRecord.residualMeters,
      medianMeters: falsifiedRecord.residualMeters,
      rmseMeters: falsifiedRecord.residualMeters,
      p95Meters: falsifiedRecord.residualMeters,
      maxMeters: falsifiedRecord.residualMeters,
    };
    expect(() => reseal(tolerantFalsification)).toThrowError(
      /evaluations must exactly reproduce/u,
    );

    const substitutedInput = structuredClone(input);
    substitutedInput.correspondences[5]!.target.coordinates = [100, -100, 50];
    const consistentlyResealedSubstitution =
      compileFoundryMetricRegistrationProposalV0(substitutedInput);
    expectIntegrityCode(
      () =>
        verifyFoundryMetricRegistrationProposalV0(
          consistentlyResealedSubstitution,
          input,
        ),
      "METRIC_REGISTRATION_RECOMPUTATION_MISMATCH",
    );

    const hugeFinite = structuredClone(proposal);
    hugeFinite.solve.uniformScaleTargetMetersPerSourceUnit = 1e200;
    hugeFinite.solve.matrixColumnMajor = [
      1e200, 0, 0, 0,
      0, 1e200, 0, 0,
      0, 0, 1e200, 0,
      0, 0, 0, 1,
    ];
    for (const evaluation of [
      hugeFinite.fitEvaluation,
      hugeFinite.heldOutEvaluation,
    ]) {
      for (const record of evaluation.records) {
        record.predictedTargetCoordinatesM = [1e200, 1e200, 1e200];
        record.residualVectorM = [1e200, 1e200, 1e200];
        record.residualMeters = 1e200;
      }
      evaluation.stats = {
        count: evaluation.records.length,
        meanMeters: 1e200,
        medianMeters: 1e200,
        rmseMeters: 1e200,
        p95Meters: 1e200,
        maxMeters: 1e200,
      };
    }
    expect(() =>
      FoundryMetricRegistrationProposalPayloadV0Schema.safeParse(hugeFinite),
    ).not.toThrow();
    expect(
      FoundryMetricRegistrationProposalPayloadV0Schema.safeParse(hugeFinite)
        .success,
    ).toBe(false);

    const overBound = structuredClone(proposal);
    const firstRecord = overBound.fitEvaluation.records[0];
    if (firstRecord === undefined) throw new Error("fixture fit record missing");
    overBound.fitEvaluation.correspondenceIds = Array.from(
      { length: FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1 },
      () => firstRecord.correspondenceId,
    );
    overBound.fitEvaluation.records = Array.from(
      { length: FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1 },
      () => structuredClone(firstRecord),
    );
    overBound.fitEvaluation.stats.count =
      FOUNDRY_METRIC_REGISTRATION_MAX_CORRESPONDENCES + 1;
    expect(
      FoundryMetricRegistrationProposalPayloadV0Schema.safeParse(overBound)
        .success,
    ).toBe(false);
  });

  it("solves a proper 180-degree rotation that defeats fixed-start power iteration", () => {
    const input = fixture();
    const scale = 1.5;
    for (const correspondence of input.correspondences) {
      const [x, y, z] = correspondence.source.coordinates;
      correspondence.target.coordinates = [
        4 + scale * x,
        6 - scale * y,
        -2 - scale * z,
      ];
    }
    const proposal = compileFoundryMetricRegistrationProposalV0(input);
    expect(proposal.solve.rotationDeterminant).toBeCloseTo(1, 12);
    expect(proposal.solve.uniformScaleTargetMetersPerSourceUnit).toBeCloseTo(scale, 12);
    expect(proposal.solve.matrixColumnMajor[0]).toBeCloseTo(scale, 12);
    expect(proposal.solve.matrixColumnMajor[5]).toBeCloseTo(-scale, 12);
    expect(proposal.solve.matrixColumnMajor[10]).toBeCloseTo(-scale, 12);
    expect(proposal.fitEvaluation.stats.rmseMeters).toBeLessThan(1e-12);
  });
});
