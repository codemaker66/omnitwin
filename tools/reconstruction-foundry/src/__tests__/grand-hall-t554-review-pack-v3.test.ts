import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GrandHallT554HumanDecisionsV3Schema,
  computeGrandHallInterfaceInventorySha256,
  computeGrandHallPanoramaObservationInventoryV2Sha256,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  computeGrandHallT554HumanDecisionsV3Sha256,
  type GrandHallT554HumanDecisionsV3,
} from "@omnitwin/types";

import * as reconstructionFoundryPublic from "../index.js";
import {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
  __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings,
  __testOnlyCheckGrandHallT554ReviewPackV3Structure,
  __testOnlyInspectGrandHallT554ReviewPackV3Structure,
  __testOnlyLoadGrandHallT554ReviewPackV3Sources,
  __testOnlyPublishGrandHallT554ReviewPackV3Structure,
  checkGrandHallT554ReviewPackV3,
  generateGrandHallT554ReviewPackV3,
  type GrandHallT554ReviewPackV3Options,
} from "../grand-hall-t554-review-pack-v3.js";
import {
  GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
  GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA,
  parseGrandHallT554ReviewPackV3Receipt,
  parseGrandHallT554ReviewPackV3TestReceipt,
  sealGrandHallT554ReviewPackV3Receipt,
  sealGrandHallT554ReviewPackV3TestReceipt,
  serializeGrandHallT554V3Json,
} from "../grand-hall-t554-review-pack-v3-contract.js";
import { writeGrandHallT554V3ExclusiveSyncedFile } from
  "../grand-hall-t554-review-pack-v3-files.js";
import {
  createGrandHallT554V3Fixture,
  fixtureDigest,
  type GrandHallT554V3FixtureHarness,
} from "./grand-hall-t554-review-pack-v3-fixture.js";

const roots: string[] = [];

async function fixture(): Promise<GrandHallT554V3FixtureHarness> {
  const harness = await createGrandHallT554V3Fixture();
  roots.push(harness.root);
  return harness;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function outputNames(): readonly string[] {
  return [GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
    GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
    GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
    GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME];
}

async function snapshotFiles(directory: string) {
  return await Promise.all(outputNames().map(async (name) => ({ name,
    bytes: await readFile(join(directory, name)),
    modified: (await stat(join(directory, name), { bigint: true })).mtimeNs })));
}

function exactFixtureRunners(harness: GrandHallT554V3FixtureHarness) {
  return {
    checkT561: () => Promise.resolve(harness.bundle.t561Exact),
    checkCleanup: () => Promise.resolve(harness.bundle.cleanupExact),
    loadReview: () => Promise.resolve(harness.bundle.review),
  };
}

function resealHumanDecisions(
  harness: GrandHallT554V3FixtureHarness,
  decisions: GrandHallT554HumanDecisionsV3,
) {
  const bytes = serializeGrandHallT554V3Json(decisions);
  const payloads = harness.built.receipt.payloads.map((payload) =>
    payload.relativePath === GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME
      ? { ...payload, byteLength: bytes.length, sha256: fixtureDigest(bytes) }
      : payload);
  const { receiptSha256: _digest, ...material } = harness.built.receipt;
  void _digest;
  const receipt = sealGrandHallT554ReviewPackV3TestReceipt({ ...material, payloads,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsV3Sha256(decisions) });
  return { bytes, receiptBytes: serializeGrandHallT554V3Json(receipt) };
}

describe("T-554 v3 exact human-pending construction", () => {
  it("binds the exact 148 / 74-74 / absent-93 review surface", async () => {
    const harness = await fixture();
    const { reviewPack, humanDecisions, closedVolumeTemplate } = harness.built;

    expect(reviewPack.panoramaRecords).toHaveLength(148);
    expect(reviewPack.observationSummary).toEqual({ sourceRecordCount: 148,
      grandHallPixelsObservedHumanPendingCount: 74,
      noGrandHallPixelsObservedHumanPendingCount: 74, humanPendingCount: 148 });
    expect(reviewPack.sourceEvidence.t561AuthorityNoneObservation).toMatchObject({
      sourceRecordCount: 148, absentSweepNumbersWithin1To149: [93],
      grandHallPixelsObservedCount: 74, noGrandHallPixelsObservedCount: 74,
      uncertainPossibleGrandHallPixelsCount: 0, authority: "none" });
    expect(reviewPack.interfaceCandidates).toHaveLength(8);
    expect(closedVolumeTemplate).toMatchObject({ reviewState: "human_pending",
      finalDecision: "PENDING", reviewer: null, footprintXY: [], zMin: null,
      zMax: null, rendered: false, generatedGeometryCreated: false });
    expect(humanDecisions.panoramaDecisionCount).toBe(148);
  });

  it("keeps every native, cleanup, interface, room, and volume decision blank", async () => {
    const harness = await fixture();
    const decisions = harness.built.humanDecisions;

    expect(decisions).toMatchObject({ authority: "none", reviewState: "human_pending",
      finalDecision: "PENDING", reviewer: null,
      nativeResolutionHumanReviewCompleted: false, nativeReviewEvidenceSetSha256: null,
      matterPakRoomDecision: { result: "UNSURE", note: null },
      closedSelectionVolumeDecision: { result: "UNSURE",
        reviewArtifactSha256: null, note: null } });
    expect(decisions.panoramaDecisions.every((row) => row.result === "UNSURE" &&
      row.classification === null && row.maskFileName === null &&
      row.reviewedMaskBinding === null && !row.maskReviewed &&
      !row.nativeResolutionHumanReviewCompleted && row.nativeReviewEvidenceSha256 === null &&
      row.maskReasonCodes.length === 0 && row.note === null)).toBe(true);
    expect(decisions.cleanupArtifactInspections.map((row) => row.artifactClass))
      .toEqual(["Window", "Mirror"]);
    expect(decisions.cleanupArtifactInspections.every((row) => row.result === "UNSURE" &&
      row.localizationState === null && row.reviewedTargetIds.length === 0 &&
      !row.nativeSourceReviewCompleted && row.note === null)).toBe(true);
    expect(decisions.interfaceDecisions.every((row) => row.result === "UNSURE" &&
      row.reviewedClosurePlaneBinding === null && row.note === null)).toBe(true);
  });

  it("rejects validly resealed resolved rows in every human-pending field family", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const base = harness.built.humanDecisions;
    const excludeIndex = base.panoramaDecisions.findIndex((row) =>
      row.sourceObservation.state === "no_grand_hall_pixels_observed_human_pending");
    const mutations = [
      { ...base, panoramaDecisions: base.panoramaDecisions.map((row, index) =>
        index === excludeIndex ? { ...row, result: "EXCLUDE" as const,
          classification: "no_observed_grand_hall_pixels" as const,
          nativeResolutionHumanReviewCompleted: true,
          nativeReviewEvidenceSha256: fixtureDigest("partial-native-review"),
          note: "Resolved only for adversarial inspection." } : row) },
      { ...base, cleanupArtifactInspections: base.cleanupArtifactInspections.map((row, index) =>
        index === 0 ? { ...row, result: "REJECT_SOURCE_SCOPE_HANDLING" as const,
          localizationState: "metadata_inconclusive_no_explicit_source_locator" as const,
          note: "Resolved only for adversarial inspection." } : row) },
      { ...base, interfaceDecisions: base.interfaceDecisions.map((row, index) =>
        index === 0 ? { ...row, result: "EXCLUDE_BEYOND_INTERFACE" as const,
          reviewedClosurePlaneBinding: null,
          note: "Resolved only for adversarial inspection." } : row) },
      { ...base, matterPakRoomDecision: { ...base.matterPakRoomDecision,
        result: "REJECT_AS_GRAND_HALL" as const,
        note: "Resolved only for adversarial inspection." } },
      { ...base, closedSelectionVolumeDecision: { ...base.closedSelectionVolumeDecision,
        result: "REJECT_SELECTION_VOLUME" as const,
        reviewArtifactSha256: fixtureDigest("partial-volume-review"),
        note: "Resolved only for adversarial inspection." } },
    ];
    const decisionsPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME);
    const receiptPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    for (const input of mutations) {
      const decisions = GrandHallT554HumanDecisionsV3Schema.parse(input);
      const sealed = resealHumanDecisions(harness, decisions);
      await writeFile(decisionsPath, sealed.bytes, { flag: "w" });
      await writeFile(receiptPath, sealed.receiptBytes, { flag: "w" });
      await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
        harness.options.outputDirectory, {},
      )).rejects.toBeDefined();
    }
  });

  it("rejects resealed T-550, panorama-row, and interface-candidate substitutions", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const base = harness.built.humanDecisions;
    const panoramaRows = base.panoramaDecisions.map((row, index) => index === 0
      ? { ...row, source: { ...row.source, sha256: fixtureDigest("substitute-panorama") } }
      : row);
    const interfaceRows = base.interfaceDecisions.map((row, index) => index === 0
      ? { ...row, source: { ...row.source,
        sharedSourceVertexSetSha256: fixtureDigest("substitute-interface") } }
      : row);
    const mutations = [
      { ...base, matterPakRoomDecision: { ...base.matterPakRoomDecision,
        sourceMembershipV1Sha256: fixtureDigest("substitute-t550") } },
      { ...base, panoramaDecisions: panoramaRows,
        sourcePanoramaInventorySha256: computeGrandHallPanoramaSourceInventoryV3Sha256(
          panoramaRows.map((row) => row.source)),
        sourceObservationInventorySha256: computeGrandHallPanoramaObservationInventoryV2Sha256(
          panoramaRows.map((row) => ({ source: row.source,
            observation: row.sourceObservation }))) },
      { ...base, interfaceDecisions: interfaceRows,
        sourceInterfaceInventorySha256: computeGrandHallInterfaceInventorySha256(
          interfaceRows.map((row) => row.source)) },
    ];
    const decisionsPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME);
    const receiptPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    for (const input of mutations) {
      const decisions = GrandHallT554HumanDecisionsV3Schema.parse(input);
      const sealed = resealHumanDecisions(harness, decisions);
      await writeFile(decisionsPath, sealed.bytes, { flag: "w" });
      await writeFile(receiptPath, sealed.receiptBytes, { flag: "w" });
      await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
        harness.options.outputDirectory, {},
      )).rejects.toBeDefined();
    }
  });

  it("uses concrete T-551 evidence and exact cleanup semantic, inventory, and byte bindings", async () => {
    const harness = await fixture();
    const pack = harness.built.reviewPack;
    const receipt = harness.built.receipt;
    const cleanup = harness.bundle.cleanupFiles;
    const t551 = pack.sourceEvidence.t551SourceEvidenceSha256;

    expect(t551).not.toBe(pack.sourceEvidence.boundaryReviewManifestSha256);
    expect(harness.built.humanDecisions.matterPakRoomDecision.sourceBoundaryEvidenceSha256)
      .toBe(t551);
    expect(harness.built.humanDecisions.cleanupArtifactInspections.every(
      (row) => row.sourceBoundaryEvidenceSha256 === t551)).toBe(true);
    expect(receipt.sourceBindings).toMatchObject({ t551SourceEvidenceSha256: t551,
      cleanupMarkerEvidenceSha256: cleanup.evidence.evidenceSha256,
      cleanupTargetInventorySha256: cleanup.evidence.cleanupTargetInventorySha256,
      cleanupEvidenceFileSha256: cleanup.evidenceFile.sha256,
      cleanupEvidenceFileByteLength: cleanup.evidenceFile.bytes.length,
      cleanupReceiptSha256: cleanup.receipt.receiptSha256,
      cleanupReceiptFileSha256: cleanup.receiptFile.sha256,
      cleanupReceiptFileByteLength: cleanup.receiptFile.bytes.length });
    expect(cleanup.receipt.payload).toMatchObject({
      byteLength: cleanup.evidenceFile.bytes.length,
      sha256: cleanup.evidenceFile.sha256 });
    expect(() => {
      __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings(harness.bundle);
    }).not.toThrow();
  });

  it("separates honest test receipts from strict authoritative production receipts", async () => {
    const harness = await fixture();
    expect(parseGrandHallT554ReviewPackV3TestReceipt(harness.built.receiptBytes))
      .toEqual(harness.built.receipt);
    expect(harness.built.receipt).toMatchObject({
      schemaVersion: GRAND_HALL_T554_V3_TEST_RECEIPT_SCHEMA,
      state: "structural_test_only",
      exactSourceChecks: { t561ExactRegenerationVerified: false,
        cleanupExactRegenerationVerified: false },
    });
    expect(() => parseGrandHallT554ReviewPackV3Receipt(harness.built.receiptBytes))
      .toThrow("publication receipt is invalid");

    const { receiptSha256: _digest, schemaVersion: _schema, state: _state,
      exactSourceChecks: _checks, ...common } = harness.built.receipt;
    const authoritative = sealGrandHallT554ReviewPackV3Receipt({ ...common,
      schemaVersion: GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
      state: "complete_human_pending",
      exactSourceChecks: { t561ExactRegenerationVerified: true,
        cleanupExactRegenerationVerified: true } });
    const bytes = serializeGrandHallT554V3Json(authoritative);
    expect(parseGrandHallT554ReviewPackV3Receipt(bytes)).toEqual(authoritative);
    const raw = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    const missing = { ...raw };
    delete missing.receiptSha256;
    const extra = { ...raw, unboundClaim: true };
    const tampered = { ...raw, receiptSha256: fixtureDigest("tampered") };
    for (const attack of [missing, extra, tampered]) {
      expect(() => parseGrandHallT554ReviewPackV3Receipt(serializeGrandHallT554V3Json(attack)))
        .toThrow("publication receipt is invalid");
    }
  });

  it("rejects every resealed predecessor, T-561, T-551, and cleanup semantic mismatch", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const fields = ["predecessorReviewPackArtifactSha256", "t561ObservationSetSha256",
      "t561ManifestSha256", "t561ReceiptSha256", "t551SourceEvidenceSha256",
      "cleanupMarkerEvidenceSha256", "cleanupTargetInventorySha256"] as const;
    const { receiptSha256: _digest, ...material } = harness.built.receipt;
    void _digest;
    const receiptPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    for (const field of fields) {
      const receipt = sealGrandHallT554ReviewPackV3TestReceipt({ ...material,
        sourceBindings: { ...material.sourceBindings,
          [field]: fixtureDigest(`wrong-${field}`) } });
      await writeFile(receiptPath, serializeGrandHallT554V3Json(receipt), { flag: "w" });
      await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
        harness.options.outputDirectory, {},
      )).rejects.toThrow("semantic cross-bindings disagree");
    }
  });

  it("rejects every cleanup semantic, inventory, file, and receipt mismatch", async () => {
    const harness = await fixture();
    const exactFields = ["evidenceSha256", "cleanupTargetInventorySha256",
      "receiptSha256", "evidenceFileSha256", "receiptFileSha256"] as const;
    for (const field of exactFields) {
      const forged = { ...harness.bundle, cleanupExact: {
        ...harness.bundle.cleanupExact, [field]: fixtureDigest(`wrong-${field}`),
      } };
      expect(() => {
        __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings(forged);
      }).toThrow("real exact-source check");
    }
    const receiptAttacks = [
      { evidenceSha256: fixtureDigest("wrong-evidence-semantic") },
      { cleanupTargetInventorySha256: fixtureDigest("wrong-cleanup-inventory") },
      { payload: { ...harness.bundle.cleanupFiles.receipt.payload,
        byteLength: harness.bundle.cleanupFiles.receipt.payload.byteLength + 1 } },
      { payload: { ...harness.bundle.cleanupFiles.receipt.payload,
        sha256: fixtureDigest("wrong-cleanup-payload-file") } },
    ];
    for (const attack of receiptAttacks) {
      const forged = { ...harness.bundle, cleanupFiles: {
        ...harness.bundle.cleanupFiles,
        receipt: { ...harness.bundle.cleanupFiles.receipt, ...attack },
      } };
      expect(() => {
        __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings(forged);
      }).toThrow("byte-cross-bound");
    }
  });

  it("rejects cleanup evidence aliased to the boundary manifest instead of T-551", async () => {
    const harness = await fixture();
    const boundary = harness.bundle.review.predecessor.sourceEvidence.boundaryReviewManifestSha256;
    const room9 = harness.bundle.cleanupFiles.evidence.sourceBindings.room9SourceBoundaryEvidence;
    expect(Reflect.set(room9, "evidenceSha256", boundary)).toBe(true);
    expect(() => {
      __testOnlyAssertGrandHallT554ReviewPackV3SourceBindings(harness.bundle);
    }).toThrow("concrete T-551 source evidence");
  });

  it("reports missing or tampered cleanup inputs as source-invalid", async () => {
    const harness = await fixture();
    const evidencePath = harness.bundle.cleanupFiles.evidenceFile.absolutePath;
    const receiptPath = harness.bundle.cleanupFiles.receiptFile.absolutePath;
    const evidenceBytes = await readFile(evidencePath);
    await unlink(evidencePath);
    await expect(__testOnlyLoadGrandHallT554ReviewPackV3Sources(
      harness.options, exactFixtureRunners(harness),
    )).rejects.toMatchObject({ code: "SOURCE_INVALID" });
    await writeFile(evidencePath, evidenceBytes, { flag: "wx" });
    await writeFile(receiptPath, "{}\n", { flag: "w" });
    await expect(__testOnlyLoadGrandHallT554ReviewPackV3Sources(
      harness.options, exactFixtureRunners(harness),
    )).rejects.toMatchObject({ code: "SOURCE_INVALID" });
  });
});

describe("T-554 v3 no-replace receipt-last publication", () => {
  it("writes the receipt last, preserves v2, and returns only structural test authority", async () => {
    const harness = await fixture();
    const v2Directory = join(harness.root, "v2-existing");
    const v2Sentinel = join(v2Directory, "publication-receipt-v2.json");
    await mkdir(v2Directory);
    await writeFile(v2Sentinel, "immutable-v2", { flag: "wx" });
    const order: string[] = [];
    const published = await __testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built, {
        beforePayloadWrite: (name) => { order.push(name); },
        beforeReceiptWrite: async (output) => {
          order.push(GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
          const payloadNames = outputNames().filter((name) =>
            name !== GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
          expect((await Promise.all(payloadNames.map((name) => stat(join(output, name)))))
            .every((row) => row.isFile())).toBe(true);
          await expect(stat(join(output,
            GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME))).rejects.toBeDefined();
        },
      },
    );

    expect(order.at(-1)).toBe(GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    expect(published.sourceVerificationState).toBe("not_checked_test_only");
    expect((await Promise.all(outputNames().map((name) =>
      stat(join(harness.options.outputDirectory, name))))).every((row) => row.isFile())).toBe(true);
    expect(await readFile(v2Sentinel, "utf8")).toBe("immutable-v2");
  });

  it("checks exact bytes with zero writes and never replaces an existing destination", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const before = await snapshotFiles(harness.options.outputDirectory);
    const checked = await __testOnlyCheckGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built,
    );
    const after = await snapshotFiles(harness.options.outputDirectory);

    expect(checked.sourceVerificationState).toBe("not_checked_test_only");
    expect(after.map((row) => [row.name, row.modified, fixtureDigest(row.bytes)]))
      .toEqual(before.map((row) => [row.name, row.modified, fixtureDigest(row.bytes)]));
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built,
    )).rejects.toBeDefined();
    expect(await snapshotFiles(harness.options.outputDirectory)).toEqual(after);
  });

  it("refuses an existing v2 destination without changing it", async () => {
    const harness = await fixture();
    const v2Directory = join(harness.root, "immutable-v2");
    const sentinel = join(v2Directory, "review-pack-v2.json");
    await mkdir(v2Directory);
    await writeFile(sentinel, "v2", { flag: "wx" });
    const options = { ...harness.options, outputDirectory: v2Directory };

    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(options, harness.built))
      .rejects.toBeDefined();
    await expect(readFile(sentinel, "utf8")).resolves.toBe("v2");
  });

  it("preflights fixed payload names before reserving or writing anything", async () => {
    const harness = await fixture();
    const escaped = join(harness.root, "escaped.json");
    const forged = { ...harness.built, payloads: new Map([
      ...harness.built.payloads, ["../escaped.json", Buffer.from("foreign")],
    ]) };
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, forged,
    )).rejects.toThrow("zero-write preflight");
    await expect(stat(harness.options.outputDirectory)).rejects.toBeDefined();
    await expect(stat(escaped)).rejects.toBeDefined();
  });

  it("writes only its trusted preflight snapshot if the caller map mutates", async () => {
    const harness = await fixture();
    const escaped = join(harness.root, "escaped-after-reservation.json");
    const payloads = new Map(harness.built.payloads);
    const mutableBuilt = { ...harness.built, payloads };
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, mutableBuilt, { afterReservation: () => {
        payloads.clear();
        payloads.set("../escaped-after-reservation.json", Buffer.from("foreign"));
      } },
    )).resolves.toMatchObject({ sourceVerificationState: "not_checked_test_only" });
    await expect(stat(escaped)).rejects.toBeDefined();
    expect((await readdir(harness.options.outputDirectory)).sort()).toEqual(
      outputNames().slice().sort(),
    );
  });

  it("leaves only an empty quarantined file when ownership changes after wx open", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-v3-descriptor-race-"));
    roots.push(root);
    const owned = join(root, "owned-reserved");
    const replacement = join(root, "replacement-reserved");
    const reserved = join(root, "reserved");
    await Promise.all([mkdir(owned), mkdir(replacement)]);
    await symlink(owned, reserved, process.platform === "win32" ? "junction" : "dir");
    let validationCount = 0;
    await expect(writeGrandHallT554V3ExclusiveSyncedFile(
      join(reserved, "payload.json"), Buffer.from("must-not-be-written"), async () => {
        validationCount += 1;
        if (validationCount !== 1) return;
        await rm(reserved, { recursive: true, force: true });
        await symlink(replacement, reserved, process.platform === "win32" ? "junction" : "dir");
      },
    )).rejects.toBeDefined();
    expect((await stat(join(owned, "payload.json"), { bigint: true })).size).toBe(0n);
    expect(await readdir(replacement)).toEqual([]);
  });
});

describe("T-554 v3 adversarial persisted-output inspection", () => {
  it("rejects missing, extra, and changed files", async () => {
    for (const attack of ["missing", "extra", "changed"] as const) {
      const harness = await fixture();
      await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
      const reviewPath = join(harness.options.outputDirectory, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME);
      if (attack === "missing") await unlink(reviewPath);
      if (attack === "extra") {
        await writeFile(join(harness.options.outputDirectory, "extra.json"), "{}\n", { flag: "wx" });
      }
      if (attack === "changed") await writeFile(reviewPath, "{}\n", { flag: "w" });
      await expect(__testOnlyCheckGrandHallT554ReviewPackV3Structure(
        harness.options, harness.built,
      )).rejects.toBeDefined();
    }
  });

  it("rejects a missing or self-digest-tampered publication receipt", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const receiptPath = join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    await unlink(receiptPath);
    await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
      harness.options.outputDirectory, {},
    )).rejects.toBeDefined();
    const tampered = { ...harness.built.receipt,
      receiptSha256: fixtureDigest("tampered-test-receipt") };
    await writeFile(receiptPath, serializeGrandHallT554V3Json(tampered), { flag: "wx" });
    await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
      harness.options.outputDirectory, {},
    )).rejects.toThrow("test-only V3 receipt is invalid");
  });

  it("rejects a hard-linked output payload", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    await link(
      join(harness.options.outputDirectory, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME),
      join(harness.root, "review-hardlink.json"),
    );
    await expect(__testOnlyCheckGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built,
    )).rejects.toBeDefined();
  });

  it("rejects a symlink or junction used as the output leaf", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const realOutput = join(harness.root, "real-v3-output");
    await rename(harness.options.outputDirectory, realOutput);
    await symlink(realOutput, harness.options.outputDirectory,
      process.platform === "win32" ? "junction" : "dir");

    await expect(__testOnlyCheckGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built,
    )).rejects.toBeDefined();
  });

  it("rejects inventory mutation and swap-read-restore races", async () => {
    const inventoryHarness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(
      inventoryHarness.options, inventoryHarness.built,
    );
    await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
      inventoryHarness.options.outputDirectory, {
        afterInitialSnapshot: () => writeFile(
          join(inventoryHarness.options.outputDirectory, "raced.json"), "{}\n", { flag: "wx" },
        ),
      },
    )).rejects.toBeDefined();

    const readHarness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(readHarness.options, readHarness.built);
    const reviewPath = join(readHarness.options.outputDirectory, GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME);
    const backupPath = join(readHarness.root, "original-review.json");
    const bytes = await readFile(reviewPath);
    await expect(__testOnlyInspectGrandHallT554ReviewPackV3Structure(
      readHarness.options.outputDirectory, {
        afterInitialSnapshot: async () => {
          await rename(reviewPath, backupPath);
          await writeFile(reviewPath, bytes, { flag: "wx" });
        },
        afterFileReads: async () => {
          await unlink(reviewPath);
          await rename(backupPath, reviewPath);
        },
      },
    )).rejects.toBeDefined();
  });

  it("rejects a valid same-byte directory replacement between check phases", async () => {
    const harness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(harness.options, harness.built);
    const original = join(harness.root, "original-output");
    await expect(__testOnlyCheckGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built, {
        afterInitialInspection: async () => {
          await rename(harness.options.outputDirectory, original);
          await mkdir(harness.options.outputDirectory);
          await Promise.all(outputNames().map((name) => copyFile(
            join(original, name), join(harness.options.outputDirectory, name),
          )));
        },
      },
    )).rejects.toThrow("changed between structural check phases");
  });
});

describe("T-554 v3 destination and path races", () => {
  it("preserves a destination raced in before reservation", async () => {
    const harness = await fixture();
    const sentinel = join(harness.options.outputDirectory, "foreign.txt");
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built, { beforeReservation: async () => {
        await mkdir(harness.options.outputDirectory);
        await writeFile(sentinel, "foreign", { flag: "wx" });
      } },
    )).rejects.toBeDefined();
    await expect(readFile(sentinel, "utf8")).resolves.toBe("foreign");
  });

  it("quarantines foreign payload and receipt winners without deleting them", async () => {
    const payloadHarness = await fixture();
    const payloadPath = join(payloadHarness.options.outputDirectory,
      GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME);
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      payloadHarness.options, payloadHarness.built, { afterReservation: () =>
        writeFile(payloadPath, "foreign-payload", { flag: "wx" }) },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(readFile(payloadPath, "utf8")).resolves.toBe("foreign-payload");

    const receiptHarness = await fixture();
    const receiptPath = join(receiptHarness.options.outputDirectory,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME);
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      receiptHarness.options, receiptHarness.built, { beforeReceiptWrite: () =>
        writeFile(receiptPath, "foreign-receipt", { flag: "wx" }) },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(readFile(receiptPath, "utf8")).resolves.toBe("foreign-receipt");
    await expect(readFile(join(receiptHarness.options.outputDirectory,
      GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME))).resolves.toBeDefined();
  });

  it("quarantines a replacement of its reserved directory", async () => {
    const harness = await fixture();
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built, { afterReservation: async () => {
        await rmdir(harness.options.outputDirectory);
        await mkdir(harness.options.outputDirectory);
      } },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    expect((await stat(harness.options.outputDirectory)).isDirectory()).toBe(true);
    expect(await readdir(harness.options.outputDirectory)).toEqual([]);
  });

  it("quarantines a replaced parent even when its reserved output node is retained", async () => {
    const harness = await fixture();
    const originalRoot = `${harness.root}-original-parent`;
    roots.push(originalRoot);
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      harness.options, harness.built, { beforeInspection: async () => {
        await rename(harness.root, originalRoot);
        await mkdir(harness.root);
        await rename(
          join(originalRoot, "v3-output"), harness.options.outputDirectory,
        );
      } },
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(readFile(join(harness.options.outputDirectory,
      GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME))).resolves.toBeDefined();
  });

  it("rejects nested source/output paths and canonical source aliases", async () => {
    const nestedHarness = await fixture();
    const nestedOptions: GrandHallT554ReviewPackV3Options = {
      ...nestedHarness.options,
      outputDirectory: join(nestedHarness.options.panoramaSourceRoot, "v3-output"),
    };
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      nestedOptions, nestedHarness.built,
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });

    const aliasHarness = await fixture();
    await __testOnlyPublishGrandHallT554ReviewPackV3Structure(aliasHarness.options, aliasHarness.built);
    const alias = join(aliasHarness.root, "output-alias");
    await symlink(aliasHarness.options.outputDirectory, alias,
      process.platform === "win32" ? "junction" : "dir");
    const aliasOptions = { ...aliasHarness.options, panoramaSourceRoot: alias };
    await expect(__testOnlyCheckGrandHallT554ReviewPackV3Structure(
      aliasOptions, aliasHarness.built,
    )).rejects.toBeDefined();
  });

  it("treats a filesystem root source as an ancestor of every child output", async () => {
    const harness = await fixture();
    const rootSource = parse(harness.root).root;
    const options = { ...harness.options, panoramaSourceRoot: rootSource };
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      options, harness.built,
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(stat(harness.options.outputDirectory)).rejects.toBeDefined();
  });

  it("preserves a POSIX-literal trailing backslash in containment checks", async () => {
    const harness = await fixture();
    const source = join(harness.root, "literal-backslash\\");
    await mkdir(source);
    const options = { ...harness.options, panoramaSourceRoot: source,
      outputDirectory: join(source, "v3-output") };
    await expect(__testOnlyPublishGrandHallT554ReviewPackV3Structure(
      options, harness.built,
    )).rejects.toMatchObject({ code: "OUTPUT_UNSAFE" });
    await expect(stat(options.outputDirectory)).rejects.toBeDefined();
  });
});

describe("T-554 v3 sealed public surface", () => {
  it("uses the real exact-check loader shape and exposes no trust-fabrication dependency", async () => {
    const harness = await fixture();
    const calls = { t561: 0, cleanup: 0, review: 0 };
    const loaded = await __testOnlyLoadGrandHallT554ReviewPackV3Sources(harness.options, {
      checkT561: () => { calls.t561 += 1; return Promise.resolve(harness.bundle.t561Exact); },
      checkCleanup: () => { calls.cleanup += 1; return Promise.resolve(harness.bundle.cleanupExact); },
      loadReview: () => { calls.review += 1; return Promise.resolve(harness.bundle.review); },
    });
    expect(calls).toEqual({ t561: 1, cleanup: 1, review: 1 });
    expect(loaded.cleanupFiles.evidenceFile.sha256)
      .toBe(harness.bundle.cleanupFiles.evidenceFile.sha256);
    expect(generateGrandHallT554ReviewPackV3).toHaveLength(1);
    expect(checkGrandHallT554ReviewPackV3).toHaveLength(1);
  });

  it("detects a source mutation before a repeated exact-source cycle can claim success", async () => {
    const harness = await fixture();
    const runners = exactFixtureRunners(harness);
    await expect(__testOnlyLoadGrandHallT554ReviewPackV3Sources(harness.options, runners))
      .resolves.toBeDefined();
    await writeFile(harness.options.t561ObservationInputPath, "{}\n", { flag: "w" });
    await expect(__testOnlyLoadGrandHallT554ReviewPackV3Sources(harness.options, runners))
      .rejects.toMatchObject({ code: "SOURCE_INVALID" });
  });

  it("rejects a multiply linked direct source file", async () => {
    const harness = await fixture();
    await link(harness.options.t561ObservationInputPath, join(harness.root, "input-hardlink.json"));
    await expect(__testOnlyLoadGrandHallT554ReviewPackV3Sources(
      harness.options, exactFixtureRunners(harness),
    )).rejects.toMatchObject({ code: "SOURCE_INVALID" });
  });

  it("excludes all construction, parser, filesystem, and test seams from the root", () => {
    const forbidden = ["buildGrandHallT554ReviewPackV3",
      "GrandHallT554ReviewPackV3ReceiptSchema",
      "GrandHallT554ReviewPackV3ReceiptMaterialSchema",
      "GrandHallT554ReviewPackV3TestReceiptSchema",
      "GrandHallT554ReviewPackV3TestReceiptMaterialSchema",
      "parseGrandHallT554ReviewPackV3Receipt",
      "parseGrandHallT554ReviewPackV3TestReceipt",
      "sealGrandHallT554ReviewPackV3Receipt",
      "sealGrandHallT554ReviewPackV3TestReceipt",
      "readGrandHallT554V3StableDirectFile",
      "__testOnlyBuildGrandHallT554ReviewPackV3",
      "__testOnlyPublishGrandHallT554ReviewPackV3Structure",
      "__testOnlyCheckGrandHallT554ReviewPackV3Structure",
      "__testOnlyInspectGrandHallT554ReviewPackV3Structure",
      "__testOnlyLoadGrandHallT554ReviewPackV3Sources"];
    for (const name of forbidden) expect(name in reconstructionFoundryPublic).toBe(false);
    expect("generateGrandHallT554ReviewPackV3" in reconstructionFoundryPublic).toBe(true);
    expect("checkGrandHallT554ReviewPackV3" in reconstructionFoundryPublic).toBe(true);
  });
});
