import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  RegisterRuntimeQaRecordInput,
  RuntimePackage,
  RuntimeQaRecordRegistration,
  RuntimeQaRecordRegistrationReportInspection,
  RuntimeQaRecordRegistrationReport,
  RuntimeQaRecordV0,
  RuntimeTransformArtifact,
} from "@omnitwin/types";
import {
  formatRuntimeQaRecordRegistrationReportInspection,
  latestRuntimePackageEndpoint,
  inspectRuntimeQaRecordRegistrationReport,
  loadRuntimeQaRecordPayload,
  preflightRuntimeQaRecordRegistration,
  readRegisteredRuntimeTransformArtifacts,
  registerAndVerifyRuntimeQaRecord,
  registerRuntimeQaRecord,
  runRegisterRuntimeQaRecord,
  runtimeQaRecordEndpoint,
  runtimeQaRecordsEndpoint,
  runtimeTransformArtifactsEndpoint,
  type RuntimeQaFetch,
} from "../scripts/register-runtime-qa-record.js";

const RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";
const DRIFTED_RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000011";
const TRANSFORM_ARTIFACT_ID = "reception-room-landmark-solve-v0";
const SHA = "11f567ac16d46ac20e4565de704ac088c93b22febd02d91b4b275f297a576217";

const qaEvidenceRef = {
  label: "Playwright evidence",
  ref: "output/playwright/reception-room-camera-arrival-settled.png",
};

const transformEvidenceRef = {
  refType: "landmark_set",
  ref: "docs/operations/reception-room-landmarks-v0.json",
  role: "source_landmarks",
} as const;

function baseRuntimeQaRecord(): RuntimeQaRecordV0 {
  return {
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-runtime-qa-2026-06-16",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: RUNTIME_PACKAGE_ID,
    recordedAt: "2026-06-16T00:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
    sourceBundle: {
      sourceLabel: "Reception Room XGRIDS LCC2 source bundle",
      sourceBundleHash: SHA,
      totalSourceFiles: 48,
      totalSourceBytes: 64_323_846,
      totalSplats: 3_491_322,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
      loadStatus: "loaded",
      visualChunkCount: 7,
      excludedChunkCount: 1,
      loadedSplats: 3_491_322,
      evidenceRefs: [qaEvidenceRef],
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
        evidenceRefs: [qaEvidenceRef],
      },
      {
        checkKey: "served_chunk_count",
        status: "passed",
        summary: "Seven room SOG chunks are served; one environment chunk is excluded.",
        evidenceRefs: [
          {
            label: "Intake note",
            ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md",
          },
        ],
      },
      {
        checkKey: "spark_payload_loads",
        status: "passed",
        summary: "Spark loads the served SOG payloads for internal runtime QA.",
        evidenceRefs: [qaEvidenceRef],
      },
      {
        checkKey: "camera_framing",
        status: "passed",
        summary: "The start view frames the Reception Room for internal inspection.",
        evidenceRefs: [qaEvidenceRef],
      },
      {
        checkKey: "user_orbit_bounds",
        status: "passed",
        summary: "A small user orbit remains inside the bounded QA camera region.",
        evidenceRefs: [
          {
            label: "After-drag evidence",
            ref: "output/playwright/reception-room-camera-arrival-after-drag.png",
          },
        ],
      },
      {
        checkKey: "approximate_view_transform_documented",
        status: "passed",
        summary: "The approximate transform is explicitly documented as not signed.",
        evidenceRefs: [
          {
            label: "Runtime intake note",
            ref: "docs/operations/reception-room-runtime-intake-2026-06-13.md",
          },
        ],
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
  };
}

function signedRuntimeQaRecord(
  publicExposureDecision: RuntimeQaRecordV0["publicExposure"]["decision"] =
    "approved_internal_preview",
): RuntimeQaRecordV0 {
  const baseRecord = baseRuntimeQaRecord();
  const checks = baseRecord.checks.map((check): RuntimeQaRecordV0["checks"][number] => {
    if (check.checkKey === "signed_transform_artifact") {
      return {
        ...check,
        status: "passed",
        summary: "Signed room-local transform artifact is recorded.",
        evidenceRefs: [{ label: "Transform artifact", ref: TRANSFORM_ARTIFACT_ID }],
      };
    }
    if (check.checkKey === "public_exposure_review") {
      return {
        ...check,
        status: publicExposureDecision === "approved_public" ? "passed" : "requires_human_review",
        summary: publicExposureDecision === "approved_public"
          ? "Public exposure review is recorded."
          : "Internal preview is approved; public exposure still needs review.",
        evidenceRefs: publicExposureDecision === "approved_public"
          ? [{ label: "Exposure review", ref: "docs/operations/reception-room-public-review.md" }]
          : [],
      };
    }
    return check;
  });

  return {
    ...baseRecord,
    recordId: publicExposureDecision === "approved_public"
      ? "reception-room-runtime-qa-public-2026-06-16"
      : "reception-room-runtime-qa-signed-2026-06-16",
    assetEvidenceStatus: publicExposureDecision === "approved_public"
      ? "human_reviewed"
      : "machine_checked",
    viewTransform: {
      ...baseRecord.viewTransform,
      posture: "signed_room_local_transform",
      signedTransformArtifactId: TRANSFORM_ARTIFACT_ID,
      note: "Signed room-local transform for reviewed runtime alignment.",
    },
    checks,
    publicExposure: {
      decision: publicExposureDecision,
      reason: publicExposureDecision === "approved_public"
        ? "Human review and signed transform evidence are recorded."
        : "Internal preview can use signed transform evidence while public exposure remains blocked.",
      requiredBeforeApproval: publicExposureDecision === "approved_public"
        ? ["No remaining approval blockers."]
        : ["Public exposure review."],
    },
  };
}

function validRuntimeQaPayload(record: RuntimeQaRecordV0 = baseRuntimeQaRecord()): RegisterRuntimeQaRecordInput {
  return {
    runtimePackageId: record.runtimePackageId,
    venueSlug: record.venueSlug,
    roomSlug: record.roomSlug,
    record,
  };
}

function latestRuntimePackageForPayload(
  payload: RegisterRuntimeQaRecordInput,
  id = payload.runtimePackageId,
): RuntimePackage {
  return {
    id,
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    primaryVisualAssetVersionId: "10000000-0000-4000-8000-000000000001",
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: "10000000-0000-4000-8000-000000000001",
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
    },
    evidenceStatus: payload.record.assetEvidenceStatus,
    runtimeStatus: payload.record.runtimeStatus,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    primaryVisualAssetVersion: null,
    primaryVisualAssetUrl: null,
    visualAssetUrls: [],
  };
}

function runtimeTransformArtifactForPayload(
  payload: RegisterRuntimeQaRecordInput,
): RuntimeTransformArtifact {
  return {
    id: "10000000-0000-4000-8000-000000000021",
    runtimePackageId: payload.runtimePackageId,
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    transformArtifactId: TRANSFORM_ARTIFACT_ID,
    transformArtifact: {
      id: TRANSFORM_ARTIFACT_ID,
      sourceFrame: "COLMAP_RDF",
      targetFrame: "CVF",
      units: "meters",
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      alignmentMethod: "landmark_solve",
      residualRmseM: 0.012,
      landmarks: [
        {
          id: "corner-01",
          label: "Control corner 01",
          source: [0, 0, 0],
          target: [0, 0, 0],
          residualM: 0.01,
          provenanceRefs: [transformEvidenceRef],
        },
      ],
      provenance: {
        state: "measured",
        refs: [transformEvidenceRef],
      },
      creator: {
        actorType: "human",
        id: "ops/runtime-operator",
        displayName: "Runtime operator",
        role: "runtime_operator",
      },
      reviewer: {
        actorType: "human",
        id: "ops/runtime-reviewer",
        displayName: "Runtime reviewer",
        role: "runtime_reviewer",
      },
      date: "2026-06-16T10:00:00.000Z",
    },
    reviewNote: "Script test only; not a live Reception Room signed transform.",
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
  };
}

function registrationForPayload(
  payload: RegisterRuntimeQaRecordInput,
): RuntimeQaRecordRegistration {
  return {
    id: "10000000-0000-4000-8000-000000000031",
    runtimePackageId: payload.runtimePackageId,
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    recordId: payload.record.recordId,
    record: payload.record,
    signedTransformArtifactId: payload.record.viewTransform.signedTransformArtifactId,
    publicExposureDecision: payload.record.publicExposure.decision,
    assetEvidenceStatus: payload.record.assetEvidenceStatus,
    runtimeStatus: payload.record.runtimeStatus,
    reviewedBy: "10000000-0000-4000-8000-000000000007",
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
  };
}

function dryRunReportForPayload(
  payload: RegisterRuntimeQaRecordInput,
  options: {
    readonly latestRuntimePackageId?: string | null;
    readonly latestRuntimePackageRuntimeStatus?: RuntimePackage["runtimeStatus"] | null;
    readonly latestRuntimePackageEvidenceStatus?: RuntimePackage["evidenceStatus"] | null;
    readonly runtimePackageDriftAllowed?: boolean;
    readonly signedTransformRegistered?: boolean | null;
  } = {},
): RuntimeQaRecordRegistrationReport {
  const latestRuntimePackageId = options.latestRuntimePackageId === undefined
    ? payload.runtimePackageId
    : options.latestRuntimePackageId;
  const latestRuntimePackageRuntimeStatus = options.latestRuntimePackageRuntimeStatus === undefined
    ? latestRuntimePackageId === null ? null : payload.record.runtimeStatus
    : options.latestRuntimePackageRuntimeStatus;
  const latestRuntimePackageEvidenceStatus = options.latestRuntimePackageEvidenceStatus === undefined
    ? latestRuntimePackageId === null ? null : payload.record.assetEvidenceStatus
    : options.latestRuntimePackageEvidenceStatus;
  const signedTransformArtifactId = payload.record.viewTransform.signedTransformArtifactId;
  const signedTransformRegistered = options.signedTransformRegistered === undefined
    ? signedTransformArtifactId === null ? null : true
    : options.signedTransformRegistered;
  const runtimePackageDriftAllowed = options.runtimePackageDriftAllowed ?? false;

  return {
    schemaVersion: "venviewer.runtime-qa-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "dry_run",
    apiUrl: "http://localhost:3001",
    payloadFile: "runtime-qa-record.json",
    payload: {
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      runtimePackageId: payload.runtimePackageId,
      recordId: payload.record.recordId,
      assetEvidenceStatus: payload.record.assetEvidenceStatus,
      runtimeStatus: payload.record.runtimeStatus,
      transformPosture: payload.record.viewTransform.posture,
      signedTransformArtifactId,
      publicExposureDecision: payload.record.publicExposure.decision,
    },
    preflight: {
      payloadRuntimePackageId: payload.runtimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus,
      latestRuntimePackageEvidenceStatus,
      runtimePackageMatchesLatest: latestRuntimePackageId === payload.runtimePackageId,
      runtimePackageDriftAllowed,
      signedTransformRequired: signedTransformArtifactId !== null,
      signedTransformRegistered,
    },
    registration: null,
    guardrails: {
      runtimePackageDriftAllowed,
      publicExposureAllowed: payload.record.publicExposure.decision === "approved_public",
      publicExposureChanged: payload.record.publicExposure.decision === "approved_public",
    },
  };
}

function registeredReportForPayload(
  payload: RegisterRuntimeQaRecordInput,
): RuntimeQaRecordRegistrationReport {
  const registration = registrationForPayload(payload);
  return {
    ...dryRunReportForPayload(payload),
    mode: "registered",
    registration: {
      runtimeQaRecordRowId: registration.id,
      recordId: registration.recordId,
      signedTransformArtifactId: registration.signedTransformArtifactId,
      publicExposureDecision: registration.publicExposureDecision,
      reviewedBy: registration.reviewedBy,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
    },
  };
}

describe("register-runtime-qa-record script", () => {
  it("loads and validates an explicit runtime QA payload file", () => {
    const dir = mkdtempSync(join(tmpdir(), "venviewer-runtime-qa-payload-"));
    const filePath = join(dir, "runtime-qa-record.json");
    writeFileSync(filePath, `${JSON.stringify(validRuntimeQaPayload())}\n`, "utf-8");

    const payload = loadRuntimeQaRecordPayload(filePath);

    expect(payload.runtimePackageId).toBe(RUNTIME_PACKAGE_ID);
    expect(payload.record.recordId).toBe("reception-room-runtime-qa-2026-06-16");
    expect(payload.record.publicExposure.decision).toBe("blocked_internal_only");
  });

  it("inspects a current dry-run report as ready for live runtime QA registration", () => {
    const payload = validRuntimeQaPayload();

    const inspection = inspectRuntimeQaRecordRegistrationReport(
      dryRunReportForPayload(payload),
      {
        generatedAt: "2026-06-16T12:10:00.000Z",
        inspectedReportFile: "reports/current-runtime-qa-report.json",
      },
    );

    expect(inspection).toMatchObject({
      status: "ready_for_live_qa_registration",
      liveQaRegistrationReady: true,
      mode: "dry_run",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      recordId: "reception-room-runtime-qa-2026-06-16",
      publicExposureDecision: "blocked_internal_only",
      blockers: [],
    });
    expect(inspection.messages).toContain(
      "Dry-run report is current for live runtime QA registration preflight.",
    );
    expect(formatRuntimeQaRecordRegistrationReportInspection(inspection)).toContain(
      "Runtime QA report inspection: ready_for_live_qa_registration.",
    );
  });

  it("blocks drift-override dry-run QA reports from live registration readiness", () => {
    const payload = validRuntimeQaPayload();

    const inspection = inspectRuntimeQaRecordRegistrationReport(
      dryRunReportForPayload(payload, {
        latestRuntimePackageId: DRIFTED_RUNTIME_PACKAGE_ID,
        runtimePackageDriftAllowed: true,
      }),
      {
        generatedAt: "2026-06-16T12:10:00.000Z",
        inspectedReportFile: "reports/drifted-runtime-qa-report.json",
      },
    );

    expect(inspection.status).toBe("not_ready_for_live_qa_registration");
    expect(inspection.liveQaRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Payload runtime package is not the latest loadable runtime package.",
      "Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    ]);
  });

  it("treats registered QA reports as audit evidence, not authorization for another POST", () => {
    const payload = validRuntimeQaPayload();

    const inspection = inspectRuntimeQaRecordRegistrationReport(
      registeredReportForPayload(payload),
      {
        generatedAt: "2026-06-16T12:10:00.000Z",
        inspectedReportFile: "reports/registered-runtime-qa-report.json",
      },
    );

    expect(inspection.status).toBe("registered_qa_report_verified");
    expect(inspection.liveQaRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Report already records a live runtime QA registration; use it as audit evidence, not authorization for another POST.",
    ]);
  });

  it("returns invalid_report for schema-invalid QA report inspection input", () => {
    const inspection = inspectRuntimeQaRecordRegistrationReport(
      {
        schemaVersion: "venviewer.runtime-qa-registration-report.v0",
        mode: "dry_run",
      },
      {
        generatedAt: "2026-06-16T12:10:00.000Z",
        inspectedReportFile: "reports/invalid-runtime-qa-report.json",
      },
    );

    expect(inspection.status).toBe("invalid_report");
    expect(inspection.liveQaRegistrationReady).toBe(false);
    expect(inspection.blockers).toContain("generatedAt: Required");
    expect(inspection.messages).toEqual([
      "Report failed RuntimeQaRecordRegistrationReportSchema validation.",
    ]);
  });

  it("rejects approved-public QA payloads before HTTP without the explicit exposure override", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord("approved_public"));
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(preflightRuntimeQaRecordRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow("VENVIEWER_ALLOW_RUNTIME_QA_PUBLIC_EXPOSURE=true");

    expect(calls).toEqual([]);
  });

  it("runs unsigned dry-run preflight without requiring an admin token or posting", async () => {
    const payload = validRuntimeQaPayload();
    const dir = mkdtempSync(join(tmpdir(), "venviewer-runtime-qa-payload-"));
    const filePath = join(dir, "runtime-qa-record.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const messages: string[] = [];
    const reports: {
      readonly filePath: string;
      readonly report: RuntimeQaRecordRegistrationReport;
      readonly allowOverwrite: boolean;
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterRuntimeQaRecord({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_QA_DRY_RUN: "true",
        RUNTIME_QA_RECORD_FILE: filePath,
        RUNTIME_QA_REPORT_FILE: "runtime-qa-report.json",
      },
      fetchImpl,
      log: (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-16T12:00:00.000Z"),
      reportFileExists: () => false,
      writeReport: (reportFile, report, options) => {
        reports.push({ filePath: reportFile, report, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(calls[0]?.init.headers.authorization).toBeUndefined();
    expect(reports.map((report) => report.filePath.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/runtime-qa-report.json"),
    ]);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.runtime-qa-registration-report.v0",
      generatedAt: "2026-06-16T12:00:00.000Z",
      mode: "dry_run",
      payload: {
        venueSlug: "trades-hall",
        roomSlug: "reception-room",
        runtimePackageId: RUNTIME_PACKAGE_ID,
        recordId: "reception-room-runtime-qa-2026-06-16",
        signedTransformArtifactId: null,
        publicExposureDecision: "blocked_internal_only",
      },
      preflight: {
        latestRuntimePackageId: RUNTIME_PACKAGE_ID,
        runtimePackageMatchesLatest: true,
        signedTransformRequired: false,
        signedTransformRegistered: null,
      },
      registration: null,
      guardrails: {
        runtimePackageDriftAllowed: false,
        publicExposureAllowed: false,
        publicExposureChanged: false,
      },
    });
    expect(reports[0]?.allowOverwrite).toBe(false);
    expect(messages).toEqual([
      "Dry run only: validated runtime QA record reception-room-runtime-qa-2026-06-16 for trades-hall/reception-room; no POST was sent.",
      "Runtime package preflight: payload 71687e9e-c23d-4f51-b3dd-a6a82c97978d; latest loadable 71687e9e-c23d-4f51-b3dd-a6a82c97978d; signed transform none; public exposure blocked_internal_only.",
    ]);
  });

  it("refuses to overwrite an existing QA report before preflight", async () => {
    const payload = validRuntimeQaPayload();
    const dir = mkdtempSync(join(tmpdir(), "venviewer-runtime-qa-payload-"));
    const filePath = join(dir, "runtime-qa-record.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const reports: RuntimeQaRecordRegistrationReport[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(runRegisterRuntimeQaRecord({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_QA_DRY_RUN: "true",
        RUNTIME_QA_RECORD_FILE: filePath,
        RUNTIME_QA_REPORT_FILE: "runtime-qa-report.json",
      },
      fetchImpl,
      log: () => undefined,
      reportFileExists: () => true,
      writeReport: (_reportFile, report) => {
        reports.push(report);
      },
    })).rejects.toThrow(
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_QA_REPORT=true",
    );

    expect(calls).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("runs report inspection without loading the QA payload, requiring a token, or calling the API", async () => {
    const payload = validRuntimeQaPayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const inspectedPaths: string[] = [];
    const inspections: {
      readonly filePath: string;
      readonly inspection: RuntimeQaRecordRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];
    const messages: string[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Inspection mode should not call the API" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runRegisterRuntimeQaRecord({
      env: {
        RUNTIME_QA_INSPECT_REPORT_FILE: "reports/current-runtime-qa-report.json",
        RUNTIME_QA_INSPECTION_FILE: "reports/current-runtime-qa-inspection.json",
        RUNTIME_QA_RECORD_FILE: "missing-runtime-qa-payload.json",
      },
      fetchImpl,
      log: (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-16T12:10:00.000Z"),
      readReport: (reportFile) => {
        inspectedPaths.push(reportFile);
        return dryRunReportForPayload(payload);
      },
      writeInspection: (inspectionFile, inspection, options) => {
        inspections.push({ filePath: inspectionFile, inspection, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(inspectedPaths.map((path) => path.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/reports/current-runtime-qa-report.json"),
    ]);
    expect(inspections.map((inspection) => inspection.filePath.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/reports/current-runtime-qa-inspection.json"),
    ]);
    expect(inspections[0]?.inspection).toMatchObject({
      schemaVersion: "venviewer.runtime-qa-registration-report-inspection.v0",
      generatedAt: "2026-06-16T12:10:00.000Z",
      status: "ready_for_live_qa_registration",
      liveQaRegistrationReady: true,
      inspectedReportGeneratedAt: "2026-06-16T12:00:00.000Z",
      reportRuntimePackageId: RUNTIME_PACKAGE_ID,
      reportLatestRuntimePackageId: RUNTIME_PACKAGE_ID,
      reportRuntimePackageMatchesLatest: true,
      reportRuntimePackageDriftAllowed: false,
    });
    expect(inspections[0]?.allowOverwrite).toBe(false);
    expect(calls).toEqual([]);
    expect(messages).toContain("Runtime QA report inspection: ready_for_live_qa_registration.");
    expect(messages).toContain(
      "Check: Dry-run report is current for live runtime QA registration preflight.",
    );
  });

  it("refuses to overwrite an existing QA inspection artifact before reading the report", async () => {
    const payload = validRuntimeQaPayload();
    const inspectedPaths: string[] = [];
    const inspections: RuntimeQaRecordRegistrationReportInspection[] = [];

    await expect(runRegisterRuntimeQaRecord({
      env: {
        RUNTIME_QA_INSPECT_REPORT_FILE: "reports/current-runtime-qa-report.json",
        RUNTIME_QA_INSPECTION_FILE: "reports/current-runtime-qa-inspection.json",
      },
      log: () => undefined,
      inspectionFileExists: () => true,
      readReport: (reportFile) => {
        inspectedPaths.push(reportFile);
        return dryRunReportForPayload(payload);
      },
      writeInspection: (_inspectionFile, inspection) => {
        inspections.push(inspection);
      },
    })).rejects.toThrow(
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_QA_INSPECTION=true",
    );

    expect(inspectedPaths).toEqual([]);
    expect(inspections).toEqual([]);
  });

  it("overwrites an existing QA inspection artifact only with the explicit inspection overwrite flag", async () => {
    const payload = validRuntimeQaPayload();
    const inspections: {
      readonly inspection: RuntimeQaRecordRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];

    await runRegisterRuntimeQaRecord({
      env: {
        RUNTIME_QA_INSPECT_REPORT_FILE: "reports/current-runtime-qa-report.json",
        RUNTIME_QA_INSPECTION_FILE: "reports/current-runtime-qa-inspection.json",
        VENVIEWER_OVERWRITE_RUNTIME_QA_INSPECTION: "true",
      },
      log: () => undefined,
      now: () => new Date("2026-06-16T12:15:00.000Z"),
      inspectionFileExists: () => true,
      readReport: () => dryRunReportForPayload(payload),
      writeInspection: (_inspectionFile, inspection, options) => {
        inspections.push({ inspection, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(inspections).toHaveLength(1);
    expect(inspections[0]?.allowOverwrite).toBe(true);
    expect(inspections[0]?.inspection.generatedAt).toBe("2026-06-16T12:15:00.000Z");
  });

  it("requires a report input when a QA inspection artifact output is requested", async () => {
    await expect(runRegisterRuntimeQaRecord({
      env: {
        RUNTIME_QA_INSPECTION_FILE: "reports/current-runtime-qa-inspection.json",
      },
      log: () => undefined,
    })).rejects.toThrow(
      "RUNTIME_QA_INSPECTION_FILE requires RUNTIME_QA_INSPECT_REPORT_FILE",
    );
  });

  it("fails inspection mode when the QA report is not ready for live registration", async () => {
    const payload = validRuntimeQaPayload();
    const messages: string[] = [];

    await expect(runRegisterRuntimeQaRecord({
      env: {
        RUNTIME_QA_INSPECT_REPORT_FILE: "reports/drifted-runtime-qa-report.json",
      },
      log: (message) => {
        messages.push(message);
      },
      readReport: () => dryRunReportForPayload(payload, {
        latestRuntimePackageId: DRIFTED_RUNTIME_PACKAGE_ID,
        runtimePackageDriftAllowed: true,
      }),
    })).rejects.toThrow("is not ready for live registration");

    expect(messages).toContain("Runtime QA report inspection: not_ready_for_live_qa_registration.");
    expect(messages).toContain(
      "Blocker: Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    );
  });

  it("fails before POST when the QA payload targets a drifted runtime package", async () => {
    const payload = validRuntimeQaPayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({
          data: latestRuntimePackageForPayload(payload, DRIFTED_RUNTIME_PACKAGE_ID),
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await expect(preflightRuntimeQaRecordRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Refusing to register drifted runtime QA before POST",
    );

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
  });

  it("requires an admin token for signed-transform dry-run preflight", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord());
    const dir = mkdtempSync(join(tmpdir(), "venviewer-runtime-qa-payload-"));
    const filePath = join(dir, "runtime-qa-record.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(runRegisterRuntimeQaRecord({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_QA_DRY_RUN: "true",
        RUNTIME_QA_RECORD_FILE: filePath,
      },
      fetchImpl,
      log: () => undefined,
    })).rejects.toThrow("VENVIEWER_ADMIN_BEARER_TOKEN is required.");

    expect(calls).toEqual([]);
  });

  it("preflights signed-transform QA by reading registered transform artifacts", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord());
    const transformArtifact = runtimeTransformArtifactForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        input === runtimeTransformArtifactsEndpoint("http://localhost:3001", payload.runtimePackageId) &&
        init.method === "GET"
      ) {
        return new Response(JSON.stringify({ data: [transformArtifact] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    const preflight = await preflightRuntimeQaRecordRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      `http://localhost:3001/admin/assets/runtime-transform-artifacts?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
    ]);
    expect(calls[1]?.init.headers.authorization).toBe("Bearer admin-token");
    expect(preflight.signedTransformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
    expect(preflight.signedTransformArtifact?.transformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
  });

  it("fails signed-transform QA preflight when the cited transform row is missing", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord());
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        input === runtimeTransformArtifactsEndpoint("http://localhost:3001", payload.runtimePackageId) &&
        init.method === "GET"
      ) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(preflightRuntimeQaRecordRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      `Runtime QA signed transform artifact ${TRANSFORM_ARTIFACT_ID} is not registered`,
    );
  });

  it("allows approved-public preflight only with explicit public exposure and signed transform overrides", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord("approved_public"));
    const transformArtifact = runtimeTransformArtifactForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        input === runtimeTransformArtifactsEndpoint("http://localhost:3001", payload.runtimePackageId) &&
        init.method === "GET"
      ) {
        return new Response(JSON.stringify({ data: [transformArtifact] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    const preflight = await preflightRuntimeQaRecordRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      allowPublicExposure: true,
      fetchImpl,
    });

    expect(calls).toHaveLength(2);
    expect(preflight.signedTransformArtifact?.transformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
  });

  it("posts and verifies readback through the runtime-qa-records route", async () => {
    const payload = validRuntimeQaPayload();
    const registrationResponse = registrationForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeQaFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeQaRecordEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeQaRecordsEndpoint("http://localhost:3001", payload.runtimePackageId) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    const verification = await registerAndVerifyRuntimeQaRecord({
      apiUrl: "http://localhost:3001/",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      "http://localhost:3001/admin/assets/register-runtime-qa-record",
      `http://localhost:3001/admin/assets/runtime-qa-records?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
    ]);
    expect(calls[1]?.init.headers.authorization).toBe("Bearer admin-token");
    expect(JSON.parse(calls[1]?.init.body ?? "{}") as unknown).toEqual(payload);
    expect(verification.persistedRecord.id).toBe(registrationResponse.id);
  });

  it("writes a registered QA report after verified readback without token material", async () => {
    const payload = validRuntimeQaPayload();
    const registrationResponse = registrationForPayload(payload);
    const dir = mkdtempSync(join(tmpdir(), "venviewer-runtime-qa-payload-"));
    const filePath = join(dir, "runtime-qa-record.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const reports: {
      readonly filePath: string;
      readonly report: RuntimeQaRecordRegistrationReport;
    }[] = [];
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeQaRecordEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeQaRecordsEndpoint("http://localhost:3001", payload.runtimePackageId) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await runRegisterRuntimeQaRecord({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_ADMIN_BEARER_TOKEN: "admin-token",
        RUNTIME_QA_RECORD_FILE: filePath,
        RUNTIME_QA_REPORT_FILE: "runtime-qa-registration-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:30:00.000Z"),
      reportFileExists: () => false,
      writeReport: (reportFile, report) => {
        reports.push({ filePath: reportFile, report });
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.runtime-qa-registration-report.v0",
      generatedAt: "2026-06-16T12:30:00.000Z",
      mode: "registered",
      registration: {
        runtimeQaRecordRowId: "10000000-0000-4000-8000-000000000031",
        recordId: "reception-room-runtime-qa-2026-06-16",
      },
      guardrails: {
        runtimePackageDriftAllowed: false,
        publicExposureAllowed: false,
        publicExposureChanged: false,
      },
    });
    expect(JSON.stringify(reports[0]?.report)).not.toContain("admin-token");
  });

  it("fails verification when readback omits the persisted QA row", async () => {
    const payload = validRuntimeQaPayload();
    const registrationResponse = registrationForPayload(payload);
    const fetchImpl: RuntimeQaFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeQaRecordEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await expect(registerAndVerifyRuntimeQaRecord({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Runtime QA readback did not include persisted row",
    );
  });

  it("reports API registration failures with status and response body", async () => {
    const payload = validRuntimeQaPayload();
    const fetchImpl: RuntimeQaFetch = () =>
      new Response(JSON.stringify({
        error: "Runtime QA duplicate record",
        code: "RUNTIME_QA_RECORD_CONFLICT",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });

    await expect(registerRuntimeQaRecord({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Runtime QA record registration failed with HTTP 409",
    );
  });

  it("reports transform artifact read failures with status and response body", async () => {
    const payload = validRuntimeQaPayload(signedRuntimeQaRecord());
    const fetchImpl: RuntimeQaFetch = () =>
      new Response(JSON.stringify({
        error: "Admin token missing",
        code: "UNAUTHORIZED",
      }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(readRegisteredRuntimeTransformArtifacts({
      apiUrl: "http://localhost:3001",
      bearerToken: "",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Runtime QA signed transform artifact preflight failed with HTTP 401",
    );
  });
});
