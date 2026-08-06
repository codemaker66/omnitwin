import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import {
  domainSeparatedSha256,
  inspectUniversalIntake,
  toCanonicalJson,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalNativeCollectionAnalysisControllerV0 } from "../local-native-collection-analysis.js";
import {
  LOCAL_NATIVE_INTAKE_EVENT_V0,
  LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0,
  LocalNativeIntakeError,
  createLocalNativeIntakeControllerV0,
  openLocalNativeIntakeCollectionForAnalysisV0,
  verifyLocalNativeIntakeCollectionV0,
  type LocalNativeIntakeAdapterV0,
  type LocalNativeIntakeCollectionIndexV0,
  type LocalNativeIntakeEventV0,
  type LocalNativeIntakeViewV0,
  type LocalNativeIntakeWorkspacePortV0,
} from "../local-native-intake.js";
import {
  LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
  type CreateLocalIntakeWorkspaceControllerV0Options,
  type LocalIntakeWorkspaceDtoV0,
} from "../local-intake-workspace.js";
import type {
  NativeAdapterRequestV0,
  NativeOutputBoundaryResponseV0,
  NativePathComparisonRequestV0,
  NativePathComparisonResponseV0,
  NativeSourcePickerResponseV0,
  TrustedWindowsSourceSelectionEvidenceV0,
} from "../trusted-windows-native-source-basket.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SOURCE_PATH_EVIDENCE = Object.freeze({
  acquisition: "windows_native_picker_handle" as const,
  canonicalization: "final_path_by_handle" as const,
  inspectionMode: "read_only" as const,
  pathIdentityCheckedByHandle: true as const,
  reparseInspectionScope: "volume_root_through_complete_selection" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
  inventoryComplete: true as const,
  regularFilesOnly: true as const,
});

const DROPPED_SOURCE_PATH_EVIDENCE = Object.freeze({
  ...SOURCE_PATH_EVIDENCE,
  acquisition: "windows_native_drop_cfhdrop_then_handle_open" as const,
});

const OUTPUT_PATH_EVIDENCE = Object.freeze({
  acquisition: "trusted_launcher_output_configuration" as const,
  canonicalization: "resolved_existing_ancestor_and_validated_suffix" as const,
  inspectionMode: "read_only" as const,
  reparseInspectionScope: "volume_root_through_output_parent" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

function canonicalWindowsPath(path: string): string {
  const absolute = resolve(path);
  return `${absolute.slice(0, 1).toUpperCase()}${absolute.slice(1)}`;
}

function selection(
  path: string,
  seed: number,
  bytes: number,
  acquisition: "picker" | "drop" = "picker",
): TrustedWindowsSourceSelectionEvidenceV0 {
  const identity = {
    volumeSerialNumberHex: "A1B2C3D4",
    fileIdHex: seed.toString(16).toUpperCase().padStart(32, "0"),
  };
  return {
    kind: "file",
    canonicalAbsolutePath: canonicalWindowsPath(path),
    resolvedAbsolutePath: canonicalWindowsPath(path),
    byteCountDecimal: String(bytes),
    fileCount: 1,
    identity,
    inventoryFileIdentities: [identity],
    pathEvidence: acquisition === "drop" ? DROPPED_SOURCE_PATH_EVIDENCE : SOURCE_PATH_EVIDENCE,
  };
}

function comparePaths(request: NativePathComparisonRequestV0): NativePathComparisonResponseV0 {
  const left = request.leftCanonicalAbsolutePath.toLocaleLowerCase("en-US");
  const right = request.rightCanonicalAbsolutePath.toLocaleLowerCase("en-US");
  const relation = left === right
    ? "same"
    : left.startsWith(`${right}\\`)
      ? "left_descendant"
      : right.startsWith(`${left}\\`)
        ? "left_ancestor"
        : "disjoint";
  return {
    schemaVersion: "trusted-windows-native-path-comparison.v0",
    requestRef: request.requestRef,
    status: "compared",
    comparisonAuthority: "windows_compare_string_ordinal_ignore_case",
    relation,
  };
}

class FixtureAdapter implements LocalNativeIntakeAdapterV0 {
  readonly selections: readonly TrustedWindowsSourceSelectionEvidenceV0[];
  readonly outputRoot: string;
  closeCount = 0;

  constructor(
    selections: readonly TrustedWindowsSourceSelectionEvidenceV0[],
    outputRoot: string,
  ) {
    this.selections = selections;
    this.outputRoot = canonicalWindowsPath(outputRoot);
  }

  pickFiles(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_files",
      status: "selected",
      selections: this.selections,
    });
  }

  pickFolder(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_folder",
      status: "cancelled",
    });
  }

  dropSources(request: NativeAdapterRequestV0): Promise<NativeSourcePickerResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "add_dropped",
      status: "selected",
      selections: this.selections,
    });
  }

  resolveOutputBoundary(request: NativeAdapterRequestV0): Promise<NativeOutputBoundaryResponseV0> {
    return Promise.resolve({
      schemaVersion: "trusted-windows-native-adapter-response.v0",
      requestRef: request.requestRef,
      operation: "start",
      status: "resolved",
      outputBoundary: {
        canonicalAbsolutePath: this.outputRoot,
        resolvedAbsolutePath: this.outputRoot,
        pathEvidence: OUTPUT_PATH_EVIDENCE,
      },
    });
  }

  compareCanonicalPaths(
    request: NativePathComparisonRequestV0,
  ): Promise<NativePathComparisonResponseV0> {
    return Promise.resolve(comparePaths(request));
  }

  closeAndConfirmNoLiveScopes(): Promise<void> {
    this.closeCount += 1;
    return Promise.resolve();
  }
}

function deterministicRandomBytes(): (size: number) => Uint8Array {
  let invocation = 0;
  return (size) => {
    invocation += 1;
    return Uint8Array.from({ length: size }, (_, index) => (invocation + index + 1) % 256);
  };
}

function event(
  view: LocalNativeIntakeViewV0,
  action: LocalNativeIntakeEventV0["action"],
  extra: { readonly confirmation?: string } = {},
): unknown {
  if (view.nextEvent === null) throw new Error("The view has no event binding.");
  if (action === "start") {
    return {
      ...view.nextEvent,
      action,
      confirmation: extra.confirmation ?? LOCAL_NATIVE_INTAKE_START_CONFIRMATION_V0,
    };
  }
  return { ...view.nextEvent, action };
}

async function waitForTerminal(
  controller: ReturnType<typeof createLocalNativeIntakeControllerV0>,
): Promise<LocalNativeIntakeViewV0> {
  for (let attempt = 0; attempt < 50_000; attempt += 1) {
    const view = controller.getView();
    if (view.phase !== "importing") return view;
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  throw new Error("The local native intake did not settle.");
}

async function waitForAnalysisTerminal(
  controller: ReturnType<typeof createLocalNativeCollectionAnalysisControllerV0>,
) {
  for (let attempt = 0; attempt < 50_000; attempt += 1) {
    const view = controller.getView();
    if (view.phase !== "running") return view;
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  }
  throw new Error("The collection analysis did not settle.");
}

async function fixture(): Promise<{
  readonly root: string;
  readonly sources: readonly [string, string];
  readonly output: string;
  readonly receipts: readonly [FoundryUniversalIntakeReceipt, FoundryUniversalIntakeReceipt];
}> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-local-native-intake-"));
  roots.push(root);
  const first = join(root, "private-alpha.obj");
  const second = join(root, "private-beta.glb");
  const output = join(root, "local-output");
  await writeFile(first, "alpha", "utf8");
  await writeFile(second, "beta-data", "utf8");
  await mkdir(output);
  return {
    root,
    sources: [first, second],
    output,
    receipts: [await inspectUniversalIntake(first), await inspectUniversalIntake(second)],
  };
}

function storedDto(
  receipt: FoundryUniversalIntakeReceipt,
  requestId: string,
  workspaceSha256 = "a".repeat(64),
): LocalIntakeWorkspaceDtoV0 {
  return {
    schemaVersion: "omnitwin.foundry.local-intake-workspace-controller.v0",
    state: "stored",
    authority: "none",
    operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    configured: true,
    receiptSha256: receipt.receiptSha256,
    requestId,
    message: "Stored.",
    failureCode: null,
    progress: {
      copiedFileCount: receipt.summary.fileCount,
      fileCount: receipt.summary.fileCount,
      copiedBytes: receipt.summary.totalBytes,
      totalBytes: receipt.summary.totalBytes,
    },
    workspace: {
      workspaceSha256,
      fileCount: receipt.summary.fileCount,
      totalBytes: receipt.summary.totalBytes,
      truth: {
        pendingReview: receipt.summary.fileCount,
        admitted: 0,
        excluded: 0,
        captured: 0,
        enhancedCaptured: 0,
        generatedCinematic: 0,
        conceptImagination: 0,
      },
    },
  };
}

class ImmediateWorkspace implements LocalNativeIntakeWorkspacePortV0 {
  receipt: FoundryUniversalIntakeReceipt | null = null;
  requestId: string | null = null;

  initialize(): Promise<LocalIntakeWorkspaceDtoV0> {
    return Promise.resolve(this.snapshot());
  }

  bindReceipt(receipt: FoundryUniversalIntakeReceipt): void {
    this.receipt = structuredClone(receipt);
  }

  snapshot(): LocalIntakeWorkspaceDtoV0 {
    if (this.receipt !== null && this.requestId !== null) {
      return storedDto(this.receipt, this.requestId);
    }
    return {
      schemaVersion: "omnitwin.foundry.local-intake-workspace-controller.v0",
      state: "ready",
      authority: "none",
      operation: null,
      configured: true,
      receiptSha256: this.receipt?.receiptSha256 ?? null,
      requestId: null,
      message: "Ready.",
      failureCode: null,
      progress: null,
      workspace: null,
    };
  }

  start(input: unknown): Promise<LocalIntakeWorkspaceDtoV0> {
    if (
      this.receipt === null ||
      input === null ||
      typeof input !== "object" ||
      !("requestId" in input) ||
      typeof input.requestId !== "string"
    ) {
      throw new Error("Invalid fake workspace start.");
    }
    this.requestId = input.requestId;
    return Promise.resolve(storedDto(this.receipt, this.requestId));
  }

  cancel(_requestId: string): Promise<LocalIntakeWorkspaceDtoV0 | null> {
    return Promise.resolve(this.snapshot());
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe("local native multi-source intake V0", () => {
  it("copies two real selected sources into independent T541 children and reopens the collection", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([
      selection(data.sources[0], 1, 5),
      selection(data.sources[1], 2, 9),
    ], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const selected = await controller.dispatch(event(controller.getView(), "add_files"));
    expect(selected.status).toBe("updated");
    expect(selected.code).toBe("ITEMS_ADDED");
    expect(selected.view.sources.map((source) => source.label)).toEqual(["File 1", "File 2"]);
    expect(selected.view.nextEvent?.schemaVersion).toBe(LOCAL_NATIVE_INTAKE_EVENT_V0);
    expect(JSON.stringify(selected)).not.toContain("private-alpha");
    expect(JSON.stringify(selected)).not.toContain(canonicalWindowsPath(data.root));

    const accepted = await controller.dispatch(event(selected.view, "start"));
    expect(accepted.status).toBe("started");
    expect(accepted.code).toBe("IMPORT_STAGED");
    expect(accepted.view.phase).toBe("importing");
    expect(accepted.view.reportAvailable).toBe(false);

    const terminal = await waitForTerminal(controller);
    expect(terminal.phase).toBe("complete");
    expect(terminal.sources.map((source) => source.state)).toEqual(["stored", "stored"]);
    expect(terminal.sources.map((source) => source.truth?.pendingReview)).toEqual([1, 1]);
    expect(adapter.closeCount).toBe(1);

    const report = controller.getReport();
    expect(report?.outcome).toBe("complete");
    expect(report?.collectionIndexStored).toBe(true);
    expect(report?.totals).toMatchObject({ storedRoots: 2, storedFiles: 2, storedBytes: 14 });
    const publicJson = JSON.stringify(report);
    expect(publicJson).not.toContain("private-alpha");
    expect(publicJson).not.toContain("private-beta");
    expect(publicJson).not.toContain(canonicalWindowsPath(data.root));
    expect(publicJson).not.toMatch(/[a-f0-9]{64}/u);

    const batches = (await readdir(data.output, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("venviewer-intake-batch-"));
    expect(batches).toHaveLength(1);
    const collectionRoot = join(data.output, batches[0]?.name ?? "missing");
    const verified = await verifyLocalNativeIntakeCollectionV0(collectionRoot);
    expect(verified.storedChildrenVerified).toBe(2);
    expect(verified.index.items.map((item) => item.childDirectory)).toEqual([
      "item-0001",
      "item-0002",
    ]);
    expect(controller.getCollectionAnalysisInputV0()).toEqual({
      collectionRoot,
      collectionIndexSha256: verified.index.indexSha256,
    });
    await expect(openLocalNativeIntakeCollectionForAnalysisV0({
      collectionRoot,
      collectionIndexSha256: "0".repeat(64),
    })).rejects.toMatchObject({ code: "COLLECTION_INVALID" });
    const opened = await openLocalNativeIntakeCollectionForAnalysisV0({
      collectionRoot,
      collectionIndexSha256: verified.index.indexSha256,
    });
    expect(opened.items.map((item) => item.verification)).toEqual(["verified", "verified"]);
    expect(opened.items.every((item) => item.activeSourcePath !== null)).toBe(true);
    const analysis = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => controller.getCollectionAnalysisInputV0(),
    });
    expect(analysis.getView().phase).toBe("ready");
    analysis.start();
    const analyzed = await waitForAnalysisTerminal(analysis);
    expect(analyzed.phase).toBe("complete");
    expect(analyzed.items.map((item) => item.state)).toEqual(["complete", "complete"]);
    expect(analyzed.items.flatMap((item) => item.families.map((family) => family.inputType)))
      .toEqual(expect.arrayContaining(["obj", "glb_gltf"]));
    expect(analyzed.items.every((item) => item.truth?.pendingReview === 1)).toBe(true);
    await analysis.close();
    const indexJson = await readFile(join(collectionRoot, "collection-index.json"), "utf8");
    expect(indexJson).not.toContain("private-alpha");
    expect(indexJson).not.toContain("private-beta");
    expect(indexJson).not.toContain(canonicalWindowsPath(data.root));
    const legacyIndex = JSON.parse(indexJson) as Record<string, unknown>;
    legacyIndex.mode = "ordinary_windows_picker_node_path_reopen_preview";
    const { indexSha256: _discardedDigest, ...legacyPayload } = legacyIndex;
    legacyIndex.indexSha256 = domainSeparatedSha256(
      "OMNITWIN.FOUNDRY.LOCAL_NATIVE_INTAKE_COLLECTION_INDEX.V0",
      toCanonicalJson(legacyPayload),
    );
    await writeFile(
      join(collectionRoot, "collection-index.json"),
      `${JSON.stringify(legacyIndex)}\n`,
      "utf8",
    );
    const legacyVerified = await verifyLocalNativeIntakeCollectionV0(collectionRoot);
    expect(legacyVerified.index.mode).toBe("ordinary_windows_picker_node_path_reopen_preview");
    expect(await readFile(data.sources[0], "utf8")).toBe("alpha");
    expect(await readFile(data.sources[1], "utf8")).toBe("beta-data");
    await writeFile(
      join(collectionRoot, "item-0001", "payload", "private-alpha.obj"),
      "tampered",
      "utf8",
    );
    await expect(verifyLocalNativeIntakeCollectionV0(collectionRoot)).rejects.toMatchObject({
      code: "COLLECTION_INVALID",
    });
    const isolated = await openLocalNativeIntakeCollectionForAnalysisV0({
      collectionRoot,
      collectionIndexSha256: legacyVerified.index.indexSha256,
    });
    expect(isolated.items.map((item) => [item.verification, item.failureCode])).toEqual([
      ["failed", "CHILD_VERIFICATION_FAILED"],
      ["verified", null],
    ]);
    const damagedAnalysis = createLocalNativeCollectionAnalysisControllerV0({
      resolveInput: () => ({
        collectionRoot,
        collectionIndexSha256: legacyVerified.index.indexSha256,
      }),
    });
    damagedAnalysis.start();
    const damagedResult = await waitForAnalysisTerminal(damagedAnalysis);
    expect(damagedResult.phase).toBe("complete_with_failures");
    expect(damagedResult.items.map((item) => [item.state, item.failureCode])).toEqual([
      ["failed", "CHILD_VERIFICATION_FAILED"],
      ["complete", null],
    ]);
    expect(damagedResult.items[0]).toMatchObject({
      blockers: { codes: expect.arrayContaining(["COPIED_PAYLOAD_VERIFICATION_FAILED"]) },
      nextAction: { state: "required", code: "RESTART_LOCAL_INTAKE" },
    });
    await damagedAnalysis.close();
    await controller.stop();
    expect(adapter.closeCount).toBe(1);
  });

  it("accepts a native drop through the same neutral path-free basket", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([
      selection(data.sources[0], 7, 5, "drop"),
      selection(data.sources[1], 8, 9, "drop"),
    ], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
    });

    const dropped = await controller.dispatch(event(controller.getView(), "add_dropped"));

    expect(dropped).toMatchObject({ status: "updated", code: "ITEMS_ADDED" });
    expect(dropped.view).toMatchObject({
      mode: "ordinary_windows_native_selection_node_path_reopen_preview",
      filesystemModel: "node_path_reopen_after_native_selection",
      nativeCustodyClaimed: false,
      sources: [
        { label: "File 1", labelSafety: "generated_kind_and_position_only" },
        { label: "File 2", labelSafety: "generated_kind_and_position_only" },
      ],
    });
    expect(JSON.stringify(dropped)).not.toContain(data.sources[0]);
    expect(JSON.stringify(dropped)).not.toContain(data.sources[1]);
  });

  it("isolates an inspection failure and passes exact private contexts to one workspace", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([
      selection(data.sources[0], 11, 5),
      selection(data.sources[1], 12, 9),
    ], data.output);
    const contexts: CreateLocalIntakeWorkspaceControllerV0Options[] = [];
    let committed: LocalNativeIntakeCollectionIndexV0 | null = null;
    const collectionRoot = join(data.output, "neutral-batch");
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        inspectSource: (sourceRoot) => sourceRoot === canonicalWindowsPath(data.sources[0])
          ? Promise.resolve(structuredClone(data.receipts[0]))
          : Promise.reject(new Error("private failure text")),
        createBatchRoot: async () => {
          await mkdir(collectionRoot);
          return collectionRoot;
        },
        createWorkspaceController: (options) => {
          contexts.push(options);
          return new ImmediateWorkspace();
        },
        commitCollectionIndex: (_root, index) => {
          committed = structuredClone(index);
          return Promise.resolve();
        },
      },
    });

    const selected = await controller.dispatch(event(controller.getView(), "add_files"));
    await controller.dispatch(event(selected.view, "start"));
    const terminal = await waitForTerminal(controller);

    expect(terminal.sources.map((source) => source.state)).toEqual(["stored", "failed"]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.trustedContext).toEqual({
      sourceRoot: canonicalWindowsPath(data.sources[0]),
      workspaceDirectory: join(collectionRoot, "item-0001"),
    });
    expect(controller.getReport()?.items.map((item) => item.failure)).toEqual([
      null,
      "inspection_failed",
    ]);
    expect(JSON.stringify(controller.getReport())).not.toContain("private failure text");
    expect(committed).not.toBeNull();
    expect((committed as LocalNativeIntakeCollectionIndexV0 | null)?.items.map((item) => item.status))
      .toEqual(["stored", "failed"]);
    expect((committed as LocalNativeIntakeCollectionIndexV0 | null)?.items[1]?.failureCode)
      .toBe("SOURCE_INSPECTION_FAILED");
  });

  it("returns from start before inspection settles", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 21, 5)], data.output);
    let releaseInspection = (_receipt: FoundryUniversalIntakeReceipt): void => undefined;
    const inspection = new Promise<FoundryUniversalIntakeReceipt>((resolvePromise) => {
      releaseInspection = resolvePromise;
    });
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        inspectSource: () => inspection,
        createWorkspaceController: () => new ImmediateWorkspace(),
        createBatchRoot: async () => {
          const root = join(data.output, "async-batch");
          await mkdir(root);
          return root;
        },
        commitCollectionIndex: () => Promise.resolve(),
      },
    });

    const selected = await controller.dispatch(event(controller.getView(), "add_files"));
    const startResult = await controller.dispatch(event(selected.view, "start"));
    expect(startResult.view.phase).toBe("importing");
    expect(startResult.view.sources[0]?.state).toBe("queued");
    expect(controller.getReport()).toBeNull();
    releaseInspection(structuredClone(data.receipts[0]));
    expect((await waitForTerminal(controller)).sources[0]?.state).toBe("stored");
  });

  it("cancels the active child, preserves a completed child, and indexes every terminal item", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([
      selection(data.sources[0], 31, 5),
      selection(data.sources[1], 32, 9),
    ], data.output);
    let created = 0;
    let releaseSecond = (_dto: LocalIntakeWorkspaceDtoV0): void => undefined;
    let secondReceipt: FoundryUniversalIntakeReceipt | null = null;
    let secondRequestId: string | null = null;
    let secondCancelled = false;
    let committed: LocalNativeIntakeCollectionIndexV0 | null = null;
    const secondCompletion = new Promise<LocalIntakeWorkspaceDtoV0>((resolvePromise) => {
      releaseSecond = resolvePromise;
    });
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        inspectSource: (sourceRoot) => Promise.resolve(structuredClone(
          sourceRoot === canonicalWindowsPath(data.sources[0])
            ? data.receipts[0]
            : data.receipts[1],
        )),
        createBatchRoot: async () => {
          const root = join(data.output, "cancel-batch");
          await mkdir(root);
          return root;
        },
        createWorkspaceController: () => {
          created += 1;
          if (created === 1) return new ImmediateWorkspace();
          return {
            initialize: () => Promise.resolve({
              ...storedDto(data.receipts[1], "0".repeat(32)),
              state: "ready" as const,
              operation: null,
              requestId: null,
              progress: null,
              workspace: null,
            }),
            bindReceipt: (receipt) => { secondReceipt = structuredClone(receipt); },
            snapshot: () => ({
              ...storedDto(data.receipts[1], "0".repeat(32)),
              state: "copying" as const,
              workspace: null,
            }),
            start: (input) => {
              if (isRequest(input)) secondRequestId = input.requestId;
              return secondCompletion;
            },
            cancel: (requestId) => {
              secondCancelled = true;
              const receipt = secondReceipt;
              if (receipt === null) throw new Error("The second receipt was not bound.");
              const cancelled: LocalIntakeWorkspaceDtoV0 = {
                ...storedDto(receipt, requestId),
                state: "failed",
                failureCode: "LOCAL_INTAKE_WORKSPACE_CANCELLED",
                workspace: null,
              };
              releaseSecond(cancelled);
              return Promise.resolve(cancelled);
            },
            close: () => Promise.resolve(),
          } satisfies LocalNativeIntakeWorkspacePortV0;
        },
        commitCollectionIndex: (_root, index) => {
          committed = structuredClone(index);
          return Promise.resolve();
        },
      },
    });

    const selected = await controller.dispatch(event(controller.getView(), "add_files"));
    await controller.dispatch(event(selected.view, "start"));
    for (let attempt = 0; attempt < 1_000 && secondRequestId === null; attempt += 1) {
      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    }
    expect(secondRequestId).toMatch(/^[a-f0-9]{32}$/u);
    const cancelled = await controller.cancelActive();

    expect(secondCancelled).toBe(true);
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.reportAvailable).toBe(true);
    expect(cancelled.durableOutcome).toBe("collection_index_stored");
    expect(cancelled.sources.map((source) => source.state)).toEqual(["stored", "cancelled"]);
    expect(controller.getReport()?.outcome).toBe("cancelled");
    expect(controller.getReport()?.items.map((item) => item.status)).toEqual([
      "stored",
      "cancelled",
    ]);
    expect((committed as LocalNativeIntakeCollectionIndexV0 | null)?.items.map((item) => item.status))
      .toEqual(["stored", "cancelled"]);
  });

  it("terminalizes a rejected duplicate selection and closes its retained adapter state", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 35, 5)], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
    });

    const added = await controller.dispatch(event(controller.getView(), "add_files"));
    const rejected = await controller.dispatch(event(added.view, "add_files"));

    expect(rejected).toMatchObject({
      schemaVersion: "omnitwin.foundry.local-native-intake-action-result.v0",
      status: "selection_rejected",
      code: "SELECTION_REJECTED",
    });
    expect(rejected.view.phase).toBe("failed");
    expect(rejected.view.nextEvent).toBeNull();
    expect(rejected.view.durableOutcome).toBe("not_started");
    expect(adapter.closeCount).toBe(1);
    expect(JSON.stringify(rejected)).not.toContain("DUPLICATE_SOURCE");
    await expect(controller.dispatch(event(added.view, "cancel"))).rejects.toMatchObject({
      code: "CONTROLLER_TERMINAL",
    });
  });

  it("reports picker cancellation without pretending an item was added", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 36, 5)], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
    });

    const result = await controller.dispatch(event(controller.getView(), "add_folder"));

    expect(result.status).toBe("picker_cancelled");
    expect(result.code).toBe("PICKER_CANCELLED");
    expect(result.view.phase).toBe("selecting");
    expect(result.view.sources).toEqual([]);
    expect(result.view.nextEvent).not.toBeNull();
  });

  it("maps an adapter exception to one path-free terminal action result", async () => {
    let closeCount = 0;
    const adapter: LocalNativeIntakeAdapterV0 = {
      pickFiles: () => Promise.reject(new Error("C:\\Private\\native detail")),
      pickFolder: () => Promise.reject(new Error("unused")),
      dropSources: () => Promise.reject(new Error("unused")),
      resolveOutputBoundary: () => Promise.reject(new Error("unused")),
      compareCanonicalPaths: () => Promise.reject(new Error("unused")),
      closeAndConfirmNoLiveScopes: () => {
        closeCount += 1;
        return Promise.resolve();
      },
    };
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
    });

    const result = await controller.dispatch(event(controller.getView(), "add_files"));

    expect(result.status).toBe("adapter_failed");
    expect(result.code).toBe("PICKER_FAILED");
    expect(result.view.phase).toBe("failed");
    expect(result.view.nextEvent).toBeNull();
    expect(closeCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Private");
    expect(JSON.stringify(result)).not.toContain("native detail");
  });

  it("turns a synchronous child-controller factory failure into a durable terminal item", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 37, 5)], data.output);
    let committed: LocalNativeIntakeCollectionIndexV0 | null = null;
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        inspectSource: () => Promise.resolve(structuredClone(data.receipts[0])),
        createBatchRoot: async () => {
          const root = join(data.output, "factory-failure-batch");
          await mkdir(root);
          return root;
        },
        createWorkspaceController: () => {
          throw new Error(`factory leaked ${data.sources[0]}`);
        },
        commitCollectionIndex: (_root, index) => {
          committed = structuredClone(index);
          return Promise.resolve();
        },
      },
    });

    const added = await controller.dispatch(event(controller.getView(), "add_files"));
    await controller.dispatch(event(added.view, "start"));
    const terminal = await waitForTerminal(controller);

    expect(terminal.phase).toBe("failed");
    expect(terminal.reportAvailable).toBe(true);
    expect(terminal.durableOutcome).toBe("collection_index_stored");
    expect(terminal.totals).toMatchObject({ storedRoots: 0, failedRoots: 1 });
    expect(controller.getReport()).toMatchObject({
      collectionIndexStored: true,
      totals: { storedRoots: 0, failedRoots: 1 },
    });
    expect(JSON.stringify(controller.getReport())).not.toContain(data.sources[0]);
    expect((committed as LocalNativeIntakeCollectionIndexV0 | null)?.items[0])
      .toMatchObject({ status: "failed", failureCode: "WORKSPACE_COPY_FAILED" });
  });

  it("keeps stored-child counts honest when collection-index publication fails", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 38, 5)], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        inspectSource: () => Promise.resolve(structuredClone(data.receipts[0])),
        createBatchRoot: async () => {
          const root = join(data.output, "index-failure-batch");
          await mkdir(root);
          return root;
        },
        createWorkspaceController: () => new ImmediateWorkspace(),
        commitCollectionIndex: () => Promise.reject(new Error("index write failed")),
      },
    });

    const added = await controller.dispatch(event(controller.getView(), "add_files"));
    await controller.dispatch(event(added.view, "start"));
    const terminal = await waitForTerminal(controller);

    expect(terminal.phase).toBe("failed");
    expect(terminal.durableOutcome).toBe("collection_index_failed");
    expect(terminal.reportAvailable).toBe(true);
    expect(terminal.totals).toMatchObject({ storedRoots: 1, failedRoots: 0 });
    expect(terminal.message).toContain("collection index was not stored");
    expect(controller.getReport()).toMatchObject({
      outcome: "complete",
      collectionIndexStored: false,
      totals: { storedRoots: 1 },
    });
  });

  it("settles every item when collection-root creation fails before child construction", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([
      selection(data.sources[0], 39, 5),
      selection(data.sources[1], 40, 9),
    ], data.output);
    let childCreated = false;
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
      core: {
        createBatchRoot: () => Promise.reject(new Error("root unavailable")),
        createWorkspaceController: () => {
          childCreated = true;
          return new ImmediateWorkspace();
        },
      },
    });

    const added = await controller.dispatch(event(controller.getView(), "add_files"));
    await controller.dispatch(event(added.view, "start"));
    const terminal = await waitForTerminal(controller);

    expect(childCreated).toBe(false);
    expect(terminal.phase).toBe("failed");
    expect(terminal.durableOutcome).toBe("collection_index_failed");
    expect(terminal.sources.map((source) => source.state)).toEqual(["failed", "failed"]);
    expect(controller.getReport()?.items).toHaveLength(2);
  });

  it("shares an active close, retries after failure, and caches the successful retry", async () => {
    let closeCount = 0;
    let rejectFirstClose: (error: Error) => void = () => {
      throw new Error("The first close attempt was not initialized.");
    };
    const firstAdapterClose = new Promise<void>((_resolveClose, rejectClose) => {
      rejectFirstClose = rejectClose;
    });
    const adapter: LocalNativeIntakeAdapterV0 = {
      pickFiles: () => Promise.reject(new Error("unused")),
      pickFolder: () => Promise.reject(new Error("unused")),
      dropSources: () => Promise.reject(new Error("unused")),
      resolveOutputBoundary: () => Promise.reject(new Error("unused")),
      compareCanonicalPaths: () => Promise.reject(new Error("unused")),
      closeAndConfirmNoLiveScopes: () => {
        closeCount += 1;
        return closeCount === 1 ? firstAdapterClose : Promise.resolve();
      },
    };
    const controller = createLocalNativeIntakeControllerV0({ adapter });

    const first = controller.close();
    const concurrent = controller.stop();
    expect(concurrent).toBe(first);
    expect(closeCount).toBe(1);

    rejectFirstClose(new Error("fixture helper still live"));
    await expect(first).rejects.toMatchObject({ code: "ADAPTER_CLOSE_FAILED" });
    expect(closeCount).toBe(1);

    const retry = controller.close();
    expect(retry).not.toBe(first);
    await expect(retry).resolves.toBeUndefined();
    expect(closeCount).toBe(2);

    const idempotent = controller.stop();
    expect(idempotent).toBe(retry);
    await expect(idempotent).resolves.toBeUndefined();
    expect(closeCount).toBe(2);
  });

  it("rejects path-bearing, stale, forged, and incorrectly confirmed browser events", async () => {
    const data = await fixture();
    const adapter = new FixtureAdapter([selection(data.sources[0], 41, 5)], data.output);
    const controller = createLocalNativeIntakeControllerV0({
      adapter,
      randomBytes: deterministicRandomBytes(),
    });
    const first = controller.getView();

    await expect(controller.dispatch({
      ...event(first, "add_files") as Record<string, unknown>,
      path: canonicalWindowsPath(data.sources[0]),
    })).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(controller.dispatch({
      ...event(first, "add_files") as Record<string, unknown>,
      eventToken: `evt_${"f".repeat(64)}`,
    })).rejects.toMatchObject({ code: "FORGED_EVENT" });

    const selected = await controller.dispatch(event(first, "add_files"));
    await expect(controller.dispatch({
      ...first.nextEvent,
      action: "clear",
    })).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(controller.dispatch({
      ...selected.view.nextEvent,
      action: "remove",
      basketPosition: 1,
    })).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(controller.dispatch(event(first, "cancel"))).rejects.toMatchObject({
      code: "STALE_EVENT",
    });
    await expect(controller.dispatch(event(selected.view, "start", {
      confirmation: "copy_whatever_the_browser_named",
    }))).rejects.toBeInstanceOf(LocalNativeIntakeError);
    await expect(controller.dispatch(event(selected.view, "start", {
      confirmation: "copy_whatever_the_browser_named",
    }))).rejects.toMatchObject({ code: "INVALID_EVENT" });

    const json = JSON.stringify(selected.view);
    expect(json).not.toContain(data.sources[0]);
    expect(json).not.toContain(win32.basename(data.sources[0]));
    expect(json).not.toContain("sourceRef");
    expect(json).not.toContain("receiptSha256");
    expect(json).not.toContain("workspaceSha256");
  });
});

function isRequest(value: unknown): value is { readonly requestId: string } {
  return value !== null && typeof value === "object" &&
    "requestId" in value && typeof value.requestId === "string";
}
