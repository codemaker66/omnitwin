import { cp, link, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";

import {
  GRAND_HALL_T554_MANIFEST_FILENAME,
  GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN,
  GrandHallT554PanoramaReviewError,
  assertGrandHallT554ReviewOutputSafety,
  buildGrandHallT554PanoramaE57SequenceHypotheses,
  buildGrandHallT554PanoramaReviewRecords,
  collectGrandHallT554PanoramaInventory,
  computeGrandHallT554PanoramaInventorySha256,
  inspectStableGrandHallT554Jpeg,
  isGrandHallT554PathWithin,
  parseGrandHallT554PanoramaFilename,
  verifyPersistedGrandHallT554PanoramaReviewPack,
  type GrandHallT554PanoramaInventoryFile,
  type GrandHallT554PanoramaReviewManifest,
  type GrandHallT554T550Binding,
} from "../grand-hall-t554-panorama-review.js";
import { parseGrandHallT554PanoramaReviewArguments } from "../grand-hall-t554-panorama-review-cli.js";

const temporaryRoots: string[] = [];

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutablePanoramaManifest = DeepMutable<GrandHallT554PanoramaReviewManifest>;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-panorama-test-"));
  temporaryRoots.push(root);
  return root;
}

function setJsonField(target: object, key: string, value: unknown): void {
  if (!Reflect.set(target, key, value)) {
    throw new Error(`Could not set adversarial JSON field ${key}.`);
  }
}

function panoramaRecordAt(
  manifest: MutablePanoramaManifest,
  index: number,
): object {
  const record = manifest.sourceBindings.panoramaInventory.records[index];
  if (record === undefined) throw new Error(`Expected panorama record ${String(index)}.`);
  return record;
}

async function copyAndCanonicalResealManifest(
  artifactDirectory: string,
  mutate: (manifest: MutablePanoramaManifest) => void,
): Promise<string> {
  const root = await temporaryRoot();
  const copyDirectory = join(root, "panoramas");
  await cp(artifactDirectory, copyDirectory, { recursive: true });
  const manifestPath = join(copyDirectory, GRAND_HALL_T554_MANIFEST_FILENAME);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as MutablePanoramaManifest;
  mutate(manifest);
  const { manifestSha256: _oldDigest, ...material } = manifest;
  const resealed = {
    ...material,
    manifestSha256: `sha256:${domainSeparatedSha256(
      GRAND_HALL_T554_PANORAMA_MANIFEST_DOMAIN,
      toCanonicalJson(material),
    )}`,
  };
  await writeFile(manifestPath, `${JSON.stringify(resealed, null, 2)}\n`, "utf8");
  return copyDirectory;
}

async function jpeg(width: number, height: number, red: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: red, g: 40, b: 20 },
    },
  })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("Grand Hall T-554 panorama source filenames", () => {
  it("parses canonical and observed anomalous names without ordinal assumptions", () => {
    expect(parseGrandHallT554PanoramaFilename("sweep_001jpg.jpg")).toEqual({
      sweepNumber: 1,
      digitToken: "001",
      namingAnomalies: [],
    });
    expect(parseGrandHallT554PanoramaFilename("sweep_0148jpg.jpg")).toEqual({
      sweepNumber: 148,
      digitToken: "0148",
      namingAnomalies: ["four_digit_zero_padded_sweep_id"],
    });
    expect(parseGrandHallT554PanoramaFilename("sweep_099pg.jpg")).toEqual({
      sweepNumber: 99,
      digitToken: "099",
      namingAnomalies: ["filename_token_pg_instead_of_jpg"],
    });
  });

  it("rejects path syntax, unrecognised tokens, and invalid numeric IDs", () => {
    for (const name of [
      "../sweep_001jpg.jpg",
      "sweep_001.JPG",
      "sweep_000jpg.jpg",
      "sweep_1jpeg.jpg",
      "scan_001jpg.jpg",
    ]) {
      expect(() => parseGrandHallT554PanoramaFilename(name)).toThrow(
        GrandHallT554PanoramaReviewError,
      );
    }
  });
});

describe("Grand Hall T-554 race-safe JPEG inspection", () => {
  it("hashes and reads dimensions from the same stable regular file", async () => {
    const root = await temporaryRoot();
    const path = join(root, "sweep_001jpg.jpg");
    await writeFile(path, await jpeg(64, 32, 120), { flag: "wx" });

    const evidence = await inspectStableGrandHallT554Jpeg(
      path,
      "MATTERPORT_PANORAMA_ROOT/sweep_001jpg.jpg",
    );

    expect(evidence).toMatchObject({
      sourceLocator: "MATTERPORT_PANORAMA_ROOT/sweep_001jpg.jpg",
      mediaType: "image/jpeg",
      widthPx: 64,
      heightPx: 32,
      stableDuringRead: true,
    });
    expect(evidence.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fails closed when the file identity changes after hashing", async () => {
    const root = await temporaryRoot();
    const path = join(root, "sweep_001jpg.jpg");
    await writeFile(path, await jpeg(64, 32, 120), { flag: "wx" });

    await expect(
      inspectStableGrandHallT554Jpeg(
        path,
        "MATTERPORT_PANORAMA_ROOT/sweep_001jpg.jpg",
        {
          afterHashBeforeJpegInspection: async () => {
            const changed = new Date(Date.now() + 10_000);
            await utimes(path, changed, changed);
          },
        },
      ),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
});

describe("Grand Hall T-554 folder inventory", () => {
  it("binds a complete numeric inventory including both filename anomaly forms", async () => {
    const root = await temporaryRoot();
    const names = [
      "sweep_001jpg.jpg",
      "sweep_002jpg.jpg",
      "sweep_099pg.jpg",
      "sweep_0148jpg.jpg",
    ] as const;
    for (const [index, name] of names.entries()) {
      await writeFile(join(root, name), await jpeg(64, 32, 80 + index), { flag: "wx" });
    }

    const inventory = await collectGrandHallT554PanoramaInventory({
      sourceRoot: root,
      policy: {
        expectedFileCount: 4,
        expectedWidthPx: 64,
        expectedHeightPx: 32,
        expectedSweepNumbers: [1, 2, 99, 148],
      },
    });

    expect(inventory.files.map((file) => file.sweepNumber)).toEqual([1, 2, 99, 148]);
    expect(inventory.files[2]?.namingAnomalies).toEqual([
      "filename_token_pg_instead_of_jpg",
    ]);
    expect(inventory.files[3]?.namingAnomalies).toEqual([
      "four_digit_zero_padded_sweep_id",
    ]);
    expect(inventory.inventorySha256).toBe(
      computeGrandHallT554PanoramaInventorySha256(inventory.files),
    );
  });

  it("rejects duplicate numeric IDs, linked entries, and unexpected files", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "sweep_001jpg.jpg"), await jpeg(64, 32, 80), { flag: "wx" });
    await writeFile(join(root, "sweep_0001jpg.jpg"), await jpeg(64, 32, 81), {
      flag: "wx",
    });

    await expect(
      collectGrandHallT554PanoramaInventory({
        sourceRoot: root,
        policy: {
          expectedFileCount: 2,
          expectedWidthPx: 64,
          expectedHeightPx: 32,
          expectedSweepNumbers: [1, 2],
        },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INVENTORY_INVALID" });

    const unexpectedRoot = await temporaryRoot();
    await writeFile(join(unexpectedRoot, "notes.txt"), "not an image", { flag: "wx" });
    await expect(
      collectGrandHallT554PanoramaInventory({
        sourceRoot: unexpectedRoot,
        policy: {
          expectedFileCount: 1,
          expectedWidthPx: 64,
          expectedHeightPx: 32,
          expectedSweepNumbers: [1],
        },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INVENTORY_INVALID" });
  });

  it("fails closed when the directory inventory changes during hashing", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "sweep_001jpg.jpg"), await jpeg(64, 32, 80), { flag: "wx" });
    await expect(
      collectGrandHallT554PanoramaInventory({
        sourceRoot: root,
        policy: {
          expectedFileCount: 1,
          expectedWidthPx: 64,
          expectedHeightPx: 32,
          expectedSweepNumbers: [1],
        },
        testSeam: {
          beforeFinalDirectoryInventoryCheck: async () => {
            await writeFile(join(root, "unexpected.txt"), "drift", { flag: "wx" });
          },
        },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
});

describe("Grand Hall T-554 eligibility records", () => {
  it("binds 50 T-550 candidates and records every other source as explicitly ineligible", async () => {
    const root = await temporaryRoot();
    const files: GrandHallT554PanoramaInventoryFile[] = [];
    for (let sweepNumber = 1; sweepNumber <= 148; sweepNumber += 1) {
      const name = `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`;
      const path = join(root, name);
      await writeFile(path, await jpeg(8, 4, sweepNumber % 255), { flag: "wx" });
      const evidence = await inspectStableGrandHallT554Jpeg(
        path,
        `MATTERPORT_PANORAMA_ROOT/${name}`,
      );
      files.push({
        ...evidence,
        relativePath: name,
        sweepNumber,
        digitToken: String(sweepNumber).padStart(3, "0"),
        namingAnomalies: [],
      });
    }
    const binding: GrandHallT554T550Binding = {
      membershipSha256:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      membershipFileSha256:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      records: files.slice(0, 50).map((file, scanIndex) => ({
        scanIndex,
        candidatePanoramaSweepNumber: scanIndex + 1,
        visualLocationInference: "visually_consistent_grand_hall_interior",
        allowedUse: "mask_authoring_candidate_only",
        panoramaCorrespondenceState: "candidate_sequence_unverified",
        pixelMaskState: "required_not_authored",
        wholeFrameExclusionReason: null,
        relativePath: file.relativePath,
        byteLength: file.byteLength,
        sha256: file.sha256,
      })),
    };

    const records = buildGrandHallT554PanoramaReviewRecords(files, binding);
    const hypotheses = buildGrandHallT554PanoramaE57SequenceHypotheses(files, binding);

    expect(records).toHaveLength(148);
    expect(records.filter((record) => record.reviewEligibility === "t550_candidate_human_pending"))
      .toHaveLength(50);
    expect(
      records.filter(
        (record) => record.reviewEligibility === "not_in_t550_ineligible_unreviewed",
      ),
    ).toHaveLength(98);
    expect(records.slice(50).every((record) => !record.reconstructionInputPermitted)).toBe(true);
    expect(records[0]).not.toHaveProperty("candidateScanIndex");
    expect(hypotheses).toHaveLength(50);
    expect(hypotheses[0]).toMatchObject({
      sourceSweepNumber: 1,
      candidateScanIndex: 0,
      state: "sequence_hypothesis_unverified",
      authority: "none",
      geometricCameraAuthority: "none",
      trainingAuthority: "none",
      reconstructionAuthority: "none",
      runtimeAuthority: "none",
    });
    expect(hypotheses[0]).not.toHaveProperty("panoramaCorrespondenceState");
    expect(hypotheses[0]).not.toHaveProperty("visualLocationInference");

    const permutedBinding: GrandHallT554T550Binding = {
      ...binding,
      records: binding.records.map((record, index) => ({
        ...record,
        scanIndex: index === 0 ? 148 : index - 1,
      })),
    };
    expect(buildGrandHallT554PanoramaReviewRecords(files, permutedBinding)).toEqual(records);
    expect(buildGrandHallT554PanoramaE57SequenceHypotheses(files, permutedBinding))
      .not.toEqual(hypotheses);
    expect(buildGrandHallT554PanoramaE57SequenceHypotheses(files, permutedBinding)[0])
      .toMatchObject({ candidateScanIndex: 148 });

    const outOfRangeBinding: GrandHallT554T550Binding = {
      ...binding,
      records: binding.records.map((record, index) => ({
        ...record,
        scanIndex: index === 0 ? 149 : index - 1,
      })),
    };
    expect(() => buildGrandHallT554PanoramaE57SequenceHypotheses(files, outOfRangeBinding))
      .toThrow(expect.objectContaining({ code: "T550_BINDING_MISMATCH" }));

    const mismatchedBinding: GrandHallT554T550Binding = {
      ...binding,
      records: binding.records.map((record, index) =>
        index === 0
          ? {
              ...record,
              sha256:
                "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            }
          : record,
      ),
    };
    expect(() => buildGrandHallT554PanoramaReviewRecords(files, mismatchedBinding)).toThrow(
      expect.objectContaining({ code: "T550_BINDING_MISMATCH" }),
    );
  });
});

describe("Grand Hall T-554 output safety", () => {
  it.skipIf(process.platform !== "win32")(
    "treats paths on different Windows volumes as disjoint",
    () => {
    expect(isGrandHallT554PathWithin("F:\\evidence", "C:\\review-pack")).toBe(false);
    expect(isGrandHallT554PathWithin("C:\\review-pack", "F:\\evidence")).toBe(false);
    },
  );

  it("accepts only an absent output that is disjoint from every source root", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const preview = join(root, "preview");
    const output = join(root, "output");
    await mkdir(source);
    await mkdir(preview);

    await expect(
      assertGrandHallT554ReviewOutputSafety({
        sourceRoots: [source, preview],
        outputDirectory: output,
      }),
    ).resolves.toEqual({ outputDirectory: output, outputParent: root });

    await mkdir(output);
    await expect(
      assertGrandHallT554ReviewOutputSafety({
        sourceRoots: [source, preview],
        outputDirectory: output,
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_ALREADY_EXISTS" });
  });

  it("rejects an absent output nested inside a source root", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    await mkdir(source);

    await expect(
      assertGrandHallT554ReviewOutputSafety({
        sourceRoots: [source],
        outputDirectory: join(source, "derived-review"),
      }),
    ).rejects.toMatchObject({ code: "OUTPUT_OVERLAPS_SOURCE" });
  });
});

describe("Grand Hall T-554 review command arguments", () => {
  it("requires every local input and an explicit absent output target", () => {
    expect(
      parseGrandHallT554PanoramaReviewArguments([
        "--panorama-root",
        "F:\\panoramas",
        "--preview-root",
        "F:\\previews",
        "--membership",
        "C:\\membership.json",
        "--ceiling-color-plan",
        "F:\\matterpak\\ceilingcolorplan_001.jpg",
        "--output",
        "C:\\review-pack\\panoramas",
      ]),
    ).toEqual({
      panoramaSourceRoot: "F:\\panoramas",
      e57PreviewRoot: "F:\\previews",
      t550MembershipPath: "C:\\membership.json",
      ceilingColorPlanPath: "F:\\matterpak\\ceilingcolorplan_001.jpg",
      outputDirectory: "C:\\review-pack\\panoramas",
      check: false,
    });
    expect(
      parseGrandHallT554PanoramaReviewArguments([
        "--check",
        "--panorama-root",
        "F:\\panoramas",
        "--preview-root",
        "F:\\previews",
        "--membership",
        "C:\\membership.json",
        "--ceiling-color-plan",
        "F:\\matterpak\\ceilingcolorplan_001.jpg",
        "--output",
        "C:\\review-pack\\panoramas",
      ]),
    ).toMatchObject({ check: true, outputDirectory: "C:\\review-pack\\panoramas" });
    expect(() =>
      parseGrandHallT554PanoramaReviewArguments([
        "--panorama-root",
        "F:\\panoramas",
        "--panorama-root",
        "F:\\other",
      ]),
    ).toThrow(GrandHallT554PanoramaReviewError);
  });
});

describe("checked-in Grand Hall T-554 panorama review pack", () => {
  const artifactDirectory = fileURLToPath(
    new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/panoramas/",
      import.meta.url,
    ),
  );

  it("has exact inventory, self-digest, output hashes, RGB8 decode, and authority none", async () => {
    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(artifactDirectory),
    ).resolves.toMatchObject({
      manifestSha256:
        "sha256:4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc",
      manifestFileSha256:
        "sha256:2c8b44ef2cd840fddc3f0a49e82b73fff37b33f1d546126ed941029c1cb52b86",
      outputCount: 2,
      persistedInventoryVerified: true,
      pngDecodeVerified: true,
      authority: "none",
    });
  });

  it("rejects unexpected output entries and post-publication byte drift", async () => {
    const root = await temporaryRoot();
    const copyDirectory = join(root, "panoramas");
    await cp(artifactDirectory, copyDirectory, { recursive: true });
    const unexpected = join(copyDirectory, "unexpected.txt");
    await writeFile(unexpected, "inventory drift\n", { flag: "wx" });
    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
    await rm(unexpected);

    const overview = join(copyDirectory, "panorama-candidate-overview-review-only.png");
    const bytes = await readFile(overview);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await writeFile(overview, bytes);
    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });

  it("rejects a self-sealed hypothesis that presents itself as reviewed", async () => {
    const copyDirectory = await copyAndCanonicalResealManifest(
      artifactDirectory,
      (manifest) => {
        const firstHypothesis = manifest.sourceBindings.panoramaE57SequenceHypotheses[0];
        if (firstHypothesis === undefined) {
          throw new Error("Expected a persisted sequence hypothesis.");
        }
        setJsonField(firstHypothesis, "reviewedAt", "2026-08-25T00:00:00.000Z");
      },
    );

    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });

  it("rejects a self-sealed sequence change whose persisted overview still shows the old hypothesis", async () => {
    const copyDirectory = await copyAndCanonicalResealManifest(
      artifactDirectory,
      (manifest) => {
        const firstHypothesis = manifest.sourceBindings.panoramaE57SequenceHypotheses[0];
        if (firstHypothesis === undefined) {
          throw new Error("Expected a persisted sequence hypothesis.");
        }
        firstHypothesis.candidateScanIndex = 148;
      },
    );

    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });

  const selfSealedPanoramaManifestAttacks: ReadonlyArray<
    readonly [string, (manifest: MutablePanoramaManifest) => void]
  > = [
    ["candidate source scanIndex injection", (manifest) => {
      setJsonField(panoramaRecordAt(manifest, 0), "scanIndex", 0);
    }],
    ["candidate source geometric-camera authority", (manifest) => {
      setJsonField(
        panoramaRecordAt(manifest, 0),
        "geometricCameraAuthority",
        "human_accepted",
      );
    }],
    ["ineligible source runtime authority", (manifest) => {
      setJsonField(panoramaRecordAt(manifest, 50), "runtimeAuthority", "human_accepted");
    }],
    ["candidate source pose authority", (manifest) => {
      setJsonField(panoramaRecordAt(manifest, 0), "poseAuthority", "human_accepted");
    }],
    ["unknown source-binding field", (manifest) => {
      setJsonField(manifest.sourceBindings, "unexpectedAuthority", "human_accepted");
    }],
    ["root runtime authority", (manifest) => {
      setJsonField(manifest, "runtimeAuthority", "human_accepted");
    }],
    ["mutated panorama inventory digest", (manifest) => {
      manifest.sourceBindings.panoramaInventory.inventorySha256 =
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    }],
    ["mutated panorama inventory total bytes", (manifest) => {
      manifest.sourceBindings.panoramaInventory.totalBytes += 1;
    }],
    ["unknown panorama inventory field", (manifest) => {
      setJsonField(
        manifest.sourceBindings.panoramaInventory,
        "runtimeAuthority",
        "human_accepted",
      );
    }],
    ["mutated missing-sweep inventory", (manifest) => {
      manifest.sourceBindings.panoramaInventory.missingSweepNumbersWithin1To149 = [92, 93];
    }],
    ["mutated panorama inventory file count", (manifest) => {
      setJsonField(manifest.sourceBindings.panoramaInventory, "fileCount", 147);
    }],
    ["mutated panorama eligibility count", (manifest) => {
      setJsonField(manifest.sourceBindings.panoramaInventory, "candidateRecordCount", 49);
    }],
    ["out-of-range panorama source sweep", (manifest) => {
      setJsonField(panoramaRecordAt(manifest, 0), "sweepNumber", 150);
    }],
    ["duplicate hypothesis source sweep", (manifest) => {
      const first = manifest.sourceBindings.panoramaE57SequenceHypotheses[0];
      const second = manifest.sourceBindings.panoramaE57SequenceHypotheses[1];
      if (first === undefined || second === undefined) {
        throw new Error("Expected two persisted sequence hypotheses.");
      }
      second.sourceSweepNumber = first.sourceSweepNumber;
      second.sourceJpgFileName = first.sourceJpgFileName;
      second.sourceJpgSha256 = first.sourceJpgSha256;
    }],
    ["mutated diagnostic-preview total bytes", (manifest) => {
      manifest.sourceBindings.diagnosticPreviewInventory.totalBytes += 1;
    }],
    ["mutated diagnostic-preview digest", (manifest) => {
      const preview = manifest.sourceBindings.diagnosticPreviewInventory.records[0];
      if (preview === undefined) throw new Error("Expected one diagnostic preview record.");
      setJsonField(
        preview,
        "sha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["mutated non-crosswalk diagnostic-preview digest", (manifest) => {
      const preview = manifest.sourceBindings.diagnosticPreviewInventory.records[1];
      if (preview === undefined) throw new Error("Expected a second diagnostic preview record.");
      setJsonField(
        preview,
        "sha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["consistently resealed source panorama digest", (manifest) => {
      const hypothesis = manifest.sourceBindings.panoramaE57SequenceHypotheses[1];
      if (hypothesis === undefined) throw new Error("Expected a second sequence hypothesis.");
      const replacement =
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      setJsonField(panoramaRecordAt(manifest, 1), "sha256", replacement);
      hypothesis.sourceJpgSha256 = replacement;
      manifest.sourceBindings.panoramaInventory.inventorySha256 =
        computeGrandHallT554PanoramaInventorySha256(
          manifest.sourceBindings.panoramaInventory.records,
        );
    }],
    ["mutated T-550 membership file receipt", (manifest) => {
      setJsonField(
        manifest.sourceBindings.t550Membership,
        "fileSha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["mutated ceiling-plan byte length", (manifest) => {
      setJsonField(manifest.sourceBindings.ceilingColorPlan, "byteLength", 1);
    }],
    ["mutated ceiling-plan digest", (manifest) => {
      setJsonField(
        manifest.sourceBindings.ceilingColorPlan,
        "sha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["mutated ceiling-plan media type", (manifest) => {
      setJsonField(manifest.sourceBindings.ceilingColorPlan, "mediaType", "image/png");
    }],
    ["mutated ceiling-plan dimensions", (manifest) => {
      setJsonField(manifest.sourceBindings.ceilingColorPlan, "widthPx", 1);
    }],
    ["mutated ceiling-plan JPEG receipt", (manifest) => {
      setJsonField(manifest.sourceBindings.ceilingColorPlan, "jpegFrame", "progressive_dct");
    }],
    ["mutated crosswalk scan index", (manifest) => {
      const pair = manifest.sourceBindings.crosswalkEvidence.pairs[0];
      if (pair === undefined) throw new Error("Expected one crosswalk pair.");
      setJsonField(pair, "scanIndex", 148);
    }],
    ["mutated crosswalk candidate digest", (manifest) => {
      const pair = manifest.sourceBindings.crosswalkEvidence.pairs[0];
      if (pair === undefined) throw new Error("Expected one crosswalk pair.");
      setJsonField(
        pair,
        "candidatePanoramaSha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["mutated crosswalk preview digest", (manifest) => {
      const pair = manifest.sourceBindings.crosswalkEvidence.pairs[0];
      if (pair === undefined) throw new Error("Expected one crosswalk pair.");
      setJsonField(
        pair,
        "previewSha256",
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
    }],
    ["consistently rewritten crosswalk scores", (manifest) => {
      const pair = manifest.sourceBindings.crosswalkEvidence.pairs[0];
      if (pair === undefined) throw new Error("Expected one crosswalk pair.");
      setJsonField(pair, "candidateMatchRank", 42);
      setJsonField(pair, "candidateMatchScore", 0.5);
      setJsonField(pair, "runnerUpScanIndex", 2);
      setJsonField(pair, "runnerUpScore", 0.4);
      setJsonField(pair, "candidateMinusRunnerUpScore", 0.1);
    }],
    ["architectural-authority warning injection", (manifest) => {
      manifest.warnings[0] = "The scan sequence is accepted architectural camera authority.";
    }],
    ["mutated proof claim", (manifest) => {
      setJsonField(manifest.proof, "sourceWrites", "permitted");
    }],
  ];

  it.each(selfSealedPanoramaManifestAttacks)(
    "rejects canonical-resealed %s",
    async (_label, mutate) => {
      const copyDirectory = await copyAndCanonicalResealManifest(
        artifactDirectory,
        mutate,
      );

      await expect(
        verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
      ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
    },
  );

  it("rejects an externally hard-linked persisted panorama manifest", async () => {
    const root = await temporaryRoot();
    const copyDirectory = join(root, "panoramas");
    await cp(artifactDirectory, copyDirectory, { recursive: true });
    await link(
      join(copyDirectory, GRAND_HALL_T554_MANIFEST_FILENAME),
      join(root, "external-manifest-hardlink.json"),
    );

    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });

  it("rejects invalid UTF-8 that a replacement decoder could self-seal", async () => {
    const copyDirectory = await copyAndCanonicalResealManifest(
      artifactDirectory,
      (manifest) => {
        manifest.toolchain.nodeVersion = "\uFFFD";
      },
    );
    const manifestPath = join(copyDirectory, GRAND_HALL_T554_MANIFEST_FILENAME);
    const validBytes = await readFile(manifestPath);
    const replacementBytes = Buffer.from([0xef, 0xbf, 0xbd]);
    const replacementOffset = validBytes.indexOf(replacementBytes);
    if (replacementOffset < 0) throw new Error("Expected one UTF-8 replacement marker.");
    const invalidBytes = Buffer.concat([
      validBytes.subarray(0, replacementOffset),
      Buffer.from([0xff]),
      validBytes.subarray(replacementOffset + replacementBytes.length),
    ]);
    await writeFile(manifestPath, invalidBytes);

    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });

  it("rejects a UTF-8 BOM before an otherwise exact manifest", async () => {
    const root = await temporaryRoot();
    const copyDirectory = join(root, "panoramas");
    await cp(artifactDirectory, copyDirectory, { recursive: true });
    const manifestPath = join(copyDirectory, GRAND_HALL_T554_MANIFEST_FILENAME);
    const bytes = await readFile(manifestPath);
    await writeFile(manifestPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));

    await expect(
      verifyPersistedGrandHallT554PanoramaReviewPack(copyDirectory),
    ).rejects.toMatchObject({ code: "OUTPUT_VERIFICATION_FAILED" });
  });
});
