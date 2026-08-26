import { describe, expect, it } from "vitest";

import {
  parseGrandHallT554ReviewPackV2Arguments,
  runGrandHallT554ReviewPackV2Cli,
  type GrandHallT554ReviewPackV2CliDependencies,
} from "../grand-hall-t554-review-pack-v2-cli.js";
import type { VerifiedGrandHallT554ReviewPackV2 } from "../grand-hall-t554-review-pack-v2.js";

const ARGV = [
  "--t554-v1-root", "C:\\review-v1",
  "--t561-observations", "C:\\observations.json",
  "--t561-pack", "C:\\t561",
  "--output", "D:\\review-v2",
] as const;

function verified(): VerifiedGrandHallT554ReviewPackV2 {
  return {
    outputDirectory: "D:\\review-v2",
    reviewPackSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receiptSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    panoramaDecisionCount: 148,
    interfaceDecisionCount: 8,
    cleanupInspectionCount: 2,
    authority: "none",
    reviewState: "human_pending",
    nativeResolutionHumanReviewCompleted: false,
  };
}

describe("T-554 v2 CLI", () => {
  it("requires each path exactly once and recognizes zero-write check mode", () => {
    expect(parseGrandHallT554ReviewPackV2Arguments(ARGV)).toMatchObject({
      predecessorReviewRoot: "C:\\review-v1",
      t561ObservationInputPath: "C:\\observations.json",
      t561ObservationPackDirectory: "C:\\t561",
      outputDirectory: "D:\\review-v2",
      check: false,
    });
    expect(parseGrandHallT554ReviewPackV2Arguments(["--check", ...ARGV])).toMatchObject({ check: true });
    expect(() => parseGrandHallT554ReviewPackV2Arguments([...ARGV, "--output", "D:\\duplicate"]))
      .toThrow();
  });

  it("reports generation and check without implying acceptance", async () => {
    const calls: string[] = [];
    const dependencies: GrandHallT554ReviewPackV2CliDependencies = {
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
    await runGrandHallT554ReviewPackV2Cli(ARGV, { write: (text) => output.push(text) }, dependencies);
    await runGrandHallT554ReviewPackV2Cli(["--check", ...ARGV], { write: (text) => output.push(text) }, dependencies);

    expect(calls).toEqual(["generate:D:\\review-v2", "check:D:\\review-v2"]);
    expect(output[0]).toContain("generated_t554_v2_human_pending");
    expect(output[0]).toContain('"reviewState": "human_pending"');
    expect(output[1]).toContain('"exactRegenerationVerified": true');
  });
});
