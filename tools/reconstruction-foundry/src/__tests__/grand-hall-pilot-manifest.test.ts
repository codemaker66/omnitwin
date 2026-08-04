import { describe, expect, it } from "vitest";

import { computeFoundryIngestManifestSha256 } from "@omnitwin/types";

import {
  buildGrandHallPilotManifest,
  parsePilotHashInventory,
} from "../grand-hall-pilot-manifest.js";

const CREATED_AT = "2026-07-19T10:21:36.000Z";

const SYNTHETIC_INVENTORY = [
  `${"a".repeat(64)} 20518437888 cloud_0.e57`,
  `${"b".repeat(64)} 355581952 colmap_v2/database.db`,
  `${"c".repeat(64)} 64 colmap_v2/sparse/0/cameras.bin`,
  `${"d".repeat(64)} 1024 colmap_v2/images/scan_030_front.jpg`,
  `${"e".repeat(64)} 1024 colmap_v2/images/scan_030_back.jpg`,
  `${"f".repeat(64)} 3659287 Grand_Hall_Bright_Walls_2026-05-31-101837/project_data/poses.csv`,
  "HASH_SWEEP_DONE",
].join("\n");

describe("Grand Hall pilot ingest manifest", () => {
  it("parses a hash inventory and ignores non-record lines", () => {
    const records = parsePilotHashInventory(SYNTHETIC_INVENTORY);
    expect(records).toHaveLength(6);
    expect(records[0]?.relativePath).toBe(
      "Grand_Hall_Bright_Walls_2026-05-31-101837/project_data/poses.csv",
    );
  });

  it("rejects duplicate relative paths in the inventory", () => {
    expect(() =>
      parsePilotHashInventory(
        [`${"a".repeat(64)} 10 cloud_0.e57`, `${"b".repeat(64)} 11 cloud_0.e57`].join("\n"),
      ),
    ).toThrow(/duplicate/i);
  });

  it("builds a schema-valid manifest with one producing edge per derived asset", () => {
    const manifest = buildGrandHallPilotManifest(
      parsePilotHashInventory(SYNTHETIC_INVENTORY),
      CREATED_AT,
    );
    expect(manifest.assets).toHaveLength(6);
    const derived = manifest.assets.filter((asset) => asset.captureState === "derived");
    expect(derived).toHaveLength(4);
    for (const asset of derived) {
      const producers = manifest.provenanceEdges.filter(
        (edge) => edge.outputAssetId === asset.id,
      );
      expect(producers).toHaveLength(1);
      expect(asset.parentAssetIds).toEqual(["e57-main"]);
    }
  });

  it("keeps the honest rights postures: Matterport requires review, benchmark is locked down", () => {
    const manifest = buildGrandHallPilotManifest(
      parsePilotHashInventory(SYNTHETIC_INVENTORY),
      CREATED_AT,
    );
    const e57 = manifest.assets.find((asset) => asset.id === "e57-main");
    expect(e57?.rights.modelTrainingUse).toBe("requires_review");
    const benchmark = manifest.assets.find((asset) => asset.inputType === "trajectory");
    expect(benchmark?.rights.modelTrainingUse).toBe("prohibited");
    expect(benchmark?.rights.redistribution).toBe("prohibited");
    expect(manifest.legalReviewState).toBe("requires_review");
    expect(manifest.sourceMutationPermitted).toBe(false);
  });

  it("is deterministic: identical inventory yields an identical manifest digest", () => {
    const first = buildGrandHallPilotManifest(
      parsePilotHashInventory(SYNTHETIC_INVENTORY),
      CREATED_AT,
    );
    const second = buildGrandHallPilotManifest(
      parsePilotHashInventory(SYNTHETIC_INVENTORY),
      CREATED_AT,
    );
    expect(computeFoundryIngestManifestSha256(first)).toBe(
      computeFoundryIngestManifestSha256(second),
    );
  });

  it("refuses inventory paths outside the declared pilot input classes", () => {
    expect(() =>
      buildGrandHallPilotManifest(
        parsePilotHashInventory(`${"a".repeat(64)} 10 colmap_v2/dense/fused.ply`),
        CREATED_AT,
      ),
    ).toThrow(/pilot input/i);
  });
});
