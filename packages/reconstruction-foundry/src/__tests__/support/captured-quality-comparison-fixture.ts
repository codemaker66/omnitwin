import {
  compileFoundryCapturedQualityComparisonReportV0,
  type CompileFoundryCapturedQualityComparisonReportV0Input,
  type FoundryCapturedQualityComparisonReportV0,
} from "../../captured-quality-comparison.js";

function sha256(character: string): string {
  return character.repeat(64);
}

function telemetry(
  decodedGaussianCount: number,
  loadedBytes: number,
  offset: number,
): CompileFoundryCapturedQualityComparisonReportV0Input["captures"][number]["views"][number]["repeats"][number]["telemetry"] {
  return {
    loadedAssetCount: 4,
    loadedBytes,
    decodedGaussianCount,
    assetLoadDurationMs: 700 + offset,
    settleDurationMs: 1_000,
    screenshotDurationMs: 45 + offset,
    totalDurationMs: 1_800 + offset,
    frameSampleCount: 120,
    frameTimeP50Ms: 14 + offset,
    frameTimeP95Ms: 18 + offset,
    frameTimeP99Ms: 22 + offset,
  };
}

export function capturedQualityComparisonFixture(
  sourceReceiptSha256: string | null = null,
): FoundryCapturedQualityComparisonReportV0 {
  const qualityAssets: CompileFoundryCapturedQualityComparisonReportV0Input[
    "candidateProfiles"
  ][0]["assets"] = [
    { pathLabel: "quality-a.sog", sizeBytes: 10, sha256: sha256("1") },
    { pathLabel: "quality-b.sog", sizeBytes: 11, sha256: sha256("2") },
    { pathLabel: "quality-c.sog", sizeBytes: 12, sha256: sha256("3") },
    { pathLabel: "quality-d.sog", sizeBytes: 13, sha256: sha256("4") },
  ];
  const mobileAssets: CompileFoundryCapturedQualityComparisonReportV0Input[
    "candidateProfiles"
  ][1]["assets"] = [
    { pathLabel: "mobile-a.spz", sizeBytes: 20, sha256: sha256("5") },
    { pathLabel: "mobile-b.spz", sizeBytes: 21, sha256: sha256("6") },
    { pathLabel: "mobile-c.spz", sizeBytes: 22, sha256: sha256("7") },
    { pathLabel: "mobile-d.spz", sizeBytes: 23, sha256: sha256("8") },
  ];
  const sourceSnapshot: CompileFoundryCapturedQualityComparisonReportV0Input[
    "sourceIntegrity"
  ]["preCapture"] = [
    ...qualityAssets.map((asset) => ({
      profileId: "quality-sog-fine-v1" as const,
      ...asset,
    })),
    ...mobileAssets.map((asset) => ({
      profileId: "mobile-spz-fine-v1" as const,
      ...asset,
    })),
  ];
  const input: CompileFoundryCapturedQualityComparisonReportV0Input = {
    generatedAt: "2026-07-18T15:30:00.000Z",
    sourceReceiptSha256,
    candidateProfiles: [
      {
        profileId: "quality-sog-fine-v1",
        expectedGaussianCount: 2_002_009,
        decodedGaussianCount: 2_002_009,
        assets: qualityAssets,
      },
      {
        profileId: "mobile-spz-fine-v1",
        expectedGaussianCount: 1_978_258,
        decodedGaussianCount: 1_978_258,
        assets: mobileAssets,
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
    views: [{
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
    }],
    captures: [
      {
        profileId: "quality-sog-fine-v1",
        views: [{
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
              telemetry: telemetry(2_002_009, 46, 0),
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
              telemetry: telemetry(2_002_009, 46, 1),
            },
          ],
        }],
      },
      {
        profileId: "mobile-spz-fine-v1",
        views: [{
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
              telemetry: telemetry(1_978_258, 86, 0),
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
              telemetry: telemetry(1_978_258, 86, 1),
            },
          ],
        }],
      },
    ],
    pairMetrics: [{
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
    }],
    sourceIntegrity: {
      preCapture: sourceSnapshot,
      postCapture: sourceSnapshot,
      allSourcesUnchanged: true,
    },
    scorer: {
      id: "reception-cv-scorer",
      version: "1.0.0",
      implementationSha256: sha256("e"),
      receiptSha256: sha256("f"),
    },
  };
  return compileFoundryCapturedQualityComparisonReportV0(input);
}
