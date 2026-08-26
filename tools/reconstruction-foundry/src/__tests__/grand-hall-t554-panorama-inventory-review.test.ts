import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  GrandHallT554PanoramaReviewError,
  inspectStableGrandHallT554Jpeg,
  readGrandHallT554StablePanoramaBytes,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "../grand-hall-t554-panorama-review.js";
import {
  GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT,
  GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT,
  buildGrandHallT554PanoramaInventoryReviewManifest,
  buildGrandHallT554PanoramaInventoryReviewPagePlans,
  checkGrandHallT554PanoramaInventoryReview,
  generateGrandHallT554PanoramaInventoryReview,
  renderGrandHallT554PanoramaInventoryReviewPage,
  type GrandHallT554PanoramaInventoryReviewPagePlan,
  type GrandHallT554RenderedPanoramaInventoryReviewPage,
} from "../grand-hall-t554-panorama-inventory-review.js";
import {
  parseGrandHallT554PanoramaInventoryReviewArguments,
  runGrandHallT554PanoramaInventoryReviewCli,
  type GrandHallT554PanoramaInventoryReviewCliDependencies,
} from "../grand-hall-t554-panorama-inventory-review-cli.js";

const temporaryRoots: string[] = [];
const realPanoramaRoot = "F:\\downloads (some very important)\\TH Panoramic";
const realCandidateReviewDirectory = fileURLToPath(new URL(
  "../../../../docs/operations/grand-hall-t554-review-pack/panoramas/",
  import.meta.url,
));
const realIntegrationAvailable =
  existsSync(realPanoramaRoot) && existsSync(realCandidateReviewDirectory);

function digestFor(value: number): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;
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
    sha256: digestFor(sweepNumber),
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

function renderedPage(
  plan: GrandHallT554PanoramaInventoryReviewPagePlan,
): GrandHallT554RenderedPanoramaInventoryReviewPage {
  const bytes = Buffer.from(`page-${String(plan.pageNumber)}`, "utf8");
  return {
    relativePath: plan.relativePath,
    pageNumber: plan.pageNumber,
    sourceRecordCount: plan.records.length,
    sourceSweepNumbers: plan.records.map((record) => record.sweepNumber),
    sourceRecordInventorySha256: plan.sourceRecordInventorySha256,
    mediaType: "image/png",
    widthPx: 1_600,
    heightPx: 1_176,
    byteLength: bytes.length,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    authority: "none",
    role: "inventory_human_review_only_resampled_contact_sheet",
    reconstructionInputPermitted: false,
    bytes,
  };
}

async function jpeg(red: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 32,
      channels: 3,
      background: { r: red, g: 40, b: 20 },
    },
  }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("Grand Hall T-554 all-source panorama review pagination", () => {
  it("covers every non-candidate source exactly once in seven deterministic pages", () => {
    const plans = buildGrandHallT554PanoramaInventoryReviewPagePlans(
      fakeInventory().files,
    );

    expect(plans).toHaveLength(GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_PAGE_COUNT);
    expect(plans.map((page) => page.records.length)).toEqual([16, 16, 16, 16, 16, 16, 2]);
    expect(plans.flatMap((page) => page.records.map((record) => record.sweepNumber)))
      .toEqual(
        Array.from({ length: 99 }, (_, index) => index + 51)
          .filter((sweep) => sweep !== 93),
      );
    expect(plans[0]).toMatchObject({
      pageNumber: 1,
      relativePath: "panorama-inventory-human-review-page-01-of-07.png",
    });
    expect(plans.at(-1)?.records.at(-1)?.sweepNumber).toBe(149);
    expect(new Set(plans.map((page) => page.sourceRecordInventorySha256)).size).toBe(7);
  });

  it("fails closed when the supplied sweep inventory is incomplete or duplicated", () => {
    const files = [...fakeInventory().files];
    files[51] = files[50] as GrandHallT554PanoramaInventoryFile;

    expect(() => buildGrandHallT554PanoramaInventoryReviewPagePlans(files))
      .toThrow(expect.objectContaining({ code: "SOURCE_INVENTORY_INVALID" }));
  });
});

describe("Grand Hall T-554 all-source panorama review rendering", () => {
  it("renders a deterministic RGB8 page that remains authority-none", async () => {
    const record = fakeRecord(51);
    const plan: GrandHallT554PanoramaInventoryReviewPagePlan = {
      pageNumber: 1,
      relativePath: "panorama-inventory-human-review-page-01-of-07.png",
      records: [record],
      sourceRecordInventorySha256: digestFor(151),
    };
    const source = await jpeg(120);

    const rendered = await renderGrandHallT554PanoramaInventoryReviewPage(
      plan,
      () => Promise.resolve(source),
    );
    const rerendered = await renderGrandHallT554PanoramaInventoryReviewPage(
      plan,
      () => Promise.resolve(source),
    );
    const metadata = await sharp(rendered.bytes).metadata();

    expect(rendered).toMatchObject({
      pageNumber: 1,
      sourceRecordCount: 1,
      sourceSweepNumbers: [51],
      widthPx: 1_600,
      heightPx: 1_176,
      authority: "none",
      reconstructionInputPermitted: false,
    });
    expect(rerendered.bytes.equals(rendered.bytes)).toBe(true);
    expect(rerendered.sha256).toBe(rendered.sha256);
    expect(metadata).toMatchObject({ width: 1_600, height: 1_176, channels: 3 });
  });
});

describe("Grand Hall T-554 all-source panorama review render failures", () => {
  it("rejects undecodable source bytes instead of emitting a misleading tile", async () => {
    const plan: GrandHallT554PanoramaInventoryReviewPagePlan = {
      pageNumber: 1,
      relativePath: "panorama-inventory-human-review-page-01-of-07.png",
      records: [fakeRecord(51)],
      sourceRecordInventorySha256: digestFor(151),
    };

    await expect(
      renderGrandHallT554PanoramaInventoryReviewPage(
        plan,
        () => Promise.resolve(Buffer.from("not-a-jpeg", "utf8")),
      ),
    ).rejects.toMatchObject({ code: "RENDER_FAILED" });
  });
});

describe("Grand Hall T-554 real all-source panorama review integration", () => {
  it.skipIf(!realIntegrationAvailable)(
    "generates, publishes, and exact-regeneration-checks a temporary supplement",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "t554-real-panorama-review-"));
      temporaryRoots.push(root);
      const options = {
        panoramaSourceRoot: realPanoramaRoot,
        preservedCandidateReviewDirectory: realCandidateReviewDirectory,
        outputDirectory: join(root, "supplement"),
      };

      const generated = await generateGrandHallT554PanoramaInventoryReview(options);
      const checked = await checkGrandHallT554PanoramaInventoryReview(options);

      expect(generated.manifest.pagination).toMatchObject({
        pageCount: 7,
        outputFileCount: 8,
      });
      expect(checked).toMatchObject({
        pageCount: 7,
        outputFileCount: 8,
        sourceRecordCount: 98,
        exactRegenerationVerified: true,
      });
    },
    10 * 60_000,
  );
});

describe("Grand Hall T-554 all-source panorama review manifest", () => {
  it("binds 98 pending identities without carrying image bytes or inferring membership", () => {
    const inventory = fakeInventory();
    const plans = buildGrandHallT554PanoramaInventoryReviewPagePlans(inventory.files);
    const manifest = buildGrandHallT554PanoramaInventoryReviewManifest(
      inventory,
      plans,
      plans.map(renderedPage),
    );

    expect(manifest.panoramaInventory.records).toHaveLength(
      GRAND_HALL_T554_PANORAMA_INVENTORY_REVIEW_RECORD_COUNT,
    );
    expect(manifest.panoramaInventory.records.every((record) =>
      record.humanReviewState === "pending" &&
      record.possibleGrandHallEvidenceState === "human_pending" &&
      record.roomMembershipDisposition === null &&
      record.authority === "none"
    )).toBe(true);
    expect(manifest.scopeGuards).toMatchObject({
      candidateEligibilityChanged: false,
      roomMembershipInferred: false,
      humanAcceptanceRecorded: false,
      reconstructionAuthorized: false,
    });
    expect(manifest.pagination).toMatchObject({ pageCount: 7, outputFileCount: 8 });
    expect(JSON.stringify(manifest)).not.toContain('"bytes"');
  });
});

describe("Grand Hall T-554 stable panorama byte capture", () => {
  it("returns the exact bytes bound by the inspected source identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "t554-panorama-bytes-"));
    temporaryRoots.push(root);
    const path = join(root, "sweep_051jpg.jpg");
    const bytes = await jpeg(90);
    await writeFile(path, bytes, { flag: "wx" });
    const inspected = await inspectStableGrandHallT554Jpeg(
      path,
      `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/sweep_051jpg.jpg`,
    );
    const evidence: GrandHallT554PanoramaInventoryFile = {
      ...inspected,
      relativePath: "sweep_051jpg.jpg",
      sweepNumber: 51,
      digitToken: "051",
      namingAnomalies: [],
    };

    await expect(readGrandHallT554StablePanoramaBytes(path, evidence))
      .resolves.toEqual(bytes);
  });

  it("rejects bytes that no longer match their inspected digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "t554-panorama-bytes-"));
    temporaryRoots.push(root);
    const path = join(root, "sweep_051jpg.jpg");
    await writeFile(path, await jpeg(90), { flag: "wx" });
    const inspected = await inspectStableGrandHallT554Jpeg(
      path,
      `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/sweep_051jpg.jpg`,
    );
    const evidence: GrandHallT554PanoramaInventoryFile = {
      ...inspected,
      relativePath: "sweep_051jpg.jpg",
      sweepNumber: 51,
      digitToken: "051",
      namingAnomalies: [],
    };
    await writeFile(path, await jpeg(180));

    await expect(readGrandHallT554StablePanoramaBytes(path, evidence))
      .rejects.toBeInstanceOf(GrandHallT554PanoramaReviewError);
  });
});

const CLI_ARGV = [
  "--panorama-root", "F:\\panoramas",
  "--candidate-review-pack", "C:\\review-pack\\panoramas",
  "--output", "C:\\review-pack\\panorama-inventory-review",
] as const;

describe("Grand Hall T-554 all-source panorama review CLI arguments", () => {
  it("requires each source and output argument exactly once", () => {
    expect(parseGrandHallT554PanoramaInventoryReviewArguments(CLI_ARGV)).toEqual({
      panoramaSourceRoot: "F:\\panoramas",
      preservedCandidateReviewDirectory: "C:\\review-pack\\panoramas",
      outputDirectory: "C:\\review-pack\\panorama-inventory-review",
      check: false,
    });
    expect(parseGrandHallT554PanoramaInventoryReviewArguments(["--check", ...CLI_ARGV]))
      .toMatchObject({ check: true });
    expect(() => parseGrandHallT554PanoramaInventoryReviewArguments([
      "--panorama-root", "F:\\panoramas",
    ])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
  });
});

describe("Grand Hall T-554 all-source panorama review CLI execution", () => {
  it("reports generation and exact-check states through injected dependencies", async () => {
    const inventory = fakeInventory();
    const plans = buildGrandHallT554PanoramaInventoryReviewPagePlans(inventory.files);
    const manifest = buildGrandHallT554PanoramaInventoryReviewManifest(
      inventory,
      plans,
      plans.map(renderedPage),
    );
    const dependencies: GrandHallT554PanoramaInventoryReviewCliDependencies = {
      generate: (options) => Promise.resolve({
        outputDirectory: options.outputDirectory,
        manifest,
        manifestFileSha256: digestFor(500),
        manifestFileByteLength: 50_000,
      }),
      check: (options) => Promise.resolve({
        outputDirectory: options.outputDirectory,
        manifestSha256: manifest.manifestSha256,
        manifestFileSha256: digestFor(500),
        manifestFileByteLength: 50_000,
        pageCount: 7,
        outputFileCount: 8,
        sourceRecordCount: 98,
        pngDecodeVerified: true,
        authority: "none",
        exactRegenerationVerified: true,
      }),
    };
    const writes: string[] = [];

    await expect(runGrandHallT554PanoramaInventoryReviewCli(
      CLI_ARGV,
      { write: (text) => writes.push(text) },
      dependencies,
    )).resolves.toBe(0);
    await expect(runGrandHallT554PanoramaInventoryReviewCli(
      ["--check", ...CLI_ARGV],
      { write: (text) => writes.push(text) },
      dependencies,
    )).resolves.toBe(0);

    expect(writes[0]).toContain('"state": "generated_authority_none_human_pending"');
    expect(writes[0]).toContain('"pageCount": 7');
    expect(writes[0]).toContain('"outputFileCount": 8');
    expect(writes[1]).toContain('"state": "checked_exact_regeneration"');
    expect(writes[1]).toContain('"pageCount": 7');
    expect(writes[1]).toContain('"outputFileCount": 8');
  });
});
