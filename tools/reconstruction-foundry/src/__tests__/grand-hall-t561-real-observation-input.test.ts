import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  parseGrandHallT554PanoramaFilename,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "../grand-hall-t554-panorama-review.js";
import { buildGrandHallT561RealObservationInputMaterial } from "../grand-hall-t561-real-observation-input.js";

function relativePathFor(sweepNumber: number): string {
  if (sweepNumber === 99 || sweepNumber === 145) {
    return `sweep_${String(sweepNumber).padStart(3, "0")}pg.jpg`;
  }
  const digits = sweepNumber >= 148
    ? String(sweepNumber).padStart(4, "0")
    : String(sweepNumber).padStart(3, "0");
  return `sweep_${digits}jpg.jpg`;
}

function sourceRecord(sweepNumber: number): GrandHallT554PanoramaInventoryFile {
  const relativePath = relativePathFor(sweepNumber);
  const parsed = parseGrandHallT554PanoramaFilename(relativePath);
  const bytes = Buffer.alloc(1_000 + sweepNumber, sweepNumber % 251);
  return {
    sourceLocator: `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${relativePath}`,
    relativePath,
    sweepNumber,
    digitToken: parsed.digitToken,
    namingAnomalies: parsed.namingAnomalies,
    byteLength: bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mediaType: "image/jpeg",
    widthPx: 8_192,
    heightPx: 4_096,
    jpegFrame: "baseline_dct",
    jfifHeaderPresent: true,
    stableDuringRead: true,
  };
}

function exactInventoryShape(): GrandHallT554PanoramaInventory {
  const files = Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweepNumber) => sweepNumber !== 93)
    .map(sourceRecord);
  return {
    sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
    fileCount: 148,
    totalBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
    files,
    inventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    missingSweepNumbersWithin1To149: [93],
    readMode: "read_only",
    sourceMutationPermitted: false,
    networkAccess: "none",
  };
}

describe("T-561 real panorama observation input", () => {
  it("freezes the complete source-bound 74/74 observation partition without granting authority", () => {
    const material = buildGrandHallT561RealObservationInputMaterial(exactInventoryShape());
    const positive = material.records.filter(
      (record) => record.observationState === "grand_hall_pixels_observed",
    );
    const negative = material.records.filter(
      (record) => record.observationState === "no_grand_hall_pixels_observed",
    );
    const uncertain = material.records.filter(
      (record) => record.observationState === "uncertain_possible_grand_hall_pixels",
    );
    const boundary = material.records.filter((record) => record.boundarySensitive);
    const broad = material.records
      .filter((record) => record.frameContext === "broad_grand_hall_view")
      .map((record) => record.sweepNumber);

    expect(material.records).toHaveLength(148);
    expect(material.absentSources).toEqual([{
      sweepNumber: 93,
      sourceState: "absent_from_exact_supplied_inventory",
      visualObservationState: "not_observable_source_absent",
      authority: "none",
    }]);
    expect(positive).toHaveLength(74);
    expect(negative).toHaveLength(74);
    expect(uncertain).toHaveLength(0);
    expect(boundary).toHaveLength(70);
    expect(broad).toEqual([28, 34, 35, 36]);
    expect(positive.map((record) => record.sweepNumber)).toEqual([
      ...Array.from({ length: 61 }, (_, index) => index + 1),
      ...Array.from({ length: 11 }, (_, index) => index + 65),
      148,
      149,
    ]);

    const bySweep = new Map(material.records.map((record) => [record.sweepNumber, record]));
    expect(bySweep.get(49)?.attentionRegions[0]?.wrapsHorizontalSeam).toBe(true);
    expect(bySweep.get(50)?.attentionRegions[0]?.wrapsHorizontalSeam).toBe(true);
    expect(bySweep.get(51)?.attentionRegions[0]?.wrapsHorizontalSeam).toBe(true);
    expect(bySweep.get(99)?.relativePath).toBe("sweep_099pg.jpg");
    expect(bySweep.get(145)?.relativePath).toBe("sweep_145pg.jpg");
    expect(bySweep.get(148)?.relativePath).toBe("sweep_0148jpg.jpg");
    expect(bySweep.get(149)?.relativePath).toBe("sweep_0149jpg.jpg");

    expect(material.inspection).toEqual({
      method: "agent_visual_review_of_exact_source_file",
      displayedWidthPx: 2_048,
      displayedHeightPx: 1_024,
      displayMayHaveBeenResampled: true,
      nativeResolutionHumanReviewCompleted: false,
      humanAcceptanceRecorded: false,
    });
    for (const record of material.records) {
      expect(record.authority).toBe("none");
      expect(record.humanReviewState).toBe("pending");
      expect(record.roomMembershipAuthority).toBe("none");
      expect(record.cameraPoseAuthority).toBe("none");
      expect(record.maskAuthority).toBe("none");
      expect(record.trainingInputPermitted).toBe(false);
      expect(record.reconstructionInputPermitted).toBe(false);
      expect(record.runtimeInputPermitted).toBe(false);
      expect(record.publicEvidencePermitted).toBe(false);
    }
  });

  it("stops if the exact panorama inventory binding is not present", () => {
    const inventory = exactInventoryShape();
    expect(() => buildGrandHallT561RealObservationInputMaterial({
      ...inventory,
      inventorySha256: `sha256:${"0".repeat(64)}`,
    })).toThrow("exact bound 148-file panorama inventory");
  });
});
