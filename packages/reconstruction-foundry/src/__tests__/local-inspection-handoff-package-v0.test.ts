import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FoundryCapturedQualityComparisonReportV0Schema,
  computeFoundryCapturedQualityComparisonReportSha256,
} from "../captured-quality-comparison.js";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  compileGuidedAdmissionDraft,
} from "../guided-admission.js";
import {
  FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0,
  compileFoundryLocalInspectionHandoffPackageV0,
  parseFoundryLocalInspectionHandoffPackageV0,
  serializeFoundryLocalInspectionHandoffPackageV0,
  verifyFoundryLocalInspectionHandoffPackageV0,
} from "../local-inspection-handoff-package-v0.js";
import { compileFoundryOperatorEvidenceChecklistV8 } from "../operator-evidence-checklist-v8.js";
import { compileFoundryPlanPreview } from "../plan-preview.js";
import { compileFoundrySourceReadinessMapV8 } from "../source-readiness-v8.js";
import { inspectUniversalIntakeWithSourceFactsV8 } from "../intake-receipt.js";
import { capturedQualityComparisonFixture } from "./support/captured-quality-comparison-fixture.js";

const cleanup: string[] = [];
const CREATED_AT = "2026-07-18T20:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

async function evidenceFixture(contents: string) {
  const root = await mkdtemp(join(tmpdir(), "foundry-handoff-package-"));
  cleanup.push(root);
  await writeFile(
    join(root, "room.obj"),
    `# ${contents}\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`,
    "utf8",
  );
  const inspected = await inspectUniversalIntakeWithSourceFactsV8(root);
  const sourceReadiness = compileFoundrySourceReadinessMapV8({
    receipt: inspected.receipt,
    sourceFacts: inspected.sourceFacts,
  });
  const operatorEvidenceChecklist =
    compileFoundryOperatorEvidenceChecklistV8({ readiness: sourceReadiness });
  return {
    receipt: inspected.receipt,
    sourceFacts: inspected.sourceFacts,
    sourceReadiness,
    operatorEvidenceChecklist,
    admission: null,
    planPreview: null,
    capturedQualityComparison: null,
  };
}

function withAdmissionAndPlan(
  evidence: Awaited<ReturnType<typeof evidenceFixture>>,
) {
  const file = evidence.receipt.files[0];
  if (file === undefined) throw new Error("Expected the OBJ fixture file");
  const admission = compileGuidedAdmissionDraft(evidence.receipt, {
    schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
    receiptSha256: evidence.receipt.receiptSha256,
    projectId: "reception-room-handoff-test",
    reviewedAt: CREATED_AT,
    reviewedBy: "local-test-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: [{
      action: "admit",
      path: file.path,
      inputType: "obj",
      role: "official_export",
      formatDecision: "accept_detector",
      formatEvidencePaths: [],
      parentPaths: [],
      evidenceKinds: [],
    }],
  });
  const planPreview = compileFoundryPlanPreview({
    id: "local-handoff-plan-preview",
    displayName: "Local handoff plan preview",
    createdAt: CREATED_AT,
    admissionResult: admission.result,
    manifest: admission.result.manifest,
    options: {
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: false,
      buildNeuralRepresentation: false,
    },
    workerBindings: [],
    localRoutes: [{
      providerKind: "local_cpu",
      providerAdapterId: "unmeasured-local-cpu-v0",
      capacity: null,
    }],
    remoteRoutes: [],
  });
  return { ...evidence, admission, planPreview };
}

describe("self-contained local inspection handoff package V0", () => {
  it("carries and native-validates the complete current inspection chain in one file", async () => {
    const evidence = await evidenceFixture("reception-room");
    const packaged = compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "reception-room-local-handoff",
      createdAt: CREATED_AT,
      evidence,
    });
    const serialized = serializeFoundryLocalInspectionHandoffPackageV0(packaged);
    const reparsed = verifyFoundryLocalInspectionHandoffPackageV0(
      JSON.parse(serialized),
    );

    expect(reparsed).toEqual(packaged);
    expect(reparsed.authority).toBe("none");
    expect(reparsed.execution).toBe("not_authorized");
    expect(reparsed.onlineApproval).toBe("required");
    expect(reparsed.evidence.receipt).toEqual(evidence.receipt);
    expect(reparsed.evidence.sourceFacts).toEqual(evidence.sourceFacts);
    expect(reparsed.evidence.sourceReadiness).toEqual(evidence.sourceReadiness);
    expect(reparsed.evidence.operatorEvidenceChecklist).toEqual(
      evidence.operatorEvidenceChecklist,
    );
    expect(reparsed.handoff.artifacts.map((artifact) => artifact.role)).toEqual([
      "intake_receipt",
      "source_facts",
      "source_readiness",
      "operator_evidence_checklist",
    ]);
    expect(serialized).not.toMatch(/[A-Z]:\\/u);
    expect(serialized).not.toContain("sessionToken");
    expect(serialized).not.toMatch(/"credentials?"\s*:/u);
    expect(parseFoundryLocalInspectionHandoffPackageV0(serialized)).toEqual(
      packaged,
    );
  });

  it("rejects an oversized serialized handoff before JSON parsing", () => {
    const oversized = " ".repeat(
      FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0 + 1,
    );
    expect(() =>
      parseFoundryLocalInspectionHandoffPackageV0(oversized)
    ).toThrowError(expect.objectContaining({
      code: "LOCAL_INSPECTION_HANDOFF_PACKAGE_TOO_LARGE",
    }));
  });

  it("rejects valid artifacts from different receipt chains", async () => {
    const first = await evidenceFixture("first-room");
    const second = await evidenceFixture("second-room");
    expect(() =>
      compileFoundryLocalInspectionHandoffPackageV0({
        dossierId: "mixed-session-handoff",
        createdAt: CREATED_AT,
        evidence: {
          ...first,
          sourceFacts: second.sourceFacts,
        },
      })
    ).toThrow();
  });

  it("rejects changed embedded evidence and forbidden capability fields", async () => {
    const evidence = await evidenceFixture("tamper-test");
    const packaged = compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "tamper-test-handoff",
      createdAt: CREATED_AT,
      evidence,
    });
    expect(() =>
      verifyFoundryLocalInspectionHandoffPackageV0({
        ...packaged,
        execute: true,
      })
    ).toThrow();
    expect(() =>
      verifyFoundryLocalInspectionHandoffPackageV0({
        ...packaged,
        evidence: {
          ...packaged.evidence,
          sourceFacts: {
            ...packaged.evidence.sourceFacts,
            factsSha256: "0".repeat(64),
          },
        },
      })
    ).toThrow();
  });

  it("carries a real admission and plan only when every parent digest matches", async () => {
    const evidence = withAdmissionAndPlan(await evidenceFixture("planned-room"));
    const packaged = compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "planned-reception-room-handoff",
      createdAt: CREATED_AT,
      evidence,
    });
    expect(packaged.handoff.artifacts.map((artifact) => artifact.role)).toEqual([
      "intake_receipt",
      "source_facts",
      "source_readiness",
      "operator_evidence_checklist",
      "admission_review",
      "admission_result",
      "plan_preview",
    ]);
    expect(packaged.handoff.truthIndex.find((entry) =>
      entry.topic === "admission_classification"
    )?.status).toBe("native_artifact_bound");
    expect(packaged.handoff.truthIndex.find((entry) =>
      entry.topic === "execution_plan"
    )?.status).toBe("native_artifact_bound");

    const other = withAdmissionAndPlan(await evidenceFixture("other-plan"));
    expect(() => compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "mixed-admission-handoff",
      createdAt: CREATED_AT,
      evidence: { ...evidence, admission: other.admission },
    })).toThrow();
  });

  it("derives comparison provenance from the embedded report itself", async () => {
    const evidence = await evidenceFixture("comparison-room");
    const unboundReport = capturedQualityComparisonFixture();
    const unbound = compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "unbound-comparison-handoff",
      createdAt: CREATED_AT,
      evidence: { ...evidence, capturedQualityComparison: unboundReport },
    });
    expect(unbound.handoff.comparisonProvenance.status).toBe("not_established");

    const { reportSha256: _reportSha256, ...payload } = unboundReport;
    const boundPayload = {
      ...payload,
      sourceReceiptSha256: evidence.receipt.receiptSha256,
    };
    const boundReport = FoundryCapturedQualityComparisonReportV0Schema.parse({
      ...boundPayload,
      reportSha256:
        computeFoundryCapturedQualityComparisonReportSha256(boundPayload),
    });
    const bound = compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "bound-comparison-handoff",
      createdAt: CREATED_AT,
      evidence: { ...evidence, capturedQualityComparison: boundReport },
    });
    expect(bound.handoff.comparisonProvenance).toEqual({
      status: "receipt_digest_bound",
      reportArtifactId: "08-captured-quality-comparison",
      sourceReceiptSha256: evidence.receipt.receiptSha256,
    });

    const wrongPayload = { ...payload, sourceReceiptSha256: "f".repeat(64) };
    const wrongReport = FoundryCapturedQualityComparisonReportV0Schema.parse({
      ...wrongPayload,
      reportSha256:
        computeFoundryCapturedQualityComparisonReportSha256(wrongPayload),
    });
    expect(() => compileFoundryLocalInspectionHandoffPackageV0({
      dossierId: "wrong-comparison-handoff",
      createdAt: CREATED_AT,
      evidence: { ...evidence, capturedQualityComparison: wrongReport },
    })).toThrow();
  });
});
