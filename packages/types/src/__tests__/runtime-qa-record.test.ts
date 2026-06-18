import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_QA_CHECK_KEYS,
  RegisterRuntimeQaRecordInputSchema,
  RuntimeQaRecordRegistrationReportSchema,
  RuntimeQaRecordRegistrationReportInspectionSchema,
  RuntimeQaRecordV0Schema,
  RuntimeQaRecordRegistrationSchema,
  runtimeQaRecordAllowsPublicExposure,
  runtimeQaRecordHasSignedRoomTransform,
  runtimeQaRecordSignedTransformArtifactId,
  type RuntimeQaRecordRegistrationReport,
  type RuntimeQaRecordV0,
} from "../runtime-qa-record.js";

const evidenceRef = {
  label: "Playwright evidence",
  ref: "output/playwright/reception-room-camera-arrival-settled.png",
};

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(
    new URL(
      relativePath,
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomRuntimeQaPayload(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-qa-record-payload-2026-06-16.json",
  );
}

function loadReceptionRoomRuntimeQaDryRunReport(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-qa-dry-run-report-2026-06-16.json",
  );
}

function loadReceptionRoomRuntimeQaInspection(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-qa-inspection-2026-06-16.json",
  );
}

const receptionRoomQaRecord = {
  schemaVersion: "runtime-qa-record.v0",
  recordId: "reception-room-runtime-qa-2026-06-15",
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  runtimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
  recordedAt: "2026-06-15T00:00:00.000Z",
  recordedBy: "runtime-qa-operator",
  assetEvidenceStatus: "unverified",
  runtimeStatus: "internal_ready",
  sourceBundle: {
    sourceLabel: "Reception Room XGRIDS LCC2 source bundle",
    sourceBundleHash: "11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217",
    totalSourceFiles: 48,
    totalSourceBytes: 64323846,
    totalSplats: 3491322,
  },
  sparkLoad: {
    renderer: "@sparkjsdev/spark",
    route: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
    loadStatus: "loaded",
    visualChunkCount: 7,
    excludedChunkCount: 1,
    loadedSplats: 3491322,
    evidenceRefs: [evidenceRef],
  },
  viewTransform: {
    posture: "approximate_view_transform",
    position: [1.11, 2.57, 2.77],
    rotation: [-Math.PI / 2, 0, 0],
    scale: 0.63,
    signedTransformArtifactId: null,
    note: "Approximate XGRIDS SOG view transform; not signed for operational alignment.",
  },
  cameraProfile: {
    position: [0.2, 6.2, 13.4],
    target: [0, 0.9, -4.15],
    arrivalPosition: [0.25, 7.15, 14.1],
    arrivalTarget: [0, 1.2, -4],
    arrivalDurationMs: 1400,
    fov: 48,
    targetBounds: {
      min: [-5.8, 0.7, -9.2],
      max: [5.8, 2.35, 4.8],
    },
    cameraBounds: {
      min: [-6.8, 1.4, -11.8],
      max: [6.8, 7.4, 14.2],
    },
    note: "Bounded interior inspection camera for runtime QA only.",
  },
  checks: [
    {
      checkKey: "runtime_package_resolves",
      status: "passed",
      summary: "Runtime package resolves through the internal route.",
      evidenceRefs: [evidenceRef],
    },
    {
      checkKey: "served_chunk_count",
      status: "passed",
      summary: "Seven room SOG chunks are served; one environment chunk is excluded.",
      evidenceRefs: [{ label: "Intake note", ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md" }],
    },
    {
      checkKey: "spark_payload_loads",
      status: "passed",
      summary: "Spark loads the served SOG payloads for internal runtime QA.",
      evidenceRefs: [evidenceRef],
    },
    {
      checkKey: "camera_framing",
      status: "passed",
      summary: "The start view frames the Reception Room for internal inspection.",
      evidenceRefs: [evidenceRef],
    },
    {
      checkKey: "user_orbit_bounds",
      status: "passed",
      summary: "A small user orbit remains inside the bounded QA camera region.",
      evidenceRefs: [{ label: "After-drag evidence", ref: "output/playwright/reception-room-camera-arrival-after-drag.png" }],
    },
    {
      checkKey: "approximate_view_transform_documented",
      status: "passed",
      summary: "The approximate transform is explicitly documented as not signed.",
      evidenceRefs: [{ label: "Runtime intake note", ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md" }],
    },
    {
      checkKey: "signed_transform_artifact",
      status: "requires_human_review",
      summary: "No signed room-local transform artifact is recorded.",
      evidenceRefs: [],
    },
    {
      checkKey: "metric_scale_alignment",
      status: "not_checked",
      summary: "Metric scale alignment has not been checked against measured room anchors.",
      evidenceRefs: [],
    },
    {
      checkKey: "floor_wall_alignment",
      status: "not_checked",
      summary: "Floor and wall alignment have not been checked against reviewed room geometry.",
      evidenceRefs: [],
    },
    {
      checkKey: "lcc2_lod_graph",
      status: "requires_human_review",
      summary: "The LCC2 bundle graph is not yet the authoritative runtime package loader.",
      evidenceRefs: [],
    },
    {
      checkKey: "public_exposure_review",
      status: "blocked",
      summary: "Public exposure remains blocked until review and signed transform evidence exist.",
      evidenceRefs: [],
    },
  ],
  limitations: [
    "The transform is visual framing only, not operational alignment.",
    "The package remains internal and unverified.",
    "Public room showcase copy must stay in fallback mode.",
  ],
  publicExposure: {
    decision: "blocked_internal_only",
    reason: "Public exposure is blocked until human review and signed transform evidence exist.",
    requiredBeforeApproval: [
      "Signed room-local transform artifact.",
      "Human visual QA review.",
      "Exposure approval record.",
    ],
  },
} satisfies RuntimeQaRecordV0;

function withChecks(
  record: RuntimeQaRecordV0,
  checks: RuntimeQaRecordV0["checks"],
): RuntimeQaRecordV0 {
  return {
    ...record,
    checks,
  };
}

function validRegistrationReport(
  overrides: Partial<RuntimeQaRecordRegistrationReport> = {},
): RuntimeQaRecordRegistrationReport {
  return {
    schemaVersion: "venviewer.runtime-qa-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "registered",
    apiUrl: "http://localhost:3001",
    payloadFile: "docs/operations/reception-room-runtime-qa-record.json",
    payload: {
      venueSlug: receptionRoomQaRecord.venueSlug,
      roomSlug: receptionRoomQaRecord.roomSlug,
      runtimePackageId: receptionRoomQaRecord.runtimePackageId,
      recordId: receptionRoomQaRecord.recordId,
      assetEvidenceStatus: receptionRoomQaRecord.assetEvidenceStatus,
      runtimeStatus: receptionRoomQaRecord.runtimeStatus,
      transformPosture: receptionRoomQaRecord.viewTransform.posture,
      signedTransformArtifactId: null,
      publicExposureDecision: receptionRoomQaRecord.publicExposure.decision,
    },
    preflight: {
      payloadRuntimePackageId: receptionRoomQaRecord.runtimePackageId,
      latestRuntimePackageId: receptionRoomQaRecord.runtimePackageId,
      latestRuntimePackageRuntimeStatus: "internal_ready",
      latestRuntimePackageEvidenceStatus: "unverified",
      runtimePackageMatchesLatest: true,
      runtimePackageDriftAllowed: false,
      signedTransformRequired: false,
      signedTransformRegistered: null,
    },
    registration: {
      runtimeQaRecordRowId: "10000000-0000-4000-8000-000000000008",
      recordId: receptionRoomQaRecord.recordId,
      signedTransformArtifactId: null,
      publicExposureDecision: receptionRoomQaRecord.publicExposure.decision,
      reviewedBy: "10000000-0000-4000-8000-000000000009",
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    },
    guardrails: {
      runtimePackageDriftAllowed: false,
      publicExposureAllowed: false,
      publicExposureChanged: false,
    },
    ...overrides,
  };
}

describe("Runtime QA record", () => {
  it("parses the current Reception Room internal QA record without public exposure", () => {
    const parsed = RuntimeQaRecordV0Schema.parse(receptionRoomQaRecord);

    expect(parsed.roomSlug).toBe("reception-room");
    expect(parsed.sparkLoad.loadedSplats).toBe(3491322);
    expect(runtimeQaRecordHasSignedRoomTransform(parsed)).toBe(false);
    expect(runtimeQaRecordAllowsPublicExposure(parsed)).toBe(false);
  });

  it("pins every required QA check key", () => {
    const parsed = RuntimeQaRecordV0Schema.parse(receptionRoomQaRecord);
    const present = new Set(parsed.checks.map((check) => check.checkKey));

    for (const checkKey of RUNTIME_QA_CHECK_KEYS) {
      expect(present.has(checkKey)).toBe(true);
    }
  });

  it("rejects public exposure while evidence is unverified and transform is approximate", () => {
    const result = RuntimeQaRecordV0Schema.safeParse({
      ...receptionRoomQaRecord,
      publicExposure: {
        decision: "approved_public",
        reason: "Human review has approved public exposure.",
        requiredBeforeApproval: ["No remaining approval blockers."],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects approximate view transforms that claim a signed transform reference", () => {
    const result = RuntimeQaRecordV0Schema.safeParse({
      ...receptionRoomQaRecord,
      viewTransform: {
        ...receptionRoomQaRecord.viewTransform,
        signedTransformArtifactId: "t-reception-room-signed",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects passed checks without evidence references", () => {
    const checks = receptionRoomQaRecord.checks.map((check) =>
      check.checkKey === "camera_framing" ? { ...check, evidenceRefs: [] } : check,
    );
    const result = RuntimeQaRecordV0Schema.safeParse(withChecks(receptionRoomQaRecord, checks));

    expect(result.success).toBe(false);
  });

  it("rejects records missing required check keys", () => {
    const checks = receptionRoomQaRecord.checks.filter((check) =>
      check.checkKey !== "lcc2_lod_graph",
    );
    const result = RuntimeQaRecordV0Schema.safeParse(withChecks(receptionRoomQaRecord, checks));

    expect(result.success).toBe(false);
  });

  it("rejects unsupported public claim wording in operator summaries", () => {
    const result = RuntimeQaRecordV0Schema.safeParse({
      ...receptionRoomQaRecord,
      limitations: ["This is a survey-grade runtime room."],
    });

    expect(result.success).toBe(false);
  });

  it("allows public exposure only after human review and signed transform evidence", () => {
    const checks = receptionRoomQaRecord.checks.map((check) => {
      if (check.checkKey === "signed_transform_artifact") {
        return {
          ...check,
          status: "passed",
          summary: "Signed room-local transform artifact is recorded.",
          evidenceRefs: [{ label: "Transform artifact", ref: "t-reception-room-signed" }],
        } satisfies RuntimeQaRecordV0["checks"][number];
      }
      if (check.checkKey === "public_exposure_review") {
        return {
          ...check,
          status: "passed",
          summary: "Public exposure review is recorded.",
          evidenceRefs: [{ label: "Exposure review", ref: "exposure-review-reception-room" }],
        } satisfies RuntimeQaRecordV0["checks"][number];
      }
      return check;
    });
    const signedRecord = RuntimeQaRecordV0Schema.parse({
      ...receptionRoomQaRecord,
      assetEvidenceStatus: "human_reviewed",
      viewTransform: {
        ...receptionRoomQaRecord.viewTransform,
        posture: "signed_room_local_transform",
        signedTransformArtifactId: "t-reception-room-signed",
        note: "Signed room-local transform for reviewed runtime alignment.",
      },
      checks,
      publicExposure: {
        decision: "approved_public",
        reason: "Human review and signed transform evidence are recorded.",
        requiredBeforeApproval: ["No remaining approval blockers."],
      },
    });

    expect(runtimeQaRecordHasSignedRoomTransform(signedRecord)).toBe(true);
    expect(runtimeQaRecordSignedTransformArtifactId(signedRecord)).toBe("t-reception-room-signed");
    expect(runtimeQaRecordAllowsPublicExposure(signedRecord)).toBe(true);
  });

  it("accepts a registration request only when the embedded QA record targets the same package and room", () => {
    const parsed = RegisterRuntimeQaRecordInputSchema.parse({
      runtimePackageId: receptionRoomQaRecord.runtimePackageId,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record: receptionRoomQaRecord,
    });

    expect(parsed.record.recordId).toBe("reception-room-runtime-qa-2026-06-15");
    expect(RegisterRuntimeQaRecordInputSchema.safeParse({
      runtimePackageId: "10000000-0000-4000-8000-000000000004",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record: receptionRoomQaRecord,
    }).success).toBe(false);
  });

  it("validates the Reception Room internal runtime QA registration payload", () => {
    const parsed = RegisterRuntimeQaRecordInputSchema.parse(
      loadReceptionRoomRuntimeQaPayload(),
    );

    expect(parsed.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(parsed.venueSlug).toBe("trades-hall");
    expect(parsed.roomSlug).toBe("reception-room");
    expect(parsed.record.recordId).toBe("reception-room-runtime-qa-2026-06-15");
    expect(parsed.record.assetEvidenceStatus).toBe("unverified");
    expect(parsed.record.runtimeStatus).toBe("internal_ready");
    expect(parsed.record.viewTransform.posture).toBe("approximate_view_transform");
    expect(parsed.record.viewTransform.signedTransformArtifactId).toBeNull();
    expect(parsed.record.publicExposure.decision).toBe("blocked_internal_only");
    expect(runtimeQaRecordHasSignedRoomTransform(parsed.record)).toBe(false);
    expect(runtimeQaRecordAllowsPublicExposure(parsed.record)).toBe(false);
  });

  it("validates the Reception Room runtime QA dry-run report and inspection artifacts", () => {
    const report = RuntimeQaRecordRegistrationReportSchema.parse(
      loadReceptionRoomRuntimeQaDryRunReport(),
    );
    const inspection = RuntimeQaRecordRegistrationReportInspectionSchema.parse(
      loadReceptionRoomRuntimeQaInspection(),
    );

    expect(report.mode).toBe("dry_run");
    expect(report.payloadFile).toContain(
      "reception-room-runtime-qa-record-payload-2026-06-16.json",
    );
    expect(report.payload.runtimePackageId).toBe(
      "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
    );
    expect(report.preflight.runtimePackageMatchesLatest).toBe(true);
    expect(report.preflight.runtimePackageDriftAllowed).toBe(false);
    expect(report.registration).toBeNull();
    expect(report.guardrails.publicExposureChanged).toBe(false);

    expect(inspection.inspectedReportFile).toContain(
      "reception-room-runtime-qa-dry-run-report-2026-06-16.json",
    );
    expect(inspection.status).toBe("ready_for_live_qa_registration");
    expect(inspection.liveQaRegistrationReady).toBe(true);
    expect(inspection.mode).toBe("dry_run");
    expect(inspection.reportRuntimePackageId).toBe(report.payload.runtimePackageId);
    expect(inspection.reportLatestRuntimePackageId).toBe(
      report.preflight.latestRuntimePackageId,
    );
    expect(inspection.blockers).toEqual([]);
    expect(inspection.reportPublicExposureChanged).toBe(false);
  });

  it("keeps persisted QA row fields coherent with the embedded record", () => {
    const row = {
      id: "10000000-0000-4000-8000-000000000008",
      runtimePackageId: receptionRoomQaRecord.runtimePackageId,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      recordId: receptionRoomQaRecord.recordId,
      record: receptionRoomQaRecord,
      signedTransformArtifactId: null,
      publicExposureDecision: "blocked_internal_only",
      assetEvidenceStatus: "unverified",
      runtimeStatus: "internal_ready",
      reviewedBy: "10000000-0000-4000-8000-000000000009",
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
    };

    expect(RuntimeQaRecordRegistrationSchema.parse(row).recordId).toBe(receptionRoomQaRecord.recordId);
    expect(RuntimeQaRecordRegistrationSchema.safeParse({
      ...row,
      signedTransformArtifactId: "t-reception-room-signed",
    }).success).toBe(false);
    expect(RuntimeQaRecordRegistrationSchema.safeParse({
      ...row,
      publicExposureDecision: "approved_public",
    }).success).toBe(false);
  });

  it("parses machine-readable runtime QA registration reports", () => {
    const parsed = RuntimeQaRecordRegistrationReportSchema.parse(validRegistrationReport());

    expect(parsed.schemaVersion).toBe("venviewer.runtime-qa-registration-report.v0");
    expect(parsed.payload.recordId).toBe(receptionRoomQaRecord.recordId);
    expect(parsed.payload.publicExposureDecision).toBe("blocked_internal_only");
    expect(parsed.preflight.signedTransformRequired).toBe(false);
    expect(parsed.preflight.signedTransformRegistered).toBeNull();
    expect(parsed.guardrails.publicExposureChanged).toBe(false);
  });

  it("keeps dry-run runtime QA reports non-mutating", () => {
    const report = validRegistrationReport({
      mode: "dry_run",
      registration: null,
    });

    expect(RuntimeQaRecordRegistrationReportSchema.parse(report).mode).toBe("dry_run");
    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...report,
      registration: validRegistrationReport().registration,
    }).success).toBe(false);
  });

  it("rejects runtime QA reports with incoherent runtime package or readback identity", () => {
    const validReport = validRegistrationReport();
    const registration = validReport.registration;

    if (registration === null) {
      throw new Error("Expected valid QA report helper to include registration.");
    }

    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...validReport,
      preflight: {
        ...validReport.preflight,
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageMatchesLatest: false,
      },
    }).success).toBe(false);

    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...validReport,
      preflight: {
        ...validReport.preflight,
        payloadRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
      },
    }).success).toBe(false);

    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...validReport,
      registration: {
        ...registration,
        recordId: "different-runtime-qa-record",
      },
    }).success).toBe(false);
  });

  it("rejects runtime QA reports that claim signed-transform or public-exposure state without matching guardrails", () => {
    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...validRegistrationReport(),
      payload: {
        ...validRegistrationReport().payload,
        signedTransformArtifactId: "t-reception-room-signed",
        transformPosture: "signed_room_local_transform",
      },
      preflight: {
        ...validRegistrationReport().preflight,
        signedTransformRequired: true,
        signedTransformRegistered: null,
      },
    }).success).toBe(false);

    expect(RuntimeQaRecordRegistrationReportSchema.safeParse({
      ...validRegistrationReport(),
      payload: {
        ...validRegistrationReport().payload,
        publicExposureDecision: "approved_public",
      },
      registration: {
        ...validRegistrationReport().registration,
        publicExposureDecision: "approved_public",
      },
      guardrails: {
        ...validRegistrationReport().guardrails,
        publicExposureAllowed: false,
        publicExposureChanged: true,
      },
    }).success).toBe(false);

    expect(RuntimeQaRecordRegistrationReportSchema.parse({
      ...validRegistrationReport(),
      payload: {
        ...validRegistrationReport().payload,
        publicExposureDecision: "approved_public",
        transformPosture: "signed_room_local_transform",
        signedTransformArtifactId: "t-reception-room-signed",
      },
      preflight: {
        ...validRegistrationReport().preflight,
        signedTransformRequired: true,
        signedTransformRegistered: true,
      },
      registration: {
        ...validRegistrationReport().registration,
        signedTransformArtifactId: "t-reception-room-signed",
        publicExposureDecision: "approved_public",
      },
      guardrails: {
        ...validRegistrationReport().guardrails,
        publicExposureAllowed: true,
        publicExposureChanged: true,
      },
    }).guardrails.publicExposureAllowed).toBe(true);
  });

  it("parses ready runtime QA report inspections only for current dry-run reports", () => {
    const dryRunReport = validRegistrationReport({
      mode: "dry_run",
      registration: null,
    });
    const inspection = {
      schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
      generatedAt: "2026-06-16T12:05:00.000Z",
      inspectedReportFile: "docs/operations/reception-room-runtime-qa-dry-run-report.json",
      inspectedReportGeneratedAt: dryRunReport.generatedAt,
      status: "ready_for_live_qa_registration",
      liveQaRegistrationReady: true,
      mode: "dry_run",
      venueSlug: dryRunReport.payload.venueSlug,
      roomSlug: dryRunReport.payload.roomSlug,
      recordId: dryRunReport.payload.recordId,
      publicExposureDecision: dryRunReport.payload.publicExposureDecision,
      reportRuntimePackageId: dryRunReport.payload.runtimePackageId,
      reportLatestRuntimePackageId: dryRunReport.preflight.latestRuntimePackageId,
      reportRuntimePackageMatchesLatest: true,
      reportRuntimePackageDriftAllowed: false,
      reportSignedTransformRequired: false,
      reportSignedTransformRegistered: null,
      reportPublicExposureAllowed: false,
      reportPublicExposureChanged: false,
      blockers: [],
      messages: ["Dry-run report is current for live runtime QA registration preflight."],
    };

    expect(RuntimeQaRecordRegistrationReportInspectionSchema.parse(inspection).liveQaRegistrationReady).toBe(true);
    expect(RuntimeQaRecordRegistrationReportInspectionSchema.safeParse({
      ...inspection,
      reportLatestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
      reportRuntimePackageMatchesLatest: false,
    }).success).toBe(false);
    expect(RuntimeQaRecordRegistrationReportInspectionSchema.safeParse({
      ...inspection,
      mode: "registered",
    }).success).toBe(false);
  });

  it("treats registered runtime QA report inspections as audit evidence, not live authorization", () => {
    const registeredReport = validRegistrationReport();
    const inspection = {
      schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
      generatedAt: "2026-06-16T12:05:00.000Z",
      inspectedReportFile: "docs/operations/reception-room-runtime-qa-registration-report.json",
      inspectedReportGeneratedAt: registeredReport.generatedAt,
      status: "registered_qa_report_verified",
      liveQaRegistrationReady: false,
      mode: "registered",
      venueSlug: registeredReport.payload.venueSlug,
      roomSlug: registeredReport.payload.roomSlug,
      recordId: registeredReport.payload.recordId,
      publicExposureDecision: registeredReport.payload.publicExposureDecision,
      reportRuntimePackageId: registeredReport.payload.runtimePackageId,
      reportLatestRuntimePackageId: registeredReport.preflight.latestRuntimePackageId,
      reportRuntimePackageMatchesLatest: true,
      reportRuntimePackageDriftAllowed: false,
      reportSignedTransformRequired: false,
      reportSignedTransformRegistered: null,
      reportPublicExposureAllowed: false,
      reportPublicExposureChanged: false,
      blockers: [
        "Report already records a live runtime QA registration; use it as audit evidence, not authorization for another POST.",
      ],
      messages: ["Report schema is valid."],
    };

    expect(RuntimeQaRecordRegistrationReportInspectionSchema.parse(inspection).status).toBe(
      "registered_qa_report_verified",
    );
    expect(RuntimeQaRecordRegistrationReportInspectionSchema.safeParse({
      ...inspection,
      liveQaRegistrationReady: true,
    }).success).toBe(false);
  });
});
