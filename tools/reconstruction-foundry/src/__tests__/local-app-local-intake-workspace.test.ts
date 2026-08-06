import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FoundryUniversalIntakeReceipt } from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
  LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
  type LocalIntakeWorkspaceCoreHooksV0,
  type LocalIntakeWorkspaceCoreStoredV0,
} from "../local-intake-workspace.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const COPY_REQUEST_ID = "0123456789abcdef0123456789abcdef";
const DELETE_REQUEST_ID = "11111111111111111111111111111111";
const RETRY_DELETE_REQUEST_ID = "22222222222222222222222222222222";
const STALE_WORKSPACE_SHA256 = "f".repeat(64);

const WORKSPACE_CAPABILITIES = {
  localPersistence: "explicit_copy_only",
  resume: "file_boundary_only",
  deletion: "explicit_digest_bound_only",
  jobPlanning: "not_authorized",
  jobSubmission: "not_authorized",
  cloudUpload: "not_authorized",
  reconstruction: "not_authorized",
  modelTraining: "not_authorized",
  enhancement: "not_authorized",
  execution: "not_authorized",
  signing: "not_authorized",
  publication: "not_authorized",
  promotion: "not_authorized",
} as const;

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface Fixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly workspaceDirectory: string;
  readonly sourceFiles: ReadonlyMap<string, Buffer>;
}

interface RequestOptions {
  readonly token?: string | null;
  readonly origin?: string | null;
}

const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makeFixture(suffix: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), `omnitwin-local-workspace-http-${suffix}-`));
  temporaryDirectories.push(root);
  const sourceRoot = join(root, "selected-intake");
  const workspaceDirectory = join(root, "saved-local-workspace");
  const sourceFiles = new Map<string, Buffer>([
    ["capture.e57", Buffer.from("ASTM-E57\0durable-local-workspace", "ascii")],
    ["operator-note.txt", Buffer.from("captured source remains unchanged", "utf8")],
  ]);
  await mkdir(sourceRoot, { recursive: true });
  for (const [relativePath, bytes] of sourceFiles) {
    await writeFile(join(sourceRoot, relativePath), bytes);
  }
  return { root, sourceRoot, workspaceDirectory, sourceFiles };
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("local app fixture has no session token");
  return token;
}

function withToken(path: string, token: string | null): string {
  if (token === null) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

function request(
  app: LocalFoundryAppHandle,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<HttpResult> {
  return new Promise((resolvePromise, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const current = new URL(app.origin);
    const token = options.token === undefined ? tokenFor(app) : options.token;
    const origin = options.origin === undefined
      ? method === "POST" ? app.origin : null
      : options.origin;
    const outgoing = httpRequest({
      hostname: current.hostname,
      port: app.port,
      path: withToken(path, token),
      method,
      headers: {
        ...(origin === null ? {} : { Origin: origin }),
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

function json(result: HttpResult): unknown {
  return JSON.parse(result.body.toString("utf8")) as unknown;
}

async function state(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await request(app, "GET", "/api/state");
  expect(response.status).toBe(200);
  return json(response) as LocalFoundryPublicState;
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

async function waitForStored(
  app: LocalFoundryAppHandle,
  requestId: string,
): Promise<LocalFoundryPublicState["localIntakeWorkspace"]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await request(
      app,
      "POST",
      "/api/local-intake-workspace/status",
      { requestId },
    );
    expect(response.status).toBe(200);
    const current = json(response) as LocalFoundryPublicState["localIntakeWorkspace"];
    if (current.state === "stored") return current;
    if (current.state === "failed") {
      throw new Error(`local workspace fixture failed: ${current.failureCode ?? "unknown"}`);
    }
    await delay(10);
  }
  throw new Error("local workspace fixture did not become stored");
}

function storedFor(
  receipt: FoundryUniversalIntakeReceipt,
  createdAt: string,
): LocalIntakeWorkspaceCoreStoredV0 {
  const workspaceId = `local-${receipt.receiptSha256.slice(0, 24)}`;
  const workspaceSha256 = sha256(`workspace:${receipt.receiptSha256}`);
  const intentSha256 = sha256(`intent:${receipt.receiptSha256}:${createdAt}`);
  const index: LocalIntakeWorkspaceCoreStoredV0["index"] = {
    schemaVersion: "omnitwin.foundry.local-intake-workspace-index.v0",
    workspaceId,
    intentSha256,
    receiptSha256: receipt.receiptSha256,
    source: {
      kind: receipt.source.kind,
      label: receipt.source.label,
      activeSourceRelativePath: `payload/${receipt.source.label}`,
    },
    fileCount: receipt.summary.fileCount,
    totalBytes: receipt.summary.totalBytes,
    evidenceFiles: [
      {
        path: "evidence/intake-receipt.json",
        sizeBytes: 1,
        sha256: sha256("receipt-evidence"),
        role: "intake_receipt",
      },
      {
        path: "workspace-intent.json",
        sizeBytes: 1,
        sha256: sha256("intent-evidence"),
        role: "workspace_intent",
      },
    ],
    payloadFiles: receipt.files.map((file) => ({
      receiptPath: file.path,
      workspacePath: `payload/${receipt.source.label}/${file.path}`,
      sizeBytes: file.sizeBytes,
      modifiedAt: file.modifiedAt,
      sha256: file.sha256,
    })),
    truth: receipt.files.map((file) => ({
      state: "pending" as const,
      receiptPath: file.path,
    })),
    sourceVerification: {
      beforeReceiptSha256: receipt.receiptSha256,
      afterReceiptSha256: receipt.receiptSha256,
      workspaceReceiptSha256: receipt.receiptSha256,
      exactReceiptMatch: true,
    },
    authority: "none",
    capabilities: WORKSPACE_CAPABILITIES,
    commitMarker: "workspace_index_written_after_full_verification",
    workspaceSha256,
  };
  return {
    index,
    receiptSha256: receipt.receiptSha256,
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

function coreHooks(
  deleteWorkspace: LocalIntakeWorkspaceCoreHooksV0["delete"],
): LocalIntakeWorkspaceCoreHooksV0 {
  let stored: LocalIntakeWorkspaceCoreStoredV0 | null = null;
  return {
    inspect: vi.fn(() => Promise.resolve(
      stored === null
        ? { kind: "missing" as const }
        : { kind: "stored" as const, stored },
    )),
    start: vi.fn((input) => {
      input.onProgress({
        phase: "copying",
        completedFiles: input.receipt.summary.fileCount,
        totalFiles: input.receipt.summary.fileCount,
        completedBytes: input.receipt.summary.totalBytes,
        totalBytes: input.receipt.summary.totalBytes,
        currentFileOrdinal: null,
      });
      stored = storedFor(input.receipt, input.createdAt);
      input.onProgress({
        phase: "complete",
        completedFiles: input.receipt.summary.fileCount,
        totalFiles: input.receipt.summary.fileCount,
        completedBytes: input.receipt.summary.totalBytes,
        totalBytes: input.receipt.summary.totalBytes,
        currentFileOrdinal: null,
      });
      return Promise.resolve(stored);
    }),
    resume: vi.fn(() => {
      if (stored === null) throw new Error("test workspace has no resumable state");
      return Promise.resolve(stored);
    }),
    delete: vi.fn(async (input) => {
      await deleteWorkspace(input);
      stored = null;
    }),
  };
}

async function expectOriginalBytes(fixture: Fixture): Promise<void> {
  for (const [relativePath, bytes] of fixture.sourceFiles) {
    await expect(readFile(join(fixture.sourceRoot, relativePath))).resolves.toEqual(bytes);
  }
}

describe("Foundry local app durable intake workspace routes", () => {
  it("runs ready through stored/report, rejects stale deletion before teardown, then deletes and stops", async () => {
    const fixture = await makeFixture("success");
    const deleteWorkspace = vi.fn<LocalIntakeWorkspaceCoreHooksV0["delete"]>(() =>
      Promise.resolve());
    const core = coreHooks(deleteWorkspace);
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      localIntakeWorkspace: {
        trustedContext: {
          sourceRoot: fixture.sourceRoot,
          workspaceDirectory: fixture.workspaceDirectory,
        },
        core,
      },
    });
    openApps.push(app);

    const ready = await waitForReady(app);
    const receiptSha256 = ready.receipt?.receiptSha256;
    if (receiptSha256 === undefined) throw new Error("fixture has no intake receipt");
    expect(ready.localIntakeWorkspace).toMatchObject({
      state: "ready",
      authority: "none",
      receiptSha256,
      workspace: null,
    });

    expect((await request(
      app,
      "POST",
      "/api/local-intake-workspace/start",
      {
        requestId: COPY_REQUEST_ID,
        receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      },
      { token: null },
    )).status).toBe(401);
    expect((await request(
      app,
      "POST",
      "/api/local-intake-workspace/start",
      {
        requestId: COPY_REQUEST_ID,
        receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      },
      { origin: "https://wrong-origin.example" },
    )).status).toBe(403);
    expect((await request(
      app,
      "GET",
      "/api/local-intake-workspace/start",
    )).status).toBe(405);
    const pathLeakAttempt = await request(
      app,
      "POST",
      "/api/local-intake-workspace/start",
      {
        requestId: COPY_REQUEST_ID,
        receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
        workspaceDirectory: fixture.workspaceDirectory,
      },
    );
    expect(pathLeakAttempt.status).toBe(400);
    expect(pathLeakAttempt.body.toString("utf8")).not.toContain(fixture.root);

    const started = await request(
      app,
      "POST",
      "/api/local-intake-workspace/start",
      {
        requestId: COPY_REQUEST_ID,
        receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      },
    );
    expect(started.status).toBe(202);
    const stored = await waitForStored(app, COPY_REQUEST_ID);
    if (stored.workspace === null) throw new Error("fixture has no stored workspace summary");
    expect(stored).toMatchObject({
      state: "stored",
      receiptSha256,
      requestId: COPY_REQUEST_ID,
      workspace: {
        fileCount: ready.receipt?.summary.fileCount,
        truth: {
          pendingReview: ready.receipt?.summary.fileCount,
          admitted: 0,
          excluded: 0,
        },
      },
    });

    const report = await request(
      app,
      "POST",
      "/api/local-intake-workspace/report",
      { requestId: COPY_REQUEST_ID },
    );
    expect(report.status).toBe(200);
    expect(report.headers["content-disposition"]).toContain(
      "foundry-local-intake-workspace-record-v0.json",
    );
    expect(json(report) as LocalIntakeWorkspaceCoreStoredV0["index"]).toMatchObject({
      receiptSha256,
      workspaceSha256: stored.workspace.workspaceSha256,
      authority: "none",
    });
    expect(report.body.toString("utf8")).not.toContain(fixture.root);
    expect(report.body.toString("utf8")).not.toContain(fixture.workspaceDirectory);

    const staleDelete = await request(
      app,
      "POST",
      "/api/local-intake-workspace/delete-and-stop",
      {
        requestId: DELETE_REQUEST_ID,
        receiptSha256,
        workspaceSha256: STALE_WORKSPACE_SHA256,
        confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      },
    );
    expect(staleDelete.status).toBe(409);
    expect(deleteWorkspace).not.toHaveBeenCalled();
    const afterStaleDelete = await state(app);
    expect(afterStaleDelete).toMatchObject({
      phase: "ready",
      localIntakeWorkspace: {
        state: "stored",
        workspace: { workspaceSha256: stored.workspace.workspaceSha256 },
      },
    });
    expect((await request(
      app,
      "POST",
      "/api/local-intake-workspace/report",
      { requestId: COPY_REQUEST_ID },
    )).status).toBe(200);

    const deleted = await request(
      app,
      "POST",
      "/api/local-intake-workspace/delete-and-stop",
      {
        requestId: DELETE_REQUEST_ID,
        receiptSha256,
        workspaceSha256: stored.workspace.workspaceSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      },
    );
    expect(deleted.status).toBe(202);
    expect(json(deleted) as LocalFoundryPublicState["localIntakeWorkspace"]).toMatchObject({
      state: "deleted",
      requestId: DELETE_REQUEST_ID,
      receiptSha256,
      workspace: null,
    });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(deleteWorkspace).toHaveBeenCalledOnce();
    await expectOriginalBytes(fixture);
  }, 20_000);

  it("keeps a failed deletion visible and retryable before a successful delete-and-stop", async () => {
    const fixture = await makeFixture("delete-failure");
    let deleteAttempt = 0;
    const deleteWorkspace = vi.fn<LocalIntakeWorkspaceCoreHooksV0["delete"]>(() => {
      deleteAttempt += 1;
      return deleteAttempt === 1
        ? Promise.reject(new Error("bounded injected deletion failure"))
        : Promise.resolve();
    });
    const core = coreHooks(deleteWorkspace);
    const app = await startLocalFoundryApp({
      source: fixture.sourceRoot,
      localIntakeWorkspace: {
        trustedContext: {
          sourceRoot: fixture.sourceRoot,
          workspaceDirectory: fixture.workspaceDirectory,
        },
        core,
      },
    });
    openApps.push(app);

    const ready = await waitForReady(app);
    const receiptSha256 = ready.receipt?.receiptSha256;
    if (receiptSha256 === undefined) throw new Error("fixture has no intake receipt");
    expect((await request(
      app,
      "POST",
      "/api/local-intake-workspace/start",
      {
        requestId: COPY_REQUEST_ID,
        receiptSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_COPY_CONFIRMATION_V0,
      },
    )).status).toBe(202);
    const stored = await waitForStored(app, COPY_REQUEST_ID);
    if (stored.workspace === null) throw new Error("fixture has no stored workspace summary");

    const failed = await request(
      app,
      "POST",
      "/api/local-intake-workspace/delete-and-stop",
      {
        requestId: DELETE_REQUEST_ID,
        receiptSha256,
        workspaceSha256: stored.workspace.workspaceSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      },
    );
    expect(failed.status).toBe(409);
    expect(failed.body.toString("utf8")).not.toContain(fixture.root);
    expect(app.getPhase()).not.toBe("stopped");

    const afterFailure = await state(app);
    expect(afterFailure).toMatchObject({
      phase: "ready",
      localIntakeWorkspace: {
        state: "failed",
        operation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
        requestId: DELETE_REQUEST_ID,
        failureCode: "LOCAL_INTAKE_WORKSPACE_DELETE_FAILED",
        workspace: { workspaceSha256: stored.workspace.workspaceSha256 },
      },
    });
    await expectOriginalBytes(fixture);

    const retried = await request(
      app,
      "POST",
      "/api/local-intake-workspace/delete-and-stop",
      {
        requestId: RETRY_DELETE_REQUEST_ID,
        receiptSha256,
        workspaceSha256: stored.workspace.workspaceSha256,
        confirmation: LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_V0,
      },
    );
    expect(retried.status).toBe(202);
    expect(json(retried) as LocalFoundryPublicState["localIntakeWorkspace"]).toMatchObject({
      state: "deleted",
      requestId: RETRY_DELETE_REQUEST_ID,
      workspace: null,
    });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(deleteWorkspace).toHaveBeenCalledTimes(2);
    await expectOriginalBytes(fixture);
  }, 20_000);
});
