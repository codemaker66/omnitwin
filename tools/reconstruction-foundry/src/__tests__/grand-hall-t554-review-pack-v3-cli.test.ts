import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V3_RECEIPT_SCHEMA,
  GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
} from "../grand-hall-t554-review-pack-v3.js";
import { runGrandHallT554ReviewPackV3Cli } from "../grand-hall-t554-review-pack-v3-cli.js";

describe("T-554 v3 CLI contract", () => {
  it("uses a namespace wholly distinct from the v2 publication", () => {
    expect([
      GRAND_HALL_T554_V3_REVIEW_PACK_FILENAME,
      GRAND_HALL_T554_V3_HUMAN_DECISIONS_FILENAME,
      GRAND_HALL_T554_V3_CLOSED_VOLUME_TEMPLATE_FILENAME,
      GRAND_HALL_T554_V3_PUBLICATION_RECEIPT_FILENAME,
    ]).toEqual([
      "review-pack-v3.json",
      "human-decisions-v3.json",
      "closed-selection-volume-review-template-v3.json",
      "publication-receipt-v3.json",
    ]);
    expect(GRAND_HALL_T554_V3_RECEIPT_SCHEMA).toMatch(/\.v3$/u);
  });

  it("fails closed before I/O when required real-source arguments are absent", async () => {
    await expect(runGrandHallT554ReviewPackV3Cli([])).rejects.toThrow("Missing --t554-v1-root");
    await expect(runGrandHallT554ReviewPackV3Cli(["--check"])).rejects.toThrow("Missing --t554-v1-root");
    await expect(runGrandHallT554ReviewPackV3Cli(["--unknown"])).rejects.toThrow("Invalid argument");
  });
});
