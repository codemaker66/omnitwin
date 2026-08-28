import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256,
  GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
  GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES,
  GRAND_HALL_PROCESSED_BIG_GUARDRAILS_V1,
  GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
  GRAND_HALL_PROCESSED_BIG_PROOF_V1,
  GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
  GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256,
  GRAND_HALL_PROCESSED_BIG_SOURCE_V1,
  GrandHallProcessedBigDirectoriesSchema,
  GrandHallProcessedBigInventoryMembersSchema,
  GrandHallProcessedBigInventoryV1Schema,
  GrandHallProcessedBigReviewedInventoryV1Schema,
  computeGrandHallProcessedBigDuplicateGroups,
  computeGrandHallProcessedBigInventorySha256,
  computeGrandHallProcessedBigInventorySummary,
  computeGrandHallProcessedBigManifestSha256,
  computeGrandHallProcessedBigTopLevelPackages,
  stableCanonicalJson,
  type GrandHallProcessedBigInventoryMember,
  type GrandHallProcessedBigInventoryV1,
  type GrandHallProcessedBigInventoryV1Material,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  GrandHallProcessedBigInventoryError,
  __testOnlyGrandHallProcessedBigInventory,
  buildGrandHallProcessedBigInventory,
  checkGrandHallProcessedBigInventory,
} from "../grand-hall-processed-big-inventory.js";

const temporaryRoots: string[] = [];
const INVENTORY_ID = "grand-hall-processed-big-test-v1";
const CREATED_AT = "2026-08-28T00:00:00.000Z";
const PUBLIC_INTEGRATION_SOURCE_ROOT =
  process.env.GRAND_HALL_PROCESSED_BIG_TEST_SOURCE;
const REVIEWED_MANIFEST_SEMANTIC_SHA256 =
  "sha256:1837981b720e49c1f251c0cf9658281fba50d698b37882187b651478500389d5";
const REVIEWED_SERIALIZED_LF_FILE_SHA256 =
  "f49e04740f11d1d802babcb90995b3e083d91608beba1d0310f76dddc028ebfd";
const persistedReviewedInventoryUrl = new URL(
  "../../../../docs/operations/grand-hall-processed-big-inventory-v1.json",
  import.meta.url,
);

async function createFixture(): Promise<{
  readonly fixtureRoot: string;
  readonly sourceRoot: string;
}> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "venviewer-big-inventory-"));
  temporaryRoots.push(fixtureRoot);
  const sourceRoot = join(fixtureRoot, "source");
  await mkdir(join(sourceRoot, "package-a", "nested"), { recursive: true });
  await mkdir(join(sourceRoot, "package-a", "empty"));
  await writeFile(join(sourceRoot, "package-a", "z.bin"), "same", "utf8");
  await writeFile(
    join(sourceRoot, "package-a", "nested", "alpha.bin"),
    "alpha",
    "utf8",
  );
  await writeFile(join(sourceRoot, "package-a", "copy.bin"), "same", "utf8");
  return { fixtureRoot, sourceRoot };
}

function sha256(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

const COMMON_DUPLICATE_SHA256 =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const SYNTHETIC_SINGLETON_COUNTS = [11, 11, 11, 11, 10, 10, 10, 10, 10] as const;

function ordinalSha256(ordinal: number): `sha256:${string}` {
  return `sha256:${ordinal.toString(16).padStart(64, "0")}`;
}

function syntheticPackageDirectories(packageIndex: number): readonly string[] {
  const expected = GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES[
    packageIndex
  ];
  if (expected === undefined) throw new Error("Synthetic package index is invalid.");
  if (packageIndex < 6) {
    const info = `${expected.packageName}/lcc2-result/info`;
    return packageIndex === 1
      ? [
          info,
          `${expected.packageName}/mesh-files`,
          `${expected.packageName}/group-01`,
          `${expected.packageName}/group-02`,
        ]
      : [
          info,
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

function syntheticManifestDirectories(): string[] {
  const directories = new Set<string>(
    GRAND_HALL_PROCESSED_BIG_EXPECTED_EMPTY_DIRECTORIES,
  );
  for (let packageIndex = 0; packageIndex < 9; packageIndex += 1) {
    for (const directory of syntheticPackageDirectories(packageIndex)) {
      const segments = directory.split("/");
      for (let end = 1; end <= segments.length; end += 1) {
        directories.add(segments.slice(0, end).join("/"));
      }
    }
  }
  return GrandHallProcessedBigDirectoriesSchema.parse([...directories].sort());
}

function syntheticManifestMembers(): GrandHallProcessedBigInventoryMember[] {
  let singletonOrdinal = 1;
  const members: GrandHallProcessedBigInventoryMember[] = [];
  for (const [packageIndex, expected] of
    GRAND_HALL_PROCESSED_BIG_EXPECTED_TOP_LEVEL_PACKAGES.entries()) {
    const directories = syntheticPackageDirectories(packageIndex);
    const singletonCount = SYNTHETIC_SINGLETON_COUNTS[packageIndex];
    if (singletonCount === undefined) throw new Error("Synthetic singleton count is missing.");
    const packageMembers = Array.from(
      { length: expected.fileCount },
      (_, index) => {
        const isChosenObj = packageIndex === 1 && index === 0;
        const isSingleton = index < singletonCount;
        const directory = directories[index % directories.length];
        if (directory === undefined) throw new Error("Synthetic directory is missing.");
        const member = {
          relativePath: isChosenObj
            ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_RELATIVE_PATH
            : `${directory}/member-${String(index).padStart(3, "0")}.bin`,
          sizeBytes: isChosenObj
            ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SIZE_BYTES
            : 1,
          sha256: isChosenObj
            ? GRAND_HALL_PROCESSED_BIG_CHOSEN_OBJ_SHA256
            : isSingleton
              ? ordinalSha256(singletonOrdinal)
              : COMMON_DUPLICATE_SHA256,
        };
        if (isSingleton) singletonOrdinal += 1;
        return member;
      },
    );
    const balanceIndex = singletonCount - 1;
    const balance = packageMembers[balanceIndex];
    if (balance === undefined) throw new Error("Synthetic balance member is missing.");
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

function syntheticManifest(): GrandHallProcessedBigInventoryV1 {
  const members = syntheticManifestMembers();
  const directories = syntheticManifestDirectories();
  const material: GrandHallProcessedBigInventoryV1Material = {
    schemaVersion: GRAND_HALL_PROCESSED_BIG_INVENTORY_V1,
    inventoryId: "grand-hall-processed-big-inventory-byte-envelope-test-v1",
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
  return GrandHallProcessedBigInventoryV1Schema.parse({
    ...material,
    manifestSha256: computeGrandHallProcessedBigManifestSha256(material),
  });
}

function expectInventoryError(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof GrandHallProcessedBigInventoryError && error.code === code;
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("Grand Hall processed BIG manifest byte envelope", () => {
  const manifest = syntheticManifest();
  const canonicalJson = stableCanonicalJson(manifest);

  it("defines persisted bytes as canonical JSON plus exactly one LF", () => {
    const bytes = Buffer.from(
      __testOnlyGrandHallProcessedBigInventory.canonicalManifestBytes(manifest),
    );

    expect(bytes).toEqual(Buffer.from(`${canonicalJson}\n`, "utf8"));
    expect(bytes.subarray(-1)).toEqual(Buffer.from([0x0a]));
    expect(
      __testOnlyGrandHallProcessedBigInventory.parseCanonicalManifestBytes(bytes),
    ).toEqual(manifest);
  });

  it.each([
    ["no LF", canonicalJson],
    ["CRLF", `${canonicalJson}\r\n`],
    ["two LFs", `${canonicalJson}\n\n`],
    ["other JSON whitespace", ` ${canonicalJson}\n`],
  ])("rejects %s artifact bytes", (_label, text) => {
    expect(() =>
      __testOnlyGrandHallProcessedBigInventory.parseCanonicalManifestBytes(
        Buffer.from(text, "utf8"),
      ),
    ).toThrow(GrandHallProcessedBigInventoryError);
  });

  it("does not include the artifact LF in either semantic digest", () => {
    const parsed =
      __testOnlyGrandHallProcessedBigInventory.parseCanonicalManifestBytes(
        Buffer.from(`${canonicalJson}\n`, "utf8"),
      );

    expect(parsed.inventorySha256).toBe(manifest.inventorySha256);
    expect(parsed.manifestSha256).toBe(manifest.manifestSha256);
  });
});

describe("Grand Hall persisted reviewed processed BIG inventory", () => {
  it("pins exact canonical LF bytes, semantic digests, and registration lineage", async () => {
    const bytes = await readFile(persistedReviewedInventoryUrl);

    expect(bytes.at(-1)).toBe(0x0a);
    expect(bytes.at(-2)).not.toBe(0x0a);
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.subarray(0, -1).includes(0x0a)).toBe(false);

    const parsed =
      __testOnlyGrandHallProcessedBigInventory.parseCanonicalManifestBytes(bytes);
    const reviewed = GrandHallProcessedBigReviewedInventoryV1Schema.parse(parsed);
    const canonicalBody = Buffer.from(
      stableCanonicalJson(CanonicalJsonValueSchema.parse(reviewed)),
      "utf8",
    );
    expect(bytes.subarray(0, -1)).toEqual(canonicalBody);

    expect(reviewed.inventorySha256).toBe(
      GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
    );
    expect(computeGrandHallProcessedBigInventorySha256(reviewed.members)).toBe(
      GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
    );
    const { manifestSha256, ...material } = reviewed;
    expect(manifestSha256).toBe(REVIEWED_MANIFEST_SEMANTIC_SHA256);
    expect(computeGrandHallProcessedBigManifestSha256(material)).toBe(
      REVIEWED_MANIFEST_SEMANTIC_SHA256,
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      REVIEWED_SERIALIZED_LF_FILE_SHA256,
    );
    expect(GRAND_HALL_REGISTRATION_SEED_PROCESSED_BIG_INVENTORY_SHA256).toBe(
      GRAND_HALL_PROCESSED_BIG_REVIEWED_INVENTORY_SHA256,
    );
  });
});

describe("Grand Hall processed BIG public integration", () => {
  it("rejects a self-consistent aggregate counterfeit at the reviewed boundary", async () => {
    const { fixtureRoot, sourceRoot } = await createFixture();
    const inventoryPath = join(fixtureRoot, "counterfeit-inventory.json");
    await writeFile(
      inventoryPath,
      __testOnlyGrandHallProcessedBigInventory.canonicalManifestBytes(
        syntheticManifest(),
      ),
      { flag: "wx", mode: 0o600 },
    );

    await expect(
      checkGrandHallProcessedBigInventory({ sourceRoot, inventoryPath }),
    ).rejects.toSatisfy(expectInventoryError("MANIFEST_INVALID"));
  });

  it.runIf(PUBLIC_INTEGRATION_SOURCE_ROOT !== undefined)(
    "builds publicly in memory, then checks a test-persisted exact-LF fixture",
    async () => {
      if (PUBLIC_INTEGRATION_SOURCE_ROOT === undefined) {
        throw new Error("The integration source root disappeared after test selection.");
      }
      const outputRoot = await mkdtemp(
        join(tmpdir(), "venviewer-big-public-roundtrip-"),
      );
      temporaryRoots.push(outputRoot);
      const outputPath = join(outputRoot, "inventory.json");

      const built = await buildGrandHallProcessedBigInventory({
        sourceRoot: PUBLIC_INTEGRATION_SOURCE_ROOT,
        inventoryId: INVENTORY_ID,
        createdAt: CREATED_AT,
      });
      const encoded = Buffer.from(
        __testOnlyGrandHallProcessedBigInventory.canonicalManifestBytes(built),
      );
      await expect(readdir(outputRoot)).resolves.toEqual([]);
      // Persistence is deliberately test-harness-only; the public builder has no
      // output argument and no filesystem-write capability.
      await writeFile(outputPath, encoded, { flag: "wx", mode: 0o600 });
      const persisted = await readFile(outputPath);

      expect(persisted).toEqual(encoded);
      expect(persisted.subarray(-2)).toEqual(Buffer.from("}\n", "utf8"));
      await expect(
        checkGrandHallProcessedBigInventory({
          sourceRoot: PUBLIC_INTEGRATION_SOURCE_ROOT,
          inventoryPath: outputPath,
        }),
      ).resolves.toEqual(built);
    },
  );
});

describe("Grand Hall processed BIG inventory source custody", () => {
  it("hashes every synthetic member once from deterministic POSIX paths", async () => {
    const { fixtureRoot, sourceRoot } = await createFixture();
    const descriptorOpens: string[] = [];

    const evidence =
      await __testOnlyGrandHallProcessedBigInventory.collectStableEvidence({
        sourceRoot,
        testSeam: {
          afterSourceDescriptorOpened(relativePath) {
            descriptorOpens.push(relativePath);
          },
        },
      });
    const { members } = evidence;

    expect(members).toEqual([
      {
        relativePath: "package-a/copy.bin",
        sizeBytes: 4,
        sha256: sha256("same"),
      },
      {
        relativePath: "package-a/nested/alpha.bin",
        sizeBytes: 5,
        sha256: sha256("alpha"),
      },
      {
        relativePath: "package-a/z.bin",
        sizeBytes: 4,
        sha256: sha256("same"),
      },
    ]);
    expect(descriptorOpens).toEqual(members.map((member) => member.relativePath));
    expect(evidence.directories).toEqual([
      "package-a",
      "package-a/empty",
      "package-a/nested",
    ]);
    expect(JSON.stringify(members)).not.toContain(fixtureRoot);
    expect(JSON.stringify(members)).not.toContain("\\");
    expect(await readdir(fixtureRoot)).toEqual(["source"]);
  });

  it("fails closed before blessing a synthetic tree as the audited collection", async () => {
    const { fixtureRoot, sourceRoot } = await createFixture();

    await expect(
      buildGrandHallProcessedBigInventory({
        sourceRoot,
        inventoryId: INVENTORY_ID,
        createdAt: CREATED_AT,
      }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_UNSAFE"));
    await expect(readdir(fixtureRoot)).resolves.toEqual(["source"]);
  });

  it("rejects relative, UNC, device, traversal, and ADS-like roots", async () => {
    const { sourceRoot } = await createFixture();
    const variants = [
      "relative-source",
      "\\\\server\\share\\processed-big",
      "\\\\?\\C:\\processed-big",
      `${sourceRoot}${sep}..${sep}${basename(sourceRoot)}`,
      `${sourceRoot}:alternate-stream`,
    ];
    for (const source of variants) {
      await expect(
        buildGrandHallProcessedBigInventory({
          sourceRoot: source,
          inventoryId: INVENTORY_ID,
          createdAt: CREATED_AT,
        }),
      ).rejects.toSatisfy(expectInventoryError("ARGUMENT_INVALID"));
    }
  });

  it("rejects invalid inventory IDs and noncanonical instants", async () => {
    const { sourceRoot } = await createFixture();
    await expect(
      buildGrandHallProcessedBigInventory({
        sourceRoot,
        inventoryId: "INVALID ID",
        createdAt: CREATED_AT,
      }),
    ).rejects.toSatisfy(expectInventoryError("ARGUMENT_INVALID"));
    await expect(
      buildGrandHallProcessedBigInventory({
        sourceRoot,
        inventoryId: INVENTORY_ID,
        createdAt: "2026-08-28T00:00:00Z",
      }),
    ).rejects.toSatisfy(expectInventoryError("ARGUMENT_INVALID"));
  });

  it("rejects inventory paths inside the read-only source tree", async () => {
    const { sourceRoot } = await createFixture();
    const inventoryPath = join(sourceRoot, "inventory.json");

    await expect(
      checkGrandHallProcessedBigInventory({
        sourceRoot,
        inventoryPath,
      }),
    ).rejects.toSatisfy(expectInventoryError("OUTPUT_UNSAFE"));
    await expect(readFile(inventoryPath)).rejects.toBeDefined();
  });

  it("rejects hard-linked source members", async () => {
    const { sourceRoot } = await createFixture();
    await link(
      join(sourceRoot, "package-a", "z.bin"),
      join(sourceRoot, "package-a", "z-hardlink.bin"),
    );

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableMembers({ sourceRoot }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_UNSAFE"));
  });

  it("rejects linked or reparse entries when the platform permits the fixture", async () => {
    const { fixtureRoot, sourceRoot } = await createFixture();
    const external = join(fixtureRoot, "external");
    await mkdir(external);
    await writeFile(join(external, "outside.bin"), "outside", "utf8");
    try {
      await symlink(external, join(sourceRoot, "linked-directory"), "junction");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as Error & { readonly code?: string }).code === "EPERM"
      ) {
        return;
      }
      throw error;
    }

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableMembers({ sourceRoot }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_UNSAFE"));
  });

  it("detects a file mutation during its descriptor-bound hash", async () => {
    const { sourceRoot } = await createFixture();
    let mutated = false;

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableMembers({
        sourceRoot,
        testSeam: {
          async afterSourceBytesHashed(relativePath) {
            if (!mutated && relativePath === "package-a/copy.bin") {
              mutated = true;
              await writeFile(
                join(sourceRoot, "package-a", "copy.bin"),
                "edit",
                "utf8",
              );
            }
          },
        },
      }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_CHANGED"));
  });

  it("detects a recursive inventory change after the complete first snapshot", async () => {
    const { sourceRoot } = await createFixture();

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableMembers({
        sourceRoot,
        testSeam: {
          async afterInitialSnapshot() {
            await writeFile(
              join(sourceRoot, "package-a", "added.bin"),
              "added",
              "utf8",
            );
          },
        },
      }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_CHANGED"));
  });

  it("detects an empty directory added after the complete first snapshot", async () => {
    const { sourceRoot } = await createFixture();

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableEvidence({
        sourceRoot,
        testSeam: {
          async afterInitialSnapshot() {
            await mkdir(join(sourceRoot, "package-a", "unexpected-empty"));
          },
        },
      }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_CHANGED"));
  });

  it("rejects empty source roots", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "venviewer-big-empty-"));
    temporaryRoots.push(fixtureRoot);
    const sourceRoot = join(fixtureRoot, "source");
    await mkdir(sourceRoot);

    await expect(
      __testOnlyGrandHallProcessedBigInventory.collectStableMembers({ sourceRoot }),
    ).rejects.toSatisfy(expectInventoryError("SOURCE_UNSAFE"));
  });

  it("rejects non-schema and noncanonical persisted manifests", async () => {
    const { fixtureRoot, sourceRoot } = await createFixture();
    const inventoryPath = join(fixtureRoot, "inventory.json");
    await writeFile(inventoryPath, "{}", "utf8");

    await expect(
      checkGrandHallProcessedBigInventory({
        sourceRoot,
        inventoryPath,
      }),
    ).rejects.toSatisfy(expectInventoryError("MANIFEST_INVALID"));
  });

  it.runIf(process.platform !== "win32")(
    "rejects portable case-fold collisions on case-sensitive filesystems",
    async () => {
      const { sourceRoot } = await createFixture();
      await writeFile(join(sourceRoot, "package-a", "CASE.bin"), "upper", "utf8");
      await writeFile(join(sourceRoot, "package-a", "case.bin"), "lower", "utf8");

      await expect(
        __testOnlyGrandHallProcessedBigInventory.collectStableMembers({ sourceRoot }),
      ).rejects.toSatisfy(expectInventoryError("SOURCE_UNSAFE"));
    },
  );
});
