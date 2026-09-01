import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { CanonicalJsonValueSchema, stableCanonicalJson } from "@omnitwin/types";
import { ImportType, initSync as initializeModuleLexer, parse as parseModule } from "es-module-lexer";
import { z } from "zod";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_CLOSED_MODULE_SURFACE_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2,
  buildGrandHallT554NativeReviewCompiledPackV2,
  type GrandHallT554NativeReviewCompiledPackBuildResultV2,
} from "./grand-hall-t554-native-review-compiled-pack-builder.js";
import {
  GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
  GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
  __testOnlyGrandHallT554NativeReviewImplementationManifestV2,
  type GrandHallT554NativeReviewImplementationManifestV2,
  type GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2,
} from "./grand-hall-t554-native-review-implementation-manifest-v2.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_SCHEMA =
  "venviewer.grand-hall-t554-native-review-stage1-candidate.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_SCHEMA =
  "venviewer.grand-hall-t554-native-review-stage1-receipt.v1";
export const GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME =
  "stage1-candidate-authority-none.json";
export const GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME =
  "receipt.json";

const CANDIDATE_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_V1";
const RECEIPT_DIGEST_DOMAIN =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_V1";
const BUILD_LABELS = Object.freeze(["build-a", "build-b"] as const);
const ROOT_ENTRY_NAMES = Object.freeze([
  BUILD_LABELS[0],
  BUILD_LABELS[1],
  GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME,
  GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME,
].sort());
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const GitShaSchema = z.string().regex(GIT_SHA_PATTERN);
const BuildLabelSchema = z.enum(BUILD_LABELS);

type Sha256 = `sha256:${string}`;
type BuildLabel = (typeof BUILD_LABELS)[number];

const Stage1BuildIdentitySchema = z.object({
  label: BuildLabelSchema,
  payloadRelativePath: BuildLabelSchema,
  manifest: z.object({
    relativePath: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
    ),
    semanticSha256: Sha256Schema,
    fileSha256: Sha256Schema,
    byteLength: z.number().int().positive(),
  }).strict(),
  memberInventorySha256: Sha256Schema,
  memberCount: z.number().int().positive(),
  totalMemberBytes: z.number().int().positive(),
  concreteBytesVerified: z.literal(true),
  exactRootInventoryVerified: z.literal(true),
  authority: z.literal("none"),
  runtimeAuthorityAvailable: z.literal(false),
}).strict();

const ManifestMemberSchema = z.object({
  relativePath: z.string().min(1).max(256),
  kind: z.string().min(1).max(80),
  sha256: Sha256Schema,
  byteLength: z.number().int().positive(),
}).strict();

const ImportantMemberBindingSchema = ManifestMemberSchema;

const CompiledModuleImportSchema = z.object({
  path: z.string().min(1).max(512),
  kind: z.enum(["import-statement", "dynamic-import"]),
  external: z.literal(true),
}).strict();

const CompiledModuleSyntaxSchema = z.object({
  nonLiteralDynamicImportCount: z.number().int().nonnegative(),
  importMetaExpressionCount: z.number().int().nonnegative(),
}).strict();

const ClosedModuleSurfaceSchema = z.object({
  fixedAdmissionCapsuleUrl: z.literal(
    GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
  ),
  externalImports: z.object({
    gate: z.array(z.string().min(1).max(512)),
    core: z.array(z.string().min(1).max(512)),
    httpAdapter: z.array(z.string().min(1).max(512)),
    runtimeBootstrap: z.array(z.string().min(1).max(512)),
    sharpLoader: z.array(z.string().min(1).max(512)),
  }).strict(),
  emittedImports: z.object({
    gate: z.array(CompiledModuleImportSchema),
    core: z.array(CompiledModuleImportSchema),
    httpAdapter: z.array(CompiledModuleImportSchema),
    runtimeBootstrap: z.array(CompiledModuleImportSchema),
    sharpLoader: z.array(CompiledModuleImportSchema),
  }).strict(),
  exports: z.object({
    gate: z.array(z.string().min(1).max(256)),
    core: z.array(z.string().min(1).max(256)),
    httpAdapter: z.array(z.string().min(1).max(256)),
    runtimeBootstrap: z.array(z.string().min(1).max(256)),
    sharpLoader: z.array(z.string().min(1).max(256)),
  }).strict(),
  moduleSyntax: z.object({
    gate: CompiledModuleSyntaxSchema,
    core: CompiledModuleSyntaxSchema,
    httpAdapter: CompiledModuleSyntaxSchema,
    runtimeBootstrap: CompiledModuleSyntaxSchema,
    sharpLoader: CompiledModuleSyntaxSchema,
  }).strict(),
  reviewerAcceptance: z.object({
    externalImportInventoryAccepted: z.literal(false),
    exportInventoryAccepted: z.literal(false),
    moduleSyntaxInventoryAccepted: z.literal(false),
    state: z.literal("human_pending"),
  }).strict(),
}).strict();

const DeterministicComparisonSchema = z.object({
  builderVersionIdentical: z.literal(true),
  canonicalManifestBytesIdentical: z.literal(true),
  memberPathsIdentical: z.literal(true),
  memberHashesIdentical: z.literal(true),
  memberLengthsIdentical: z.literal(true),
  memberInventorySha256Identical: z.literal(true),
  memberCountIdentical: z.literal(true),
  totalMemberBytesIdentical: z.literal(true),
  everyPayloadMemberByteIdentical: z.literal(true),
  closedModuleSurfaceInventoriesIdentical: z.literal(true),
  allRequiredComparisonsIdentical: z.literal(true),
}).strict();

const Stage1GuardsSchema = z.object({
  authority: z.literal("none"),
  reviewState: z.literal("human_pending"),
  stage1HashApprovalRequired: z.literal(true),
  stage1HashApproved: z.literal(false),
  stage2CapsuleIncluded: z.literal(false),
  listenerIncluded: z.literal(false),
  browserLaunchIncluded: z.literal(false),
  sourceAccessed: z.literal(false),
  sourceDecisionAuthorized: z.literal(false),
  acceptanceAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAdmissionAuthorized: z.literal(false),
  exportAuthorized: z.literal(false),
  generatedContentAuthorized: z.literal(false),
  externalNetworkAuthorized: z.literal(false),
  uploadAuthorized: z.literal(false),
  stagingAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  publicationAuthorized: z.literal(false),
  productionAuthorized: z.literal(false),
}).strict();

const Stage1CandidateMaterialSchema = z.object({
  schemaVersion: z.literal(
    GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_SCHEMA,
  ),
  state: z.literal("deterministic_unreviewed_candidate"),
  authority: z.literal("none"),
  venueSlug: z.literal("trades-hall"),
  roomSlug: z.literal("grand-hall"),
  reviewedGitSha: GitShaSchema,
  reviewedGitTreeSha: GitShaSchema,
  sourceWorktreeCleanAtBuildStart: z.literal(true),
  sourceMaterialization: z.object({
    mode: z.literal("two_independent_git_archive_snapshots"),
    snapshotCount: z.literal(2),
    liveWorktreeSourceBytesCompiled: z.literal(false),
    dependencyClosureReadFromReviewedWorkspace: z.literal(true),
  }).strict(),
  builderVersion: z.literal(
    GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2,
  ),
  buildCount: z.literal(2),
  builds: z.tuple([Stage1BuildIdentitySchema, Stage1BuildIdentitySchema]),
  deterministicComparison: DeterministicComparisonSchema,
  reviewAnchor: z.object({
    manifestSemanticSha256: Sha256Schema,
    manifestFileSha256: Sha256Schema,
    manifestFileByteLength: z.number().int().positive(),
    memberInventorySha256: Sha256Schema,
    memberCount: z.number().int().positive(),
    totalMemberBytes: z.number().int().positive(),
  }).strict(),
  members: z.array(ManifestMemberSchema).min(1).max(64),
  importantMembers: z.object({
    payloadGate: ImportantMemberBindingSchema,
    workbenchCore: ImportantMemberBindingSchema,
    httpAdapter: ImportantMemberBindingSchema,
    documentHtml: ImportantMemberBindingSchema,
    stylesheetCss: ImportantMemberBindingSchema,
    applicationJavascript: ImportantMemberBindingSchema,
    runtimeBootstrap: ImportantMemberBindingSchema,
    runtimeInspector: ImportantMemberBindingSchema,
    sharpAddon: ImportantMemberBindingSchema,
    libvipsDll: ImportantMemberBindingSchema,
    libvipsCppDll: ImportantMemberBindingSchema,
    decoderMetadata: ImportantMemberBindingSchema,
    sharpLoader: ImportantMemberBindingSchema,
    diagnosticProbe: ImportantMemberBindingSchema,
  }).strict(),
  closedModuleSurface: ClosedModuleSurfaceSchema,
  guards: Stage1GuardsSchema,
}).strict();

export const GrandHallT554NativeReviewStage1CandidateSchema =
  Stage1CandidateMaterialSchema.extend({ candidateSha256: Sha256Schema }).strict();
export type GrandHallT554NativeReviewStage1Candidate = z.infer<
  typeof GrandHallT554NativeReviewStage1CandidateSchema
>;

const ReceiptPayloadSchema = z.object({
  relativePath: z.string().min(1).max(160),
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
}).strict();

const Stage1ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(
    GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_SCHEMA,
  ),
  state: z.literal("complete_authority_none_candidate"),
  authority: z.literal("none"),
  candidateSha256: Sha256Schema,
  candidateRecord: ReceiptPayloadSchema.extend({
    relativePath: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME,
    ),
  }).strict(),
  builds: z.tuple([
    z.object({
      label: z.literal(BUILD_LABELS[0]),
      payloadRelativePath: z.literal(BUILD_LABELS[0]),
      manifest: ReceiptPayloadSchema.extend({
        relativePath: z.literal(
          `${BUILD_LABELS[0]}/${GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2}`,
        ),
      }).strict(),
      memberInventorySha256: Sha256Schema,
      memberCount: z.number().int().positive(),
      totalMemberBytes: z.number().int().positive(),
    }).strict(),
    z.object({
      label: z.literal(BUILD_LABELS[1]),
      payloadRelativePath: z.literal(BUILD_LABELS[1]),
      manifest: ReceiptPayloadSchema.extend({
        relativePath: z.literal(
          `${BUILD_LABELS[1]}/${GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2}`,
        ),
      }).strict(),
      memberInventorySha256: Sha256Schema,
      memberCount: z.number().int().positive(),
      totalMemberBytes: z.number().int().positive(),
    }).strict(),
  ]),
  rootEntryCount: z.literal(4),
  payloadFileCountPerBuild: z.number().int().positive(),
  totalFileCount: z.number().int().positive(),
  stage1HashApprovalRequired: z.literal(true),
  stage1HashApproved: z.literal(false),
  receiptWrittenLast: z.literal(true),
}).strict();

export const GrandHallT554NativeReviewStage1ReceiptSchema =
  Stage1ReceiptMaterialSchema.extend({ receiptSha256: Sha256Schema }).strict();
export type GrandHallT554NativeReviewStage1Receipt = z.infer<
  typeof GrandHallT554NativeReviewStage1ReceiptSchema
>;

export class GrandHallT554NativeReviewStage1CandidateError extends Error {
  public constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "WORKSPACE_NOT_REVIEWABLE"
      | "OUTPUT_EXISTS"
      | "BUILD_MISMATCH"
      | "OUTPUT_INVALID"
      | "PUBLISH_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554NativeReviewStage1CandidateError";
  }
}

export interface GrandHallT554NativeReviewStage1WorkspaceGitProbe {
  readonly sha: string;
  readonly treeSha: string;
  readonly clean: boolean;
}

export interface GenerateGrandHallT554NativeReviewStage1CandidateOptions {
  readonly workspaceRoot: string;
  readonly outputRoot: string;
  readonly reviewedGitSha: string;
  readonly __testOnlyWorkspaceGitProbe?: () =>
    | GrandHallT554NativeReviewStage1WorkspaceGitProbe
    | Promise<GrandHallT554NativeReviewStage1WorkspaceGitProbe>;
}

export interface CheckGrandHallT554NativeReviewStage1CandidateOptions {
  readonly outputRoot: string;
  readonly __testOnlyAfterVerifiedBuild?: (facts: {
    readonly label: BuildLabel;
    readonly packRoot: string;
  }) => Promise<void> | void;
}

export interface GrandHallT554NativeReviewStage1CandidateResult {
  readonly outputRoot: string;
  readonly candidate: GrandHallT554NativeReviewStage1Candidate;
  readonly receipt: GrandHallT554NativeReviewStage1Receipt;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(
    `${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}\n`,
    "utf8",
  );
}

function sha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticDigest(domain: string, value: unknown): Sha256 {
  return sha256(
    Buffer.from(
      `${domain}\n${stableCanonicalJson(CanonicalJsonValueSchema.parse(value))}`,
      "utf8",
    ),
  );
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\").replace(/[\\]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertDirectCanonicalDirectory(
  requestedPath: string,
  canonicalPath: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
  label: string,
): void {
  if (
    !isDirectory ||
    isSymbolicLink ||
    comparablePath(requestedPath) !== comparablePath(canonicalPath)
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      `${label} must be one direct canonical local directory.`,
    );
  }
}

async function requireDirectDirectory(path: string, label: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    const [stats, canonicalPath] = await Promise.all([
      lstat(absolutePath),
      realpath(absolutePath),
    ]);
    assertDirectCanonicalDirectory(
      absolutePath,
      canonicalPath,
      stats.isDirectory(),
      stats.isSymbolicLink(),
      label,
    );
    return canonicalPath;
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewStage1CandidateError) throw error;
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      `${label} is not readable as a direct canonical local directory.`,
      error,
    );
  }
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) return;
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      `${label} could not be checked for absence.`,
      error,
    );
  }
  throw new GrandHallT554NativeReviewStage1CandidateError(
    "OUTPUT_EXISTS",
    `${label} already exists; publication is create-only.`,
  );
}

function runGit(workspaceRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      ["-C", workspaceRoot, ...args],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          rejectPromise(new Error("Git probe command failed.", { cause: error }));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

function runExecutable(
  executable: string,
  args: readonly string[],
  label: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      executable,
      [...args],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error) => {
        if (error !== null) {
          rejectPromise(new Error(`${label} failed.`, { cause: error }));
          return;
        }
        resolvePromise();
      },
    );
  });
}

async function observeWorkspaceGit(
  workspaceRoot: string,
): Promise<GrandHallT554NativeReviewStage1WorkspaceGitProbe> {
  const shaBefore = (await runGit(workspaceRoot, ["rev-parse", "HEAD"])).trim();
  const treeSha = (
    await runGit(workspaceRoot, ["rev-parse", `${shaBefore}^{tree}`])
  ).trim();
  const statusOutput = await runGit(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const shaAfter = (await runGit(workspaceRoot, ["rev-parse", "HEAD"])).trim();
  return {
    sha: shaAfter,
    treeSha,
    clean: shaBefore === shaAfter && statusOutput.trim().length === 0,
  };
}

function requireReviewedGitSha(value: string): string {
  if (!GIT_SHA_PATTERN.test(value)) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "The reviewed Git SHA must be one exact lowercase 40-hex commit identity.",
    );
  }
  return value;
}

async function requireReviewableWorkspace(
  workspaceRoot: string,
  reviewedGitSha: string,
  seam?: () =>
    | GrandHallT554NativeReviewStage1WorkspaceGitProbe
    | Promise<GrandHallT554NativeReviewStage1WorkspaceGitProbe>,
): Promise<GrandHallT554NativeReviewStage1WorkspaceGitProbe> {
  let observed: GrandHallT554NativeReviewStage1WorkspaceGitProbe;
  try {
    observed = await (seam ?? (() => observeWorkspaceGit(workspaceRoot)))();
  } catch (error) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "WORKSPACE_NOT_REVIEWABLE",
      "The workspace Git identity and cleanliness could not be proved.",
      error,
    );
  }
  if (
    observed.sha !== reviewedGitSha ||
    !GIT_SHA_PATTERN.test(observed.treeSha) ||
    !observed.clean
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "WORKSPACE_NOT_REVIEWABLE",
      "Stage 1 requires an exact clean worktree at the explicitly reviewed Git SHA.",
    );
  }
  return observed;
}

interface GitArchiveSnapshot {
  readonly containerRoot: string;
  readonly workspaceRoot: string;
  readonly dependencyJunctions: readonly [string, string];
}

async function materializeGitArchiveSnapshot(input: {
  readonly sourceWorkspaceRoot: string;
  readonly outputParent: string;
  readonly reviewedGitSha: string;
  readonly label: BuildLabel;
}): Promise<GitArchiveSnapshot> {
  const containerRoot = await mkdtemp(
    resolve(input.outputParent, `.t554-${input.label}-source-snapshot-`),
  );
  const workspaceRoot = resolve(containerRoot, "workspace");
  const archivePath = resolve(containerRoot, "source.tar");
  const dependencyJunctions: [string, string] = [
    resolve(workspaceRoot, "node_modules"),
    resolve(workspaceRoot, "tools", "reconstruction-foundry", "node_modules"),
  ];
  try {
    await mkdir(workspaceRoot);
    await runGit(input.sourceWorkspaceRoot, [
      "archive",
      "--format=tar",
      `--output=${archivePath}`,
      input.reviewedGitSha,
    ]);
    await runExecutable(
      "tar",
      ["-xf", archivePath, "-C", workspaceRoot],
      "Git archive extraction",
    );
    await unlink(archivePath);
    const dependencyRoots: [string, string] = [
      await requireDirectDirectory(
        resolve(input.sourceWorkspaceRoot, "node_modules"),
        "Workspace dependency root",
      ),
      await requireDirectDirectory(
        resolve(
          input.sourceWorkspaceRoot,
          "tools",
          "reconstruction-foundry",
          "node_modules",
        ),
        "Foundry CLI dependency root",
      ),
    ];
    await symlink(dependencyRoots[0], dependencyJunctions[0], "junction");
    await symlink(dependencyRoots[1], dependencyJunctions[1], "junction");
    return { containerRoot, workspaceRoot, dependencyJunctions };
  } catch (error) {
    await Promise.all(
      dependencyJunctions.map(async (junction) => {
        await unlink(junction).catch(() => undefined);
      }),
    );
    await safeCleanupStagingRoot(containerRoot, input.outputParent);
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "WORKSPACE_NOT_REVIEWABLE",
      `The exact ${input.label} Git-archive source snapshot could not be materialized.`,
      error,
    );
  }
}

async function cleanupGitArchiveSnapshot(
  snapshot: GitArchiveSnapshot,
  outputParent: string,
): Promise<void> {
  for (const junction of snapshot.dependencyJunctions) {
    await unlink(junction).catch((error: unknown) => {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "PUBLISH_FAILED",
        "A temporary dependency junction could not be removed safely.",
        error,
      );
    });
  }
  await safeCleanupStagingRoot(snapshot.containerRoot, outputParent);
  try {
    await lstat(snapshot.containerRoot);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) return;
    throw error;
  }
  throw new GrandHallT554NativeReviewStage1CandidateError(
    "PUBLISH_FAILED",
    "The temporary Git-archive source snapshot was not removed.",
  );
}

export function grandHallT554NativeReviewStage1OutputIsOutsideWorkspace(
  workspaceRoot: string,
  outputRoot: string,
): boolean {
  const workspaceToOutput = relative(resolve(workspaceRoot), resolve(outputRoot));
  return (
    workspaceToOutput !== "" &&
    (isAbsolute(workspaceToOutput) ||
      workspaceToOutput === ".." ||
      workspaceToOutput.startsWith(`..${sep}`))
  );
}

function buildIdentity(
  label: BuildLabel,
  result: GrandHallT554NativeReviewCompiledPackBuildResultV2,
): z.infer<typeof Stage1BuildIdentitySchema> {
  return Stage1BuildIdentitySchema.parse({
    label,
    payloadRelativePath: label,
    manifest: {
      relativePath: GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
      semanticSha256: result.reviewedAnchorCandidate.manifestSemanticSha256,
      fileSha256: result.reviewedAnchorCandidate.manifestFileSha256,
      byteLength: result.reviewedAnchorCandidate.manifestFileByteLength,
    },
    memberInventorySha256: result.verifiedCandidate.memberInventorySha256,
    memberCount: result.verifiedCandidate.memberCount,
    totalMemberBytes: result.verifiedCandidate.totalMemberBytes,
    concreteBytesVerified: true,
    exactRootInventoryVerified: true,
    authority: "none",
    runtimeAuthorityAvailable: false,
  });
}

function canonicalStringInventory(values: readonly string[]): readonly string[] {
  return [...values].sort(lexicalOrder);
}

function canonicalCompiledImportInventory(
  values: readonly {
    readonly path: string;
    readonly kind: string;
    readonly external: boolean;
  }[],
): readonly z.infer<typeof CompiledModuleImportSchema>[] {
  return values
    .map((entry) => CompiledModuleImportSchema.parse(entry))
    .sort((left, right) => {
      const leftKey = `${left.path}\u0000${left.kind}\u0000${String(left.external)}`;
      const rightKey = `${right.path}\u0000${right.kind}\u0000${String(right.external)}`;
      return lexicalOrder(leftKey, rightKey);
    });
}

let moduleLexerInitialized = false;

function inspectPersistedCompiledModule(
  bytes: Buffer,
  label: string,
): {
  readonly imports: readonly z.infer<typeof CompiledModuleImportSchema>[];
  readonly exports: readonly string[];
  readonly syntax: z.infer<typeof CompiledModuleSyntaxSchema>;
} {
  try {
    if (!moduleLexerInitialized) {
      initializeModuleLexer();
      moduleLexerInitialized = true;
    }
    const [parsedImports, parsedExports] = parseModule(
      bytes.toString("utf8"),
      label,
    );
    const imports: z.infer<typeof CompiledModuleImportSchema>[] = [];
    let nonLiteralDynamicImportCount = 0;
    let importMetaExpressionCount = 0;
    for (const entry of parsedImports) {
      if (entry.t === ImportType.ImportMeta) {
        importMetaExpressionCount += 1;
        continue;
      }
      if (entry.t === ImportType.Dynamic && entry.n === undefined) {
        nonLiteralDynamicImportCount += 1;
        continue;
      }
      if (
        entry.n === undefined ||
        entry.n.length === 0 ||
        (entry.t !== ImportType.Static && entry.t !== ImportType.Dynamic)
      ) {
        throw new Error("Unsupported or unresolved module-import syntax.");
      }
      imports.push({
        path: entry.n,
        kind:
          entry.t === ImportType.Dynamic
            ? "dynamic-import"
            : "import-statement",
        external: true,
      });
    }
    return {
      imports: canonicalCompiledImportInventory(imports),
      exports: canonicalStringInventory(
        parsedExports.map((entry) => entry.n),
      ),
      syntax: CompiledModuleSyntaxSchema.parse({
        nonLiteralDynamicImportCount,
        importMetaExpressionCount,
      }),
    };
  } catch (error) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      `${label} could not be re-inspected as one exact persisted ESM surface.`,
      error,
    );
  }
}

async function inspectPersistedClosedModuleSurface(
  packRoot: string,
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): Promise<z.infer<typeof ClosedModuleSurfaceSchema>> {
  const lanePaths = {
    gate: manifest.admission.gateModule,
    core: manifest.admission.coreModule,
    httpAdapter: manifest.admission.trustedHttpAdapterModule,
    runtimeBootstrap: manifest.admission.runtimeBootstrapModule,
    sharpLoader: GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
  } as const;
  const laneEntries = await Promise.all(
    Object.entries(lanePaths).map(async ([lane, relativePath]) => {
      const matchingMembers = manifest.members.filter(
        (member) => member.relativePath === relativePath,
      );
      const member = matchingMembers[0];
      if (matchingMembers.length !== 1 || member === undefined) {
        throw new GrandHallT554NativeReviewStage1CandidateError(
          "OUTPUT_INVALID",
          `${lane} compiled module is missing or duplicated in the verified manifest.`,
        );
      }
      const bytes = await readFile(
        resolve(packRoot, ...relativePath.split("/")),
      );
      if (bytes.length !== member.byteLength || sha256(bytes) !== member.sha256) {
        throw new GrandHallT554NativeReviewStage1CandidateError(
          "OUTPUT_INVALID",
          `${lane} compiled module changed between manifest verification and ESM surface inspection.`,
        );
      }
      return [
        lane,
        inspectPersistedCompiledModule(bytes, `${lane} compiled module`),
      ] as const;
    }),
  );
  const lanes = Object.fromEntries(laneEntries) as Record<
    keyof typeof lanePaths,
    ReturnType<typeof inspectPersistedCompiledModule>
  >;
  return ClosedModuleSurfaceSchema.parse({
    fixedAdmissionCapsuleUrl: manifest.admission.fixedAdmissionCapsuleUrl,
    externalImports: {
      gate: canonicalStringInventory(
        lanes.gate.imports.map((entry) => entry.path),
      ),
      core: canonicalStringInventory(
        lanes.core.imports.map((entry) => entry.path),
      ),
      httpAdapter: canonicalStringInventory(
        lanes.httpAdapter.imports.map((entry) => entry.path),
      ),
      runtimeBootstrap: canonicalStringInventory(
        lanes.runtimeBootstrap.imports.map((entry) => entry.path),
      ),
      sharpLoader: canonicalStringInventory(
        lanes.sharpLoader.imports.map((entry) => entry.path),
      ),
    },
    emittedImports: {
      gate: lanes.gate.imports,
      core: lanes.core.imports,
      httpAdapter: lanes.httpAdapter.imports,
      runtimeBootstrap: lanes.runtimeBootstrap.imports,
      sharpLoader: lanes.sharpLoader.imports,
    },
    exports: {
      gate: lanes.gate.exports,
      core: lanes.core.exports,
      httpAdapter: lanes.httpAdapter.exports,
      runtimeBootstrap: lanes.runtimeBootstrap.exports,
      sharpLoader: lanes.sharpLoader.exports,
    },
    moduleSyntax: {
      gate: lanes.gate.syntax,
      core: lanes.core.syntax,
      httpAdapter: lanes.httpAdapter.syntax,
      runtimeBootstrap: lanes.runtimeBootstrap.syntax,
      sharpLoader: lanes.sharpLoader.syntax,
    },
    reviewerAcceptance: {
      externalImportInventoryAccepted: false,
      exportInventoryAccepted: false,
      moduleSyntaxInventoryAccepted: false,
      state: "human_pending",
    },
  });
}

function closedModuleSurface(
  result: GrandHallT554NativeReviewCompiledPackBuildResultV2,
): z.infer<typeof ClosedModuleSurfaceSchema> {
  const surface = ClosedModuleSurfaceSchema.parse({
    fixedAdmissionCapsuleUrl:
      GRAND_HALL_T554_NATIVE_REVIEW_FIXED_ADMISSION_CAPSULE_URL_V2,
    externalImports: {
      gate: canonicalStringInventory(result.gateExternalImports),
      core: canonicalStringInventory(result.coreExternalImports),
      httpAdapter: canonicalStringInventory(result.httpAdapterExternalImports),
      runtimeBootstrap: canonicalStringInventory(
        result.runtimeBootstrapExternalImports,
      ),
      sharpLoader: canonicalStringInventory(result.sharpLoaderExternalImports),
    },
    emittedImports: {
      gate: canonicalCompiledImportInventory(result.gateOutputImports),
      core: canonicalCompiledImportInventory(result.coreOutputImports),
      httpAdapter: canonicalCompiledImportInventory(
        result.httpAdapterOutputImports,
      ),
      runtimeBootstrap: canonicalCompiledImportInventory(
        result.runtimeBootstrapOutputImports,
      ),
      sharpLoader: canonicalCompiledImportInventory(
        result.sharpLoaderOutputImports,
      ),
    },
    exports: {
      gate: canonicalStringInventory(result.gateExports),
      core: canonicalStringInventory(result.coreExports),
      httpAdapter: canonicalStringInventory(result.httpAdapterExports),
      runtimeBootstrap: canonicalStringInventory(result.runtimeBootstrapExports),
      sharpLoader: canonicalStringInventory(result.sharpLoaderExports),
    },
    moduleSyntax:
      GRAND_HALL_T554_NATIVE_REVIEW_CLOSED_MODULE_SURFACE_V2.moduleSyntax,
    reviewerAcceptance: {
      externalImportInventoryAccepted: false,
      exportInventoryAccepted: false,
      moduleSyntaxInventoryAccepted: false,
      state: "human_pending",
    },
  });
  assertClosedModuleSurfacePolicy(surface);
  return surface;
}

function requireManifestMember(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
  relativePath: string,
): GrandHallT554NativeReviewImplementationManifestV2["members"][number] {
  const matches = manifest.members.filter(
    (member) => member.relativePath === relativePath,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      `The exact reviewed member ${relativePath} is missing or duplicated.`,
    );
  }
  return matches[0];
}

function importantMembers(
  manifest: GrandHallT554NativeReviewImplementationManifestV2,
): z.infer<
  typeof Stage1CandidateMaterialSchema
>["importantMembers"] {
  return {
    payloadGate: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_GATE_MEMBER_V2,
    ),
    workbenchCore: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_PAYLOAD_CORE_MEMBER_V2,
    ),
    httpAdapter: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_HTTP_RESPONSE_ADAPTER_MEMBER_V2,
    ),
    documentHtml: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_DOCUMENT_MEMBER_V2,
    ),
    stylesheetCss: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_STYLESHEET_MEMBER_V2,
    ),
    applicationJavascript: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_STATIC_APPLICATION_MEMBER_V2,
    ),
    runtimeBootstrap: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_BOOTSTRAP_MEMBER_V2,
    ),
    runtimeInspector: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_INSPECTOR_MEMBER_V2,
    ),
    sharpAddon: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_NATIVE_ADDON_MEMBER_V2,
    ),
    libvipsDll: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_DLL_MEMBER_V2,
    ),
    libvipsCppDll: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_LIBVIPS_CPP_DLL_MEMBER_V2,
    ),
    decoderMetadata: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_DECODER_METADATA_MEMBER_V2,
    ),
    sharpLoader: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_SHARP_LOADER_MEMBER_V2,
    ),
    diagnosticProbe: requireManifestMember(
      manifest,
      GRAND_HALL_T554_NATIVE_REVIEW_RUNTIME_PROBE_MEMBER_V2,
    ),
  };
}

async function comparePayloadMembers(
  first: GrandHallT554NativeReviewCompiledPackBuildResultV2,
  second: GrandHallT554NativeReviewCompiledPackBuildResultV2,
): Promise<void> {
  const firstMembers = first.manifest.members;
  const secondMembers = second.manifest.members;
  if (firstMembers.length !== secondMembers.length) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "BUILD_MISMATCH",
      "The two Stage 1 payloads have different member counts.",
    );
  }
  for (let index = 0; index < firstMembers.length; index += 1) {
    const left = firstMembers[index];
    const right = secondMembers[index];
    if (
      left === undefined ||
      right === undefined ||
      left.relativePath !== right.relativePath ||
      left.sha256 !== right.sha256 ||
      left.byteLength !== right.byteLength
    ) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "BUILD_MISMATCH",
        "The two Stage 1 payload member inventories are not byte-identical.",
      );
    }
    const [leftBytes, rightBytes] = await Promise.all([
      readFile(resolve(first.packRoot, ...left.relativePath.split("/"))),
      readFile(resolve(second.packRoot, ...right.relativePath.split("/"))),
    ]);
    if (!leftBytes.equals(rightBytes)) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "BUILD_MISMATCH",
        `The two Stage 1 payload bytes differ at ${left.relativePath}.`,
      );
    }
  }
}

async function compareBuilds(
  first: GrandHallT554NativeReviewCompiledPackBuildResultV2,
  second: GrandHallT554NativeReviewCompiledPackBuildResultV2,
): Promise<z.infer<typeof DeterministicComparisonSchema>> {
  const [firstManifestBytes, secondManifestBytes] = await Promise.all([
    readFile(first.manifestPath),
    readFile(second.manifestPath),
  ]);
  const manifestsEqual = firstManifestBytes.equals(secondManifestBytes);
  const firstPaths = first.manifest.members.map((member) => member.relativePath);
  const secondPaths = second.manifest.members.map((member) => member.relativePath);
  const pathsEqual = stableCanonicalJson(CanonicalJsonValueSchema.parse(firstPaths)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(secondPaths));
  const hashesEqual = first.manifest.members.every(
    (member, index) => member.sha256 === second.manifest.members[index]?.sha256,
  );
  const lengthsEqual = first.manifest.members.every(
    (member, index) => member.byteLength === second.manifest.members[index]?.byteLength,
  );
  const inventoryEqual = first.verifiedCandidate.memberInventorySha256 ===
    second.verifiedCandidate.memberInventorySha256;
  const countEqual = first.verifiedCandidate.memberCount ===
    second.verifiedCandidate.memberCount;
  const bytesEqual = first.verifiedCandidate.totalMemberBytes ===
    second.verifiedCandidate.totalMemberBytes;
  const surfacesEqual = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(closedModuleSurface(first)),
  ) === stableCanonicalJson(
    CanonicalJsonValueSchema.parse(closedModuleSurface(second)),
  );
  if (
    !manifestsEqual ||
    !pathsEqual ||
    !hashesEqual ||
    !lengthsEqual ||
    !inventoryEqual ||
    !countEqual ||
    !bytesEqual ||
    !surfacesEqual
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "BUILD_MISMATCH",
      "The two deterministic Stage 1 builds disagree on required identity facts.",
    );
  }
  await comparePayloadMembers(first, second);
  return DeterministicComparisonSchema.parse({
    builderVersionIdentical: true,
    canonicalManifestBytesIdentical: true,
    memberPathsIdentical: true,
    memberHashesIdentical: true,
    memberLengthsIdentical: true,
    memberInventorySha256Identical: true,
    memberCountIdentical: true,
    totalMemberBytesIdentical: true,
    everyPayloadMemberByteIdentical: true,
    closedModuleSurfaceInventoriesIdentical: true,
    allRequiredComparisonsIdentical: true,
  });
}

function buildCandidate(
  reviewedGitSha: string,
  reviewedGitTreeSha: string,
  first: GrandHallT554NativeReviewCompiledPackBuildResultV2,
  second: GrandHallT554NativeReviewCompiledPackBuildResultV2,
  comparison: z.infer<typeof DeterministicComparisonSchema>,
): GrandHallT554NativeReviewStage1Candidate {
  const firstIdentity = buildIdentity(BUILD_LABELS[0], first);
  const secondIdentity = buildIdentity(BUILD_LABELS[1], second);
  const material = Stage1CandidateMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_SCHEMA,
    state: "deterministic_unreviewed_candidate",
    authority: "none",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewedGitSha,
    reviewedGitTreeSha,
    sourceWorktreeCleanAtBuildStart: true,
    sourceMaterialization: {
      mode: "two_independent_git_archive_snapshots",
      snapshotCount: 2,
      liveWorktreeSourceBytesCompiled: false,
      dependencyClosureReadFromReviewedWorkspace: true,
    },
    builderVersion: GRAND_HALL_T554_NATIVE_REVIEW_COMPILED_PACK_BUILDER_V2,
    buildCount: 2,
    builds: [firstIdentity, secondIdentity],
    deterministicComparison: comparison,
    reviewAnchor: {
      manifestSemanticSha256: firstIdentity.manifest.semanticSha256,
      manifestFileSha256: firstIdentity.manifest.fileSha256,
      manifestFileByteLength: firstIdentity.manifest.byteLength,
      memberInventorySha256: firstIdentity.memberInventorySha256,
      memberCount: firstIdentity.memberCount,
      totalMemberBytes: firstIdentity.totalMemberBytes,
    },
    members: first.manifest.members,
    importantMembers: importantMembers(first.manifest),
    closedModuleSurface: closedModuleSurface(first),
    guards: {
      authority: "none",
      reviewState: "human_pending",
      stage1HashApprovalRequired: true,
      stage1HashApproved: false,
      stage2CapsuleIncluded: false,
      listenerIncluded: false,
      browserLaunchIncluded: false,
      sourceAccessed: false,
      sourceDecisionAuthorized: false,
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAdmissionAuthorized: false,
      exportAuthorized: false,
      generatedContentAuthorized: false,
      externalNetworkAuthorized: false,
      uploadAuthorized: false,
      stagingAuthorized: false,
      deploymentAuthorized: false,
      publicationAuthorized: false,
      productionAuthorized: false,
    },
  });
  return GrandHallT554NativeReviewStage1CandidateSchema.parse({
    ...material,
    candidateSha256: semanticDigest(CANDIDATE_DIGEST_DOMAIN, material),
  });
}

function receiptPayload(relativePath: string, bytes: Buffer): {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: Sha256;
} {
  return { relativePath, byteLength: bytes.length, sha256: sha256(bytes) };
}

function buildReceipt(
  candidate: GrandHallT554NativeReviewStage1Candidate,
  candidateBytes: Buffer,
  manifestBytes: readonly [Buffer, Buffer],
): GrandHallT554NativeReviewStage1Receipt {
  const first = candidate.builds[0];
  const second = candidate.builds[1];
  const material = Stage1ReceiptMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_SCHEMA,
    state: "complete_authority_none_candidate",
    authority: "none",
    candidateSha256: candidate.candidateSha256,
    candidateRecord: receiptPayload(
      GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME,
      candidateBytes,
    ),
    builds: [
      {
        label: BUILD_LABELS[0],
        payloadRelativePath: BUILD_LABELS[0],
        manifest: receiptPayload(
          `${BUILD_LABELS[0]}/${GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2}`,
          manifestBytes[0],
        ),
        memberInventorySha256: first.memberInventorySha256,
        memberCount: first.memberCount,
        totalMemberBytes: first.totalMemberBytes,
      },
      {
        label: BUILD_LABELS[1],
        payloadRelativePath: BUILD_LABELS[1],
        manifest: receiptPayload(
          `${BUILD_LABELS[1]}/${GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2}`,
          manifestBytes[1],
        ),
        memberInventorySha256: second.memberInventorySha256,
        memberCount: second.memberCount,
        totalMemberBytes: second.totalMemberBytes,
      },
    ],
    rootEntryCount: 4,
    payloadFileCountPerBuild: first.memberCount + 1,
    totalFileCount: (first.memberCount + 1) + (second.memberCount + 1) + 2,
    stage1HashApprovalRequired: true,
    stage1HashApproved: false,
    receiptWrittenLast: true,
  });
  return GrandHallT554NativeReviewStage1ReceiptSchema.parse({
    ...material,
    receiptSha256: semanticDigest(RECEIPT_DIGEST_DOMAIN, material),
  });
}

function parseCandidate(bytes: Buffer): GrandHallT554NativeReviewStage1Candidate {
  const candidate = GrandHallT554NativeReviewStage1CandidateSchema.parse(
    parseGrandHallT554StrictJson(bytes),
  );
  const { candidateSha256, ...material } = candidate;
  if (
    candidateSha256 !== semanticDigest(CANDIDATE_DIGEST_DOMAIN, material) ||
    !canonicalBytes(candidate).equals(bytes)
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The Stage 1 candidate record is not exact canonical self-bound JSON.",
    );
  }
  return candidate;
}

function parseReceipt(bytes: Buffer): GrandHallT554NativeReviewStage1Receipt {
  const receipt = GrandHallT554NativeReviewStage1ReceiptSchema.parse(
    parseGrandHallT554StrictJson(bytes),
  );
  const { receiptSha256, ...material } = receipt;
  if (
    receiptSha256 !== semanticDigest(RECEIPT_DIGEST_DOMAIN, material) ||
    !canonicalBytes(receipt).equals(bytes)
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The Stage 1 receipt is not exact canonical self-bound JSON.",
    );
  }
  return receipt;
}

async function verifyRootInventory(outputRoot: string): Promise<void> {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort(lexicalOrder);
  if (
    stableCanonicalJson(CanonicalJsonValueSchema.parse(names)) !==
    stableCanonicalJson(CanonicalJsonValueSchema.parse(ROOT_ENTRY_NAMES))
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The Stage 1 root inventory is incomplete or contains unexpected entries.",
    );
  }
  for (const entry of entries) {
    const expectedDirectory = BUILD_LABELS.some((label) => label === entry.name);
    if (
      entry.isSymbolicLink() ||
      (expectedDirectory ? !entry.isDirectory() : !entry.isFile())
    ) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "OUTPUT_INVALID",
        `The Stage 1 root entry ${entry.name} has an invalid filesystem type.`,
      );
    }
  }
}

function reviewedAnchor(
  build: z.infer<typeof Stage1BuildIdentitySchema>,
): {
  readonly manifestSemanticSha256: Sha256;
  readonly manifestFileSha256: Sha256;
  readonly manifestFileByteLength: number;
} {
  return {
    manifestSemanticSha256: build.manifest.semanticSha256 as Sha256,
    manifestFileSha256: build.manifest.fileSha256 as Sha256,
    manifestFileByteLength: build.manifest.byteLength,
  };
}

async function verifyPersistedBuild(
  outputRoot: string,
  build: z.infer<typeof Stage1BuildIdentitySchema>,
  afterVerifiedBuild?: CheckGrandHallT554NativeReviewStage1CandidateOptions["__testOnlyAfterVerifiedBuild"],
): Promise<{
  readonly manifestBytes: Buffer;
  readonly manifest: GrandHallT554NativeReviewImplementationManifestV2;
  readonly candidate: GrandHallT554VerifiedNativeReviewImplementationPackCandidateV2;
  readonly persistedClosedModuleSurface: z.infer<
    typeof ClosedModuleSurfaceSchema
  >;
}> {
  const packRoot = resolve(outputRoot, build.payloadRelativePath);
  const manifestPath = resolve(
    packRoot,
    GRAND_HALL_T554_NATIVE_REVIEW_IMPLEMENTATION_MANIFEST_FILENAME_V2,
  );
  const manifestBytes = await readFile(manifestPath);
  const manifest =
    __testOnlyGrandHallT554NativeReviewImplementationManifestV2.parseCanonicalManifestBytes(
      manifestBytes,
    );
  const candidate =
    await __testOnlyGrandHallT554NativeReviewImplementationManifestV2.verifyCandidateWithObservations(
      {
        implementationPackRoot: packRoot,
        reviewedAnchor: reviewedAnchor(build),
        runtimeIdentity: manifest.runtime,
        bootstrapExecutionIdentity: {
          compiledJavascriptModule: true,
          execArgv: [],
          nodeOptions: null,
          nodePath: null,
        },
      },
    );
  if (
    candidate.memberInventorySha256 !== build.memberInventorySha256 ||
    candidate.memberCount !== build.memberCount ||
    candidate.totalMemberBytes !== build.totalMemberBytes
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      `The persisted ${build.label} identity differs from its candidate record.`,
    );
  }
  await afterVerifiedBuild?.({ label: build.label, packRoot });
  const persistedClosedModuleSurface =
    await inspectPersistedClosedModuleSurface(packRoot, manifest);
  return { manifestBytes, manifest, candidate, persistedClosedModuleSurface };
}

function assertClosedModuleSurfacePolicy(
  surface: z.infer<typeof ClosedModuleSurfaceSchema>,
): void {
  const exactSurface = {
    ...GRAND_HALL_T554_NATIVE_REVIEW_CLOSED_MODULE_SURFACE_V2,
    reviewerAcceptance: {
      externalImportInventoryAccepted: false,
      exportInventoryAccepted: false,
      moduleSyntaxInventoryAccepted: false,
      state: "human_pending",
    },
  };
  if (!canonicalEqual(surface, exactSurface)) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The candidate import/export surface differs from the exact complete per-module facts enforced by the reviewed builder.",
    );
  }
}

function assertCandidatePayloadBindings(
  candidateRecord: GrandHallT554NativeReviewStage1Candidate,
  first: Awaited<ReturnType<typeof verifyPersistedBuild>>,
  second: Awaited<ReturnType<typeof verifyPersistedBuild>>,
): void {
  const firstBuild = candidateRecord.builds[0];
  const secondBuild = candidateRecord.builds[1];
  const exactAnchor = {
    manifestSemanticSha256: first.candidate.manifestBinding.semanticSha256,
    manifestFileSha256: first.candidate.manifestBinding.fileSha256,
    manifestFileByteLength: first.candidate.manifestBinding.byteLength,
    memberInventorySha256: first.candidate.memberInventorySha256,
    memberCount: first.candidate.memberCount,
    totalMemberBytes: first.candidate.totalMemberBytes,
  };
  if (
    firstBuild.label !== BUILD_LABELS[0] ||
    firstBuild.payloadRelativePath !== BUILD_LABELS[0] ||
    secondBuild.label !== BUILD_LABELS[1] ||
    secondBuild.payloadRelativePath !== BUILD_LABELS[1] ||
    !canonicalEqual(candidateRecord.reviewAnchor, exactAnchor) ||
    !canonicalEqual(candidateRecord.members, first.manifest.members) ||
    !canonicalEqual(candidateRecord.importantMembers, importantMembers(first.manifest)) ||
    !canonicalEqual(first.manifest.members, second.manifest.members) ||
    !canonicalEqual(
      candidateRecord.closedModuleSurface,
      first.persistedClosedModuleSurface,
    ) ||
    !canonicalEqual(
      first.persistedClosedModuleSurface,
      second.persistedClosedModuleSurface,
    )
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The candidate review tuple is not bound to both exact verified payloads.",
    );
  }
  assertClosedModuleSurfacePolicy(candidateRecord.closedModuleSurface);
}

function assertReceiptBindings(
  receipt: GrandHallT554NativeReviewStage1Receipt,
  candidate: GrandHallT554NativeReviewStage1Candidate,
  candidateBytes: Buffer,
  manifestBytes: readonly [Buffer, Buffer],
): void {
  if (
    receipt.candidateSha256 !== candidate.candidateSha256 ||
    receipt.candidateRecord.byteLength !== candidateBytes.length ||
    receipt.candidateRecord.sha256 !== sha256(candidateBytes) ||
    receipt.rootEntryCount !== ROOT_ENTRY_NAMES.length ||
    receipt.payloadFileCountPerBuild !== candidate.builds[0].memberCount + 1 ||
    receipt.totalFileCount !==
      candidate.builds[0].memberCount +
        candidate.builds[1].memberCount +
        4
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The receipt does not bind the exact Stage 1 candidate record.",
    );
  }
  for (let index = 0; index < receipt.builds.length; index += 1) {
    const receiptBuild = receipt.builds[index];
    const candidateBuild = candidate.builds[index];
    const exactManifestBytes = manifestBytes[index];
    if (
      receiptBuild === undefined ||
      candidateBuild === undefined ||
      exactManifestBytes === undefined ||
      receiptBuild.label !== candidateBuild.label ||
      receiptBuild.memberInventorySha256 !== candidateBuild.memberInventorySha256 ||
      receiptBuild.memberCount !== candidateBuild.memberCount ||
      receiptBuild.totalMemberBytes !== candidateBuild.totalMemberBytes ||
      receiptBuild.manifest.byteLength !== exactManifestBytes.length ||
      receiptBuild.manifest.sha256 !== sha256(exactManifestBytes)
    ) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "OUTPUT_INVALID",
        "The receipt does not bind both exact Stage 1 payloads.",
      );
    }
  }
}

async function safeCleanupStagingRoot(
  stagingRoot: string,
  outputParent: string,
): Promise<void> {
  const parentRelative = relative(outputParent, stagingRoot);
  if (
    parentRelative.length === 0 ||
    parentRelative === ".." ||
    parentRelative.startsWith(`..${sep}`) ||
    parentRelative.includes(sep)
  ) return;
  try {
    const stats = await lstat(stagingRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return;
    await rm(stagingRoot, { force: false, recursive: true });
  } catch {
    // Best-effort cleanup only; the original failure remains the useful cause.
  }
}

export async function checkGrandHallT554NativeReviewStage1Candidate(
  options: CheckGrandHallT554NativeReviewStage1CandidateOptions,
): Promise<GrandHallT554NativeReviewStage1CandidateResult> {
  if (!isAbsolute(options.outputRoot)) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "The Stage 1 output root must be absolute.",
    );
  }
  const outputRoot = await requireDirectDirectory(options.outputRoot, "Stage 1 root");
  try {
    await verifyRootInventory(outputRoot);
    const [candidateBytes, receiptBytes] = await Promise.all([
      readFile(
        resolve(outputRoot, GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME),
      ),
      readFile(
        resolve(outputRoot, GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME),
      ),
    ]);
    const candidate = parseCandidate(candidateBytes);
    const receipt = parseReceipt(receiptBytes);
    const [first, second] = await Promise.all([
      verifyPersistedBuild(
        outputRoot,
        candidate.builds[0],
        options.__testOnlyAfterVerifiedBuild,
      ),
      verifyPersistedBuild(
        outputRoot,
        candidate.builds[1],
        options.__testOnlyAfterVerifiedBuild,
      ),
    ]);
    if (
      !first.manifestBytes.equals(second.manifestBytes) ||
      stableCanonicalJson(CanonicalJsonValueSchema.parse(first.manifest.members)) !==
        stableCanonicalJson(CanonicalJsonValueSchema.parse(second.manifest.members))
    ) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "OUTPUT_INVALID",
        "The persisted Stage 1 payloads are no longer deterministic twins.",
      );
    }
    assertCandidatePayloadBindings(candidate, first, second);
    assertReceiptBindings(
      receipt,
      candidate,
      candidateBytes,
      [first.manifestBytes, second.manifestBytes],
    );
    await verifyRootInventory(outputRoot);
    return Object.freeze({ outputRoot, candidate, receipt });
  } catch (error) {
    if (error instanceof GrandHallT554NativeReviewStage1CandidateError) throw error;
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "OUTPUT_INVALID",
      "The persisted Stage 1 candidate could not be verified exactly.",
      error,
    );
  }
}

export async function generateGrandHallT554NativeReviewStage1Candidate(
  options: GenerateGrandHallT554NativeReviewStage1CandidateOptions,
): Promise<GrandHallT554NativeReviewStage1CandidateResult> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "The Stage 1 payload closure is pinned to Windows x64.",
    );
  }
  if (!isAbsolute(options.workspaceRoot) || !isAbsolute(options.outputRoot)) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "Workspace and Stage 1 output roots must be absolute.",
    );
  }
  const reviewedGitSha = requireReviewedGitSha(options.reviewedGitSha);
  const workspaceRoot = await requireDirectDirectory(options.workspaceRoot, "Workspace root");
  const requestedOutputRoot = resolve(options.outputRoot);
  const outputParent = await requireDirectDirectory(
    dirname(requestedOutputRoot),
    "Stage 1 output parent",
  );
  const outputLeaf = relative(outputParent, requestedOutputRoot);
  if (
    outputLeaf.length === 0 ||
    outputLeaf === "." ||
    outputLeaf === ".." ||
    outputLeaf.includes(sep)
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "The Stage 1 output root must have one concrete absent leaf.",
    );
  }
  if (
    !grandHallT554NativeReviewStage1OutputIsOutsideWorkspace(
      workspaceRoot,
      requestedOutputRoot,
    )
  ) {
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "ARGUMENT_INVALID",
      "The Stage 1 candidate must be built outside the Git workspace.",
    );
  }
  await requireAbsent(requestedOutputRoot, "Stage 1 output root");
  const initialGit = await requireReviewableWorkspace(
    workspaceRoot,
    reviewedGitSha,
    options.__testOnlyWorkspaceGitProbe,
  );

  let stagingRoot: string | undefined;
  let sourceSnapshot: GitArchiveSnapshot | undefined;
  try {
    stagingRoot = await mkdtemp(resolve(outputParent, `.${outputLeaf}.staging-`));
    sourceSnapshot = await materializeGitArchiveSnapshot({
      sourceWorkspaceRoot: workspaceRoot,
      outputParent,
      reviewedGitSha,
      label: BUILD_LABELS[0],
    });
    const first = await buildGrandHallT554NativeReviewCompiledPackV2({
      workspaceRoot: sourceSnapshot.workspaceRoot,
      outputRoot: resolve(stagingRoot, BUILD_LABELS[0]),
    });
    await cleanupGitArchiveSnapshot(sourceSnapshot, outputParent);
    sourceSnapshot = undefined;
    const betweenGit = await requireReviewableWorkspace(
      workspaceRoot,
      reviewedGitSha,
      options.__testOnlyWorkspaceGitProbe,
    );
    if (betweenGit.treeSha !== initialGit.treeSha) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "WORKSPACE_NOT_REVIEWABLE",
        "The reviewed Git tree changed between independent source snapshots.",
      );
    }
    sourceSnapshot = await materializeGitArchiveSnapshot({
      sourceWorkspaceRoot: workspaceRoot,
      outputParent,
      reviewedGitSha,
      label: BUILD_LABELS[1],
    });
    const second = await buildGrandHallT554NativeReviewCompiledPackV2({
      workspaceRoot: sourceSnapshot.workspaceRoot,
      outputRoot: resolve(stagingRoot, BUILD_LABELS[1]),
    });
    await cleanupGitArchiveSnapshot(sourceSnapshot, outputParent);
    sourceSnapshot = undefined;
    const comparison = await compareBuilds(first, second);
    const afterBuildGit = await requireReviewableWorkspace(
      workspaceRoot,
      reviewedGitSha,
      options.__testOnlyWorkspaceGitProbe,
    );
    if (afterBuildGit.treeSha !== initialGit.treeSha) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "WORKSPACE_NOT_REVIEWABLE",
        "The reviewed Git tree changed during Stage 1 compilation.",
      );
    }
    const candidate = buildCandidate(
      reviewedGitSha,
      initialGit.treeSha,
      first,
      second,
      comparison,
    );
    const candidateBytes = canonicalBytes(candidate);
    await writeFile(
      resolve(stagingRoot, GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_CANDIDATE_FILENAME),
      candidateBytes,
      { flag: "wx", mode: 0o600 },
    );
    const manifestBytes: [Buffer, Buffer] = [
      await readFile(first.manifestPath),
      await readFile(second.manifestPath),
    ];
    const receipt = buildReceipt(candidate, candidateBytes, manifestBytes);
    await writeFile(
      resolve(stagingRoot, GRAND_HALL_T554_NATIVE_REVIEW_STAGE1_RECEIPT_FILENAME),
      canonicalBytes(receipt),
      { flag: "wx", mode: 0o600 },
    );
    await checkGrandHallT554NativeReviewStage1Candidate({ outputRoot: stagingRoot });
    const beforePublishGit = await requireReviewableWorkspace(
      workspaceRoot,
      reviewedGitSha,
      options.__testOnlyWorkspaceGitProbe,
    );
    if (beforePublishGit.treeSha !== initialGit.treeSha) {
      throw new GrandHallT554NativeReviewStage1CandidateError(
        "WORKSPACE_NOT_REVIEWABLE",
        "The reviewed Git tree changed before Stage 1 publication.",
      );
    }
    await requireAbsent(requestedOutputRoot, "Stage 1 output root");
    await rename(stagingRoot, requestedOutputRoot);
    stagingRoot = undefined;
    return await checkGrandHallT554NativeReviewStage1Candidate({
      outputRoot: requestedOutputRoot,
    });
  } catch (error) {
    if (sourceSnapshot !== undefined) {
      await cleanupGitArchiveSnapshot(sourceSnapshot, outputParent).catch(
        () => undefined,
      );
    }
    if (stagingRoot !== undefined) {
      await safeCleanupStagingRoot(stagingRoot, outputParent);
    }
    if (error instanceof GrandHallT554NativeReviewStage1CandidateError) throw error;
    throw new GrandHallT554NativeReviewStage1CandidateError(
      "PUBLISH_FAILED",
      "The deterministic Stage 1 candidate stopped before publication.",
      error,
    );
  }
}
