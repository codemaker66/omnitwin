import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type {
  RuntimeTransformArtifactRegistrationReportInspection,
  RuntimeTransformArtifactRegistrationReport,
  RegisterRuntimeTransformArtifactInput,
  RuntimePackage,
  RuntimeTransformArtifact,
} from "@omnitwin/types";
import {
  formatRuntimeTransformArtifactRegistrationReportInspection,
  inspectRuntimeTransformArtifactRegistrationReport,
  latestRuntimePackageEndpoint,
  loadRuntimeTransformArtifactPayload,
  preflightRuntimeTransformArtifactRegistration,
  registerAndVerifyRuntimeTransformArtifact,
  registerRuntimeTransformArtifact,
  runtimeTransformArtifactEndpoint,
  runtimeTransformArtifactsEndpoint,
  runRegisterRuntimeTransformArtifact,
  type RuntimeTransformFetch,
} from "../scripts/register-runtime-transform-artifact.js";

const RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";
const TRANSFORM_ARTIFACT_ID = "reception-room-landmark-solve-v0";
const INSPECTION_CONTEXT = {
  generatedAt: "2026-06-16T12:10:00.000Z",
  inspectedReportFile: "reports/current-runtime-transform-report.json",
} as const;

const transformEvidenceRef = {
  refType: "landmark_set",
  ref: "docs/operations/reception-room-landmarks-v0.json",
  role: "source_landmarks",
} as const;

function validRuntimeTransformPayload(
  overrides: Partial<RegisterRuntimeTransformArtifactInput> = {},
): RegisterRuntimeTransformArtifactInput {
  return {
    runtimePackageId: RUNTIME_PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
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
    ...overrides,
  };
}

function latestRuntimePackageForPayload(
  payload: RegisterRuntimeTransformArtifactInput,
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
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    primaryVisualAssetVersion: null,
    primaryVisualAssetUrl: null,
    visualAssetUrls: [],
  };
}

function registrationForPayload(
  payload: RegisterRuntimeTransformArtifactInput,
): RuntimeTransformArtifact {
  return {
    id: "10000000-0000-4000-8000-000000000021",
    runtimePackageId: payload.runtimePackageId,
    venueSlug: payload.venueSlug,
    roomSlug: payload.roomSlug,
    transformArtifactId: payload.transformArtifact.id,
    transformArtifact: payload.transformArtifact,
    reviewNote: payload.reviewNote ?? null,
    registeredBy: "10000000-0000-4000-8000-000000000007",
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
  };
}

function dryRunReportForPayload(
  payload: RegisterRuntimeTransformArtifactInput,
  options: {
    readonly latestRuntimePackageId?: string | null;
    readonly latestRuntimePackageRuntimeStatus?: RuntimePackage["runtimeStatus"] | null;
    readonly latestRuntimePackageEvidenceStatus?: RuntimePackage["evidenceStatus"] | null;
    readonly runtimePackageDriftAllowed?: boolean;
  } = {},
): RuntimeTransformArtifactRegistrationReport {
  const latestRuntimePackageId = options.latestRuntimePackageId === undefined
    ? payload.runtimePackageId
    : options.latestRuntimePackageId;
  const latestRuntimePackageRuntimeStatus = options.latestRuntimePackageRuntimeStatus === undefined
    ? latestRuntimePackageId === null ? null : "internal_ready"
    : options.latestRuntimePackageRuntimeStatus;
  const latestRuntimePackageEvidenceStatus = options.latestRuntimePackageEvidenceStatus === undefined
    ? latestRuntimePackageId === null ? null : "machine_checked"
    : options.latestRuntimePackageEvidenceStatus;
  const runtimePackageDriftAllowed = options.runtimePackageDriftAllowed ?? false;
  const reviewerRole = payload.transformArtifact.reviewer.role;
  if (reviewerRole === undefined) {
    throw new Error("Expected transform test fixture reviewer role.");
  }

  return {
    schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "dry_run",
    apiUrl: "http://localhost:3001",
    payloadFile: "runtime-transform-artifact.json",
    payload: {
      venueSlug: payload.venueSlug,
      roomSlug: payload.roomSlug,
      runtimePackageId: payload.runtimePackageId,
      transformArtifactId: payload.transformArtifact.id,
      sourceFrame: payload.transformArtifact.sourceFrame,
      targetFrame: payload.transformArtifact.targetFrame,
      alignmentMethod: payload.transformArtifact.alignmentMethod,
      provenanceState: payload.transformArtifact.provenance.state,
      residualRmseM: payload.transformArtifact.residualRmseM,
      landmarkCount: payload.transformArtifact.landmarks.length,
      reviewerId: payload.transformArtifact.reviewer.id,
      reviewerRole,
    },
    preflight: {
      payloadRuntimePackageId: payload.runtimePackageId,
      latestRuntimePackageId,
      latestRuntimePackageRuntimeStatus,
      latestRuntimePackageEvidenceStatus,
      runtimePackageMatchesLatest: latestRuntimePackageId === payload.runtimePackageId,
      runtimePackageDriftAllowed,
    },
    registration: null,
    guardrails: {
      runtimePackageDriftAllowed,
      runtimeQaRecordChanged: false,
      captureControlSourceChanged: false,
      publicExposureChanged: false,
    },
  };
}

function registeredReportForPayload(
  payload: RegisterRuntimeTransformArtifactInput,
): RuntimeTransformArtifactRegistrationReport {
  const registration = registrationForPayload(payload);
  return {
    ...dryRunReportForPayload(payload),
    mode: "registered",
    registration: {
      runtimeTransformArtifactRowId: registration.id,
      transformArtifactId: registration.transformArtifactId,
      registeredBy: registration.registeredBy,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
    },
  };
}

describe("register-runtime-transform-artifact script", () => {
  it("loads and validates an explicit signed transform payload file", () => {
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(validRuntimeTransformPayload())}\n`, "utf-8");

    const payload = loadRuntimeTransformArtifactPayload(filePath);

    expect(payload.runtimePackageId).toBe(RUNTIME_PACKAGE_ID);
    expect(payload.transformArtifact.id).toBe(TRANSFORM_ARTIFACT_ID);
    expect(payload.transformArtifact.alignmentMethod).toBe("landmark_solve");
  });

  it("rejects visual-only transform payloads before any HTTP call", () => {
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "visual-transform-artifact.json");
    writeFileSync(
      filePath,
      `${JSON.stringify(validRuntimeTransformPayload({
        transformArtifact: {
          ...validRuntimeTransformPayload().transformArtifact,
          alignmentMethod: "visual_alignment",
          residualRmseM: null,
          landmarks: [],
        },
      }))}\n`,
      "utf-8",
    );

    expect(() => loadRuntimeTransformArtifactPayload(filePath)).toThrow(
      "Signed runtime transforms cannot use visual-only or unconstrained alignment methods",
    );
  });

  it("inspects a current dry-run report as ready for live signed-transform registration", () => {
    const payload = validRuntimeTransformPayload();

    const inspection = inspectRuntimeTransformArtifactRegistrationReport(
      dryRunReportForPayload(payload),
      INSPECTION_CONTEXT,
    );

    expect(inspection).toMatchObject({
      status: "ready_for_live_transform_registration",
      liveTransformRegistrationReady: true,
      mode: "dry_run",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifactId: TRANSFORM_ARTIFACT_ID,
      blockers: [],
    });
    expect(inspection.messages).toContain(
      "Dry-run report is current for live signed-transform registration preflight.",
    );
    expect(formatRuntimeTransformArtifactRegistrationReportInspection(inspection)).toContain(
      "Runtime transform report inspection: ready_for_live_transform_registration.",
    );
  });

  it("blocks drift-override dry-run reports from live signed-transform readiness", () => {
    const payload = validRuntimeTransformPayload();

    const inspection = inspectRuntimeTransformArtifactRegistrationReport(
      dryRunReportForPayload(payload, {
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageDriftAllowed: true,
      }),
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("not_ready_for_live_transform_registration");
    expect(inspection.liveTransformRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Payload runtime package is not the latest loadable runtime package.",
      "Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    ]);
  });

  it("treats registered transform reports as audit evidence, not authorization for another POST", () => {
    const payload = validRuntimeTransformPayload();

    const inspection = inspectRuntimeTransformArtifactRegistrationReport(
      registeredReportForPayload(payload),
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("registered_transform_report_verified");
    expect(inspection.liveTransformRegistrationReady).toBe(false);
    expect(inspection.blockers).toEqual([
      "Report already records a live signed-transform registration; use it as audit evidence, not authorization for another POST.",
    ]);
  });

  it("returns invalid_report for schema-invalid transform report inspection input", () => {
    const inspection = inspectRuntimeTransformArtifactRegistrationReport(
      {
        schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
        mode: "dry_run",
      },
      INSPECTION_CONTEXT,
    );

    expect(inspection.status).toBe("invalid_report");
    expect(inspection.liveTransformRegistrationReady).toBe(false);
    expect(inspection.blockers).toContain("generatedAt: Required");
    expect(inspection.messages).toEqual([
      "Report failed RuntimeTransformArtifactRegistrationReportSchema validation.",
    ]);
  });

  it("preflights the latest loadable runtime package without posting", async () => {
    const payload = validRuntimeTransformPayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    const preflight = await preflightRuntimeTransformArtifactRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(preflight.latestRuntimePackage?.id).toBe(payload.runtimePackageId);
    expect(preflight.runtimePackageDriftAllowed).toBe(false);
  });

  it("fails before POST when the payload runtime package is not current", async () => {
    const payload = validRuntimeTransformPayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
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

    await expect(preflightRuntimeTransformArtifactRegistration({
      apiUrl: "http://localhost:3001",
      bearerToken: "",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Refusing to register drifted signed transform evidence before POST",
    );
    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
  });

  it("posts the validated signed transform payload to the admin route", async () => {
    const payload = validRuntimeTransformPayload();
    const registrationResponse = registrationForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ data: registrationResponse }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    const registration = await registerRuntimeTransformArtifact({
      apiUrl: "http://localhost:3001/",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(runtimeTransformArtifactEndpoint("http://localhost:3001/")).toBe(
      "http://localhost:3001/admin/assets/register-runtime-transform-artifact",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("http://localhost:3001/admin/assets/register-runtime-transform-artifact");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers.authorization).toBe("Bearer admin-token");
    expect(JSON.parse(calls[0]?.init.body ?? "{}") as unknown).toEqual(payload);
    expect(registration.transformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
  });

  it("posts and verifies readback through the runtime-transform-artifacts route", async () => {
    const payload = validRuntimeTransformPayload();
    const registrationResponse = registrationForPayload(payload);
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeTransformArtifactEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        input === runtimeTransformArtifactsEndpoint("http://localhost:3001", payload.runtimePackageId) &&
        init.method === "GET"
      ) {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    const verification = await registerAndVerifyRuntimeTransformArtifact({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
      "http://localhost:3001/admin/assets/register-runtime-transform-artifact",
      `http://localhost:3001/admin/assets/runtime-transform-artifacts?runtimePackageId=${RUNTIME_PACKAGE_ID}`,
    ]);
    expect(verification.persistedArtifact.id).toBe(registrationResponse.id);
  });

  it("fails verification when readback omits the persisted row", async () => {
    const payload = validRuntimeTransformPayload();
    const registrationResponse = registrationForPayload(payload);
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeTransformArtifactEndpoint("http://localhost:3001") && init.method === "POST") {
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

    await expect(registerAndVerifyRuntimeTransformArtifact({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Runtime transform artifact readback did not include persisted row",
    );
  });

  it("writes a registered transform report after verified readback", async () => {
    const payload = validRuntimeTransformPayload();
    const registrationResponse = registrationForPayload(payload);
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const reports: {
      readonly filePath: string;
      readonly report: RuntimeTransformArtifactRegistrationReport;
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (input === runtimeTransformArtifactEndpoint("http://localhost:3001") && init.method === "POST") {
        return new Response(JSON.stringify({ data: registrationResponse }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        input === runtimeTransformArtifactsEndpoint("http://localhost:3001", payload.runtimePackageId) &&
        init.method === "GET"
      ) {
        return new Response(JSON.stringify({ data: [registrationResponse] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected script request" }), { status: 500 });
    };

    await runRegisterRuntimeTransformArtifact({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_ADMIN_BEARER_TOKEN: "admin-token",
        RUNTIME_TRANSFORM_ARTIFACT_FILE: filePath,
        RUNTIME_TRANSFORM_REPORT_FILE: "runtime-transform-registration-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:30:00.000Z"),
      writeReport: (reportFile, report) => {
        reports.push({ filePath: reportFile, report });
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
      generatedAt: "2026-06-16T12:30:00.000Z",
      mode: "registered",
      registration: {
        runtimeTransformArtifactRowId: "10000000-0000-4000-8000-000000000021",
        transformArtifactId: TRANSFORM_ARTIFACT_ID,
      },
      guardrails: {
        runtimeQaRecordChanged: false,
        captureControlSourceChanged: false,
        publicExposureChanged: false,
      },
    });
    expect(JSON.stringify(reports[0]?.report)).not.toContain("admin-token");
  });

  it("runs dry-run preflight without requiring an admin token or posting", async () => {
    const payload = validRuntimeTransformPayload();
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const messages: string[] = [];
    const reports: {
      readonly filePath: string;
      readonly report: RuntimeTransformArtifactRegistrationReport;
      readonly allowOverwrite: boolean;
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterRuntimeTransformArtifact({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN: "true",
        RUNTIME_TRANSFORM_ARTIFACT_FILE: filePath,
        RUNTIME_TRANSFORM_REPORT_FILE: "runtime-transform-report.json",
      },
      fetchImpl,
      log: (message) => {
        messages.push(message);
      },
      now: () => new Date("2026-06-16T12:00:00.000Z"),
      writeReport: (reportFile, report, options) => {
        reports.push({ filePath: reportFile, report, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(calls.map((call) => call.input)).toEqual([
      "http://localhost:3001/assets/runtime-packages/latest?venue=trades-hall&room=reception-room",
    ]);
    expect(reports.map((report) => report.filePath.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/runtime-transform-report.json"),
    ]);
    expect(reports[0]?.report).toMatchObject({
      schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
      generatedAt: "2026-06-16T12:00:00.000Z",
      mode: "dry_run",
      payload: {
        venueSlug: "trades-hall",
        roomSlug: "reception-room",
        runtimePackageId: RUNTIME_PACKAGE_ID,
        transformArtifactId: TRANSFORM_ARTIFACT_ID,
        alignmentMethod: "landmark_solve",
      },
      preflight: {
        latestRuntimePackageId: RUNTIME_PACKAGE_ID,
        runtimePackageMatchesLatest: true,
        runtimePackageDriftAllowed: false,
      },
      registration: null,
      guardrails: {
        runtimeQaRecordChanged: false,
        captureControlSourceChanged: false,
        publicExposureChanged: false,
      },
    });
    expect(reports[0]?.allowOverwrite).toBe(false);
    expect(messages).toEqual([
      "Dry run only: validated signed transform artifact reception-room-landmark-solve-v0 for trades-hall/reception-room; no POST was sent.",
      "Runtime package preflight: payload 71687e9e-c23d-4f51-b3dd-a6a82c97978d; latest loadable 71687e9e-c23d-4f51-b3dd-a6a82c97978d; drift override disabled.",
    ]);
  });

  it("refuses to overwrite an existing transform report before preflight", async () => {
    const payload = validRuntimeTransformPayload();
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const reports: RuntimeTransformArtifactRegistrationReport[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Unexpected preflight request" }), { status: 500 });
    };

    await expect(runRegisterRuntimeTransformArtifact({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN: "true",
        RUNTIME_TRANSFORM_ARTIFACT_FILE: filePath,
        RUNTIME_TRANSFORM_REPORT_FILE: "runtime-transform-report.json",
      },
      fetchImpl,
      log: () => undefined,
      reportFileExists: () => true,
      writeReport: (_reportFile, report) => {
        reports.push(report);
      },
    })).rejects.toThrow(
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_REPORT=true",
    );

    expect(calls).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("overwrites an existing transform report only with the explicit report overwrite flag", async () => {
    const payload = validRuntimeTransformPayload();
    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    const reports: {
      readonly report: RuntimeTransformArtifactRegistrationReport;
      readonly allowOverwrite: boolean;
    }[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      if (input === latestRuntimePackageEndpoint("http://localhost:3001", payload) && init.method === "GET") {
        return new Response(JSON.stringify({ data: latestRuntimePackageForPayload(payload) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Unexpected mutation request" }), { status: 500 });
    };

    await runRegisterRuntimeTransformArtifact({
      env: {
        VENVIEWER_API_URL: "http://localhost:3001",
        VENVIEWER_RUNTIME_TRANSFORM_DRY_RUN: "true",
        VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_REPORT: "true",
        RUNTIME_TRANSFORM_ARTIFACT_FILE: filePath,
        RUNTIME_TRANSFORM_REPORT_FILE: "runtime-transform-report.json",
      },
      fetchImpl,
      log: () => undefined,
      now: () => new Date("2026-06-16T12:05:00.000Z"),
      reportFileExists: () => true,
      writeReport: (_reportFile, report, options) => {
        reports.push({ report, allowOverwrite: options.allowOverwrite });
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.allowOverwrite).toBe(true);
    expect(reports[0]?.report.generatedAt).toBe("2026-06-16T12:05:00.000Z");
  });

  it("runs report inspection without loading the transform payload, requiring a token, or calling the API", async () => {
    const payload = validRuntimeTransformPayload();
    const calls: {
      readonly input: string;
      readonly init: Parameters<RuntimeTransformFetch>[1];
    }[] = [];
    const inspectedPaths: string[] = [];
    const inspections: {
      readonly filePath: string;
      readonly inspection: RuntimeTransformArtifactRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];
    const messages: string[] = [];
    const fetchImpl: RuntimeTransformFetch = (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ error: "Inspection mode should not call the API" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    await runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_INSPECT_REPORT_FILE: "reports/current-runtime-transform-report.json",
        RUNTIME_TRANSFORM_INSPECTION_FILE: "reports/current-runtime-transform-inspection.json",
        RUNTIME_TRANSFORM_ARTIFACT_FILE: "missing-runtime-transform-payload.json",
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
      expect.stringContaining("/reports/current-runtime-transform-report.json"),
    ]);
    expect(inspections.map((inspection) => inspection.filePath.replace(/\\/gu, "/"))).toEqual([
      expect.stringContaining("/reports/current-runtime-transform-inspection.json"),
    ]);
    expect(inspections[0]?.inspection).toMatchObject({
      schemaVersion: "venviewer.runtime-transform-artifact-registration-report-inspection.v0",
      generatedAt: "2026-06-16T12:10:00.000Z",
      status: "ready_for_live_transform_registration",
      liveTransformRegistrationReady: true,
      inspectedReportGeneratedAt: "2026-06-16T12:00:00.000Z",
      reportRuntimePackageId: RUNTIME_PACKAGE_ID,
      reportLatestRuntimePackageId: RUNTIME_PACKAGE_ID,
      reportRuntimePackageMatchesLatest: true,
      reportRuntimePackageDriftAllowed: false,
    });
    expect(inspections[0]?.allowOverwrite).toBe(false);
    expect(calls).toEqual([]);
    expect(messages).toContain("Runtime transform report inspection: ready_for_live_transform_registration.");
    expect(messages).toContain(
      "Check: Dry-run report is current for live signed-transform registration preflight.",
    );
  });

  it("refuses to overwrite an existing transform inspection artifact before reading the report", async () => {
    const payload = validRuntimeTransformPayload();
    const inspectedPaths: string[] = [];
    const inspections: RuntimeTransformArtifactRegistrationReportInspection[] = [];

    await expect(runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_INSPECT_REPORT_FILE: "reports/current-runtime-transform-report.json",
        RUNTIME_TRANSFORM_INSPECTION_FILE: "reports/current-runtime-transform-inspection.json",
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
      "Refusing to overwrite evidence artifact without VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_INSPECTION=true",
    );

    expect(inspectedPaths).toEqual([]);
    expect(inspections).toEqual([]);
  });

  it("overwrites an existing transform inspection artifact only with the explicit inspection overwrite flag", async () => {
    const payload = validRuntimeTransformPayload();
    const inspections: {
      readonly inspection: RuntimeTransformArtifactRegistrationReportInspection;
      readonly allowOverwrite: boolean;
    }[] = [];

    await runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_INSPECT_REPORT_FILE: "reports/current-runtime-transform-report.json",
        RUNTIME_TRANSFORM_INSPECTION_FILE: "reports/current-runtime-transform-inspection.json",
        VENVIEWER_OVERWRITE_RUNTIME_TRANSFORM_INSPECTION: "true",
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

  it("requires a report input when a transform inspection artifact output is requested", async () => {
    await expect(runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_INSPECTION_FILE: "reports/current-runtime-transform-inspection.json",
      },
      log: () => undefined,
    })).rejects.toThrow(
      "RUNTIME_TRANSFORM_INSPECTION_FILE requires RUNTIME_TRANSFORM_INSPECT_REPORT_FILE",
    );
  });

  it("fails inspection mode when the transform report is not ready for live registration", async () => {
    const payload = validRuntimeTransformPayload();
    const messages: string[] = [];

    await expect(runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_INSPECT_REPORT_FILE: "reports/drifted-runtime-transform-report.json",
      },
      log: (message) => {
        messages.push(message);
      },
      readReport: () => dryRunReportForPayload(payload, {
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000011",
        runtimePackageDriftAllowed: true,
      }),
    })).rejects.toThrow("is not ready for live registration");

    expect(messages).toContain("Runtime transform report inspection: not_ready_for_live_transform_registration.");
    expect(messages).toContain(
      "Blocker: Runtime-package drift override was enabled; rerun a normal dry-run before live registration.",
    );
  });

  it("requires an explicit payload file and admin token for live registration", async () => {
    await expect(runRegisterRuntimeTransformArtifact({
      env: {},
      log: () => undefined,
    })).rejects.toThrow("RUNTIME_TRANSFORM_ARTIFACT_FILE is required.");

    const dir = mkdtempSync(join(tmpdir(), "venviewer-transform-payload-"));
    const filePath = join(dir, "runtime-transform-artifact.json");
    writeFileSync(filePath, `${JSON.stringify(validRuntimeTransformPayload())}\n`, "utf-8");

    await expect(runRegisterRuntimeTransformArtifact({
      env: {
        RUNTIME_TRANSFORM_ARTIFACT_FILE: filePath,
      },
      log: () => undefined,
    })).rejects.toThrow("VENVIEWER_ADMIN_BEARER_TOKEN is required.");
  });

  it("reports API registration failures with status and response body", async () => {
    const payload = validRuntimeTransformPayload();
    const fetchImpl: RuntimeTransformFetch = () =>
      new Response(JSON.stringify({
        error: "Runtime package not found",
        code: "RUNTIME_PACKAGE_NOT_FOUND",
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await expect(registerRuntimeTransformArtifact({
      apiUrl: "http://localhost:3001",
      bearerToken: "admin-token",
      payload,
      fetchImpl,
    })).rejects.toThrow(
      "Runtime transform artifact registration failed with HTTP 404",
    );
  });
});
