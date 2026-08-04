import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
  compileGuidedAdmissionDraft,
  inspectUniversalIntake,
  type FoundryGuidedAdmissionDraft,
  type FoundryUniversalIntakeReceipt,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalReferenceVerificationControllerV0,
  type LocalReferenceVerificationPublicV0,
} from "../local-reference-verification.js";
import {
  captureReferenceVerificationSourceIdentityV0,
  type ReferenceVerificationSourceIdentityV0,
} from "../reference-verification-bridge.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface VerificationFixture {
  readonly root: string;
  readonly source: string;
  readonly privateStateRoot: string;
  readonly startupIdentity: ReferenceVerificationSourceIdentityV0;
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly admission: FoundryGuidedAdmissionDraft;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];
const openControllers: LocalReferenceVerificationControllerV0[] = [];

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

afterEach(async () => {
  await Promise.all(openControllers.splice(0).map(async (controller) => {
    try {
      await controller.shutdown();
    } catch {
      // The individual test asserts any deliberate failure before cleanup.
    }
  }));
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

function admissionFor(receipt: FoundryUniversalIntakeReceipt): FoundryGuidedAdmissionDraft {
  return compileGuidedAdmissionDraft(receipt, {
    schemaVersion: FOUNDRY_GUIDED_ADMISSION_DRAFT_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "local-reference-verification-test",
    reviewedAt: "2026-07-13T18:00:00.000Z",
    reviewedBy: "verification-test",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: receipt.files.map((file) => ({
      action: "admit" as const,
      path: file.path,
      inputType: "obj" as const,
      role: "official_export" as const,
      formatDecision: "accept_detector" as const,
      formatEvidencePaths: [],
      parentPaths: [],
      evidenceKinds: [],
    })),
  });
}

async function makeVerificationFixture(
  options: { readonly singleFileSource?: boolean; readonly bytes?: number } = {},
): Promise<VerificationFixture> {
  const root = await mkdtemp(join(tmpdir(), "foundry-reference-local-"));
  temporaryDirectories.push(root);
  const privateStateRoot = join(root, "private-state");
  await mkdir(privateStateRoot, { mode: 0o700 });
  const fileBytes = options.bytes ?? 64;
  const content = Buffer.alloc(fileBytes, 0x20);
  Buffer.from("# local reference fixture\nv 0 0 0\n", "utf8").copy(content);
  const source = options.singleFileSource === true
    ? join(root, "capture.obj")
    : join(root, "capture-source");
  if (options.singleFileSource !== true) await mkdir(source);
  const filePath = options.singleFileSource === true ? source : join(source, "capture.obj");
  await writeFile(filePath, content);
  const startupIdentity = await captureReferenceVerificationSourceIdentityV0(source);
  const receipt = await inspectUniversalIntake(source);
  return {
    root,
    source,
    privateStateRoot,
    startupIdentity,
    receipt,
    admission: admissionFor(receipt),
  };
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no token");
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
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", rejectResult);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function postJson(
  app: LocalFoundryAppHandle,
  path: string,
  value: unknown,
  origin = app.origin,
): Promise<HttpResult> {
  const body = JSON.stringify(value);
  return sendRequest(app, {
    method: "POST",
    path: `${path}?token=${encodeURIComponent(tokenFor(app))}`,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  });
}

async function waitForReady(app: LocalFoundryAppHandle): Promise<FoundryUniversalIntakeReceipt> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await sendRequest(app, {
      path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
    });
    expect(response.status).toBe(200);
    const state = JSON.parse(response.body) as LocalFoundryPublicState;
    if (state.phase === "ready" && state.receipt !== undefined) return state.receipt;
    if (state.phase === "failed") throw new Error("fixture intake failed");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("local app did not become ready");
}

function admissionBody(receipt: FoundryUniversalIntakeReceipt): Record<string, unknown> {
  return {
    receiptSha256: receipt.receiptSha256,
    projectId: "local-reference-http-test",
    reviewedBy: "verification-test",
    sourceMedia: "local",
    caseSensitivity: "insensitive",
    decisions: receipt.files.map((file) => ({
      action: "admit",
      path: file.path,
      inputType: "obj",
      role: "official_export",
      formatDecision: "accept_detector",
      formatEvidencePaths: [],
      parentPaths: [],
      evidenceKinds: [],
    })),
  };
}

function parseJson(response: HttpResult): unknown {
  return JSON.parse(response.body) as unknown;
}

function expectSanitizedVerificationBody(text: string, fixture: VerificationFixture): void {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual([
    "bytesChecked",
    "cost",
    "filesChecked",
    "jobId",
    "localOnly",
    "message",
    "outcome",
    "phase",
    "reconstructionPerformed",
    "reportReady",
    "resumeBehavior",
    "revision",
    "run",
    "totalBytes",
    "totalFiles",
    "uploaded",
  ]);
  for (const forbidden of [
    fixture.source,
    fixture.privateStateRoot,
    "capture.obj",
    "canonicalSourcePath",
    "authenticationHmacSha256",
    "keyId",
    "checkpointEnvelope",
    "completedFiles",
    "relativePath",
  ]) {
    expect(text).not.toContain(forbidden);
    expect(text).not.toContain(forbidden.replaceAll("\\", "\\\\"));
  }
}

describe("local reference verification controller", () => {
  it("stops, restarts from byte zero, and rejects a delayed cancel from the older run", async () => {
    const fixture = await makeVerificationFixture({ singleFileSource: true, bytes: 8 * 1024 * 1024 });
    const firstRead = new Map<number, Deferred>();
    const releaseRead = new Map<number, Deferred>();
    const firstOffsets = new Map<number, number>();
    for (const attempt of [1, 2]) {
      firstRead.set(attempt, deferred());
      releaseRead.set(attempt, deferred());
    }
    const controller = await LocalReferenceVerificationControllerV0.create({
      source: fixture.source,
      trustedStartupSourceIdentity: fixture.startupIdentity,
      receipt: fixture.receipt,
      admissionDraft: fixture.admission,
      privateStateRoot: fixture.privateStateRoot,
      testHooks: {
        checkpointIntervalBytes: 64 * 1024,
        readBufferBytes: 64 * 1024,
        onMeasuredProgress: async (event) => {
          if (event.currentOffsetBytes > 0 && !firstOffsets.has(event.attempt)) {
            firstOffsets.set(event.attempt, event.currentOffsetBytes);
            firstRead.get(event.attempt)?.resolve();
            await releaseRead.get(event.attempt)?.promise;
          }
        },
      },
    });
    openControllers.push(controller);

    const started = await controller.start(
      fixture.admission.result.resultSha256,
      "1".repeat(32),
    );
    expect(started).toMatchObject({ phase: "checking", run: 1, resumeBehavior: "restarts_from_beginning" });
    await firstRead.get(1)?.promise;
    const cancelOne = controller.cancel(started.jobId, started.revision, started.run);
    releaseRead.get(1)?.resolve();
    const paused = await cancelOne;
    expect(paused).toMatchObject({ phase: "stopped_for_now", run: 1 });

    const resumed = await controller.resume(
      paused.jobId,
      paused.revision,
      paused.run,
      fixture.admission.result.resultSha256,
      "2".repeat(32),
    );
    expect(resumed).toMatchObject({ phase: "checking", run: 2, filesChecked: 0, bytesChecked: 0 });
    await firstRead.get(2)?.promise;
    await expect(controller.cancel(paused.jobId, paused.revision, paused.run))
      .rejects.toMatchObject({ code: "LOCAL_REFERENCE_RUN_STALE" });
    const stillRunning = await controller.status(resumed.jobId, resumed.revision, resumed.run);
    expect(stillRunning).toMatchObject({ phase: "checking", run: 2 });
    const cancelTwo = controller.cancel(stillRunning.jobId, stillRunning.revision, stillRunning.run);
    releaseRead.get(2)?.resolve();
    expect((await cancelTwo).phase).toBe("stopped_for_now");

    expect(firstOffsets.get(1)).toBe(64 * 1024);
    expect(firstOffsets.get(2)).toBe(64 * 1024);
  }, 20_000);

  it("does not claim shutdown when durable terminal confirmation fails", async () => {
    const fixture = await makeVerificationFixture({ singleFileSource: true });
    let failConfirmation = true;
    const controller = await LocalReferenceVerificationControllerV0.create({
      source: fixture.source,
      trustedStartupSourceIdentity: fixture.startupIdentity,
      receipt: fixture.receipt,
      admissionDraft: fixture.admission,
      privateStateRoot: fixture.privateStateRoot,
      testHooks: {
        beforeShutdownConfirmation: () => {
          if (failConfirmation) throw new Error("injected confirmation failure");
        },
      },
    });
    openControllers.push(controller);
    const started = await controller.start(
      fixture.admission.result.resultSha256,
      "f".repeat(32),
    );
    await expect(controller.shutdown()).rejects.toThrow("injected confirmation failure");
    failConfirmation = false;
    const current = await controller.current();
    expect(current?.jobId).toBe(started.jobId);
    await expect(controller.shutdown()).resolves.toBeUndefined();
  });
});

describe("local reference verification HTTP boundary", () => {
  it("starts asynchronously, replays idempotently, recovers current state, and returns only allowlisted fields", async () => {
    const fixture = await makeVerificationFixture();
    const app = await startLocalFoundryApp({
      source: fixture.source,
      privateStateRoot: fixture.privateStateRoot,
    });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const noCurrent = await postJson(app, "/api/reference-verification/current", {});
    expect(noCurrent.status).toBe(200);
    expect(parseJson(noCurrent)).toEqual({ current: null });

    const admissionResponse = await postJson(app, "/api/admission-draft", admissionBody(receipt));
    expect(admissionResponse.status, admissionResponse.body).toBe(201);
    const admission = parseJson(admissionResponse) as { readonly resultSha256: string };
    const requestId = "a".repeat(32);
    const startBody = { admissionResultSha256: admission.resultSha256, requestId };
    const first = await postJson(app, "/api/reference-verification/start", startBody);
    expect(first.status, first.body).toBe(202);
    expectSanitizedVerificationBody(first.body, fixture);
    let current = parseJson(first) as LocalReferenceVerificationPublicV0;

    const replay = await postJson(app, "/api/reference-verification/start", startBody);
    expect(replay.status, replay.body).toBe(202);
    expect((parseJson(replay) as LocalReferenceVerificationPublicV0).jobId).toBe(current.jobId);
    expectSanitizedVerificationBody(replay.body, fixture);

    const recovered = await postJson(app, "/api/reference-verification/current", {});
    expect(recovered.status, recovered.body).toBe(200);
    const recoveredCurrent = (parseJson(recovered) as {
      readonly current: LocalReferenceVerificationPublicV0;
    }).current;
    expect(recoveredCurrent.jobId).toBe(current.jobId);
    expectSanitizedVerificationBody(JSON.stringify(recoveredCurrent), fixture);

    const deadline = Date.now() + 5_000;
    while (current.phase === "checking" && Date.now() < deadline) {
      const status = await postJson(app, "/api/reference-verification/status", {
        jobId: current.jobId,
        revision: current.revision,
        run: current.run,
      });
      expect(status.status, status.body).toBe(200);
      expectSanitizedVerificationBody(status.body, fixture);
      current = parseJson(status) as LocalReferenceVerificationPublicV0;
    }
    expect(current).toMatchObject({
      phase: "finished",
      outcome: "all_approved_files_matched",
      reportReady: true,
      localOnly: true,
      uploaded: false,
      reconstructionPerformed: false,
      cost: { currency: "GBP", amount: "0.00" },
    });
    const recoveredFinished = await postJson(app, "/api/reference-verification/current", {});
    expect(recoveredFinished.status, recoveredFinished.body).toBe(200);
    const recoveredFinishedCurrent = (parseJson(recoveredFinished) as {
      readonly current: LocalReferenceVerificationPublicV0;
    }).current;
    expect(recoveredFinishedCurrent).toMatchObject({
      jobId: current.jobId,
      phase: "finished",
      outcome: "all_approved_files_matched",
      reportReady: true,
      filesChecked: current.totalFiles,
      bytesChecked: current.totalBytes,
    });
    expectSanitizedVerificationBody(JSON.stringify(recoveredFinishedCurrent), fixture);
    const report = await postJson(app, "/api/reference-verification/report", {
      jobId: current.jobId,
      revision: current.revision,
      run: current.run,
    });
    expect(report.status, report.body).toBe(200);
    expectSanitizedVerificationBody(report.body, fixture);

    const wrongOrigin = await postJson(
      app,
      "/api/reference-verification/current",
      {},
      "https://example.invalid",
    );
    expect(wrongOrigin.status).toBe(403);
    const extraField = await postJson(app, "/api/reference-verification/status", {
      jobId: current.jobId,
      revision: current.revision,
      run: current.run,
      source: fixture.source,
    });
    expect(extraField.status).toBe(400);
    expect(extraField.body).not.toContain(fixture.source);

    const stop = await postJson(app, "/api/stop", {});
    expect(stop.status, stop.body).toBe(202);
    expect(parseJson(stop)).toEqual({
      stopping: true,
      verificationStopped: true,
      offlinePreviewStopped: true,
    });
  }, 20_000);

  it("waits for an active read to stop durably and rejects work queued behind the stop barrier", async () => {
    const fixture = await makeVerificationFixture({ bytes: 8 * 1024 * 1024 });
    const firstRead = deferred();
    const shutdownConfirmationEntered = deferred();
    const releaseShutdownConfirmation = deferred();
    let gated = false;
    const app = await startLocalFoundryApp({
      source: fixture.source,
      privateStateRoot: fixture.privateStateRoot,
      referenceVerificationTestHooks: {
        checkpointIntervalBytes: 64 * 1024,
        readBufferBytes: 64 * 1024,
        onMeasuredProgress: (event) => {
          if (!gated && event.currentOffsetBytes > 0) {
            gated = true;
            firstRead.resolve();
          }
        },
        beforeShutdownConfirmation: async () => {
          shutdownConfirmationEntered.resolve();
          await releaseShutdownConfirmation.promise;
        },
      },
    });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const admissionResponse = await postJson(app, "/api/admission-draft", admissionBody(receipt));
    expect(admissionResponse.status).toBe(201);
    const admission = parseJson(admissionResponse) as { readonly resultSha256: string };
    const startedResponse = await postJson(app, "/api/reference-verification/start", {
      admissionResultSha256: admission.resultSha256,
      requestId: "d".repeat(32),
    });
    expect(startedResponse.status, startedResponse.body).toBe(202);
    const started = parseJson(startedResponse) as LocalReferenceVerificationPublicV0;
    expect(started.phase).toBe("checking");
    await firstRead.promise;

    const stopPromise = postJson(app, "/api/stop", {});
    const stoppingDeadline = Date.now() + 2_000;
    let sawStopping = false;
    while (Date.now() < stoppingDeadline) {
      const stateResponse = await sendRequest(app, {
        path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
      });
      if (
        stateResponse.status === 200 &&
        (parseJson(stateResponse) as LocalFoundryPublicState).phase === "stopping"
      ) {
        sawStopping = true;
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
    expect(sawStopping).toBe(true);
    const queuedStart = await postJson(app, "/api/reference-verification/start", {
      admissionResultSha256: admission.resultSha256,
      requestId: "e".repeat(32),
    });
    expect(queuedStart.status).toBe(409);
    expect(queuedStart.body).toContain("preparing to stop safely");

    await shutdownConfirmationEntered.promise;
    const stoppedTooSoon = await Promise.race([
      stopPromise.then(() => true),
      new Promise<boolean>((resolveWait) => {
        setTimeout(() => {
          resolveWait(false);
        }, 20);
      }),
    ]);
    expect(stoppedTooSoon).toBe(false);
    releaseShutdownConfirmation.resolve();
    const stopped = await stopPromise;
    expect(stopped.status, stopped.body).toBe(202);
    expect(parseJson(stopped)).toEqual({
      stopping: true,
      verificationStopped: true,
      offlinePreviewStopped: true,
    });

    const privateText = `${startedResponse.body}\n${queuedStart.body}\n${stopped.body}`;
    expect(privateText).not.toContain(fixture.source);
    expect(privateText).not.toContain(fixture.privateStateRoot);
  }, 20_000);

  it("fails closed with path-free copy when the startup source object or admission digest is stale", async () => {
    const fixture = await makeVerificationFixture();
    const app = await startLocalFoundryApp({
      source: fixture.source,
      privateStateRoot: fixture.privateStateRoot,
    });
    openApps.push(app);
    const receipt = await waitForReady(app);
    const admissionResponse = await postJson(app, "/api/admission-draft", admissionBody(receipt));
    expect(admissionResponse.status).toBe(201);
    const admission = parseJson(admissionResponse) as { readonly resultSha256: string };

    const staleDigest = await postJson(app, "/api/reference-verification/start", {
      admissionResultSha256: `sha256:${"0".repeat(64)}`,
      requestId: "b".repeat(32),
    });
    expect(staleDigest.status).toBe(409);

    const moved = `${fixture.source}-moved`;
    await rename(fixture.source, moved);
    await mkdir(fixture.source);
    await writeFile(join(fixture.source, "capture.obj"), "# replacement\nv 1 1 1\n");
    const staleSource = await postJson(app, "/api/reference-verification/start", {
      admissionResultSha256: admission.resultSha256,
      requestId: "c".repeat(32),
    });
    expect(staleSource.status).toBe(409);
    expect(staleSource.body).toContain("source or review may have changed");
    expect(staleSource.body).not.toContain(fixture.source);
    expect(staleSource.body).not.toContain(fixture.privateStateRoot);
  });
});
