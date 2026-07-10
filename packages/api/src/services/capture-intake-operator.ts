import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  CaptureIntakeInspectionSchema,
  CaptureIntakeOperatorStatusSchema,
  CaptureStageManifestSchema,
  type CaptureCopyPlanEntry,
  type CaptureIntakeCaveat,
  type CaptureIntakeInspection,
  type CaptureIntakeInspectionSummary,
  type CaptureIntakeOperatorStatus,
  type CaptureIntakeRoots,
  type CaptureIntakeStageSummary,
  type CaptureStageManifest,
} from "@omnitwin/types";

const BASE_CAVEATS = [
  "SOURCE_BYTES_ARE_NOT_RUNTIME_READY",
  "NO_RECONSTRUCTION_QA",
  "NO_SPATIAL_ACCURACY_CERTIFICATION",
  "DERIVED_REFERENCES_EXCLUDED_FROM_TRUTH_INPUTS",
  "STATUS_READ_DOES_NOT_REHASH_STAGED_BYTES",
] as const satisfies readonly CaptureIntakeCaveat[];

export interface CaptureIntakeOperatorConfig {
  readonly inspectionPath?: string;
  readonly stageManifestPath?: string;
  readonly exposeRoots?: boolean;
}

type JsonReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly kind: "unavailable" | "invalid" };

async function readJson(path: string): Promise<JsonReadResult> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  try {
    const value: unknown = JSON.parse(source);
    return { ok: true, value };
  } catch {
    return { ok: false, kind: "invalid" };
  }
}

function planDigest(plan: readonly CaptureCopyPlanEntry[]): string {
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

function inspectionSummary(inspection: CaptureIntakeInspection): CaptureIntakeInspectionSummary {
  return {
    schemaVersion: inspection.schemaVersion,
    planSha256: inspection.planSha256,
    inventoryFileCount: inspection.fileCount,
    inventoryBytes: inspection.totalBytes,
    hashedFileCount: inspection.hashedFileCount,
    plannedFileCount: inspection.copyPlan.length,
    plannedBytes: inspection.copyPlan.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    primaryCaptureFiles: inspection.copyPlan.filter((entry) => entry.role === "primary_capture").length,
    vendorControlFiles: inspection.copyPlan.filter((entry) => entry.role === "vendor_control").length,
    duplicateGroups: inspection.duplicateGroups.length,
  };
}

function stageSummary(manifest: CaptureStageManifest): CaptureIntakeStageSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    planSha256: manifest.planSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  };
}

function operatorRoots(
  config: CaptureIntakeOperatorConfig,
  sourceRoot: string | null,
): CaptureIntakeRoots | null {
  if (config.exposeRoots !== true) return null;
  return {
    sourceRoot,
    stagingRoot:
      config.stageManifestPath === undefined ? null : dirname(resolve(config.stageManifestPath)),
  };
}

function unavailableStatus(
  config: CaptureIntakeOperatorConfig,
  caveat: CaptureIntakeCaveat,
  invalid: boolean,
): CaptureIntakeOperatorStatus {
  return CaptureIntakeOperatorStatusSchema.parse({
    status: "unavailable",
    consistencyStatus: invalid ? "invalid" : "not_checkable",
    qaStatus: "blocked",
    inspection: null,
    stageManifest: null,
    caveats: [caveat, ...BASE_CAVEATS],
    roots: operatorRoots(config, null),
  });
}

function inspectedStatus(
  config: CaptureIntakeOperatorConfig,
  inspection: CaptureIntakeInspection,
  options: {
    readonly consistencyStatus: "inspection_valid" | "inconsistent" | "invalid";
    readonly qaStatus: "requires_review" | "blocked";
    readonly caveat: CaptureIntakeCaveat;
    readonly manifest: CaptureStageManifest | null;
  },
): CaptureIntakeOperatorStatus {
  return CaptureIntakeOperatorStatusSchema.parse({
    status: "inspected",
    consistencyStatus: options.consistencyStatus,
    qaStatus: options.qaStatus,
    inspection: inspectionSummary(inspection),
    stageManifest: options.manifest === null ? null : stageSummary(options.manifest),
    caveats: [options.caveat, ...BASE_CAVEATS],
    roots: operatorRoots(config, inspection.sourceRoot),
  });
}

function manifestsMatch(
  inspection: CaptureIntakeInspection,
  manifest: CaptureStageManifest,
): boolean {
  const plannedBytes = inspection.copyPlan.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return (
    manifest.sourceRoot === inspection.sourceRoot &&
    manifest.planSha256 === inspection.planSha256 &&
    manifest.fileCount === inspection.copyPlan.length &&
    manifest.totalBytes === plannedBytes &&
    JSON.stringify(manifest.files) === JSON.stringify(inspection.copyPlan)
  );
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

async function stagedFilesMatch(
  stageManifestPath: string,
  manifest: CaptureStageManifest,
): Promise<boolean> {
  let stageRoot: string;
  try {
    stageRoot = await realpath(dirname(resolve(stageManifestPath)));
  } catch {
    return false;
  }
  for (const entry of manifest.files) {
    const candidate = resolve(stageRoot, ...entry.targetRelativePath.split("/"));
    if (!isWithin(stageRoot, candidate) || candidate === stageRoot) return false;
    try {
      const [metadata, canonicalFile] = await Promise.all([lstat(candidate), realpath(candidate)]);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.size !== entry.sizeBytes ||
        !isWithin(stageRoot, canonicalFile)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function stagedStatus(
  config: CaptureIntakeOperatorConfig,
  inspection: CaptureIntakeInspection,
  manifest: CaptureStageManifest,
): CaptureIntakeOperatorStatus {
  return CaptureIntakeOperatorStatusSchema.parse({
    status: "staged",
    consistencyStatus: "consistent",
    qaStatus: "intake_verified",
    inspection: inspectionSummary(inspection),
    stageManifest: stageSummary(manifest),
    caveats: BASE_CAVEATS,
    roots: operatorRoots(config, inspection.sourceRoot),
  });
}

async function loadInspection(
  config: CaptureIntakeOperatorConfig,
): Promise<CaptureIntakeInspection | CaptureIntakeOperatorStatus> {
  if (config.inspectionPath === undefined) {
    return unavailableStatus(config, "INSPECTION_NOT_CONFIGURED", false);
  }
  const raw = await readJson(config.inspectionPath);
  if (!raw.ok) {
    const caveat = raw.kind === "invalid" ? "INSPECTION_INVALID" : "INSPECTION_UNAVAILABLE";
    return unavailableStatus(config, caveat, raw.kind === "invalid");
  }
  const parsed = CaptureIntakeInspectionSchema.safeParse(raw.value);
  if (!parsed.success || planDigest(parsed.data.copyPlan) !== parsed.data.planSha256) {
    return unavailableStatus(config, "INSPECTION_INVALID", true);
  }
  return parsed.data;
}

export async function loadCaptureIntakeOperatorStatus(
  config: CaptureIntakeOperatorConfig,
): Promise<CaptureIntakeOperatorStatus> {
  const inspection = await loadInspection(config);
  if ("status" in inspection) return inspection;
  if (config.stageManifestPath === undefined) {
    return inspectedStatus(config, inspection, {
      consistencyStatus: "inspection_valid",
      qaStatus: "requires_review",
      caveat: "STAGE_MANIFEST_NOT_CONFIGURED",
      manifest: null,
    });
  }
  const rawManifest = await readJson(config.stageManifestPath);
  if (!rawManifest.ok) {
    return inspectedStatus(config, inspection, {
      consistencyStatus: rawManifest.kind === "invalid" ? "invalid" : "inspection_valid",
      qaStatus: rawManifest.kind === "invalid" ? "blocked" : "requires_review",
      caveat: rawManifest.kind === "invalid" ? "STAGE_MANIFEST_INVALID" : "STAGE_MANIFEST_UNAVAILABLE",
      manifest: null,
    });
  }
  const parsedManifest = CaptureStageManifestSchema.safeParse(rawManifest.value);
  if (!parsedManifest.success) {
    return inspectedStatus(config, inspection, {
      consistencyStatus: "invalid",
      qaStatus: "blocked",
      caveat: "STAGE_MANIFEST_INVALID",
      manifest: null,
    });
  }
  if (!manifestsMatch(inspection, parsedManifest.data)) {
    return inspectedStatus(config, inspection, {
      consistencyStatus: "inconsistent",
      qaStatus: "blocked",
      caveat: "LEDGER_MISMATCH",
      manifest: parsedManifest.data,
    });
  }
  if (!(await stagedFilesMatch(config.stageManifestPath, parsedManifest.data))) {
    return inspectedStatus(config, inspection, {
      consistencyStatus: "inconsistent",
      qaStatus: "blocked",
      caveat: "STAGED_FILES_MISSING_OR_CHANGED",
      manifest: parsedManifest.data,
    });
  }
  return stagedStatus(config, inspection, parsedManifest.data);
}
