import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_CAPABILITIES_V0,
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0,
  compileFoundryLocalIntakeWorkspaceIntentV0,
  compileGuidedAdmissionDraft,
  inspectUniversalIntake,
  type FoundryGuidedAdmissionDraft,
  type FoundryLocalIntakeWorkspaceIndexV0,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0,
  LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
  LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
  LocalIntakeWorkspaceError,
  createLocalIntakeWorkspaceControllerV0,
  parseLocalIntakeWorkspaceDeleteRequestV0,
  parseLocalIntakeWorkspaceStartRequestV0,
  parseLocalIntakeWorkspaceStatusRequestV0,
  type LocalIntakeWorkspaceCoreHooksV0,
  type LocalIntakeWorkspaceCoreStoredV0,
  type LocalIntakeWorkspaceTruthDtoV0,
} from "../local-intake-workspace.js";

const REQUEST_A = "0123456789abcdef0123456789abcdef";
const REQUEST_B = "fedcba9876543210fedcba9876543210";
const WORKSPACE_SHA256 = "b".repeat(64);
const CREATED_AT = "2026-07-22T10:30:00.000Z";
const cleanup: string[] = [];

interface Fixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly workspaceDirectory: string;
  readonly receipt: FoundryUniversalIntakeReceipt;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  let reject = (_reason: unknown): void => undefined;
  const promise = new Promise<T>((accept, rejectPromise) => {
    resolve = accept;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
  vi.restoreAllMocks();
});

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omnitwin-local-intake-controller-"));
  cleanup.push(root);
  const sourceRoot = join(root, "selected-intake");
  const workspaceDirectory = join(root, "app-owned-workspace");
  await mkdir(sourceRoot);
  await writeFile(
    join(sourceRoot, "capture.e57"),
    Buffer.from("ASTM-E57\0local-workspace", "ascii"),
  );
  await writeFile(join(sourceRoot, "notes.txt"), Buffer.from("private notes", "utf8"));
  return {
    root,
    sourceRoot,
    workspaceDirectory,
    receipt: await inspectUniversalIntake(sourceRoot),
  };
}

function guidedDraft(
  receipt: FoundryUniversalIntakeReceipt,
): FoundryGuidedAdmissionDraft {
  return compileGuidedAdmissionDraft(receipt, {
    schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "local-intake-controller-test",
    reviewedAt: CREATED_AT,
    reviewedBy: "local-operator",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: receipt.files.map((file) => file.path === "capture.e57"
      ? {
          action: "admit" as const,
          path: file.path,
          inputType: "generic_e57" as const,
          role: "raw_capture" as const,
          formatDecision: "accept_detector" as const,
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        }
      : {
          action: "exclude" as const,
          path: file.path,
          reason: "provenance_unknown" as const,
        }),
  });
}

function truthSummary(
  index: FoundryLocalIntakeWorkspaceIndexV0,
): LocalIntakeWorkspaceTruthDtoV0 {
  return {
    pendingReview: index.truth.filter((entry) => entry.state === "pending").length,
    admitted: index.truth.filter((entry) => entry.state === "admitted").length,
    excluded: index.truth.filter((entry) => entry.state === "excluded").length,
    captured: index.truth.filter(
      (entry) => entry.state === "admitted" && entry.provenanceClass === "captured",
    ).length,
    enhancedCaptured: index.truth.filter(
      (entry) =>
        entry.state === "admitted" && entry.provenanceClass === "enhanced_captured",
    ).length,
    generatedCinematic: index.truth.filter(
      (entry) =>
        entry.state === "admitted" && entry.provenanceClass === "generated_cinematic",
    ).length,
    conceptImagination: index.truth.filter(
      (entry) =>
        entry.state === "admitted" && entry.provenanceClass === "concept_imagination",
    ).length,
  };
}

function fakeStored(
  receipt: FoundryUniversalIntakeReceipt,
  admissionDraft: FoundryGuidedAdmissionDraft | null = null,
): LocalIntakeWorkspaceCoreStoredV0 {
  const workspaceId = `local-${receipt.receiptSha256.slice(0, 24)}`;
  const intent = compileFoundryLocalIntakeWorkspaceIntentV0({
    workspaceId,
    createdAt: CREATED_AT,
    receipt,
    admissionDraft,
  });
  const index: FoundryLocalIntakeWorkspaceIndexV0 = {
    schemaVersion: FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0,
    workspaceId,
    intentSha256: intent.intentSha256,
    receiptSha256: receipt.receiptSha256,
    source: {
      kind: receipt.source.kind,
      label: receipt.source.label,
      activeSourceRelativePath: `payload/${receipt.source.label}`,
    },
    fileCount: receipt.summary.fileCount,
    totalBytes: receipt.summary.totalBytes,
    evidenceFiles: [],
    payloadFiles: receipt.files.map((file) => ({
      receiptPath: file.path,
      workspacePath: `payload/${receipt.source.label}/${file.path}`,
      sizeBytes: file.sizeBytes,
      modifiedAt: CREATED_AT,
      sha256: file.sha256,
    })),
    truth: intent.truth,
    sourceVerification: {
      beforeReceiptSha256: receipt.receiptSha256,
      afterReceiptSha256: receipt.receiptSha256,
      workspaceReceiptSha256: receipt.receiptSha256,
      exactReceiptMatch: true,
    },
    authority: "none",
    capabilities: FOUNDRY_LOCAL_INTAKE_WORKSPACE_CAPABILITIES_V0,
    commitMarker: "workspace_index_written_after_full_verification",
    workspaceSha256: WORKSPACE_SHA256,
  };
  return {
    index,
    receiptSha256: receipt.receiptSha256,
    workspace: {
      workspaceSha256: WORKSPACE_SHA256,
      fileCount: receipt.summary.fileCount,
      totalBytes: receipt.summary.totalBytes,
      truth: truthSummary(index),
    },
  };
}

function coreHooks(
  stored: LocalIntakeWorkspaceCoreStoredV0,
  overrides: Partial<LocalIntakeWorkspaceCoreHooksV0> = {},
): LocalIntakeWorkspaceCoreHooksV0 {
  return {
    inspect: vi.fn(() => Promise.resolve({ kind: "missing" as const })),
    start: vi.fn(() => Promise.resolve(stored)),
    resume: vi.fn(() => Promise.resolve(stored)),
    delete: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function expectControllerCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LocalIntakeWorkspaceError);
    expect((error as LocalIntakeWorkspaceError).code).toBe(code);
    return;
  }
  throw new Error(`expected controller error ${code}`);
}

describe("local intake workspace controller", () => {
  it("strictly parses path-free request bodies and exact confirmations", () => {
    expect(parseLocalIntakeWorkspaceStartRequestV0({
      requestId: REQUEST_A,
      receiptSha256: "a".repeat(64),
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    })).toEqual({
      requestId: REQUEST_A,
      receiptSha256: "a".repeat(64),
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    expect(parseLocalIntakeWorkspaceStatusRequestV0({ requestId: REQUEST_A })).toEqual({
      requestId: REQUEST_A,
    });
    expect(parseLocalIntakeWorkspaceDeleteRequestV0({
      requestId: REQUEST_B,
      receiptSha256: "a".repeat(64),
      workspaceSha256: WORKSPACE_SHA256,
      confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
    })).toMatchObject({ requestId: REQUEST_B, workspaceSha256: WORKSPACE_SHA256 });

    expectControllerCode(() => parseLocalIntakeWorkspaceStartRequestV0({
      requestId: REQUEST_A,
      receiptSha256: "a".repeat(64),
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      sourceRoot: "C:\\private\\intake",
    }), "LOCAL_INTAKE_WORKSPACE_START_REQUEST_INVALID");
    expectControllerCode(() => parseLocalIntakeWorkspaceStatusRequestV0({
      requestId: REQUEST_A,
      workspaceDirectory: "file:///private",
    }), "LOCAL_INTAKE_WORKSPACE_STATUS_REQUEST_INVALID");
    expectControllerCode(() => parseLocalIntakeWorkspaceDeleteRequestV0({
      requestId: REQUEST_B,
      receiptSha256: "a".repeat(64),
      workspaceSha256: WORKSPACE_SHA256,
      confirmation: "delete_everything",
    }), "LOCAL_INTAKE_WORKSPACE_DELETE_REQUEST_INVALID");
  });

  it("publishes bounded progress synchronously and retains a full verified report", async () => {
    const fixture = await makeFixture();
    const draft = guidedDraft(fixture.receipt);
    const stored = fakeStored(fixture.receipt, draft);
    const completion = deferred<LocalIntakeWorkspaceCoreStoredV0>();
    let reportProgress = (_phase: "copying" | "verifying_workspace"): void => undefined;
    const core = coreHooks(stored, {
      start: vi.fn((input: Parameters<LocalIntakeWorkspaceCoreHooksV0["start"]>[0]) => {
        reportProgress = (phase): void => {
          input.onProgress({
            phase,
            completedFiles: phase === "copying" ? 1 : fixture.receipt.summary.fileCount,
            totalFiles: fixture.receipt.summary.fileCount,
            completedBytes: phase === "copying" ? 1 : fixture.receipt.summary.totalBytes,
            totalBytes: fixture.receipt.summary.totalBytes,
            currentFileOrdinal: phase === "copying" ? 1 : null,
          });
        };
        return completion.promise;
      }),
    });
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: {
        sourceRoot: fixture.sourceRoot,
        workspaceDirectory: fixture.workspaceDirectory,
      },
      core,
      now: () => new Date(CREATED_AT),
    });
    controller.bindReceipt(fixture.receipt);
    controller.bindAdmissionDraft(draft);
    expect((await controller.initialize()).state).toBe("ready");

    const copy = controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    expect(controller.snapshot()).toMatchObject({
      schemaVersion: LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0,
      state: "copying",
      authority: "none",
      operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      configured: true,
      requestId: REQUEST_A,
      failureCode: null,
      workspace: null,
    });

    await vi.waitFor(() => {
      expect(core.start).toHaveBeenCalledTimes(1);
    });
    reportProgress("copying");
    expect(controller.snapshot().progress).toMatchObject({ copiedFileCount: 1 });
    reportProgress("verifying_workspace");
    expect(controller.snapshot().state).toBe("verifying");
    completion.resolve(stored);

    const result = await copy;
    expect(result).toMatchObject({
      state: "stored",
      authority: "none",
      operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      receiptSha256: fixture.receipt.receiptSha256,
      requestId: REQUEST_A,
      progress: {
        copiedFileCount: 2,
        fileCount: 2,
        copiedBytes: fixture.receipt.summary.totalBytes,
        totalBytes: fixture.receipt.summary.totalBytes,
      },
      workspace: {
        workspaceSha256: WORKSPACE_SHA256,
        fileCount: 2,
        truth: {
          pendingReview: 0,
          admitted: 1,
          excluded: 1,
          captured: 1,
          enhancedCaptured: 0,
          generatedCinematic: 0,
          conceptImagination: 0,
        },
      },
    });
    const serializedDto = JSON.stringify(result);
    expect(serializedDto).not.toContain(fixture.root);
    expect(serializedDto).not.toContain(basename(fixture.sourceRoot));
    expect(controller.readCompletedReport(REQUEST_B)).toBeNull();
    expect(controller.readCompletedReport(REQUEST_A)).toEqual(stored.index);
    expect(controller.readCompletedIndex(REQUEST_A)).not.toBe(stored.index);
  });

  it("cancels an active copy through its AbortSignal and accepts a later resume request", async () => {
    const fixture = await makeFixture();
    const stored = fakeStored(fixture.receipt);
    let callCount = 0;
    const core = coreHooks(stored, {
      inspect: vi.fn(() => Promise.resolve(
        callCount === 0
          ? { kind: "missing" as const }
          : { kind: "incomplete" as const, intentSha256: "c".repeat(64) },
      )),
      start: vi.fn((input) => {
        callCount += 1;
        return new Promise<LocalIntakeWorkspaceCoreStoredV0>((_resolve, reject) => {
          const abort = (): void => {
            reject(new Error("aborted"));
          };
          if (input.signal.aborted === true) abort();
          else input.signal.addEventListener("abort", abort, { once: true });
        });
      }),
      resume: vi.fn(() => {
        callCount += 1;
        return Promise.resolve(stored);
      }),
    });
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: {
        sourceRoot: fixture.sourceRoot,
        workspaceDirectory: fixture.workspaceDirectory,
      },
      core,
      settlementTimeoutMs: 500,
    });
    controller.bindReceipt(fixture.receipt);
    await controller.initialize();

    const first = controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    await vi.waitFor(() => {
      expect(core.start).toHaveBeenCalledTimes(1);
    });
    const cancelled = await controller.cancel(REQUEST_A);
    expect(cancelled).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_INTAKE_WORKSPACE_CANCELLED",
      requestId: REQUEST_A,
      workspace: null,
    });
    await first;

    const resumed = await controller.start({
      requestId: REQUEST_B,
      receiptSha256: fixture.receipt.receiptSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    expect(resumed.state).toBe("stored");
    expect(core.resume).toHaveBeenCalledTimes(1);
    expect(core.resume).toHaveBeenCalledWith(expect.objectContaining({
      expectedIntentSha256: "c".repeat(64),
    }));
  });

  it("preserves persisted guided truth when resuming after in-memory review state was lost", async () => {
    const fixture = await makeFixture();
    const stored = fakeStored(fixture.receipt, guidedDraft(fixture.receipt));
    const core = coreHooks(stored, {
      inspect: vi.fn(() => Promise.resolve({
        kind: "incomplete" as const,
        intentSha256: stored.index.intentSha256,
      })),
    });
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: {
        sourceRoot: fixture.sourceRoot,
        workspaceDirectory: fixture.workspaceDirectory,
      },
      core,
    });
    controller.bindReceipt(fixture.receipt);
    expect((await controller.initialize()).state).toBe("ready");
    const resumed = await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    expect(resumed).toMatchObject({
      state: "stored",
      workspace: {
        truth: { pendingReview: 0, admitted: 1, excluded: 1, captured: 1 },
      },
    });
    expect(core.start).not.toHaveBeenCalled();
    expect(core.resume).toHaveBeenCalledTimes(1);
  });

  it("loads a verified workspace with a deterministic request and deletes only by both digests", async () => {
    const fixture = await makeFixture();
    const stored = fakeStored(fixture.receipt);
    const deletion = deferred<undefined>();
    const core = coreHooks(stored, {
      inspect: vi.fn(() => Promise.resolve({ kind: "stored" as const, stored })),
      delete: vi.fn(() => deletion.promise),
    });
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: {
        sourceRoot: fixture.sourceRoot,
        workspaceDirectory: fixture.workspaceDirectory,
      },
      core,
    });
    const opened = await controller.initialize();
    const reopenedRequestId = WORKSPACE_SHA256.slice(0, 32);
    expect(opened).toMatchObject({
      state: "stored",
      operation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      requestId: reopenedRequestId,
      progress: {
        copiedFileCount: fixture.receipt.summary.fileCount,
        fileCount: fixture.receipt.summary.fileCount,
      },
    });
    expect(controller.readCompletedReport(reopenedRequestId)).toEqual(stored.index);
    controller.bindReceipt(fixture.receipt);

    const stale = await controller.delete({
      requestId: REQUEST_B,
      receiptSha256: fixture.receipt.receiptSha256,
      workspaceSha256: "d".repeat(64),
      confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
    });
    expect(stale).toMatchObject({
      state: "failed",
      failureCode: "LOCAL_INTAKE_WORKSPACE_STALE_DELETE_CONFIRMATION",
    });
    expect(core.delete).not.toHaveBeenCalled();
    expect(controller.snapshot().state).toBe("stored");

    const deleting = controller.delete({
      requestId: REQUEST_B,
      receiptSha256: fixture.receipt.receiptSha256,
      workspaceSha256: WORKSPACE_SHA256,
      confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
    });
    expect(controller.snapshot()).toMatchObject({
      state: "deleting",
      operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      requestId: REQUEST_B,
      progress: null,
      workspace: stored.workspace,
    });
    deletion.resolve(undefined);
    await expect(deleting).resolves.toMatchObject({
      state: "deleted",
      configured: true,
      operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      requestId: REQUEST_B,
      progress: null,
      workspace: null,
    });
    await expect(controller.delete({
      requestId: REQUEST_B,
      receiptSha256: fixture.receipt.receiptSha256,
      workspaceSha256: WORKSPACE_SHA256,
      confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
    })).resolves.toMatchObject({ state: "deleted" });
    expect(core.delete).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable browser state empty and path-free without trusted context", async () => {
    const fixture = await makeFixture();
    const stored = fakeStored(fixture.receipt);
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: null,
      core: coreHooks(stored),
    });
    controller.bindReceipt(fixture.receipt);
    expect(await controller.initialize()).toMatchObject({
      schemaVersion: LOCAL_INTAKE_WORKSPACE_CONTROLLER_DTO_V0,
      state: "unavailable",
      authority: "none",
      operation: null,
      configured: false,
      receiptSha256: null,
      requestId: null,
      failureCode: null,
      progress: null,
      workspace: null,
    });
  });

  it("uses the core adapter to copy, reopen, verify, and explicitly delete a real workspace", async () => {
    const fixture = await makeFixture();
    const context = {
      sourceRoot: fixture.sourceRoot,
      workspaceDirectory: fixture.workspaceDirectory,
    };
    const controller = createLocalIntakeWorkspaceControllerV0({
      trustedContext: context,
      now: () => new Date(CREATED_AT),
    });
    controller.bindReceipt(fixture.receipt);
    expect((await controller.initialize()).state).toBe("ready");
    const copied = await controller.start({
      requestId: REQUEST_A,
      receiptSha256: fixture.receipt.receiptSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
    });
    expect(copied).toMatchObject({
      state: "stored",
      authority: "none",
      progress: {
        copiedFileCount: fixture.receipt.summary.fileCount,
        fileCount: fixture.receipt.summary.fileCount,
      },
      workspace: {
        fileCount: fixture.receipt.summary.fileCount,
        totalBytes: fixture.receipt.summary.totalBytes,
        truth: {
          pendingReview: fixture.receipt.summary.fileCount,
          admitted: 0,
          excluded: 0,
        },
      },
    });
    const workspaceSha256 = copied.workspace?.workspaceSha256;
    if (workspaceSha256 === undefined) throw new Error("missing stored workspace digest");
    await controller.close();

    const reopened = createLocalIntakeWorkspaceControllerV0({ trustedContext: context });
    const reopenedState = await reopened.initialize();
    const reopenedRequestId = workspaceSha256.slice(0, 32);
    expect(reopenedState).toMatchObject({
      state: "stored",
      requestId: reopenedRequestId,
      receiptSha256: fixture.receipt.receiptSha256,
      workspace: { workspaceSha256 },
    });
    expect(reopened.readCompletedReport(reopenedRequestId)).toMatchObject({
      receiptSha256: fixture.receipt.receiptSha256,
      workspaceSha256,
      authority: "none",
    });
    const deleted = await reopened.delete({
      requestId: REQUEST_B,
      receiptSha256: fixture.receipt.receiptSha256,
      workspaceSha256,
      confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
    });
    expect(deleted).toMatchObject({ state: "deleted", workspace: null });
    await expect(lstat(fixture.workspaceDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(inspectUniversalIntake(fixture.sourceRoot)).resolves.toEqual(fixture.receipt);
  });
});
