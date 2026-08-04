import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
  FoundryRelativePathSchema,
  computeFoundryIngestManifestSha256,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes, sha256RegularFile } from "./hash.js";
import { admitUniversalIntakeReceipt } from "./intake-admission.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  inspectUniversalIntake,
} from "./intake-receipt.js";

export const FOUNDRY_INTAKE_STAGING_INDEX_V0 =
  "omnitwin.foundry.intake-staging-index.v0";
const STAGING_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0";
const COPY_BUFFER_BYTES = 8 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STAGED_SOURCE_PREFIX = "source/";
const STAGING_ARTIFACT_PATH_BY_ROLE = {
  intake_receipt: "evidence/intake-receipt.json",
  admission_review: "evidence/admission-review.json",
  admission_result: "evidence/admission-result.json",
  exclusion_ledger: "evidence/exclusions.json",
  ingest_manifest: "manifest/foundry-ingest-manifest-v0.json",
} as const;

const StagingFileSchema = z
  .object({
    path: FoundryRelativePathSchema,
    role: z.enum([
      "staged_source",
      "intake_receipt",
      "admission_review",
      "admission_result",
      "exclusion_ledger",
      "ingest_manifest",
    ]),
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.role === "staged_source") {
      const sourcePath = file.path.startsWith(STAGED_SOURCE_PREFIX)
        ? file.path.slice(STAGED_SOURCE_PREFIX.length)
        : "";
      if (!FoundryRelativePathSchema.safeParse(sourcePath).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["path"],
          message: "staged source entries must be rooted below source/",
        });
      }
      return;
    }
    if (file.path !== STAGING_ARTIFACT_PATH_BY_ROLE[file.role]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: `${file.role} must use its canonical staging artifact path`,
      });
    }
  });

const StagingIndexPayloadSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INTAKE_STAGING_INDEX_V0),
    receiptSha256: z.string().regex(SHA256_HEX),
    reviewSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    resultSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    stagedAssetCount: z.number().int().positive().max(100_000),
    indexedFileCount: z.number().int().positive().max(100_006),
    totalBytes: z.number().int().safe().positive(),
    files: z.array(StagingFileSchema).min(6).max(100_006),
    authority: z.literal("none"),
    capabilities: z
      .object({
        localStaging: z.literal("completed_verified"),
        jobPlanning: z.literal("not_authorized"),
        execution: z.literal("not_authorized"),
        modelTraining: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict()
  .superRefine((index, ctx) => {
    const paths = index.files.map((file) => file.path);
    const sorted = [...paths].sort();
    if (new Set(paths).size !== paths.length || paths.some((path, position) => path !== sorted[position])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "staging files must have unique paths in sorted order",
      });
    }
    if (index.indexedFileCount !== index.files.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["indexedFileCount"],
        message: "indexed file count must match the file ledger",
      });
    }
    const total = index.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (!Number.isSafeInteger(total) || total !== index.totalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalBytes"],
        message: "staging byte total must match the file ledger",
      });
    }
    const stagedSources = index.files.filter((file) => file.role === "staged_source");
    if (stagedSources.length !== index.stagedAssetCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stagedAssetCount"],
        message: "staged asset count must match staged source entries",
      });
    }
    for (const requiredRole of [
      "intake_receipt",
      "admission_review",
      "admission_result",
      "exclusion_ledger",
      "ingest_manifest",
    ] as const) {
      if (index.files.filter((file) => file.role === requiredRole).length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files"],
          message: `staging index requires exactly one ${requiredRole} artifact`,
        });
      }
    }
  });
export type FoundryIntakeStagingIndexPayload = z.infer<typeof StagingIndexPayloadSchema>;

export const FoundryIntakeStagingIndexV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INTAKE_STAGING_INDEX_V0),
    receiptSha256: z.string().regex(SHA256_HEX),
    reviewSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    resultSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    stagedAssetCount: z.number().int().positive().max(100_000),
    indexedFileCount: z.number().int().positive().max(100_006),
    totalBytes: z.number().int().safe().positive(),
    files: z.array(StagingFileSchema).min(6).max(100_006),
    authority: z.literal("none"),
    capabilities: z
      .object({
        localStaging: z.literal("completed_verified"),
        jobPlanning: z.literal("not_authorized"),
        execution: z.literal("not_authorized"),
        modelTraining: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
    stagingSha256: z.string().regex(SHA256_HEX),
  })
  .strict()
  .superRefine((index, ctx) => {
    const { stagingSha256: _stagingSha256, ...payload } = index;
    const parsedPayload = StagingIndexPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      for (const issue of parsedPayload.error.issues) ctx.addIssue(issue);
      return;
    }
    if (index.stagingSha256 !== stagingPayloadSha256(parsedPayload.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stagingSha256"],
        message: "staging digest must match its canonical payload",
      });
    }
  });
export type FoundryIntakeStagingIndexV0 = z.infer<
  typeof FoundryIntakeStagingIndexV0Schema
>;

export interface StageUniversalIntakeDraftOptions {
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly receipt: unknown;
  readonly review: unknown;
}

export interface StagedUniversalIntakeDraft {
  readonly outputDirectory: string;
  readonly index: FoundryIntakeStagingIndexV0;
}

interface IndexedFile {
  readonly path: string;
  readonly role: z.infer<typeof StagingFileSchema>["role"];
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface StageRootSnapshot {
  readonly path: string;
  readonly identity: {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
  };
}

function stagingPayloadSha256(payload: FoundryIntakeStagingIndexPayload): string {
  return domainSeparatedSha256(STAGING_DIGEST_DOMAIN, toCanonicalJson(payload));
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(comparable(parent), comparable(candidate));
  return fromParent === "" || (
    fromParent !== ".." &&
    !fromParent.startsWith(`..${sep}`) &&
    !isAbsolute(fromParent)
  );
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

async function resolveThroughExistingAncestor(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(cursor), ...suffix.reverse());
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_OUTPUT_ANCESTOR_MISSING",
        `Cannot resolve an existing output ancestor: ${input}`,
      );
    }
    suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
}

async function canonicalSourcePath(input: string): Promise<{ path: string; kind: "file" | "directory" }> {
  const requested = resolve(input);
  const requestedMetadata = await lstat(requested);
  if (requestedMetadata.isSymbolicLink()) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_SOURCE_SYMLINK",
      `Staging source cannot be a symbolic link: ${requested}`,
    );
  }
  const canonical = await realpath(requested);
  const metadata = await lstat(canonical);
  if (metadata.isFile()) return { path: canonical, kind: "file" };
  if (metadata.isDirectory()) return { path: canonical, kind: "directory" };
  throw new FoundryIntegrityError(
    "INTAKE_STAGING_SOURCE_UNSUPPORTED",
    `Staging source must be a regular file or directory: ${canonical}`,
  );
}

async function assertSafeOutput(source: { path: string; kind: "file" | "directory" }, outputInput: string): Promise<string> {
  const output = await resolveThroughExistingAncestor(outputInput);
  try {
    await lstat(output);
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_OUTPUT_EXISTS",
      `Staging output already exists: ${output}`,
    );
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (source.kind === "directory" && (isWithin(source.path, output) || isWithin(output, source.path))) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_OUTPUT_OVERLAP",
      `Staging output must not overlap the source directory: ${output}`,
    );
  }
  return output;
}

function resolveContained(root: string, relativePath: string): string {
  const safe = FoundryRelativePathSchema.parse(relativePath);
  const candidate = resolve(root, ...safe.split("/"));
  if (candidate === root || !isWithin(root, candidate)) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_PATH_ESCAPE",
      `Staging path escapes its root: ${relativePath}`,
    );
  }
  return candidate;
}

function sameFileIdentity(
  left: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number },
  right: { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number },
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function canonicalStageRoot(input: string): Promise<StageRootSnapshot> {
  const requested = resolve(input);
  const requestedBefore = await lstat(requested);
  if (requestedBefore.isSymbolicLink() || !requestedBefore.isDirectory()) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_OUTPUT_ROOT_UNSAFE",
      `Staged output root must be a regular directory, not a symbolic link or reparse-point alias: ${requested}`,
    );
  }
  const canonical = await realpath(requested);
  const [canonicalMetadata, requestedAfter] = await Promise.all([
    lstat(canonical),
    lstat(requested),
  ]);
  if (
    canonicalMetadata.isSymbolicLink() ||
    !canonicalMetadata.isDirectory() ||
    requestedAfter.isSymbolicLink() ||
    !requestedAfter.isDirectory() ||
    !sameFileIdentity(requestedBefore, requestedAfter) ||
    !sameFileIdentity(requestedAfter, canonicalMetadata)
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_OUTPUT_ROOT_CHANGED",
      `Staged output root changed while it was being resolved: ${requested}`,
    );
  }
  return { path: canonical, identity: canonicalMetadata };
}

async function assertStageRootUnchanged(root: StageRootSnapshot): Promise<void> {
  const metadata = await lstat(root.path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !sameFileIdentity(root.identity, metadata)
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_OUTPUT_ROOT_CHANGED",
      `Staged output root changed during verification: ${root.path}`,
    );
  }
}

async function copyVerifiedSource(
  sourcePath: string,
  destinationPath: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  const pathBefore = await lstat(sourcePath);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_SOURCE_NOT_REGULAR",
      `Staging source changed or is not a regular file: ${sourcePath}`,
    );
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  const source = await open(sourcePath, "r");
  let destination: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const before = await source.stat();
    if (!sameFileIdentity(pathBefore, before)) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_SOURCE_CHANGED",
        `Staging source changed before copy: ${sourcePath}`,
      );
    }
    destination = await open(destinationPath, "wx");
    const destinationBefore = await destination.stat();
    if (before.dev === destinationBefore.dev && before.ino === destinationBefore.ino) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_SOURCE_DESTINATION_ALIAS",
        `Staging source and destination resolve to the same file: ${sourcePath}`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten <= 0) {
          throw new FoundryIntegrityError(
            "INTAKE_STAGING_WRITE_STALLED",
            `Staging write made no progress: ${destinationPath}`,
          );
        }
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const [after, pathAfter, destinationMetadata] = await Promise.all([
      source.stat(),
      lstat(sourcePath),
      destination.stat(),
    ]);
    const sha256 = digest.digest("hex");
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(after, pathAfter) ||
      position !== expectedSize ||
      destinationMetadata.size !== expectedSize ||
      sha256 !== expectedSha256
    ) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_SOURCE_IDENTITY_MISMATCH",
        `Staging source bytes do not match the reviewed receipt: ${sourcePath}`,
      );
    }
  } finally {
    await destination?.close();
    await source.close();
  }
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeIndexedJson(
  root: string,
  path: string,
  role: IndexedFile["role"],
  value: unknown,
): Promise<IndexedFile> {
  const bytes = jsonBytes(value);
  const destination = resolveContained(root, path);
  await mkdir(dirname(destination), { recursive: true });
  const handle = await open(destination, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { path, role, sizeBytes: bytes.length, sha256: sha256Bytes(bytes) };
}

async function listStageFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string, parts: readonly string[]): Promise<void> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const childParts = [...parts, entry.name];
      const path = FoundryRelativePathSchema.parse(childParts.join("/"));
      const absolute = resolve(directory, entry.name);
      const metadata = await lstat(absolute);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        throw new FoundryIntegrityError(
          "INTAKE_STAGING_OUTPUT_SYMLINK",
          `Staged output contains a symbolic link: ${path}`,
        );
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        await walk(absolute, childParts);
      } else if (entry.isFile() && metadata.isFile()) {
        files.push(path);
      } else {
        throw new FoundryIntegrityError(
          "INTAKE_STAGING_OUTPUT_NON_REGULAR",
          `Staged output contains a non-regular entry: ${path}`,
        );
      }
    }
  }
  await walk(root, []);
  return files.sort();
}

async function readIndexedJson(
  root: string,
  index: FoundryIntakeStagingIndexV0,
  path: string,
): Promise<unknown> {
  const indexed = index.files.find((file) => file.path === path);
  if (indexed === undefined) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_REQUIRED_ARTIFACT_MISSING",
      `Staging index is missing required artifact: ${path}`,
    );
  }
  const bytes = await readFile(resolveContained(root, path));
  if (bytes.length !== indexed.sizeBytes || sha256Bytes(bytes) !== indexed.sha256) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_FILE_DIGEST_MISMATCH",
      `Staged output file does not match its index: ${path}`,
    );
  }
  return JSON.parse(bytes.toString("utf8"));
}

export async function verifyUniversalIntakeStage(
  outputDirectory: string,
): Promise<FoundryIntakeStagingIndexV0> {
  const rootSnapshot = await canonicalStageRoot(outputDirectory);
  const root = rootSnapshot.path;
  const indexPath = resolveContained(root, "staging-index.json");
  const indexBefore = await lstat(indexPath);
  if (
    indexBefore.isSymbolicLink() ||
    !indexBefore.isFile() ||
    indexBefore.nlink !== 1
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_INDEX_LINK_UNSAFE",
      "Staging index must be one private regular file with no hardlink alias.",
    );
  }
  const indexBytes = await readFile(indexPath);
  const indexAfter = await lstat(indexPath);
  if (
    indexAfter.isSymbolicLink() ||
    !indexAfter.isFile() ||
    indexAfter.nlink !== 1 ||
    !sameFileIdentity(indexBefore, indexAfter)
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_INDEX_CHANGED",
      "Staging index changed while it was being read.",
    );
  }
  const index = FoundryIntakeStagingIndexV0Schema.parse(
    JSON.parse(indexBytes.toString("utf8")),
  );
  const actualPaths = await listStageFiles(root);
  const expectedPaths = [...index.files.map((file) => file.path), "staging-index.json"].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_FILE_SET_MISMATCH",
      "Staged output file set does not match its exact index.",
    );
  }
  for (const file of index.files) {
    const absolutePath = resolveContained(root, file.path);
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_FILE_LINK_UNSAFE",
        `Staged output file must be one private regular file with no hardlink alias: ${file.path}`,
      );
    }
    const digest = await sha256RegularFile(absolutePath);
    const after = await lstat(absolutePath);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.nlink !== 1 ||
      !sameFileIdentity(before, after) ||
      digest.sizeBytes !== file.sizeBytes ||
      digest.sha256 !== file.sha256
    ) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_FILE_DIGEST_MISMATCH",
        `Staged output file does not match its index: ${file.path}`,
      );
    }
  }

  const receipt = FoundryUniversalIntakeReceiptSchema.parse(await readIndexedJson(
    root,
    index,
    STAGING_ARTIFACT_PATH_BY_ROLE.intake_receipt,
  ));
  const review = FoundryIntakeAdmissionReviewV0Schema.parse(await readIndexedJson(
    root,
    index,
    STAGING_ARTIFACT_PATH_BY_ROLE.admission_review,
  ));
  const result = FoundryIntakeAdmissionResultV0Schema.parse(await readIndexedJson(
    root,
    index,
    STAGING_ARTIFACT_PATH_BY_ROLE.admission_result,
  ));
  const exclusions = await readIndexedJson(
    root,
    index,
    STAGING_ARTIFACT_PATH_BY_ROLE.exclusion_ledger,
  );
  const manifest = FoundryIngestManifestV0Schema.parse(await readIndexedJson(
    root,
    index,
    STAGING_ARTIFACT_PATH_BY_ROLE.ingest_manifest,
  ));
  let recomputedResult;
  try {
    recomputedResult = admitUniversalIntakeReceipt(receipt, review);
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_ADMISSION_RECOMPILE_FAILED",
      "Staged receipt and review do not reproduce a valid admission result.",
      { cause: error },
    );
  }
  if (
    receipt.receiptSha256 !== index.receiptSha256 ||
    review.reviewSha256 !== index.reviewSha256 ||
    result.resultSha256 !== index.resultSha256 ||
    result.manifestSha256 !== index.manifestSha256 ||
    computeFoundryIngestManifestSha256(manifest) !== index.manifestSha256 ||
    stableCanonicalJson(toCanonicalJson(result.manifest)) !==
      stableCanonicalJson(toCanonicalJson(manifest)) ||
    stableCanonicalJson(toCanonicalJson(result)) !==
      stableCanonicalJson(toCanonicalJson(recomputedResult))
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_EVIDENCE_MISMATCH",
      "Staged admission evidence does not bind one receipt, review, result, and manifest.",
    );
  }
  if (
    stableCanonicalJson(toCanonicalJson(exclusions)) !==
    stableCanonicalJson(toCanonicalJson(result.exclusions))
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_EXCLUSION_LEDGER_MISMATCH",
      "Staged exclusion ledger does not match the deterministic admission result.",
    );
  }
  const sourceEntries = new Map(
    index.files
      .filter((file) => file.role === "staged_source")
      .map((file) => [file.path.slice(STAGED_SOURCE_PREFIX.length), file] as const),
  );
  if (
    sourceEntries.size !== manifest.assets.length ||
    [...sourceEntries.keys()].some(
      (path) => !manifest.assets.some((asset) => asset.relativePath === path),
    )
  ) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_ASSET_SET_MISMATCH",
      "Staged source ledger does not exactly match the admitted manifest asset set.",
    );
  }
  for (const asset of manifest.assets) {
    const staged = sourceEntries.get(asset.relativePath);
    if (
      staged === undefined ||
      staged.sizeBytes !== asset.sizeBytes ||
      `sha256:${staged.sha256}` !== asset.sha256
    ) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_ASSET_MISMATCH",
        `Staged source does not match its admitted asset: ${asset.relativePath}`,
      );
    }
  }
  await assertStageRootUnchanged(rootSnapshot);
  return index;
}

export async function stageUniversalIntakeDraft(
  options: StageUniversalIntakeDraftOptions,
): Promise<StagedUniversalIntakeDraft> {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(options.receipt);
  const review = FoundryIntakeAdmissionReviewV0Schema.parse(options.review);
  const result = admitUniversalIntakeReceipt(receipt, review);
  const source = await canonicalSourcePath(options.sourcePath);
  const output = await assertSafeOutput(source, options.outputDirectory);
  const currentReceipt = await inspectUniversalIntake(source.path);
  if (currentReceipt.receiptSha256 !== receipt.receiptSha256) {
    throw new FoundryIntegrityError(
      "INTAKE_STAGING_SOURCE_DRIFT",
      "Source bytes or tree changed after the reviewed intake receipt.",
    );
  }
  const temporary = resolve(
    dirname(output),
    `.${basename(output)}.partial-${randomUUID()}`,
  );
  const indexed: IndexedFile[] = [];
  let promoted = false;
  try {
    await mkdir(temporary, { recursive: false });
    for (const asset of result.manifest.assets) {
      let sourceFile: string;
      if (source.kind === "file") {
        if (asset.relativePath !== receipt.source.label) {
          throw new FoundryIntegrityError(
            "INTAKE_STAGING_SINGLE_FILE_PATH_MISMATCH",
            `Single-file receipt cannot resolve admitted path: ${asset.relativePath}`,
          );
        }
        sourceFile = source.path;
      } else {
        const candidate = resolveContained(source.path, asset.relativePath);
        const candidateMetadata = await lstat(candidate);
        if (candidateMetadata.isSymbolicLink() || !candidateMetadata.isFile()) {
          throw new FoundryIntegrityError(
            "INTAKE_STAGING_SOURCE_NOT_REGULAR",
            `Admitted source path is no longer a regular file: ${asset.relativePath}`,
          );
        }
        const canonical = await realpath(candidate);
        if (!isWithin(source.path, canonical)) {
          throw new FoundryIntegrityError(
            "INTAKE_STAGING_SOURCE_PATH_ESCAPE",
            `Admitted source path escapes its root: ${asset.relativePath}`,
          );
        }
        sourceFile = candidate;
      }
      const stagedPath = `source/${asset.relativePath}`;
      const destination = resolveContained(temporary, stagedPath);
      await copyVerifiedSource(
        sourceFile,
        destination,
        asset.sizeBytes,
        asset.sha256.slice("sha256:".length),
      );
      indexed.push({
        path: stagedPath,
        role: "staged_source",
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256.slice("sha256:".length),
      });
    }
    indexed.push(
      await writeIndexedJson(
        temporary,
        "evidence/intake-receipt.json",
        "intake_receipt",
        receipt,
      ),
      await writeIndexedJson(
        temporary,
        "evidence/admission-review.json",
        "admission_review",
        review,
      ),
      await writeIndexedJson(
        temporary,
        "evidence/admission-result.json",
        "admission_result",
        result,
      ),
      await writeIndexedJson(
        temporary,
        "evidence/exclusions.json",
        "exclusion_ledger",
        result.exclusions,
      ),
      await writeIndexedJson(
        temporary,
        "manifest/foundry-ingest-manifest-v0.json",
        "ingest_manifest",
        result.manifest,
      ),
    );
    indexed.sort((left, right) => left.path.localeCompare(right.path));
    const payload = StagingIndexPayloadSchema.parse({
      schemaVersion: FOUNDRY_INTAKE_STAGING_INDEX_V0,
      receiptSha256: receipt.receiptSha256,
      reviewSha256: review.reviewSha256,
      resultSha256: result.resultSha256,
      manifestSha256: result.manifestSha256,
      stagedAssetCount: result.manifest.assets.length,
      indexedFileCount: indexed.length,
      totalBytes: indexed.reduce((sum, file) => sum + file.sizeBytes, 0),
      files: indexed,
      authority: "none",
      capabilities: {
        localStaging: "completed_verified",
        jobPlanning: "not_authorized",
        execution: "not_authorized",
        modelTraining: "not_authorized",
        signing: "not_authorized",
        publication: "not_authorized",
        promotion: "not_authorized",
      },
    });
    const index = FoundryIntakeStagingIndexV0Schema.parse({
      ...payload,
      stagingSha256: stagingPayloadSha256(payload),
    });
    await writeIndexedJson(
      temporary,
      "staging-index.json",
      "admission_result",
      index,
    );
    const sourceAfterCopy = await inspectUniversalIntake(source.path);
    if (sourceAfterCopy.receiptSha256 !== receipt.receiptSha256) {
      throw new FoundryIntegrityError(
        "INTAKE_STAGING_SOURCE_DRIFT",
        "Source bytes or tree changed while staging the reviewed intake.",
      );
    }
    await rename(temporary, output);
    promoted = true;
    try {
      const verified = await verifyUniversalIntakeStage(output);
      return { outputDirectory: output, index: verified };
    } catch (error: unknown) {
      await rm(output, { recursive: true, force: true });
      throw error;
    }
  } finally {
    if (!promoted) await rm(temporary, { recursive: true, force: true });
  }
}
