import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_TRANSFORM_READINESS_V0_SCHEMA_VERSION,
  RuntimeTransformReadinessV0Schema,
  type RuntimeTransformReadinessV0,
} from "../runtime-transform-readiness.js";

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomTransformReadiness(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-transform-readiness-2026-06-16.json",
  );
}

function parsedReadiness(): RuntimeTransformReadinessV0 {
  return RuntimeTransformReadinessV0Schema.parse(loadReceptionRoomTransformReadiness());
}

function readyCandidateFixture(): RuntimeTransformReadinessV0 {
  const readiness = parsedReadiness();
  const candidateEvidence = {
    kind: "transform_artifact_payload",
    label: "Synthetic TransformArtifactV0 payload",
    ref: "docs/operations/reception-room-transform-candidate-test.json",
  } satisfies RuntimeTransformReadinessV0["evidenceRefs"][number];

  return RuntimeTransformReadinessV0Schema.parse({
    ...readiness,
    assetEvidenceStatus: "human_reviewed",
    readinessDisposition: "ready_for_signed_transform_payload",
    captureControlPosture: {
      ...readiness.captureControlPosture,
      sourceId: "reception-room-manual-landmarks-v0",
      sourceClass: "manual_landmarks",
      poseAuthorityLevel: "manual_landmark_control",
      alignmentMethods: ["landmark_solve"],
      qaStatus: "human_reviewed",
    },
    candidateTransformArtifact: {
      transformArtifactId: "t-reception-room-landmark-solve-v0",
      sourceFrame: "ARF",
      targetFrame: "CVF",
      alignmentMethod: "landmark_solve",
      provenanceRefTypes: ["landmark_set", "artifact"],
      residualRmseM: 0.018,
      landmarkCount: 4,
      evidenceRefs: [candidateEvidence],
    },
    requiredTransformChain: readiness.requiredTransformChain.map((requirement) => ({
      ...requirement,
      status: "reviewed",
      evidenceRefs: [candidateEvidence],
    })),
    blockers: [],
    requiredBeforeSignedRegistration: [],
  });
}

describe("Runtime transform readiness", () => {
  it("validates the Reception Room transform-readiness artifact as blocked visual-only evidence", () => {
    const readiness = parsedReadiness();

    expect(readiness.schemaVersion).toBe(RUNTIME_TRANSFORM_READINESS_V0_SCHEMA_VERSION);
    expect(readiness.readinessId).toBe("reception-room-runtime-transform-readiness-2026-06-16");
    expect(readiness.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(readiness.assetEvidenceStatus).toBe("unverified");
    expect(readiness.runtimeStatus).toBe("internal_ready");
    expect(readiness.readinessDisposition).toBe("blocked_visual_alignment_only");
    expect(readiness.captureControlPosture.poseAuthorityLevel).toBe("visual_alignment_only");
    expect(readiness.captureControlPosture.alignmentMethods).toEqual(["visual_alignment"]);
    expect(readiness.captureControlPosture.qaStatus).toBe("requires_human_review");
    expect(readiness.candidateTransformArtifact).toBeNull();
    expect(readiness.evidenceRefs).toContainEqual({
      kind: "control_coordinate_pair_intake_request",
      label: "Coordinate-pair intake request",
      ref: "docs/operations/reception-room-coordinate-pair-intake-request-2026-06-16.json",
    });
    expect(readiness.evidenceRefs).toContainEqual({
      kind: "control_coordinate_pair_intake_inspection",
      label: "Coordinate-pair intake inspection",
      ref: "docs/operations/reception-room-coordinate-pair-intake-inspection-2026-06-16.json",
    });
    expect(readiness.evidenceRefs).toContainEqual({
      kind: "control_coordinate_pair_packet_build_report",
      label: "Coordinate-pair packet build report",
      ref: "docs/operations/reception-room-coordinate-pair-packet-build-report-2026-06-16.json",
    });
    expect(readiness.evidenceRefs).toContainEqual({
      kind: "capture_control_payload_build_report",
      label: "Manual-landmarks payload build report",
      ref: "docs/operations/reception-room-manual-landmarks-capture-control-build-report-2026-06-16.json",
    });
    expect(readiness.evidenceRefs).toContainEqual({
      kind: "runtime_control_evidence_chain_status",
      label: "Runtime-control evidence chain status",
      ref: "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
    });
    expect(readiness.guardrails).toEqual({
      transformPayloadCreated: false,
      signedTransformCreated: false,
      captureControlSourceChanged: false,
      runtimeQaRecordChanged: false,
      assetEvidencePromoted: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    });
  });

  it("accepts a ready synthetic posture only after reviewed control evidence and a candidate summary exist", () => {
    const readiness = readyCandidateFixture();

    expect(readiness.readinessDisposition).toBe("ready_for_signed_transform_payload");
    expect(readiness.captureControlPosture.poseAuthorityLevel).toBe("manual_landmark_control");
    expect(readiness.candidateTransformArtifact?.alignmentMethod).toBe("landmark_solve");
    expect(readiness.requiredTransformChain.every((requirement) =>
      requirement.status === "reviewed",
    )).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("rejects visual-alignment-only sources that claim signed-transform readiness", () => {
    const readiness = parsedReadiness();

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...readiness,
      readinessDisposition: "ready_for_signed_transform_payload",
      candidateTransformArtifact: {
        transformArtifactId: "t-reception-room-landmark-solve-v0",
        sourceFrame: "ARF",
        targetFrame: "CVF",
        alignmentMethod: "landmark_solve",
        provenanceRefTypes: ["landmark_set", "artifact"],
        residualRmseM: 0.018,
        landmarkCount: 4,
        evidenceRefs: readiness.evidenceRefs.slice(0, 1),
      },
      blockers: [],
      requiredBeforeSignedRegistration: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects ready dispositions without a candidate TransformArtifactV0 summary", () => {
    const readiness = parsedReadiness();

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...readyCandidateFixture(),
      readinessDisposition: "signed_transform_payload_preflighted",
      candidateTransformArtifact: null,
      requiredTransformChain: readiness.requiredTransformChain.map((requirement) => ({
        ...requirement,
        status: "reviewed",
        evidenceRefs: readiness.evidenceRefs.slice(0, 1),
      })),
      blockers: [],
      requiredBeforeSignedRegistration: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects landmark-solve candidates without residuals or landmark count", () => {
    const ready = readyCandidateFixture();

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...ready,
      candidateTransformArtifact: {
        ...ready.candidateTransformArtifact,
        residualRmseM: null,
        landmarkCount: 0,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects transform chain requirements that map a frame into itself", () => {
    const readiness = parsedReadiness();
    const firstRequirement = readiness.requiredTransformChain[0];

    if (firstRequirement === undefined) {
      throw new Error("Expected readiness artifact to include transform-chain requirements.");
    }

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...readiness,
      requiredTransformChain: [
        {
          ...firstRequirement,
          targetFrame: firstRequirement.sourceFrame,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects blocked readiness artifacts without blockers", () => {
    const readiness = parsedReadiness();

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...readiness,
      blockers: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects readiness artifacts that claim signed-transform side effects", () => {
    const readiness = parsedReadiness();

    const result = RuntimeTransformReadinessV0Schema.safeParse({
      ...readiness,
      guardrails: {
        ...readiness.guardrails,
        signedTransformCreated: true,
      },
    });

    expect(result.success).toBe(false);
  });
});
