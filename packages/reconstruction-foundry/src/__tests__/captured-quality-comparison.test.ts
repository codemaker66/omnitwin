import { describe, expect, it } from "vitest";
import {
  FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS,
  FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0,
  FoundryCapturedQualityComparisonReportV0Schema,
  compileFoundryCapturedQualityComparisonReportV0,
  computeFoundryCapturedQualityComparisonReportSha256,
  serializeFoundryCapturedQualityComparisonReportV0,
  verifyFoundryCapturedQualityComparisonReportV0,
  type CompileFoundryCapturedQualityComparisonReportV0Input,
} from "../captured-quality-comparison.js";

function sha256(character: string): string {
  return character.repeat(64);
}

function fixture(): CompileFoundryCapturedQualityComparisonReportV0Input {
  return {
    generatedAt: "2026-07-18T15:30:00.000Z",
    sourceReceiptSha256: null,
    candidateProfiles: [
      {
        profileId: "quality-sog-fine-v1",
        expectedGaussianCount: 2_002_009,
        decodedGaussianCount: 2_002_009,
        assets: [
          { pathLabel: "quality-a.sog", sizeBytes: 10, sha256: sha256("1") },
          { pathLabel: "quality-b.sog", sizeBytes: 11, sha256: sha256("2") },
          { pathLabel: "quality-c.sog", sizeBytes: 12, sha256: sha256("3") },
          { pathLabel: "quality-d.sog", sizeBytes: 13, sha256: sha256("4") },
        ],
      },
      {
        profileId: "mobile-spz-fine-v1",
        expectedGaussianCount: 1_978_258,
        decodedGaussianCount: 1_978_258,
        assets: [
          { pathLabel: "mobile-a.spz", sizeBytes: 20, sha256: sha256("5") },
          { pathLabel: "mobile-b.spz", sizeBytes: 21, sha256: sha256("6") },
          { pathLabel: "mobile-c.spz", sizeBytes: 22, sha256: sha256("7") },
          { pathLabel: "mobile-d.spz", sizeBytes: 23, sha256: sha256("8") },
        ],
      },
    ],
    rendererProfile: {
      id: "reception-webgl-renderer-v1",
      profileSha256: sha256("9"),
    },
    viewport: {
      widthPx: 1_200,
      heightPx: 900,
      deviceScaleFactor: 1,
    },
    views: [
      {
        viewId: "overview",
        kind: "e57_matched",
        camera: {
          model: "perspective",
          position: [-2.408, 1.449, 9.752],
          target: [0, 1.2, 0],
          up: [0, 1, 0],
          verticalFovDegrees: 50,
          nearClip: 0.1,
          farClip: 100,
          viewMatrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            2.408, -1.449, -9.752, 1,
          ],
          projectionMatrix: [
            1.608, 0, 0, 0,
            0, 2.145, 0, 0,
            0, 0, -1.002, -1,
            0, 0, -0.2, 0,
          ],
        },
      },
    ],
    captures: [
      {
        profileId: "quality-sog-fine-v1",
        views: [
          {
            viewId: "overview",
            repeats: [
              {
                repeat: 1,
                screenshot: {
                  mediaType: "image/png",
                  widthPx: 1_200,
                  heightPx: 900,
                  sizeBytes: 120_001,
                  sha256: sha256("a"),
                },
                telemetry: {
                  loadedAssetCount: 4,
                  loadedBytes: 46,
                  decodedGaussianCount: 2_002_009,
                  assetLoadDurationMs: 800,
                  settleDurationMs: 1_000,
                  screenshotDurationMs: 50,
                  totalDurationMs: 1_900,
                  frameSampleCount: 120,
                  frameTimeP50Ms: 16,
                  frameTimeP95Ms: 20,
                  frameTimeP99Ms: 25,
                },
              },
              {
                repeat: 2,
                screenshot: {
                  mediaType: "image/png",
                  widthPx: 1_200,
                  heightPx: 900,
                  sizeBytes: 120_002,
                  sha256: sha256("b"),
                },
                telemetry: {
                  loadedAssetCount: 4,
                  loadedBytes: 46,
                  decodedGaussianCount: 2_002_009,
                  assetLoadDurationMs: 790,
                  settleDurationMs: 1_000,
                  screenshotDurationMs: 48,
                  totalDurationMs: 1_880,
                  frameSampleCount: 120,
                  frameTimeP50Ms: 15.5,
                  frameTimeP95Ms: 19.5,
                  frameTimeP99Ms: 24,
                },
              },
            ],
          },
        ],
      },
      {
        profileId: "mobile-spz-fine-v1",
        views: [
          {
            viewId: "overview",
            repeats: [
              {
                repeat: 1,
                screenshot: {
                  mediaType: "image/png",
                  widthPx: 1_200,
                  heightPx: 900,
                  sizeBytes: 110_001,
                  sha256: sha256("c"),
                },
                telemetry: {
                  loadedAssetCount: 4,
                  loadedBytes: 86,
                  decodedGaussianCount: 1_978_258,
                  assetLoadDurationMs: 700,
                  settleDurationMs: 1_000,
                  screenshotDurationMs: 45,
                  totalDurationMs: 1_800,
                  frameSampleCount: 120,
                  frameTimeP50Ms: 14,
                  frameTimeP95Ms: 18,
                  frameTimeP99Ms: 22,
                },
              },
              {
                repeat: 2,
                screenshot: {
                  mediaType: "image/png",
                  widthPx: 1_200,
                  heightPx: 900,
                  sizeBytes: 110_002,
                  sha256: sha256("d"),
                },
                telemetry: {
                  loadedAssetCount: 4,
                  loadedBytes: 86,
                  decodedGaussianCount: 1_978_258,
                  assetLoadDurationMs: 710,
                  settleDurationMs: 1_000,
                  screenshotDurationMs: 46,
                  totalDurationMs: 1_820,
                  frameSampleCount: 120,
                  frameTimeP50Ms: 14.5,
                  frameTimeP95Ms: 18.5,
                  frameTimeP99Ms: 23,
                },
              },
            ],
          },
        ],
      },
    ],
    pairMetrics: [
      {
        viewId: "overview",
        repeats: [
          {
            repeat: 1,
            qualityScreenshotSha256: sha256("a"),
            mobileScreenshotSha256: sha256("c"),
            metrics: {
              comparedPixelCount: 1_080_000,
              meanAbsoluteError: 0.025,
              rootMeanSquareError: 0.04,
              psnrDb: 27.95,
              ssim: 0.95,
            },
          },
          {
            repeat: 2,
            qualityScreenshotSha256: sha256("b"),
            mobileScreenshotSha256: sha256("d"),
            metrics: {
              comparedPixelCount: 1_080_000,
              meanAbsoluteError: 0.026,
              rootMeanSquareError: 0.041,
              psnrDb: 27.74,
              ssim: 0.948,
            },
          },
        ],
      },
    ],
    sourceIntegrity: {
      preCapture: [
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-a.sog", sizeBytes: 10, sha256: sha256("1") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-b.sog", sizeBytes: 11, sha256: sha256("2") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-c.sog", sizeBytes: 12, sha256: sha256("3") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-d.sog", sizeBytes: 13, sha256: sha256("4") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-a.spz", sizeBytes: 20, sha256: sha256("5") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-b.spz", sizeBytes: 21, sha256: sha256("6") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-c.spz", sizeBytes: 22, sha256: sha256("7") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-d.spz", sizeBytes: 23, sha256: sha256("8") },
      ],
      postCapture: [
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-a.sog", sizeBytes: 10, sha256: sha256("1") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-b.sog", sizeBytes: 11, sha256: sha256("2") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-c.sog", sizeBytes: 12, sha256: sha256("3") },
        { profileId: "quality-sog-fine-v1", pathLabel: "quality-d.sog", sizeBytes: 13, sha256: sha256("4") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-a.spz", sizeBytes: 20, sha256: sha256("5") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-b.spz", sizeBytes: 21, sha256: sha256("6") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-c.spz", sizeBytes: 22, sha256: sha256("7") },
        { profileId: "mobile-spz-fine-v1", pathLabel: "mobile-d.spz", sizeBytes: 23, sha256: sha256("8") },
      ],
      allSourcesUnchanged: true,
    },
    scorer: {
      id: "reception-cv-scorer",
      version: "1.0.0",
      implementationSha256: sha256("e"),
      receiptSha256: sha256("f"),
    },
  };
}

function digestOf(
  input: CompileFoundryCapturedQualityComparisonReportV0Input,
): string {
  return compileFoundryCapturedQualityComparisonReportV0(input).reportSha256;
}

describe("captured-quality comparison report contract", () => {
  it("compiles, serializes, and verifies deterministically with frozen claims", () => {
    const first = compileFoundryCapturedQualityComparisonReportV0(fixture());
    const second = compileFoundryCapturedQualityComparisonReportV0(fixture());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: FOUNDRY_CAPTURED_QUALITY_COMPARISON_REPORT_V0,
      authority: "none",
      resultType: "regression_triage_not_acceptance",
      winner: "not_selected",
      limitations: [...FOUNDRY_CAPTURED_QUALITY_COMPARISON_LIMITATIONS],
      externalRequests: 0,
    });
    expect(serializeFoundryCapturedQualityComparisonReportV0(first)).toBe(
      serializeFoundryCapturedQualityComparisonReportV0(second),
    );
    expect(verifyFoundryCapturedQualityComparisonReportV0(first)).toEqual(first);

    const { reportSha256, ...payload } = first;
    expect(reportSha256).toBe(
      computeFoundryCapturedQualityComparisonReportSha256(payload),
    );
  });

  it("changes the report digest when any bound evidence identity changes", () => {
    const baseline = digestOf(fixture());

    const changedAsset = fixture();
    changedAsset.candidateProfiles[0].assets[0].sha256 = sha256("0");
    changedAsset.sourceIntegrity.preCapture[0]!.sha256 = sha256("0");
    changedAsset.sourceIntegrity.postCapture[0]!.sha256 = sha256("0");

    const changedCamera = fixture();
    changedCamera.views[0]!.camera.viewMatrix[0] = 0.999;

    const changedScreenshot = fixture();
    changedScreenshot.captures[0].views[0]!.repeats[0].screenshot.sha256 =
      sha256("0");
    changedScreenshot.pairMetrics[0]!.repeats[0].qualityScreenshotSha256 =
      sha256("0");

    const changedRenderer = fixture();
    changedRenderer.rendererProfile.profileSha256 = sha256("0");

    const changedScorer = fixture();
    changedScorer.scorer.receiptSha256 = sha256("0");

    for (const changed of [
      changedAsset,
      changedCamera,
      changedScreenshot,
      changedRenderer,
      changedScorer,
    ]) {
      expect(digestOf(changed)).not.toBe(baseline);
    }
  });

  it("accepts an explicit source receipt digest and binds it", () => {
    const absent = fixture();
    const explicit = fixture();
    explicit.sourceReceiptSha256 = sha256("0");

    expect(digestOf(explicit)).not.toBe(digestOf(absent));
  });

  it("rejects unknown keys, malformed tuples, non-finite numbers, and winner selection", () => {
    const report = compileFoundryCapturedQualityComparisonReportV0(fixture());

    expect(() =>
      verifyFoundryCapturedQualityComparisonReportV0({
        ...report,
        unknownKey: true,
      }),
    ).toThrow();

    expect(() =>
      verifyFoundryCapturedQualityComparisonReportV0({
        ...report,
        candidateProfiles: [report.candidateProfiles[0]],
      }),
    ).toThrow();

    const nonFinite = fixture();
    nonFinite.views[0]!.camera.projectionMatrix[0] = Number.POSITIVE_INFINITY;
    expect(() =>
      compileFoundryCapturedQualityComparisonReportV0(nonFinite),
    ).toThrow();

    expect(() =>
      FoundryCapturedQualityComparisonReportV0Schema.parse({
        ...report,
        winner: "quality-sog-fine-v1",
      }),
    ).toThrow();

    expect(() =>
      compileFoundryCapturedQualityComparisonReportV0(
        Object.assign(fixture(), { winner: "quality-sog-fine-v1" }),
      ),
    ).toThrow();
  });

  it("rejects a stale self-digest and cross-reference mismatches", () => {
    const report = compileFoundryCapturedQualityComparisonReportV0(fixture());
    expect(() =>
      verifyFoundryCapturedQualityComparisonReportV0({
        ...report,
        reportSha256: sha256("0"),
      }),
    ).toThrow();

    const mismatchedPair = fixture();
    mismatchedPair.pairMetrics[0]!.repeats[0].qualityScreenshotSha256 =
      sha256("0");
    expect(() =>
      compileFoundryCapturedQualityComparisonReportV0(mismatchedPair),
    ).toThrow();

    const changedAfterCapture = fixture();
    changedAfterCapture.sourceIntegrity.postCapture[0]!.sha256 = sha256("0");
    expect(() =>
      compileFoundryCapturedQualityComparisonReportV0(changedAfterCapture),
    ).toThrow();
  });
});
