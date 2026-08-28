import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_DUPLICATE_EXCESS_FILE_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORY_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGE_COUNT,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT,
  GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1,
  GRAND_HALL_PROCESSED_BIG_INVENTORY_DIGEST_DOMAIN,
  GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
  GRAND_HALL_PROCESSED_BIG_PROOF_V1,
  GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
  GRAND_HALL_PROCESSED_BIG_SOURCE_V1,
  GrandHallProcessedBigInventoryMembersSchema,
  GrandHallProcessedBigInventoryV1Schema,
  GrandHallProcessedBigReviewedInventoryV1Schema,
  GrandHallProcessedBigDirectoriesSchema,
  GrandHallProcessedBigRelativePathSchema,
  computeGrandHallProcessedBigDuplicateGroups,
  computeGrandHallProcessedBigInventorySha256,
  computeGrandHallProcessedBigInventorySummary,
  computeGrandHallProcessedBigManifestSha256,
  computeGrandHallProcessedBigTopLevelPackages,
  type GrandHallProcessedBigInventoryMember,
  type GrandHallProcessedBigInventoryV1,
  type GrandHallProcessedBigInventoryV1Material,
} from "../grand-hall-processed-big-inventory.js";
import {
  sha256Hex,
  stableCanonicalJson,
} from "../canonical-layout-snapshot.js";

const COMMON_DUPLICATE_SHA256 =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const SINGLETON_COUNTS = [11, 11, 11, 11, 10, 10, 10, 10, 10] as const;

function sha256(ordinal: number): `sha256:${string}` {
  return `sha256:${ordinal.toString(16).padStart(64, "0")}`;
}

function syntheticPackageFileDirectories(packageIndex: number): string[] {
  const expected = GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[
    packageIndex
  ]!;
  if (packageIndex < 6) {
    const shared = `${expected.packageName}/lcc2-result/info`;
    if (packageIndex === 1) {
      return [
        shared,
        `${expected.packageName}/mesh-files`,
        `${expected.packageName}/group-01`,
        `${expected.packageName}/group-02`,
      ];
    }
    return [
      shared,
      `${expected.packageName}/group-01`,
      `${expected.packageName}/group-02`,
      `${expected.packageName}/group-03`,
    ];
  }
  return [
    `${expected.packageName}/lcc-result/assets`,
    `${expected.packageName}/group-01`,
    `${expected.packageName}/group-02`,
  ];
}

function syntheticDirectories(): string[] {
  const directories = new Set<string>(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
  );
  for (let packageIndex = 0; packageIndex < 9; packageIndex += 1) {
    for (const directory of syntheticPackageFileDirectories(packageIndex)) {
      const segments = directory.split("/");
      for (let end = 1; end <= segments.length; end += 1) {
        directories.add(segments.slice(0, end).join("/"));
      }
    }
  }
  return GrandHallProcessedBigDirectoriesSchema.parse([...directories].sort());
}

function syntheticMembers(): GrandHallProcessedBigInventoryMember[] {
  let singletonOrdinal = 1;
  const members: GrandHallProcessedBigInventoryMember[] = [];
  for (const [packageIndex, expected] of
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.entries()) {
    const directories = syntheticPackageFileDirectories(packageIndex);
    const singletonCount = SINGLETON_COUNTS[packageIndex]!;
    const packageMembers = Array.from({ length: expected.fileCount }, (_, index) => {
      const isChosenObj = packageIndex === 1 && index === 0;
      const isSingleton = index < singletonCount;
      const relativePath = isChosenObj
        ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH
        : `${directories[index % directories.length]!}/member-${String(index).padStart(
            3,
            "0",
          )}.bin`;
      const member = {
        relativePath,
        sizeBytes: isChosenObj ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES : 1,
        sha256: isChosenObj
          ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256
          : isSingleton
            ? sha256(singletonOrdinal)
            : COMMON_DUPLICATE_SHA256,
      };
      if (isSingleton) singletonOrdinal += 1;
      return member;
    });
    const balanceIndex = singletonCount - 1;
    const balance = packageMembers[balanceIndex]!;
    const currentTotal = packageMembers.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    );
    packageMembers[balanceIndex] = {
      ...balance,
      sizeBytes: balance.sizeBytes + expected.totalBytes - currentTotal,
    };
    members.push(...packageMembers);
  }
  members.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  return GrandHallProcessedBigInventoryMembersSchema.parse(members);
}

function syntheticMaterial(): GrandHallProcessedBigInventoryV1Material {
  const members = syntheticMembers();
  const directories = syntheticDirectories();
  return {
    schemaVersion: GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
    inventoryId: "grand-hall-processed-big-inventory-synthetic-v1",
    createdAt: "2026-08-28T12:00:00.000Z",
    source: GRAND_HALL_PROCESSED_BIG_SOURCE_V1,
    directories,
    members,
    summary: computeGrandHallProcessedBigInventorySummary(members, directories),
    topLevelPackages: computeGrandHallProcessedBigTopLevelPackages(members),
    duplicateGroups: computeGrandHallProcessedBigDuplicateGroups(members),
    inventorySha256: computeGrandHallProcessedBigInventorySha256(members),
    proof: GRAND_HALL_PROCESSED_BIG_PROOF_V1,
    guardrails: GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1,
  };
}

function syntheticInventory(): GrandHallProcessedBigInventoryV1 {
  const material = syntheticMaterial();
  return GrandHallProcessedBigInventoryV1Schema.parse({
    ...material,
    manifestSha256: computeGrandHallProcessedBigManifestSha256(material),
  });
}

function issuePaths(value: unknown): string[] {
  const result = GrandHallProcessedBigInventoryV1Schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("GrandHallProcessedBigInventoryV1Schema", () => {
  it("accepts a self-consistent path-redacted 399-member topology and recomputed summary", () => {
    const inventory = syntheticInventory();

    expect(inventory.summary).toEqual({
      fileCount: GRAND_HALL_PROCESSED_BIG_EXPECTED_FILE_COUNT,
      totalBytes: GRAND_HALL_PROCESSED_BIG_EXPECTED_TOTAL_BYTES,
      uniqueContentSha256Count:
        GRAND_HALL_PROCESSED_BIG_EXPECTED_UNIQUE_CONTENT_SHA256_COUNT,
      directoryCount: GRAND_HALL_PROCESSED_BIG_EXPECTED_DIRECTORY_COUNT,
      topLevelPackageCount:
        GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGE_COUNT,
      duplicateContentGroupCount: 1,
      duplicateMemberCount: 305,
      duplicateExcessFileCount:
        GRAND_HALL_PROCESSED_BIG_EXPECTED_DUPLICATE_EXCESS_FILE_COUNT,
    });
    expect(inventory.source.sourceRoot).toBeNull();
    expect(inventory.source.sourceAuthority).toBe("none");
    expect(inventory.topLevelPackages).toEqual(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES,
    );
    const memberParents = new Set<string>();
    for (const member of inventory.members) {
      const segments = member.relativePath.split("/");
      for (let end = 1; end < segments.length; end += 1) {
        memberParents.add(segments.slice(0, end).join("/"));
      }
    }
    const emptyDirectories = inventory.directories.filter(
      (directory) => !memberParents.has(directory),
    );
    expect(emptyDirectories).toHaveLength(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORY_COUNT,
    );
    expect(emptyDirectories).toEqual(
      GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
    );
    expect(inventory.proof).toEqual(GRAND_HALL_PROCESSED_BIG_PROOF_V1);
    expect(inventory.guardrails.authority).toBe("none");
  });

  it("keeps a self-consistent counterfeit outside the reviewed exact boundary", () => {
    const inventory = syntheticInventory();

    expect(inventory.inventorySha256).not.toBe(
      GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
    );
    expect(GrandHallProcessedBigInventoryV1Schema.safeParse(inventory).success).toBe(
      true,
    );
    expect(
      GrandHallProcessedBigReviewedInventoryV1Schema.safeParse(inventory).success,
    ).toBe(false);
  });

  it("binds the exact chosen Grand Hall BIG OBJ member", () => {
    const chosenObj = syntheticInventory().members.find(
      (member) =>
        member.relativePath === GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
    );

    expect(chosenObj).toEqual({
      relativePath: GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
      sizeBytes: GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES,
      sha256: GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256,
    });
  });

  it("rejects a missing member parent or a forged empty directory", () => {
    const directories = syntheticDirectories();
    const missingParent = directories.filter(
      (directory) => directory !== "scans_BIG_MODEL_TH_GH_1/group-01",
    );
    missingParent.push("scans_BIG_MODEL_TH_GH_1/forged-empty");
    missingParent.sort();
    expect(() =>
      computeGrandHallProcessedBigInventorySummary(
        syntheticMembers(),
        missingParent,
      ),
    ).toThrow();

    const missingAuditedEmpty = directories.filter(
      (directory) =>
        directory !== "scans_BIG_MODEL_TH_GH_9/lcc-result/assets/media",
    );
    missingAuditedEmpty.push("scans_BIG_MODEL_TH_GH_9/lcc-result/assets/other");
    missingAuditedEmpty.sort();
    expect(
      GrandHallProcessedBigDirectoriesSchema.safeParse(missingAuditedEmpty).success,
    ).toBe(false);
  });

  it("rejects file-directory collisions across the combined case-fold namespace", () => {
    const inventory = syntheticInventory();
    const members = inventory.members.map((member) => ({ ...member }));
    const replacementIndex = members.findIndex((member) =>
      member.relativePath.startsWith("scans_BIG_MODEL_TH_GH_1/group-01/"),
    );
    expect(replacementIndex).toBeGreaterThanOrEqual(0);
    members[replacementIndex] = {
      ...members[replacementIndex]!,
      relativePath: "scans_BIG_MODEL_TH_GH_1/lcc2-result/info/MEDIA",
    };
    members.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );

    expect(GrandHallProcessedBigInventoryMembersSchema.safeParse(members).success).toBe(
      true,
    );
    expect(() =>
      computeGrandHallProcessedBigInventorySummary(
        members,
        inventory.directories,
      ),
    ).toThrow(/directory envelope/u);
    expect(issuePaths({ ...inventory, members })).toContain("directories");
  });

  it.each([
    "C:/GRAND_HALL_BIG_MODEL_VARIATIONS/package/file.bin",
    "/package/file.bin",
    "package\\file.bin",
    "package/../file.bin",
    "package/./file.bin",
    "package//file.bin",
    "file.bin",
    "package/ file.bin",
    "package/file.bin ",
    "package/file?.bin",
  ])("rejects a non-redacted or non-canonical member path: %s", (relativePath) => {
    expect(GrandHallProcessedBigRelativePathSchema.safeParse(relativePath).success).toBe(
      false,
    );
  });

  it("rejects reordered and case-fold-colliding member paths", () => {
    const reordered = syntheticMembers();
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(GrandHallProcessedBigInventoryMembersSchema.safeParse(reordered).success).toBe(
      false,
    );

    const caseCollision = syntheticMembers();
    const first = caseCollision[0]!;
    const second = caseCollision[1]!;
    caseCollision[1] = {
      ...second,
      relativePath: first.relativePath.toUpperCase(),
    };
    caseCollision.sort((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    );
    expect(
      GrandHallProcessedBigInventoryMembersSchema.safeParse(caseCollision).success,
    ).toBe(false);
  });

  it("rejects members whose derived frozen totals or topology do not match", () => {
    const wrongTotal = syntheticMembers();
    wrongTotal[0] = { ...wrongTotal[0]!, sizeBytes: wrongTotal[0]!.sizeBytes + 1 };
    expect(() =>
      computeGrandHallProcessedBigInventorySummary(
        wrongTotal,
        syntheticDirectories(),
      ),
    ).toThrow();

    const wrongPackageCount = syntheticMembers().map((member, index) =>
      index === 0
        ? { ...member, relativePath: "package-10/member-000.bin" }
        : member,
    );
    wrongPackageCount.sort((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    );
    expect(() =>
      computeGrandHallProcessedBigInventorySummary(
        wrongPackageCount,
        syntheticDirectories(),
      ),
    ).toThrow();
  });

  it("recomputes duplicate groups and rejects a forged duplicate claim", () => {
    const inventory = syntheticInventory();
    const duplicateGroups = inventory.duplicateGroups.map((group) => ({
      ...group,
      relativePaths: [...group.relativePaths],
    }));
    duplicateGroups[0] = {
      ...duplicateGroups[0]!,
      relativePaths: duplicateGroups[0]!.relativePaths.slice(1),
    };
    const forgedMaterial = { ...inventory, duplicateGroups };
    const { manifestSha256: _oldManifestSha256, ...material } = forgedMaterial;
    const forged = {
      ...material,
      manifestSha256: computeGrandHallProcessedBigManifestSha256(material),
    };

    expect(issuePaths(forged)).toContain("duplicateGroups");
  });

  it("recomputes the dynamic duplicate summary instead of trusting declarations", () => {
    const inventory = syntheticInventory();
    const summary = {
      ...inventory.summary,
      duplicateContentGroupCount:
        inventory.summary.duplicateContentGroupCount + 1,
      duplicateMemberCount: inventory.summary.duplicateMemberCount + 1,
    };
    const material = { ...inventory, summary };
    const { manifestSha256: _oldManifestSha256, ...withoutManifest } = material;
    const forged = {
      ...withoutManifest,
      manifestSha256: computeGrandHallProcessedBigManifestSha256(withoutManifest),
    };

    expect(issuePaths(forged)).toContain("summary");
  });

  it("uses distinct domain-separated inventory and manifest digests", () => {
    const inventory = syntheticInventory();

    expect(inventory.inventorySha256).not.toBe(inventory.manifestSha256);
    expect(inventory.inventorySha256).toBe(
      `sha256:${sha256Hex(
        `${GRAND_HALL_PROCESSED_BIG_INVENTORY_DIGEST_DOMAIN}\u0000${stableCanonicalJson(
          inventory.members,
        )}`,
      )}`,
    );
    expect(inventory.inventorySha256).toBe(
      computeGrandHallProcessedBigInventorySha256(inventory.members),
    );
    const { manifestSha256: _manifestSha256, ...material } = inventory;
    expect(inventory.manifestSha256).toBe(
      computeGrandHallProcessedBigManifestSha256(material),
    );
  });

  it("rejects forged inventory and manifest digests independently", () => {
    const inventory = syntheticInventory();
    const wrongInventoryMaterial = {
      ...inventory,
      inventorySha256: sha256(10_001),
    };
    const { manifestSha256: _oldManifestSha256, ...withoutManifest } =
      wrongInventoryMaterial;
    const wrongInventory = {
      ...withoutManifest,
      manifestSha256: computeGrandHallProcessedBigManifestSha256(withoutManifest),
    };
    expect(issuePaths(wrongInventory)).toContain("inventorySha256");

    const wrongManifest = { ...inventory, manifestSha256: sha256(10_002) };
    expect(issuePaths(wrongManifest)).toContain("manifestSha256");
  });

  it("rejects inconsistent duplicate byte sizes even when aggregate bytes are balanced", () => {
    const inventory = syntheticInventory();
    const members = inventory.members.map((member) => ({ ...member }));
    const duplicateIndices = members
      .map((member, index) => ({ member, index }))
      .filter(({ member }) => member.sha256 === COMMON_DUPLICATE_SHA256)
      .slice(0, 2)
      .map(({ index }) => index);
    const firstIndex = duplicateIndices[0]!;
    const secondIndex = duplicateIndices[1]!;
    members[firstIndex] = {
      ...members[firstIndex]!,
      sizeBytes: members[firstIndex]!.sizeBytes + 1,
    };
    members[secondIndex] = {
      ...members[secondIndex]!,
      sizeBytes: members[secondIndex]!.sizeBytes - 1,
    };

    expect(GrandHallProcessedBigInventoryMembersSchema.safeParse(members).success).toBe(
      false,
    );
  });

  it("fails closed if any authority-none proof guardrail is promoted", () => {
    const inventory = syntheticInventory();
    const promoted = {
      ...inventory,
      guardrails: { ...inventory.guardrails, permitsRuntimeUse: true },
    };

    expect(GrandHallProcessedBigInventoryV1Schema.safeParse(promoted).success).toBe(
      false,
    );

    const weakenedProof = {
      ...inventory,
      proof: { ...inventory.proof, exactTreeStableBeforeAndAfter: false },
    };
    expect(
      GrandHallProcessedBigInventoryV1Schema.safeParse(weakenedProof).success,
    ).toBe(false);
  });
});
