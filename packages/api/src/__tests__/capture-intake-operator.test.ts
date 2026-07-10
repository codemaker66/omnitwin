import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import {
  CAPTURE_INTAKE_SCHEMA_VERSION,
  CAPTURE_STAGE_SCHEMA_VERSION,
  CaptureIntakeOperatorStatusSchema,
  type CaptureCopyPlanEntry,
  type CaptureIntakeInspection,
  type CaptureStageManifest,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import { captureIntakeRoutes } from "../routes/capture-intake.js";
import { loadCaptureIntakeOperatorStatus } from "../services/capture-intake-operator.js";

process.env["NODE_ENV"] = "test";

const FILE_SHA = "a".repeat(64);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function digestPlan(plan: readonly CaptureCopyPlanEntry[]): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

function ledgers(sourceRoot: string): {
  inspection: CaptureIntakeInspection;
  manifest: CaptureStageManifest;
} {
  const copyPlan: CaptureCopyPlanEntry[] = [
    {
      sourceRelativePath: "cloud_0.e57",
      targetRelativePath: "source/e57/cloud_0.e57",
      sizeBytes: 48,
      sha256: FILE_SHA,
      role: "primary_capture",
    },
  ];
  const planSha256 = digestPlan(copyPlan);
  const inspection: CaptureIntakeInspection = {
    schemaVersion: CAPTURE_INTAKE_SCHEMA_VERSION,
    sourceRoot,
    directoryCount: 0,
    fileCount: 1,
    totalBytes: 48,
    hashedFileCount: 1,
    files: [
      {
        relativePath: "cloud_0.e57",
        sizeBytes: 48,
        modifiedAtUtc: "2026-03-01T16:43:25.000Z",
        extension: ".e57",
        signature: {
          format: "e57",
          magicHex: "4153544d2d453537",
          e57Header: {
            versionMajor: 1,
            versionMinor: 0,
            physicalLengthBytes: 48,
            xmlPhysicalOffsetBytes: 0,
            xmlLogicalLengthBytes: 0,
            pageSizeBytes: 1024,
            fileLengthMatchesHeader: true,
          },
        },
        sha256: FILE_SHA,
        classification: {
          role: "primary_capture",
          disposition: "stage",
          confidence: "high",
          evidence: ["astm_e57_signature"],
        },
      },
    ],
    copyPlan,
    duplicateGroups: [],
    planSha256,
  };
  return {
    inspection,
    manifest: {
      schemaVersion: CAPTURE_STAGE_SCHEMA_VERSION,
      sourceRoot,
      planSha256,
      fileCount: 1,
      totalBytes: 48,
      files: copyPlan,
    },
  };
}

async function writeLedgers(): Promise<{
  root: string;
  inspectionPath: string;
  manifestPath: string;
  stagedFilePath: string;
  inspection: CaptureIntakeInspection;
  manifest: CaptureStageManifest;
}> {
  const root = await mkdtemp(join(tmpdir(), "capture-operator-"));
  cleanup.push(root);
  const inspectionPath = join(root, "capture-intake-inspection.json");
  const manifestPath = join(root, "capture-stage-manifest.json");
  const stagedFilePath = join(root, "source", "e57", "cloud_0.e57");
  const values = ledgers("F:\\E57");
  await mkdir(join(root, "source", "e57"), { recursive: true });
  await writeFile(stagedFilePath, Buffer.alloc(48));
  await writeFile(inspectionPath, JSON.stringify(values.inspection));
  await writeFile(manifestPath, JSON.stringify(values.manifest));
  return { root, inspectionPath, manifestPath, stagedFilePath, ...values };
}

describe("loadCaptureIntakeOperatorStatus", () => {
  it("fails closed when inspection is not configured", async () => {
    await expect(loadCaptureIntakeOperatorStatus({})).resolves.toMatchObject({
      status: "unavailable",
      consistencyStatus: "not_checkable",
      qaStatus: "blocked",
      caveats: expect.arrayContaining(["INSPECTION_NOT_CONFIGURED"]),
    });
  });

  it("reports inspected when the valid stage ledger is not configured", async () => {
    const fixture = await writeLedgers();
    await expect(
      loadCaptureIntakeOperatorStatus({ inspectionPath: fixture.inspectionPath }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "inspection_valid",
      qaStatus: "requires_review",
      stageManifest: null,
      roots: null,
    });
  });

  it("stays inspected when a configured stage manifest is unavailable", async () => {
    const fixture = await writeLedgers();
    await expect(
      loadCaptureIntakeOperatorStatus({
        inspectionPath: fixture.inspectionPath,
        stageManifestPath: join(fixture.root, "missing-stage-manifest.json"),
      }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "inspection_valid",
      qaStatus: "requires_review",
      caveats: expect.arrayContaining(["STAGE_MANIFEST_UNAVAILABLE"]),
    });
  });

  it("blocks an invalid stage manifest", async () => {
    const fixture = await writeLedgers();
    await writeFile(fixture.manifestPath, "{not json");
    await expect(
      loadCaptureIntakeOperatorStatus({
        inspectionPath: fixture.inspectionPath,
        stageManifestPath: fixture.manifestPath,
      }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "invalid",
      qaStatus: "blocked",
      caveats: expect.arrayContaining(["STAGE_MANIFEST_INVALID"]),
    });
  });

  it("reports staged only when plan, file list, and byte totals agree", async () => {
    const fixture = await writeLedgers();
    const status = await loadCaptureIntakeOperatorStatus({
      inspectionPath: fixture.inspectionPath,
      stageManifestPath: fixture.manifestPath,
      exposeRoots: true,
    });
    expect(CaptureIntakeOperatorStatusSchema.parse(status)).toMatchObject({
      status: "staged",
      consistencyStatus: "consistent",
      qaStatus: "intake_verified",
      inspection: { plannedFileCount: 1, plannedBytes: 48 },
      stageManifest: { fileCount: 1, totalBytes: 48 },
      roots: { sourceRoot: "F:\\E57", stagingRoot: fixture.root },
    });
  });

  it("downgrades a valid but inconsistent manifest instead of claiming staged", async () => {
    const fixture = await writeLedgers();
    const differentManifest: CaptureStageManifest = {
      ...fixture.manifest,
      files: [{ ...fixture.manifest.files[0]!, sha256: "b".repeat(64) }],
    };
    await writeFile(fixture.manifestPath, JSON.stringify(differentManifest));
    await expect(
      loadCaptureIntakeOperatorStatus({
        inspectionPath: fixture.inspectionPath,
        stageManifestPath: fixture.manifestPath,
      }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "inconsistent",
      qaStatus: "blocked",
      caveats: expect.arrayContaining(["LEDGER_MISMATCH"]),
    });
  });

  it("rejects a stage manifest tied to a different source root", async () => {
    const fixture = await writeLedgers();
    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ ...fixture.manifest, sourceRoot: "G:\\different-capture" }),
    );
    await expect(
      loadCaptureIntakeOperatorStatus({
        inspectionPath: fixture.inspectionPath,
        stageManifestPath: fixture.manifestPath,
      }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "inconsistent",
      qaStatus: "blocked",
    });
  });

  it("downgrades status when a staged file is missing", async () => {
    const fixture = await writeLedgers();
    await rm(fixture.stagedFilePath);
    await expect(
      loadCaptureIntakeOperatorStatus({
        inspectionPath: fixture.inspectionPath,
        stageManifestPath: fixture.manifestPath,
      }),
    ).resolves.toMatchObject({
      status: "inspected",
      consistencyStatus: "inconsistent",
      qaStatus: "blocked",
      caveats: expect.arrayContaining(["STAGED_FILES_MISSING_OR_CHANGED"]),
    });
  });

  it("rejects an inspection whose declared plan digest is not reproducible", async () => {
    const fixture = await writeLedgers();
    await writeFile(
      fixture.inspectionPath,
      JSON.stringify({ ...fixture.inspection, planSha256: "c".repeat(64) }),
    );
    await expect(
      loadCaptureIntakeOperatorStatus({ inspectionPath: fixture.inspectionPath }),
    ).resolves.toMatchObject({
      status: "unavailable",
      consistencyStatus: "invalid",
      qaStatus: "blocked",
    });
  });

  it("treats malformed JSON as invalid evidence", async () => {
    const fixture = await writeLedgers();
    await writeFile(fixture.inspectionPath, "{not json");
    await expect(
      loadCaptureIntakeOperatorStatus({ inspectionPath: fixture.inspectionPath }),
    ).resolves.toMatchObject({
      status: "unavailable",
      consistencyStatus: "invalid",
      caveats: expect.arrayContaining(["INSPECTION_INVALID"]),
    });
  });
});

function authToken(platformRole: "none" | "operator" | "admin"): string {
  return JSON.stringify({
    id: "operator-id",
    email: "operator@example.com",
    name: "Operator",
    role: "admin",
    platformRole,
    venueId: null,
  });
}

async function routeServer(
  inspectionPath: string,
  manifestPath: string,
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(captureIntakeRoutes, {
    inspectionPath,
    stageManifestPath: manifestPath,
  });
  await server.ready();
  return server;
}

describe("GET /admin/capture-intake", () => {
  it("requires authentication and platform-admin authorization", async () => {
    const fixture = await writeLedgers();
    const server = await routeServer(fixture.inspectionPath, fixture.manifestPath);
    try {
      const anonymous = await server.inject({ method: "GET", url: "/admin/capture-intake" });
      expect(anonymous.statusCode).toBe(401);
      const operator = await server.inject({
        method: "GET",
        url: "/admin/capture-intake",
        headers: { authorization: `Bearer ${authToken("operator")}` },
      });
      expect(operator.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns validated status and roots to a platform admin", async () => {
    const fixture = await writeLedgers();
    const server = await routeServer(fixture.inspectionPath, fixture.manifestPath);
    try {
      const response = await server.inject({
        method: "GET",
        url: "/admin/capture-intake",
        headers: { authorization: `Bearer ${authToken("admin")}` },
      });
      expect(response.statusCode).toBe(200);
      const body: unknown = JSON.parse(response.body);
      if (body === null || typeof body !== "object" || !("data" in body)) {
        throw new Error("capture intake response is missing data");
      }
      const status = CaptureIntakeOperatorStatusSchema.parse(body.data);
      expect(status).toMatchObject({
        status: "staged",
        roots: { sourceRoot: "F:\\E57", stagingRoot: fixture.root },
      });
    } finally {
      await server.close();
    }
  });
});
