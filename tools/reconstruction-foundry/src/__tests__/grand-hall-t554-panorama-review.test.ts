import { cp, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GrandHallT554PanoramaReviewError,
  assertGrandHallT554ReviewOutputSafety,
  buildGrandHallT554PanoramaReviewRecords,
  collectGrandHallT554PanoramaInventory,
  computeGrandHallT554PanoramaInventorySha256,
  inspectStableGrandHallT554Jpeg,
  isGrandHallT554PathWithin,
  parseGrandHallT554PanoramaFilename,
  verifyPersistedGrandHallT554PanoramaReviewPack,
  type GrandHallT554PanoramaInventoryFile,
  type GrandHallT554T550Binding,
} from "../grand-hall-t554-panorama-review.js";
import { parseGrandHallT554PanoramaReviewArguments } from "../grand-hall-t554-panorama-review-cli.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-panorama-test-"));
  temporaryRoots.push(root);
  return root;
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

    expect(records).toHaveLength(148);
    expect(records.filter((record) => record.reviewEligibility === "t550_candidate_human_pending"))
      .toHaveLength(50);
    expect(
      records.filter(
        (record) => record.reviewEligibility === "not_in_t550_ineligible_unreviewed",
      ),
    ).toHaveLength(98);
    expect(records.slice(50).every((record) => !record.reconstructionInputPermitted)).toBe(true);

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
        "sha256:c2d74ee55b27be9b4641d3b94968591d37735d353987d30adca4fc785b3636ef",
      manifestFileSha256:
        "sha256:665c46af456e01ee1f61d59cce24f0e818258e56693d4ac01e550cebac9474ab",
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
});
