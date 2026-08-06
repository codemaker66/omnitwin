import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FoundryOperatorEvidenceChecklistV8Schema,
  FoundrySourceReadinessMapV8Schema,
  FoundryUniversalSourceFactsV8Schema,
  compileFoundryOperatorEvidenceChecklistV7,
  compileFoundrySourceReadinessMapV7,
  inspectUniversalIntakeWithSourceFactsV7,
  serializeFoundryOperatorEvidenceChecklistV7,
  serializeFoundryOperatorEvidenceChecklistV8,
  serializeFoundrySourceReadinessMapV7,
  serializeFoundrySourceReadinessMapV8,
  serializeUniversalSourceFactsV7Artifact,
  serializeUniversalSourceFactsV8Artifact,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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
  readonly originalOctree: Buffer;
}> {
  const originalOctree = Buffer.concat([
    pointRecord([0, 0, 0], 10, 20),
    pointRecord([10_000, 20_000, 30_000], 255, 100),
  ]);
  const metadata = Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "deterministic local-app Potree V8 fixture",
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
  hierarchy.writeUInt8(0, 1);
  hierarchy.writeUInt32LE(2, 2);
  hierarchy.writeBigUInt64LE(0n, 6);
  hierarchy.writeBigUInt64LE(BigInt(originalOctree.byteLength), 14);

  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-potree-v8-"));
  roots.push(root);
  const files = {
    "model/metadata.json": metadata,
    "model/hierarchy.bin": hierarchy,
    "model/octree.bin": originalOctree,
    "notes.txt": Buffer.from("not part of the Potree bundle\n", "utf8"),
  } as const;
  for (const [relativePath, bytes] of Object.entries(files)) {
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  return {
    root,
    octreePath: join(root, "model", "octree.bin"),
    originalOctree,
  };
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no token");
  return token;
}

function wrongTokenFor(token: string): string {
  return `${token.slice(0, -1)}${token.endsWith("x") ? "y" : "x"}`;
}

function sendRequest(
  app: LocalFoundryAppHandle,
  path: string,
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest({
      hostname: app.host,
      port: app.port,
      method: "GET",
      path,
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
    request.end();
  });
}

async function readState(
  app: LocalFoundryAppHandle,
): Promise<LocalFoundryPublicState> {
  const response = await sendRequest(
    app,
    `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  );
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForReady(
  app: LocalFoundryAppHandle,
): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === "ready") return state;
    if (state.phase === "failed") {
      throw new Error(`local app inspection failed: ${state.safeFailure ?? "unknown"}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error("local app did not reach ready");
}

async function waitForPhase(
  app: LocalFoundryAppHandle,
  expected: ReturnType<LocalFoundryAppHandle["getPhase"]>,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (app.getPhase() === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error(`local app did not reach ${expected}`);
}

async function waitForCleared(buffers: readonly Buffer[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (buffers.every((bytes) => bytes.every((value) => value === 0))) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error("point-preview candidate buffers were not cleared");
}

function previewPath(
  route: "/api/potree-point-preview" | "/api/potree-point-preview-download",
  values: {
    readonly token: string;
    readonly bundleSha256: string;
    readonly viewId: string;
    readonly mode: string;
    readonly sha256: string;
  },
): string {
  return `${route}?${new URLSearchParams(values).toString()}`;
}

describe("Foundry local app Potree V8 server integration", () => {
  it("publishes exact V8 artifacts and all digest-bound PNGs without changing V7 or source bytes", async () => {
    const fixture = await makePotreeFixture();
    const directV7 = await inspectUniversalIntakeWithSourceFactsV7(fixture.root);
    const directV7Readiness = compileFoundrySourceReadinessMapV7({
      receipt: directV7.receipt,
      sourceFacts: directV7.sourceFacts,
    });
    const directV7Checklist = compileFoundryOperatorEvidenceChecklistV7({
      readiness: directV7Readiness,
    });
    let releaseInspection = (): void => {
      throw new Error("inspection gate was not initialized");
    };
    const inspectionGate = new Promise<void>((resolveGate) => {
      releaseInspection = resolveGate;
    });
    const publishedPreviewBuffers: Buffer[] = [];
    const app = await startLocalFoundryApp({
      source: fixture.root,
      sourceInspectionTestHooks: {
        beforeSourceFactsInspection: () => inspectionGate,
        beforeSourceFactsPublication: (candidate) => {
          publishedPreviewBuffers.push(
            ...candidate.pointPreviewFiles.map((preview) => preview.bytes),
          );
        },
      },
    });
    apps.push(app);
    const token = tokenFor(app);

    const [notReady, previewNotReady] = await Promise.all([
      sendRequest(
        app,
        `/api/source-facts-v8?token=${encodeURIComponent(token)}&digest=${"0".repeat(64)}`,
      ),
      sendRequest(app, previewPath("/api/potree-point-preview", {
        token,
        bundleSha256: "0".repeat(64),
        viewId: "front",
        mode: "height",
        sha256: "0".repeat(64),
      })),
    ]);
    releaseInspection();
    expect(notReady.status).toBe(409);
    expect(notReady.body.toString("utf8")).toContain("not ready yet");
    expect(previewNotReady.status).toBe(409);
    expect(previewNotReady.body.toString("utf8")).toContain("not ready yet");

    const ready = await waitForReady(app);
    const legacyFacts = ready.sourceFacts;
    const legacyReadiness = ready.sourceReadiness;
    const legacyChecklist = ready.operatorEvidenceChecklist;
    const diagnostic = ready.pointValueDiagnostic;
    if (
      legacyFacts === undefined ||
      legacyReadiness === undefined ||
      legacyChecklist === undefined ||
      diagnostic === undefined
    ) {
      throw new Error("ready state omitted a legacy or V8 artifact");
    }

    expect(ready.receipt).toEqual(directV7.receipt);
    expect(legacyFacts).toEqual(directV7.sourceFacts);
    expect(legacyReadiness).toEqual(directV7Readiness);
    expect(legacyChecklist).toEqual(directV7Checklist);

    expect(FoundryUniversalSourceFactsV8Schema.parse(diagnostic.sourceFacts)).toEqual(
      diagnostic.sourceFacts,
    );
    expect(FoundrySourceReadinessMapV8Schema.parse(diagnostic.sourceReadiness)).toEqual(
      diagnostic.sourceReadiness,
    );
    expect(
      FoundryOperatorEvidenceChecklistV8Schema.parse(
        diagnostic.operatorEvidenceChecklist,
      ),
    ).toEqual(diagnostic.operatorEvidenceChecklist);
    expect(diagnostic.sourceFacts.inherited).toEqual(legacyFacts);
    expect(diagnostic.sourceFacts.inheritedFactsSha256).toBe(legacyFacts.factsSha256);
    expect(diagnostic.sourceReadiness.inherited).toEqual(legacyReadiness);
    expect(diagnostic.sourceReadiness.sourceFactsSha256).toBe(
      diagnostic.sourceFacts.factsSha256,
    );
    expect(diagnostic.sourceReadiness.inheritedReadinessSha256).toBe(
      legacyReadiness.readinessSha256,
    );
    expect(diagnostic.operatorEvidenceChecklist.inherited).toEqual(legacyChecklist);
    expect(diagnostic.operatorEvidenceChecklist.readinessSha256).toBe(
      diagnostic.sourceReadiness.readinessSha256,
    );
    expect(diagnostic.operatorEvidenceChecklist.inheritedChecklistSha256).toBe(
      legacyChecklist.checklistSha256,
    );
    expect(diagnostic.sourceFacts.summary.previewImageCount).toBe(12);
    expect(publishedPreviewBuffers).toHaveLength(12);
    expect(publishedPreviewBuffers.every(
      (bytes) => bytes.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    )).toBe(true);
    expect(JSON.stringify(ready)).not.toContain("pointPreviewFiles");
    expect(JSON.stringify(ready)).not.toContain(fixture.root);

    const legacyRoutes = [
      {
        path: `/api/source-facts?token=${encodeURIComponent(token)}&digest=${legacyFacts.factsSha256}`,
        fileName: "foundry-universal-source-facts-v7.json",
        body: `${serializeUniversalSourceFactsV7Artifact(legacyFacts)}\n`,
      },
      {
        path: `/api/source-readiness?token=${encodeURIComponent(token)}&digest=${legacyReadiness.readinessSha256}`,
        fileName: "foundry-source-readiness-map-v7.json",
        body: `${serializeFoundrySourceReadinessMapV7(legacyReadiness)}\n`,
      },
      {
        path: `/api/operator-evidence-checklist?token=${encodeURIComponent(token)}&digest=${legacyChecklist.checklistSha256}`,
        fileName: "foundry-operator-evidence-checklist-v7.json",
        body: `${serializeFoundryOperatorEvidenceChecklistV7(legacyChecklist)}\n`,
      },
    ] as const;
    for (const route of legacyRoutes) {
      const response = await sendRequest(app, route.path);
      expect(response.status).toBe(200);
      expect(response.headers["content-disposition"]).toBe(
        `attachment; filename="${route.fileName}"`,
      );
      expect(response.body.toString("utf8")).toBe(route.body);
    }

    const v8Routes = [
      {
        path: `/api/source-facts-v8?token=${encodeURIComponent(token)}&digest=${diagnostic.sourceFacts.factsSha256}`,
        fileName: "foundry-universal-source-facts-v8.json",
        artifact: diagnostic.sourceFacts,
        body: `${serializeUniversalSourceFactsV8Artifact(diagnostic.sourceFacts)}\n`,
      },
      {
        path: `/api/source-readiness-v8?token=${encodeURIComponent(token)}&digest=${diagnostic.sourceReadiness.readinessSha256}`,
        fileName: "foundry-source-readiness-map-v8.json",
        artifact: diagnostic.sourceReadiness,
        body: `${serializeFoundrySourceReadinessMapV8(diagnostic.sourceReadiness)}\n`,
      },
      {
        path: `/api/operator-evidence-checklist-v8?token=${encodeURIComponent(token)}&digest=${diagnostic.operatorEvidenceChecklist.checklistSha256}`,
        fileName: "foundry-operator-evidence-checklist-v8.json",
        artifact: diagnostic.operatorEvidenceChecklist,
        body: `${serializeFoundryOperatorEvidenceChecklistV8(diagnostic.operatorEvidenceChecklist)}\n`,
      },
    ] as const;
    for (const route of v8Routes) {
      const response = await sendRequest(app, route.path);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(response.headers["content-disposition"]).toBe(
        `attachment; filename="${route.fileName}"`,
      );
      expect(response.body.toString("utf8")).toBe(route.body);
      expect(JSON.parse(response.body.toString("utf8"))).toEqual(route.artifact);

      const pathname = route.path.split("?", 1)[0];
      if (pathname === undefined) throw new Error("V8 test route has no pathname");
      expect((await sendRequest(
        app,
        `${pathname}?token=${encodeURIComponent(wrongTokenFor(token))}&digest=${"0".repeat(64)}`,
      )).status).toBe(401);
      expect((await sendRequest(
        app,
        `${pathname}?token=${encodeURIComponent(token)}&digest=${"0".repeat(64)}`,
      )).status).toBe(409);
      expect((await sendRequest(
        app,
        `${route.path}&extra=forbidden`,
      )).status).toBe(401);
    }

    const bundle = diagnostic.sourceFacts.pointValueBundles[0];
    if (bundle?.pointValues.state !== "established") {
      throw new Error("fixture did not establish point-value previews");
    }
    const images = bundle.pointValues.facts.previews.images;
    expect(images).toHaveLength(12);
    for (const image of images) {
      const values = {
        token,
        bundleSha256: bundle.bundleSha256,
        viewId: image.viewId,
        mode: image.mode,
        sha256: image.sha256,
      };
      const inline = await sendRequest(
        app,
        previewPath("/api/potree-point-preview", values),
      );
      expect(inline.status).toBe(200);
      expect(inline.headers["content-type"]).toBe("image/png");
      expect(inline.headers["cache-control"]).toBe(
        "private, no-store, max-age=0, immutable",
      );
      expect(inline.headers["content-disposition"]).toBe(
        `inline; filename="${image.fileName}"`,
      );
      expect(inline.headers["content-length"]).toBe(String(image.byteLength));
      expect(inline.body.byteLength).toBe(image.byteLength);
      expect(createHash("sha256").update(inline.body).digest("hex")).toBe(
        image.sha256,
      );

      const download = await sendRequest(
        app,
        previewPath("/api/potree-point-preview-download", values),
      );
      expect(download.status).toBe(200);
      expect(download.headers["content-type"]).toBe("image/png");
      expect(download.headers["cache-control"]).toBe(
        "private, no-store, max-age=0, immutable",
      );
      expect(download.headers["content-disposition"]).toBe(
        `attachment; filename="${image.fileName}"`,
      );
      expect(download.headers["content-length"]).toBe(String(image.byteLength));
      expect(download.body).toEqual(inline.body);
    }

    const firstImage = images[0];
    if (firstImage === undefined) throw new Error("fixture has no preview image");
    const validPreview = {
      token,
      bundleSha256: bundle.bundleSha256,
      viewId: firstImage.viewId,
      mode: firstImage.mode,
      sha256: firstImage.sha256,
    };
    const wrongToken = wrongTokenFor(token);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview",
      { ...validPreview, token: wrongToken },
    ))).status).toBe(401);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview",
      { ...validPreview, bundleSha256: "0".repeat(64) },
    ))).status).toBe(409);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview",
      { ...validPreview, sha256: "0".repeat(64) },
    ))).status).toBe(409);
    expect((await sendRequest(
      app,
      `${previewPath("/api/potree-point-preview", validPreview)}&extra=forbidden`,
    )).status).toBe(401);
    expect((await sendRequest(
      app,
      `${previewPath("/api/potree-point-preview", validPreview)}&sha256=${firstImage.sha256}`,
    )).status).toBe(401);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview",
      { ...validPreview, viewId: "../source" },
    ))).status).toBe(409);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview-download",
      { ...validPreview, token: wrongToken },
    ))).status).toBe(401);
    expect((await sendRequest(app, previewPath(
      "/api/potree-point-preview-download",
      { ...validPreview, bundleSha256: "0".repeat(64) },
    ))).status).toBe(409);

    expect(await readFile(fixture.octreePath)).toEqual(fixture.originalOctree);
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");
    await app.stop();
    const zeroedPreviewCount = fillSpy.mock.calls.filter(
      ([value]) => value === 0,
    ).length;
    fillSpy.mockRestore();
    expect(zeroedPreviewCount).toBe(12);
    expect(publishedPreviewBuffers.every(
      (bytes) => bytes.every((value) => value === 0),
    )).toBe(true);
    await expect(app.closed).resolves.toEqual({ reason: "programmatic" });
    expect(await readFile(fixture.octreePath)).toEqual(fixture.originalOctree);
    await expect(sendRequest(
      app,
      previewPath("/api/potree-point-preview", validPreview),
    )).rejects.toBeDefined();
  }, 60_000);

  it("clears every unpublished candidate when point-preview validation fails", async () => {
    const fixture = await makePotreeFixture();
    const unpublishedBuffers: Buffer[] = [];
    const app = await startLocalFoundryApp({
      source: fixture.root,
      sourceInspectionTestHooks: {
        beforeSourceFactsPublication: (candidate) => {
          unpublishedBuffers.push(
            ...candidate.pointPreviewFiles.map((preview) => preview.bytes),
          );
          const first = unpublishedBuffers[0];
          if (first === undefined) throw new Error("fixture generated no point previews");
          first[0] = first[0] === 0 ? 1 : 0;
        },
      },
    });
    apps.push(app);

    await waitForPhase(app, "failed");
    expect(unpublishedBuffers).toHaveLength(12);
    expect(unpublishedBuffers.every(
      (bytes) => bytes.every((value) => value === 0),
    )).toBe(true);
    const state = await readState(app);
    expect(state.phase).toBe("failed");
    expect(state.pointValueDiagnostic).toBeUndefined();
    expect(await readFile(fixture.octreePath)).toEqual(fixture.originalOctree);
  }, 60_000);

  it("clears generated candidates when the app leaves inspection before publication", async () => {
    const fixture = await makePotreeFixture();
    const unpublishedBuffers: Buffer[] = [];
    let reportCandidates = (): void => {
      throw new Error("candidate notification was not initialized");
    };
    const candidatesReported = new Promise<void>((resolveReported) => {
      reportCandidates = resolveReported;
    });
    let releasePublication = (): void => {
      throw new Error("publication gate was not initialized");
    };
    const publicationGate = new Promise<void>((resolvePublication) => {
      releasePublication = resolvePublication;
    });
    const app = await startLocalFoundryApp({
      source: fixture.root,
      sourceInspectionTestHooks: {
        beforeSourceFactsPublication: async (candidate) => {
          unpublishedBuffers.push(
            ...candidate.pointPreviewFiles.map((preview) => preview.bytes),
          );
          reportCandidates();
          await publicationGate;
        },
      },
    });
    apps.push(app);

    await candidatesReported;
    expect(unpublishedBuffers).toHaveLength(12);
    expect(unpublishedBuffers.some(
      (bytes) => bytes.some((value) => value !== 0),
    )).toBe(true);
    await app.stop();
    expect(app.getPhase()).toBe("stopped");
    releasePublication();
    await waitForCleared(unpublishedBuffers);
    await expect(app.closed).resolves.toEqual({ reason: "programmatic" });
    expect(await readFile(fixture.octreePath)).toEqual(fixture.originalOctree);
  }, 60_000);
});
