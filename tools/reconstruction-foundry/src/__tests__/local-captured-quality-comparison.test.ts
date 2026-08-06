import { join, resolve } from "node:path";
import {
  compileFoundryCapturedQualityComparisonReportV0,
  type FoundryCapturedQualityComparisonReportV0,
} from "@omnitwin/reconstruction-foundry";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalCapturedQualityComparisonController,
  type LocalCapturedQualityComparisonProgressReporter,
  type LocalCapturedQualityComparisonRunner,
} from "../local-captured-quality-comparison.js";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const OTHER_REQUEST_ID = "11111111111111111111111111111111";

function hex(value: number): string {
  return value.toString(16).padStart(64, "0");
}

const QUALITY_ASSETS = [
  {
    pathLabel: "0_15_0_0.sog",
    sizeBytes: 10_279_160,
    sha256:
      "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
  },
  {
    pathLabel: "0_1_0_5.sog",
    sizeBytes: 10_047_085,
    sha256:
      "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
  },
  {
    pathLabel: "0_6_0_0.sog",
    sizeBytes: 10_368_228,
    sha256:
      "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
  },
  {
    pathLabel: "0_7_0_0.sog",
    sizeBytes: 5_040_628,
    sha256:
      "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
  },
] as const;

const MOBILE_ASSETS = [
  {
    pathLabel: "0_13_0_0.spz",
    sizeBytes: 8_620_036,
    sha256:
      "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
  },
  {
    pathLabel: "0_3_0_0.spz",
    sizeBytes: 9_199_830,
    sha256:
      "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3",
  },
  {
    pathLabel: "0_7_0_1.spz",
    sizeBytes: 8_768_751,
    sha256:
      "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df",
  },
  {
    pathLabel: "0_8_0_0.spz",
    sizeBytes: 3_422_064,
    sha256:
      "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed",
  },
] as const;

const REVIEW_VIEWS = [
  {
    viewId: "overview",
    position: [-2.408, 1.449, 9.752],
    target: [-2.652, -5.022, -11.676],
    verticalFovDegrees: 48,
  },
  {
    viewId: "timber-left",
    position: [-2.408, 1.449, 9.752],
    target: [-6.5, -3.5, -11.5],
    verticalFovDegrees: 25,
  },
  {
    viewId: "timber-right",
    position: [-2.408, 1.449, 9.752],
    target: [0, -3.5, -11.5],
    verticalFovDegrees: 25,
  },
  {
    viewId: "floor-surface",
    position: [-2.408, 1.449, 9.752],
    target: [-3, -5, -4],
    verticalFovDegrees: 28,
  },
  {
    viewId: "ceiling-moulding",
    position: [-2.408, 1.449, 9.752],
    target: [-3, 0, -11.5],
    verticalFovDegrees: 24,
  },
  {
    viewId: "column-skirting",
    position: [-2.408, 1.449, 9.752],
    target: [1, -3, -10],
    verticalFovDegrees: 24,
  },
] as const;

type ReviewViewId = typeof REVIEW_VIEWS[number]["viewId"];

function reportFixture(options: {
  readonly viewIds?: readonly ReviewViewId[];
  readonly qualityGaussianCount?: number;
} = {}): FoundryCapturedQualityComparisonReportV0 {
  const viewIds = options.viewIds ?? REVIEW_VIEWS.map((view) => view.viewId);
  const qualityGaussianCount = options.qualityGaussianCount ?? 2_002_009;
  const mobileGaussianCount = 1_978_258;
  const telemetry = (
    loadedBytes: number,
    decodedGaussianCount: number,
  ) => ({
    loadedAssetCount: 4 as const,
    loadedBytes,
    decodedGaussianCount,
    assetLoadDurationMs: 10,
    settleDurationMs: 20,
    screenshotDurationMs: 5,
    totalDurationMs: 35,
    frameSampleCount: 3,
    frameTimeP50Ms: 10,
    frameTimeP95Ms: 12,
    frameTimeP99Ms: 14,
  });
  const screenshots = (
    profileIndex: number,
    viewIndex: number,
    loadedBytes: number,
    decodedGaussianCount: number,
  ) => [
    {
      repeat: 1 as const,
      screenshot: {
        mediaType: "image/png" as const,
        widthPx: 1_200,
        heightPx: 900,
        sizeBytes: 20,
        sha256: hex(100 + profileIndex * 100 + viewIndex * 2),
      },
      telemetry: telemetry(loadedBytes, decodedGaussianCount),
    },
    {
      repeat: 2 as const,
      screenshot: {
        mediaType: "image/png" as const,
        widthPx: 1_200,
        heightPx: 900,
        sizeBytes: 21,
        sha256: hex(101 + profileIndex * 100 + viewIndex * 2),
      },
      telemetry: telemetry(loadedBytes, decodedGaussianCount),
    },
  ] as const;
  const identityMatrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as const;
  const sourceSnapshot = [
    ...QUALITY_ASSETS.map((asset) => ({
      profileId: "quality-sog-fine-v1" as const,
      ...asset,
    })),
    ...MOBILE_ASSETS.map((asset) => ({
      profileId: "mobile-spz-fine-v1" as const,
      ...asset,
    })),
  ];
  const qualityLoadedBytes = QUALITY_ASSETS.reduce(
    (total, asset) => total + asset.sizeBytes,
    0,
  );
  const mobileLoadedBytes = MOBILE_ASSETS.reduce(
    (total, asset) => total + asset.sizeBytes,
    0,
  );
  const reviewView = (viewId: ReviewViewId) => {
    const view = REVIEW_VIEWS.find((candidate) => candidate.viewId === viewId);
    if (view === undefined) throw new Error(`unknown test view ${viewId}`);
    return view;
  };

  return compileFoundryCapturedQualityComparisonReportV0({
    generatedAt: "2026-07-18T12:00:00.000Z",
    sourceReceiptSha256: null,
    candidateProfiles: [
      {
        profileId: "quality-sog-fine-v1",
        expectedGaussianCount: qualityGaussianCount,
        decodedGaussianCount: qualityGaussianCount,
        assets: [...QUALITY_ASSETS],
      },
      {
        profileId: "mobile-spz-fine-v1",
        expectedGaussianCount: mobileGaussianCount,
        decodedGaussianCount: mobileGaussianCount,
        assets: [...MOBILE_ASSETS],
      },
    ],
    rendererProfile: {
      id: "reception-viewer-profile-source-v1",
      profileSha256: hex(9),
    },
    viewport: { widthPx: 1_200, heightPx: 900, deviceScaleFactor: 1 },
    views: viewIds.map((viewId) => {
      const view = reviewView(viewId);
      return {
        viewId,
        kind: "other_reviewed" as const,
        camera: {
          model: "perspective" as const,
          position: [...view.position] as [number, number, number],
          target: [...view.target] as [number, number, number],
          up: [0, 1, 0] as [number, number, number],
          verticalFovDegrees: view.verticalFovDegrees,
          nearClip: 0.1,
          farClip: 120,
          viewMatrix: [...identityMatrix],
          projectionMatrix: [...identityMatrix],
        },
      };
    }),
    captures: [
      {
        profileId: "quality-sog-fine-v1",
        views: viewIds.map((viewId, viewIndex) => ({
          viewId,
          repeats: [...screenshots(
            0,
            viewIndex,
            qualityLoadedBytes,
            qualityGaussianCount,
          )],
        })),
      },
      {
        profileId: "mobile-spz-fine-v1",
        views: viewIds.map((viewId, viewIndex) => ({
          viewId,
          repeats: [...screenshots(
            1,
            viewIndex,
            mobileLoadedBytes,
            mobileGaussianCount,
          )],
        })),
      },
    ],
    pairMetrics: viewIds.map((viewId, viewIndex) => {
      const qualityScreenshots = screenshots(
        0,
        viewIndex,
        qualityLoadedBytes,
        qualityGaussianCount,
      );
      const mobileScreenshots = screenshots(
        1,
        viewIndex,
        mobileLoadedBytes,
        mobileGaussianCount,
      );
      return {
        viewId,
        repeats: [
          {
            repeat: 1 as const,
            qualityScreenshotSha256:
              qualityScreenshots[0].screenshot.sha256,
            mobileScreenshotSha256: mobileScreenshots[0].screenshot.sha256,
            metrics: {
              comparedPixelCount: 1_080_000,
              meanAbsoluteError: 0.1,
              rootMeanSquareError: 0.2,
              psnrDb: 30,
              ssim: 0.9,
            },
          },
          {
            repeat: 2 as const,
            qualityScreenshotSha256:
              qualityScreenshots[1].screenshot.sha256,
            mobileScreenshotSha256: mobileScreenshots[1].screenshot.sha256,
            metrics: {
              comparedPixelCount: 1_080_000,
              meanAbsoluteError: 0.11,
              rootMeanSquareError: 0.21,
              psnrDb: 29,
              ssim: 0.89,
            },
          },
        ],
      };
    }),
    sourceIntegrity: {
      preCapture: sourceSnapshot,
      postCapture: sourceSnapshot,
      allSourcesUnchanged: true,
    },
    scorer: {
      id: "reception-fixed-view-pixel-metrics-v1",
      version: "1.0.0",
      implementationSha256: hex(10),
      receiptSha256: hex(11),
    },
  });
}

function trustedContext() {
  const root = resolve(process.cwd());
  return {
    repoRoot: root,
    qualityRoot: join(root, "quality"),
    mobileRoot: join(root, "mobile"),
    outputRoot: join(root, "output"),
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function abortAwareRunner(): LocalCapturedQualityComparisonRunner {
  return (_context, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("captured-quality runner aborted"),
        );
      }, {
        once: true,
      });
    });
}

describe("LocalCapturedQualityComparisonController", () => {
  it("runs one exact local comparison and retains only a verified complete report", async () => {
    const report = reportFixture();
    let observedProgress: LocalCapturedQualityComparisonProgressReporter | null =
      null;
    const runner = vi.fn<LocalCapturedQualityComparisonRunner>(
      (context, _signal, reportProgress) => {
        expect(context).toEqual({ ...trustedContext(), requestId: REQUEST_ID });
        observedProgress = reportProgress;
        reportProgress({ phase: "capturing", completed: 12, total: 24 });
        return Promise.resolve(report);
      },
    );
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner,
    });

    expect(controller.availability()).toMatchObject({
      state: "ready",
      authority: "none",
      winner: "not_selected",
      report: null,
    });
    const completed = await controller.start({ requestId: REQUEST_ID });

    expect(observedProgress).not.toBeNull();
    expect(runner).toHaveBeenCalledOnce();
    expect(completed).toMatchObject({
      state: "completed",
      requestId: REQUEST_ID,
      authority: "none",
      winner: "not_selected",
      failureCode: null,
      progress: { phase: "completed", completed: 24, total: 24 },
      report: {
        reportSha256: report.reportSha256,
        viewCount: 6,
        captureCount: 24,
        pairMetricCount: 6,
      },
    });
    const retained = controller.readCompletedReport(REQUEST_ID);
    expect(retained).toEqual(report);
    expect(retained).not.toBe(report);
  });

  it.each([
    {
      name: "five views and twenty captures",
      report: () => reportFixture({
        viewIds: REVIEW_VIEWS.slice(0, 5).map((view) => view.viewId),
      }),
    },
    {
      name: "the six views in reverse order",
      report: () => reportFixture({
        viewIds: [...REVIEW_VIEWS.map((view) => view.viewId)].reverse(),
      }),
    },
    {
      name: "a drifted Quality profile count",
      report: () => reportFixture({ qualityGaussianCount: 2_002_008 }),
    },
  ])("rejects a shared-schema report with $name", async ({ report }) => {
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => Promise.resolve(report()),
    });

    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({
        state: "failed",
        failureCode: "LOCAL_CAPTURED_QUALITY_REPORT_SCOPE_MISMATCH",
        report: null,
      });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("rejects a report with swapped profile order before retention", async () => {
    const swapped = structuredClone(reportFixture());
    swapped.candidateProfiles.reverse();
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => Promise.resolve(swapped),
    });

    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({ state: "failed", report: null });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("rejects a profile/view with fewer than two repeats before retention", async () => {
    const incomplete = structuredClone(reportFixture());
    const firstView = incomplete.captures[0].views[0];
    if (firstView === undefined) throw new Error("missing first test view");
    firstView.repeats.pop();
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => Promise.resolve(incomplete),
    });

    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({ state: "failed", report: null });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("is idempotent for the exact request and never launches twice", async () => {
    const result = deferred<FoundryCapturedQualityComparisonReportV0>();
    const runner = vi.fn<LocalCapturedQualityComparisonRunner>(() => result.promise);
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner,
    });

    const first = controller.start({ requestId: REQUEST_ID });
    const second = controller.start({ requestId: REQUEST_ID });
    expect(first).toBe(second);
    expect(runner).toHaveBeenCalledOnce();

    result.resolve(reportFixture());
    await expect(first).resolves.toMatchObject({ state: "completed" });
    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({ state: "completed" });
    expect(runner).toHaveBeenCalledOnce();
  });

  it("rejects busy and stale request IDs without disturbing the bound run", async () => {
    const result = deferred<FoundryCapturedQualityComparisonReportV0>();
    const runner = vi.fn<LocalCapturedQualityComparisonRunner>(() => result.promise);
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner,
    });
    const original = controller.start({ requestId: REQUEST_ID });

    await expect(controller.start({ requestId: OTHER_REQUEST_ID })).resolves
      .toMatchObject({
        state: "failed",
        failureCode: "LOCAL_CAPTURED_QUALITY_BUSY",
      });
    expect(controller.status(OTHER_REQUEST_ID)).toBeNull();
    expect(controller.snapshot(OTHER_REQUEST_ID)).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_STALE_REQUEST",
    });
    expect(controller.status(REQUEST_ID)?.state).toBe("running");

    result.resolve(reportFixture());
    await original;
    await expect(controller.start({ requestId: OTHER_REQUEST_ID })).resolves
      .toMatchObject({
        state: "failed",
        failureCode: "LOCAL_CAPTURED_QUALITY_STALE_REQUEST",
      });
    expect(controller.readCompletedReport(REQUEST_ID)).not.toBeNull();
  });

  it("fails closed when the runner fails and retains no partial report", async () => {
    const runnerError = Object.assign(new Error("synthetic failure"), {
      code: "CAPTURE_SOURCE_HASH_MISMATCH",
    });
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => Promise.reject(runnerError),
    });

    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({
        state: "failed",
        failureCode: "CAPTURE_SOURCE_HASH_MISMATCH",
        report: null,
      });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("cancels an active runner, awaits settlement, and retains no report", async () => {
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: abortAwareRunner(),
    });
    const running = controller.start({ requestId: REQUEST_ID });

    await expect(controller.cancel(REQUEST_ID)).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CANCELLED",
      report: null,
    });
    await expect(running).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CANCELLED",
    });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("discards a completed return value when cancellation wins the finish race", async () => {
    const gate = deferred<FoundryCapturedQualityComparisonReportV0>();
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => gate.promise,
    });
    const running = controller.start({ requestId: REQUEST_ID });
    const cancelling = controller.cancel(REQUEST_ID);
    gate.resolve(reportFixture());

    await expect(cancelling).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CANCELLED",
    });
    await expect(running).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CANCELLED",
    });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("enforces the process-owned fixed deadline", async () => {
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: abortAwareRunner(),
      deadlineMs: 10,
    });

    await expect(controller.start({ requestId: REQUEST_ID })).resolves
      .toMatchObject({
        state: "failed",
        failureCode: "LOCAL_CAPTURED_QUALITY_DEADLINE_EXCEEDED",
        report: null,
      });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
  });

  it("stops an active runner and rejects shutdown until settlement is confirmed", async () => {
    const gate = deferred<FoundryCapturedQualityComparisonReportV0>();
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => gate.promise,
      settlementConfirmationMs: 10,
    });
    const running = controller.start({ requestId: REQUEST_ID });

    await expect(controller.stop()).rejects.toMatchObject({
      code: "LOCAL_CAPTURED_QUALITY_RUNNER_SETTLEMENT_UNCONFIRMED",
    });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();

    gate.resolve(reportFixture());
    await expect(running).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
    });
    await expect(controller.stop()).resolves.toBeUndefined();
    expect(controller.availability()).toMatchObject({ state: "unavailable" });
  });

  it("waits for an abort-aware active runner before confirming stop", async () => {
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: abortAwareRunner(),
    });
    const running = controller.start({ requestId: REQUEST_ID });

    await expect(controller.stop()).resolves.toBeUndefined();
    await expect(running).resolves.toMatchObject({
      state: "failed",
      failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
    });
    expect(controller.readCompletedReport(REQUEST_ID)).toBeNull();
    expect(controller.availability()).toMatchObject({
      state: "unavailable",
      failureCode: "LOCAL_CAPTURED_QUALITY_CONTROLLER_STOPPED",
    });
  });

  it("accepts no browser-supplied paths or extra start fields", () => {
    const controller = createLocalCapturedQualityComparisonController({
      trustedContext: trustedContext(),
      runner: () => Promise.resolve(reportFixture()),
    });

    expect(() => controller.start({
      requestId: REQUEST_ID,
      repoRoot: "C:\\browser-controlled",
    } as never)).toThrow("must contain only one opaque request ID");
    expect(() => controller.start({ requestId: "ABC" })).toThrow(
      "32 lowercase hexadecimal",
    );
  });
});
