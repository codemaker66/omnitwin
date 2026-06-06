import { describe, it, expect } from "vitest";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
  configurations,
  placedObjects,
  enquiries,
  enquiryStatusHistory,
  photoReferences,
  pricingRules,
  files,
  referenceLoadouts,
  referencePhotos,
  guestLeads,
  captureSessions,
  assetVersions,
  roomManifests,
  runtimePackages,
  processingJobs,
} from "../db/schema.js";
import { getTableColumns } from "drizzle-orm";

// ---------------------------------------------------------------------------
// schema.ts — verify all table definitions export correctly
// ---------------------------------------------------------------------------

describe("venues table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(venues);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.address).toBeDefined();
    expect(cols.logoUrl).toBeDefined();
    expect(cols.brandColour).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("spaces table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(spaces);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.lengthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.floorPlanOutline).toBeDefined();
    expect(cols.sortOrder).toBeDefined();
  });
});

describe("users table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(users);
    expect(cols.id).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.clerkId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.role).toBeDefined();
    expect(cols.venueId).toBeDefined();
  });
});

describe("assetDefinitions table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(assetDefinitions);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.category).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.depthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.seatCount).toBeDefined();
    expect(cols.collisionType).toBeDefined();
  });
});

describe("configurations table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(configurations);
    expect(cols.id).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.layoutStyle).toBeDefined();
    expect(cols.guestCount).toBeDefined();
    expect(cols.isTemplate).toBeDefined();
    expect(cols.visibility).toBeDefined();
  });
});

describe("placedObjects table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(placedObjects);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.assetDefinitionId).toBeDefined();
    expect(cols.positionX).toBeDefined();
    expect(cols.positionY).toBeDefined();
    expect(cols.positionZ).toBeDefined();
    expect(cols.rotationX).toBeDefined();
    expect(cols.rotationY).toBeDefined();
    expect(cols.rotationZ).toBeDefined();
    expect(cols.scale).toBeDefined();
    expect(cols.metadata).toBeDefined();
  });
});

describe("enquiries table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(enquiries);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.preferredDate).toBeDefined();
    expect(cols.eventType).toBeDefined();
    expect(cols.estimatedGuests).toBeDefined();
    expect(cols.message).toBeDefined();
  });
});

describe("photoReferences table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(photoReferences);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.imageUrl).toBeDefined();
    expect(cols.tags).toBeDefined();
    expect(cols.visibility).toBeDefined();
  });
});

describe("pricingRules table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(pricingRules);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.type).toBeDefined();
    expect(cols.amount).toBeDefined();
    expect(cols.currency).toBeDefined();
    expect(cols.minHours).toBeDefined();
    expect(cols.minGuests).toBeDefined();
    expect(cols.tiers).toBeDefined();
    expect(cols.dayOfWeekModifiers).toBeDefined();
    expect(cols.seasonalModifiers).toBeDefined();
    expect(cols.isActive).toBeDefined();
  });
});

describe("table count", () => {
  it("exports the runtime asset registry tables", () => {
    const captureCols = getTableColumns(captureSessions);
    expect(captureCols.venueSlug).toBeDefined();
    expect(captureCols.roomSlug).toBeDefined();
    expect(captureCols.captureSource).toBeDefined();
    expect(captureCols.captureDevice).toBeDefined();
    expect(captureCols.captureDate).toBeDefined();
    expect(captureCols.operatorName).toBeDefined();
    expect(captureCols.sourceProjectName).toBeDefined();
    expect(captureCols.notes).toBeDefined();
    expect(captureCols.status).toBeDefined();
    expect(captureCols.createdAt).toBeDefined();
    expect(captureCols.updatedAt).toBeDefined();

    const assetCols = getTableColumns(assetVersions);
    expect(assetCols.venueSlug).toBeDefined();
    expect(assetCols.roomSlug).toBeDefined();
    expect(assetCols.captureSessionId).toBeDefined();
    expect(assetCols.assetKind).toBeDefined();
    expect(assetCols.sourceType).toBeDefined();
    expect(assetCols.fileName).toBeDefined();
    expect(assetCols.fileExt).toBeDefined();
    expect(assetCols.r2Key).toBeDefined();
    expect(assetCols.externalUrl).toBeDefined();
    expect(assetCols.mimeType).toBeDefined();
    expect(assetCols.sha256).toBeDefined();
    expect(assetCols.sizeBytes).toBeDefined();
    expect(assetCols.evidenceStatus).toBeDefined();
    expect(assetCols.runtimeStatus).toBeDefined();
    expect(assetCols.notes).toBeDefined();

    const roomCols = getTableColumns(roomManifests);
    expect(roomCols.venueSlug).toBeDefined();
    expect(roomCols.roomSlug).toBeDefined();
    expect(roomCols.displayName).toBeDefined();
    expect(roomCols.matterportMasterReference).toBeDefined();
    expect(roomCols.alignmentStatus).toBeDefined();
    expect(roomCols.primaryCaptureSource).toBeDefined();
    expect(roomCols.notes).toBeDefined();

    const packageCols = getTableColumns(runtimePackages);
    expect(packageCols.venueSlug).toBeDefined();
    expect(packageCols.roomSlug).toBeDefined();
    expect(packageCols.primaryVisualAssetVersionId).toBeDefined();
    expect(packageCols.semanticMeshAssetVersionId).toBeDefined();
    expect(packageCols.collisionAssetVersionId).toBeDefined();
    expect(packageCols.pointCloudAssetVersionId).toBeDefined();
    expect(packageCols.manifestJson).toBeDefined();
    expect(packageCols.evidenceStatus).toBeDefined();
    expect(packageCols.runtimeStatus).toBeDefined();

    const jobCols = getTableColumns(processingJobs);
    expect(jobCols.venueSlug).toBeDefined();
    expect(jobCols.roomSlug).toBeDefined();
    expect(jobCols.sourceAssetVersionId).toBeDefined();
    expect(jobCols.targetRoomSlug).toBeDefined();
    expect(jobCols.processor).toBeDefined();
    expect(jobCols.machineType).toBeDefined();
    expect(jobCols.requiredRamGb).toBeDefined();
    expect(jobCols.status).toBeDefined();
    expect(jobCols.outputNotes).toBeDefined();
  });

  it("pins the runtime asset migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0024_runtime_assets.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "capture_sessions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "asset_versions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "room_manifests"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "runtime_packages"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "processing_jobs"');
    expect(migration).toContain('"capture_source" IN (');
    expect(migration).toContain('"asset_kind" IN (');
    expect(migration).toContain("internal_ready");
    expect(migration).toContain("point_cloud_asset_version_id");
    expect(migration).toContain('"runtime_status" IN (');
    expect(migration).toContain("runtime_packages_manifest_shape");
    expect(migration).toContain("asset_versions_no_fixture_keys");
    expect(migration).toContain("asset_versions_storage_ref_required");
  });

  it("exports exactly 19 tables", () => {
    const tables = [
      venues, spaces, users, assetDefinitions, configurations,
      placedObjects, enquiries, enquiryStatusHistory, photoReferences,
      pricingRules, files, referenceLoadouts, referencePhotos, guestLeads,
      captureSessions, assetVersions, roomManifests, runtimePackages, processingJobs,
    ];
    expect(tables).toHaveLength(19);
  });
});
