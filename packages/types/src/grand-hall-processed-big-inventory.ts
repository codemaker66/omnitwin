import { z } from "zod";

import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimeSha256Schema } from "./runtime-venue-manifest.js";

/**
 * Path-redacted, authority-none byte inventory for the processed BIG export
 * collection. This contract records packaging and member byte identities only.
 */
export const GRAND_HALL_PROCESSED_BIG_INVENTORY_V1 =
  "venviewer.grand-hall.processed-big-inventory.v1";
export const GRAND_HALL_PROCESSED_BIG_INVENTORY_DIGEST_DOMAIN =
  "OMNITWIN_GRAND_HALL_PROCESSED_BIG_SOURCE_INVENTORY_V1";
export const GRAND_HALL_PROCESSED_BIG_MANIFEST_DIGEST_DOMAIN =
  "OMNITWIN_GRAND_HALL_PROCESSED_BIG_SOURCE_MANIFEST_V1";
export const GRAND_HALL_PROCESSED_BIG_COLLECTION_ID =
  "trades-hall-grand-hall-processed-big-variations";
export const GRAND_HALL_PROCESSED_BIG_MODEL_GUID =
  "2d483e031ad40e259c75f765d6f5fcbb";
export const GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256 =
  "sha256:1369a3e897e8c6509abc69605ec87de7378fe0a7c38777c24eba95862cbb63fd";
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT = 399;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES = 5_056_057_926;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT = 95;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT = 60;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGE_COUNT = 9;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_DUPLICATE_EXCESS_FILE_COUNT =
  GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT -
  GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT;
export const GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH =
  "scans_BIG_MODEL_TH_GH_2/mesh-files/Grand_Hall.obj";
export const GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES = 2_222_742;
export const GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256 =
  "sha256:ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6";

export const GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES = [
  {
    packageName: "scans_BIG_MODEL_TH_GH_1",
    fileCount: 60,
    totalBytes: 214_350_601,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_2",
    fileCount: 61,
    totalBytes: 216_573_343,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_3",
    fileCount: 61,
    totalBytes: 215_536_243,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_4",
    fileCount: 60,
    totalBytes: 340_454_888,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_5",
    fileCount: 61,
    totalBytes: 342_677_630,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_6",
    fileCount: 61,
    totalBytes: 341_640_530,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_7",
    fileCount: 12,
    totalBytes: 1_129_361_511,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_8",
    fileCount: 12,
    totalBytes: 1_128_324_411,
  },
  {
    packageName: "scans_BIG_MODEL_TH_GH_9",
    fileCount: 11,
    totalBytes: 1_127_138_769,
  },
] as const;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES = [
  "scans_BIG_MODEL_TH_GH_1/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_2/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_3/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_4/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_5/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_6/lcc2-result/info/media",
  "scans_BIG_MODEL_TH_GH_7/lcc-result/assets/media",
  "scans_BIG_MODEL_TH_GH_8/lcc-result/assets/media",
  "scans_BIG_MODEL_TH_GH_9/lcc-result/assets/media",
] as const;
export const GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORY_COUNT =
  GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES.length;

const SAFE_ARTIFACT_ID = /^[a-z0-9][a-z0-9._:-]*$/u;

function canonicalDigest(domain: string, value: unknown): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return `sha256:${sha256Hex(`${domain}\u0000${stableCanonicalJson(canonical)}`)}`;
}

function isPrintableAscii(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint > 0x7e) {
      return false;
    }
  }
  return true;
}

function validateRelativePosixPathShape(
  relativePath: string,
  ctx: z.RefinementCtx,
): void {
  if (!isPrintableAscii(relativePath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "relative paths must contain printable ASCII characters only",
    });
  }
  if (relativePath.includes("\\") || relativePath.startsWith("/")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "relative paths must use POSIX separators and cannot be absolute",
    });
  }
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment !== segment.trim() ||
      /[<>:"|?*]/u.test(segment)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "relative paths cannot contain empty, traversal, padded, or Windows-special segments",
      });
      return;
    }
  }
}

function validateMemberRelativePosixPath(
  relativePath: string,
  ctx: z.RefinementCtx,
): void {
  validateRelativePosixPathShape(relativePath, ctx);
  if (relativePath.split("/").length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "member paths must be nested beneath a top-level package",
    });
  }
}

export const GrandHallProcessedBigRelativePathSchema = z
  .string()
  .min(3)
  .max(1_024)
  .superRefine(validateMemberRelativePosixPath);
export type GrandHallProcessedBigRelativePath = z.infer<
  typeof GrandHallProcessedBigRelativePathSchema
>;

export const GrandHallProcessedBigDirectoryRelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .superRefine(validateRelativePosixPathShape);
export type GrandHallProcessedBigDirectoryRelativePath = z.infer<
  typeof GrandHallProcessedBigDirectoryRelativePathSchema
>;

export const GrandHallProcessedBigInventoryMemberSchema = z
  .object({
    relativePath: GrandHallProcessedBigRelativePathSchema,
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: RuntimeSha256Schema,
  })
  .strict();
export type GrandHallProcessedBigInventoryMember = z.infer<
  typeof GrandHallProcessedBigInventoryMemberSchema
>;

function validateMemberOrderingAndIdentity(
  members: readonly GrandHallProcessedBigInventoryMember[],
  ctx: z.RefinementCtx,
): void {
  const caseFoldedPaths = new Set<string>();
  const sizeBySha256 = new Map<string, number>();
  const expectedPackageNames = new Set<string>(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.map(
      (entry) => entry.packageName,
    ),
  );
  for (const [index, member] of members.entries()) {
    const previous = members[index - 1];
    if (previous !== undefined && previous.relativePath >= member.relativePath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "relativePath"],
        message: "members must have unique, strictly ASCII-sorted relative paths",
      });
    }
    const caseFoldedPath = member.relativePath.toLowerCase();
    if (caseFoldedPaths.has(caseFoldedPath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "relativePath"],
        message: "member paths must also be unique under Windows case folding",
      });
    }
    caseFoldedPaths.add(caseFoldedPath);
    const packageName = member.relativePath.split("/")[0] ?? "";
    if (!expectedPackageNames.has(packageName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "relativePath"],
        message: "member path is not beneath one of the nine audited packages",
      });
    }
    const priorSize = sizeBySha256.get(member.sha256);
    if (priorSize !== undefined && priorSize !== member.sizeBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "sizeBytes"],
        message: "members with the same content digest must have the same byte size",
      });
    }
    sizeBySha256.set(member.sha256, member.sizeBytes);
  }
  const chosenObj = members.find(
    (member) =>
      member.relativePath === GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  );
  if (
    chosenObj === undefined ||
    chosenObj.sizeBytes !== GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES ||
    chosenObj.sha256 !== GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "members must bind the exact audited Grand Hall BIG OBJ identity",
    });
  }
}

export const GrandHallProcessedBigInventoryMembersSchema = z
  .array(GrandHallProcessedBigInventoryMemberSchema)
  .length(GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT)
  .superRefine(validateMemberOrderingAndIdentity);

function validateDirectoryEnvelopeShape(
  directories: readonly GrandHallProcessedBigDirectoryRelativePath[],
  ctx: z.RefinementCtx,
): void {
  const directorySet = new Set(directories);
  const caseFolded = new Set<string>();
  const expectedPackages = new Set<string>(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.map(
      (entry) => entry.packageName,
    ),
  );
  for (const [index, directory] of directories.entries()) {
    const previous = directories[index - 1];
    if (previous !== undefined && previous >= directory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "directories must be unique and strictly ASCII-sorted",
      });
    }
    const folded = directory.toLowerCase();
    if (caseFolded.has(folded)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "directories must be unique under Windows case folding",
      });
    }
    caseFolded.add(folded);
    const segments = directory.split("/");
    if (!expectedPackages.has(segments[0] ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "directory is not beneath one of the nine audited packages",
      });
    }
    if (segments.length > 1) {
      const parent = segments.slice(0, -1).join("/");
      if (!directorySet.has(parent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "every directory parent must be present in the envelope",
        });
      }
    }
  }
  const topLevel = directories.filter((directory) => !directory.includes("/"));
  const expectedTopLevel = GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.map(
    (entry) => entry.packageName,
  );
  if (stableCanonicalJson(topLevel) !== stableCanonicalJson(expectedTopLevel)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "directory envelope must contain the exact nine top-level packages",
    });
  }
  for (const emptyDirectory of GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES) {
    if (!directorySet.has(emptyDirectory)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "directory envelope is missing an audited empty directory",
      });
    }
  }
}

export const GrandHallProcessedBigDirectoriesSchema = z
  .array(GrandHallProcessedBigDirectoryRelativePathSchema)
  .length(GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT)
  .superRefine(validateDirectoryEnvelopeShape);
export type GrandHallProcessedBigDirectories = z.infer<
  typeof GrandHallProcessedBigDirectoriesSchema
>;

export const GrandHallProcessedBigDuplicateGroupSchema = z
  .object({
    sha256: RuntimeSha256Schema,
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    relativePaths: z
      .array(GrandHallProcessedBigRelativePathSchema)
      .min(2)
      .max(GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT),
  })
  .strict()
  .superRefine((group, ctx) => {
    for (let index = 1; index < group.relativePaths.length; index += 1) {
      const previous = group.relativePaths[index - 1];
      const current = group.relativePaths[index];
      if (previous !== undefined && current !== undefined && previous >= current) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relativePaths", index],
          message: "duplicate relative paths must be unique and strictly sorted",
        });
      }
    }
  });
export type GrandHallProcessedBigDuplicateGroup = z.infer<
  typeof GrandHallProcessedBigDuplicateGroupSchema
>;

const GrandHallProcessedBigDuplicateGroupsSchema = z
  .array(GrandHallProcessedBigDuplicateGroupSchema)
  .max(GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT)
  .superRefine((groups, ctx) => {
    for (let index = 1; index < groups.length; index += 1) {
      const previous = groups[index - 1];
      const current = groups[index];
      if (previous !== undefined && current !== undefined && previous.sha256 >= current.sha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sha256"],
          message: "duplicate groups must have unique, strictly sorted digests",
        });
      }
    }
  });

export const GrandHallProcessedBigInventorySummarySchema = z
  .object({
    fileCount: z.literal(GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT),
    totalBytes: z.literal(GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES),
    uniqueContentSha256Count: z.literal(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT,
    ),
    directoryCount: z.literal(GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT),
    topLevelPackageCount: z.literal(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGE_COUNT,
    ),
    duplicateContentGroupCount: z
      .number()
      .int()
      .positive()
      .max(GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT),
    duplicateMemberCount: z
      .number()
      .int()
      .min(GRAND_HALL_PROCESSED_BIG_EXPECTED_DUPLICATE_EXCESS_FILE_COUNT + 1)
      .max(GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT),
    duplicateExcessFileCount: z.literal(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_DUPLICATE_EXCESS_FILE_COUNT,
    ),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (
      summary.duplicateMemberCount - summary.duplicateContentGroupCount !==
      summary.duplicateExcessFileCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duplicateExcessFileCount"],
        message:
          "duplicate excess must equal duplicate members minus duplicate groups",
      });
    }
  });
export type GrandHallProcessedBigInventorySummary = z.infer<
  typeof GrandHallProcessedBigInventorySummarySchema
>;

function exactTopLevelPackageSchema(
  expected: (typeof GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES)[number],
) {
  return z
    .object({
      packageName: z.literal(expected.packageName),
      fileCount: z.literal(expected.fileCount),
      totalBytes: z.literal(expected.totalBytes),
    })
    .strict();
}

export const GrandHallProcessedBigTopLevelPackagesSchema = z.tuple([
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[0],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[1],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[2],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[3],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[4],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[5],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[6],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[7],
  ),
  exactTopLevelPackageSchema(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[8],
  ),
]);
export type GrandHallProcessedBigTopLevelPackages = z.infer<
  typeof GrandHallProcessedBigTopLevelPackagesSchema
>;

function topLevelPackageSummariesFromMembers(
  members: readonly GrandHallProcessedBigInventoryMember[],
): { packageName: string; fileCount: number; totalBytes: number }[] {
  return GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.map(
    (expected) => {
      const packageMembers = members.filter((member) =>
        member.relativePath.startsWith(`${expected.packageName}/`),
      );
      return {
        packageName: expected.packageName,
        fileCount: packageMembers.length,
        totalBytes: packageMembers.reduce(
          (total, member) => total + member.sizeBytes,
          0,
        ),
      };
    },
  );
}

function topLevelPackagesFromValidatedMembers(
  members: readonly GrandHallProcessedBigInventoryMember[],
): GrandHallProcessedBigTopLevelPackages {
  return GrandHallProcessedBigTopLevelPackagesSchema.parse(
    topLevelPackageSummariesFromMembers(members),
  );
}

export function computeGrandHallProcessedBigTopLevelPackages(
  members: readonly GrandHallProcessedBigInventoryMember[],
): GrandHallProcessedBigTopLevelPackages {
  const parsed = GrandHallProcessedBigInventoryMembersSchema.parse([...members]);
  return topLevelPackagesFromValidatedMembers(parsed);
}

function duplicateGroupsFromValidatedMembers(
  members: readonly GrandHallProcessedBigInventoryMember[],
): GrandHallProcessedBigDuplicateGroup[] {
  const membersBySha256 = new Map<
    string,
    GrandHallProcessedBigInventoryMember[]
  >();
  for (const member of members) {
    const existing = membersBySha256.get(member.sha256) ?? [];
    existing.push(member);
    membersBySha256.set(member.sha256, existing);
  }
  return [...membersBySha256.entries()]
    .filter(([, groupedMembers]) => groupedMembers.length > 1)
    .sort(([leftSha256], [rightSha256]) =>
      leftSha256 < rightSha256 ? -1 : leftSha256 > rightSha256 ? 1 : 0,
    )
    .map(([sha256, groupedMembers]) => ({
      sha256,
      sizeBytes: groupedMembers[0]?.sizeBytes ?? 0,
      relativePaths: groupedMembers.map((member) => member.relativePath).sort(),
    })) as GrandHallProcessedBigDuplicateGroup[];
}

export function computeGrandHallProcessedBigDuplicateGroups(
  members: readonly GrandHallProcessedBigInventoryMember[],
): GrandHallProcessedBigDuplicateGroup[] {
  const parsed = GrandHallProcessedBigInventoryMembersSchema.parse([...members]);
  return GrandHallProcessedBigDuplicateGroupsSchema.parse(
    duplicateGroupsFromValidatedMembers(parsed),
  );
}

function memberDerivedDirectoryPaths(
  members: readonly GrandHallProcessedBigInventoryMember[],
): string[] {
  const directories = new Set<string>();
  for (const member of members) {
    const segments = member.relativePath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      directories.add(segments.slice(0, end).join("/"));
    }
  }
  return [...directories].sort();
}

function directoryEnvelopeMatchesMembers(
  members: readonly GrandHallProcessedBigInventoryMember[],
  directories: readonly GrandHallProcessedBigDirectoryRelativePath[],
): boolean {
  const directorySet = new Set(directories);
  const caseFoldedMemberPaths = new Set(
    members.map((member) => member.relativePath.toLowerCase()),
  );
  const derivedDirectories = memberDerivedDirectoryPaths(members);
  if (
    derivedDirectories.some((directory) => !directorySet.has(directory)) ||
    directories.some((directory) =>
      caseFoldedMemberPaths.has(directory.toLowerCase()),
    )
  ) {
    return false;
  }
  const derivedSet = new Set(derivedDirectories);
  const emptyDirectories = directories.filter(
    (directory) => !derivedSet.has(directory),
  );
  return (
    stableCanonicalJson(emptyDirectories) ===
    stableCanonicalJson(GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES)
  );
}

function summaryFromValidatedInventory(
  members: readonly GrandHallProcessedBigInventoryMember[],
  directories: readonly GrandHallProcessedBigDirectoryRelativePath[],
): Record<keyof GrandHallProcessedBigInventorySummary, number> {
  const duplicateGroups = duplicateGroupsFromValidatedMembers(members);
  const duplicateMemberCount = duplicateGroups.reduce(
    (total, group) => total + group.relativePaths.length,
    0,
  );
  return {
    fileCount: members.length,
    totalBytes: members.reduce((total, member) => total + member.sizeBytes, 0),
    uniqueContentSha256Count: new Set(members.map((member) => member.sha256)).size,
    directoryCount: directories.length,
    topLevelPackageCount: directories.filter(
      (directory) => !directory.includes("/"),
    ).length,
    duplicateContentGroupCount: duplicateGroups.length,
    duplicateMemberCount,
    duplicateExcessFileCount: duplicateMemberCount - duplicateGroups.length,
  };
}

export function computeGrandHallProcessedBigInventorySummary(
  members: readonly GrandHallProcessedBigInventoryMember[],
  directories: readonly GrandHallProcessedBigDirectoryRelativePath[],
): GrandHallProcessedBigInventorySummary {
  const parsedMembers = GrandHallProcessedBigInventoryMembersSchema.parse([
    ...members,
  ]);
  const parsedDirectories = GrandHallProcessedBigDirectoriesSchema.parse([
    ...directories,
  ]);
  if (!directoryEnvelopeMatchesMembers(parsedMembers, parsedDirectories)) {
    throw new Error(
      "directory envelope must contain every member parent and exactly the nine audited empty directories",
    );
  }
  return GrandHallProcessedBigInventorySummarySchema.parse(
    summaryFromValidatedInventory(parsedMembers, parsedDirectories),
  );
}

export const GRAND_HALL_PROCESSED_BIG_SOURCE_V1 = {
  collectionId: GRAND_HALL_PROCESSED_BIG_COLLECTION_ID,
  sourceKind: "xgrids_lcc_processed_big_model_variation_collection",
  processedBigModelGuid: GRAND_HALL_PROCESSED_BIG_MODEL_GUID,
  sourceRoot: null,
  pathPolicy: "source_root_redacted_relative_posix_paths_only",
  sourceAuthority: "none",
} as const;

export const GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1 = {
  authority: "none",
  proofScope: "packaging_and_member_byte_identity_only",
  architecturalEvidence: false,
  roomMembershipAuthority: "none",
  cleanupDecisionAccepted: false,
  coordinateAuthority: "none",
  transformAuthority: "none",
  outputMask: null,
  runtimeAdmission: null,
  deploymentAuthorization: null,
  publicationAuthorization: null,
  productionTrust: null,
  humanReviewRequiredBeforeAnyPromotion: true,
  permitsRoomMembershipAcceptance: false,
  permitsCoordinateAcceptance: false,
  permitsTransformAcceptance: false,
  permitsOutputMasking: false,
  permitsRuntimeUse: false,
  permitsDeployment: false,
  permitsPublication: false,
} as const;

export const GRAND_HALL_PROCESSED_BIG_PROOF_V1 = {
  authority: "none",
  exactTreeStableBeforeAndAfter: true,
  everyFileHashedFromOneStableOpenHandle: true,
  noLinksReparsePointsOrHardlinks: true,
  noCaseFoldCollisions: true,
  filesystemMetadataSerialized: false,
  sourceWrites: "none",
  networkAccess: "none",
} as const;

export const GrandHallProcessedBigSourceV1Schema = z
  .object({
    collectionId: z.literal(GRAND_HALL_PROCESSED_BIG_COLLECTION_ID),
    sourceKind: z.literal(
      "xgrids_lcc_processed_big_model_variation_collection",
    ),
    processedBigModelGuid: z.literal(GRAND_HALL_PROCESSED_BIG_MODEL_GUID),
    sourceRoot: z.null(),
    pathPolicy: z.literal("source_root_redacted_relative_posix_paths_only"),
    sourceAuthority: z.literal("none"),
  })
  .strict();

export const GrandHallProcessedBigGuardrailsV1Schema = z
  .object({
    authority: z.literal("none"),
    proofScope: z.literal("packaging_and_member_byte_identity_only"),
    architecturalEvidence: z.literal(false),
    roomMembershipAuthority: z.literal("none"),
    cleanupDecisionAccepted: z.literal(false),
    coordinateAuthority: z.literal("none"),
    transformAuthority: z.literal("none"),
    outputMask: z.null(),
    runtimeAdmission: z.null(),
    deploymentAuthorization: z.null(),
    publicationAuthorization: z.null(),
    productionTrust: z.null(),
    humanReviewRequiredBeforeAnyPromotion: z.literal(true),
    permitsRoomMembershipAcceptance: z.literal(false),
    permitsCoordinateAcceptance: z.literal(false),
    permitsTransformAcceptance: z.literal(false),
    permitsOutputMasking: z.literal(false),
    permitsRuntimeUse: z.literal(false),
    permitsDeployment: z.literal(false),
    permitsPublication: z.literal(false),
  })
  .strict();

export const GrandHallProcessedBigProofV1Schema = z
  .object({
    authority: z.literal("none"),
    exactTreeStableBeforeAndAfter: z.literal(true),
    everyFileHashedFromOneStableOpenHandle: z.literal(true),
    noLinksReparsePointsOrHardlinks: z.literal(true),
    noCaseFoldCollisions: z.literal(true),
    filesystemMetadataSerialized: z.literal(false),
    sourceWrites: z.literal("none"),
    networkAccess: z.literal("none"),
  })
  .strict();

const InventoryDigestMaterialSchema =
  GrandHallProcessedBigInventoryMembersSchema;

function inventoryDigestFromValidatedMaterial(
  material: z.infer<typeof InventoryDigestMaterialSchema>,
): `sha256:${string}` {
  return canonicalDigest(GRAND_HALL_PROCESSED_BIG_INVENTORY_DIGEST_DOMAIN, material);
}

export function computeGrandHallProcessedBigInventorySha256(
  members: readonly GrandHallProcessedBigInventoryMember[],
): `sha256:${string}` {
  const parsedMembers = GrandHallProcessedBigInventoryMembersSchema.parse([
    ...members,
  ]);
  const material = InventoryDigestMaterialSchema.parse(parsedMembers);
  return inventoryDigestFromValidatedMaterial(material);
}

const GrandHallProcessedBigInventoryV1MaterialSchema = z
  .object({
    schemaVersion: z.literal(GRAND_HALL_PROCESSED_BIG_INVENTORY_V1),
    inventoryId: z.string().trim().min(1).max(160).regex(SAFE_ARTIFACT_ID),
    createdAt: z
      .string()
      .datetime({ offset: true })
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
    source: GrandHallProcessedBigSourceV1Schema,
    directories: GrandHallProcessedBigDirectoriesSchema,
    members: GrandHallProcessedBigInventoryMembersSchema,
    summary: GrandHallProcessedBigInventorySummarySchema,
    topLevelPackages: GrandHallProcessedBigTopLevelPackagesSchema,
    duplicateGroups: GrandHallProcessedBigDuplicateGroupsSchema,
    inventorySha256: RuntimeSha256Schema,
    proof: GrandHallProcessedBigProofV1Schema,
    guardrails: GrandHallProcessedBigGuardrailsV1Schema,
  })
  .strict();
export type GrandHallProcessedBigInventoryV1Material = z.infer<
  typeof GrandHallProcessedBigInventoryV1MaterialSchema
>;

export function computeGrandHallProcessedBigManifestSha256(
  material: GrandHallProcessedBigInventoryV1Material,
): `sha256:${string}` {
  const parsed = GrandHallProcessedBigInventoryV1MaterialSchema.parse(material);
  return manifestDigestFromValidatedMaterial(parsed);
}

function manifestDigestFromValidatedMaterial(
  material: GrandHallProcessedBigInventoryV1Material,
): `sha256:${string}` {
  return canonicalDigest(GRAND_HALL_PROCESSED_BIG_MANIFEST_DIGEST_DOMAIN, material);
}

function addMismatchIssue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

export const GrandHallProcessedBigInventoryV1Schema =
  GrandHallProcessedBigInventoryV1MaterialSchema.extend({
    manifestSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((inventory, ctx) => {
      if (!directoryEnvelopeMatchesMembers(inventory.members, inventory.directories)) {
        addMismatchIssue(
          ctx,
          ["directories"],
          "directories must contain every member parent and exactly the nine audited empty directories",
        );
      }
      const derivedSummary = summaryFromValidatedInventory(
        inventory.members,
        inventory.directories,
      );
      const expectedSummary = GrandHallProcessedBigInventorySummarySchema.safeParse(
        derivedSummary,
      );
      if (!expectedSummary.success) {
        addMismatchIssue(
          ctx,
          ["members"],
          "members do not match the frozen 399-file processed BIG summary",
        );
      } else if (
        stableCanonicalJson(expectedSummary.data) !==
        stableCanonicalJson(inventory.summary)
      ) {
        addMismatchIssue(ctx, ["summary"], "summary does not match members");
      }

      const expectedDuplicateGroups = duplicateGroupsFromValidatedMembers(
        inventory.members,
      );
      if (
        stableCanonicalJson(expectedDuplicateGroups) !==
        stableCanonicalJson(inventory.duplicateGroups)
      ) {
        addMismatchIssue(
          ctx,
          ["duplicateGroups"],
          "duplicate groups do not match members",
        );
      }

      const expectedTopLevelPackages =
        GrandHallProcessedBigTopLevelPackagesSchema.safeParse(
          topLevelPackageSummariesFromMembers(inventory.members),
        );
      if (!expectedTopLevelPackages.success) {
        addMismatchIssue(
          ctx,
          ["members"],
          "members do not match the nine audited package summaries",
        );
      } else if (
        stableCanonicalJson(expectedTopLevelPackages.data) !==
        stableCanonicalJson(inventory.topLevelPackages)
      ) {
        addMismatchIssue(
          ctx,
          ["topLevelPackages"],
          "top-level package summaries do not match members",
        );
      }

      if (
        inventory.inventorySha256 !==
          inventoryDigestFromValidatedMaterial(inventory.members)
      ) {
        addMismatchIssue(
          ctx,
          ["inventorySha256"],
          "inventory digest does not match its domain-separated canonical material",
        );
      }

      const { manifestSha256, ...material } = inventory;
      if (manifestSha256 !== manifestDigestFromValidatedMaterial(material)) {
        addMismatchIssue(
          ctx,
          ["manifestSha256"],
          "manifest self-digest does not match its canonical material",
        );
      }
      if (manifestSha256 === inventory.inventorySha256) {
        addMismatchIssue(
          ctx,
          ["manifestSha256"],
          "manifest and inventory digests must remain domain-separated",
        );
      }
    });
export type GrandHallProcessedBigInventoryV1 = z.infer<
  typeof GrandHallProcessedBigInventoryV1Schema
>;

/**
 * Exact reviewed identity for the supplied processed BIG collection. The base
 * schema remains useful for self-consistency checks, while this boundary also
 * requires the one reviewed ordered-member inventory digest.
 */
export const GrandHallProcessedBigReviewedInventoryV1Schema =
  GrandHallProcessedBigInventoryV1Schema.superRefine((inventory, ctx) => {
    if (
      inventory.inventorySha256 !==
      GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256
    ) {
      addMismatchIssue(
        ctx,
        ["inventorySha256"],
        "inventory digest does not match the reviewed processed BIG collection",
      );
    }
  });
export type GrandHallProcessedBigReviewedInventoryV1 = z.infer<
  typeof GrandHallProcessedBigReviewedInventoryV1Schema
>;
