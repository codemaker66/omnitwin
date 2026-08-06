import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectUniversalIntake,
  inspectUniversalIntakeWithSourceFactsV8,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0,
  createLocalNativeCollectionAnalysisControllerV0,
  type LocalNativeCollectionAnalysisCoreV0,
  type OpenedLocalNativeIntakeCollectionForAnalysisV0,
} from "../local-native-collection-analysis.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mixedCopiedPayloadFixture(): Promise<{
  readonly root: string;
  readonly paths: readonly string[];
}> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-native-analysis-"));
  roots.push(root);
  const files = [
    ["scan.e57", Buffer.from("ASTM-E57\0fixture", "ascii")],
    ["mesh.obj", Buffer.from("v 0 0 0\nf 1 1 1\n", "utf8")],
    ["scene.glb", Buffer.from("glTF\u0002\u0000\u0000\u0000", "binary")],
    [
      "gaussian.ply",
      Buffer.from(
        "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float scale_0\nproperty float rot_0\nproperty float opacity\nend_header\n0 0 0 0 1 0 1\n",
        "utf8",
      ),
    ],
    ["photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ["walkthrough.mp4", Buffer.from("\0\0\0\u0018ftypmp42", "binary")],
    ["opaque.xbin", Buffer.from("XBAGfixture", "ascii")],
  ] as const;
  const paths: string[] = [];
  for (const [name, bytes] of files) {
    const path = join(root, name);
    await writeFile(path, bytes);
    paths.push(path);
  }
  return { root, paths };
}

async function openedCollection(
  paths: readonly string[],
): Promise<OpenedLocalNativeIntakeCollectionForAnalysisV0> {
  const receipts = await Promise.all(paths.map((path) => inspectUniversalIntake(path)));
  return {
    indexSha256: "1".repeat(64),
    items: paths.map((activeSourcePath, index) => ({
      basketPosition: index + 1,
      kind: "file",
      selectedFileCount: 1,
      selectedBytesDecimal: "0",
      truth: {
        pendingReview: 1,
        admitted: 0,
        excluded: 0,
        captured: 0,
        enhancedCaptured: 0,
        generatedCinematic: 0,
        conceptImagination: 0,
      },
      verification: "verified",
      activeSourcePath,
      childWorkspaceRoot: `${activeSourcePath}.workspace`,
      receiptSha256: receipts[index]?.receiptSha256 ?? "2".repeat(64),
      workspaceSha256: String(index + 2).repeat(64).slice(0, 64),
      failureCode: null,
    })),
  };
}

function reverifyFrom(
  opened: OpenedLocalNativeIntakeCollectionForAnalysisV0,
): LocalNativeCollectionAnalysisCoreV0["reverifyChild"] {
  return (workspaceRoot) => {
    const item = opened.items.find((candidate) => candidate.childWorkspaceRoot === workspaceRoot);
    if (
      item?.activeSourcePath === null ||
      item?.activeSourcePath === undefined ||
      item.receiptSha256 === null ||
      item.workspaceSha256 === null
    ) {
      throw new Error("Fixture child is unavailable.");
    }
    return Promise.resolve({
      index: {
        receiptSha256: item.receiptSha256,
        workspaceSha256: item.workspaceSha256,
      },
      activeSourcePath: item.activeSourcePath,
    });
  };
}

async function waitForTerminal(
  controller: ReturnType<typeof createLocalNativeCollectionAnalysisControllerV0>,
) {
  for (let attempt = 0; attempt < 20_000; attempt += 1) {
    const view = controller.getView();
    if (view.phase !== "running") return view;
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  throw new Error("Collection analysis did not settle.");
}

function assertNoLocator(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/u);
  expect(serialized).not.toContain("omnitwin-native-analysis-");
  expect(serialized).not.toContain("activeSourcePath");
  expect(serialized).not.toContain("relativePath");
  expect(serialized).not.toContain("filename");
  expect(serialized).not.toContain("fileName");
}

describe("local native collection analysis V0", () => {
  it("inspects mixed copied payload families while publishing only neutral review DTOs", async () => {
    const fixture = await mixedCopiedPayloadFixture();
    const opened = await openedCollection(fixture.paths);
    const openCollection = vi.fn(() => Promise.resolve(opened));
    const inspectSource = vi.fn(inspectUniversalIntakeWithSourceFactsV8);
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot: fixture.root,
        collectionIndexSha256: "1".repeat(64),
      }),
      core: { openCollection, inspectSource, reverifyChild: reverifyFrom(opened) },
    });

    expect(controller.getView()).toMatchObject({
      phase: "ready",
      canStart: true,
      planState: LOCAL_NATIVE_COLLECTION_ANALYSIS_PLAN_STATE_V0,
      cancellationBoundary: "between_bounded_verification_steps",
      authority: "none",
    });
    expect(controller.start()).toMatchObject({ phase: "running", canCancel: true });
    const terminal = await waitForTerminal(controller);

    expect(openCollection).toHaveBeenCalledTimes(1);
    expect(inspectSource).toHaveBeenCalledTimes(fixture.paths.length);
    expect(terminal.phase).toBe("complete");
    expect(terminal.items).toHaveLength(7);
    expect(terminal.items.map((item) => item.label)).toEqual([
      "File 1", "File 2", "File 3", "File 4", "File 5", "File 6", "File 7",
    ]);
    expect(terminal.items.flatMap((item) => item.families.map((family) => family.inputType)))
      .toEqual(expect.arrayContaining([
        "generic_e57", "obj", "glb_gltf", "gaussian_ply", "generic_image", "video",
        "xgrids_xbin",
      ]));
    expect(terminal.items[6]).toMatchObject({
      state: "complete",
      planState: "needs_operator_review",
      families: [{
        inputType: "xgrids_xbin",
        support: "opaque_reference_only",
        fileCount: 1,
      }],
      nextAction: {
        state: "required",
        code: "OBTAIN_OFFICIAL_EXPORT",
      },
    });
    expect(terminal.items[6]?.blockers.codes).toEqual(expect.arrayContaining([
      "OPERATOR_EVIDENCE_REVIEW_REQUIRED",
      "XBIN_OFFICIAL_EXPORT_ONLY",
    ]));
    expect(terminal.items.every((item) =>
      item.blockers.count === item.blockers.codes.length &&
      new Set(item.blockers.codes).size === item.blockers.codes.length &&
      [...item.blockers.codes].sort().join("|") === item.blockers.codes.join("|"),
    )).toBe(true);
    expect(terminal.items.every((item) => item.truth?.pendingReview === 1)).toBe(true);
    expect(terminal.items.every((item) => item.planState === "needs_operator_review")).toBe(true);
    expect(terminal.items.every((item) => item.facts?.state === "unavailable" || item.facts?.state === "available"))
      .toBe(true);
    assertNoLocator(terminal);
    assertNoLocator(controller.getReport());
    const serialized = JSON.stringify(controller.getReport());
    for (const forbidden of [
      "admission", "workerBindings", "provider", "reconstruction", "training", "enhancement",
      "cloud", "rights", "signing", "publication",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("distinguishes a non-stored child and continues later copied payloads", async () => {
    const fixture = await mixedCopiedPayloadFixture();
    const opened = await openedCollection(fixture.paths);
    const items = opened.items.map((item, index) => index === 1
      ? {
          ...item,
          verification: "failed" as const,
          activeSourcePath: null,
          childWorkspaceRoot: null,
          receiptSha256: null,
          workspaceSha256: null,
          truth: null,
          failureCode: "CHILD_NOT_STORED" as const,
        }
      : item);
    const inspectSource = vi.fn(inspectUniversalIntakeWithSourceFactsV8);
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot: fixture.root,
        collectionIndexSha256: "1".repeat(64),
      }),
      core: {
        openCollection: () => Promise.resolve({ ...opened, items }),
        inspectSource,
        reverifyChild: reverifyFrom(opened),
      },
    });

    controller.start();
    const terminal = await waitForTerminal(controller);

    expect(terminal.phase).toBe("complete_with_failures");
    expect(terminal.items[1]).toMatchObject({
      state: "failed",
      failureCode: "CHILD_NOT_STORED",
      families: [],
      blockers: {
        codes: expect.arrayContaining(["COPIED_PAYLOAD_NOT_STORED"]),
      },
      nextAction: { state: "required", code: "RESTART_LOCAL_INTAKE" },
    });
    expect(terminal.items[1]?.blockers.codes).not.toContain(
      "COPIED_PAYLOAD_VERIFICATION_FAILED",
    );
    expect(terminal.items[2]?.state).toBe("complete");
    expect(inspectSource).toHaveBeenCalledTimes(fixture.paths.length - 1);
    assertNoLocator(terminal);
  });

  it("cancels the active inspection, preserves completed items, and never inspects queued items", async () => {
    const fixture = await mixedCopiedPayloadFixture();
    const opened = await openedCollection(fixture.paths);
    let releaseSecond: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolvePromise) => {
      releaseSecond = resolvePromise;
    });
    let call = 0;
    const inspectSource = vi.fn(async (source: string, options: { signal?: AbortSignal } = {}) => {
      call += 1;
      if (call === 2) {
        releaseSecond?.();
        await new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new Error("cancelled"));
          }, {
            once: true,
          });
        });
      }
      return inspectUniversalIntakeWithSourceFactsV8(source, options);
    });
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot: fixture.root,
        collectionIndexSha256: "1".repeat(64),
      }),
      core: {
        openCollection: () => Promise.resolve(opened),
        inspectSource,
        reverifyChild: reverifyFrom(opened),
      },
    });

    controller.start();
    await secondStarted;
    const cancelled = await controller.cancel();

    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.items[0]?.state).toBe("complete");
    expect(cancelled.items.slice(1).every((item) => item.state === "cancelled")).toBe(true);
    expect(cancelled.items.slice(1).every(
      (item) => item.nextAction.code === "RESTART_LOCAL_SESSION",
    )).toBe(true);
    expect(inspectSource).toHaveBeenCalledTimes(2);
    assertNoLocator(cancelled);
  });

  it("truthfully waits for an uninterruptible T-541 verification step before cancelling between steps", async () => {
    const fixture = await mixedCopiedPayloadFixture();
    const opened = await openedCollection([fixture.paths[0] ?? ""]);
    let releaseOpen: (() => void) | undefined;
    const openStarted = new Promise<void>((resolvePromise) => {
      releaseOpen = resolvePromise;
    });
    let finishOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolvePromise) => {
      finishOpen = resolvePromise;
    });
    const inspectSource = vi.fn(inspectUniversalIntakeWithSourceFactsV8);
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot: fixture.root,
        collectionIndexSha256: opened.indexSha256,
      }),
      core: {
        openCollection: async () => {
          releaseOpen?.();
          await openGate;
          return opened;
        },
        inspectSource,
        reverifyChild: reverifyFrom(opened),
      },
    });

    controller.start();
    await openStarted;
    let cancelSettled = false;
    const cancellation = controller.cancel().then((view) => {
      cancelSettled = true;
      return view;
    });
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    expect(cancelSettled).toBe(false);
    expect(controller.getView()).toMatchObject({
      phase: "running",
      cancellationBoundary: "between_bounded_verification_steps",
    });

    finishOpen?.();
    const cancelled = await cancellation;

    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.items[0]?.state).toBe("cancelled");
    expect(inspectSource).not.toHaveBeenCalled();
    expect(controller.getReport()).toMatchObject({
      outcome: "cancelled",
      cancellationBoundary: "between_bounded_verification_steps",
    });
  });

  it("withholds V8 results when a copied payload changes before post-inspection T-541 re-verification", async () => {
    const fixture = await mixedCopiedPayloadFixture();
    const opened = await openedCollection([fixture.paths[0] ?? ""]);
    const expected = opened.items[0];
    if (
      expected?.activeSourcePath === null ||
      expected?.activeSourcePath === undefined ||
      expected.receiptSha256 === null ||
      expected.workspaceSha256 === null
    ) {
      throw new Error("Expected a verified fixture item.");
    }
    const inspectSource = vi.fn(async (source: string, options: { signal?: AbortSignal } = {}) => {
      const result = await inspectUniversalIntakeWithSourceFactsV8(source, options);
      await writeFile(source, "changed-after-v8", "utf8");
      return result;
    });
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot: fixture.root,
        collectionIndexSha256: opened.indexSha256,
      }),
      core: {
        openCollection: () => Promise.resolve(opened),
        inspectSource,
        reverifyChild: async () => {
          const current = await inspectUniversalIntake(expected.activeSourcePath ?? "");
          if (current.receiptSha256 !== expected.receiptSha256) {
            throw new Error("T-541 copied payload changed.");
          }
          return {
            index: {
              receiptSha256: expected.receiptSha256 ?? "",
              workspaceSha256: expected.workspaceSha256 ?? "",
            },
            activeSourcePath: expected.activeSourcePath ?? "",
          };
        },
      },
    });

    controller.start();
    const terminal = await waitForTerminal(controller);

    expect(terminal).toMatchObject({
      phase: "complete_with_failures",
      items: [{
        state: "failed",
        failureCode: "INSPECTION_FAILED",
        families: [],
        facts: null,
        readiness: null,
        checklist: null,
        nextAction: { state: "required", code: "RESTART_LOCAL_SESSION" },
      }],
    });
    assertNoLocator(terminal);
  });

  it("fails closed when the process-owned collection input is unavailable", () => {
    const controller = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => null,
    });
    expect(controller.getView()).toMatchObject({
      phase: "not_ready",
      canStart: false,
      canCancel: false,
      reportAvailable: false,
      cancellationBoundary: "between_bounded_verification_steps",
    });
    let error: unknown;
    try {
      controller.start();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "COLLECTION_NOT_READY" });
  });
});
