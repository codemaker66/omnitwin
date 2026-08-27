import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeGrandHallT554HumanDecisionsV3Sha256 } from "@omnitwin/types";

import {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  parseGrandHallT554ReviewPackV3Receipt,
  sealGrandHallT554ReviewPackV3Receipt,
  serializeGrandHallT554V3Json,
} from "../grand-hall-t554-review-pack-v3-contract.js";
import {
  __testOnlyGrandHallT554NativeReviewRegistry,
  loadGrandHallT554NativeReviewRegistry,
  type __GrandHallT554NativeReviewRegistryTestAnchor,
} from "../grand-hall-t554-native-review-registry.js";
import {
  createGrandHallT554V3Fixture,
  expectedBuiltFile,
  hashBuiltFile,
  type GrandHallT554V3FixtureHarness,
} from "./grand-hall-t554-review-pack-v3-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await rm(root, { force: true, recursive: true });
  }));
});

interface PublishedFixture {
  readonly fixture: GrandHallT554V3FixtureHarness;
  readonly anchor: __GrandHallT554NativeReviewRegistryTestAnchor;
}

async function publishProductionFixture(): Promise<PublishedFixture> {
  const fixture = await createGrandHallT554V3Fixture();
  roots.push(fixture.root);
  await mkdir(fixture.options.outputDirectory);
  const { receiptSha256: _testDigest, schemaVersion: _testSchema,
    state: _testState, exactSourceChecks: _testChecks, ...common } = fixture.built.receipt;
  const receipt = sealGrandHallT554ReviewPackV3Receipt({
    ...common,
    schemaVersion: GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
    state: "complete_human_pending",
    exactSourceChecks: {
      t561ExactRegenerationVerified: true,
      cleanupExactRegenerationVerified: true,
    },
  });
  const reviewPackBytes = expectedBuiltFile(
    fixture.built,
    GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  );
  const receiptBytes = serializeGrandHallT554V3Json(receipt);
  await Promise.all([
    writeFile(
      resolve(fixture.options.outputDirectory, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME),
      reviewPackBytes,
      { flag: "wx" },
    ),
    writeFile(
      resolve(fixture.options.outputDirectory, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME),
      expectedBuiltFile(fixture.built, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME),
      { flag: "wx" },
    ),
    writeFile(
      resolve(
        fixture.options.outputDirectory,
        GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
      ),
      expectedBuiltFile(fixture.built, GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME),
      { flag: "wx" },
    ),
    writeFile(
      resolve(
        fixture.options.outputDirectory,
        GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
      ),
      receiptBytes,
      { flag: "wx" },
    ),
  ]);
  return {
    fixture,
    anchor: {
      reviewPackSha256: fixture.built.reviewPack.artifactSha256,
      reviewPackFileSha256: hashBuiltFile(reviewPackBytes),
      reviewPackFileByteLength: reviewPackBytes.length,
      publicationReceiptSha256: receipt.receiptSha256,
      publicationReceiptFileSha256: hashBuiltFile(receiptBytes),
      publicationReceiptFileByteLength: receiptBytes.length,
    },
  };
}

function loadPublishedFixture(published: PublishedFixture) {
  return __testOnlyGrandHallT554NativeReviewRegistry.loadRegistry(
    {
      reviewPackDirectory: published.fixture.options.outputDirectory,
      panoramaSourceRoot: published.fixture.options.panoramaSourceRoot,
    },
    published.anchor,
  );
}

describe("Grand Hall T-554 native-review v3 registry", () => {
  it("loads exactly 148 fail-closed rows without exposing a path in its summary", async () => {
    const published = await publishProductionFixture();
    const { fixture } = published;
    const registry = await loadPublishedFixture(published);
    expect(registry.sources).toHaveLength(148);
    expect(registry.summary).toMatchObject({
      sourceCount: 148,
      authority: "none",
      reviewState: "human_pending",
      acceptanceAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      generatedContentAuthorized: false,
    });
    expect(JSON.stringify(registry.summary)).not.toContain(fixture.options.panoramaSourceRoot);
    expect(registry.sourceAt(0).source.inventoryIndex).toBe(0);
    expect(registry.sourceAt(147).source.inventoryIndex).toBe(147);
    expect(registry.mediaInputAt(0)).toMatchObject({
      sourceRoot: fixture.options.panoramaSourceRoot,
      fileName: registry.sourceAt(0).source.fileName,
      expectedSha256: registry.sourceAt(0).source.sha256,
    });
  });

  it("rejects out-of-range source access", async () => {
    const published = await publishProductionFixture();
    const registry = await loadPublishedFixture(published);
    expect(() => registry.sourceAt(-1)).toThrow(/0 through 147/u);
    expect(() => registry.sourceAt(148)).toThrow(/0 through 147/u);
    expect(() => registry.sourceAt(0.5)).toThrow(/integer/u);
  });

  it("keeps every returned source identity and semantic artifact deeply immutable", async () => {
    const published = await publishProductionFixture();
    const registry = await loadPublishedFixture(published);
    const before = registry.mediaInputAt(0);
    expect(Object.isFrozen(registry.reviewPack.panoramaRecords[0]?.source)).toBe(true);
    expect(Object.isFrozen(registry.pendingHumanDecisions.panoramaDecisions)).toBe(true);
    expect(Object.isFrozen(registry.publicationReceipt.sourceBindings)).toBe(true);
    expect(() => {
      (registry.sourceAt(0).source as { fileName: string }).fileName = "substituted.jpg";
    }).toThrow();
    expect(registry.mediaInputAt(0)).toEqual(before);
  });

  it("rejects extra files and any payload mutation", async () => {
    const extra = await publishProductionFixture();
    await writeFile(
      resolve(extra.fixture.options.outputDirectory, "extra.json"),
      "{}\n",
      { flag: "wx" },
    );
    await expect(loadPublishedFixture(extra)).rejects.toThrow(
      /exact four files|could not be loaded safely/i,
    );

    const changed = await publishProductionFixture();
    await writeFile(
      resolve(
        changed.fixture.options.outputDirectory,
        GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
      ),
      "{}\n",
    );
    await expect(loadPublishedFixture(changed)).rejects.toThrow(
      /does not match its receipt bytes/i,
    );
  });

  it("rejects a self-consistent production-shaped pack that is not the reviewed pack", async () => {
    const published = await publishProductionFixture();
    await expect(loadGrandHallT554NativeReviewRegistry({
      reviewPackDirectory: published.fixture.options.outputDirectory,
      panoramaSourceRoot: published.fixture.options.panoramaSourceRoot,
    })).rejects.toThrow(/reviewed Grand Hall evidence anchors/i);
  });

  it("rejects re-sealed payloads whose internal pack bindings were changed", async () => {
    const published = await publishProductionFixture();
    const directory = published.fixture.options.outputDirectory;
    const wrongReviewPackSha256 = `sha256:${"0".repeat(64)}` as const;
    const changedDecisions = {
      ...published.fixture.built.humanDecisions,
      reviewPackSha256: wrongReviewPackSha256,
    };
    const changedDecisionBytes = serializeGrandHallT554V3Json(changedDecisions);
    const receiptPath = resolve(
      directory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
    );
    const priorReceipt = parseGrandHallT554ReviewPackV3Receipt(await readFile(receiptPath));
    const { receiptSha256: _priorReceiptSha256, ...priorMaterial } = priorReceipt;
    const nextReceipt = sealGrandHallT554ReviewPackV3Receipt({
      ...priorMaterial,
      humanDecisionsSha256:
        computeGrandHallT554HumanDecisionsV3Sha256(changedDecisions),
      payloads: priorReceipt.payloads.map((payload) =>
        payload.relativePath === GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME
          ? {
              ...payload,
              byteLength: changedDecisionBytes.length,
              sha256: hashBuiltFile(changedDecisionBytes),
            }
          : payload),
    });
    const nextReceiptBytes = serializeGrandHallT554V3Json(nextReceipt);
    await Promise.all([
      writeFile(
        resolve(directory, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME),
        changedDecisionBytes,
      ),
      writeFile(receiptPath, nextReceiptBytes),
    ]);
    await expect(
      __testOnlyGrandHallT554NativeReviewRegistry.loadRegistry(
        {
          reviewPackDirectory: directory,
          panoramaSourceRoot: published.fixture.options.panoramaSourceRoot,
        },
        {
          ...published.anchor,
          publicationReceiptSha256: nextReceipt.receiptSha256,
          publicationReceiptFileSha256: hashBuiltFile(nextReceiptBytes),
          publicationReceiptFileByteLength: nextReceiptBytes.length,
        },
      ),
    ).rejects.toThrow(/could not be loaded safely/i);
  });

  it("rejects the structural-test receipt and relative trusted roots", async () => {
    const fixture = await createGrandHallT554V3Fixture();
    roots.push(fixture.root);
    await mkdir(fixture.options.outputDirectory);
    await Promise.all([
      writeFile(
        resolve(fixture.options.outputDirectory, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME),
        expectedBuiltFile(fixture.built, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME),
      ),
      writeFile(
        resolve(fixture.options.outputDirectory, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME),
        expectedBuiltFile(fixture.built, GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME),
      ),
      writeFile(
        resolve(
          fixture.options.outputDirectory,
          GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
        ),
        expectedBuiltFile(fixture.built, GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME),
      ),
      writeFile(
        resolve(
          fixture.options.outputDirectory,
          GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
        ),
        fixture.built.receiptBytes,
      ),
    ]);
    await expect(loadGrandHallT554NativeReviewRegistry({
      reviewPackDirectory: fixture.options.outputDirectory,
      panoramaSourceRoot: fixture.options.panoramaSourceRoot,
    })).rejects.toThrow(/publication receipt is invalid|could not be loaded safely/i);
    await expect(loadGrandHallT554NativeReviewRegistry({
      reviewPackDirectory: "relative-pack",
      panoramaSourceRoot: fixture.options.panoramaSourceRoot,
    })).rejects.toThrow(/absolute directory/i);
  });
});
