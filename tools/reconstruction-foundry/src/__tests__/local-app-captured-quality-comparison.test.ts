import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  compileFoundryCapturedQualityComparisonReportV0,
  serializeFoundryCapturedQualityComparisonReportV0,
  type FoundryCapturedQualityComparisonReportV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LocalCapturedQualityComparisonDto,
  type LocalCapturedQualityComparisonRunner,
} from "../local-captured-quality-comparison.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const STALE_REQUEST_ID = "fedcba9876543210fedcba9876543210";
const STALE_DIGEST = "0".repeat(64);
const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map(async (app) => {
      if (app.getPhase() !== "stopped") await app.stop();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function sha256(value: number): string {
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

function reportFixture(): FoundryCapturedQualityComparisonReportV0 {
  const qualityGaussianCount = 2_002_009;
  const mobileGaussianCount = 1_978_258;
  const identityMatrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ] as const;
  const sourceIntegrity = [
    ...QUALITY_ASSETS.map((asset) => ({
      profileId: "quality-sog-fine-v1" as const,
      ...asset,
    })),
    ...MOBILE_ASSETS.map((asset) => ({
      profileId: "mobile-spz-fine-v1" as const,
      ...asset,
    })),
  ];
  const telemetry = (loadedBytes: number, decodedGaussianCount: number) => ({
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
  const repeats = (
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
        sha256: sha256(100 + profileIndex * 100 + viewIndex * 2),
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
        sha256: sha256(101 + profileIndex * 100 + viewIndex * 2),
      },
      telemetry: telemetry(loadedBytes, decodedGaussianCount),
    },
  ] as const;
  const qualityLoadedBytes = QUALITY_ASSETS.reduce(
    (total, asset) => total + asset.sizeBytes,
    0,
  );
  const mobileLoadedBytes = MOBILE_ASSETS.reduce(
    (total, asset) => total + asset.sizeBytes,
    0,
  );
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
      profileSha256: sha256(9),
    },
    viewport: { widthPx: 1_200, heightPx: 900, deviceScaleFactor: 1 },
    views: REVIEW_VIEWS.map((view) => ({
      viewId: view.viewId,
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
    })),
    captures: [
      {
        profileId: "quality-sog-fine-v1",
        views: REVIEW_VIEWS.map((view, viewIndex) => ({
          viewId: view.viewId,
          repeats: [...repeats(
            0,
            viewIndex,
            qualityLoadedBytes,
            qualityGaussianCount,
          )],
        })),
      },
      {
        profileId: "mobile-spz-fine-v1",
        views: REVIEW_VIEWS.map((view, viewIndex) => ({
          viewId: view.viewId,
          repeats: [...repeats(
            1,
            viewIndex,
            mobileLoadedBytes,
            mobileGaussianCount,
          )],
        })),
      },
    ],
    pairMetrics: REVIEW_VIEWS.map((view, viewIndex) => {
      const qualityRepeats = repeats(
        0,
        viewIndex,
        qualityLoadedBytes,
        qualityGaussianCount,
      );
      const mobileRepeats = repeats(
        1,
        viewIndex,
        mobileLoadedBytes,
        mobileGaussianCount,
      );
      return {
        viewId: view.viewId,
        repeats: [
          {
            repeat: 1 as const,
            qualityScreenshotSha256: qualityRepeats[0].screenshot.sha256,
            mobileScreenshotSha256: mobileRepeats[0].screenshot.sha256,
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
            qualityScreenshotSha256: qualityRepeats[1].screenshot.sha256,
            mobileScreenshotSha256: mobileRepeats[1].screenshot.sha256,
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
      preCapture: sourceIntegrity,
      postCapture: sourceIntegrity,
      allSourcesUnchanged: true,
    },
    scorer: {
      id: "reception-fixed-view-pixel-metrics-v1",
      version: "1.0.0",
      implementationSha256: sha256(10),
      receiptSha256: sha256(11),
    },
  });
}

async function makeSmallFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-captured-quality-http-"));
  temporaryDirectories.push(root);
  await writeFile(
    join(root, "triangle.obj"),
    "# captured-quality route fixture\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
  );
  return root;
}

function trustedContext(root: string) {
  return {
    repoRoot: resolve(process.cwd()),
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

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no session token");
  return token;
}

function sendRequest(
  app: LocalFoundryAppHandle,
  input: {
    readonly method?: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest({
      hostname: app.host,
      port: app.port,
      method: input.method ?? "GET",
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on("error", rejectResult);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

async function readState(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await sendRequest(app, {
    path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForAppReady(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === "ready") return state;
    if (state.phase === "failed") throw new Error("local app source inspection failed");
    await delay(10);
  }
  throw new Error("local app did not reach ready state");
}

async function postCapturedQualityJson(
  app: LocalFoundryAppHandle,
  route: "start" | "status" | "cancel",
  body: unknown,
): Promise<HttpResult> {
  const encoded = JSON.stringify(body);
  return sendRequest(app, {
    method: "POST",
    path: `/api/captured-quality-comparison/${route}?token=${encodeURIComponent(
      tokenFor(app),
    )}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(encoded)),
      Origin: app.origin,
    },
    body: encoded,
  });
}

function parseDto(response: HttpResult): LocalCapturedQualityComparisonDto {
  return JSON.parse(response.body.toString("utf8")) as
    LocalCapturedQualityComparisonDto;
}

async function waitForComparisonState(
  app: LocalFoundryAppHandle,
  state: LocalCapturedQualityComparisonDto["state"],
): Promise<LocalCapturedQualityComparisonDto> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await postCapturedQualityJson(app, "status", {
      requestId: REQUEST_ID,
    });
    expect(response.status).toBe(200);
    const current = parseDto(response);
    if (current.state === state) return current;
    if (current.state === "failed") {
      throw new Error(`captured-quality comparison failed: ${current.message}`);
    }
    await delay(10);
  }
  throw new Error(`captured-quality comparison did not reach ${state}`);
}

function reportPath(
  app: LocalFoundryAppHandle,
  requestId: string,
  digest: string,
): string {
  return `/api/captured-quality-comparison/report?token=${encodeURIComponent(
    tokenFor(app),
  )}&requestId=${encodeURIComponent(requestId)}&digest=${encodeURIComponent(digest)}`;
}

async function postStop(app: LocalFoundryAppHandle): Promise<HttpResult> {
  const body = "{}";
  return sendRequest(app, {
    method: "POST",
    path: `/api/stop?token=${encodeURIComponent(tokenFor(app))}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      Origin: app.origin,
    },
    body,
  });
}

describe("Foundry local app captured-quality comparison HTTP routes", () => {
  it("reports unavailable and refuses to start when no process-owned comparison is configured", async () => {
    const root = await makeSmallFixture();
    const app = await startLocalFoundryApp({ source: root });
    openApps.push(app);

    const ready = await waitForAppReady(app);
    expect(ready.capturedQualityComparison).toMatchObject({
      state: "unavailable",
      requestId: null,
      authority: "none",
      winner: "not_selected",
      report: null,
    });

    const start = await postCapturedQualityJson(app, "start", {
      requestId: REQUEST_ID,
    });
    expect(start.status).toBe(409);
    expect(start.body.toString("utf8")).toContain(
      "No exact captured-quality comparison is ready",
    );
  });

  it("starts asynchronously, serves current status, rejects a stale ID, and cancels the active run", async () => {
    const root = await makeSmallFixture();
    let observedContext: unknown;
    const runner = vi.fn<LocalCapturedQualityComparisonRunner>(
      (context, signal, progress) => {
        observedContext = context;
        progress({ phase: "capturing", completed: 1, total: 24 });
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(signal.reason instanceof Error
              ? signal.reason
              : new Error("captured-quality runner aborted"));
          }, { once: true });
        });
      },
    );
    const app = await startLocalFoundryApp({
      source: root,
      capturedQualityComparison: {
        trustedContext: trustedContext(root),
        runner,
      },
    });
    openApps.push(app);

    const ready = await waitForAppReady(app);
    expect(ready.capturedQualityComparison).toMatchObject({
      state: "ready",
      requestId: null,
      progress: { phase: "ready", completed: 0, total: 0 },
    });

    const start = await postCapturedQualityJson(app, "start", {
      requestId: REQUEST_ID,
    });
    expect(start.status).toBe(202);
    expect(parseDto(start)).toMatchObject({
      state: "running",
      requestId: REQUEST_ID,
      progress: { phase: "capturing", completed: 1, total: 24 },
      report: null,
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(observedContext).toEqual({
      ...trustedContext(root),
      requestId: REQUEST_ID,
    });

    const status = await postCapturedQualityJson(app, "status", {
      requestId: REQUEST_ID,
    });
    expect(status.status).toBe(200);
    expect(parseDto(status).state).toBe("running");

    const staleStatus = await postCapturedQualityJson(app, "status", {
      requestId: STALE_REQUEST_ID,
    });
    expect(staleStatus.status).toBe(409);

    const cancel = await postCapturedQualityJson(app, "cancel", {
      requestId: REQUEST_ID,
    });
    expect(cancel.status).toBe(200);
    expect(parseDto(cancel)).toMatchObject({
      state: "failed",
      requestId: REQUEST_ID,
      failureCode: "LOCAL_CAPTURED_QUALITY_CANCELLED",
      report: null,
    });
  });

  it("binds a completed report to its request and digest and serves exact canonical bytes", async () => {
    const root = await makeSmallFixture();
    const report = reportFixture();
    const result = deferred<FoundryCapturedQualityComparisonReportV0>();
    const runner = vi.fn<LocalCapturedQualityComparisonRunner>(
      (_context, _signal, progress) => {
        progress({ phase: "finalizing", completed: 23, total: 24 });
        return result.promise;
      },
    );
    const app = await startLocalFoundryApp({
      source: root,
      capturedQualityComparison: {
        trustedContext: trustedContext(root),
        runner,
      },
    });
    openApps.push(app);
    await waitForAppReady(app);

    const start = await postCapturedQualityJson(app, "start", {
      requestId: REQUEST_ID,
    });
    expect(start.status).toBe(202);
    expect(parseDto(start).state).toBe("running");
    result.resolve(report);

    const completed = await waitForComparisonState(app, "completed");
    expect(completed).toMatchObject({
      requestId: REQUEST_ID,
      authority: "none",
      winner: "not_selected",
      report: {
        reportSha256: report.reportSha256,
        viewCount: 6,
        captureCount: 24,
        pairMetricCount: 6,
      },
    });

    const staleDigest = await sendRequest(app, {
      path: reportPath(app, REQUEST_ID, STALE_DIGEST),
    });
    expect(staleDigest.status).toBe(409);

    const staleRequest = await sendRequest(app, {
      path: reportPath(app, STALE_REQUEST_ID, report.reportSha256),
    });
    expect(staleRequest.status).toBe(409);

    const download = await sendRequest(app, {
      path: reportPath(app, REQUEST_ID, report.reportSha256),
    });
    const expectedBytes = Buffer.from(
      `${serializeFoundryCapturedQualityComparisonReportV0(report)}\n`,
      "utf8",
    );
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(download.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-captured-quality-comparison-report-v0.json"',
    );
    expect(download.headers["content-length"]).toBe(
      String(expectedBytes.byteLength),
    );
    expect(download.body).toEqual(expectedBytes);
  });

  it("does not confirm local-session stop until the active comparison settles", async () => {
    const root = await makeSmallFixture();
    let runnerObservedAbort = false;
    const runner: LocalCapturedQualityComparisonRunner = (
      _context,
      signal,
    ) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        runnerObservedAbort = true;
        queueMicrotask(() => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error("captured-quality runner stopped"));
        });
      }, { once: true });
    });
    const app = await startLocalFoundryApp({
      source: root,
      capturedQualityComparison: {
        trustedContext: trustedContext(root),
        runner,
      },
    });
    openApps.push(app);
    await waitForAppReady(app);
    const start = await postCapturedQualityJson(app, "start", {
      requestId: REQUEST_ID,
    });
    expect(start.status).toBe(202);

    const stop = await postStop(app);
    expect(stop.status).toBe(202);
    expect(JSON.parse(stop.body.toString("utf8"))).toEqual({
      stopping: true,
      verificationStopped: true,
      offlinePreviewStopped: true,
      capturedQualityComparisonStopped: true,
      preparedHdDatasetStopped: true,
      localIntakeWorkspaceStopped: true,
      photoCaptureQualityStopped: true,
    });
    expect(runnerObservedAbort).toBe(true);
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(app.getPhase()).toBe("stopped");
  });
});
