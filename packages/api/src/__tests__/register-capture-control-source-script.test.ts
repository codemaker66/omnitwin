import { describe, expect, it } from "vitest";
import type {
  CaptureControlRegistrationReportInspection,
  CaptureControlRegistrationReport,
  CaptureControlSourceRegistration,
  RegisterCaptureControlSourceRecordInput,
  RoomAssetStatus,
  RuntimePackage,
} from "@omnitwin/types";
import {
  captureControlSourceEndpoint,
  captureControlSourcesEndpoint,
  formatCaptureControlRegistrationReportInspection,
  inspectCaptureControlRegistrationReport,
  latestRuntimePackageEndpoint,
  loadCaptureControlSourcePayload,
  preflightCaptureControlRegistration,
  registerAndVerifyCaptureControlSource,
  registerCaptureControlSource,
  roomAssetStatusesEndpoint,
  runRegisterCaptureControlSource,
  type CaptureControlFetch,
} from "../scripts/register-capture-control-source.js";

const INSPECTION_CONTEXT = {
  generatedAt: "2026-06-16T12:10:00.000Z",
  inspectedReportFile: "reports/current-capture-control-report.json",
} as const;

function registrationForPayload(
  payload: RegisterCaptureControlSourceRecordInput,
): CaptureControlSourceRegistration {
  return {
    id: "10000000-0000-4000-8000-000000000009",
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    runtimePackageId: payload.runtimePackageId ?? null,
    transformArtifactId: payload.transformArtifactId ?? null,
    sourceId: payload.source.sourceId,
    sourceClass: payload.source.sourceClass,
    poseAuthorityLevel: payload.source.poseAuthorityLevel,
    qaStatus: payload.source.qaStatus,
    source: payload.source,
    reviewNote: payload.reviewNote ?? null,
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };
}

function latestRuntimePackageForPayload(
  payload: RegisterCaptureControlSourceRecordInput,
  id = payload.runtimePackageId ?? "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
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
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    primaryVisualAssetVersion: null,
    primaryVisualAssetUrl: null,
    visualAssetUrls: [],
  };
}

function roomStatusForRegistration(
  registration: CaptureControlSourceRegistration,
  options: {
    readonly freshnessStatus?: RoomAssetStatus["captureControlFreshnessStatus"];
    readonly activeStalenessTriggers?: readonly string[];
  } = {},
): RoomAssetStatus {
  const activeStalenessTriggers = options.activeStalenessTriggers ?? [];
  return {
    venueSlug: registration.venueSlug,
    roomSlug: registration.roomSlug,
    displayName: "Reception Room",
    roomGroup: "support-room",
    defaultStatus: "needs_registration",
    captureStatus: "processed_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "processed_output_found",
    splatStatus: "registered splat asset",
    splatExists: true,
    runtimePackageStatus: "runtime package internal ready",
    runtimePackageExists: true,
    reviewedTransformStatus: "missing",
    reviewedTransformArtifactCount: 0,
    latestTransformArtifactId: null,
    reviewedTransformSafeCopy: "no reviewed runtime transform registered",
    reviewedQaStatus: "missing",
    latestQaRecordId: null,
    qaSignedTransformArtifactId: null,
    qaSignedTransformLinked: false,
    reviewedQaSafeCopy: "no runtime QA record registered",
    captureControlStatus: "source_registered",
    captureControlSourceCount: 1,
    latestCaptureControlSourceRecordId: registration.id,
    latestCaptureControlSourceId: registration.sourceId,
    latestCaptureControlSourceClass: registration.sourceClass,
    latestCaptureControlPoseAuthorityLevel: registration.poseAuthorityLevel,
    latestCaptureControlAlignmentMethods: registration.source.alignmentMethods,
    latestCaptureControlStalenessTriggers: registration.source.staleWhen,
    latestCaptureControlActiveStalenessTriggers: [...activeStalenessTriggers],
    captureControlFreshnessStatus: options.freshnessStatus ?? "current_for_runtime_package",
    latestCaptureControlQaStatus: registration.qaStatus,
    captureControlLinkedTransformArtifactId: registration.transformArtifactId,
    captureControlTransformLinked: false,
    captureControlAuthoritySafeCopy: "visual-only alignment source recorded; not measurement control",
    captureControlStalenessSafeCopy: "capture-control source has 4 staleness triggers recorded",
    captureControlSafeCopy: "capture-control source registered; signed transform still required",
    runtimeControlEvidenceChainStatus: "blocked_missing_coordinate_pair_intake",
    runtimeControlEvidenceChainRef: "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
    runtimeControlRequiredCoordinatePairCount: 4,
    runtimeControlReviewedCoordinatePairCount: 0,
    runtimeControlEvidenceChainSafeCopy: "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
    runtimeControlEvidenceChainNextAction: "Collect the four reviewed ARF to CVF landmark measurements",
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    nextAction: "Open the internal runtime view",
    safeCopy: "Runtime asset loaded, machine checked; human review required.",
  };
}

function reportPayloadFor(
  payload: RegisterCaptureControlSourceRecordInput,
): CaptureControlRegistrationReport["payload"] {
  return {
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    sourceId: payload.source.sourceId,
    sourceClass: payload.source.sourceClass,
    poseAuthorityLevel: payload.source.poseAuthorityLevel,
    qaStatus: payload.source.qaStatus,
    runtimePackageId: payload.runtimePackageId ?? null,
    transformArtifactId: payload.transformArtifactId ?? null,
    staleWhen: payload.source.staleWhen,
  };
}

function dryRunReportForPayload(
  payload: RegisterCaptureControlSourceRecordInput,
  options: {
    readonly latestRuntimePackageId?: string | null;
    readonly latestRuntimePackageRuntimeStatus?: RuntimePackage["runtimeStatus"] | null;
    readonly latestRuntimePackageEvidenceStatus?: RuntimePackage["evidenceStatus"] | null;
    readonly runtimePackageDriftAllowed?: boolean;
    readonly staleReadbackAllowed?: boolean;
  } = {},
): CaptureControlRegistrationReport {
  const payloadRuntimePackageId = payload.runtimePackageId ?? null;
  const latestRuntimePackageId = options.latestRuntimePackageId === undefined
    ? payloadRuntimePackageId
    : options.latestRuntimePackageId;
  const latestRuntimePackageRuntimeStatus = options.latestRuntimePackageRuntimeStatus === undefined
    ? latestRuntimePackageId === null ? null : "internal_ready"
    : options.latestRuntimePackageRuntimeStatus;
  const latestRuntimePackageEvidenceStatus = options.latestRuntimePackageEvidenceStatus === undefined
    ? latestRuntimePackageId === null ? null : "machine_checked"
    : options.latestRuntimePackageEvidenceStatus;
  const runtimePackageDriftAllowed = options.runtimePackageDriftAllowed ?? false;
  const runtimePackageMatchesLatest = payloadRuntimePackageId === null
    ? null
    : latestRuntimePackageId !== null && latestRuntimePackageId === payloadRuntimePackageId;

  return {
    schemaVersion: "venviewer.capture-control-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "dry_run",
    apiUrl: "http://localhost:3001",
    payloadFile: "capture-control-source.json",
    payload: reportPayloadFor(payload),
    preflight: {
      payloadRuntimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus,
      latestRuntimePackageEvidenceStatus,
      runtimePackageMatchesLatest,
      runtimePackageDriftAllowed,
    },
    registration: null,
    roomStatus: null,
    guardrails: {
      runtimePackageDriftAllowed,
      staleReadbackAllowed: options.staleReadbackAllowed ?? false,
      signedTransformCreated: false,
      publicExposureChanged: false,
    },
  };
}

function registeredReportForPayload(
  payload: RegisterCaptureControlSourceRecordInput,
): CaptureControlRegistrationReport {
  const registration = registrationForPayload(payload);
  const roomStatus = roomStatusForRegistration(registration);
  const payloadRuntimePackageId = payload.runtimePackageId ?? null;

  return {
    schemaVersion: "venviewer.capture-control-registration-report.v0",
    generatedAt: "2026-06-16T12:30:00.000Z",
    mode: "registered",
    apiUrl: "http://localhost:3001",
    payloadFile: "capture-control-source.json",
    payload: reportPayloadFor(payload),
    preflight: {
      payloadRuntimePackageId,
      latestRuntimePackageId: payloadRuntimePackageId,
      latestRuntimePackageRuntimeStatus: "internal_ready",
      latestRuntimePackageEvidenceStatus: "machine_checked",
      runtimePackageMatchesLatest: payloadRuntimePackageId === null ? null : true,
      runtimePackageDriftAllowed: false,
    },
    registration: {
      captureControlSourceId: registration.id,
      sourceId: registration.sourceId,
      qaStatus: registration.qaStatus,
      registeredBy: registration.registeredBy,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
    },
    roomStatus: {
      latestCaptureControlSourceRecordId: registration.id,
      latestCaptureControlSourceId: registration.sourceId,
      latestCaptureControlSourceClass: registration.sourceClass,
      latestCaptureControlPoseAuthorityLevel: registration.poseAuthorityLevel,
      latestCaptureControlQaStatus: registration.qaStatus,
      captureControlStatus: roomStatus.captureControlStatus,
      captureControlFreshnessStatus: roomStatus.captureControlFreshnessStatus,
      activeStalenessTriggers: [],
      captureControlSafeCopy: roomStatus.captureControlSafeCopy,
      captureControlAuthoritySafeCopy: roomStatus.captureControlAuthoritySafeCopy,
    },
    guardrails: {
      runtimePackageDriftAllowed: false,
      staleReadbackAllowed: false,
      signedTransformCreated: false,
      publicExposureChanged: false,
    },
  };
}

describe("register-capture-control-source script", () => {
  it("loads the checked-in Reception Room visual-alignment payload", () => {
    const payload = loadCaptureControlSourcePayload();

    expect(payload.venueSlug).toBe("trades-hall");
    expect(payload.roomSlug).toBe("reception-room");
    expect(payload.runtimePackageId).toBe("71687e9e-c23d-4f51-b3dd-a6a82c97978d");
    expect(payload.transformArtifactId).toBeNull();
    expect(payload.source.sourceClass).toBe("artist_blender_alignment_refs");
    expect(payload.source.poseAuthorityLevel).toBe("visual_alignment_only");
    expect(payload.source.alignmentMethods).toEqual(["visual_alignment"]);
  });

  it("inspects a current dry-run report as ready for live capture-control registration", () => {
    const payload = loadCaptureControlSourcePayload();

    const inspection = inspectCaptureControlRegistrationReport(
      dryRunReportForPayload(payload),
      INSPECTION_CONTEXT,
    );

    expect(inspection).toMatchObject({
      status: "ready_for_live_registration",
      liveRegistrationReady: true,
      mode: "dry_run",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      sourceId: "reception-room-approximate-view-transform-v0",
      blockers: [],
    });
    expect(inspection.messages).toContain(
      "Dry-run report is current for live capture-control registration preflight.",
    );
    expect(formatCaptureControlRegistrationReportInspection(inspection)).toContain(
      "Capture-control report inspection: ready_for_live_registration.",
    );
  });

  it("blocks drift-override dry-run reports from live-registration readiness", () => {
    const payload = loadCaptureControlSourcePayload();

    const inspection = inspectCaptureControlRegistrationReport(
      dryRunReportForPayload(payload, {
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageDriftAllowed: true,
      }),
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("not_ready_for_live_registration");
    expect(inspection.liveRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Payload runtime package is not the latest loadable runtime package.",
      "Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    ]);
  });

  it("blocks stale-readback override dry-run reports from normal live-registration readiness", () => {
    const payload = loadCaptureControlSourcePayload();

    const inspection = inspectCaptureControlRegistrationReport(
      dryRunReportForPayload(payload, {
        staleReadbackAllowed: true,
      }),
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("not_ready_for_live_registration");
    expect(inspection.liveRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Stale-readback override was enabled; rerun a normal dry-run before live registration.",
    ]);
  });

  it("treats registered reports as audit evidence, not authorization for another POST", () => {
    const payload = loadCaptureControlSourcePayload();

    const inspection = inspectCaptureControlRegistrationReport(
      registeredReportForPayload(payload),
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("registered_report_verified");
    expect(inspection.liveRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Report already records a live registration; use it as audit evidence, not authorization for another POST.",
    ]);
  });

  it("returns invalid_report for schema-invalid inspection input", () => {
    const inspection = inspectCaptureControlRegistrationReport(
      {
        schemaVersion: "venviewer.capture-control-registration-report.v0",
        mode: "dry_run",
      },
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("invalid_report");
    expect(inspection.liveRegistrationReady).toBe(false);
    expect(inspection.blockers).toContain("generatedAt: Required");
    expect(inspection.messages).toEqual([
      "Report failed CaptureControlRegistrationReportSchema validation.",
    ]);
  });

  it("runs report inspection without loading the source payload, requiring a token, or calling the API", async () => {
    const payload = loadCaptureControlSourcePayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const inspectedPaths: string[] = [];
    const inspections: {
      readonly filePath: string;
      readonly inspection: CaptureControlRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];
    const messages: string[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Inspection mode should not call the API" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runRegisterCaptureControlSource({
      env: {
        CAPTURE_CONTROL_INSPECT_REPORT_FILE: "reports/current-capture-control-report.json",
        CAPTURE_CONTROL_INSPECTION_FILE: "reports/current-capture-control-inspection.json",
        CAPTURE_CONTROL_SOURCE_FILE: "missing-source-payload.json",
      },
      fetchImpl,
      log: (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-16T12:10:00.000Z"),
      readReport: (filePath) => {
        inspectedPaths.push(filePath);
        return dryRunReportForPayload(payload);
      },
      writeInspection: (filePath, inspection, options) => {
        inspections.push({ filePath, inspection, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(inspectedPaths.map((path) => path.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/reports/current-capture-control-report.json"),
    ]);
    expect(inspections.map((inspection) => inspection.filePath.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/reports/current-capture-control-inspection.json"),
    ]);
    expect(inspections[0]?.inspection).toMatchObject({
      schemaVersion: "venviewer.capture-control-registration-report-inspection.v0",
      generatedAt: "2026-06-16T12:10:00.000Z",
      status: "ready_for_live_registration",
      liveRegistrationReady: true,
      inspectedReportGeneratedAt: "2026-06-16T12:00:00.000Z",
      reportRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      reportLatestRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      reportRuntimePackageMatchesLatest: true,
      reportRuntimePackageDriftAllowed: false,
      reportStaleReadbackAllowed: false,
    });
    expect(inspections[0]?.allowOverwrite).toBe(false);
    expect(calls).toEqual([]);
    expect(messages).toContain("Capture-control report inspection: ready_for_live_registration.");
    expect(messages).toContain(
      "Check: Dry-run report is current for live capture-control registration preflight.",
    );
  });

  it("refuses to overwrite an existing inspection artifact before reading the report", async () => {
    const payload = loadCaptureControlSourcePayload();
    const inspectedPaths: string[] = [];
    const inspections: CaptureControlRegistrationReportInspection[] = [];

    await expect(runRegisterCaptureControlSource({
      env: {
        CAPTURE_CONTROL_INSPECT_REPORT_FILE: "reports/current-capture-control-report.json",
        CAPTURE_CONTROL_INSPECTION_FILE: "reports/current-capture-control-inspection.json",
      },
      log: () => undefined,
      inspectionFileExists: () => true,
      readReport: (filePath) => {
        inspectedPaths.push(filePath);
        return dryRunReportForPayload(payload);
      },
      writeInspection: (_filePath, inspection) => {
        inspections.push(inspection);
      },
    })).rejects.toThrow(
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_CAPTURE_CONTROL_INSPECTION=true",
    );

    expect(inspectedPaths).toEqual([]);
    expect(inspections).toEqual([]);
  });

  it("overwrites an existing inspection artifact only with the explicit inspection overwrite flag", async () => {
    const payload = loadCaptureControlSourcePayload();
    const inspections: {
      readonly inspection: CaptureControlRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];

    await runRegisterCaptureControlSource({
      env: {
        CAPTURE_CONTROL_INSPECT_REPORT_FILE: "reports/current-capture-control-report.json",
        CAPTURE_CONTROL_INSPECTION_FILE: "reports/current-capture-control-inspection.json",
        VENVIEWER_OVERWRITE_CAPTURE_CONTROL_INSPECTION: "true",
      },
      log: () => undefined,
      now: () => new Date("2026-06-16T12:15:00.000Z"),
      inspectionFileExists: () => true,
      readReport: () => dryRunReportForPayload(payload),
      writeInspection: (_filePath, inspection, options) => {
        inspections.push({ inspection, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(inspections).toHaveLength(1);
    expect(inspections[0]?.allowOverwrite).toBe(true);
    expect(inspections[0]?.inspection.generatedAt).toBe("2026-06-16T12:15:00.000Z");
  });

  it("requires a report input when an inspection artifact output is requested", async () => {
    await expect(runRegisterCaptureControlSource({
      env: {
        CAPTURE_CONTROL_INSPECTION_FILE: "reports/current-capture-control-inspection.json",
      },
      log: () => undefined,
    })).rejects.toThrow(
      "CAPTURE_CONTROL_INSPECTION_FILE requires CAPTURE_CONTROL_INSPECT_REPORT_FILE",
    );
  });

  it("fails inspection mode when the report is not ready for live registration", async () => {
    const payload = loadCaptureControlSourcePayload();
    const messages: string[] = [];

    await expect(runRegisterCaptureControlSource({
      env: {
        CAPTURE_CONTROL_INSPECT_REPORT_FILE: "reports/drifted-capture-control-report.json",
      },
      log: (message) => {
        messages.push(message);
      },
      readReport: () => dryRunReportForPayload(payload, {
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageDriftAllowed: true,
      }),
    })).rejects.toThrow("is not ready for live registration");

    expect(messages).toContain("Capture-control report inspection: not_ready_for_live_registration.");
    expect(messages).toContain(
      "Blocker: Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    );
  });

  it("posts the validated payload to the admin capture-control route", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        data: registrationResponse,
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    const registration = await registerCaptureControlSource({
      apiUrl: "http://localhost:3001/",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(captureControlSourceEndpoint("http://localhost:3001/")).toBe(
      "http://localhost:3001/admin/assets/register-capture-control-source",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("http://localhost:3001/admin/assets/register-capture-control-source");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers.authorization).toBe("Bearer admin-token");
    expect(JSON.parse(calls[0]?.init.body ?? "{}") as unknown).toEqual(payload);
    expect(registration.sourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(registration.transformArtifactId).toBeNull();
  });

  it("posts and verifies readback through capture-control and room-status routes", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const roomStatus = roomStatusForRegistration(registrationResponse);
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [roomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    const verification = await registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      "http://localhost:3001/admin/assets/register-capture-control-source",
      "http://localhost:3001/admin/assets/capture-control-sources?venue=trades-hall&room=reception-room&runtimePackageId=71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      "http://localhost:3001/admin/assets/rooms?venue=trades-hall",
    ]);
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "POST", "GET", "GET"]);
    expect(verification.registration.sourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(verification.persistedSource.sourceId).toBe("reception-room-approximate-view-transform-v0");
    expect(verification.roomStatus.captureControlFreshnessStatus).toBe("current_for_runtime_package");
  });

  it("preflights current runtime package without posting", async () => {
    const payload = loadCaptureControlSourcePayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    const preflight = await preflightCaptureControlRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(calls[0]?.init.headers.authorization).toBeUndefined();
    expect(preflight.payloadRuntimePackageId).toBe(payload.runtimePackageId);
    expect(preflight.latestRuntimePackage?.id).toBe(payload.runtimePackageId);
    expect(preflight.runtimePackageDriftAllowed).toBe(false);
  });

  it("runs dry-run preflight without requiring an admin token or posting", async () => {
    const payload = loadCaptureControlSourcePayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const messages: string[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterCaptureControlSource({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_CAPTURE_CONTROL_DRY_RUN: "true",
      },
      fetchImpl,
      log: (message) => {
        messages.push(message);
      },
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(messages).toEqual([
      "Dry run only: validated capture-control payload reception-room-approximate-view-transform-v0 for trades-hall/reception-room; no POST was sent.",
      "Runtime package preflight: payload 71687e9e-c23d-4f51-b3dd-a6a82c97978d; latest loadable 71687e9e-c23d-4f51-b3dd-a6a82c97978d; drift override disabled.",
    ]);
  });

  it("writes a dry-run report when requested", async () => {
    const payload = loadCaptureControlSourcePayload();
    const reports: {
      readonly filePath: string;
      readonly report: CaptureControlRegistrationReport;
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterCaptureControlSource({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_CAPTURE_CONTROL_DRY_RUN: "true",
        CAPTURE_CONTROL_REPORT_FILE: "capture-control-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:00:00.000Z"),
      writeReport: (filePath, report) => {
        reports.push({ filePath, report });
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.filePath.endsWith("capture-control-report.json")).toBe(true);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.capture-control-registration-report.v0",
      generatedAt: "2026-06-16T12:00:00.000Z",
      mode: "dry_run",
      apiUrl: "http://localhost:3001",
      payload: {
        venueSlug: "trades-hall",
        roomSlug: "reception-room",
        sourceId: "reception-room-approximate-view-transform-v0",
        poseAuthorityLevel: "visual_alignment_only",
        runtimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      },
      preflight: {
        payloadRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
        latestRuntimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
        runtimePackageMatchesLatest: true,
        runtimePackageDriftAllowed: false,
      },
      registration: null,
      roomStatus: null,
      guardrails: {
        runtimePackageDriftAllowed: false,
        staleReadbackAllowed: false,
        signedTransformCreated: false,
        publicExposureChanged: false,
      },
    });
    expect(JSON.stringify(reports[0]?.report)).not.toContain("admin-token");
  });

  it("refuses to overwrite an existing dry-run report artifact before preflight", async () => {
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const reports: {
      readonly filePath: string;
      readonly report: CaptureControlRegistrationReport;
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(runRegisterCaptureControlSource({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_CAPTURE_CONTROL_DRY_RUN: "true",
        CAPTURE_CONTROL_REPORT_FILE: "capture-control-report.json",
      },
      fetchImpl,
      log: () => undefined,
      reportFileExists: () => true,
      writeReport: (filePath, report) => {
        reports.push({ filePath, report });
      },
    })).rejects.toThrow(
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_CAPTURE_CONTROL_REPORT=true",
    );
    expect(calls).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("overwrites an existing dry-run report artifact only with the explicit overwrite flag", async () => {
    const payload = loadCaptureControlSourcePayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const reports: {
      readonly filePath: string;
      readonly report: CaptureControlRegistrationReport;
      readonly allowOverwrite: boolean;
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterCaptureControlSource({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_CAPTURE_CONTROL_DRY_RUN: "true",
        VENVIEWER_OVERWRITE_CAPTURE_CONTROL_REPORT: "true",
        CAPTURE_CONTROL_REPORT_FILE: "capture-control-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:05:00.000Z"),
      reportFileExists: () => true,
      writeReport: (filePath, report, options) => {
        reports.push({ filePath, report, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.allowOverwrite).toBe(true);
    expect(reports[0]?.report.generatedAt).toBe("2026-06-16T12:05:00.000Z");
  });

  it("fails before POST when the payload runtime package is not current", async () => {
    const payload = loadCaptureControlSourcePayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({
          data: latestRuntimePackageForPayload(payload, "10000000-0000-4000-8000-000000000011"),
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Refusing to register drifted package-scoped evidence before POST",
    );
    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
  });

  it("allows runtime package drift only when explicitly requested", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const roomStatus = roomStatusForRegistration(registrationResponse);
    const calls: {
      readonly input: string;
      readonly init: Parameters<CaptureControlFetch>[1];
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({
          data: latestRuntimePackageForPayload(payload, "10000000-0000-4000-8000-000000000011"),
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [roomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    const verification = await registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      allowRuntimePackageDrift: true,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      "http://localhost:3001/admin/assets/register-capture-control-source",
      "http://localhost:3001/admin/assets/capture-control-sources?venue=trades-hall&room=reception-room&runtimePackageId=71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      "http://localhost:3001/admin/assets/rooms?venue=trades-hall",
    ]);
    expect(verification.registration.runtimePackageId).toBe(payload.runtimePackageId);
  });

  it("fails verification when the source cannot be read back after registration", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Capture-control source readback did not include persisted row 10000000-0000-4000-8000-000000000009",
    );
  });

  it("fails verification when readback only includes a different persisted row for the same source", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const staleMatchingSource: CaptureControlSourceRegistration = {
      ...registrationResponse,
      id: "10000000-0000-4000-8000-000000000099",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    };
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [staleMatchingSource] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Capture-control source readback did not include persisted row 10000000-0000-4000-8000-000000000009",
    );
  });

  it("fails verification when room-status readback points at a different persisted source row", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const mismatchedRoomStatus: RoomAssetStatus = {
      ...roomStatusForRegistration(registrationResponse),
      latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000099",
    };
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [mismatchedRoomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Room asset status readback did not surface persisted row 10000000-0000-4000-8000-000000000009",
    );
  });

  it("fails verification when room-status source class readback drifts", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const mismatchedRoomStatus: RoomAssetStatus = {
      ...roomStatusForRegistration(registrationResponse),
      latestCaptureControlSourceClass: "manual_landmarks",
    };
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [mismatchedRoomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Room asset status readback reported source class manual_landmarks",
    );
  });

  it("fails verification when room-status QA readback drifts", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const mismatchedRoomStatus: RoomAssetStatus = {
      ...roomStatusForRegistration(registrationResponse),
      latestCaptureControlQaStatus: "accepted",
    };
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [mismatchedRoomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Room asset status readback reported QA status accepted",
    );
  });

  it("fails verification when room-status readback marks the source stale by default", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const staleRoomStatus = roomStatusForRegistration(registrationResponse, {
      freshnessStatus: "stale_for_runtime_package",
      activeStalenessTriggers: ["runtime_package_changed"],
    });
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [staleRoomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await expect(registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "stale_for_runtime_package with active stale triggers runtime_package_changed",
    );
  });

  it("allows stale room-status readback only when explicitly requested", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const staleRoomStatus = roomStatusForRegistration(registrationResponse, {
      freshnessStatus: "stale_for_runtime_package",
      activeStalenessTriggers: ["runtime_package_changed"],
    });
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [staleRoomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    const verification = await registerAndVerifyCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      allowStaleReadback: true,
      fetchImpl,
    });

    expect(verification.roomStatus.captureControlFreshnessStatus).toBe("stale_for_runtime_package");
    expect(verification.roomStatus.latestCaptureControlActiveStalenessTriggers).toEqual([
      "runtime_package_changed",
    ]);
  });

  it("writes a registered report after verified readback", async () => {
    const payload = loadCaptureControlSourcePayload();
    const registrationResponse = registrationForPayload(payload);
    const roomStatus = roomStatusForRegistration(registrationResponse);
    const reports: {
      readonly filePath: string;
      readonly report: CaptureControlRegistrationReport;
    }[] = [];
    const fetchImpl: CaptureControlFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourceEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === captureControlSourcesEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === roomAssetStatusesEndpoint("http://localhost:3001", payload.venueSlug) && init.method === "GET") {
        return new Response(JSON.stringify({ data: [roomStatus] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await runRegisterCaptureControlSource({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_ADMIN_BEARER_TOKEN: "admin-token",
        CAPTURE_CONTROL_REPORT_FILE: "capture-control-registration-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:30:00.000Z"),
      writeReport: (filePath, report) => {
        reports.push({ filePath, report });
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.capture-control-registration-report.v0",
      generatedAt: "2026-06-16T12:30:00.000Z",
      mode: "registered",
      preflight: {
        runtimePackageMatchesLatest: true,
      },
      registration: {
        captureControlSourceId: "10000000-0000-4000-8000-000000000009",
        sourceId: "reception-room-approximate-view-transform-v0",
        qaStatus: "requires_human_review",
      },
      roomStatus: {
        latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000009",
        latestCaptureControlSourceId: "reception-room-approximate-view-transform-v0",
        latestCaptureControlSourceClass: "artist_blender_alignment_refs",
        latestCaptureControlPoseAuthorityLevel: "visual_alignment_only",
        latestCaptureControlQaStatus: "requires_human_review",
        captureControlStatus: "source_registered",
        captureControlFreshnessStatus: "current_for_runtime_package",
        activeStalenessTriggers: [],
        captureControlAuthoritySafeCopy: "visual-only alignment source recorded; not measurement control",
      },
      guardrails: {
        signedTransformCreated: false,
        publicExposureChanged: false,
      },
    });
    expect(JSON.stringify(reports[0]?.report)).not.toContain("admin-token");
  });

  it("reports API registration failures with status and response body", async () => {
    const payload = loadCaptureControlSourcePayload();
    const fetchImpl: CaptureControlFetch = () =>
      new Response(JSON.stringify({
        error: "Runtime package not found",
        code: "RUNTIME_PACKAGE_NOT_FOUND",
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await expect(registerCaptureControlSource({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Capture-control source registration failed with HTTP 404",
    );
  });
});
