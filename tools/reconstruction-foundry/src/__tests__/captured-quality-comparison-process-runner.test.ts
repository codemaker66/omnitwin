import {
  ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import {
  compileFoundryCapturedQualityComparisonReportV0,
  type CompileFoundryCapturedQualityComparisonReportV0Input,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCapturedQualityComparisonProcessRunner,
  type CapturedQualityComparisonProcessContext,
  type CapturedQualityComparisonProcessProgress,
  type CapturedQualityComparisonSpawnProcess,
} from "../captured-quality-comparison-process-runner.js";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const MAX_STDOUT_BYTES = 32 * 1_024 * 1_024;
const temporaryDirectories: string[] = [];

interface ObservedSpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

class FakeChildProcess extends ChildProcess {
  override readonly stdout = new PassThrough();
  override readonly stderr = new PassThrough();
  readonly killSignals: (NodeJS.Signals | number | undefined)[] = [];
  autoCloseOnKill = true;
  #closed = false;

  override kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    if (this.autoCloseOnKill) {
      queueMicrotask(() => {
        this.close(null, typeof signal === "string" ? signal : "SIGTERM");
      });
    }
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.#closed) return;
    this.#closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function fakeSpawn(
  scenario: (child: FakeChildProcess) => void,
): {
  readonly spawnProcess: CapturedQualityComparisonSpawnProcess;
  readonly calls: ObservedSpawnCall[];
  readonly spawned: Promise<FakeChildProcess>;
} {
  const calls: ObservedSpawnCall[] = [];
  const spawned = deferred<FakeChildProcess>();
  const spawnProcess: CapturedQualityComparisonSpawnProcess = (
    command: string,
    args: readonly string[],
    options,
  ) => {
    const child = new FakeChildProcess();
    calls.push({ command, args: [...args], options });
    spawned.resolve(child);
    queueMicrotask(() => {
      scenario(child);
    });
    return child;
  };
  return { spawnProcess, calls, spawned: spawned.promise };
}

function sha256(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function compileInputFixture(): CompileFoundryCapturedQualityComparisonReportV0Input {
  type QualityAssets = CompileFoundryCapturedQualityComparisonReportV0Input[
    "candidateProfiles"
  ][0]["assets"];
  type MobileAssets = CompileFoundryCapturedQualityComparisonReportV0Input[
    "candidateProfiles"
  ][1]["assets"];
  type Matrix = CompileFoundryCapturedQualityComparisonReportV0Input[
    "views"
  ][number]["camera"]["viewMatrix"];
  type Repeats = CompileFoundryCapturedQualityComparisonReportV0Input[
    "captures"
  ][number]["views"][number]["repeats"];
  type SourceSnapshot = CompileFoundryCapturedQualityComparisonReportV0Input[
    "sourceIntegrity"
  ]["preCapture"];

  const qualityAssets: QualityAssets = [
    { pathLabel: "quality-a.sog", sizeBytes: 10, sha256: sha256(1) },
    { pathLabel: "quality-b.sog", sizeBytes: 11, sha256: sha256(2) },
    { pathLabel: "quality-c.sog", sizeBytes: 12, sha256: sha256(3) },
    { pathLabel: "quality-d.sog", sizeBytes: 13, sha256: sha256(4) },
  ];
  const mobileAssets: MobileAssets = [
    { pathLabel: "mobile-a.spz", sizeBytes: 20, sha256: sha256(5) },
    { pathLabel: "mobile-b.spz", sizeBytes: 21, sha256: sha256(6) },
    { pathLabel: "mobile-c.spz", sizeBytes: 22, sha256: sha256(7) },
    { pathLabel: "mobile-d.spz", sizeBytes: 23, sha256: sha256(8) },
  ];
  const identityMatrix: Matrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const qualityHashes = [sha256(20), sha256(21)] as const;
  const mobileHashes = [sha256(22), sha256(23)] as const;
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
    hashes: readonly [string, string],
    loadedBytes: number,
    decodedGaussianCount: number,
  ): Repeats => [
    {
      repeat: 1,
      screenshot: {
        mediaType: "image/png",
        widthPx: 4,
        heightPx: 4,
        sizeBytes: 20,
        sha256: hashes[0],
      },
      telemetry: telemetry(loadedBytes, decodedGaussianCount),
    },
    {
      repeat: 2,
      screenshot: {
        mediaType: "image/png",
        widthPx: 4,
        heightPx: 4,
        sizeBytes: 21,
        sha256: hashes[1],
      },
      telemetry: telemetry(loadedBytes, decodedGaussianCount),
    },
  ];
  const sourceSnapshot: SourceSnapshot = [
    { profileId: "quality-sog-fine-v1", ...qualityAssets[0] },
    { profileId: "quality-sog-fine-v1", ...qualityAssets[1] },
    { profileId: "quality-sog-fine-v1", ...qualityAssets[2] },
    { profileId: "quality-sog-fine-v1", ...qualityAssets[3] },
    { profileId: "mobile-spz-fine-v1", ...mobileAssets[0] },
    { profileId: "mobile-spz-fine-v1", ...mobileAssets[1] },
    { profileId: "mobile-spz-fine-v1", ...mobileAssets[2] },
    { profileId: "mobile-spz-fine-v1", ...mobileAssets[3] },
  ];

  return {
    generatedAt: "2026-07-18T12:00:00.000Z",
    sourceReceiptSha256: null,
    candidateProfiles: [
      {
        profileId: "quality-sog-fine-v1",
        expectedGaussianCount: 100,
        decodedGaussianCount: 100,
        assets: qualityAssets,
      },
      {
        profileId: "mobile-spz-fine-v1",
        expectedGaussianCount: 90,
        decodedGaussianCount: 90,
        assets: mobileAssets,
      },
    ],
    rendererProfile: {
      id: "captured-quality-process-test-renderer-v1",
      profileSha256: sha256(9),
    },
    viewport: { widthPx: 4, heightPx: 4, deviceScaleFactor: 1 },
    views: [{
      viewId: "overview",
      kind: "spatial_mid",
      camera: {
        model: "perspective",
        position: [0, 0, 1],
        target: [0, 0, 0],
        up: [0, 1, 0],
        verticalFovDegrees: 60,
        nearClip: 0.1,
        farClip: 100,
        viewMatrix: [...identityMatrix],
        projectionMatrix: [...identityMatrix],
      },
    }],
    captures: [
      {
        profileId: "quality-sog-fine-v1",
        views: [{
          viewId: "overview",
          repeats: repeats(qualityHashes, 46, 100),
        }],
      },
      {
        profileId: "mobile-spz-fine-v1",
        views: [{
          viewId: "overview",
          repeats: repeats(mobileHashes, 86, 90),
        }],
      },
    ],
    pairMetrics: [{
      viewId: "overview",
      repeats: [
        {
          repeat: 1,
          qualityScreenshotSha256: qualityHashes[0],
          mobileScreenshotSha256: mobileHashes[0],
          metrics: {
            comparedPixelCount: 16,
            meanAbsoluteError: 0.1,
            rootMeanSquareError: 0.2,
            psnrDb: 30,
            ssim: 0.9,
          },
        },
        {
          repeat: 2,
          qualityScreenshotSha256: qualityHashes[1],
          mobileScreenshotSha256: mobileHashes[1],
          metrics: {
            comparedPixelCount: 16,
            meanAbsoluteError: 0.11,
            rootMeanSquareError: 0.21,
            psnrDb: 29,
            ssim: 0.89,
          },
        },
      ],
    }],
    sourceIntegrity: {
      preCapture: sourceSnapshot,
      postCapture: structuredClone(sourceSnapshot),
      allSourcesUnchanged: true,
    },
    scorer: {
      id: "captured-quality-process-test-scorer-v1",
      version: "1.0.0",
      implementationSha256: sha256(10),
      receiptSha256: sha256(11),
    },
  };
}

function contextFixture(
  outputRoot = join(resolve(process.cwd()), "output", "captured quality"),
): CapturedQualityComparisonProcessContext {
  const repoRoot = resolve(process.cwd());
  return {
    repoRoot,
    qualityRoot: join(repoRoot, "quality profile"),
    mobileRoot: join(repoRoot, "mobile profile"),
    outputRoot,
    requestId: REQUEST_ID,
  };
}

async function temporaryOutputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "captured-quality-adapter-"));
  temporaryDirectories.push(root);
  const outputRoot = join(root, "output");
  await mkdir(outputRoot);
  return outputRoot;
}

async function writeOwnedOutput(
  context: CapturedQualityComparisonProcessContext,
  observationRequestId = context.requestId,
): Promise<string> {
  const finalOutput = join(context.outputRoot, context.requestId);
  const compileInput = {};
  const compileInputSha256 = createHash("sha256")
    .update(JSON.stringify(compileInput), "utf8")
    .digest("hex");
  await mkdir(finalOutput, { recursive: true });
  await Promise.all([
    writeFile(
      join(finalOutput, "runner-observation.json"),
      `${JSON.stringify({
        schemaVersion:
          "venviewer.reception-captured-quality-runner-observation.v1",
        requestId: observationRequestId,
        compileInputSha256,
      })}\n`,
    ),
    writeFile(
      join(finalOutput, "compile-input.json"),
      `${JSON.stringify(compileInput, null, 2)}\n`,
    ),
  ]);
  return finalOutput;
}

describe("captured-quality comparison process runner", () => {
  it("uses exact trusted CLI arguments, parses progress, and compiles valid report input", async () => {
    const input = compileInputFixture();
    const expected = compileFoundryCapturedQualityComparisonReportV0(input);
    const fake = fakeSpawn((child) => {
      child.stderr.write("local renderer diagnostic\n");
      child.stderr.write("CAPTURE_PRO");
      child.stderr.write(
        'GRESS {"phase":"capturing","completedCaptures":7,"totalCaptures":24}\n',
      );
      child.stderr.write(
        'CAPTURE_PROGRESS {"phase":"finalizing","completedCaptures":24,"totalCaptures":24}',
      );
      child.stdout.write(JSON.stringify(input));
      child.close(0);
    });
    const context = contextFixture();
    const runnerScriptPath = join(context.repoRoot, "custom runner", "runner.mjs");
    const progress: CapturedQualityComparisonProcessProgress[] = [];
    const runner = createCapturedQualityComparisonProcessRunner({
      runnerScriptPath,
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(context, new AbortController().signal, (value) => {
        progress.push(value);
      }),
    ).resolves.toEqual(expected);

    expect(progress).toEqual([
      {
        phase: "capturing",
        completed: 7,
        total: 24,
        message: "Capturing fixed Quality and Mobile views.",
      },
      {
        phase: "finalizing",
        completed: 24,
        total: 24,
        message: "Binding the final local report.",
      },
    ]);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.command).toBe(process.execPath);
    expect(call?.args).toEqual([
      runnerScriptPath,
      "--repo-root",
      context.repoRoot,
      "--quality-root",
      context.qualityRoot,
      "--mobile-root",
      context.mobileRoot,
      "--output-root",
      context.outputRoot,
      "--request-id",
      REQUEST_ID,
    ]);
    expect(call?.options).toMatchObject({
      cwd: context.repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: expect.objectContaining({ NO_COLOR: "1" }),
    });
  });

  it("rejects malformed JSON stdout", async () => {
    const fake = fakeSpawn((child) => {
      child.stdout.write("{not-json");
      child.close(0);
    });
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(contextFixture(), new AbortController().signal, vi.fn()),
    ).rejects.toThrow("did not return one valid JSON report input");
  });

  it("terminates oversized stdout but rejects only after child close", async () => {
    const fake = fakeSpawn((child) => {
      child.autoCloseOnKill = false;
      child.stdout.write(Buffer.alloc(MAX_STDOUT_BYTES + 1, 0x61));
    });
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });
    const running = runner(
      contextFixture(),
      new AbortController().signal,
      vi.fn(),
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const child = await fake.spawned;
    await new Promise<void>((resolveImmediate) => {
      setImmediate(resolveImmediate);
    });

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(settled).toBe(false);
    child.close(null, "SIGTERM");
    await expect(running).rejects.toThrow("too much report data");
    expect(settled).toBe(true);
  });

  it("terminates and rejects malformed or out-of-bound progress records", async () => {
    const input = compileInputFixture();
    const fake = fakeSpawn((child) => {
      child.stdout.write(JSON.stringify(input));
      child.stderr.write(
        'CAPTURE_PROGRESS {"phase":"capturing","completedCaptures":25,"totalCaptures":24}\n',
      );
    });
    const onProgress = vi.fn();
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(contextFixture(), new AbortController().signal, onProgress),
    ).rejects.toThrow("invalid progress data");
    const child = await fake.spawned;
    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("rejects a nonzero exit with the bounded diagnostic tail", async () => {
    const fake = fakeSpawn((child) => {
      child.stderr.write("renderer setup started\n");
      child.stderr.write("renderer fixture failed\n");
      child.close(2);
    });
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(contextFixture(), new AbortController().signal, vi.fn()),
    ).rejects.toThrow("captured-quality runner stopped: renderer fixture failed");
  });

  it("sends SIGTERM and rejects with AbortError after local cancellation", async () => {
    const fake = fakeSpawn(() => undefined);
    const abortController = new AbortController();
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });
    const running = runner(contextFixture(), abortController.signal, vi.fn());
    const child = await fake.spawned;

    abortController.abort();

    await expect(running).rejects.toMatchObject({
      name: "AbortError",
      message: "The local captured-quality comparison was stopped.",
    });
    expect(child.killSignals).toEqual(["SIGTERM"]);
  });

  it.each([
    ["malformed stdout", "{not-json", "did not return one valid JSON"],
    ["invalid compile input", "{}", "generatedAt"],
  ])(
    "removes the exact newly committed request bundle after %s",
    async (_label, stdout, expectedError) => {
      const outputRoot = await temporaryOutputRoot();
      const context = contextFixture(outputRoot);
      let finalOutput = "";
      const fake = fakeSpawn((child) => {
        void (async () => {
          finalOutput = await writeOwnedOutput(context);
          child.stdout.write(stdout);
          child.close(0);
        })().catch((error: unknown) => {
          child.emit("error", error);
        });
      });
      const runner = createCapturedQualityComparisonProcessRunner({
        spawnProcess: fake.spawnProcess,
      });

      await expect(
        runner(context, new AbortController().signal, vi.fn()),
      ).rejects.toThrow(expectedError);
      expect(finalOutput).not.toBe("");
      await expect(lstat(finalOutput)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("removes an exact committed request bundle when cancellation wins", async () => {
    const outputRoot = await temporaryOutputRoot();
    const context = contextFixture(outputRoot);
    const fake = fakeSpawn(() => undefined);
    const abortController = new AbortController();
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });
    const running = runner(context, abortController.signal, vi.fn());
    const child = await fake.spawned;
    const finalOutput = await writeOwnedOutput(context);

    abortController.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(child.killSignals).toEqual(["SIGTERM"]);
    await expect(lstat(finalOutput)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never removes a request directory that existed before spawn", async () => {
    const outputRoot = await temporaryOutputRoot();
    const context = contextFixture(outputRoot);
    const finalOutput = await writeOwnedOutput(context);
    const fake = fakeSpawn((child) => {
      child.stderr.write("final output already exists\n");
      child.close(1);
    });
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(context, new AbortController().signal, vi.fn()),
    ).rejects.toThrow("final output already exists");
    await expect(lstat(finalOutput)).resolves.toMatchObject({});
  });

  it("refuses to remove a post-spawn directory with a mismatched ownership receipt", async () => {
    const outputRoot = await temporaryOutputRoot();
    const context = contextFixture(outputRoot);
    let finalOutput = "";
    const fake = fakeSpawn((child) => {
      void (async () => {
        finalOutput = await writeOwnedOutput(
          context,
          "11111111111111111111111111111111",
        );
        child.stdout.write("{not-json");
        child.close(0);
      })().catch((error: unknown) => {
        child.emit("error", error);
      });
    });
    const runner = createCapturedQualityComparisonProcessRunner({
      spawnProcess: fake.spawnProcess,
    });

    await expect(
      runner(context, new AbortController().signal, vi.fn()),
    ).rejects.toThrow("ownership receipt did not match the request");
    expect(finalOutput).not.toBe("");
    await expect(lstat(finalOutput)).resolves.toMatchObject({});
  });
});
