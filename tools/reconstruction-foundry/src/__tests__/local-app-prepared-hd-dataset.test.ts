import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0,
  verifyFoundryPreparedHdDatasetReadinessReceiptV0,
  type FoundryPreparedHdDatasetPythonSummaryV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LocalPreparedHdDatasetProcessOutcomeV0,
  LocalPreparedHdDatasetProcessRunnerV0,
} from "../local-prepared-hd-dataset.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const STALE_REQUEST_ID = "fedcba9876543210fedcba9876543210";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface Fixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly pythonExecutable: string;
  readonly pythonSummary: FoundryPreparedHdDatasetPythonSummaryV0;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeRelative(
  root: string,
  path: string,
  bytes: Buffer,
): Promise<void> {
  const destination = join(root, ...path.split("/"));
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, bytes);
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-local-app-prepared-hd-"));
  temporaryDirectories.push(root);
  const sourceRoot = join(root, "prepared-package");
  const pythonExecutable = join(root, "python.exe");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(pythonExecutable, Buffer.from("fixed-test-python"));

  const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const blackPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nSIAAAAASUVORK5CYII=",
    "base64",
  );
  const sourceBytes = new Map<string, Buffer>([
    ["dataset/images/a.png", transparentPng],
    ["dataset/images/b.png", blackPng],
    ["dataset/images_2/a.png", transparentPng],
    ["dataset/images_2/b.png", blackPng],
    ["dataset/sparse/0/cameras.bin", Buffer.from("cameras")],
    ["dataset/sparse/0/images.bin", Buffer.from("images")],
    ["dataset/sparse/0/points3D.bin", Buffer.from("points")],
    ["dataset/splits.json", Buffer.from('{"heldout":["a.png"],"train":["b.png"]}')],
    ["depths/b.npz", Buffer.from("depth-b")],
  ]);
  for (const [path, bytes] of sourceBytes) {
    await writeRelative(sourceRoot, path, bytes);
  }
  const bytes = (path: string): Buffer => {
    const value = sourceBytes.get(path);
    if (value === undefined) throw new Error(`missing fixture member ${path}`);
    return value;
  };
  const fileSummary = (path: string) => ({
    bytes: bytes(path).byteLength,
    sha256: sha256(bytes(path)),
  });
  return {
    root,
    sourceRoot,
    pythonExecutable,
    pythonSummary: {
      schemaVersion: FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0,
      ok: true,
      summary: {
        schemaVersion: "omnitwin.colmap-training-contract.v0",
        binaryFormat: { format: "COLMAP sparse binary", endianness: "little" },
        parserSemantics: {
          implementation: "gsplat v1.5.3 examples/datasets/colmap.py",
          dataFactor: 2,
          testEvery: 8,
          splitRule: "sorted_filename_index_modulo_test_every",
          runtimeImageDirectory: "images_2",
          extMetadataAccepted: false,
        },
        files: {
          "cameras.bin": fileSummary("dataset/sparse/0/cameras.bin"),
          "images.bin": fileSummary("dataset/sparse/0/images.bin"),
          "points3D.bin": fileSummary("dataset/sparse/0/points3D.bin"),
          "splits.json": fileSummary("dataset/splits.json"),
        },
        cameraCount: 1,
        cameras: [{
          cameraId: 1,
          modelId: 1,
          model: "PINHOLE",
          width: 4,
          height: 4,
          params: [2, 2, 2, 2],
        }],
        imageCount: 2,
        images: [
          {
            imageId: 1,
            name: "a.png",
            cameraId: 1,
            cameraModel: "PINHOLE",
            width: 4,
            height: 4,
            observationCount: 1,
            sha256: sha256(bytes("dataset/images/a.png")),
          },
          {
            imageId: 2,
            name: "b.png",
            cameraId: 1,
            cameraModel: "PINHOLE",
            width: 4,
            height: 4,
            observationCount: 1,
            sha256: sha256(bytes("dataset/images/b.png")),
          },
        ],
        runtimeImageCount: 2,
        runtimeImages: [
          {
            sourceName: "a.png",
            name: "a.png",
            width: 2,
            height: 2,
            sha256: sha256(bytes("dataset/images_2/a.png")),
          },
          {
            sourceName: "b.png",
            name: "b.png",
            width: 2,
            height: 2,
            sha256: sha256(bytes("dataset/images_2/b.png")),
          },
        ],
        point3DCount: 2,
        pointObservationCount: 2,
        splits: {
          train: ["b.png"],
          heldout: ["a.png"],
          trainCount: 1,
          heldoutCount: 1,
        },
        depth: {
          required: true,
          priorCount: 1,
          priors: [{
            fileName: "b.npz",
            imageName: "b.png",
            sha256: sha256(bytes("depths/b.npz")),
            sampleCount: 1,
            width: 4,
            height: 4,
            uvDtype: "float32",
            depthDtype: "float32",
          }],
        },
      },
    },
  };
}

function successOutcome(
  summary: FoundryPreparedHdDatasetPythonSummaryV0,
): LocalPreparedHdDatasetProcessOutcomeV0 {
  return {
    kind: "completed",
    exitCode: 0,
    signal: null,
    stdout: Buffer.from(`${JSON.stringify(summary)}\n`),
    stderr: Buffer.alloc(0),
  };
}

function token(app: LocalFoundryAppHandle): string {
  const value = new URL(app.url).searchParams.get("token");
  if (value === null) throw new Error("local app fixture has no token");
  return value;
}

function request(
  app: LocalFoundryAppHandle,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  return new Promise((resolvePromise, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const current = new URL(app.origin);
    const outgoing = httpRequest({
      hostname: current.hostname,
      port: app.port,
      path,
      method,
      headers: {
        ...(method === "POST" ? { Origin: app.origin } : {}),
        ...(bytes === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "Content-Length": String(bytes.byteLength),
            }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolvePromise({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    outgoing.on("error", reject);
    if (bytes !== undefined) outgoing.write(bytes);
    outgoing.end();
  });
}

async function state(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await request(
    app,
    "GET",
    `/api/state?token=${encodeURIComponent(token(app))}`,
  );
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForReady(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = await state(app);
    if (current.phase === "ready") return current;
    if (current.phase === "failed") throw new Error("local app fixture inspection failed");
    await delay(10);
  }
  throw new Error("local app fixture did not become ready");
}

async function postPrepared(
  app: LocalFoundryAppHandle,
  action: "start" | "status" | "cancel",
  body: unknown,
): Promise<HttpResult> {
  return await request(
    app,
    "POST",
    `/api/prepared-hd-dataset/${action}?token=${encodeURIComponent(token(app))}`,
    body,
  );
}

describe("Foundry local app prepared HD dataset gate", () => {
  it("runs the exact receipt-bound gate and downloads its authority-none receipt", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(() =>
      Promise.resolve(successOutcome(fixture.pythonSummary)));
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      preparedHdDataset: {
        trustedContext: {
          repoRoot: REPO_ROOT,
          sourceRoot: fixture.sourceRoot,
          pythonExecutable: fixture.pythonExecutable,
        },
        processRunner,
        operationTimeoutMs: 5_000,
        settlementTimeoutMs: 500,
      },
    });
    openApps.push(app);
    const ready = await waitForReady(app);
    expect(ready.preparedHdDataset).toMatchObject({
      state: "ready",
      authority: "none",
      operation: "prepared_dataset_validation_only",
      receiptSha256: ready.receipt?.receiptSha256,
      requestId: null,
      report: null,
    });
    const receiptSha256 = ready.receipt?.receiptSha256;
    if (receiptSha256 === undefined) throw new Error("fixture has no intake receipt");

    const extraField = await postPrepared(app, "start", {
      requestId: REQUEST_ID,
      receiptSha256,
      sourceRoot: fixture.sourceRoot,
    });
    expect(extraField.status).toBe(400);
    expect(extraField.body.toString("utf8")).not.toContain(fixture.sourceRoot);
    const stale = await postPrepared(app, "start", {
      requestId: REQUEST_ID,
      receiptSha256: "0".repeat(64),
    });
    expect(stale.status).toBe(409);

    const started = await postPrepared(app, "start", {
      requestId: REQUEST_ID,
      receiptSha256,
    });
    expect(started.status).toBe(202);
    let completed: LocalFoundryPublicState["preparedHdDataset"] | null = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await postPrepared(app, "status", { requestId: REQUEST_ID });
      expect(response.status).toBe(200);
      const candidate = JSON.parse(response.body.toString("utf8")) as
        LocalFoundryPublicState["preparedHdDataset"];
      if (candidate.state === "completed") {
        completed = candidate;
        break;
      }
      if (candidate.state === "failed") {
        throw new Error([
          "prepared fixture failed",
          candidate.failureCode ?? "unknown",
        ].join(": "));
      }
      await delay(10);
    }
    if (completed?.report === null || completed === null) {
      throw new Error("prepared fixture did not complete");
    }
    expect(completed.report).toMatchObject({
      sourceReceiptSha256: receiptSha256,
      cameraCount: 1,
      imageCount: 2,
      runtimeImageCount: 2,
      trainImageCount: 1,
      heldoutImageCount: 1,
      pointCount: 2,
      depthPriorCount: 1,
    });
    expect(processRunner).toHaveBeenCalledOnce();

    const downloaded = await request(
      app,
      "GET",
      "/api/prepared-hd-dataset/report" +
        `?token=${encodeURIComponent(token(app))}` +
        `&requestId=${REQUEST_ID}` +
        `&digest=${completed.report.readinessReceiptSha256}`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toContain(
      "foundry-prepared-hd-dataset-readiness-v0.json",
    );
    const report = verifyFoundryPreparedHdDatasetReadinessReceiptV0(
      JSON.parse(downloaded.body.toString("utf8")),
    );
    expect(report.authority).toBe("none");
    expect(report.result).toBe(
      "prepared_dataset_validated_runtime_and_training_disabled",
    );
    expect(report.source.universalIntakeReceiptSha256).toBe(receiptSha256);
    expect(downloaded.body.toString("utf8")).not.toContain(fixture.sourceRoot);
    expect(downloaded.body.toString("utf8")).not.toContain(REPO_ROOT);
    expect(downloaded.body.toString("utf8")).not.toContain(
      fixture.pythonExecutable,
    );

    const staleStatus = await postPrepared(app, "status", {
      requestId: STALE_REQUEST_ID,
    });
    expect(staleStatus.status).toBe(409);
  }, 20_000);

  it("cancels a running validator and confirms it during local-session stop", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(
      (_invocation, signal) => new Promise((resolvePromise) => {
        signal.addEventListener("abort", () => {
          resolvePromise({ kind: "cancelled" });
        }, { once: true });
      }),
    );
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      preparedHdDataset: {
        trustedContext: {
          repoRoot: REPO_ROOT,
          sourceRoot: fixture.sourceRoot,
          pythonExecutable: fixture.pythonExecutable,
        },
        processRunner,
        operationTimeoutMs: 5_000,
        settlementTimeoutMs: 500,
      },
    });
    openApps.push(app);
    const ready = await waitForReady(app);
    const receiptSha256 = ready.receipt?.receiptSha256;
    if (receiptSha256 === undefined) throw new Error("fixture has no intake receipt");
    const started = await postPrepared(app, "start", {
      requestId: REQUEST_ID,
      receiptSha256,
    });
    expect(started.status).toBe(202);
    const cancelled = await postPrepared(app, "cancel", {
      requestId: REQUEST_ID,
    });
    expect(cancelled.status).toBe(200);
    expect(JSON.parse(cancelled.body.toString("utf8"))).toMatchObject({
      state: "failed",
      requestId: REQUEST_ID,
      failureCode: "LOCAL_PREPARED_HD_DATASET_CANCELLED",
      report: null,
    });
    const stopped = await request(
      app,
      "POST",
      `/api/stop?token=${encodeURIComponent(token(app))}`,
      {},
    );
    expect(stopped.status).toBe(202);
    expect(JSON.parse(stopped.body.toString("utf8"))).toMatchObject({
      stopping: true,
      preparedHdDatasetStopped: true,
    });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
  }, 20_000);
});
