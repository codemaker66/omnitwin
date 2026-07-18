import Fastify, { type FastifyInstance } from "fastify";
import {
  RUNTIME_QA_CHECK_KEYS,
  RuntimeQaRecordV0Schema,
  TransformArtifactV0Schema,
  runtimeQaRecordSignedTransformArtifactId,
  type RuntimeQaRecordV0,
  type TransformArtifactV0,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import {
  runtimePackages,
  runtimeQaRecords,
  runtimeTransformArtifacts,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { runtimeTransformArtifactSha256 } from "../lib/runtime-transform-artifact-receipt.js";
import {
  adminAssetRoutes,
  type RuntimePackageRow,
  type RuntimeQaRecordRow,
  type RuntimeTransformArtifactRow,
} from "../routes/assets.js";

process.env["NODE_ENV"] = "test";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_ID = "10000000-0000-4000-8000-000000000001";
const TRANSFORM_ROW_ID = "30000000-0000-4000-8000-000000000001";
const QA_ROW_ID = "40000000-0000-4000-8000-000000000001";
const TRANSFORM_ID = "reception-room-reviewed-transform-v1";
const SOURCE_SHA256 = "a".repeat(64);
const REVIEW_NOTE = "Route-level immutability regression evidence.";

const adminToken = JSON.stringify({
  id: "10000000-0000-4000-8000-000000000010",
  email: "admin@test.com",
  name: "Test administrator",
  role: "admin",
  platformRole: "admin",
  venueId: null,
});

const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://mock:mock@localhost/mock",
  PORT: 3001,
  EMAIL_FROM: "VenViewer <notifications@venviewer.com>",
  CORS_ORIGINS: "http://localhost:5173",
  VENVIEWER_APPROVED_AUTH_DOMAIN_ROLE: "planner",
  SENTRY_TRACES_SAMPLE_RATE: 0.1,
  AI_ASSISTANT_ENABLED: "false",
} satisfies Env;

const runtimePackage: RuntimePackageRow = {
  id: PACKAGE_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  revision: 1,
  identityKind: "content_sha256",
  contentDigest: "b".repeat(64),
  primaryVisualAssetVersionId: ASSET_ID,
  semanticMeshAssetVersionId: null,
  collisionAssetVersionId: null,
  pointCloudAssetVersionId: null,
  manifestJson: {
    schemaVersion: "venviewer.runtime-package.v1",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    packageType: "room-runtime",
    assets: {
      primaryVisualAssetVersionId: ASSET_ID,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
    },
  },
  evidenceStatus: "human_reviewed",
  runtimeStatus: "published",
  createdAt: NOW,
  updatedAt: NOW,
};

const transformArtifact: TransformArtifactV0 = TransformArtifactV0Schema.parse({
  id: TRANSFORM_ID,
  sourceFrame: "COLMAP_RDF",
  targetFrame: "CVF",
  units: "meters",
  matrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  alignmentMethod: "landmark_solve",
  residualRmseM: 0.01,
  landmarks: [{
    id: "corner-01",
    label: "Control corner 01",
    source: [0, 0, 0],
    target: [0, 0, 0],
    residualM: 0.01,
    provenanceRefs: [{
      refType: "landmark_set",
      ref: "docs/operations/reception-room-landmarks-v1.json",
      role: "source_landmarks",
    }],
  }],
  provenance: {
    state: "measured",
    refs: [{
      refType: "landmark_set",
      ref: "docs/operations/reception-room-landmarks-v1.json",
      role: "source_landmarks",
    }],
  },
  creator: {
    actorType: "human",
    id: "ops/runtime-operator",
    displayName: "Runtime operator",
    role: "runtime_operator",
  },
  reviewer: {
    actorType: "human",
    id: "ops/runtime-reviewer",
    displayName: "Runtime reviewer",
    role: "runtime_reviewer",
  },
  date: "2026-07-16T11:00:00.000Z",
});

const validTransformBody = {
  runtimePackageId: PACKAGE_ID,
  venueSlug: "trades-hall",
  roomSlug: "reception-room",
  transformArtifact,
  reviewNote: REVIEW_NOTE,
};

function validQaRecord(
  signedTransformArtifactSha256 = runtimeTransformArtifactSha256(transformArtifact),
): RuntimeQaRecordV0 {
  const evidenceRef = {
    label: "Route-level regression evidence",
    ref: "packages/api/src/__tests__/runtime-registration-immutability-route.test.ts",
  };
  return RuntimeQaRecordV0Schema.parse({
    schemaVersion: "runtime-qa-record.v0",
    recordId: "reception-room-route-immutability-v1",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackageId: PACKAGE_ID,
    recordedAt: "2026-07-16T12:00:00.000Z",
    recordedBy: "runtime-qa-operator",
    assetEvidenceStatus: "human_reviewed",
    runtimeStatus: "published",
    sourceBundle: {
      sourceLabel: "Reviewed Reception route-test bundle",
      sourceBundleHash: SOURCE_SHA256,
      totalSourceFiles: 4,
      totalSourceBytes: 1024,
      totalSplats: 100,
    },
    sparkLoad: {
      renderer: "@sparkjsdev/spark",
      route: "/living-hall",
      loadStatus: "loaded",
      visualChunkCount: 4,
      excludedChunkCount: 0,
      loadedSplats: 100,
      evidenceRefs: [evidenceRef],
    },
    viewTransform: {
      posture: "signed_room_local_transform",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      signedTransformArtifactId: TRANSFORM_ID,
      signedTransformArtifactSha256,
      note: "Exact route-test transform binding.",
    },
    cameraProfile: {
      position: [0, 2, 8],
      target: [0, 1, 0],
      arrivalPosition: null,
      arrivalTarget: null,
      arrivalDurationMs: 0,
      fov: 48,
      targetBounds: null,
      cameraBounds: null,
      note: "Route-test camera profile.",
    },
    checks: RUNTIME_QA_CHECK_KEYS.map((checkKey) => ({
      checkKey,
      status: "passed",
      summary: `Route-level regression passed ${checkKey}.`,
      evidenceRefs: [evidenceRef],
    })),
    limitations: ["Regression fixture only; this is not live room evidence."],
    publicExposure: {
      decision: "approved_public",
      reason: "Route fixture has human review and an exact transform binding.",
      requiredBeforeApproval: ["No fixture-only blockers remain."],
    },
  });
}

interface RegistrationState {
  transform: RuntimeTransformArtifactRow | null;
  qa: RuntimeQaRecordRow | null;
  transformInsertCount: number;
  qaInsertCount: number;
  transformInsertAttemptCount: number;
  qaInsertAttemptCount: number;
  racedInsertTable: unknown;
  pendingRaceInserts: PendingRaceInsert[];
  failedInsertTable: unknown;
  insertFailure: Error | null;
}

interface PendingRaceInsert {
  readonly values: unknown;
  readonly resolve: (rows: readonly unknown[]) => void;
  readonly reject: (error: unknown) => void;
}

function emptyState(): RegistrationState {
  return {
    transform: null,
    qa: null,
    transformInsertCount: 0,
    qaInsertCount: 0,
    transformInsertAttemptCount: 0,
    qaInsertAttemptCount: 0,
    racedInsertTable: null,
    pendingRaceInserts: [],
    failedInsertTable: null,
    insertFailure: null,
  };
}

function existingTransformRow(): RuntimeTransformArtifactRow {
  return {
    id: TRANSFORM_ROW_ID,
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: TRANSFORM_ID,
    transformArtifact,
    reviewNote: REVIEW_NOTE,
    registeredBy: "10000000-0000-4000-8000-000000000010",
    createdAt: new Date("2026-07-16T11:30:00.000Z"),
    updatedAt: new Date("2026-07-16T11:30:00.000Z"),
  };
}

function rowsForTable(state: RegistrationState, table: unknown): readonly unknown[] {
  if (table === runtimePackages) return [runtimePackage];
  if (table === runtimeTransformArtifacts) {
    return state.transform === null ? [] : [state.transform];
  }
  if (table === runtimeQaRecords) return state.qa === null ? [] : [state.qa];
  return [];
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected route insert values to be an object");
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function requireString(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`);
  return value;
}

function requireNullableString(values: Record<string, unknown>, key: string): string | null {
  const value = values[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string or null`);
  return value;
}

function requireDate(values: Record<string, unknown>, key: string): Date {
  const value = values[key];
  if (!(value instanceof Date)) throw new Error(`Expected ${key} to be a Date`);
  return value;
}

function insertRows(
  state: RegistrationState,
  table: unknown,
  rawValues: unknown,
): readonly unknown[] {
  const values = requireRecord(rawValues);
  if (table === runtimeTransformArtifacts) {
    const insertedArtifact = TransformArtifactV0Schema.parse(values["transformArtifact"]);
    const inserted: RuntimeTransformArtifactRow = {
      id: TRANSFORM_ROW_ID,
      runtimePackageId: requireString(values, "runtimePackageId"),
      venueSlug: requireString(values, "venueSlug"),
      roomSlug: requireString(values, "roomSlug"),
      transformArtifactId: requireString(values, "transformArtifactId"),
      transformArtifact: insertedArtifact,
      reviewNote: requireNullableString(values, "reviewNote"),
      registeredBy: requireString(values, "registeredBy"),
      createdAt: NOW,
      updatedAt: requireDate(values, "updatedAt"),
    };
    state.transform = inserted;
    state.transformInsertCount += 1;
    return [inserted];
  }

  if (table === runtimeQaRecords) {
    const record = RuntimeQaRecordV0Schema.parse(values["recordJson"]);
    const inserted: RuntimeQaRecordRow = {
      id: QA_ROW_ID,
      runtimePackageId: requireString(values, "runtimePackageId"),
      venueSlug: requireString(values, "venueSlug"),
      roomSlug: requireString(values, "roomSlug"),
      recordId: requireString(values, "recordId"),
      recordJson: record,
      signedTransformArtifactId: runtimeQaRecordSignedTransformArtifactId(record),
      publicExposureDecision: record.publicExposure.decision,
      assetEvidenceStatus: record.assetEvidenceStatus,
      runtimeStatus: record.runtimeStatus,
      reviewedBy: requireString(values, "reviewedBy"),
      createdAt: NOW,
      updatedAt: requireDate(values, "updatedAt"),
    };
    state.qa = inserted;
    state.qaInsertCount += 1;
    return [inserted];
  }

  throw new Error("Unexpected table passed to the route-test insert adapter");
}

function uniqueViolation(): Error & { readonly code: "23505" } {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505" as const,
  });
}

function raceInsertRows(
  state: RegistrationState,
  table: unknown,
  values: unknown,
): Promise<readonly unknown[]> {
  return new Promise((resolve, reject) => {
    state.pendingRaceInserts.push({ values, resolve, reject });
    if (state.pendingRaceInserts.length < 2) return;

    const [winner, loser] = state.pendingRaceInserts.splice(0, 2);
    if (winner === undefined || loser === undefined) {
      throw new Error("The route-test insert race needs exactly two contenders");
    }
    try {
      const winnerRows = insertRows(state, table, winner.values);
      winner.resolve(winnerRows);
      loser.reject(uniqueViolation());
    } catch (error) {
      winner.reject(error);
      loser.reject(error);
    }
  });
}

function recordInsertAttempt(state: RegistrationState, table: unknown): void {
  if (table === runtimeTransformArtifacts) {
    state.transformInsertAttemptCount += 1;
    return;
  }
  if (table === runtimeQaRecords) {
    state.qaInsertAttemptCount += 1;
    return;
  }
  throw new Error("Unexpected table passed to the route-test insert adapter");
}

function databaseFor(state: RegistrationState): Database {
  const db = {} as Database;
  Reflect.set(db, "select", () => {
    let selectedTable: unknown;
    const query: Record<string, unknown> = {};
    query["from"] = (table: unknown) => {
      selectedTable = table;
      return query;
    };
    query["where"] = () => query;
    query["limit"] = () => Promise.resolve(rowsForTable(state, selectedTable));
    return query;
  });
  Reflect.set(db, "insert", (table: unknown) => {
    let values: unknown;
    const query: Record<string, unknown> = {};
    query["values"] = (nextValues: unknown) => {
      values = nextValues;
      return query;
    };
    query["returning"] = () => {
      recordInsertAttempt(state, table);
      if (state.failedInsertTable === table) {
        const failure = state.insertFailure;
        if (failure === null) throw new Error("A failed route-test insert needs an Error");
        return Promise.reject(failure);
      }
      if (state.racedInsertTable === table) return raceInsertRows(state, table, values);
      return Promise.resolve(insertRows(state, table, values));
    };
    return query;
  });
  return db;
}

const openServers: FastifyInstance[] = [];

async function routeServer(state: RegistrationState): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(adminAssetRoutes, {
    db: databaseFor(state),
    env: testEnv,
    prefix: "/admin/assets",
  });
  openServers.push(server);
  return server;
}

function post(
  server: FastifyInstance,
  url: string,
  payload: object,
) {
  return server.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    payload,
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("runtime transform artifact HTTP immutability", () => {
  it("registers once and returns the existing row for an exact retry", async () => {
    const state = emptyState();
    const server = await routeServer(state);

    const first = await post(
      server,
      "/admin/assets/register-runtime-transform-artifact",
      validTransformBody,
    );
    const retry = await post(
      server,
      "/admin/assets/register-runtime-transform-artifact",
      validTransformBody,
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(state.transformInsertCount).toBe(1);
    expect(retry.json()).toEqual(first.json());
  }, 30_000);

  it("recovers an exact concurrent first-write race as 201 and 200", async () => {
    const state = emptyState();
    state.racedInsertTable = runtimeTransformArtifacts;
    const server = await routeServer(state);

    const responses = await Promise.all([
      post(server, "/admin/assets/register-runtime-transform-artifact", validTransformBody),
      post(server, "/admin/assets/register-runtime-transform-artifact", validTransformBody),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(state.transformInsertAttemptCount).toBe(2);
    expect(state.transformInsertCount).toBe(1);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
  });

  it("maps a concurrent changed transform under the same id to immutable 409", async () => {
    const state = emptyState();
    state.racedInsertTable = runtimeTransformArtifacts;
    const server = await routeServer(state);
    const changedBody = {
      ...validTransformBody,
      reviewNote: "Concurrent changed review note under the same immutable id.",
    };

    const responses = await Promise.all([
      post(server, "/admin/assets/register-runtime-transform-artifact", validTransformBody),
      post(server, "/admin/assets/register-runtime-transform-artifact", changedBody),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      code: "RUNTIME_TRANSFORM_ARTIFACT_IMMUTABLE",
    });
    expect(state.transformInsertAttemptCount).toBe(2);
    expect(state.transformInsertCount).toBe(1);
  });

  it.each([
    {
      failureLabel: "a non-unique database error",
      error: Object.assign(new Error("database unavailable"), { code: "XX000" }),
    },
    {
      failureLabel: "a unique error without a matching immutable row",
      error: uniqueViolation(),
    },
  ])("does not swallow $failureLabel", async ({ error }) => {
    const state = emptyState();
    state.failedInsertTable = runtimeTransformArtifacts;
    state.insertFailure = error;
    const server = await routeServer(state);

    const response = await post(
      server,
      "/admin/assets/register-runtime-transform-artifact",
      validTransformBody,
    );

    expect(response.statusCode).toBe(500);
    expect(state.transform).toBeNull();
    expect(state.transformInsertAttemptCount).toBe(1);
    expect(state.transformInsertCount).toBe(0);
  });

  it.each([
    {
      changedField: "matrix content",
      payload: {
        ...validTransformBody,
        transformArtifact: {
          ...transformArtifact,
          matrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0.25, 0, 0, 1,
          ],
        },
      },
    },
    {
      changedField: "reviewer",
      payload: {
        ...validTransformBody,
        transformArtifact: {
          ...transformArtifact,
          reviewer: {
            ...transformArtifact.reviewer,
            id: "ops/different-reviewer",
            displayName: "Different runtime reviewer",
          },
        },
      },
    },
    {
      changedField: "review note",
      payload: {
        ...validTransformBody,
        reviewNote: "Changed review note under the same immutable id.",
      },
    },
  ])("returns 409 when the same transform id has changed $changedField", async ({ payload }) => {
    const state = emptyState();
    state.transform = existingTransformRow();
    const server = await routeServer(state);

    const response = await post(
      server,
      "/admin/assets/register-runtime-transform-artifact",
      payload,
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "RUNTIME_TRANSFORM_ARTIFACT_IMMUTABLE",
    });
    expect(state.transformInsertCount).toBe(0);
  });
});

describe("runtime QA record HTTP immutability", () => {
  it("registers once and returns the existing row for an exact retry", async () => {
    const state = emptyState();
    state.transform = existingTransformRow();
    const server = await routeServer(state);
    const record = validQaRecord();
    const payload = {
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record,
    };

    const first = await post(server, "/admin/assets/register-runtime-qa-record", payload);
    const retry = await post(server, "/admin/assets/register-runtime-qa-record", payload);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(state.qaInsertCount).toBe(1);
    expect(retry.json()).toEqual(first.json());
  });

  it("recovers an exact concurrent first-write race as 201 and 200", async () => {
    const state = emptyState();
    state.transform = existingTransformRow();
    state.racedInsertTable = runtimeQaRecords;
    const server = await routeServer(state);
    const payload = {
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record: validQaRecord(),
    };

    const responses = await Promise.all([
      post(server, "/admin/assets/register-runtime-qa-record", payload),
      post(server, "/admin/assets/register-runtime-qa-record", payload),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(state.qaInsertAttemptCount).toBe(2);
    expect(state.qaInsertCount).toBe(1);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
  });

  it("maps a concurrent changed QA record under the same id to immutable 409", async () => {
    const state = emptyState();
    state.transform = existingTransformRow();
    state.racedInsertTable = runtimeQaRecords;
    const server = await routeServer(state);
    const record = validQaRecord();
    const payload = {
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record,
    };
    const changedPayload = {
      ...payload,
      record: {
        ...record,
        recordedBy: "concurrent-different-runtime-qa-operator",
      },
    };

    const responses = await Promise.all([
      post(server, "/admin/assets/register-runtime-qa-record", payload),
      post(server, "/admin/assets/register-runtime-qa-record", changedPayload),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      code: "RUNTIME_QA_RECORD_IMMUTABLE",
    });
    expect(state.qaInsertAttemptCount).toBe(2);
    expect(state.qaInsertCount).toBe(1);
  });

  it("returns 409 when the same QA record id carries changed record content", async () => {
    const state = emptyState();
    state.transform = existingTransformRow();
    const server = await routeServer(state);
    const record = validQaRecord();
    const payload = {
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record,
    };

    const first = await post(server, "/admin/assets/register-runtime-qa-record", payload);
    const conflict = await post(server, "/admin/assets/register-runtime-qa-record", {
      ...payload,
      record: {
        ...record,
        recordedBy: "different-runtime-qa-operator",
      },
    });

    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "RUNTIME_QA_RECORD_IMMUTABLE" });
    expect(state.qaInsertCount).toBe(1);
  });

  it("rejects a signed-transform digest mismatch before storing the QA record", async () => {
    const state = emptyState();
    state.transform = existingTransformRow();
    const server = await routeServer(state);
    const exactDigest = runtimeTransformArtifactSha256(transformArtifact);
    const wrongDigest = `${exactDigest.startsWith("a") ? "b" : "a"}${exactDigest.slice(1)}`;

    const response = await post(server, "/admin/assets/register-runtime-qa-record", {
      runtimePackageId: PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      record: validQaRecord(wrongDigest),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: "Runtime QA signed transform SHA-256 does not match the registered transform content.",
    });
    expect(state.qaInsertCount).toBe(0);
  });
});
