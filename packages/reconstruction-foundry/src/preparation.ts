import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  ReconstructionQaReportSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleaseObjectPathSchema,
  ReconstructionReleaseSha256Schema,
  type ReconstructionQaReport,
  type ReconstructionReleaseManifest,
} from "@omnitwin/types";
import { z } from "zod";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import { assertDisjointOutput, canonicalBundleRoot } from "./path-safety.js";
import { inspectTwinBundle } from "./qa.js";
import { buildPreparedReleaseEvidence } from "./release.js";

export const FOUNDRY_RELEASE_MANIFEST_NAME = "release-manifest.json";
export const FOUNDRY_QA_REPORT_NAME = "qa-report.json";
export const FOUNDRY_PREPARATION_NAME = "foundry-preparation.json";

const FoundryPreparationSchema = z.object({
  schemaVersion: z.literal("venviewer.reconstruction-preparation.v1"),
  sourceBundleRoot: z.string().min(1),
  candidateR2Prefix: ReconstructionReleaseObjectPathSchema,
  candidateManifestR2Key: ReconstructionReleaseObjectPathSchema,
  candidateQaReportR2Key: ReconstructionReleaseObjectPathSchema,
  releaseManifestSha256: ReconstructionReleaseSha256Schema,
  releaseManifestSizeBytes: z.number().int().positive(),
  qaReportFileSha256: ReconstructionReleaseSha256Schema,
  qaReportSizeBytes: z.number().int().positive(),
  releaseDigest: ReconstructionReleaseSha256Schema,
}).strict();
export type FoundryPreparation = z.infer<typeof FoundryPreparationSchema>;

export interface PreparedReconstructionRelease {
  readonly directory: string;
  readonly preparation: FoundryPreparation;
  readonly manifest: ReconstructionReleaseManifest;
  readonly qaReport: ReconstructionQaReport;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function writeImmutable(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path);
    if (existing.equals(bytes)) return;
    throw new FoundryIntegrityError("IMMUTABLE_SIDECAR_CONFLICT", `Refusing to replace a different Foundry sidecar: ${path}`);
  } catch (error: unknown) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
  }

  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.partial`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, path);
    } catch (error: unknown) {
      if (!fileExistsError(error)) throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new FoundryIntegrityError("IMMUTABLE_SIDECAR_CONFLICT", `Concurrent Foundry sidecar conflict: ${path}`);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export function candidatePrefixFor(manifest: ReconstructionReleaseManifest): string {
  return `candidates/${manifest.venueSlug}/${manifest.releaseDigest}`;
}

export async function prepareReconstructionRelease(input: {
  readonly bundleRoot: string;
  readonly outDir: string;
}): Promise<PreparedReconstructionRelease> {
  const sourceBundleRoot = await canonicalBundleRoot(input.bundleRoot);
  const output = await assertDisjointOutput(sourceBundleRoot, input.outDir);
  await mkdir(output, { recursive: true });
  const directory = await realpath(output);
  const qa = await inspectTwinBundle(sourceBundleRoot);
  const evidence = buildPreparedReleaseEvidence(qa);
  const releaseBytes = jsonBytes(evidence.manifest);
  const qaBytes = jsonBytes(evidence.qaReport);
  const candidateR2Prefix = candidatePrefixFor(evidence.manifest);
  const preparation = FoundryPreparationSchema.parse({
    schemaVersion: "venviewer.reconstruction-preparation.v1",
    sourceBundleRoot,
    candidateR2Prefix,
    candidateManifestR2Key: `${candidateR2Prefix}/${FOUNDRY_RELEASE_MANIFEST_NAME}`,
    candidateQaReportR2Key: `${candidateR2Prefix}/${FOUNDRY_QA_REPORT_NAME}`,
    releaseManifestSha256: sha256Bytes(releaseBytes),
    releaseManifestSizeBytes: releaseBytes.length,
    qaReportFileSha256: sha256Bytes(qaBytes),
    qaReportSizeBytes: qaBytes.length,
    releaseDigest: evidence.manifest.releaseDigest,
  });
  await writeImmutable(join(directory, FOUNDRY_RELEASE_MANIFEST_NAME), releaseBytes);
  await writeImmutable(join(directory, FOUNDRY_QA_REPORT_NAME), qaBytes);
  await writeImmutable(join(directory, FOUNDRY_PREPARATION_NAME), jsonBytes(preparation));
  return { directory, preparation, manifest: evidence.manifest, qaReport: evidence.qaReport };
}

export async function loadPreparedReconstructionRelease(
  directoryInput: string,
): Promise<PreparedReconstructionRelease> {
  const directory = resolve(directoryInput);
  const [preparationRaw, manifestRaw, qaRaw] = await Promise.all([
    readFile(join(directory, FOUNDRY_PREPARATION_NAME)),
    readFile(join(directory, FOUNDRY_RELEASE_MANIFEST_NAME)),
    readFile(join(directory, FOUNDRY_QA_REPORT_NAME)),
  ]);
  const preparation = FoundryPreparationSchema.parse(JSON.parse(preparationRaw.toString("utf8")));
  const manifest = ReconstructionReleaseManifestSchema.parse(JSON.parse(manifestRaw.toString("utf8")));
  const qaReport = ReconstructionQaReportSchema.parse(JSON.parse(qaRaw.toString("utf8")));
  if (
    sha256Bytes(manifestRaw) !== preparation.releaseManifestSha256 ||
    manifestRaw.length !== preparation.releaseManifestSizeBytes ||
    sha256Bytes(qaRaw) !== preparation.qaReportFileSha256 ||
    qaRaw.length !== preparation.qaReportSizeBytes ||
    manifest.releaseDigest !== preparation.releaseDigest ||
    candidatePrefixFor(manifest) !== preparation.candidateR2Prefix ||
    qaReport.releaseDigest !== manifest.releaseDigest
  ) {
    throw new FoundryIntegrityError("PREPARATION_DIGEST_MISMATCH", "Prepared Foundry sidecars do not match their immutable preparation record.");
  }
  const sourceBundleRoot = await canonicalBundleRoot(preparation.sourceBundleRoot);
  if (sourceBundleRoot !== preparation.sourceBundleRoot) {
    throw new FoundryIntegrityError("PREPARATION_SOURCE_DRIFT", "Prepared source Twin root no longer resolves to the recorded path.");
  }
  return { directory, preparation, manifest, qaReport };
}

export function sha256JsonFile(value: unknown): string {
  return createHash("sha256").update(jsonBytes(value)).digest("hex");
}
