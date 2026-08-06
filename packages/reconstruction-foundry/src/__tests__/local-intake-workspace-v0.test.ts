import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  compileGuidedAdmissionDraft,
  type FoundryGuidedAdmissionFileChoice,
} from "../guided-admission.js";
import { inspectUniversalIntake } from "../intake-receipt.js";
import {
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0,
  FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
  compileFoundryLocalIntakeWorkspaceIntentV0,
  deleteFoundryLocalIntakeWorkspaceV0,
  inspectFoundryLocalIntakeWorkspaceV0,
  resolveFoundryLocalIntakeWorkspaceSourcePathV0,
  resumeFoundryLocalIntakeWorkspaceV0,
  startFoundryLocalIntakeWorkspaceV0,
  verifyFoundryLocalIntakeWorkspaceV0,
} from "../local-intake-workspace-v0.js";

const cleanup: string[] = [];
const FIXED_TIME = "2026-07-22T01:02:03.000Z";

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function makeCase(
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<{ readonly root: string; readonly source: string; readonly workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-intake-workspace-"));
  cleanup.push(root);
  const source = join(root, "source");
  await mkdir(source);
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(source, ...relativePath.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
    await utimes(path, new Date(FIXED_TIME), new Date(FIXED_TIME));
  }
  return { root, source, workspace: join(root, "workspace") };
}

async function pendingIntent(source: string, workspaceId = "workspace-test") {
  const receipt = await inspectUniversalIntake(source);
  return {
    receipt,
    intent: compileFoundryLocalIntakeWorkspaceIntentV0({
      workspaceId,
      createdAt: FIXED_TIME,
      receipt,
    }),
  };
}

function expectIntegrityCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(FoundryIntegrityError);
  expect((error as FoundryIntegrityError).code).toBe(code);
}

describe("durable local intake workspace v0", () => {
  it("copies every receipt file, preserves mtimes, reproduces the receipt, and deletes only by digest", async () => {
    const triangle = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    const fixture = await makeCase({
      "empty.bin": Buffer.alloc(0),
      "nested/copy-a.obj": triangle,
      "nested/copy-b.obj": triangle,
    });
    const { receipt, intent } = await pendingIntent(fixture.source);
    const originalBytes = await readFile(join(fixture.source, "nested", "copy-a.obj"));

    const verification = await startFoundryLocalIntakeWorkspaceV0({
      workspaceDirectory: fixture.workspace,
      sourcePath: fixture.source,
      intent,
      confirmation: {
        operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
        intentSha256: intent.intentSha256,
      },
    });

    expect(verification.status).toMatchObject({
      state: "complete_verified",
      fileCount: 3,
      completedFileCount: 3,
      authority: "none",
    });
    expect(verification.index.payloadFiles).toHaveLength(3);
    expect(verification.index.truth.map((entry) => entry.state)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(verification.index.capabilities).toMatchObject({
      cloudUpload: "not_authorized",
      reconstruction: "not_authorized",
      modelTraining: "not_authorized",
      enhancement: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
    });
    expect(await inspectUniversalIntake(verification.activeSourcePath)).toEqual(receipt);
    expect(
      await resolveFoundryLocalIntakeWorkspaceSourcePathV0(
        fixture.workspace,
        intent.intentSha256,
      ),
    ).toBe(verification.activeSourcePath);
    for (const file of receipt.files) {
      const ledger = verification.index.payloadFiles.find(
        (candidate) => candidate.receiptPath === file.path,
      );
      expect(ledger).toBeDefined();
      const metadata = await stat(join(fixture.workspace, ...(ledger?.workspacePath.split("/") ?? [])));
      expect(metadata.mtime.toISOString()).toBe(file.modifiedAt);
    }
    expect(await verifyFoundryLocalIntakeWorkspaceV0(fixture.workspace)).toEqual(
      verification,
    );

    const deletion = await deleteFoundryLocalIntakeWorkspaceV0({
      workspaceDirectory: fixture.workspace,
      expectedWorkspaceSha256: verification.index.workspaceSha256,
      confirmation: {
        operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0,
        workspaceSha256: verification.index.workspaceSha256,
      },
    });
    expect(deletion).toMatchObject({
      deleted: true,
      originalSource: "unchanged",
      secureErasure: false,
    });
    await expect(stat(fixture.workspace)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(fixture.source, "nested", "copy-a.obj"))).toEqual(
      originalBytes,
    );
    expect(await inspectUniversalIntake(fixture.source)).toEqual(receipt);
  });

  it("requires explicit digest-bound start confirmation before creating anything", async () => {
    const fixture = await makeCase({ "capture.obj": "v 0 0 0\n" });
    const { intent } = await pendingIntent(fixture.source);

    await expect(
      startFoundryLocalIntakeWorkspaceV0({
        workspaceDirectory: fixture.workspace,
        sourcePath: fixture.source,
        intent,
        confirmation: {
          operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
          intentSha256: "0".repeat(64),
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectIntegrityCode(error, "LOCAL_INTAKE_WORKSPACE_START_CONFIRMATION_MISMATCH");
      return true;
    });
    await expect(stat(fixture.workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels after a complete file and resumes without recopying completed boundaries", async () => {
    const fixture = await makeCase({
      "a.bin": Buffer.alloc(32, 1),
      "b.bin": Buffer.alloc(64, 2),
      "c.bin": Buffer.alloc(96, 3),
    });
    const { intent } = await pendingIntent(fixture.source, "resumable-workspace");
    const controller = new AbortController();

    await expect(
      startFoundryLocalIntakeWorkspaceV0({
        workspaceDirectory: fixture.workspace,
        sourcePath: fixture.source,
        intent,
        confirmation: {
          operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
          intentSha256: intent.intentSha256,
        },
        signal: controller.signal,
        onProgress(progress) {
          if (progress.phase === "copying" && progress.completedFiles === 1) {
            controller.abort();
          }
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectIntegrityCode(error, "LOCAL_INTAKE_WORKSPACE_CANCELLED");
      return true;
    });

    const incomplete = await inspectFoundryLocalIntakeWorkspaceV0(fixture.workspace);
    expect(incomplete).toMatchObject({
      state: "incomplete",
      completedFileCount: 1,
      fileCount: 3,
      workspaceSha256: null,
    });
    const completed = await resumeFoundryLocalIntakeWorkspaceV0({
      workspaceDirectory: fixture.workspace,
      sourcePath: fixture.source,
      expectedIntentSha256: intent.intentSha256,
    });
    expect(completed.status).toMatchObject({
      state: "complete_verified",
      completedFileCount: 3,
    });
  });

  it("fails closed on payload tampering, unexpected files, and hardlinks", async () => {
    const fixture = await makeCase({ "capture.obj": "v 0 0 0\n" });
    const { intent } = await pendingIntent(fixture.source);
    const completed = await startFoundryLocalIntakeWorkspaceV0({
      workspaceDirectory: fixture.workspace,
      sourcePath: fixture.source,
      intent,
      confirmation: {
        operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
        intentSha256: intent.intentSha256,
      },
    });
    const payloadPath = join(
      fixture.workspace,
      ...completed.index.payloadFiles[0]!.workspacePath.split("/"),
    );
    const aliasPath = join(fixture.workspace, "payload-alias.bin");
    await link(payloadPath, aliasPath);
    await expect(verifyFoundryLocalIntakeWorkspaceV0(fixture.workspace)).rejects.toSatisfy(
      (error: unknown) => {
        expectIntegrityCode(error, "LOCAL_INTAKE_WORKSPACE_PAYLOAD_LINK_UNSAFE");
        return true;
      },
    );
    await rm(aliasPath);
    await writeFile(join(fixture.workspace, "unexpected.bin"), "unexpected");
    await expect(verifyFoundryLocalIntakeWorkspaceV0(fixture.workspace)).rejects.toSatisfy(
      (error: unknown) => {
        expectIntegrityCode(error, "LOCAL_INTAKE_WORKSPACE_EXACT_FILE_TREE_MISMATCH");
        return true;
      },
    );
  });

  it("preserves admitted and excluded truth with all provenance classes", async () => {
    const fixture = await makeCase({
      "capture.obj": "v 0 0 0\nv 1 0 0\n",
      "checkpoint.bin": "checkpoint",
      "condition.txt": "condition",
      "concept.obj": "v 0 0 0\nv 3 0 0\n",
      "enhanced.obj": "v 0 0 0\nv 2 0 0\n",
      "environment.json": "{}",
      "generated.obj": "v 0 0 0\nv 4 0 0\n",
      "mask.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const receipt = await inspectUniversalIntake(fixture.source);
    const decisions: FoundryGuidedAdmissionFileChoice[] = receipt.files.map((file) => {
      if (file.path === "capture.obj") {
        return {
          action: "admit",
          path: file.path,
          inputType: "obj",
          role: "official_export",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: [],
          evidenceKinds: [],
        };
      }
      if (file.path === "enhanced.obj") {
        return {
          action: "admit",
          path: file.path,
          inputType: "obj",
          role: "enhanced_captured_derivative",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: ["capture.obj"],
          evidenceKinds: [],
          derivation: {
            operationVersion: "fixture-enhancement@1",
            environmentEvidencePath: "environment.json",
          },
        };
      }
      if (file.path === "mask.png") {
        return {
          action: "admit",
          path: file.path,
          inputType: "generic_image",
          role: "reference_only",
          formatDecision: "operator_override",
          formatEvidencePaths: [file.path],
          parentPaths: [],
          evidenceKinds: ["mask"],
        };
      }
      if (file.path === "generated.obj" || file.path === "concept.obj") {
        return {
          action: "admit",
          path: file.path,
          inputType: "obj",
          role:
            file.path === "generated.obj"
              ? "generated_cinematic_derivative"
              : "concept_imagination_derivative",
          formatDecision: "accept_detector",
          formatEvidencePaths: [],
          parentPaths: ["capture.obj", "mask.png"],
          evidenceKinds: [],
          derivation: {
            operationVersion: "fixture-generation@1",
            environmentEvidencePath: "environment.json",
          },
          generation: {
            maskPath: "mask.png",
            modelName: "fixture-model",
            modelVersion: "1",
            checkpointPath: "checkpoint.bin",
            conditionPath: "condition.txt",
            confidence: 0.5,
            exportRestrictions: ["local evaluation only"],
            truthModeDisclosure:
              "This fixture is explicitly generated and is not captured source evidence.",
          },
        };
      }
      return { action: "exclude", path: file.path, reason: "operator_rejected" };
    });
    const draft = compileGuidedAdmissionDraft(receipt, {
      schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
      receiptSha256: receipt.receiptSha256,
      projectId: "workspace-provenance-fixture",
      reviewedAt: FIXED_TIME,
      reviewedBy: "local-operator",
      sourceMedia: "local",
      caseSensitivity: "insensitive",
      decisions,
    });
    const intent = compileFoundryLocalIntakeWorkspaceIntentV0({
      workspaceId: "workspace-provenance",
      createdAt: FIXED_TIME,
      receipt,
      admissionDraft: draft,
    });

    expect(
      intent.truth
        .filter((entry) => entry.state === "admitted")
        .map((entry) => entry.provenanceClass),
    ).toEqual([
      "captured",
      "concept_imagination",
      "enhanced_captured",
      "generated_cinematic",
      "captured",
    ]);
    expect(intent.truth.filter((entry) => entry.state === "excluded")).toHaveLength(3);
  });
});
