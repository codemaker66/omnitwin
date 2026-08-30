import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS,
  GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS,
  GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES,
  __testOnlyPublishGrandHallMatterportBoundaryReview,
  assertGrandHallMatterportBoundaryPartialDirectoryDirectChild,
  buildGrandHallMatterportBoundaryReviewForm,
  buildGrandHallMatterportBoundaryReviewPlan,
  checkGrandHallMatterportBoundaryReview,
  generateGrandHallMatterportBoundaryReview,
  renderGrandHallMatterportBoundaryContactSheet,
} from "../grand-hall-matterport-boundary-contact-sheet.js";
import {
  parseGrandHallMatterportBoundaryContactSheetArguments,
  runGrandHallMatterportBoundaryContactSheetCli,
  type GrandHallMatterportBoundaryContactSheetCliDependencies,
} from "../grand-hall-matterport-boundary-contact-sheet-cli.js";
import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "../grand-hall-t554-panorama-review.js";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function fakeRecord(sweepNumber: number): GrandHallT554PanoramaInventoryFile {
  const relativePath = `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`;
  return {
    sourceLocator: `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${relativePath}`,
    relativePath,
    sweepNumber,
    digitToken: String(sweepNumber).padStart(3, "0"),
    namingAnomalies: [],
    byteLength: 1_000 + sweepNumber,
    sha256: digest(relativePath),
    mediaType: "image/jpeg",
    widthPx: 8_192,
    heightPx: 4_096,
    jpegFrame: "baseline_dct",
    jfifHeaderPresent: true,
    stableDuringRead: true,
  };
}

function fakeInventory(): GrandHallT554PanoramaInventory {
  const files = Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweep) => sweep !== 93)
    .map(fakeRecord);
  return {
    sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
    files,
    inventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    missingSweepNumbersWithin1To149: [93],
    readMode: "read_only",
    sourceMutationPermitted: false,
    networkAccess: "none",
  };
}

const realPanoramaRoot = "F:\\downloads (some very important)\\TH Panoramic";
const realIntegrationAvailable = existsSync(realPanoramaRoot);

describe("Grand Hall Matterport boundary review planning", () => {
  it("selects exact sweeps 001-060 without pre-acceptance and enlarges only 047-051", () => {
    const inventory = fakeInventory();
    const plan = buildGrandHallMatterportBoundaryReviewPlan(
      "C:\\source\\panoramas",
      inventory.files,
    );
    const form = buildGrandHallMatterportBoundaryReviewForm(plan, inventory);
    const records = form.records as readonly Readonly<Record<string, unknown>>[];

    expect(plan.records.map((record) => record.source.sweepNumber))
      .toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
    expect(plan.records.filter((record) => record.enlargedBoundaryTile !== null)
      .map((record) => record.source.sweepNumber))
      .toEqual(GRAND_HALL_MATTERPORT_BOUNDARY_DETAIL_SWEEPS);
    expect(plan.records.every((record) => record.initialLabel === "UNREVIEWED")).toBe(true);
    expect(plan.records.every((record) =>
      record.mainTile.fullEquirectangularFrameVisible &&
      !record.mainTile.cropApplied &&
      (record.enlargedBoundaryTile === null || (
        record.enlargedBoundaryTile.fullEquirectangularFrameVisible &&
        !record.enlargedBoundaryTile.cropApplied
      ))
    )).toBe(true);
    expect(form.allowedLabels).toEqual(GRAND_HALL_MATTERPORT_BOUNDARY_ALLOWED_LABELS);
    expect(records).toHaveLength(60);
    expect(records.every((record) => record.label === "UNREVIEWED")).toBe(true);
  });

  it("fails closed when one selected source is absent", () => {
    const files = fakeInventory().files.filter((record) => record.sweepNumber !== 49);
    expect(() => buildGrandHallMatterportBoundaryReviewPlan("C:\\source", files))
      .toThrow(expect.objectContaining({ code: "SOURCE_INVENTORY_INVALID" }));
  });

  it("keeps the evidence output inventory fixed", () => {
    expect(GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES).toEqual([
      "matterport-boundary-contact-sheet-sweeps-001-060.png",
      "matterport-boundary-provenance.json",
      "README.md",
      "matterport-boundary-review-form.json",
    ]);
  });
});

describe("Grand Hall Matterport boundary contact-sheet rendering", () => {
  it("loads each source once and produces byte-identical RGB8 output", async () => {
    const plan = buildGrandHallMatterportBoundaryReviewPlan(
      "C:\\source\\panoramas",
      fakeInventory().files,
    );
    const source = await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 90, g: 60, b: 30 },
      },
    }).jpeg({ quality: 90 }).toBuffer();
    const sourceBefore = Buffer.from(source);
    const sourceSha256Before = digest(source.toString("base64"));
    let loads = 0;
    const first = await renderGrandHallMatterportBoundaryContactSheet(plan, () => {
      loads += 1;
      return Promise.resolve(source);
    });
    const second = await renderGrandHallMatterportBoundaryContactSheet(
      plan,
      () => Promise.resolve(source),
    );
    const metadata = await sharp(first.bytes).metadata();

    expect(loads).toBe(60);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first).toMatchObject({
      widthPx: 3_440,
      heightPx: 1_900,
      sourceLoadCount: 60,
      fullEquirectangularFrameVisible: true,
      cropApplied: false,
    });
    expect(metadata).toMatchObject({ width: 3_440, height: 1_900, channels: 3 });
    expect(source.equals(sourceBefore)).toBe(true);
    expect(digest(source.toString("base64"))).toBe(sourceSha256Before);
  });
});

describe("Grand Hall Matterport boundary publication safety", () => {
  it("rejects a partial directory that is not a direct child with the owned fixed prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-boundary-parent-"));
    try {
      const output = join(root, "review");
      expect(() => {
        assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
          root,
          output,
          join(root, ".review.partial-owned"),
        );
      }).not.toThrow();
      expect(() => {
        assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
          root,
          output,
          join(root, "nested", ".review.partial-owned"),
        );
      }).toThrow(expect.objectContaining({ code: "OUTPUT_PUBLISH_FAILED" }));
      expect(() => {
        assertGrandHallMatterportBoundaryPartialDirectoryDirectChild(
          root,
          output,
          join(root, ".different.partial-owned"),
        );
      }).toThrow(expect.objectContaining({ code: "OUTPUT_PUBLISH_FAILED" }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recursively cleans only its asserted direct-child partial after an injected atomic failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-boundary-atomic-"));
    try {
      const output = join(root, "review");
      const artifacts = new Map(
        GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES.map((name) => [
          name,
          Buffer.from(`test-only-${name}`, "utf8"),
        ]),
      );
      let partialDirectory: string | undefined;
      await expect(__testOnlyPublishGrandHallMatterportBoundaryReview(
        output,
        root,
        { artifacts },
        {
          afterTemporaryDirectoryCreated: async (temporary) => {
            partialDirectory = temporary;
            const nested = join(temporary, "nested");
            await mkdir(nested);
            await writeFile(join(nested, "partial.txt"), "partial", { flag: "wx" });
            throw new Error("injected publication failure");
          },
        },
      )).rejects.toMatchObject({ code: "OUTPUT_PUBLISH_FAILED" });
      expect(partialDirectory).toBeDefined();
      expect(existsSync(output)).toBe(false);
      expect(partialDirectory === undefined ? true : existsSync(partialDirectory)).toBe(false);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects output nested inside the panorama source before reading inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-boundary-overlap-"));
    try {
      const source = join(root, "source");
      await mkdir(source);
      await expect(generateGrandHallMatterportBoundaryReview({
        panoramaSourceRoot: source,
        outputDirectory: join(source, "review"),
      })).rejects.toMatchObject({ code: "OUTPUT_OVERLAPS_SOURCE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Grand Hall Matterport real byte-identical regeneration", () => {
  it.skipIf(!realIntegrationAvailable)(
    "generates and checks identical bytes without changing selected source sizes or mtimes",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "grand-hall-boundary-real-"));
      try {
        const sourcePaths = Array.from({ length: 60 }, (_, index) =>
          join(realPanoramaRoot, `sweep_${String(index + 1).padStart(3, "0")}jpg.jpg`));
        const before = await Promise.all(sourcePaths.map(async (path) => {
          const evidence = await stat(path);
          return { path, size: evidence.size, mtimeMs: evidence.mtimeMs };
        }));
        const outputDirectory = join(root, "review");
        const generated = await generateGrandHallMatterportBoundaryReview({
          panoramaSourceRoot: realPanoramaRoot,
          outputDirectory,
        });
        const persistedBeforeCheck = await Promise.all(
          GRAND_HALL_MATTERPORT_BOUNDARY_OUTPUT_FILENAMES.map(async (name) => ({
            name,
            bytes: await readFile(join(outputDirectory, name)),
          })),
        );
        const checked = await checkGrandHallMatterportBoundaryReview({
          panoramaSourceRoot: realPanoramaRoot,
          outputDirectory,
        });
        const after = await Promise.all(sourcePaths.map(async (path) => {
          const evidence = await stat(path);
          return { path, size: evidence.size, mtimeMs: evidence.mtimeMs };
        }));

        expect(checked.exactRegenerationVerified).toBe(true);
        expect(checked.outputs).toEqual(generated.outputs);
        expect(after).toEqual(before);
        for (const persisted of persistedBeforeCheck) {
          expect(await readFile(join(outputDirectory, persisted.name))).toEqual(persisted.bytes);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    10 * 60_000,
  );
});

describe("Grand Hall Matterport boundary contact-sheet CLI", () => {
  it("parses the strict generate and check forms", () => {
    expect(parseGrandHallMatterportBoundaryContactSheetArguments([
      "--panorama-root", "C:\\source", "--output", "C:\\output",
    ])).toEqual({ panoramaSourceRoot: "C:\\source", outputDirectory: "C:\\output", check: false });
    expect(parseGrandHallMatterportBoundaryContactSheetArguments([
      "--check", "--output", "C:\\output", "--panorama-root", "C:\\source",
    ])).toEqual({ panoramaSourceRoot: "C:\\source", outputDirectory: "C:\\output", check: true });
    expect(() => parseGrandHallMatterportBoundaryContactSheetArguments([
      "--panorama-root", "C:\\source", "--panorama-root", "C:\\source", "--output", "C:\\output",
    ])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
  });

  it("routes check mode without changing its requested paths", async () => {
    const writes: string[] = [];
    let checked = 0;
    const result = {
      outputDirectory: "C:\\output",
      provenanceSha256: digest("provenance"),
      provenanceFileSha256: digest("provenance-file"),
      panoramaInventorySha256: digest("inventory"),
      outputs: [],
      sourceRecordCount: 60 as const,
      allLabelsUnreviewed: true as const,
      exactRegenerationVerified: true as const,
    };
    const dependencies: GrandHallMatterportBoundaryContactSheetCliDependencies = {
      generate: () => Promise.reject(new Error("generate must not run")),
      check: (options) => {
        expect(options).toEqual({ panoramaSourceRoot: "C:\\source", outputDirectory: "C:\\output" });
        checked += 1;
        return Promise.resolve(result);
      },
    };

    await expect(runGrandHallMatterportBoundaryContactSheetCli([
      "--panorama-root", "C:\\source", "--output", "C:\\output", "--check",
    ], { write: (text) => writes.push(text) }, dependencies)).resolves.toBe(0);
    expect(checked).toBe(1);
    expect(writes.join("")).toContain("checked_exact_regeneration");
  });
});
