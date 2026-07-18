import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync, zstdCompressSync } from "node:zlib";
import {
  FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V5_DIGEST_DOMAIN,
  FOUNDRY_SOURCE_READINESS_MAP_V5_DIGEST_DOMAIN,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5_DIGEST_DOMAIN,
  serializeFoundryOperatorEvidenceChecklistV5,
  serializeFoundrySourceReadinessMapV5,
  serializeUniversalSourceFactsV5Artifact,
  type FoundryOperatorEvidenceChecklistV5,
  type FoundrySourceReadinessMapV5,
  type FoundryUniversalIntakeReceipt,
  type FoundryUniversalSourceFactsV5,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_FOUNDRY_DEFAULT_SESSION_TTL_MS,
  LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES,
  localFoundryBrowserLaunchSpec,
  openLocalFoundryAppInBrowser,
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => {
    if (app.getPhase() !== "stopped") await app.stop();
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

async function makeSmallFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "copies"));
  const obj = "# small fixture\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
  await Promise.all([
    writeFile(join(root, "triangle.obj"), obj),
    writeFile(join(root, "copies", "triangle-copy.obj"), obj),
    writeFile(join(root, "notes.txt"), "capture notes\n"),
  ]);
  return root;
}

async function makeSmallSpzFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-spz-"));
  temporaryDirectories.push(root);
  const count = 4;
  const decompressed = Buffer.alloc(16 + count * 20);
  decompressed.writeUInt32LE(0x5053474e, 0);
  decompressed.writeUInt32LE(3, 4);
  decompressed.writeUInt32LE(count, 8);
  decompressed.writeUInt8(0, 12);
  decompressed.writeUInt8(12, 13);
  for (let index = 16; index < decompressed.length; index += 1) {
    decompressed[index] = index & 0xff;
  }
  await Promise.all([
    writeFile(join(root, "scene.spz"), gzipSync(decompressed)),
    writeFile(
      join(root, "cloud.ply"),
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n",
    ),
  ]);
  return root;
}

async function makeSmallGaussianPlyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-gaussian-ply-"));
  temporaryDirectories.push(root);
  const restNames = Array.from({ length: 24 }, (_, index) => `f_rest_${String(index)}`)
    .sort();
  const propertyNames = [
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    ...restNames,
    "opacity",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
    "scale_0",
    "scale_1",
    "scale_2",
    "x",
    "y",
    "z",
  ];
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment Exported from Brush",
    "comment Vertical axis: y",
    "comment SH degree: 2",
    "element vertex 2",
    ...propertyNames.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n");
  await writeFile(
    join(root, "scene.ply"),
    Buffer.concat([
      Buffer.from(header, "ascii"),
      Buffer.alloc(2 * propertyNames.length * 4),
    ]),
  );
  return root;
}

async function makeSmallPngFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-media-v4-"));
  temporaryDirectories.push(root);
  await writeFile(
    join(root, "reference.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  return root;
}

async function makeRegistrationDocumentFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-registration-v5-"));
  temporaryDirectories.push(root);
  await Promise.all([
    writeFile(
      join(root, "poses.csv"),
      [
        "1780322782.895321,0.000415,0.001354,0.004690,-0.505607,0.009709,-0.001803,0.862707",
        "1780322782.995328,0.000481,0.001416,0.005078,-0.505696,0.009559,-0.002523,0.862655",
        "",
      ].join("\n"),
    ),
    writeFile(
      join(root, "camera-calibration.json"),
      '{"camera_model":"PINHOLE","fl_x":512,"frames":[]}',
    ),
  ]);
  return root;
}

function makeSpzExtensionRecord(type: number, payload: Buffer): Buffer {
  const record = Buffer.alloc(8 + payload.length);
  record.writeUInt32LE(type, 0);
  record.writeUInt32LE(payload.length, 4);
  payload.copy(record, 8);
  return record;
}

async function makeSmallSpzV4Fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-app-spz-v4-"));
  temporaryDirectories.push(root);
  const count = 3;
  const degree = 2;
  const coordinatePayload = Buffer.alloc(4);
  coordinatePayload.writeUInt32LE(7, 0);
  const extensions = Buffer.concat([
    makeSpzExtensionRecord(0xadbe0003, coordinatePayload),
    makeSpzExtensionRecord(0x12345678, Buffer.from([1, 2, 3])),
  ]);
  const streamSizes = [count * 9, count, count * 3, count * 3, count * 4, count * 24];
  const streams = streamSizes.map((size, streamIndex) => {
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) {
      bytes[index] = (streamIndex * 31 + index) & 0xff;
    }
    return zstdCompressSync(bytes);
  });
  const tocOffset = 32 + extensions.length;
  const tocBytes = streams.length * 16;
  const headerAndToc = Buffer.alloc(tocOffset + tocBytes);
  headerAndToc.writeUInt32LE(0x5053474e, 0);
  headerAndToc.writeUInt32LE(4, 4);
  headerAndToc.writeUInt32LE(count, 8);
  headerAndToc.writeUInt8(degree, 12);
  headerAndToc.writeUInt8(12, 13);
  headerAndToc.writeUInt8(0x03, 14);
  headerAndToc.writeUInt8(streams.length, 15);
  headerAndToc.writeUInt32LE(tocOffset, 16);
  extensions.copy(headerAndToc, 32);
  for (const [index, stream] of streams.entries()) {
    headerAndToc.writeBigUInt64LE(BigInt(stream.length), tocOffset + index * 16);
    headerAndToc.writeBigUInt64LE(BigInt(streamSizes[index] ?? 0), tocOffset + index * 16 + 8);
  }
  await writeFile(join(root, "scene-v4.spz"), Buffer.concat([headerAndToc, ...streams]));
  return root;
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
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
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

async function readState(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await sendRequest(app, {
    path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as LocalFoundryPublicState;
}

async function waitForPhase(
  app: LocalFoundryAppHandle,
  phase: LocalFoundryPublicState["phase"],
): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === phase) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error(`local app did not reach ${phase}`);
}

describe("Foundry local companion app", () => {
  it("gives a large guided review four hours while retaining bounded expiry", () => {
    expect(LOCAL_FOUNDRY_DEFAULT_SESSION_TTL_MS).toBe(4 * 60 * 60 * 1_000);
  });

  it("pins the active Source Facts V5 evidence-chain digest domains", () => {
    expect(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5_DIGEST_DOMAIN).toBe(
      "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5",
    );
    expect(FOUNDRY_SOURCE_READINESS_MAP_V5_DIGEST_DOMAIN).toBe(
      "VENVIEWER_FOUNDRY_SOURCE_READINESS_MAP_V5",
    );
    expect(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V5_DIGEST_DOMAIN).toBe(
      "VENVIEWER_FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V5",
    );
  });

  it("keeps PNG container facts separate from capture role and downloads the exact V5 chain", async () => {
    const source = await makeSmallPngFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.receipt?.files[0]?.detection.candidates.map((candidate) => candidate.inputType)).toEqual([
      "dslr_image",
      "generic_image",
      "matterport_panorama",
      "panorama_360",
      "phone_image",
    ]);
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 0,
      },
      assets: [{
        source: {
          path: "reference.png",
          inputType: "generic_image",
          receiptCandidateInputTypes: [
            "matterport_panorama",
            "dslr_image",
            "generic_image",
            "panorama_360",
            "phone_image",
          ],
        },
        format: "png",
        inspection: {
          state: "established",
          code: "MEDIA_CONTAINER_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: { format: "png" },
      }],
    });
    if (ready.sourceFacts?.state !== "available") {
      throw new Error("PNG ready state has no available Source Facts V5 artifact");
    }
    const mediaUnknownCodes = ready.sourceFacts.assets[0]?.unknowns.map((unknown) => unknown.code);
    expect(mediaUnknownCodes).toEqual(expect.arrayContaining([
      "MEDIA_CAPTURE_ROLE_UNKNOWN",
      "MEDIA_PROVENANCE_CLASS_UNKNOWN",
      "MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN",
      "MEDIA_RIGHTS_UNKNOWN",
    ]));
    expect(mediaUnknownCodes).toHaveLength(10);

    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      summary: { factsEstablishedCount: 1, outsideSourceFactsV5Count: 0 },
      files: [{
        path: "reference.png",
        status: "facts_established",
        inputType: "generic_image",
        format: "png",
        laneIds: ["image_video"],
      }],
    });
    if (ready.operatorEvidenceChecklist?.state !== "available") {
      throw new Error("PNG ready state has no available Operator Evidence Checklist V5");
    }
    expect(
      ready.operatorEvidenceChecklist.items
        .filter((item) => item.evidenceCode.startsWith("MEDIA_"))
        .map((item) => item.evidenceCode),
    ).toEqual(expect.arrayContaining(mediaUnknownCodes ?? []));

    const token = encodeURIComponent(tokenFor(app));
    const receiptResponse = await sendRequest(app, {
      path: `/api/receipt?token=${token}`,
    });
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-universal-intake-receipt-v0.json\"",
    );
    expect(JSON.parse(receiptResponse.body)).toEqual(ready.receipt);

    const factsResponse = await sendRequest(app, {
      path: `/api/source-facts?token=${token}&digest=${ready.sourceFacts.factsSha256}`,
    });
    expect(factsResponse.status).toBe(200);
    expect(factsResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-universal-source-facts-v5.json\"",
    );
    expect(factsResponse.body).toBe(
      `${serializeUniversalSourceFactsV5Artifact(ready.sourceFacts)}\n`,
    );

    const readiness = ready.sourceReadiness;
    if (readiness === undefined) throw new Error("PNG ready state has no readiness artifact");
    const readinessResponse = await sendRequest(app, {
      path: `/api/source-readiness?token=${token}&digest=${readiness.readinessSha256}`,
    });
    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-source-readiness-map-v5.json\"",
    );
    expect(readinessResponse.body).toBe(`${serializeFoundrySourceReadinessMapV5(readiness)}\n`);

    const checklist = ready.operatorEvidenceChecklist;
    const checklistResponse = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${token}&digest=${checklist.checklistSha256}`,
    });
    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-operator-evidence-checklist-v5.json\"",
    );
    expect(checklistResponse.body).toBe(
      `${serializeFoundryOperatorEvidenceChecklistV5(checklist)}\n`,
    );
  });

  it("renders and downloads bounded calibration and trajectory document evidence in V5", async () => {
    const app = await startLocalFoundryApp({
      source: await makeRegistrationDocumentFixture(),
    });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: { assetCount: 2, establishedCount: 2 },
      assets: [
        {
          source: {
            path: "camera-calibration.json",
            inputType: "calibration_bundle",
          },
          format: "json",
          inspection: { coverage: "complete_json_syntax_and_shape" },
        },
        {
          source: { path: "poses.csv", inputType: "trajectory" },
          format: "csv",
          inspection: { coverage: "complete_record_structure" },
          facts: {
            records: {
              count: 2,
              uniformFieldCount: true,
              minimumFieldCount: 8,
              maximumFieldCount: 8,
            },
          },
        },
      ],
    });
    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      summary: { factsEstablishedCount: 2, outsideSourceFactsV5Count: 0 },
      files: [
        {
          path: "camera-calibration.json",
          laneIds: ["registration_and_control"],
        },
        { path: "poses.csv", laneIds: ["registration_and_control"] },
      ],
    });
    if (ready.operatorEvidenceChecklist?.state !== "available") {
      throw new Error("registration-document V5 checklist is unavailable");
    }
    const evidenceCodes = ready.operatorEvidenceChecklist.items.map(
      (item) => item.evidenceCode,
    );
    expect(evidenceCodes).toEqual(expect.arrayContaining([
      "CALIBRATION_EXTRINSIC_CONVENTION_UNKNOWN",
      "CALIBRATION_UNCERTAINTY_AND_VALIDATION_UNKNOWN",
      "TRAJECTORY_CLOCK_DOMAIN_AND_TIME_UNITS_UNKNOWN",
      "TRAJECTORY_COORDINATE_FRAME_AND_UNITS_UNKNOWN",
    ]));
    expect(ready.operatorEvidenceChecklist.policy).toMatchObject({
      execution: "not_authorized",
      authority: "none",
      accuracy: "not_evaluated",
      registration: "not_evaluated",
    });

    if (ready.sourceFacts === undefined) throw new Error("missing Source Facts V5");
    const response = await sendRequest(app, {
      path: `/api/source-facts?token=${encodeURIComponent(tokenFor(app))}&digest=${ready.sourceFacts.factsSha256}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-universal-source-facts-v5.json"',
    );
    expect(response.body).toBe(
      `${serializeUniversalSourceFactsV5Artifact(ready.sourceFacts)}\n`,
    );

    if (ready.sourceReadiness === undefined) throw new Error("missing Source Readiness Map V5");
    const readinessResponse = await sendRequest(app, {
      path: `/api/source-readiness?token=${encodeURIComponent(tokenFor(app))}&digest=${ready.sourceReadiness.readinessSha256}`,
    });
    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-source-readiness-map-v5.json"',
    );
    expect(readinessResponse.body).toBe(
      `${serializeFoundrySourceReadinessMapV5(ready.sourceReadiness)}\n`,
    );

    const checklistResponse = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(tokenFor(app))}&digest=${ready.operatorEvidenceChecklist.checklistSha256}`,
    });
    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-operator-evidence-checklist-v5.json"',
    );
    expect(checklistResponse.body).toBe(
      `${serializeFoundryOperatorEvidenceChecklistV5(ready.operatorEvidenceChecklist)}\n`,
    );
  });

  it("refuses every non-loopback bind address", async () => {
    await expect(startLocalFoundryApp({
      source: "capture",
      host: "0.0.0.0",
    })).rejects.toThrow("only to 127.0.0.1");
    await expect(startLocalFoundryApp({
      source: "capture",
      host: "localhost",
    })).rejects.toThrow("only to 127.0.0.1");
  });

  it("uses a different high-entropy token for each local session", async () => {
    const first = await startLocalFoundryApp({ source: "capture-a" });
    const second = await startLocalFoundryApp({ source: "capture-b" });
    openApps.push(first, second);

    expect(tokenFor(first)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokenFor(second)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokenFor(first)).not.toBe(tokenFor(second));
  });

  it("replaces control and bidirectional source names with a safe display label", async () => {
    const app = await startLocalFoundryApp({
      source: `C:\\captures\\client-${String.fromCodePoint(0x202e)}gpj.exe`,
    });
    openApps.push(app);
    expect(app.sourceLabel).toBe("selected source");
    expect(JSON.stringify(await waitForPhase(app, "failed"))).not.toContain(String.fromCodePoint(0x202e));
  });

  it("shows inspecting, ready, and not-approved-yet states using a real small fixture", async () => {
    const source = await makeSmallFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);

    expect(app.getPhase()).toBe("inspecting");
    const ready = await waitForPhase(app, "ready");
    expect(ready.safety).toEqual({
      sourceAccess: "read_only",
      networkScope: "this_computer_only",
      uploads: "disabled",
      reconstruction: "disabled",
      admission: "draft_only",
      planning: "preview_only",
      execution: "disabled",
      authority: "none",
    });
    expect(ready.progress.message).toContain("No files are approved yet");
    expect(ready.receipt?.summary).toMatchObject({ fileCount: 3, duplicateGroupCount: 1 });
    expect(ready.receipt?.files.every((file) => file.status === "quarantined")).toBe(true);
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: {
        receiptFileCount: 3,
        assetCount: 2,
        establishedCount: 2,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 1,
        blockedSourceCount: 0,
      },
      policy: {
        mutation: "none",
        reconstruction: "none",
        networkAccess: "none",
        authority: "none",
        rights: "not_evaluated",
      },
    });
    expect(ready.sourceFacts?.state === "available" && ready.sourceFacts.assets.map((asset) => asset.source.path)).toEqual([
      "copies/triangle-copy.obj",
      "triangle.obj",
    ]);
    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      receiptSha256: ready.receipt?.receiptSha256,
      sourceFactsSha256: ready.sourceFacts?.factsSha256,
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        networkAccess: "none",
        routeCompilation: "none",
        recipeCompilation: "none",
        workerSelection: "none",
        providerSelection: "none",
        execution: "not_authorized",
        authority: "none",
      },
      summary: { receiptFileCount: 3, representedFileCount: 3 },
    });
    if (ready.sourceReadiness?.state !== "available") {
      throw new Error("ready state has no available Source Readiness map");
    }
    expect(ready.sourceReadiness.files.map((file) => [file.path, file.status])).toEqual([
      ["copies/triangle-copy.obj", "facts_established"],
      ["notes.txt", "unclassified_format"],
      ["triangle.obj", "facts_established"],
    ]);
    expect(ready.sourceReadiness.lanes.find((lane) => lane.id === "mesh_geometry")).toMatchObject({
      status: "all_observed_facts_established",
      counts: { observedFileCount: 2, distinctContentCount: 1, factsEstablishedCount: 2 },
    });
    expect(ready.operatorEvidenceChecklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v5",
      state: "available",
      receiptSha256: ready.receipt?.receiptSha256,
      sourceFactsSha256: ready.sourceFacts?.factsSha256,
      readinessSha256: ready.sourceReadiness.readinessSha256,
      policy: {
        requestPerformance: "none",
        completionTracking: "none",
        desiredOutputProfile: "not_bound",
        prioritization: "evidence_dependency_only",
        necessity: "not_evaluated",
        execution: "not_authorized",
        authority: "none",
      },
      summary: {
        receiptFileCount: 3,
        evidenceRequestCount: 10,
        highCount: 1,
        normalCount: 8,
        conditionalCount: 1,
        affectedSourceCount: 3,
        distinctContentCount: 2,
      },
    });
    if (ready.operatorEvidenceChecklist?.state !== "available") {
      throw new Error("ready state has no available Operator Evidence Checklist");
    }
    expect(ready.operatorEvidenceChecklist.items.map((item) => item.evidenceCode)).toEqual(
      expect.arrayContaining([
        "UNCLASSIFIED_FORMAT",
        "OBJ_ACCURACY_UNKNOWN",
        "OBJ_RIGHTS_UNKNOWN",
        "NO_SOURCE_OBSERVED",
      ]),
    );
  });

  it("establishes SPZ facts in the active V5 chain and downloads the exact artifact", async () => {
    const source = await makeSmallSpzFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: {
        receiptFileCount: 2,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 1,
      },
      assets: [{
        source: { path: "scene.spz", inputType: "spz" },
        format: "spz",
        inspection: { state: "established", code: "SPZ_FORMAT_FACTS_ESTABLISHED" },
        facts: {
          format: "spz_legacy_gzip",
          version: 3,
          count: 4,
          sphericalHarmonics: { degree: 0 },
        },
      }],
    });
    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      summary: { factsEstablishedCount: 1, outsideSourceFactsV5Count: 1 },
      files: [
        { path: "cloud.ply", status: "outside_source_facts_v5" },
        { path: "scene.spz", status: "facts_established", laneIds: ["visual_scene_representation"] },
      ],
    });
    expect(ready.operatorEvidenceChecklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v5",
      state: "available",
    });
    if (ready.operatorEvidenceChecklist?.state !== "available") {
      throw new Error("SPZ ready state has no available V5 Operator Evidence Checklist");
    }
    expect(ready.operatorEvidenceChecklist.items.map((item) => item.evidenceCode)).toEqual(
      expect.arrayContaining([
        "OUTSIDE_SOURCE_FACTS_V5",
        "SPZ_ATTRIBUTE_VALUES_UNKNOWN",
        "SPZ_RIGHTS_UNKNOWN",
      ]),
    );

    const facts = ready.sourceFacts;
    if (facts === undefined) throw new Error("SPZ ready state has no Source Facts V5 artifact");
    const response = await sendRequest(app, {
      path: `/api/source-facts?token=${encodeURIComponent(tokenFor(app))}&digest=${facts.factsSha256}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-universal-source-facts-v5.json\"",
    );
    expect(response.body).toBe(`${serializeUniversalSourceFactsV5Artifact(facts)}\n`);
    expect(JSON.stringify(JSON.parse(response.body))).not.toContain(source);
  });

  it("establishes order-independent classic Gaussian PLY facts and exposes its evidence requests", async () => {
    const source = await makeSmallGaussianPlyFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
        untargetedFileCount: 0,
      },
      assets: [{
        source: { path: "scene.ply", inputType: "gaussian_ply" },
        format: "gaussian_ply",
        inspection: {
          state: "established",
          code: "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: {
          format: "gaussian_ply_binary_little_endian",
          plyVersion: "1.0",
          gaussians: {
            count: 2,
            vertexStrideBytes: 152,
            payloadBytes: 304,
            sphericalHarmonics: {
              degree: 2,
              nonDcPropertyCount: 24,
              indicesContiguous: true,
            },
            normals: { state: "absent", offsets: [] },
          },
          container: { exactFileLengthVerified: true },
        },
      }],
    });
    if (ready.sourceFacts?.state !== "available") {
      throw new Error("Gaussian PLY ready state has no available Source Facts V5 artifact");
    }
    const plyFacts = ready.sourceFacts.assets[0]?.facts;
    expect(plyFacts).toMatchObject({
      gaussians: {
        properties: expect.arrayContaining([
          expect.objectContaining({
            name: "f_rest_10",
            role: "spherical_harmonics_non_dc",
            roleIndex: 10,
          }),
          expect.objectContaining({ name: "x", role: "position", roleIndex: 0 }),
        ]),
      },
    });
    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "available",
      summary: { factsEstablishedCount: 1, outsideSourceFactsV5Count: 0 },
      files: [{
        path: "scene.ply",
        status: "facts_established",
        laneIds: ["visual_scene_representation"],
      }],
    });
    if (ready.operatorEvidenceChecklist?.state !== "available") {
      throw new Error("Gaussian PLY ready state has no available Operator Evidence Checklist V5");
    }
    expect(ready.operatorEvidenceChecklist.items.map((item) => item.evidenceCode)).toEqual(
      expect.arrayContaining([
        "GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN",
        "GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN",
        "GAUSSIAN_PLY_RIGHTS_UNKNOWN",
      ]),
    );
  });

  it("preserves nested SPZ v4 extension and six-stream facts through the local HTTP artifact path", async () => {
    const source = await makeSmallSpzV4Fixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "available",
      summary: {
        receiptFileCount: 1,
        assetCount: 1,
        establishedCount: 1,
        factsNotEstablishedCount: 0,
      },
      assets: [{
        source: { path: "scene-v4.spz", inputType: "spz" },
        format: "spz",
        inspection: { state: "established", code: "SPZ_FORMAT_FACTS_ESTABLISHED" },
        facts: {
          format: "spz_v4_zstd",
          version: 4,
          count: 3,
          antialiased: true,
          sphericalHarmonics: {
            degree: 2,
            nonDcCoefficientCount: 8,
            bytesPerGaussian: 24,
          },
          extensions: {
            declared: true,
            totalBytes: 23,
            records: [
              {
                typeCodeHex: "adbe0003",
                payloadBytes: 4,
                recognizedType: "adobe_coordinate_system",
              },
              {
                typeCodeHex: "12345678",
                payloadBytes: 3,
                recognizedType: "unknown",
              },
            ],
          },
          container: {
            kind: "v4_zstd_multistream",
            tocByteOffset: 55,
            tocBytes: 96,
            streamCount: 6,
            totalUncompressedStreamBytes: 132,
            compressedStreamsEndAtFileEnd: true,
            streams: [
              { role: "positions", uncompressedSizeBytes: 27 },
              { role: "alphas", uncompressedSizeBytes: 3 },
              { role: "colors_dc", uncompressedSizeBytes: 9 },
              { role: "scales", uncompressedSizeBytes: 9 },
              { role: "rotations", uncompressedSizeBytes: 12 },
              { role: "spherical_harmonics_non_dc", uncompressedSizeBytes: 72 },
            ],
          },
        },
      }],
    });

    const facts = ready.sourceFacts;
    if (facts === undefined || facts.state !== "available") {
      throw new Error("SPZ v4 ready state has no available Source Facts V5 artifact");
    }
    const response = await sendRequest(app, {
      path: `/api/source-facts?token=${encodeURIComponent(tokenFor(app))}&digest=${facts.factsSha256}`,
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe(`${serializeUniversalSourceFactsV5Artifact(facts)}\n`);
    const downloaded = JSON.parse(response.body) as FoundryUniversalSourceFactsV5;
    expect(downloaded.assets[0]?.facts).toEqual(facts.assets[0]?.facts);
    expect(downloaded.assets[0]?.facts).toMatchObject({
      extensions: {
        records: expect.arrayContaining([
          expect.objectContaining({ typeCodeHex: "adbe0003" }),
        ]),
      },
      container: {
        streams: expect.arrayContaining([
          expect.objectContaining({
            role: "positions",
            completeZstdDecompressionVerified: true,
          }),
          expect.objectContaining({
            role: "spherical_harmonics_non_dc",
            completeZstdDecompressionVerified: true,
          }),
        ]),
      },
    });
    expect(JSON.stringify(downloaded)).not.toContain(source);
  });

  it("keeps mixed XBIN sources on one official-export stop with no partial source facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-local-app-xbin-"));
    temporaryDirectories.push(root);
    await Promise.all([
      writeFile(join(root, "open.obj"), "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"),
      writeFile(join(root, "vendor.xbin"), Buffer.from("XBAGopaque", "ascii")),
    ]);
    const app = await startLocalFoundryApp({ source: root });
    openApps.push(app);

    const ready = await waitForPhase(app, "ready");
    expect(ready.sourceFacts).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v5",
      state: "unavailable",
      assets: [],
      summary: { receiptFileCount: 2, assetCount: 0, blockedSourceCount: 1 },
      reason: { code: "XGRIDS_XBIN_UNSUPPORTED" },
      affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
    });
    expect(ready.sourceReadiness).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v5",
      state: "blocked",
      files: [],
      blockedReason: {
        affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
      },
    });
    if (ready.sourceReadiness?.state !== "blocked") {
      throw new Error("XBIN ready state has no blocked Source Readiness map");
    }
    expect(ready.sourceReadiness.lanes).toHaveLength(8);
    expect(ready.sourceReadiness.lanes.every((lane) =>
      lane.status === "blocked" && lane.representedSources.length === 0
    )).toBe(true);
    expect(ready.operatorEvidenceChecklist).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v5",
      state: "blocked",
      groups: [],
      items: [],
      summary: { evidenceRequestCount: 1, blockingCount: 1 },
      blockedReason: {
        category: "official_export",
        evidencePriority: "blocking",
        affectedSources: [{ path: "vendor.xbin" }],
      },
    });
    if (ready.operatorEvidenceChecklist?.state !== "blocked") {
      throw new Error("XBIN ready state has no blocked Operator Evidence Checklist");
    }

    const token = tokenFor(app);
    const stale = await sendRequest(app, {
      path: `/api/source-readiness?token=${encodeURIComponent(token)}&digest=${"0".repeat(64)}`,
    });
    expect(stale.status).toBe(409);
    const downloaded = await sendRequest(app, {
      path: `/api/source-readiness?token=${encodeURIComponent(token)}&digest=${ready.sourceReadiness.readinessSha256}`,
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toBe(`${serializeFoundrySourceReadinessMapV5(ready.sourceReadiness)}\n`);
    expect(JSON.parse(downloaded.body)).toMatchObject({
      state: "blocked",
      files: [],
      gaps: [],
      blockedReason: { affectedSources: [{ path: "vendor.xbin" }] },
    });
    expect(downloaded.body).not.toContain(root);
    expect(downloaded.body).not.toContain("open.obj");

    const staleChecklist = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(token)}&digest=${"0".repeat(64)}`,
    });
    expect(staleChecklist.status).toBe(409);
    const downloadedChecklist = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(token)}&digest=${ready.operatorEvidenceChecklist.checklistSha256}`,
    });
    expect(downloadedChecklist.status).toBe(200);
    expect(downloadedChecklist.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-operator-evidence-checklist-v5.json\"",
    );
    expect(downloadedChecklist.body).toBe(
      `${serializeFoundryOperatorEvidenceChecklistV5(ready.operatorEvidenceChecklist)}\n`,
    );
    expect(downloadedChecklist.body).not.toContain(root);
    expect(downloadedChecklist.body).not.toContain("open.obj");
  });

  it("enforces token, host, origin, fixed-route, and body-size boundaries", async () => {
    const source = await makeSmallFixture();
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const ready = await waitForPhase(app, "ready");
    const token = tokenFor(app);
    const validPath = `/api/state?token=${encodeURIComponent(token)}`;

    const shell = await sendRequest(app, { path: `/?token=${encodeURIComponent(token)}` });
    expect(shell.status).toBe(200);
    expect(shell.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(shell.headers["referrer-policy"]).toBe("no-referrer");
    expect(shell.headers["cache-control"]).toContain("no-store");
    expect(shell.headers["access-control-allow-origin"]).toBeUndefined();
    const browserScript = await sendRequest(app, { path: "/app.js" });
    expect(browserScript.status).toBe(200);
    expect(browserScript.body).toContain("if (!response.ok)");
    expect(browserScript.body).toContain("The server may still be running");

    expect((await sendRequest(app, { path: "/api/state" })).status).toBe(401);
    expect((await sendRequest(app, { path: "/api/state?token=wrong" })).status).toBe(401);
    expect((await sendRequest(app, {
      path: validPath,
      headers: { Origin: "https://attacker.example" },
    })).status).toBe(403);
    expect((await sendRequest(app, {
      path: validPath,
      headers: { Host: "attacker.example" },
    })).status).toBe(421);
    expect((await sendRequest(app, {
      path: `${validPath}&source=C%3A%5Cprivate%5Csecret.e57`,
    })).status).toBe(401);

    const injectedRoute = await sendRequest(app, {
      path: `/C:/private/secret.e57?token=${encodeURIComponent(token)}`,
    });
    expect(injectedRoute.status).toBe(404);
    expect(injectedRoute.body).not.toContain("secret.e57");
    for (const method of ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect((await sendRequest(app, {
        method,
        path: `/api/source-readiness?token=${encodeURIComponent(token)}`,
      })).status).toBe(405);
      expect((await sendRequest(app, {
        method,
        path: `/api/operator-evidence-checklist?token=${encodeURIComponent(token)}`,
      })).status).toBe(405);
    }
    expect(ready.receipt?.source.label).toBe(basename(source));
    expect(ready.receipt?.files.map((file) => file.path)).toEqual([
      "copies/triangle-copy.obj",
      "notes.txt",
      "triangle.obj",
    ]);

    const pathBody = JSON.stringify({ source: "C:\\private\\secret.e57" });
    const rejectedBody = await sendRequest(app, {
      method: "POST",
      path: `/api/stop?token=${encodeURIComponent(token)}`,
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(pathBody)),
      },
      body: pathBody,
    });
    expect(rejectedBody.status).toBe(400);
    expect(rejectedBody.body).not.toContain("secret.e57");

    const oversized = "x".repeat(LOCAL_FOUNDRY_MAX_REQUEST_BODY_BYTES + 1);
    const rejectedLargeBody = await sendRequest(app, {
      method: "POST",
      path: `/api/stop?token=${encodeURIComponent(token)}`,
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(oversized)),
      },
      body: oversized,
    });
    expect(rejectedLargeBody.status).toBe(413);
    expect(app.getPhase()).toBe("ready");
  });

  it("keeps absolute paths and private errors out of every browser response", async () => {
    const source = "C:\\sensitive\\client-a\\secret-capture.e57";
    const app = await startLocalFoundryApp({
      source,
    });
    openApps.push(app);

    const failed = await waitForPhase(app, "failed");
    const encoded = JSON.stringify(failed);
    expect(encoded).not.toContain("C:\\\\sensitive");
    expect(encoded).not.toContain("client-a");
    expect(encoded).not.toContain("ENOENT");
    expect(failed.sourceLabel).toBe("secret-capture.e57");
    expect(failed.safeFailure).toContain("could not be read safely");
    expect(failed.receipt).toBeUndefined();
    expect(failed.sourceFacts).toBeUndefined();
    expect(failed.sourceReadiness).toBeUndefined();
    expect(failed.operatorEvidenceChecklist).toBeUndefined();
    const checklistResponse = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(tokenFor(app))}&digest=${"0".repeat(64)}`,
    });
    expect(checklistResponse.status).toBe(409);
  });

  it("downloads a real receipt from memory without writing beside the source", async () => {
    const source = await makeSmallFixture();
    const before = await readdir(source, { recursive: true });
    const app = await startLocalFoundryApp({ source });
    openApps.push(app);
    const ready = await waitForPhase(app, "ready");
    expect(ready.receipt?.summary.fileCount).toBe(3);

    const response = await sendRequest(app, {
      path: `/api/receipt?token=${encodeURIComponent(tokenFor(app))}`,
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-universal-intake-receipt-v0.json\"",
    );
    const downloaded = JSON.parse(response.body) as FoundryUniversalIntakeReceipt;
    expect(downloaded.receiptSha256).toBe(ready.receipt?.receiptSha256);
    expect(JSON.stringify(downloaded)).not.toContain(source);

    const facts = ready.sourceFacts;
    if (facts === undefined) throw new Error("ready state has no Source Facts artifact");
    const staleFacts = await sendRequest(app, {
      path: `/api/source-facts?token=${encodeURIComponent(tokenFor(app))}&digest=${"0".repeat(64)}`,
    });
    expect(staleFacts.status).toBe(409);
    const factsResponse = await sendRequest(app, {
      path: `/api/source-facts?token=${encodeURIComponent(tokenFor(app))}&digest=${facts.factsSha256}`,
    });
    expect(factsResponse.status).toBe(200);
    expect(factsResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-universal-source-facts-v5.json\"",
    );
    expect(factsResponse.body).toBe(`${serializeUniversalSourceFactsV5Artifact(facts)}\n`);
    const downloadedFacts = JSON.parse(factsResponse.body) as FoundryUniversalSourceFactsV5;
    expect(downloadedFacts.factsSha256).toBe(facts.factsSha256);
    expect(downloadedFacts.receiptSha256).toBe(downloaded.receiptSha256);
    expect(JSON.stringify(downloadedFacts)).not.toContain(source);

    const readiness = ready.sourceReadiness;
    if (readiness === undefined) throw new Error("ready state has no Source Readiness artifact");
    const staleReadiness = await sendRequest(app, {
      path: `/api/source-readiness?token=${encodeURIComponent(tokenFor(app))}&digest=${"0".repeat(64)}`,
    });
    expect(staleReadiness.status).toBe(409);
    const readinessResponse = await sendRequest(app, {
      path: `/api/source-readiness?token=${encodeURIComponent(tokenFor(app))}&digest=${readiness.readinessSha256}`,
    });
    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-source-readiness-map-v5.json\"",
    );
    expect(readinessResponse.body).toBe(`${serializeFoundrySourceReadinessMapV5(readiness)}\n`);
    const downloadedReadiness = JSON.parse(readinessResponse.body) as FoundrySourceReadinessMapV5;
    expect(downloadedReadiness.readinessSha256).toBe(readiness.readinessSha256);
    expect(downloadedReadiness.receiptSha256).toBe(downloaded.receiptSha256);
    expect(downloadedReadiness.sourceFactsSha256).toBe(downloadedFacts.factsSha256);
    expect(JSON.stringify(downloadedReadiness)).not.toContain(source);

    const checklist = ready.operatorEvidenceChecklist;
    if (checklist === undefined) throw new Error("ready state has no Operator Evidence Checklist");
    const staleChecklist = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(tokenFor(app))}&digest=${"0".repeat(64)}`,
    });
    expect(staleChecklist.status).toBe(409);
    const checklistResponse = await sendRequest(app, {
      path: `/api/operator-evidence-checklist?token=${encodeURIComponent(tokenFor(app))}&digest=${checklist.checklistSha256}`,
    });
    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.headers["content-disposition"]).toBe(
      "attachment; filename=\"foundry-operator-evidence-checklist-v5.json\"",
    );
    expect(checklistResponse.body).toBe(
      `${serializeFoundryOperatorEvidenceChecklistV5(checklist)}\n`,
    );
    const downloadedChecklist = JSON.parse(
      checklistResponse.body,
    ) as FoundryOperatorEvidenceChecklistV5;
    expect(downloadedChecklist).toMatchObject({
      checklistSha256: checklist.checklistSha256,
      receiptSha256: downloaded.receiptSha256,
      sourceFactsSha256: downloadedFacts.factsSha256,
      readinessSha256: downloadedReadiness.readinessSha256,
    });
    expect(JSON.stringify(downloadedChecklist)).not.toContain(source);
    expect(await readdir(source, { recursive: true })).toEqual(before);
  });

  it("stops from the page only with the exact local origin and also expires automatically", async () => {
    const app = await startLocalFoundryApp({ source: "capture" });
    openApps.push(app);
    const token = tokenFor(app);
    const missingOrigin = await sendRequest(app, {
      method: "POST",
      path: `/api/stop?token=${encodeURIComponent(token)}`,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(missingOrigin.status).toBe(403);

    const stopped = await sendRequest(app, {
      method: "POST",
      path: `/api/stop?token=${encodeURIComponent(token)}`,
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
        "Content-Length": "2",
      },
      body: "{}",
    });
    expect(stopped.status).toBe(202);
    await expect(app.closed).resolves.toEqual({ reason: "operator" });

    const expiring = await startLocalFoundryApp({
      source: "capture",
      sessionTtlMs: 60,
    });
    openApps.push(expiring);
    await expect(expiring.closed).resolves.toEqual({ reason: "session_expired" });
  });

  it("expires on time even when a client leaves a request body unfinished", async () => {
    const app = await startLocalFoundryApp({
      source: "capture",
      sessionTtlMs: 100,
    });
    openApps.push(app);
    const partialRequest = httpRequest({
      hostname: app.host,
      port: app.port,
      method: "POST",
      path: `/api/stop?token=${encodeURIComponent(tokenFor(app))}`,
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
      },
    });
    const connectionClosed = new Promise<void>((resolveClosed) => {
      partialRequest.once("error", () => {
        resolveClosed();
      });
      partialRequest.once("close", () => {
        resolveClosed();
      });
    });
    partialRequest.write("{");

    await expect(app.closed).resolves.toEqual({ reason: "session_expired" });
    await connectionClosed;
    partialRequest.destroy();
  });

  it("expires on time even when a local client sends only part of an HTTP header", async () => {
    const app = await startLocalFoundryApp({
      source: "capture",
      sessionTtlMs: 100,
    });
    openApps.push(app);
    const socket = createConnection({ host: app.host, port: app.port });
    await new Promise<void>((resolveConnected, rejectConnected) => {
      socket.once("connect", () => {
        resolveConnected();
      });
      socket.once("error", rejectConnected);
    });
    const connectionClosed = new Promise<void>((resolveClosed) => {
      socket.once("close", () => {
        resolveClosed();
      });
      socket.once("error", () => {
        resolveClosed();
      });
    });
    socket.write("GET /api/state HTTP/1.1\r\nHost: 127.0.0.1");

    await expect(app.closed).resolves.toEqual({ reason: "session_expired" });
    await connectionClosed;
    socket.destroy();
  });

  it("opens only an internally generated loopback URL without using a shell", () => {
    const token = "a".repeat(43);
    const url = `http://127.0.0.1:43127/?token=${token}`;
    expect(localFoundryBrowserLaunchSpec(url, "win32")).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    });
    expect(() => localFoundryBrowserLaunchSpec(
      `http://attacker.example/?token=${token}`,
      "win32",
    )).toThrow("Refusing to open");
    expect(() => localFoundryBrowserLaunchSpec(
      `http://127.0.0.1:43127/?token=${token}&source=C%3A%5Csecret`,
      "win32",
    )).toThrow("Refusing to open");

    const once = vi.fn();
    const unref = vi.fn();
    const launcher = vi.fn(() => ({ once, unref }));
    openLocalFoundryAppInBrowser(url, launcher);
    expect(launcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([url]),
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
