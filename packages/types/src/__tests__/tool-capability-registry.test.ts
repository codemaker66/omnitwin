import { describe, expect, it } from "vitest";
import {
  ARTIFACT_EXPORT_SAFETY_STATES,
  ArtifactExportSafetySchema,
} from "../artifact-manifest.js";
import {
  TOOL_CAPABILITY_EVIDENCE_REF_TYPES,
  TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES,
  TOOL_CAPABILITY_PURPOSES,
  TOOL_CAPABILITY_REGISTRY_SCHEMA_VERSION,
  TOOL_CAPABILITY_STATUSES,
  TOOL_CAPABILITY_TOOL_IDS,
  TOOL_CAPABILITY_USAGE_MODES,
  ToolCapabilityEvidenceRefTypeSchema,
  ToolCapabilityLicenseReviewStatusSchema,
  ToolCapabilityPurposeSchema,
  ToolCapabilityRecordSchema,
  ToolCapabilityStatusSchema,
  ToolCapabilityToolIdSchema,
  ToolCapabilityUsageModeSchema,
  type ToolCapabilityRecord,
} from "../tool-capability-registry.js";

const SHA256_A = "a".repeat(64);

const VERIFIED_SPARK_RECORD: ToolCapabilityRecord = {
  schemaVersion: TOOL_CAPABILITY_REGISTRY_SCHEMA_VERSION,
  toolId: "spark",
  displayName: "Spark",
  installedVersion: "2.0.0",
  status: "verified",
  usageMode: "browser_runtime",
  purpose: "splat_runtime_rendering",
  verificationFixtureRef: "fixture_spark_runtime_lazy_chunk_001",
  verifiedAt: "2026-06-07T12:00:00.000Z",
  evidenceRefs: [
    {
      refType: "verification_fixture",
      ref: "packages/web/e2e/splat-fixture.spec.ts",
      contentHash: SHA256_A,
    },
    {
      refType: "installed_package",
      ref: "pnpm-lock.yaml:@sparkjsdev/spark",
    },
  ],
  licenseReviewStatus: "approved",
  licenseReviewRef: "license_review_spark_runtime_001",
  publicExposureAllowed: true,
  notes: ["Verification is scoped to lazy runtime loading, not venue asset accuracy."],
};

describe("Tool Capability Registry", () => {
  it("pins initial tool IDs from STACK-001", () => {
    expect(TOOL_CAPABILITY_TOOL_IDS).toEqual([
      "spark",
      "jupedsim",
      "frosting",
      "milo",
      "rvo2",
      "spz",
      "playcanvas_splat_transform",
      "recast_detour",
      "vadere",
      "pathfinder",
      "massmotion",
      "anylogic",
    ]);

    for (const toolId of TOOL_CAPABILITY_TOOL_IDS) {
      expect(ToolCapabilityToolIdSchema.safeParse(toolId).success).toBe(true);
    }
  });

  it("pins capability statuses without reusing artifact export states", () => {
    expect(TOOL_CAPABILITY_STATUSES).toEqual([
      "verified",
      "plausible",
      "unverified",
      "false",
      "research_only",
    ]);

    for (const status of TOOL_CAPABILITY_STATUSES) {
      expect(ToolCapabilityStatusSchema.safeParse(status).success).toBe(true);
    }

    expect(ToolCapabilityStatusSchema.safeParse("safe_to_export").success).toBe(false);
    expect(ArtifactExportSafetySchema.safeParse("verified").success).toBe(false);
    expect(ARTIFACT_EXPORT_SAFETY_STATES.includes("safe_to_export")).toBe(true);
  });

  it("pins usage modes, purposes, evidence refs, and license statuses", () => {
    expect(TOOL_CAPABILITY_USAGE_MODES).toEqual([
      "browser_runtime",
      "server_runtime",
      "offline_cli",
      "worker_service",
      "diagnostic_tool",
      "research_experiment",
      "benchmark_only",
    ]);

    expect(TOOL_CAPABILITY_PURPOSES).toEqual([
      "splat_runtime_rendering",
      "splat_format_conversion",
      "splat_diagnostic_processing",
      "guest_flow_simulation",
      "route_or_navmesh_research",
      "residual_reconstruction_research",
      "professional_benchmark_comparison",
      "asset_compression",
    ]);

    expect(TOOL_CAPABILITY_EVIDENCE_REF_TYPES).toEqual([
      "verification_fixture",
      "license_review",
      "installed_package",
      "source_repository",
      "test_report",
      "benchmark_report",
      "operator_note",
    ]);

    expect(TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES).toEqual([
      "approved",
      "blocked",
      "research_only",
      "benchmark_only",
      "pending_review",
      "needs_commercial_license",
      "needs_isolation",
    ]);

    for (const usageMode of TOOL_CAPABILITY_USAGE_MODES) {
      expect(ToolCapabilityUsageModeSchema.safeParse(usageMode).success).toBe(true);
    }

    for (const purpose of TOOL_CAPABILITY_PURPOSES) {
      expect(ToolCapabilityPurposeSchema.safeParse(purpose).success).toBe(true);
    }

    for (const evidenceRefType of TOOL_CAPABILITY_EVIDENCE_REF_TYPES) {
      expect(ToolCapabilityEvidenceRefTypeSchema.safeParse(evidenceRefType).success).toBe(true);
    }

    for (const licenseStatus of TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES) {
      expect(ToolCapabilityLicenseReviewStatusSchema.safeParse(licenseStatus).success).toBe(true);
    }
  });

  it("parses a scoped verified capability record with fixture evidence", () => {
    expect(ToolCapabilityRecordSchema.parse(VERIFIED_SPARK_RECORD)).toEqual(VERIFIED_SPARK_RECORD);
  });

  it("does not allow verified status without installed version, fixture, timestamp, and evidence", () => {
    expect(ToolCapabilityRecordSchema.safeParse({
      ...VERIFIED_SPARK_RECORD,
      installedVersion: null,
    }).success).toBe(false);

    expect(ToolCapabilityRecordSchema.safeParse({
      ...VERIFIED_SPARK_RECORD,
      verificationFixtureRef: null,
    }).success).toBe(false);

    expect(ToolCapabilityRecordSchema.safeParse({
      ...VERIFIED_SPARK_RECORD,
      verifiedAt: null,
    }).success).toBe(false);

    expect(ToolCapabilityRecordSchema.safeParse({
      ...VERIFIED_SPARK_RECORD,
      evidenceRefs: VERIFIED_SPARK_RECORD.evidenceRefs.filter(
        (evidenceRef) => evidenceRef.refType !== "verification_fixture",
      ),
    }).success).toBe(false);
  });

  it("blocks public exposure for unverified, false, and research-only capabilities", () => {
    for (const status of ["unverified", "false", "research_only"] as const) {
      expect(ToolCapabilityRecordSchema.safeParse({
        ...VERIFIED_SPARK_RECORD,
        status,
        publicExposureAllowed: true,
      }).success).toBe(false);
    }
  });

  it("blocks public exposure when license review status is not cleared for the scoped use", () => {
    for (const licenseReviewStatus of [
      "blocked",
      "pending_review",
      "research_only",
      "benchmark_only",
      "needs_commercial_license",
    ] as const) {
      expect(ToolCapabilityRecordSchema.safeParse({
        ...VERIFIED_SPARK_RECORD,
        licenseReviewStatus,
        publicExposureAllowed: true,
      }).success).toBe(false);
    }
  });

  it("keeps benchmark simulators from masquerading as native runtime tools", () => {
    const benchmarkRecord: ToolCapabilityRecord = {
      ...VERIFIED_SPARK_RECORD,
      toolId: "anylogic",
      displayName: "AnyLogic",
      installedVersion: null,
      status: "research_only",
      usageMode: "benchmark_only",
      purpose: "professional_benchmark_comparison",
      verificationFixtureRef: null,
      verifiedAt: null,
      evidenceRefs: [
        {
          refType: "operator_note",
          ref: "benchmark_tool_placeholder_pending_license_review",
        },
      ],
      licenseReviewStatus: "needs_commercial_license",
      licenseReviewRef: null,
      publicExposureAllowed: false,
      notes: ["Benchmark-only placeholder; not a Venviewer-native simulator capability."],
    };

    expect(ToolCapabilityRecordSchema.parse(benchmarkRecord)).toEqual(benchmarkRecord);
    expect(ToolCapabilityUsageModeSchema.safeParse("browser_runtime").success).toBe(true);
    expect(benchmarkRecord.usageMode).toBe("benchmark_only");
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      TOOL_CAPABILITY_TOOL_IDS,
      TOOL_CAPABILITY_STATUSES,
      TOOL_CAPABILITY_USAGE_MODES,
      TOOL_CAPABILITY_PURPOSES,
      TOOL_CAPABILITY_EVIDENCE_REF_TYPES,
      TOOL_CAPABILITY_LICENSE_REVIEW_STATUSES,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
