import { describe, expect, it } from "vitest";
import {
  FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0,
  FoundryLocalInspectionHandoffMaterialV0Schema,
  FoundryLocalInspectionHandoffV0Schema,
  compileFoundryLocalInspectionHandoffV0,
  computeFoundryLocalInspectionHandoffSha256V0,
  serializeFoundryLocalInspectionHandoffV0,
  verifyFoundryLocalInspectionHandoffNativeIdentitiesV0,
  verifyFoundryLocalInspectionHandoffV0,
  type FoundryLocalInspectionArtifactBindingV0,
  type FoundryLocalInspectionHandoffV0,
} from "../local-inspection-handoff-v0.js";

const CREATED_AT = "2026-07-18T20:00:00.000Z";

function bareSha(character: string): string {
  return character.repeat(64);
}

function prefixedSha(character: string): string {
  return `sha256:${bareSha(character)}`;
}

function coreArtifacts(
  sourceFactsVersion = 8,
): FoundryLocalInspectionArtifactBindingV0[] {
  return [
    {
      artifactId: "01-intake-receipt",
      role: "intake_receipt",
      schemaVersion: "omnitwin.foundry.universal-intake-receipt.v0",
      nativeDigest: {
        algorithm: "sha256",
        field: "receiptSha256",
        value: bareSha("a"),
      },
    },
    {
      artifactId: "02-source-facts",
      role: "source_facts",
      schemaVersion: `omnitwin.foundry.universal-source-facts.v${String(sourceFactsVersion)}`,
      nativeDigest: {
        algorithm: "sha256",
        field: "factsSha256",
        value: bareSha("b"),
      },
    },
    {
      artifactId: "03-source-readiness",
      role: "source_readiness",
      schemaVersion: `omnitwin.foundry.source-readiness-map.v${String(sourceFactsVersion)}`,
      nativeDigest: {
        algorithm: "sha256",
        field: "readinessSha256",
        value: bareSha("c"),
      },
    },
    {
      artifactId: "04-evidence-checklist",
      role: "operator_evidence_checklist",
      schemaVersion: `omnitwin.foundry.operator-evidence-checklist.v${String(sourceFactsVersion)}`,
      nativeDigest: {
        algorithm: "sha256",
        field: "checklistSha256",
        value: bareSha("d"),
      },
    },
  ];
}

function comparisonArtifact(): FoundryLocalInspectionArtifactBindingV0 {
  return {
    artifactId: "05-comparison-report",
    role: "captured_quality_comparison",
    schemaVersion: "omnitwin.foundry.captured-quality-comparison-report.v0",
    nativeDigest: {
      algorithm: "sha256",
      field: "reportSha256",
      value: bareSha("e"),
    },
  };
}

function compile(
  artifacts: FoundryLocalInspectionArtifactBindingV0[] = coreArtifacts(),
  comparisonSourceReceiptSha256: string | null = null,
): FoundryLocalInspectionHandoffV0 {
  return compileFoundryLocalInspectionHandoffV0({
    dossierId: "reception-room-local-inspection-20260718",
    createdAt: CREATED_AT,
    artifacts,
    comparisonSourceReceiptSha256,
  });
}

describe("local inspection handoff dossier v0", () => {
  it("compiles a deterministic authority-none, execution-blocked core handoff", () => {
    const first = compile();
    const second = compile();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0,
      purpose: "offline_local_inspection_handoff",
      authority: "none",
      execution: "not_authorized",
      onlineApproval: "required",
      comparisonProvenance: {
        status: "not_established",
        reportArtifactId: null,
        sourceReceiptSha256: null,
      },
    });
    expect(first.truthIndex).toEqual([
      {
        topic: "source_identity",
        status: "native_artifact_bound",
        artifactIds: ["01-intake-receipt"],
      },
      {
        topic: "format_and_structure",
        status: "native_artifact_bound",
        artifactIds: ["02-source-facts"],
      },
      {
        topic: "readiness_assessment",
        status: "native_artifact_bound",
        artifactIds: ["03-source-readiness"],
      },
      {
        topic: "operator_evidence_gaps",
        status: "native_artifact_bound",
        artifactIds: ["04-evidence-checklist"],
      },
      {
        topic: "admission_classification",
        status: "not_established",
        artifactIds: [],
      },
      {
        topic: "execution_plan",
        status: "not_established",
        artifactIds: [],
      },
      {
        topic: "comparison_evidence",
        status: "not_established",
        artifactIds: [],
      },
      {
        topic: "physical_accuracy",
        status: "not_established",
        artifactIds: [],
      },
      {
        topic: "rights_and_permissions",
        status: "not_established",
        artifactIds: [],
      },
      {
        topic: "release_authority",
        status: "not_established",
        artifactIds: [],
      },
    ]);
    expect(verifyFoundryLocalInspectionHandoffV0(first)).toEqual(first);
    expect(first.dossierSha256).toBe(
      computeFoundryLocalInspectionHandoffSha256V0({
        schemaVersion: first.schemaVersion,
        dossierId: first.dossierId,
        createdAt: first.createdAt,
        purpose: first.purpose,
        authority: first.authority,
        execution: first.execution,
        onlineApproval: first.onlineApproval,
        artifacts: first.artifacts,
        truthIndex: first.truthIndex,
        comparisonProvenance: first.comparisonProvenance,
        limitations: first.limitations,
      }),
    );
  });

  it("verifies the exact ordered set of independently verified native identities", () => {
    const dossier = compile();
    const identities = dossier.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      schemaVersion: artifact.schemaVersion,
      nativeDigest: artifact.nativeDigest,
    }));

    expect(
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(
        dossier,
        identities,
      ),
    ).toEqual(dossier);

    const changed = structuredClone(identities);
    const first = changed[0];
    if (first === undefined) throw new Error("fixture requires a native identity");
    first.nativeDigest.value = bareSha("f");
    expect(() =>
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(dossier, changed),
    ).toThrow(/native identity/i);

    expect(() =>
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(
        dossier,
        identities.slice(1),
      ),
    ).toThrow(/exactly match/i);
    expect(() =>
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(dossier, []),
    ).toThrow(/exactly match/i);
    expect(() =>
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(
        dossier,
        [...identities].reverse(),
      ),
    ).toThrow(/same order/i);

    const firstIdentity = identities[0];
    if (firstIdentity === undefined) throw new Error("fixture requires an identity");
    expect(() =>
      verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(dossier, [
        { ...firstIdentity, signature: "forbidden" },
        ...identities.slice(1),
      ]),
    ).toThrow(/unrecognized/i);
  });

  it("keeps comparison provenance unestablished until the report binds the receipt digest", () => {
    const artifacts = [...coreArtifacts(), comparisonArtifact()];
    const unbound = compile(artifacts);

    expect(unbound.comparisonProvenance).toEqual({
      status: "not_established",
      reportArtifactId: "05-comparison-report",
      sourceReceiptSha256: null,
    });
    expect(unbound.truthIndex[6]).toEqual({
      topic: "comparison_evidence",
      status: "native_artifact_bound",
      artifactIds: ["05-comparison-report"],
    });

    const bound = compile(artifacts, bareSha("a"));
    expect(bound.comparisonProvenance).toEqual({
      status: "receipt_digest_bound",
      reportArtifactId: "05-comparison-report",
      sourceReceiptSha256: bareSha("a"),
    });

    expect(() => compile(artifacts, bareSha("f"))).toThrow(
      /exact intake receipt digest/i,
    );
    expect(() => compile(coreArtifacts(), bareSha("a"))).toThrow(
      /comparison report/i,
    );
  });

  it("accepts the optional admission and plan chain without granting execution", () => {
    const artifacts: FoundryLocalInspectionArtifactBindingV0[] = [
      ...coreArtifacts(),
      {
        artifactId: "05-admission-review",
        role: "admission_review",
        schemaVersion: "omnitwin.foundry.intake-admission-review.v0",
        nativeDigest: {
          algorithm: "sha256",
          field: "reviewSha256",
          value: prefixedSha("e"),
        },
      },
      {
        artifactId: "06-admission-result",
        role: "admission_result",
        schemaVersion: "omnitwin.foundry.intake-admission-result.v0",
        nativeDigest: {
          algorithm: "sha256",
          field: "resultSha256",
          value: prefixedSha("f"),
        },
      },
      {
        artifactId: "07-plan-preview",
        role: "plan_preview",
        schemaVersion: "omnitwin.foundry.plan-preview.v0",
        nativeDigest: {
          algorithm: "sha256",
          field: "previewSha256",
          value: prefixedSha("1"),
        },
      },
    ];
    const dossier = compile(artifacts);

    expect(dossier.truthIndex[4]).toEqual({
      topic: "admission_classification",
      status: "native_artifact_bound",
      artifactIds: ["05-admission-review", "06-admission-result"],
    });
    expect(dossier.truthIndex[5]).toEqual({
      topic: "execution_plan",
      status: "native_artifact_bound",
      artifactIds: ["07-plan-preview"],
    });
    expect(dossier.execution).toBe("not_authorized");
    expect(dossier.onlineApproval).toBe("required");
  });

  it("rejects unsupported role/schema/digest-field combinations", () => {
    const wrongSchema = coreArtifacts();
    const sourceFacts = wrongSchema[1];
    if (sourceFacts === undefined) throw new Error("fixture requires Source Facts");
    sourceFacts.schemaVersion = "omnitwin.foundry.source-readiness-map.v8";
    expect(() => compile(wrongSchema)).toThrow(/schema version/i);

    const wrongField = coreArtifacts();
    const readiness = wrongField[2];
    if (readiness === undefined) throw new Error("fixture requires readiness");
    readiness.nativeDigest = {
      algorithm: "sha256",
      field: "factsSha256",
      value: bareSha("c"),
    };
    expect(() => compile(wrongField)).toThrow(/digest field/i);

    const wrongEncoding = coreArtifacts();
    const receipt = wrongEncoding[0];
    if (receipt === undefined) throw new Error("fixture requires receipt");
    receipt.nativeDigest.value = prefixedSha("a");
    expect(() => compile(wrongEncoding)).toThrow();
  });

  it("requires one aligned V1-V8 core chain in canonical order", () => {
    expect(() => compile([])).toThrow(/required core role/i);
    const missing = coreArtifacts().slice(0, 3);
    expect(() => compile(missing)).toThrow(/required core role/i);

    const duplicate = coreArtifacts();
    duplicate.push({ ...duplicate[1]!, artifactId: "05-duplicate-facts" });
    expect(() => compile(duplicate)).toThrow(/roles must be unique/i);

    expect(() => compile([...coreArtifacts()].reverse())).toThrow(
      /sorted by artifactId/i,
    );

    const mixedVersions = coreArtifacts();
    const checklist = mixedVersions[3];
    if (checklist === undefined) throw new Error("fixture requires checklist");
    checklist.schemaVersion =
      "omnitwin.foundry.operator-evidence-checklist.v7";
    expect(() => compile(mixedVersions)).toThrow(/same version/i);

    expect(() => compile(coreArtifacts(9))).toThrow(/schema version/i);
  });

  it("requires complete optional admission dependencies", () => {
    const reviewOnly: FoundryLocalInspectionArtifactBindingV0[] = [
      ...coreArtifacts(),
      {
        artifactId: "05-admission-review",
        role: "admission_review",
        schemaVersion: "omnitwin.foundry.intake-admission-review.v0",
        nativeDigest: {
          algorithm: "sha256",
          field: "reviewSha256",
          value: prefixedSha("e"),
        },
      },
    ];
    expect(() => compile(reviewOnly)).toThrow(/review and result.*together/i);

    const planWithoutAdmission: FoundryLocalInspectionArtifactBindingV0[] = [
      ...coreArtifacts(),
      {
        artifactId: "05-plan-preview",
        role: "plan_preview",
        schemaVersion: "omnitwin.foundry.plan-preview.v0",
        nativeDigest: {
          algorithm: "sha256",
          field: "previewSha256",
          value: prefixedSha("e"),
        },
      },
    ];
    expect(() => compile(planWithoutAdmission)).toThrow(
      /requires an admission result/i,
    );
  });

  it("rejects caller-authored truth claims and digest tampering", () => {
    const dossier = compile();
    const truthTampered = structuredClone(dossier);
    truthTampered.truthIndex[7] = {
      topic: "physical_accuracy",
      status: "native_artifact_bound",
      artifactIds: ["02-source-facts"],
    };
    expect(FoundryLocalInspectionHandoffV0Schema.safeParse(truthTampered).success)
      .toBe(false);

    const digestTampered = {
      ...dossier,
      dossierSha256: bareSha("f"),
    };
    expect(() => verifyFoundryLocalInspectionHandoffV0(digestTampered)).toThrow(
      /digest/i,
    );
  });

  it("rejects credentials, approval decisions, signatures, publication fields, paths, and unknown members", () => {
    const dossier = compile();
    for (const extra of [
      { credentials: { token: "secret" } },
      { approval: "approved" },
      { signature: "signed" },
      { publication: "permitted" },
      { absolutePath: "C:\\private\\source.e57" },
    ]) {
      const parsed = FoundryLocalInspectionHandoffV0Schema.safeParse({
        ...dossier,
        ...extra,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.code === "unrecognized_keys"))
          .toBe(true);
      }
    }

    const first = dossier.artifacts[0];
    if (first === undefined) throw new Error("fixture requires an artifact");
    expect(
      FoundryLocalInspectionHandoffMaterialV0Schema.safeParse({
        schemaVersion: dossier.schemaVersion,
        dossierId: dossier.dossierId,
        createdAt: dossier.createdAt,
        purpose: dossier.purpose,
        authority: dossier.authority,
        execution: dossier.execution,
        onlineApproval: dossier.onlineApproval,
        artifacts: [{ ...first, signature: "forbidden" }, ...dossier.artifacts.slice(1)],
        truthIndex: dossier.truthIndex,
        comparisonProvenance: dossier.comparisonProvenance,
        limitations: dossier.limitations,
      }).success,
    ).toBe(false);
  });

  it("serializes only verified canonical dossier bytes", () => {
    const dossier = compile();
    const serialized = serializeFoundryLocalInspectionHandoffV0(dossier);
    expect(JSON.parse(serialized)).toEqual(dossier);
    expect(serialized).toBe(serializeFoundryLocalInspectionHandoffV0(dossier));

    expect(() =>
      serializeFoundryLocalInspectionHandoffV0({
        ...dossier,
        dossierSha256: bareSha("f"),
      }),
    ).toThrow(/digest/i);
  });
});
