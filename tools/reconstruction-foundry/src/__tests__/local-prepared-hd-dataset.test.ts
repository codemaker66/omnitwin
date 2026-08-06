import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_PREPARED_HD_DATASET_PYTHON_GATE_V0,
  FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0,
  inspectUniversalIntake,
  verifyFoundryPreparedHdDatasetReadinessReceiptV0,
  type FoundryPreparedHdDatasetPythonSummaryV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_PREPARED_HD_DATASET_GATE_DTO_V0,
  LOCAL_PREPARED_HD_DATASET_MAX_STDOUT_BYTES,
  createLocalPreparedHdDatasetControllerV0,
  type LocalPreparedHdDatasetProcessOutcomeV0,
  type LocalPreparedHdDatasetProcessRunnerV0,
  type LocalPreparedHdDatasetSourceInspectorV0,
} from "../local-prepared-hd-dataset.js";

const REQUEST_A = "0123456789abcdef0123456789abcdef";
const REQUEST_B = "fedcba9876543210fedcba9876543210";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

interface Fixture {
  readonly root: string;
  readonly repoRoot: string;
  readonly sourceRoot: string;
  readonly pythonExecutable: string;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly pythonSummary: FoundryPreparedHdDatasetPythonSummaryV0;
  readonly sourceBytes: ReadonlyMap<string, Buffer>;
}

const cleanups: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map(async (root) => {
    await rm(root, { force: true, recursive: true });
  }));
});

async function writeRelative(root: string, path: string, bytes: Buffer): Promise<void> {
  const destination = join(root, ...path.split("/"));
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, bytes);
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-prepared-hd-tools-"));
  cleanups.push(root);
  const repoRoot = join(root, "repo");
  const sourceRoot = join(root, "private-package");
  const pythonExecutable = join(root, "python.exe");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(pythonExecutable, Buffer.from("fixed-python"));

  const sourceBytes = new Map<string, Buffer>([
    ["dataset/images/a.jpg", Buffer.from("source-image-a")],
    ["dataset/images/b.jpg", Buffer.from("source-image-b")],
    ["dataset/images_2/a.jpg", Buffer.from("runtime-image-a")],
    ["dataset/images_2/b.jpg", Buffer.from("runtime-image-b")],
    ["dataset/sparse/0/cameras.bin", Buffer.from("cameras")],
    ["dataset/sparse/0/images.bin", Buffer.from("images")],
    ["dataset/sparse/0/points3D.bin", Buffer.from("points")],
    ["dataset/splits.json", Buffer.from('{"heldout":["a.jpg"],"train":["b.jpg"]}')],
    ["depths/b.npz", Buffer.from("depth-b")],
  ]);
  for (const [path, bytes] of sourceBytes) await writeRelative(sourceRoot, path, bytes);

  for (const path of Object.values(FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0)) {
    await writeRelative(repoRoot, path, Buffer.from(`tool:${path}`));
  }

  const receipt = await inspectUniversalIntake(sourceRoot);
  const bytes = (path: string): Buffer => {
    const value = sourceBytes.get(path);
    if (value === undefined) throw new Error(`missing fixture member ${path}`);
    return value;
  };
  const fileSummary = (path: string): { readonly bytes: number; readonly sha256: string } => ({
    bytes: bytes(path).byteLength,
    sha256: sha256(bytes(path)),
  });
  const pythonSummary: FoundryPreparedHdDatasetPythonSummaryV0 = {
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
          name: "a.jpg",
          cameraId: 1,
          cameraModel: "PINHOLE",
          width: 4,
          height: 4,
          observationCount: 1,
          sha256: sha256(bytes("dataset/images/a.jpg")),
        },
        {
          imageId: 2,
          name: "b.jpg",
          cameraId: 1,
          cameraModel: "PINHOLE",
          width: 4,
          height: 4,
          observationCount: 1,
          sha256: sha256(bytes("dataset/images/b.jpg")),
        },
      ],
      runtimeImageCount: 2,
      runtimeImages: [
        {
          sourceName: "a.jpg",
          name: "a.jpg",
          width: 2,
          height: 2,
          sha256: sha256(bytes("dataset/images_2/a.jpg")),
        },
        {
          sourceName: "b.jpg",
          name: "b.jpg",
          width: 2,
          height: 2,
          sha256: sha256(bytes("dataset/images_2/b.jpg")),
        },
      ],
      point3DCount: 2,
      pointObservationCount: 2,
      splits: {
        train: ["b.jpg"],
        heldout: ["a.jpg"],
        trainCount: 1,
        heldoutCount: 1,
      },
      depth: {
        required: true,
        priorCount: 1,
        priors: [{
          fileName: "b.npz",
          imageName: "b.jpg",
          sha256: sha256(bytes("depths/b.npz")),
          sampleCount: 1,
          width: 4,
          height: 4,
          uvDtype: "float32",
          depthDtype: "float32",
        }],
      },
    },
  };
  return {
    root,
    repoRoot,
    sourceRoot,
    pythonExecutable,
    receipt,
    pythonSummary,
    sourceBytes,
  };
}

function successOutcome(summary: FoundryPreparedHdDatasetPythonSummaryV0): LocalPreparedHdDatasetProcessOutcomeV0 {
  return {
    kind: "completed",
    exitCode: 0,
    signal: null,
    stdout: Buffer.from(`${JSON.stringify(summary)}\n`),
    stderr: Buffer.alloc(0),
  };
}

function fixedInspector(
  ...receipts: readonly FoundryUniversalIntakeReceipt[]
): LocalPreparedHdDatasetSourceInspectorV0 {
  let index = 0;
  return vi.fn(() => {
    const receipt = receipts[Math.min(index, receipts.length - 1)];
    index += 1;
    if (receipt === undefined) throw new Error("fixture inspector has no receipt");
    return Promise.resolve(structuredClone(receipt));
  });
}

function controllerFor(
  fixture: Fixture,
  options: {
    readonly inspector?: LocalPreparedHdDatasetSourceInspectorV0;
    readonly processRunner?: LocalPreparedHdDatasetProcessRunnerV0;
    readonly operationTimeoutMs?: number;
    readonly settlementTimeoutMs?: number;
  } = {},
) {
  const processRunner = options.processRunner ?? vi.fn(() =>
    Promise.resolve(successOutcome(fixture.pythonSummary)));
  const controller = createLocalPreparedHdDatasetControllerV0({
    trustedContext: {
      repoRoot: fixture.repoRoot,
      sourceRoot: fixture.sourceRoot,
      pythonExecutable: fixture.pythonExecutable,
    },
    inspector: options.inspector ?? fixedInspector(fixture.receipt, fixture.receipt),
    processRunner,
    operationTimeoutMs: options.operationTimeoutMs ?? 5_000,
    settlementTimeoutMs: options.settlementTimeoutMs ?? 500,
  });
  controller.bindReceipt(fixture.receipt);
  return { controller, processRunner };
}

describe("local prepared HD dataset gate", () => {
  it("is unavailable until an exact dataset/ plus depths/ intake receipt is bound", async () => {
    const fixture = await makeFixture();
    const controller = createLocalPreparedHdDatasetControllerV0({
      trustedContext: {
        repoRoot: fixture.repoRoot,
        sourceRoot: fixture.sourceRoot,
        pythonExecutable: fixture.pythonExecutable,
      },
      inspector: fixedInspector(fixture.receipt),
      processRunner: vi.fn(() => Promise.resolve(successOutcome(fixture.pythonSummary))),
    });
    expect(controller.snapshot()).toMatchObject({
      schemaVersion: LOCAL_PREPARED_HD_DATASET_GATE_DTO_V0,
      state: "unavailable",
      receiptSha256: null,
    });

    await writeRelative(fixture.sourceRoot, "notes.txt", Buffer.from("not prepared data"));
    const wrongShape = await inspectUniversalIntake(fixture.sourceRoot);
    controller.bindReceipt(wrongShape);
    expect(controller.snapshot()).toMatchObject({
      state: "unavailable",
      receiptSha256: wrongShape.receiptSha256,
      failureCode: "LOCAL_PREPARED_HD_DATASET_LAYOUT_UNAVAILABLE",
    });

    controller.bindReceipt(fixture.receipt);
    expect(controller.snapshot()).toMatchObject({
      state: "ready",
      receiptSha256: fixture.receipt.receiptSha256,
      requestId: null,
      report: null,
    });
  });

  it("uses only the fixed no-shell Python module invocation and completes with bounded counts", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(() =>
      Promise.resolve(successOutcome(fixture.pythonSummary)));
    const { controller } = controllerFor(fixture, { processRunner });

    const result = await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    });

    expect(result).toEqual(expect.objectContaining({
      state: "completed",
      requestId: REQUEST_A,
      authority: "none",
      operation: "prepared_dataset_validation_only",
      failureCode: null,
      report: {
        schemaVersion: "omnitwin.foundry.prepared-hd-dataset-readiness.v0",
        readinessReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourceReceiptSha256: fixture.receipt.receiptSha256,
        cameraCount: 1,
        imageCount: 2,
        runtimeImageCount: 2,
        trainImageCount: 1,
        heldoutImageCount: 1,
        pointCount: 2,
        depthPriorCount: 1,
      },
    }));
    expect(processRunner).toHaveBeenCalledTimes(1);
    const invocation = processRunner.mock.calls[0]?.[0];
    expect(invocation).toEqual(expect.objectContaining({
      command: fixture.pythonExecutable,
      arguments: [
        "-B",
        "-m",
        "venviewer_training.colmap_contract_cli",
        "--package-root",
        fixture.sourceRoot,
      ],
      options: expect.objectContaining({
        cwd: fixture.repoRoot,
        env: expect.objectContaining({
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONHASHSEED: "0",
          PYTHONUTF8: "1",
        }),
        shell: false,
        windowsHide: true,
      }),
    }));
    expect(invocation?.options.env).not.toHaveProperty("PYTHONNOUSERSITE");
    for (const name of ["APPDATA", "HOME"] as const) {
      if (process.env[name] === undefined) {
        expect(invocation?.options.env).not.toHaveProperty(name);
      } else {
        expect(invocation?.options.env[name]).toBe(process.env[name]);
      }
    }
  });

  it("returns and clones only the completed receipt bound to the exact request", async () => {
    const fixture = await makeFixture();
    const { controller } = controllerFor(fixture);
    await controller.start({ requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 });
    const report = controller.readCompletedReport(REQUEST_A);
    expect(report).not.toBeNull();
    expect(verifyFoundryPreparedHdDatasetReadinessReceiptV0(report)).toEqual(report);
    expect(controller.readCompletedReport(REQUEST_B)).toBeNull();
    if (report !== null) {
      report.preparedFiles[0]!.path = "dataset/changed.bin";
    }
    expect(controller.readCompletedReport(REQUEST_A)?.preparedFiles[0]?.path).not.toBe(
      "dataset/changed.bin",
    );
  });

  it("coalesces an exact duplicate start and rejects busy or stale starts", async () => {
    const fixture = await makeFixture();
    const pending = deferred<LocalPreparedHdDatasetProcessOutcomeV0>();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(() => pending.promise);
    const { controller } = controllerFor(fixture, { processRunner });
    const request = { requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 };
    const first = controller.start(request);
    const duplicate = controller.start(request);
    expect(controller.snapshot()).toMatchObject({ state: "running", requestId: REQUEST_A });
    await vi.waitFor(() => {
      expect(processRunner).toHaveBeenCalledTimes(1);
    });
    expect(await controller.start({ ...request, requestId: REQUEST_B })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_BUSY",
    });
    pending.resolve(successOutcome(fixture.pythonSummary));
    expect(await first).toMatchObject({ state: "completed" });
    expect(await duplicate).toMatchObject({ state: "completed" });
    expect(await controller.start({ ...request, requestId: REQUEST_B })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_STALE_REQUEST",
    });
    expect(await controller.start(request)).toMatchObject({ state: "completed" });
    expect(processRunner).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid and stale start bodies without accepting paths or options", async () => {
    const fixture = await makeFixture();
    const { controller, processRunner } = controllerFor(fixture);
    for (const body of [
      {},
      { requestId: REQUEST_A },
      { requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256, sourceRoot: fixture.sourceRoot },
      { requestId: "bad", receiptSha256: fixture.receipt.receiptSha256 },
    ]) {
      expect(() => controller.start(body)).toThrowError(
        expect.objectContaining({ code: "LOCAL_PREPARED_HD_DATASET_REQUEST_INVALID" }),
      );
    }
    expect(await controller.start({ requestId: REQUEST_A, receiptSha256: "f".repeat(64) })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_STALE_RECEIPT",
    });
    expect(processRunner).not.toHaveBeenCalled();
  });

  it("keeps unavailable and terminal states closed to invalid transitions", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(() =>
      Promise.resolve(successOutcome(fixture.pythonSummary)));
    const controller = createLocalPreparedHdDatasetControllerV0({
      trustedContext: {
        repoRoot: fixture.repoRoot,
        sourceRoot: fixture.sourceRoot,
        pythonExecutable: fixture.pythonExecutable,
      },
      inspector: fixedInspector(fixture.receipt, fixture.receipt),
      processRunner,
    });
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({ state: "unavailable" });
    expect(processRunner).not.toHaveBeenCalled();

    controller.bindReceipt(fixture.receipt);
    await controller.start({ requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 });
    expect(() => {
      controller.bindReceipt(fixture.receipt);
    }).toThrowError(
      expect.objectContaining({ code: "LOCAL_PREPARED_HD_DATASET_RECEIPT_REBIND_REFUSED" }),
    );
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({ state: "completed" });
    expect(processRunner).toHaveBeenCalledTimes(1);
  });

  it("cancels a running process and retains no report", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(async (_invocation, signal) =>
      await new Promise<LocalPreparedHdDatasetProcessOutcomeV0>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve({ kind: "cancelled" });
        }, { once: true });
      }));
    const { controller } = controllerFor(fixture, { processRunner });
    const completion = controller.start({ requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 });
    expect(controller.snapshot()).toMatchObject({ state: "running" });
    expect(await controller.cancel(REQUEST_A)).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_CANCELLED",
      report: null,
    });
    expect(await completion).toMatchObject({ failureCode: "LOCAL_PREPARED_HD_DATASET_CANCELLED" });
    expect(controller.readCompletedReport(REQUEST_A)).toBeNull();
    expect(await controller.cancel(REQUEST_B)).toBeNull();
  });

  it("enforces the controller-owned operation deadline even when the runner only observes cancellation", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(async (_invocation, signal) =>
      await new Promise<LocalPreparedHdDatasetProcessOutcomeV0>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve({ kind: "cancelled" });
        }, { once: true });
      }));
    const { controller } = controllerFor(fixture, {
      processRunner,
      operationTimeoutMs: 20,
    });
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_TIMED_OUT",
      report: null,
    });
  });

  it("fails closed on timeout, output caps, malformed/extra output, stderr, and nonzero exit", async () => {
    const fixture = await makeFixture();
    const cases: readonly [string, LocalPreparedHdDatasetProcessOutcomeV0, string][] = [
      ["timeout", { kind: "timed_out" }, "LOCAL_PREPARED_HD_DATASET_TIMED_OUT"],
      ["oversize", {
        kind: "completed",
        exitCode: 0,
        signal: null,
        stdout: Buffer.alloc(LOCAL_PREPARED_HD_DATASET_MAX_STDOUT_BYTES + 1),
        stderr: Buffer.alloc(0),
      }, "LOCAL_PREPARED_HD_DATASET_OUTPUT_LIMIT_EXCEEDED"],
      ["malformed", {
        kind: "completed",
        exitCode: 0,
        signal: null,
        stdout: Buffer.from("{not-json}\n"),
        stderr: Buffer.alloc(0),
      }, "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID"],
      ["extra", {
        kind: "completed",
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(`${JSON.stringify(fixture.pythonSummary)}\nextra\n`),
        stderr: Buffer.alloc(0),
      }, "LOCAL_PREPARED_HD_DATASET_OUTPUT_INVALID"],
      ["stderr", {
        kind: "completed",
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(`${JSON.stringify(fixture.pythonSummary)}\n`),
        stderr: Buffer.from("unexpected"),
      }, "LOCAL_PREPARED_HD_DATASET_STDERR_NOT_EMPTY"],
      ["nonzero", {
        kind: "completed",
        exitCode: 2,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('{"error":{"code":"INVALID","message":"safe"},"ok":false,"schemaVersion":"venviewer.prepared-hd-dataset-gate.v0"}\n'),
      }, "LOCAL_PREPARED_HD_DATASET_PROCESS_FAILED"],
    ];
    for (const [name, outcome, expectedCode] of cases) {
      const { controller } = controllerFor(fixture, {
        processRunner: vi.fn(() => Promise.resolve(outcome)),
      });
      const result = await controller.start({
        requestId: REQUEST_A,
        receiptSha256: fixture.receipt.receiptSha256,
      });
      expect(result, name).toMatchObject({
        state: "failed",
        failureCode: expectedCode,
        report: null,
      });
    }
  });

  it("fails when the source receipt changes between the before and after inspection", async () => {
    const fixture = await makeFixture();
    await writeRelative(fixture.sourceRoot, "dataset/images/b.jpg", Buffer.from("mutated-image"));
    const mutated = await inspectUniversalIntake(fixture.sourceRoot);
    const { controller } = controllerFor(fixture, {
      inspector: fixedInspector(fixture.receipt, mutated),
    });
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_SOURCE_MUTATED",
    });
  });

  it("fails when a fixed parser, CLI, config, or source-lock file changes", async () => {
    const fixture = await makeFixture();
    const cliPath = join(
      fixture.repoRoot,
      ...FOUNDRY_PREPARED_HD_DATASET_TOOL_PATHS_V0.cli.split("/"),
    );
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(async () => {
      await writeFile(cliPath, Buffer.from("mutated-cli"));
      return successOutcome(fixture.pythonSummary);
    });
    const { controller } = controllerFor(fixture, { processRunner });
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_PREPARED_HD_DATASET_TOOL_MUTATED",
    });
  });

  it("sanitizes absolute paths from failure DTOs and completed reports", async () => {
    const fixture = await makeFixture();
    const inspector: LocalPreparedHdDatasetSourceInspectorV0 = vi.fn(() =>
      Promise.reject(new Error(`cannot read ${fixture.sourceRoot}`)));
    const { controller } = controllerFor(fixture, { inspector });
    const failure = await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    });
    const serializedFailure = JSON.stringify(failure);
    expect(serializedFailure).not.toContain(fixture.sourceRoot);
    expect(serializedFailure).not.toContain(fixture.repoRoot);

    const successful = controllerFor(fixture).controller;
    await successful.start({ requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 });
    const report = successful.readCompletedReport(REQUEST_A);
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain(fixture.sourceRoot);
    expect(serializedReport).not.toContain(fixture.repoRoot);
    expect(serializedReport).not.toContain(fixture.pythonExecutable);
  });

  it("close is idempotent, cancels work, clears evidence, and disables future starts", async () => {
    const fixture = await makeFixture();
    const processRunner = vi.fn<LocalPreparedHdDatasetProcessRunnerV0>(async (_invocation, signal) =>
      await new Promise<LocalPreparedHdDatasetProcessOutcomeV0>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve({ kind: "cancelled" });
        }, { once: true });
      }));
    const { controller } = controllerFor(fixture, { processRunner });
    const completion = controller.start({ requestId: REQUEST_A, receiptSha256: fixture.receipt.receiptSha256 });
    await controller.close();
    await completion;
    await controller.close();
    expect(controller.snapshot()).toMatchObject({
      state: "unavailable",
      failureCode: "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED",
      report: null,
    });
    expect(controller.readCompletedReport(REQUEST_A)).toBeNull();
    expect(await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
    })).toMatchObject({
      state: "unavailable",
      failureCode: "LOCAL_PREPARED_HD_DATASET_CONTROLLER_CLOSED",
    });
  });
});
