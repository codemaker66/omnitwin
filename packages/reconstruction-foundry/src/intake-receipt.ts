import type { Stats } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  FoundryFileDetectionSchema,
  FoundryFileProbeSchema,
  FoundryRelativePathSchema,
  FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS,
  detectFoundryInputFile,
  type FoundryFileDetection,
  type FoundryFileProbe,
  type FoundryInputType,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_HASH_BUFFER_BYTES,
  FOUNDRY_MAX_HASH_HEAD_BYTES,
  sha256RegularFileWithHead,
  type ExpectedRegularFileIdentity,
} from "./hash.js";
import {
  createUniversalSourceFactsArtifactFromReceipt,
  createUniversalSourceFactsStreamCollector,
  type FoundryUniversalSourceFacts,
  type UniversalSourceFactsFileResult,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  inspectStoredZipSogV2SourceFacts,
  type FoundrySogSourceFactsOutcome,
} from "./sog-source-facts.js";
import type {
  FoundryUniversalSourceFactsV2,
  UniversalSourceFactsV2FileResult,
} from "./source-facts-v2.js";
import type {
  FoundryUniversalSourceFactsV3,
  UniversalSourceFactsV3FileResult,
} from "./source-facts-v3.js";
import type {
  FoundryUniversalSourceFactsV4,
  UniversalSourceFactsV4ReceiptFileIdentity,
  UniversalSourceFactsV4FileResult,
} from "./source-facts-v4.js";
import type {
  FoundryUniversalSourceFactsV5,
  UniversalSourceFactsV5FileResult,
} from "./source-facts-v5.js";
import type {
  FoundryGaussianPlySourceFactsOutcome,
} from "./gaussian-ply-source-facts.js";
import type {
  FoundryMediaContainerSourceFactsOutcome,
} from "./media-container-source-facts.js";
import type {
  FoundryCalibrationTrajectorySourceFactsOutcome,
} from "./calibration-trajectory-source-facts.js";
import type {
  FoundrySpzSourceFactsOutcome,
} from "./spz-source-facts.js";

export const FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0 =
  "omnitwin.foundry.universal-intake-receipt.v0";
export const FOUNDRY_INTAKE_MAX_FILE_COUNT = 100_000;
export const FOUNDRY_INTAKE_MAX_DIRECTORY_COUNT = 100_000;
export const FOUNDRY_INTAKE_MAX_DIRECTORY_DEPTH = 256;

const RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_INTAKE_RECEIPT_V0";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const OPAQUE_OR_PROPRIETARY_TYPES = new Set<FoundryInputType>([
  "matterpak_bundle",
  "xgrids_xbin",
  "lcc",
  "lcc2",
  "fbx",
  "cad_bim",
]);

export const FOUNDRY_INTAKE_QUARANTINE_REASONS = [
  "format_unknown",
  "format_ambiguous",
  "low_confidence_detection",
  "opaque_or_proprietary_format",
  "rights_unreviewed",
  "provenance_unreviewed",
] as const;
export const FoundryIntakeQuarantineReasonSchema = z.enum(
  FOUNDRY_INTAKE_QUARANTINE_REASONS,
);
export type FoundryIntakeQuarantineReason = z.infer<
  typeof FoundryIntakeQuarantineReasonSchema
>;

export const FOUNDRY_QUARANTINE_NEXT_ACTIONS: Readonly<
  Record<FoundryIntakeQuarantineReason, string>
> = {
  format_unknown:
    "Ask an operator to identify the format or obtain a documented official export before admission.",
  format_ambiguous:
    "Inspect the file metadata and source context so an operator can confirm one format.",
  low_confidence_detection:
    "Use a format-aware read-only inspector to confirm the file signature before admission.",
  opaque_or_proprietary_format:
    "Use the vendor's official export or documented SDK; do not decode or decrypt proprietary payloads.",
  rights_unreviewed:
    "Have an authorized person confirm ownership, commercial use, model-training use, and redistribution rights.",
  provenance_unreviewed:
    "After rights are approved, have an operator record the source, capture or export state, coordinate frame, and parent assets before admission.",
};

const FoundryIntakeQuarantineItemSchema = z
  .object({
    reason: FoundryIntakeQuarantineReasonSchema,
    nextAction: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.nextAction !== FOUNDRY_QUARANTINE_NEXT_ACTIONS[item.reason]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextAction"],
        message: "quarantine reason must carry its canonical plain-language next action",
      });
    }
  });

const FoundryIntakeDuplicateSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("unique"),
      groupSha256: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal("exact_content_duplicate"),
      groupSha256: z.string().regex(SHA256_HEX),
    })
    .strict(),
]);

const FoundryIntakeFileBaseSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    modifiedAt: z.string().datetime(),
    sha256: z.string().regex(SHA256_HEX),
    detection: FoundryFileDetectionSchema,
    inspection: z
      .object({
        method: z.literal("bounded_stream"),
        hashBufferBytes: z.literal(FOUNDRY_HASH_BUFFER_BYTES),
        headerBytesRead: z.number().int().min(0).max(FOUNDRY_MAX_HASH_HEAD_BYTES),
        magicHex: z.string().regex(/^(?:[a-f0-9]{2})*$/u).max(256),
      })
      .strict(),
    status: z.literal("quarantined"),
    manifestEligible: z.literal(false),
    quarantine: z.array(FoundryIntakeQuarantineItemSchema).min(2).max(6),
  })
  .strict();

export const FoundryUniversalIntakeFileSchema = FoundryIntakeFileBaseSchema.extend({
  duplicate: FoundryIntakeDuplicateSchema,
})
  .strict()
  .superRefine((file, ctx) => {
    if (JSON.stringify(file.quarantine) !== JSON.stringify(quarantineFor(file.detection))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quarantine"],
        message: "quarantine reasons must match format, rights, and provenance evidence",
      });
    }
  });
export type FoundryUniversalIntakeFile = z.infer<typeof FoundryUniversalIntakeFileSchema>;

export const FoundryIntakeDuplicateGroupSchema = z
  .object({
    sha256: z.string().regex(SHA256_HEX),
    sizeBytes: z.number().int().safe().nonnegative(),
    paths: z.array(FoundryRelativePathSchema).min(2).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
  })
  .strict();
export type FoundryIntakeDuplicateGroup = z.infer<typeof FoundryIntakeDuplicateGroupSchema>;

const FoundryUniversalIntakeReceiptBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0),
    source: z
      .object({
        kind: z.enum(["file", "directory"]),
        label: FoundryRelativePathSchema,
      })
      .strict(),
    policy: z
      .object({
        sourceAccess: z.literal("read_only"),
        networkAccess: z.literal("no_network_clients"),
        cloudDispatch: z.literal("none"),
        reconstruction: z.literal("none"),
        manifestPromotion: z.literal("none"),
        rightsStatus: z.literal("unreviewed"),
        filesystemTrust: z.literal("local_or_removable_operator_controlled"),
      })
      .strict(),
    summary: z
      .object({
        fileCount: z.number().int().min(0).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
        totalBytes: z.number().int().safe().nonnegative(),
        quarantinedCount: z.number().int().min(0).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
        unknownFormatCount: z.number().int().min(0).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
        ambiguousFormatCount: z.number().int().min(0).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
        duplicateGroupCount: z.number().int().min(0).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
      })
      .strict(),
    files: z.array(FoundryUniversalIntakeFileSchema).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
    duplicateGroups: z.array(FoundryIntakeDuplicateGroupSchema).max(FOUNDRY_INTAKE_MAX_FILE_COUNT),
  })
  .strict();

type ReceiptBase = z.infer<typeof FoundryUniversalIntakeReceiptBaseSchema>;
type ReceiptFileBase = z.infer<typeof FoundryIntakeFileBaseSchema>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function duplicateKey(file: Pick<ReceiptFileBase, "sha256" | "sizeBytes">): string {
  return `${file.sha256}:${String(file.sizeBytes)}`;
}

function buildDuplicateGroups(
  files: readonly Pick<ReceiptFileBase, "path" | "sha256" | "sizeBytes">[],
): FoundryIntakeDuplicateGroup[] {
  const grouped = new Map<string, Array<Pick<ReceiptFileBase, "path" | "sha256" | "sizeBytes">>>();
  for (const file of files) {
    const group = grouped.get(duplicateKey(file)) ?? [];
    group.push(file);
    grouped.set(duplicateKey(file), group);
  }
  return [...grouped.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      sha256: group[0]?.sha256 ?? "",
      sizeBytes: group[0]?.sizeBytes ?? 0,
      paths: group.map((file) => file.path).sort(compareText),
    }))
    .sort((left, right) => compareText(left.paths[0] ?? "", right.paths[0] ?? ""));
}

function addDuplicateStatus(
  files: readonly ReceiptFileBase[],
  duplicateGroups: readonly FoundryIntakeDuplicateGroup[],
): FoundryUniversalIntakeFile[] {
  const groups = new Map<string, FoundryIntakeDuplicateGroup>(
    duplicateGroups.map((group) => [`${group.sha256}:${String(group.sizeBytes)}`, group] as const),
  );
  return files.map((file) => {
    const group = groups.get(duplicateKey(file));
    return {
      ...file,
      duplicate: group === undefined
        ? { status: "unique" as const, groupSha256: null }
        : {
            status: "exact_content_duplicate" as const,
            groupSha256: group.sha256,
          },
    };
  });
}

function expectedSummary(
  files: readonly FoundryUniversalIntakeFile[],
  duplicateGroups: readonly FoundryIntakeDuplicateGroup[],
): ReceiptBase["summary"] {
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.sizeBytes;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new FoundryIntegrityError(
        "INTAKE_SIZE_OUT_OF_BOUNDS",
        "Intake total size cannot be represented safely.",
      );
    }
  }
  return {
    fileCount: files.length,
    totalBytes,
    quarantinedCount: files.length,
    unknownFormatCount: files.filter((file) => file.detection.status === "unknown").length,
    ambiguousFormatCount: files.filter((file) => file.detection.status === "ambiguous").length,
    duplicateGroupCount: duplicateGroups.length,
  };
}

function receiptPayloadSha256(payload: ReceiptBase): string {
  return domainSeparatedSha256(RECEIPT_DIGEST_DOMAIN, toCanonicalJson(payload));
}

function validateReceiptConsistency(
  receipt: ReceiptBase & { readonly receiptSha256: string },
  ctx: z.RefinementCtx,
): void {
  const sortedPaths = receipt.files.map((file) => file.path).sort(compareText);
  if (new Set(sortedPaths).size !== sortedPaths.length ||
      sortedPaths.some((path, index) => path !== receipt.files[index]?.path)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "file paths must be unique and sorted" });
  }
  const expectedGroups = buildDuplicateGroups(receipt.files);
  const expectedFiles = addDuplicateStatus(receipt.files, expectedGroups);
  const expected = expectedSummary(expectedFiles, expectedGroups);
  if (JSON.stringify(receipt.summary) !== JSON.stringify(expected)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "receipt summary does not match files" });
  }
  if (JSON.stringify(receipt.duplicateGroups) !== JSON.stringify(expectedGroups)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duplicateGroups"], message: "duplicate groups do not match file hashes" });
  }
  if (receipt.files.some((file, index) =>
    JSON.stringify(file.duplicate) !== JSON.stringify(expectedFiles[index]?.duplicate)
  )) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "file duplicate status is inconsistent" });
  }
  const { receiptSha256: _receiptSha256, ...payload } = receipt;
  if (receipt.receiptSha256 !== receiptPayloadSha256(payload)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["receiptSha256"], message: "receipt digest does not match its canonical payload" });
  }
}

export const FoundryUniversalIntakeReceiptSchema = FoundryUniversalIntakeReceiptBaseSchema.extend({
  receiptSha256: z.string().regex(SHA256_HEX),
})
  .strict()
  .superRefine(validateReceiptConsistency);
export type FoundryUniversalIntakeReceipt = z.infer<
  typeof FoundryUniversalIntakeReceiptSchema
>;

function contextualDetection(probe: FoundryFileProbe): FoundryFileDetection | null {
  const name = probe.relativePath.split("/").at(-1)?.toLowerCase() ?? "";
  if (["cameras.txt", "images.txt", "points3d.txt", "frames.txt", "rigs.txt"].includes(name)) {
    return FoundryFileDetectionSchema.parse({
      status: "detected",
      candidates: [{
        inputType: "colmap_sparse_model",
        confidence: "medium",
        evidence: ["colmap_sparse_text_filename"],
      }],
      caveats: ["COLMAP sparse text classification requires a bounded strict parser."],
    });
  }
  if (["poses.txt", "poses.yaml", "poses.yml"].includes(name)) {
    return FoundryFileDetectionSchema.parse({
      status: "detected",
      candidates: [{ inputType: "trajectory", confidence: "medium", evidence: ["poses_filename"] }],
      caveats: ["Pose convention, units, frame, and quaternion order require review."],
    });
  }
  return null;
}

export function classifyUniversalIntakeProbe(input: unknown): FoundryFileDetection {
  const probe = FoundryFileProbeSchema.parse(input);
  const detected = detectFoundryInputFile(probe);
  return detected.status === "unknown" ? contextualDetection(probe) ?? detected : detected;
}

function quarantineFor(detection: FoundryFileDetection): Array<{
  readonly reason: FoundryIntakeQuarantineReason;
  readonly nextAction: string;
}> {
  const reasons: FoundryIntakeQuarantineReason[] = [];
  if (detection.status === "unknown") reasons.push("format_unknown");
  if (detection.status === "ambiguous") reasons.push("format_ambiguous");
  if (detection.candidates.some((candidate) => candidate.confidence === "low")) {
    reasons.push("low_confidence_detection");
  }
  if (detection.candidates.some((candidate) => OPAQUE_OR_PROPRIETARY_TYPES.has(candidate.inputType))) {
    reasons.push("opaque_or_proprietary_format");
  }
  reasons.push("rights_unreviewed", "provenance_unreviewed");
  return reasons.map((reason) => ({ reason, nextAction: FOUNDRY_QUARANTINE_NEXT_ACTIONS[reason] }));
}

interface LocatedIntakeFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly expectedIdentity: ExpectedRegularFileIdentity;
}

interface LocatedIntakeSource {
  readonly kind: "file" | "directory";
  readonly label: string;
  readonly files: readonly LocatedIntakeFile[];
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function regularFileIdentity(metadata: Stats): ExpectedRegularFileIdentity {
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
  };
}

function sameIdentity(
  left: ExpectedRegularFileIdentity,
  right: ExpectedRegularFileIdentity,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
  );
}

function safeRelativePath(path: string): string {
  const result = FoundryRelativePathSchema.safeParse(path);
  if (!result.success) {
    throw new FoundryIntegrityError(
      "UNSAFE_INTAKE_PATH",
      `Intake path cannot be represented safely: ${path}`,
    );
  }
  return result.data;
}

function assertSupportedSourcePath(sourceInput: string): void {
  if (process.platform === "win32" && sourceInput.replaceAll("/", "\\").startsWith("\\\\")) {
    throw new FoundryIntegrityError(
      "INTAKE_REMOTE_OR_DEVICE_PATH",
      "UNC and device paths are not accepted; copy the source to a local or removable drive first.",
    );
  }
}

function assertIntakeNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new FoundryIntegrityError(
      "INTAKE_CANCELLED",
      "The read-only intake inspection was cancelled.",
    );
  }
}

async function walkIntakeDirectory(
  root: string,
  signal: AbortSignal | undefined,
): Promise<readonly LocatedIntakeFile[]> {
  const files: LocatedIntakeFile[] = [];
  const caseFoldedPaths = new Map<string, string>();
  let directoryCount = 0;
  async function walk(directory: string, parentParts: readonly string[]): Promise<void> {
    assertIntakeNotCancelled(signal);
    directoryCount += 1;
    if (directoryCount > FOUNDRY_INTAKE_MAX_DIRECTORY_COUNT) {
      throw new FoundryIntegrityError(
        "INTAKE_DIRECTORY_COUNT_OUT_OF_BOUNDS",
        `Intake exceeds ${String(FOUNDRY_INTAKE_MAX_DIRECTORY_COUNT)} directories.`,
      );
    }
    if (parentParts.length > FOUNDRY_INTAKE_MAX_DIRECTORY_DEPTH) {
      throw new FoundryIntegrityError(
        "INTAKE_DIRECTORY_DEPTH_OUT_OF_BOUNDS",
        `Intake exceeds ${String(FOUNDRY_INTAKE_MAX_DIRECTORY_DEPTH)} directory levels.`,
      );
    }
    const entries = await opendir(directory);
    for await (const entry of entries) {
      assertIntakeNotCancelled(signal);
      const parts = [...parentParts, entry.name];
      const relativePath = safeRelativePath(parts.join("/"));
      const absolutePath = resolve(directory, entry.name);
      const metadata = await lstat(absolutePath);
      assertIntakeNotCancelled(signal);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        throw new FoundryIntegrityError(
          "INTAKE_SYMLINK",
          `Symbolic links are not inspected: ${relativePath}`,
        );
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        await walk(absolutePath, parts);
      } else if (entry.isFile() && metadata.isFile()) {
        const canonical = await realpath(absolutePath);
        if (!isWithin(root, canonical)) {
          throw new FoundryIntegrityError("INTAKE_PATH_ESCAPE", `Intake path escapes its root: ${relativePath}`);
        }
        const canonicalMetadata = await lstat(canonical);
        if (canonicalMetadata.isSymbolicLink() || !canonicalMetadata.isFile()) {
          throw new FoundryIntegrityError(
            "INTAKE_FILE_CHANGED_DURING_DISCOVERY",
            `Intake file changed during discovery: ${relativePath}`,
          );
        }
        const folded = relativePath.toLocaleLowerCase("en-US");
        const collision = caseFoldedPaths.get(folded);
        if (collision !== undefined) {
          throw new FoundryIntegrityError("INTAKE_CASE_COLLISION", `Case-insensitive intake path collision: ${collision} and ${relativePath}`);
        }
        caseFoldedPaths.set(folded, relativePath);
        files.push({
          absolutePath: canonical,
          relativePath,
          expectedIdentity: regularFileIdentity(canonicalMetadata),
        });
        if (files.length > FOUNDRY_INTAKE_MAX_FILE_COUNT) {
          throw new FoundryIntegrityError("INTAKE_FILE_COUNT_OUT_OF_BOUNDS", `Intake exceeds ${String(FOUNDRY_INTAKE_MAX_FILE_COUNT)} files.`);
        }
      } else {
        throw new FoundryIntegrityError("INTAKE_NON_REGULAR_ENTRY", `Only regular files are inspected: ${relativePath}`);
      }
    }
  }
  await walk(root, []);
  assertIntakeNotCancelled(signal);
  return files.sort((left, right) => compareText(left.relativePath, right.relativePath));
}

async function locateIntakeSource(
  sourceInput: string,
  signal: AbortSignal | undefined,
): Promise<LocatedIntakeSource> {
  assertIntakeNotCancelled(signal);
  assertSupportedSourcePath(sourceInput);
  const requested = resolve(sourceInput);
  const requestedMetadata = await lstat(requested);
  assertIntakeNotCancelled(signal);
  if (requestedMetadata.isSymbolicLink()) {
    throw new FoundryIntegrityError("INTAKE_SOURCE_SYMLINK", `Symbolic links are not inspected: ${requested}`);
  }
  const canonical = await realpath(requested);
  const metadata = await lstat(canonical);
  const requestedAfterResolution = await lstat(requested);
  assertIntakeNotCancelled(signal);
  if (
    requestedAfterResolution.isSymbolicLink() ||
    !sameIdentity(
      regularFileIdentity(requestedAfterResolution),
      regularFileIdentity(metadata),
    )
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_SOURCE_CHANGED_DURING_DISCOVERY",
      `Intake source changed during discovery: ${requested}`,
    );
  }
  const label = safeRelativePath(basename(canonical) || "filesystem-root");
  if (metadata.isFile()) {
    return {
      kind: "file",
      label,
      files: [{
        absolutePath: canonical,
        relativePath: label,
        expectedIdentity: regularFileIdentity(metadata),
      }],
    };
  }
  if (metadata.isDirectory()) {
    return { kind: "directory", label, files: await walkIntakeDirectory(canonical, signal) };
  }
  throw new FoundryIntegrityError("INTAKE_SOURCE_NOT_SUPPORTED", `Intake source must be a file or directory: ${requested}`);
}

function assertIntakeSourceUnchanged(
  before: LocatedIntakeSource,
  after: LocatedIntakeSource,
): void {
  const sourceChanged =
    before.kind !== after.kind ||
    before.label !== after.label ||
    before.files.length !== after.files.length ||
    before.files.some((file, index) => {
      const finalFile = after.files[index];
      return (
        finalFile === undefined ||
        file.relativePath !== finalFile.relativePath ||
        comparable(file.absolutePath) !== comparable(finalFile.absolutePath) ||
        !sameIdentity(file.expectedIdentity, finalFile.expectedIdentity)
      );
    });
  if (sourceChanged) {
    throw new FoundryIntegrityError(
      "INTAKE_SOURCE_CHANGED_DURING_INSPECTION",
      "Intake source files changed while the receipt was being built; no receipt was issued.",
    );
  }
}

async function inspectLocatedFile(
  file: LocatedIntakeFile,
  signal: AbortSignal | undefined,
): Promise<ReceiptFileBase> {
  const digest = await sha256RegularFileWithHead(
    file.absolutePath,
    FOUNDRY_MAX_HASH_HEAD_BYTES,
    file.expectedIdentity,
    signal,
  );
  const head = Buffer.from(digest.headBytes);
  const magicHex = head.subarray(0, 128).toString("hex");
  const detection = classifyUniversalIntakeProbe({
    relativePath: file.relativePath,
    magicHex,
    boundedHeaderText: head
      .toString("utf8")
      .slice(0, FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS),
  });
  return FoundryIntakeFileBaseSchema.parse({
    path: file.relativePath,
    sizeBytes: digest.sizeBytes,
    modifiedAt: digest.modifiedAt,
    sha256: digest.sha256,
    detection,
    inspection: {
      method: "bounded_stream",
      hashBufferBytes: FOUNDRY_HASH_BUFFER_BYTES,
      headerBytesRead: head.length,
      magicHex,
    },
    status: "quarantined",
    manifestEligible: false,
    quarantine: quarantineFor(detection),
  });
}

export interface InspectUniversalIntakeOptions {
  readonly signal?: AbortSignal;
}

export interface InspectUniversalIntakeWithSourceFactsResult {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFacts;
}

export interface InspectUniversalIntakeWithSourceFactsV2Result {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV2;
}

export interface InspectUniversalIntakeWithSourceFactsV3Result {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV3;
}

export interface InspectUniversalIntakeWithSourceFactsV4Result {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV4;
}

export interface InspectUniversalIntakeWithSourceFactsV5Result {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV5;
}

export async function inspectUniversalIntake(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<FoundryUniversalIntakeReceipt> {
  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  const inspectedFiles: ReceiptFileBase[] = [];
  for (const file of source.files) {
    assertIntakeNotCancelled(options.signal);
    inspectedFiles.push(await inspectLocatedFile(file, options.signal));
  }
  const sourceAfterInspection = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeNotCancelled(options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterInspection);
  const duplicateGroups = buildDuplicateGroups(inspectedFiles);
  const files = addDuplicateStatus(inspectedFiles, duplicateGroups);
  const payload = FoundryUniversalIntakeReceiptBaseSchema.parse({
    schemaVersion: FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0,
    source: { kind: source.kind, label: source.label },
    policy: {
      sourceAccess: "read_only",
      networkAccess: "no_network_clients",
      cloudDispatch: "none",
      reconstruction: "none",
      manifestPromotion: "none",
      rightsStatus: "unreviewed",
      filesystemTrust: "local_or_removable_operator_controlled",
    },
    summary: expectedSummary(files, duplicateGroups),
    files,
    duplicateGroups,
  });
  return FoundryUniversalIntakeReceiptSchema.parse({
    ...payload,
    receiptSha256: receiptPayloadSha256(payload),
  });
}

function sourceFactsIdentity(
  file: FoundryUniversalIntakeFile,
): UniversalSourceFactsReceiptFileIdentity {
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    detection: file.detection,
  };
}

function assertLocatedSourceMatchesReceipt(
  source: LocatedIntakeSource,
  receipt: FoundryUniversalIntakeReceipt,
): void {
  const differs =
    source.kind !== receipt.source.kind ||
    source.label !== receipt.source.label ||
    source.files.length !== receipt.files.length ||
    source.files.some((file, index) => {
      const receiptFile = receipt.files[index];
      return receiptFile === undefined ||
        file.relativePath !== receiptFile.path ||
        file.expectedIdentity.size !== receiptFile.sizeBytes;
    });
  if (differs) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_SOURCE_CHANGED_AFTER_RECEIPT",
      "The intake source changed after its receipt was built; no Source Facts artifact was issued.",
    );
  }
}

/**
 * Builds the unchanged universal receipt first, then performs a second
 * handle-bound read for Source Facts. The second pass must reproduce every
 * receipt byte count and SHA-256 before the sibling artifact can be issued.
 */
export async function inspectUniversalIntakeWithSourceFacts(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<InspectUniversalIntakeWithSourceFactsResult> {
  const receipt = await inspectUniversalIntake(sourceInput, options);
  const identities = receipt.files.map(sourceFactsIdentity);
  if (identities.some((identity) =>
    identity.detection.candidates.some((candidate) => candidate.inputType === "xgrids_xbin")
  )) {
    return {
      receipt,
      sourceFacts: createUniversalSourceFactsArtifactFromReceipt(
        receipt.receiptSha256,
        identities,
      ),
    };
  }

  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  assertLocatedSourceMatchesReceipt(source, receipt);
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const results: UniversalSourceFactsFileResult[] = [];
  for (const located of source.files) {
    assertIntakeNotCancelled(options.signal);
    const receiptFile = receiptByPath.get(located.relativePath);
    if (receiptFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_RECEIPT_FILE_MISSING",
        "The Source Facts pass found a file that is absent from the intake receipt.",
      );
    }
    const identity = sourceFactsIdentity(receiptFile);
    const collector = createUniversalSourceFactsStreamCollector(located.relativePath);
    const magicHex = receiptFile.inspection.magicHex;
    const inspectAsSog = identity.detection.candidates.some((candidate) => candidate.inputType === "sog") &&
      !magicHex.startsWith("4153544d2d453537") &&
      !magicHex.startsWith("676c5446");
    let sogInspection: FoundrySogSourceFactsOutcome | undefined;
    const digest = await sha256RegularFileWithHead(
      located.absolutePath,
      0,
      located.expectedIdentity,
      options.signal,
      (chunk, absoluteOffset) => {
        collector.observe(chunk, absoluteOffset);
      },
      inspectAsSog
        ? async (handle, sizeBytes, sourceSha256) => {
            sogInspection = await inspectStoredZipSogV2SourceFacts(
              handle,
              sizeBytes,
              sourceSha256,
              options.signal,
            );
          }
        : undefined,
    );
    if (digest.sizeBytes !== identity.sizeBytes || digest.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_BYTE_BINDING_MISMATCH",
        "The Source Facts byte stream did not match the intake receipt; no artifact was issued.",
      );
    }
    results.push(collector.finalize(
      identity,
      sogInspection === undefined ? undefined : { sogInspection },
    ));
  }
  const sourceAfterFacts = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterFacts);
  return {
    receipt,
    sourceFacts: createUniversalSourceFactsArtifactFromReceipt(
      receipt.receiptSha256,
      identities,
      results,
    ),
  };
}

/**
 * Builds the unchanged Receipt V0, then issues immutable Source Facts V2.
 * V2 adds handle-bound SPZ inspection while retaining V1 E57/GLB/OBJ/SOG
 * facts and the receipt-first all-or-nothing XBIN boundary.
 */
export async function inspectUniversalIntakeWithSourceFactsV2(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<InspectUniversalIntakeWithSourceFactsV2Result> {
  const {
    createUniversalSourceFactsV2ArtifactFromReceipt,
    createUniversalSourceFactsV2StreamCollector,
  } = await import("./source-facts-v2.js");
  const receipt = await inspectUniversalIntake(sourceInput, options);
  const identities = receipt.files.map(sourceFactsIdentity);
  if (identities.some((identity) =>
    identity.detection.candidates.some((candidate) => candidate.inputType === "xgrids_xbin")
  )) {
    return {
      receipt,
      sourceFacts: createUniversalSourceFactsV2ArtifactFromReceipt(
        receipt.receiptSha256,
        identities,
      ),
    };
  }

  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  assertLocatedSourceMatchesReceipt(source, receipt);
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const results: UniversalSourceFactsV2FileResult[] = [];
  for (const located of source.files) {
    assertIntakeNotCancelled(options.signal);
    const receiptFile = receiptByPath.get(located.relativePath);
    if (receiptFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V2_RECEIPT_FILE_MISSING",
        "The Source Facts V2 pass found a file that is absent from the intake receipt.",
      );
    }
    const identity = sourceFactsIdentity(receiptFile);
    const collector = createUniversalSourceFactsV2StreamCollector(located.relativePath);
    const magicHex = receiptFile.inspection.magicHex;
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const inspectAsSog = identity.detection.candidates.some((candidate) => candidate.inputType === "sog") &&
      !e57Magic && !glbMagic;
    const inspectAsSpz = identity.detection.candidates.some((candidate) => candidate.inputType === "spz") &&
      !e57Magic && !glbMagic;
    let sogInspection: FoundrySogSourceFactsOutcome | undefined;
    let spzInspection: FoundrySpzSourceFactsOutcome | undefined;
    const digest = await sha256RegularFileWithHead(
      located.absolutePath,
      0,
      located.expectedIdentity,
      options.signal,
      (chunk, absoluteOffset) => {
        collector.observe(chunk, absoluteOffset);
      },
      inspectAsSog || inspectAsSpz
        ? async (handle, sizeBytes, sourceSha256) => {
            if (inspectAsSog) {
              sogInspection = await inspectStoredZipSogV2SourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            const { inspectSpzSourceFacts } = await import("./spz-source-facts.js");
            spzInspection = await inspectSpzSourceFacts(
              handle,
              sizeBytes,
              sourceSha256,
              options.signal,
            );
          }
        : undefined,
    );
    if (digest.sizeBytes !== identity.sizeBytes || digest.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V2_BYTE_BINDING_MISMATCH",
        "The Source Facts V2 byte stream did not match the intake receipt; no artifact was issued.",
      );
    }
    results.push(collector.finalize(identity, {
      ...(sogInspection === undefined ? {} : { sogInspection }),
      ...(spzInspection === undefined ? {} : { spzInspection }),
    }));
  }
  const sourceAfterFacts = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterFacts);
  return {
    receipt,
    sourceFacts: createUniversalSourceFactsV2ArtifactFromReceipt(
      receipt.receiptSha256,
      identities,
      results,
    ),
  };
}

/**
 * Builds the unchanged Receipt V0, then issues immutable Source Facts V3.
 * V3 adds handle-bound Gaussian PLY structural inspection while retaining
 * V2 E57/GLB/OBJ/SOG/SPZ facts and the receipt-first atomic XBIN boundary.
 * Ordinary PLY receipt candidates are probed on the same hashed handle and
 * refine to Gaussian PLY only when the complete structural profile succeeds.
 */
export async function inspectUniversalIntakeWithSourceFactsV3(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<InspectUniversalIntakeWithSourceFactsV3Result> {
  const {
    createUniversalSourceFactsV3ArtifactFromReceipt,
    createUniversalSourceFactsV3StreamCollector,
  } = await import("./source-facts-v3.js");
  const receipt = await inspectUniversalIntake(sourceInput, options);
  const identities = receipt.files.map(sourceFactsIdentity);
  if (identities.some((identity) =>
    identity.detection.candidates.some((candidate) => candidate.inputType === "xgrids_xbin")
  )) {
    return {
      receipt,
      sourceFacts: createUniversalSourceFactsV3ArtifactFromReceipt(
        receipt.receiptSha256,
        identities,
      ),
    };
  }

  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  assertLocatedSourceMatchesReceipt(source, receipt);
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const results: UniversalSourceFactsV3FileResult[] = [];
  for (const located of source.files) {
    assertIntakeNotCancelled(options.signal);
    const receiptFile = receiptByPath.get(located.relativePath);
    if (receiptFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V3_RECEIPT_FILE_MISSING",
        "The Source Facts V3 pass found a file that is absent from the intake receipt.",
      );
    }
    const identity = sourceFactsIdentity(receiptFile);
    const collector = createUniversalSourceFactsV3StreamCollector(located.relativePath);
    const magicHex = receiptFile.inspection.magicHex;
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const inspectAsGaussianPly = !e57Magic && !glbMagic &&
      identity.detection.candidates.some((candidate) =>
        candidate.inputType === "gaussian_ply" || candidate.inputType === "ply_point_cloud"
      );
    const inspectAsSog = !inspectAsGaussianPly &&
      identity.detection.candidates.some((candidate) => candidate.inputType === "sog") &&
      !e57Magic && !glbMagic;
    const inspectAsSpz = !inspectAsGaussianPly &&
      identity.detection.candidates.some((candidate) => candidate.inputType === "spz") &&
      !e57Magic && !glbMagic;
    let sogInspection: FoundrySogSourceFactsOutcome | undefined;
    let spzInspection: FoundrySpzSourceFactsOutcome | undefined;
    let gaussianPlyInspection: FoundryGaussianPlySourceFactsOutcome | undefined;
    const digest = await sha256RegularFileWithHead(
      located.absolutePath,
      0,
      located.expectedIdentity,
      options.signal,
      (chunk, absoluteOffset) => {
        collector.observe(chunk, absoluteOffset);
      },
      inspectAsSog || inspectAsSpz || inspectAsGaussianPly
        ? async (handle, sizeBytes, sourceSha256) => {
            if (inspectAsGaussianPly) {
              const { inspectGaussianPlySourceFacts } = await import("./gaussian-ply-source-facts.js");
              gaussianPlyInspection = await inspectGaussianPlySourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsSog) {
              sogInspection = await inspectStoredZipSogV2SourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            const { inspectSpzSourceFacts } = await import("./spz-source-facts.js");
            spzInspection = await inspectSpzSourceFacts(
              handle,
              sizeBytes,
              sourceSha256,
              options.signal,
            );
          }
        : undefined,
    );
    if (digest.sizeBytes !== identity.sizeBytes || digest.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V3_BYTE_BINDING_MISMATCH",
        "The Source Facts V3 byte stream did not match the intake receipt; no artifact was issued.",
      );
    }
    results.push(collector.finalize(identity, {
      ...(sogInspection === undefined ? {} : { sogInspection }),
      ...(spzInspection === undefined ? {} : { spzInspection }),
      ...(gaussianPlyInspection === undefined ? {} : { gaussianPlyInspection }),
    }));
  }
  const sourceAfterFacts = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterFacts);
  return {
    receipt,
    sourceFacts: createUniversalSourceFactsV3ArtifactFromReceipt(
      receipt.receiptSha256,
      identities,
      results,
    ),
  };
}

const MEDIA_CONTAINER_RECEIPT_INPUT_TYPES: readonly FoundryInputType[] = [
  "matterport_panorama",
  "dslr_image",
  "generic_image",
  "panorama_360",
  "phone_image",
  "drone_media",
  "video",
];

function hasMediaContainerReceiptCandidate(
  identity: UniversalSourceFactsReceiptFileIdentity,
): boolean {
  return MEDIA_CONTAINER_RECEIPT_INPUT_TYPES.some((inputType) =>
    identity.detection.candidates.some((candidate) => candidate.inputType === inputType)
  );
}

function receiptPathExtension(relativePath: string): string {
  const leaf = relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot).toLowerCase();
}

function claimedBySourceFactsV1ThroughV3(
  identity: UniversalSourceFactsReceiptFileIdentity,
  e57Magic: boolean,
  glbMagic: boolean,
): boolean {
  if (e57Magic || glbMagic) return true;
  const candidates = new Set(identity.detection.candidates.map((candidate) => candidate.inputType));
  const suffix = receiptPathExtension(identity.path);
  return candidates.has("gaussian_ply") || candidates.has("ply_point_cloud") ||
    candidates.has("spz") || suffix === ".spz" ||
    candidates.has("sog") || suffix === ".sog" ||
    candidates.has("generic_e57") || candidates.has("matterport_e57") || suffix === ".e57" ||
    candidates.has("glb_gltf") || suffix === ".gltf" || suffix === ".glb" ||
    candidates.has("obj") || suffix === ".obj";
}

function sourceFactsV4Identity(
  file: FoundryUniversalIntakeFile,
): UniversalSourceFactsV4ReceiptFileIdentity {
  return {
    ...sourceFactsIdentity(file),
    magicHex: file.inspection.magicHex,
  };
}

/**
 * Builds the unchanged Receipt V0, then issues immutable Source Facts V4.
 * V4 adds handle-bound JPEG, PNG and ISO-BMFF container inspection while
 * retaining all V3 facts, capture-role ambiguity and the atomic XBIN stop.
 * Container validity remains separate from capture role and provenance.
 */
export async function inspectUniversalIntakeWithSourceFactsV4(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<InspectUniversalIntakeWithSourceFactsV4Result> {
  const {
    createUniversalSourceFactsV4ArtifactFromReceipt,
    createUniversalSourceFactsV4StreamCollector,
  } = await import("./source-facts-v4.js");
  const receipt = await inspectUniversalIntake(sourceInput, options);
  const identities = receipt.files.map(sourceFactsV4Identity);
  if (identities.some((identity) =>
    identity.detection.candidates.some((candidate) => candidate.inputType === "xgrids_xbin")
  )) {
    return {
      receipt,
      sourceFacts: createUniversalSourceFactsV4ArtifactFromReceipt(
        receipt.receiptSha256,
        identities,
      ),
    };
  }

  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  assertLocatedSourceMatchesReceipt(source, receipt);
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const results: UniversalSourceFactsV4FileResult[] = [];
  for (const located of source.files) {
    assertIntakeNotCancelled(options.signal);
    const receiptFile = receiptByPath.get(located.relativePath);
    if (receiptFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V4_RECEIPT_FILE_MISSING",
        "The Source Facts V4 pass found a file that is absent from the intake receipt.",
      );
    }
    const identity = sourceFactsV4Identity(receiptFile);
    const collector = createUniversalSourceFactsV4StreamCollector(located.relativePath);
    const magicHex = receiptFile.inspection.magicHex;
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const inheritedTarget = claimedBySourceFactsV1ThroughV3(identity, e57Magic, glbMagic);
    const inspectAsGaussianPly = !e57Magic && !glbMagic &&
      identity.detection.candidates.some((candidate) =>
        candidate.inputType === "gaussian_ply" || candidate.inputType === "ply_point_cloud"
      );
    const suffix = receiptPathExtension(identity.path);
    const inspectAsSpz = !inspectAsGaussianPly && !e57Magic && !glbMagic &&
      (identity.detection.candidates.some((candidate) => candidate.inputType === "spz") || suffix === ".spz");
    const inspectAsSog = !inspectAsGaussianPly && !inspectAsSpz && !e57Magic && !glbMagic &&
      (identity.detection.candidates.some((candidate) => candidate.inputType === "sog") || suffix === ".sog");
    const inspectAsMediaContainer = !inheritedTarget && hasMediaContainerReceiptCandidate(identity);
    let sogInspection: FoundrySogSourceFactsOutcome | undefined;
    let spzInspection: FoundrySpzSourceFactsOutcome | undefined;
    let gaussianPlyInspection: FoundryGaussianPlySourceFactsOutcome | undefined;
    let mediaContainerInspection: FoundryMediaContainerSourceFactsOutcome | undefined;
    const digest = await sha256RegularFileWithHead(
      located.absolutePath,
      0,
      located.expectedIdentity,
      options.signal,
      (chunk, absoluteOffset) => {
        collector.observe(chunk, absoluteOffset);
      },
      inspectAsSog || inspectAsSpz || inspectAsGaussianPly || inspectAsMediaContainer
        ? async (handle, sizeBytes, sourceSha256) => {
            if (inspectAsGaussianPly) {
              const { inspectGaussianPlySourceFacts } = await import("./gaussian-ply-source-facts.js");
              gaussianPlyInspection = await inspectGaussianPlySourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsSog) {
              sogInspection = await inspectStoredZipSogV2SourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsSpz) {
              const { inspectSpzSourceFacts } = await import("./spz-source-facts.js");
              spzInspection = await inspectSpzSourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            const { inspectMediaContainerSourceFacts } = await import("./media-container-source-facts.js");
            mediaContainerInspection = await inspectMediaContainerSourceFacts(
              handle,
              sizeBytes,
              sourceSha256,
              options.signal,
            );
          }
        : undefined,
    );
    if (digest.sizeBytes !== identity.sizeBytes || digest.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V4_BYTE_BINDING_MISMATCH",
        "The Source Facts V4 byte stream did not match the intake receipt; no artifact was issued.",
      );
    }
    results.push(collector.finalize(identity, {
      ...(sogInspection === undefined ? {} : { sogInspection }),
      ...(spzInspection === undefined ? {} : { spzInspection }),
      ...(gaussianPlyInspection === undefined ? {} : { gaussianPlyInspection }),
      ...(mediaContainerInspection === undefined ? {} : { mediaContainerInspection }),
    }));
  }
  const sourceAfterFacts = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterFacts);
  return {
    receipt,
    sourceFacts: createUniversalSourceFactsV4ArtifactFromReceipt(
      receipt.receiptSha256,
      identities,
      results,
    ),
  };
}

function registrationDocumentReceiptTarget(
  identity: UniversalSourceFactsReceiptFileIdentity,
): "calibration_bundle" | "trajectory" | null {
  if (
    identity.detection.status !== "detected" ||
    identity.detection.candidates.length !== 1
  ) return null;
  const inputType = identity.detection.candidates[0]?.inputType;
  return inputType === "calibration_bundle" || inputType === "trajectory"
    ? inputType
    : null;
}

/**
 * Builds the unchanged Receipt V0, then issues immutable Source Facts V5.
 * V5 adds same-handle, bounded CSV record-structure and JSON syntax/shape
 * inspection for unambiguous calibration and trajectory document candidates.
 * It does not assign field semantics, frames, units, timing conventions,
 * provenance, calibration validity, registration, accuracy, rights, or authority.
 */
export async function inspectUniversalIntakeWithSourceFactsV5(
  sourceInput: string,
  options: InspectUniversalIntakeOptions = {},
): Promise<InspectUniversalIntakeWithSourceFactsV5Result> {
  const {
    createUniversalSourceFactsV5ArtifactFromReceipt,
    createUniversalSourceFactsV5StreamCollector,
  } = await import("./source-facts-v5.js");
  const receipt = await inspectUniversalIntake(sourceInput, options);
  const identities = receipt.files.map(sourceFactsV4Identity);
  if (identities.some((identity) =>
    identity.detection.candidates.some(
      (candidate) => candidate.inputType === "xgrids_xbin",
    )
  )) {
    return {
      receipt,
      sourceFacts: createUniversalSourceFactsV5ArtifactFromReceipt(
        receipt.receiptSha256,
        identities,
      ),
    };
  }

  assertIntakeNotCancelled(options.signal);
  const source = await locateIntakeSource(sourceInput, options.signal);
  assertLocatedSourceMatchesReceipt(source, receipt);
  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const results: UniversalSourceFactsV5FileResult[] = [];
  for (const located of source.files) {
    assertIntakeNotCancelled(options.signal);
    const receiptFile = receiptByPath.get(located.relativePath);
    if (receiptFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RECEIPT_FILE_MISSING",
        "The Source Facts V5 pass found a file that is absent from the intake receipt.",
      );
    }
    const identity = sourceFactsV4Identity(receiptFile);
    const collector = createUniversalSourceFactsV5StreamCollector(located.relativePath);
    const magicHex = receiptFile.inspection.magicHex;
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const inheritedTarget = claimedBySourceFactsV1ThroughV3(
      identity,
      e57Magic,
      glbMagic,
    );
    const inspectAsGaussianPly = !e57Magic && !glbMagic &&
      identity.detection.candidates.some((candidate) =>
        candidate.inputType === "gaussian_ply" ||
        candidate.inputType === "ply_point_cloud"
      );
    const suffix = receiptPathExtension(identity.path);
    const inspectAsSpz = !inspectAsGaussianPly && !e57Magic && !glbMagic &&
      (identity.detection.candidates.some(
        (candidate) => candidate.inputType === "spz",
      ) || suffix === ".spz");
    const inspectAsSog = !inspectAsGaussianPly && !inspectAsSpz &&
      !e57Magic && !glbMagic &&
      (identity.detection.candidates.some(
        (candidate) => candidate.inputType === "sog",
      ) || suffix === ".sog");
    const inspectAsMediaContainer = !inheritedTarget &&
      hasMediaContainerReceiptCandidate(identity);
    const registrationTarget = !inheritedTarget && !inspectAsMediaContainer
      ? registrationDocumentReceiptTarget(identity)
      : null;
    const registrationFormat = registrationTarget !== null
      ? suffix === ".csv"
        ? "csv" as const
        : suffix === ".json"
          ? "json" as const
          : null
      : null;

    let sogInspection: FoundrySogSourceFactsOutcome | undefined;
    let spzInspection: FoundrySpzSourceFactsOutcome | undefined;
    let gaussianPlyInspection: FoundryGaussianPlySourceFactsOutcome | undefined;
    let mediaContainerInspection: FoundryMediaContainerSourceFactsOutcome | undefined;
    let calibrationTrajectoryInspection:
      FoundryCalibrationTrajectorySourceFactsOutcome | undefined;
    const digest = await sha256RegularFileWithHead(
      located.absolutePath,
      0,
      located.expectedIdentity,
      options.signal,
      (chunk, absoluteOffset) => {
        collector.observe(chunk, absoluteOffset);
      },
      inspectAsSog || inspectAsSpz || inspectAsGaussianPly ||
        inspectAsMediaContainer || registrationFormat !== null
        ? async (handle, sizeBytes, sourceSha256) => {
            if (inspectAsGaussianPly) {
              const { inspectGaussianPlySourceFacts } = await import(
                "./gaussian-ply-source-facts.js"
              );
              gaussianPlyInspection = await inspectGaussianPlySourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsSog) {
              sogInspection = await inspectStoredZipSogV2SourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsSpz) {
              const { inspectSpzSourceFacts } = await import(
                "./spz-source-facts.js"
              );
              spzInspection = await inspectSpzSourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (inspectAsMediaContainer) {
              const { inspectMediaContainerSourceFacts } = await import(
                "./media-container-source-facts.js"
              );
              mediaContainerInspection = await inspectMediaContainerSourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                options.signal,
              );
              return;
            }
            if (registrationFormat === null) return;
            const { inspectCalibrationTrajectorySourceFacts } = await import(
              "./calibration-trajectory-source-facts.js"
            );
            calibrationTrajectoryInspection =
              await inspectCalibrationTrajectorySourceFacts(
                handle,
                sizeBytes,
                sourceSha256,
                registrationFormat,
                options.signal,
              );
          }
        : undefined,
    );
    if (digest.sizeBytes !== identity.sizeBytes || digest.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_BYTE_BINDING_MISMATCH",
        "The Source Facts V5 byte stream did not match the intake receipt; no artifact was issued.",
      );
    }
    results.push(collector.finalize(identity, {
      ...(sogInspection === undefined ? {} : { sogInspection }),
      ...(spzInspection === undefined ? {} : { spzInspection }),
      ...(gaussianPlyInspection === undefined ? {} : { gaussianPlyInspection }),
      ...(mediaContainerInspection === undefined
        ? {}
        : { mediaContainerInspection }),
      ...(calibrationTrajectoryInspection === undefined
        ? {}
        : { calibrationTrajectoryInspection }),
    }));
  }
  const sourceAfterFacts = await locateIntakeSource(sourceInput, options.signal);
  assertIntakeSourceUnchanged(source, sourceAfterFacts);
  return {
    receipt,
    sourceFacts: createUniversalSourceFactsV5ArtifactFromReceipt(
      receipt.receiptSha256,
      identities,
      results,
    ),
  };
}
