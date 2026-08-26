import { describe, expect, it } from "vitest";

import {
  GrandHallT561PanoramaVisualObservationError,
  type VerifiedGrandHallT561ObservationPack,
} from "../grand-hall-t561-panorama-visual-observation.js";
import {
  formatGrandHallT561PanoramaVisualObservationFailure,
  parseGrandHallT561PanoramaVisualObservationArguments,
  runGrandHallT561PanoramaVisualObservationCli,
  type GrandHallT561PanoramaVisualObservationCliDependencies,
} from "../grand-hall-t561-panorama-visual-observation-cli.js";

const ARGV = [
  "--panorama-root", "F:\\panoramas",
  "--t554-panorama-pack", "C:\\review\\panoramas",
  "--observations", "C:\\review\\observations.json",
  "--output", "D:\\evidence\\t561-v1",
] as const;

function verified(): VerifiedGrandHallT561ObservationPack {
  return {
    outputDirectory: "D:\\evidence\\t561-v1",
    manifestSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receiptSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    sourceRecordCount: 148,
    absentSweepNumbersWithin1To149: [93],
    reviewAidCount: 8,
    outputFileCount: 10,
    authority: "none",
    nativeResolutionHumanReviewCompleted: false,
  };
}

describe("T-561 panorama visual-observation CLI arguments", () => {
  it("requires every exact path once and supports an explicit check mode", () => {
    expect(parseGrandHallT561PanoramaVisualObservationArguments(ARGV)).toEqual({
      panoramaSourceRoot: "F:\\panoramas",
      t554PanoramaPackDirectory: "C:\\review\\panoramas",
      observationInputPath: "C:\\review\\observations.json",
      outputDirectory: "D:\\evidence\\t561-v1",
      check: false,
    });
    expect(parseGrandHallT561PanoramaVisualObservationArguments(["--check", ...ARGV]))
      .toMatchObject({ check: true });
    expect(() => parseGrandHallT561PanoramaVisualObservationArguments([
      "--panorama-root", "F:\\panoramas",
    ])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
    expect(() => parseGrandHallT561PanoramaVisualObservationArguments([
      ...ARGV,
      "--output", "D:\\duplicate",
    ])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
  });
});

describe("T-561 panorama visual-observation CLI execution", () => {
  it("reports generation and exact-regeneration states without changing authority", async () => {
    const calls: string[] = [];
    const dependencies: GrandHallT561PanoramaVisualObservationCliDependencies = {
      generate: (options) => {
        calls.push(`generate:${options.outputDirectory}`);
        return Promise.resolve(verified());
      },
      check: (options) => {
        calls.push(`check:${options.outputDirectory}`);
        return Promise.resolve({ ...verified(), exactRegenerationVerified: true });
      },
    };
    const output: string[] = [];

    await expect(runGrandHallT561PanoramaVisualObservationCli(
      ARGV,
      { write: (text) => output.push(text) },
      dependencies,
    )).resolves.toBe(0);
    await expect(runGrandHallT561PanoramaVisualObservationCli(
      ["--check", ...ARGV],
      { write: (text) => output.push(text) },
      dependencies,
    )).resolves.toBe(0);

    expect(calls).toEqual(["generate:D:\\evidence\\t561-v1", "check:D:\\evidence\\t561-v1"]);
    expect(output[0]).toContain('"state": "generated_authority_none_visual_observation_pack"');
    expect(output[0]).toContain('"nativeResolutionHumanReviewCompleted": false');
    expect(output[1]).toContain('"state": "checked_exact_regeneration"');
    expect(output[1]).toContain('"exactRegenerationVerified": true');
  });

  it("keeps failures explicit and authority-safe", () => {
    const error = new GrandHallT561PanoramaVisualObservationError(
      "SOURCE_MISMATCH",
      "Source bytes changed.",
    );
    expect(formatGrandHallT561PanoramaVisualObservationFailure(error)).toContain(
      "SOURCE_MISMATCH: Source bytes changed.",
    );
  });
});
