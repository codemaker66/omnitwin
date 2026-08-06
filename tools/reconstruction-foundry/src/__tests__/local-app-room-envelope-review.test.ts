import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FoundryRoomEnvelopeReviewV0Schema,
  serializeFoundryRoomEnvelopeReviewV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

const roots: string[] = [];
const apps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function attribute(
  name: "position" | "intensity" | "lcc prediction",
): Record<string, unknown> {
  const position = name === "position";
  return {
    name,
    description: "fixture declaration is not semantic authority",
    size: position ? 12 : 1,
    numElements: position ? 3 : 1,
    elementSize: position ? 4 : 1,
    type: position ? "int32" : "uint8",
    min: position ? [0, 0, 0] : [0],
    max: position ? [10, 20, 30] : [255],
    scale: position ? [1, 1, 1] : [1],
    offset: position ? [0, 0, 0] : [0],
  };
}

function pointRecord(
  position: readonly [number, number, number],
  intensity: number,
  opaqueVendorByte: number,
): Buffer {
  const record = Buffer.alloc(14);
  record.writeInt32LE(position[0], 0);
  record.writeInt32LE(position[1], 4);
  record.writeInt32LE(position[2], 8);
  record.writeUInt8(intensity, 12);
  record.writeUInt8(opaqueVendorByte, 13);
  return record;
}

async function makePotreeFixture(): Promise<{
  readonly root: string;
  readonly octreePath: string;
  readonly octree: Buffer;
}> {
  const octree = Buffer.concat([
    pointRecord([0, 0, 0], 10, 20),
    pointRecord([10_000, 20_000, 30_000], 255, 100),
  ]);
  const metadata = Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "room-envelope local-app fixture",
    points: 2,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: [0, 0, 0],
    scale: [0.001, 0.001, 0.001],
    spacing: 0.1,
    boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
    encoding: "DEFAULT",
    attributes: [
      attribute("position"),
      attribute("intensity"),
      attribute("lcc prediction"),
    ],
  }), "utf8");
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0);
  hierarchy.writeUInt32LE(2, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(BigInt(octree.byteLength), 14);
  const root = await mkdtemp(join(tmpdir(), "foundry-room-envelope-"));
  roots.push(root);
  for (const [relativePath, bytes] of Object.entries({
    "model/metadata.json": metadata,
    "model/hierarchy.bin": hierarchy,
    "model/octree.bin": octree,
  })) {
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return {
    root,
    octreePath: join(root, "model", "octree.bin"),
    octree,
  };
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no token");
  return token;
}

function request(
  app: LocalFoundryAppHandle,
  options: {
    readonly method?: "GET" | "POST";
    readonly path: string;
    readonly origin?: string;
    readonly body?: unknown;
  },
): Promise<HttpResult> {
  const serialized = options.body === undefined
    ? undefined
    : Buffer.from(JSON.stringify(options.body), "utf8");
  return new Promise((resolveResult, rejectResult) => {
    const outgoing = httpRequest({
      hostname: app.host,
      port: app.port,
      method: options.method ?? "GET",
      path: options.path,
      headers: {
        ...(options.origin === undefined ? {} : { Origin: options.origin }),
        ...(serialized === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "Content-Length": String(serialized.byteLength),
            }),
      },
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
    outgoing.on("error", rejectResult);
    if (serialized !== undefined) outgoing.write(serialized);
    outgoing.end();
  });
}

async function state(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await request(app, {
    path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForReady(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await state(app);
    if (current.phase === "ready") return current;
    if (current.phase === "failed") throw new Error("fixture inspection failed");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("local app did not become ready");
}

function reviewRequest(current: LocalFoundryPublicState) {
  const receipt = current.receipt;
  const diagnostic = current.pointValueDiagnostic;
  if (receipt === undefined || diagnostic === undefined) {
    throw new Error("ready state omitted exact V8 evidence");
  }
  const bundle = diagnostic.sourceFacts.state === "available"
    ? diagnostic.sourceFacts.pointValueBundles[0]
    : undefined;
  if (bundle?.pointValues.state !== "established") {
    throw new Error("fixture did not establish exact point previews");
  }
  const pointFacts = bundle.pointValues.facts;
  if (pointFacts === null) {
    throw new Error("fixture established no exact point facts");
  }
  return {
    receiptSha256: receipt.receiptSha256,
    sourceFactsSha256: diagnostic.sourceFacts.factsSha256,
    bundleSha256: bundle.bundleSha256,
    horizontalViewId: "position_0_1",
    reviewedPreviews: [
      "position_0_1",
      "position_0_2",
      "position_1_2",
    ].map((viewId) => {
      const image = pointFacts.previews.images.find(
        (candidate) =>
          candidate.viewId === viewId &&
          candidate.mode === "omitted_component",
      );
      if (image === undefined) throw new Error(`missing ${viewId} preview`);
      return {
        viewId: image.viewId,
        mode: image.mode,
        sha256: image.sha256,
        pixelSha256: image.pixelSha256,
      };
    }),
    polygonIntrinsicPixels: [[200, 0], [800, 0], [800, 1023], [200, 1023]],
    roomLabel: "Reception Room fixture",
    reviewerLabel: "Fixture reviewer",
    decision: "needs_revision",
    note: "Synthetic route coverage only.",
  };
}

describe("Foundry local app room-envelope review", () => {
  it("binds a strict POST to current V8 evidence and serves only the current canonical report", async () => {
    const fixture = await makePotreeFixture();
    let releaseInspection = (): void => undefined;
    const inspectionGate = new Promise<void>((resolveGate) => {
      releaseInspection = resolveGate;
    });
    const app = await startLocalFoundryApp({
      source: fixture.root,
      sourceInspectionTestHooks: {
        beforeSourceFactsInspection: () => inspectionGate,
      },
    });
    apps.push(app);
    const token = tokenFor(app);
    const unavailable = await state(app);
    expect(unavailable.roomEnvelopeReview).toMatchObject({
      state: "unavailable",
      establishedBundleCount: 0,
      report: null,
    });
    releaseInspection();
    const ready = await waitForReady(app);
    expect(ready.roomEnvelopeReview).toMatchObject({
      state: "ready",
      establishedBundleCount: 1,
      report: null,
    });
    const body = reviewRequest(ready);
    const path = `/api/room-envelope-review?token=${encodeURIComponent(token)}`;

    expect((await request(app, {
      method: "POST",
      path,
      body,
    })).status).toBe(403);
    expect((await request(app, {
      method: "POST",
      path,
      origin: app.origin,
      body: { ...body, reviewedAt: "2026-01-01T00:00:00.000Z" },
    })).status).toBe(400);

    const created = await request(app, {
      method: "POST",
      path,
      origin: app.origin,
      body,
    });
    expect(created.status).toBe(201);
    const completed = JSON.parse(created.body.toString("utf8")) as
      LocalFoundryPublicState["roomEnvelopeReview"];
    expect(completed).toMatchObject({
      state: "completed",
      establishedBundleCount: 1,
      report: {
        bundleSha256: body.bundleSha256,
        horizontalViewId: "position_0_1",
        decision: "needs_revision",
        includedRecordCount: 2,
        excludedRecordCount: 0,
        eligibility: "not_eligible",
        authority: "none",
      },
    });
    const reportDigest = completed.report?.reportSha256;
    expect(reportDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Date.parse(completed.report?.reviewedAt ?? "")).toBeGreaterThan(0);
    expect((await state(app)).roomEnvelopeReview).toEqual(completed);

    const reportResponse = await request(app, {
      path: `/api/room-envelope-review-report?token=${encodeURIComponent(token)}&digest=${reportDigest ?? ""}`,
    });
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-room-envelope-review-v0.json"',
    );
    const report = FoundryRoomEnvelopeReviewV0Schema.parse(
      JSON.parse(reportResponse.body.toString("utf8")),
    );
    expect(reportResponse.body.toString("utf8")).toBe(
      serializeFoundryRoomEnvelopeReviewV0(report),
    );
    expect(report.reportSha256).toBe(reportDigest);

    expect((await request(app, {
      path: `/api/room-envelope-review-report?token=${encodeURIComponent(token)}&digest=${"0".repeat(64)}`,
    })).status).toBe(409);
    expect((await request(app, {
      method: "POST",
      path,
      origin: app.origin,
      body: {
        ...body,
        reviewedPreviews: body.reviewedPreviews.map((preview, index) =>
          index === 0 ? { ...preview, sha256: "0".repeat(64) } : preview
        ),
      },
    })).status).toBe(409);
    expect((await state(app)).roomEnvelopeReview.report?.reportSha256).toBe(
      reportDigest,
    );
    expect(await readFile(fixture.octreePath)).toEqual(fixture.octree);
  }, 60_000);

  it("aborts and awaits the serialized review transition before closed resolves", async () => {
    const fixture = await makePotreeFixture();
    let signalWorkerEntered = (): void => undefined;
    const workerEntered = new Promise<void>((resolveEntered) => {
      signalWorkerEntered = resolveEntered;
    });
    let releaseWorker = (): void => undefined;
    const workerGate = new Promise<void>((resolveGate) => {
      releaseWorker = resolveGate;
    });
    const app = await startLocalFoundryApp({
      source: fixture.root,
      roomEnvelopeReviewTestHooks: {
        beforeWorker: async () => {
          signalWorkerEntered();
          await workerGate;
        },
      },
    });
    apps.push(app);
    const ready = await waitForReady(app);
    const submission = request(app, {
      method: "POST",
      path: `/api/room-envelope-review?token=${encodeURIComponent(tokenFor(app))}`,
      origin: app.origin,
      body: reviewRequest(ready),
    }).catch(() => null);
    await workerEntered;
    let stopSettled = false;
    const stopping = app.stop().then(() => {
      stopSettled = true;
    });
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    expect(stopSettled).toBe(false);
    releaseWorker();
    await stopping;
    await submission;
    await expect(app.closed).resolves.toEqual({ reason: "programmatic" });
    expect(app.getPhase()).toBe("stopped");
    expect(await readFile(fixture.octreePath)).toEqual(fixture.octree);
  }, 60_000);
});
