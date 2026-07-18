import {
  RECONSTRUCTION_QA_CHECK_KEYS,
  RECONSTRUCTION_QA_SCHEMA_VERSION,
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  ReconstructionQaReportSchema,
  ReconstructionReleaseManifestSchema,
  computeReconstructionQaReportDigest,
  computeReconstructionReleaseDigest,
  type ReconstructionQaCheck,
  type ReconstructionQaReport,
  type ReconstructionQaReportMaterial,
  type ReconstructionReleaseFile,
  type ReconstructionReleaseManifest,
} from "@omnitwin/types";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import type { FoundryInventoryFile } from "./inventory.js";
import type { TwinBundleQaResult } from "./qa.js";

export const FOUNDRY_QA_PROFILE_VERSION = "twin-release-qa.v2";
const QA_PROFILE_DOMAIN = "VENVIEWER_RECONSTRUCTION_QA_PROFILE_V2";
const QA_EVIDENCE_DOMAIN = "VENVIEWER_RECONSTRUCTION_QA_EVIDENCE_V1";

export interface PreparedReleaseEvidence {
  readonly manifest: ReconstructionReleaseManifest;
  readonly qaReport: ReconstructionQaReport;
}

function releaseFile(file: FoundryInventoryFile): ReconstructionReleaseFile {
  switch (file.mediaKind) {
    case "manifest":
      return { path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes, mimeType: "application/json", role: "manifest" };
    case "webp":
      return { path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes, mimeType: "image/webp", role: "imagery" };
    case "glb":
      return { path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes, mimeType: "model/gltf-binary", role: "geometry" };
  }
}

function evidence(label: string, sha256: string): ReconstructionQaCheck["evidence"] {
  return [{ label, sha256 }];
}

function groupedEvidenceDigest(
  label: string,
  files: readonly ReconstructionReleaseFile[],
): ReconstructionQaCheck["evidence"] {
  return evidence(label, domainSeparatedSha256(QA_EVIDENCE_DOMAIN, toCanonicalJson(
    files.map((file) => ({ path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes })),
  )));
}

export const FOUNDRY_QA_PROFILE_DIGEST = domainSeparatedSha256(QA_PROFILE_DOMAIN, toCanonicalJson({
  qaProfileVersion: FOUNDRY_QA_PROFILE_VERSION,
  checks: RECONSTRUCTION_QA_CHECK_KEYS,
  twinSchema: "twin/0",
  webpValidation: "full_riff_chunks_and_libvips_pixel_decode_v1",
  glbValidation: "full_chunks_json_scene_mesh_accessors_finite_positions_v1",
  glbVersion: 2,
  glbMaxBytes: 8 * 1024 * 1024,
  glbMaxVertices: 1_000_000,
  glbMaxTriangles: 1_000_000,
  edgeDistanceToleranceM: 0.000_500_001,
  quaternionNormTolerance: 0.02,
}));

export function buildReconstructionReleaseManifest(
  qa: TwinBundleQaResult,
): ReconstructionReleaseManifest {
  const files = qa.inventory.files.map(releaseFile).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const sourceManifest = files.find((file) => file.path === "manifest.json");
  if (sourceManifest === undefined) {
    throw new FoundryIntegrityError("SOURCE_MANIFEST_MISSING", "Release inventory has no source Twin manifest.");
  }
  return ReconstructionReleaseManifestSchema.parse({
    schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
    releaseKind: "venue_twin_v1",
    venueSlug: qa.manifest.venueSlug,
    releaseDigest: computeReconstructionReleaseDigest(files),
    sourceManifestSha256: sourceManifest.sha256,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    generatedAt: qa.manifest.generatedAt,
  });
}

export function buildReconstructionQaReport(
  manifest: ReconstructionReleaseManifest,
): ReconstructionQaReport {
  const sourceManifestEvidence = evidence("source Twin manifest", manifest.sourceManifestSha256);
  const imageFiles = manifest.files.filter((file) => file.role === "imagery");
  const meshFiles = manifest.files.filter((file) => file.role === "geometry");
  const releaseEvidence = evidence("deterministic release inventory", manifest.releaseDigest);
  const imageEvidence = groupedEvidenceDigest("WebP inventory, RIFF structure, dimensions and full decode", imageFiles);
  const meshEvidence = meshFiles.length === 0
    ? sourceManifestEvidence
    : groupedEvidenceDigest("dollhouse glTF scene, mesh, accessor, bounds and budget", meshFiles);
  const checks: ReconstructionQaCheck[] = [
    { checkKey: "manifest_schema", status: "passed", messageKey: "foundry.qa.manifest_schema.passed", evidence: sourceManifestEvidence },
    { checkKey: "exact_file_set", status: "passed", messageKey: "foundry.qa.exact_file_set.passed", evidence: releaseEvidence },
    { checkKey: "content_hashes", status: "passed", messageKey: "foundry.qa.content_hashes.passed", evidence: sourceManifestEvidence },
    { checkKey: "image_dimensions", status: "passed", messageKey: "foundry.qa.image_dimensions.passed", evidence: imageEvidence },
    { checkKey: "mesh_structure", status: "passed", messageKey: "foundry.qa.mesh_structure.passed", evidence: meshEvidence },
    { checkKey: "mesh_budget", status: "passed", messageKey: "foundry.qa.mesh_budget.passed", evidence: meshEvidence },
    { checkKey: "navigation_graph", status: "passed", messageKey: "foundry.qa.navigation_graph.passed", evidence: sourceManifestEvidence },
    { checkKey: "coordinate_frame", status: "passed", messageKey: "foundry.qa.coordinate_frame.passed", evidence: sourceManifestEvidence },
  ];
  const material = {
    schemaVersion: RECONSTRUCTION_QA_SCHEMA_VERSION,
    releaseDigest: manifest.releaseDigest,
    sourceManifestSha256: manifest.sourceManifestSha256,
    qaProfileVersion: FOUNDRY_QA_PROFILE_VERSION,
    qaProfileDigest: FOUNDRY_QA_PROFILE_DIGEST,
    outcome: "passed" as const,
    checks,
  } satisfies ReconstructionQaReportMaterial;
  return ReconstructionQaReportSchema.parse({
    ...material,
    reportDigest: computeReconstructionQaReportDigest(material),
  });
}

export function buildPreparedReleaseEvidence(qa: TwinBundleQaResult): PreparedReleaseEvidence {
  const manifest = buildReconstructionReleaseManifest(qa);
  return { manifest, qaReport: buildReconstructionQaReport(manifest) };
}
