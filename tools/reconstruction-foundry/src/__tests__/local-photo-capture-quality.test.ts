import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectUniversalIntake,
  type FoundryPhotoCaptureQualityWorkerV0Result,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalPhotoCaptureQualityControllerV0,
  type LocalPhotoCaptureQualityRunnerV0,
} from "../local-photo-capture-quality.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

async function photoFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "local-photo-workbench-"));
  temporaryDirectories.push(root);
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(root, "RR-PILOT-MAP-A-01.png"), onePixelPng);
  await writeFile(join(root, "RR-PILOT-S01-A.png"), onePixelPng);
  await writeFile(join(root, "settings.txt"), "manual\n", "utf8");
  return root;
}

describe("LocalPhotoCaptureQualityControllerV0", () => {
  it("activates automatically from a receipt and keeps browser candidates path-only", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    const controller = createLocalPhotoCaptureQualityControllerV0({ sourceRoot: root });

    controller.bindReceipt(receipt);
    const state = controller.snapshot();

    expect(state.state).toBe("ready");
    expect(state.receiptSha256).toBe(receipt.receiptSha256);
    expect(state.candidates).toEqual([
      expect.objectContaining({
        path: "RR-PILOT-MAP-A-01.png",
        suggestedRole: "build",
        assignedRole: null,
        protocolSlot: "RR-PILOT-MAP-A-01",
      }),
      expect.objectContaining({
        path: "RR-PILOT-S01-A.png",
        suggestedRole: "heldout",
        assignedRole: null,
        protocolSlot: "RR-PILOT-S01-A",
      }),
    ]);
    expect(JSON.stringify(state)).not.toContain(root);
    expect(JSON.stringify(state.candidates)).not.toContain("sha256");
  });

  it("runs the real pixel worker and serves only digest-bound in-memory thumbnails", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    const controller = createLocalPhotoCaptureQualityControllerV0({ sourceRoot: root });
    controller.bindReceipt(receipt);
    const ready = controller.snapshot();
    const requestId = "a".repeat(32);

    await controller.start({
      requestId,
      receiptSha256: receipt.receiptSha256,
      assignments: ready.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });

    const completed = controller.snapshot(requestId);
    expect(completed.state).toBe("completed");
    expect(completed.runRevision).toBe(1);
    expect(completed.candidates.map((candidate) => candidate.assignedRole)).toEqual([
      "build",
      "heldout",
    ]);
    expect(completed.report).toMatchObject({
      buildCount: 1,
      heldoutCount: 1,
      protocolStatus: "incomplete",
      readiness: "retake_required",
    });
    const first = completed.report?.photos[0];
    if (first?.thumbnail === null || first?.thumbnail === undefined) {
      throw new Error("expected an in-memory thumbnail receipt");
    }
    expect(
      controller.readThumbnail(
        requestId,
        first.imageId,
        first.thumbnail.sha256,
      )?.bytes.byteLength,
    ).toBeGreaterThan(0);
    expect(
      controller.readThumbnail(requestId, first.imageId, "0".repeat(64)),
    ).toBeNull();
    expect(controller.readCompletedReport(requestId)?.reportSha256).toBe(
      completed.report?.reportSha256,
    );
  });

  it("rejects a stale receipt before the runner can start", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    let called = false;
    const runner: LocalPhotoCaptureQualityRunnerV0 = () => {
      called = true;
      return Promise.reject(new Error("must not run"));
    };
    const controller = createLocalPhotoCaptureQualityControllerV0({
      sourceRoot: root,
      runner,
    });
    controller.bindReceipt(receipt);

    expect(() => controller.start({
      requestId: "b".repeat(32),
      receiptSha256: "0".repeat(64),
      assignments: controller.snapshot().candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    })).toThrowError(/receipt changed/i);
    expect(called).toBe(false);
  });

  it("confirms cancellation and retains neither report nor thumbnails", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    let started: (() => void) | undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runner: LocalPhotoCaptureQualityRunnerV0 = async ({ signal }) => {
      started?.();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener("abort", onAbort);
          reject(new DOMException("cancelled", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      throw new Error("unreachable");
    };
    const controller = createLocalPhotoCaptureQualityControllerV0({
      sourceRoot: root,
      runner,
      settlementTimeoutMs: 1_000,
    });
    controller.bindReceipt(receipt);
    const requestId = "c".repeat(32);
    const ready = controller.snapshot();
    const completion = controller.start({
      requestId,
      receiptSha256: receipt.receiptSha256,
      assignments: ready.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });
    await began;

    const cancelled = await controller.cancel(requestId);
    await completion;

    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.report).toBeNull();
    expect(controller.readCompletedReport(requestId)).toBeNull();
  });

  it("fails a changed assignment set without leaking an absolute path", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    const controller = createLocalPhotoCaptureQualityControllerV0({ sourceRoot: root });
    controller.bindReceipt(receipt);
    const ready = controller.snapshot();
    const requestId = "d".repeat(32);

    await controller.start({
      requestId,
      receiptSha256: receipt.receiptSha256,
      assignments: ready.candidates.slice(0, 1).map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });

    const failed = controller.snapshot(requestId);
    expect(failed.state).toBe("failed");
    expect(failed.failureCode).toBe("PHOTO_ASSIGNMENT_SET_MISMATCH");
    expect(JSON.stringify(failed)).not.toContain(root);
  });

  it("can inject a valid completed result without widening the controller contract", async () => {
    const root = await photoFolder();
    const receipt = await inspectUniversalIntake(root);
    const realController = createLocalPhotoCaptureQualityControllerV0({ sourceRoot: root });
    realController.bindReceipt(receipt);
    const ready = realController.snapshot();
    await realController.start({
      requestId: "e".repeat(32),
      receiptSha256: receipt.receiptSha256,
      assignments: ready.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });
    const report = realController.readCompletedReport("e".repeat(32));
    const resultThumbnails = new Map<string, Buffer>();
    const completed = realController.snapshot("e".repeat(32));
    for (const photo of completed.report?.photos ?? []) {
      if (photo.thumbnail === null) continue;
      const thumbnail = realController.readThumbnail(
        "e".repeat(32),
        photo.imageId,
        photo.thumbnail.sha256,
      );
      if (thumbnail !== null) resultThumbnails.set(photo.imageId, thumbnail.bytes);
    }
    if (report === null) throw new Error("expected fixture report");
    const injected: FoundryPhotoCaptureQualityWorkerV0Result = {
      report,
      thumbnails: resultThumbnails,
    };
    const controller = createLocalPhotoCaptureQualityControllerV0({
      sourceRoot: root,
      runner: () => Promise.resolve(injected),
    });
    controller.bindReceipt(receipt);
    await controller.start({
      requestId: "f".repeat(32),
      receiptSha256: receipt.receiptSha256,
      assignments: ready.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });
    expect(controller.snapshot("f".repeat(32)).state).toBe("completed");
  });
});
