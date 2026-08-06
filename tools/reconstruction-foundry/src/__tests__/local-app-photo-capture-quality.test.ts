import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  FoundryPhotoCaptureQualityReportV0Schema,
  serializeFoundryPhotoCaptureQualityReportV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LocalPhotoCaptureQualityDtoV0,
  LocalPhotoCaptureQualityRunnerV0,
} from "../local-photo-capture-quality.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const RESTART_REQUEST_ID = "fedcba9876543210fedcba9876543210";
const STALE_DIGEST = "0".repeat(64);
const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map(async (app) => {
      if (app.getPhase() !== "stopped") await app.stop();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ),
  );
});

function deferred() {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

async function makePhotoFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-photo-quality-http-"));
  temporaryDirectories.push(root);
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(root, "RR-PILOT-MAP-A-01.png"), onePixelPng);
  await writeFile(join(root, "RR-PILOT-S01-A.png"), onePixelPng);
  await writeFile(join(root, "capture-note.txt"), "fixture only\n", "utf8");
  return root;
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no session token");
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
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on("error", rejectResult);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

async function readState(
  app: LocalFoundryAppHandle,
): Promise<LocalFoundryPublicState> {
  const response = await sendRequest(app, {
    path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForAppReady(
  app: LocalFoundryAppHandle,
): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === "ready") return state;
    if (state.phase === "failed") throw new Error("local app source inspection failed");
    await delay(10);
  }
  throw new Error("local app did not reach ready state");
}

async function postPhotoQualityJson(
  app: LocalFoundryAppHandle,
  route: "start" | "status" | "cancel",
  body: unknown,
): Promise<HttpResult> {
  const encoded = JSON.stringify(body);
  return sendRequest(app, {
    method: "POST",
    path: `/api/photo-capture-quality/${route}?token=${encodeURIComponent(
      tokenFor(app),
    )}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(encoded)),
      Origin: app.origin,
    },
    body: encoded,
  });
}

function parseDto(response: HttpResult): LocalPhotoCaptureQualityDtoV0 {
  return JSON.parse(response.body.toString("utf8")) as
    LocalPhotoCaptureQualityDtoV0;
}

async function waitForPhotoState(
  app: LocalFoundryAppHandle,
  expected: LocalPhotoCaptureQualityDtoV0["state"],
  requestId = REQUEST_ID,
): Promise<LocalPhotoCaptureQualityDtoV0> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await postPhotoQualityJson(app, "status", {
      requestId,
    });
    expect(response.status).toBe(200);
    const current = parseDto(response);
    if (current.state === expected) return current;
    if (current.state === "failed") {
      throw new Error(`photo-quality workbench failed: ${current.message}`);
    }
    await delay(10);
  }
  throw new Error(`photo-quality workbench did not reach ${expected}`);
}

function reportPath(app: LocalFoundryAppHandle, digest: string): string {
  return `/api/photo-capture-quality/report?token=${encodeURIComponent(
    tokenFor(app),
  )}&requestId=${encodeURIComponent(REQUEST_ID)}&digest=${encodeURIComponent(digest)}`;
}

function thumbnailPath(
  app: LocalFoundryAppHandle,
  imageId: string,
  digest: string,
): string {
  return `/api/photo-capture-quality/thumbnail?token=${encodeURIComponent(
    tokenFor(app),
  )}&requestId=${encodeURIComponent(REQUEST_ID)}&imageId=${encodeURIComponent(
    imageId,
  )}&digest=${encodeURIComponent(digest)}`;
}

async function postStop(app: LocalFoundryAppHandle): Promise<HttpResult> {
  const body = "{}";
  return sendRequest(app, {
    method: "POST",
    path: `/api/stop?token=${encodeURIComponent(tokenFor(app))}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      Origin: app.origin,
    },
    body,
  });
}

describe("Foundry local app photo-capture-quality HTTP routes", () => {
  it("runs the real local pixel worker and serves digest-bound report and WebP bytes", async () => {
    const root = await makePhotoFixture();
    const app = await startLocalFoundryApp({ source: root });
    openApps.push(app);

    const ready = await waitForAppReady(app);
    expect(ready.photoCaptureQuality).toMatchObject({
      state: "ready",
      requestId: null,
    });
    expect(ready.photoCaptureQuality.candidates).toHaveLength(2);
    expect(JSON.stringify(ready.photoCaptureQuality)).not.toContain(root);

    const start = await postPhotoQualityJson(app, "start", {
      requestId: REQUEST_ID,
      receiptSha256: ready.photoCaptureQuality.receiptSha256,
      assignments: ready.photoCaptureQuality.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    });
    expect(start.status).toBe(202);
    expect(["running", "completed"]).toContain(parseDto(start).state);

    const completed = await waitForPhotoState(app, "completed");
    expect(completed).toMatchObject({
      requestId: REQUEST_ID,
      runRevision: 1,
      report: {
        buildCount: 1,
        heldoutCount: 1,
        protocolStatus: "incomplete",
        readiness: "retake_required",
      },
    });
    if (completed.report === null) throw new Error("expected completed photo report");

    const staleReport = await sendRequest(app, {
      path: reportPath(app, STALE_DIGEST),
    });
    expect(staleReport.status).toBe(409);

    const reportDownload = await sendRequest(app, {
      path: reportPath(app, completed.report.reportSha256),
    });
    const report = FoundryPhotoCaptureQualityReportV0Schema.parse(
      JSON.parse(reportDownload.body.toString("utf8")),
    );
    const expectedReportBytes = Buffer.from(
      `${serializeFoundryPhotoCaptureQualityReportV0(report)}\n`,
      "utf8",
    );
    expect(reportDownload.status).toBe(200);
    expect(reportDownload.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(reportDownload.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-photo-capture-quality-report-v0.json"',
    );
    expect(reportDownload.headers["content-length"]).toBe(
      String(expectedReportBytes.byteLength),
    );
    expect(reportDownload.body).toEqual(expectedReportBytes);
    expect(report.reportSha256).toBe(completed.report.reportSha256);

    const photo = completed.report.photos.find(
      (candidate) => candidate.thumbnail !== null,
    );
    if (photo?.thumbnail === null || photo?.thumbnail === undefined) {
      throw new Error("expected decoded photo thumbnail");
    }
    const staleThumbnail = await sendRequest(app, {
      path: thumbnailPath(app, photo.imageId, STALE_DIGEST),
    });
    expect(staleThumbnail.status).toBe(409);

    const thumbnail = await sendRequest(app, {
      path: thumbnailPath(app, photo.imageId, photo.thumbnail.sha256),
    });
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers["content-type"]).toBe("image/webp");
    expect(thumbnail.headers["content-disposition"]).toBe("inline");
    expect(thumbnail.headers.etag).toBe(`"${photo.thumbnail.sha256}"`);
    expect(thumbnail.headers["content-length"]).toBe(
      String(thumbnail.body.byteLength),
    );
    expect(createHash("sha256").update(thumbnail.body).digest("hex")).toBe(
      photo.thumbnail.sha256,
    );
  }, 20_000);

  it("cancels promptly and refuses to confirm Stop while an ignored abort is unsettled", async () => {
    const root = await makePhotoFixture();
    const releaseSecond = deferred();
    const secondStarted = deferred();
    let invocation = 0;
    const runner: LocalPhotoCaptureQualityRunnerV0 = async ({ signal }) => {
      invocation += 1;
      if (invocation === 1) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          }, { once: true });
        });
      }
      secondStarted.resolve();
      await releaseSecond.promise;
      throw new DOMException("stopped", "AbortError");
    };
    const app = await startLocalFoundryApp({
      source: root,
      photoCaptureQualityTestHooks: {
        runner,
        settlementTimeoutMs: 25,
      },
    });
    openApps.push(app);
    const ready = await waitForAppReady(app);
    const startBody = {
      requestId: REQUEST_ID,
      receiptSha256: ready.photoCaptureQuality.receiptSha256,
      assignments: ready.photoCaptureQuality.candidates.map((candidate) => ({
        path: candidate.path,
        role: candidate.suggestedRole,
      })),
    };

    const firstStart = await postPhotoQualityJson(app, "start", startBody);
    expect(firstStart.status).toBe(202);
    const cancelled = await postPhotoQualityJson(app, "cancel", {
      requestId: REQUEST_ID,
    });
    expect(cancelled.status).toBe(200);
    expect(parseDto(cancelled)).toMatchObject({
      state: "cancelled",
      requestId: REQUEST_ID,
      report: null,
    });

    const reusedRequest = await postPhotoQualityJson(app, "start", startBody);
    expect(reusedRequest.status).toBe(409);
    const secondStart = await postPhotoQualityJson(app, "start", {
      ...startBody,
      requestId: RESTART_REQUEST_ID,
    });
    expect(secondStart.status).toBe(202);
    expect(parseDto(secondStart).runRevision).toBe(2);
    await secondStarted.promise;
    const refusedStop = await postStop(app);
    expect(refusedStop.status).toBe(409);
    expect(refusedStop.body.toString("utf8")).not.toContain(root);
    expect(app.getPhase()).toBe("ready");

    releaseSecond.resolve();
    await waitForPhotoState(app, "cancelled", RESTART_REQUEST_ID);
    const stopped = await postStop(app);
    expect(stopped.status).toBe(202);
    expect(JSON.parse(stopped.body.toString("utf8"))).toEqual({
      stopping: true,
      verificationStopped: true,
      offlinePreviewStopped: true,
      capturedQualityComparisonStopped: true,
      preparedHdDatasetStopped: true,
      localIntakeWorkspaceStopped: true,
      photoCaptureQualityStopped: true,
    });
    await expect(app.closed).resolves.toEqual({ reason: "operator" });
    expect(app.getPhase()).toBe("stopped");
  }, 20_000);
});
