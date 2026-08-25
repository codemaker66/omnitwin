import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { assetVersions, generalAuditLog, runtimePackages } from "../db/schema.js";
import { buildGrandHallRoomOnlyAssetRegistrationInputs } from "../lib/grand-hall-frontier-contract.js";
import {
  GrandHallRuntimeIntakeError,
  createDatabaseGrandHallRegistrationStore,
} from "../services/grand-hall-runtime-intake.js";
import { syntheticGrandHallRoomOnlyAdmission } from "./fixtures/grand-hall-room-only-evidence.js";

type AssetRow = typeof assetVersions.$inferSelect;
type AssetInsert = typeof assetVersions.$inferInsert;
type RuntimePackageRow = typeof runtimePackages.$inferSelect;
type RuntimePackageInsert = typeof runtimePackages.$inferInsert;
type AuditRow = typeof generalAuditLog.$inferSelect;
type AuditInsert = typeof generalAuditLog.$inferInsert;

const NOW = new Date("2026-08-22T12:00:00.000Z");
const ACTOR_USER_ID = "90000000-0000-4000-8000-000000000001";
const roomOnlyAdmission = syntheticGrandHallRoomOnlyAdmission;

interface FakeDatabaseState {
  readonly assets: readonly AssetRow[];
  readonly packages: readonly RuntimePackageRow[];
  readonly audits: readonly AuditRow[];
}

interface FakeDatabaseFailurePlan {
  readonly assetInsertAttempt?: number;
  readonly failPackageInsert?: boolean;
  readonly failAuditInsert?: boolean;
}

interface FakeDatabaseCounters {
  transactions: number;
  statements: number;
  assetInsertAttempts: number;
  packageInsertAttempts: number;
  auditInsertAttempts: number;
}

interface FakeDatabaseHarness {
  readonly db: Database;
  readonly counters: FakeDatabaseCounters;
  state(): FakeDatabaseState;
}

function uuid(namespace: number, serial: number): string {
  return `${String(namespace).padStart(8, "0")}-0000-4000-8000-${String(serial).padStart(12, "0")}`;
}

function canonicalAssetRow(
  memberIndex: number,
  overrides: Partial<AssetRow> = {},
): AssetRow {
  const input = buildGrandHallRoomOnlyAssetRegistrationInputs(roomOnlyAdmission())[memberIndex];
  if (input === undefined) throw new Error("Test member index is outside the canonical frontier.");
  return {
    id: uuid(1, memberIndex + 1),
    venueSlug: input.venueSlug,
    roomSlug: input.roomSlug ?? null,
    captureSessionId: null,
    assetKind: input.assetKind,
    sourceType: input.sourceType,
    fileName: input.fileName,
    fileExt: input.fileExt,
    r2Key: input.r2Key ?? null,
    externalUrl: null,
    mimeType: input.mimeType ?? null,
    sha256: input.sha256 ?? null,
    sizeBytes: input.sizeBytes ?? null,
    evidenceStatus: input.evidenceStatus,
    runtimeStatus: input.runtimeStatus,
    notes: input.notes ?? null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function cloneState(state: FakeDatabaseState): {
  assets: AssetRow[];
  packages: RuntimePackageRow[];
  audits: AuditRow[];
} {
  return {
    assets: state.assets.map((row) => ({ ...row })),
    packages: state.packages.map((row) => ({ ...row })),
    audits: state.audits.map((row) => ({ ...row })),
  };
}

function createFakeDatabase(
  initial: Partial<FakeDatabaseState> = {},
  failures: FakeDatabaseFailurePlan = {},
): FakeDatabaseHarness {
  let committed = cloneState({
    assets: initial.assets ?? [],
    packages: initial.packages ?? [],
    audits: initial.audits ?? [],
  });
  const counters: FakeDatabaseCounters = {
    transactions: 0,
    statements: 0,
    assetInsertAttempts: 0,
    packageInsertAttempts: 0,
    auditInsertAttempts: 0,
  };

  const transaction = async <T>(work: (tx: object) => Promise<T>): Promise<T> => {
    counters.transactions += 1;
    const pending = cloneState(committed);

    const resultForTable = (
      table: object,
      hasProjection: boolean,
    ): readonly object[] => {
      if (table === assetVersions) return pending.assets;
      if (table !== runtimePackages) throw new Error("Unexpected select table in fake database.");
      if (hasProjection) {
        return [...pending.packages]
          .sort((left, right) => right.revision - left.revision)
          .map((row) => ({ revision: row.revision }));
      }
      return pending.packages;
    };

    const select = (...selection: readonly object[]) => ({
      from: (table: object) => {
        const values = (): readonly object[] => resultForTable(table, selection.length > 0);
        const limited = (limit: number): Promise<readonly object[]> =>
          Promise.resolve(values().slice(0, limit));
        return {
          where: (_predicate: object) => ({
            then: <TResult1 = readonly object[], TResult2 = never>(
              onfulfilled?: ((value: readonly object[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ): Promise<TResult1 | TResult2> =>
              Promise.resolve(values()).then(onfulfilled, onrejected),
            limit: limited,
            orderBy: (_ordering: object) => ({ limit: limited }),
          }),
        };
      },
    });

    const insertAsset = (values: AssetInsert): Promise<readonly AssetRow[]> => {
      counters.assetInsertAttempts += 1;
      if (counters.assetInsertAttempts === failures.assetInsertAttempt) {
        throw new Error("simulated asset insert failure");
      }
      const row = {
        ...values,
        id: uuid(1, pending.assets.length + 1),
        roomSlug: values.roomSlug ?? null,
        captureSessionId: values.captureSessionId ?? null,
        r2Key: values.r2Key ?? null,
        externalUrl: values.externalUrl ?? null,
        mimeType: values.mimeType ?? null,
        sha256: values.sha256 ?? null,
        sizeBytes: values.sizeBytes ?? null,
        evidenceStatus: values.evidenceStatus ?? "unverified",
        runtimeStatus: values.runtimeStatus ?? "staged",
        notes: values.notes ?? null,
        createdAt: NOW,
        updatedAt: NOW,
      } as AssetRow;
      pending.assets.push(row);
      return Promise.resolve([row]);
    };

    const insertPackage = (
      values: RuntimePackageInsert,
    ): Promise<readonly RuntimePackageRow[]> => {
      counters.packageInsertAttempts += 1;
      if (failures.failPackageInsert === true) {
        throw new Error("simulated runtime package insert failure");
      }
      const row = {
        ...values,
        id: uuid(2, pending.packages.length + 1),
        contentDigest: values.contentDigest ?? null,
        primaryVisualAssetVersionId: values.primaryVisualAssetVersionId ?? null,
        semanticMeshAssetVersionId: values.semanticMeshAssetVersionId ?? null,
        collisionAssetVersionId: values.collisionAssetVersionId ?? null,
        pointCloudAssetVersionId: values.pointCloudAssetVersionId ?? null,
        evidenceStatus: values.evidenceStatus ?? "unverified",
        runtimeStatus: values.runtimeStatus ?? "draft",
        createdAt: NOW,
        updatedAt: NOW,
      } as RuntimePackageRow;
      pending.packages.push(row);
      return Promise.resolve([row]);
    };

    const insertAudit = (values: AuditInsert): Promise<void> => {
      counters.auditInsertAttempts += 1;
      if (failures.failAuditInsert === true) {
        throw new Error("simulated audit insert failure");
      }
      pending.audits.push({
        ...values,
        id: uuid(3, pending.audits.length + 1),
        actorUserId: values.actorUserId ?? null,
        metadata: values.metadata ?? null,
        createdAt: NOW,
      } as AuditRow);
      return Promise.resolve();
    };

    const insert = (table: object) => ({
      values: (values: AssetInsert | RuntimePackageInsert | AuditInsert) => {
        if (table === assetVersions) {
          return { returning: () => insertAsset(values as AssetInsert) };
        }
        if (table === runtimePackages) {
          return { returning: () => insertPackage(values as RuntimePackageInsert) };
        }
        if (table === generalAuditLog) {
          return insertAudit(values as AuditInsert);
        }
        throw new Error("Unexpected insert table in fake database.");
      },
    });

    const tx = {
      execute: (_statement: object): Promise<void> => {
        counters.statements += 1;
        return Promise.resolve();
      },
      select,
      insert,
    };

    const result = await work(tx);
    committed = pending;
    return result;
  };

  return {
    db: { transaction } as Database,
    counters,
    state: () => committed,
  };
}

describe("database-backed Grand Hall frontier registration", () => {
  it("creates the canonical null-provenance assets and immutable package atomically", async () => {
    const harness = createFakeDatabase();
    const store = createDatabaseGrandHallRegistrationStore(harness.db);

    const result = await store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission());

    expect(result.created).toBe(true);
    expect(result.packageRow.revision).toBe(1);
    expect(result.packageRow.evidenceStatus).toBe("human_reviewed");
    expect(result.packageRow.runtimeStatus).toBe("internal_ready");
    expect(result.assetVersionIds).toEqual(harness.state().assets.map((row) => row.id));
    expect(harness.state().assets).toHaveLength(2);
    expect(harness.state().assets.every((row) => row.captureSessionId === null)).toBe(true);
    expect(harness.state().assets.every((row) => row.externalUrl === null)).toBe(true);
    expect(harness.state().packages).toEqual([result.packageRow]);
    expect(harness.state().audits).toHaveLength(1);
    expect(harness.state().audits[0]).toMatchObject({
      actorUserId: ACTOR_USER_ID,
      action: "grand_hall_runtime_intake.committed",
      targetType: "runtime_package",
      targetId: result.packageRow.id,
      metadata: expect.objectContaining({
        captureSessionId: null,
        roomOnlyEvidenceSha256: roomOnlyAdmission().acceptedEvidenceSha256,
      }),
    });
    expect(harness.counters).toMatchObject({
      transactions: 1,
      statements: 3,
      assetInsertAttempts: 2,
      packageInsertAttempts: 1,
      auditInsertAttempts: 1,
    });
  });

  it("reuses the exact assets and package without duplicate writes", async () => {
    const harness = createFakeDatabase();
    const store = createDatabaseGrandHallRegistrationStore(harness.db);
    const created = await store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission());

    const reused = await store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission());

    expect(reused).toEqual({ ...created, created: false });
    expect(harness.state().assets).toHaveLength(2);
    expect(harness.state().packages).toHaveLength(1);
    expect(harness.state().audits).toHaveLength(1);
    expect(harness.counters.assetInsertAttempts).toBe(2);
    expect(harness.counters.packageInsertAttempts).toBe(1);
    expect(harness.counters.auditInsertAttempts).toBe(1);
  });

  it("rejects an existing non-null capture-session assertion before inserting", async () => {
    const conflicting = canonicalAssetRow(0, {
      captureSessionId: "80000000-0000-4000-8000-000000000001",
    });
    const harness = createFakeDatabase({ assets: [conflicting] });
    const store = createDatabaseGrandHallRegistrationStore(harness.db);

    await expect(store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission())).rejects.toMatchObject({
      statusCode: 409,
      code: "GRAND_HALL_ASSET_CONFLICT",
    } satisfies Partial<GrandHallRuntimeIntakeError>);

    expect(harness.state()).toEqual({ assets: [conflicting], packages: [], audits: [] });
    expect(harness.counters.assetInsertAttempts).toBe(0);
    expect(harness.counters.packageInsertAttempts).toBe(0);
    expect(harness.counters.auditInsertAttempts).toBe(0);
  });

  it("rolls back earlier asset writes when a later asset insert fails", async () => {
    const harness = createFakeDatabase({}, { assetInsertAttempt: 2 });
    const store = createDatabaseGrandHallRegistrationStore(harness.db);

    await expect(store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission())).rejects.toThrow(
      "simulated asset insert failure",
    );

    expect(harness.state()).toEqual({ assets: [], packages: [], audits: [] });
    expect(harness.counters.assetInsertAttempts).toBe(2);
    expect(harness.counters.packageInsertAttempts).toBe(0);
    expect(harness.counters.auditInsertAttempts).toBe(0);
  });

  it("rolls back all asset writes when runtime-package insertion fails", async () => {
    const harness = createFakeDatabase({}, { failPackageInsert: true });
    const store = createDatabaseGrandHallRegistrationStore(harness.db);

    await expect(store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission())).rejects.toThrow(
      "simulated runtime package insert failure",
    );

    expect(harness.state()).toEqual({ assets: [], packages: [], audits: [] });
    expect(harness.counters.assetInsertAttempts).toBe(2);
    expect(harness.counters.packageInsertAttempts).toBe(1);
    expect(harness.counters.auditInsertAttempts).toBe(0);
  });

  it("rolls back the complete frontier when the audit insert fails", async () => {
    const harness = createFakeDatabase({}, { failAuditInsert: true });
    const store = createDatabaseGrandHallRegistrationStore(harness.db);

    await expect(store.registerExactFrontier(ACTOR_USER_ID, roomOnlyAdmission())).rejects.toThrow(
      "simulated audit insert failure",
    );

    expect(harness.state()).toEqual({ assets: [], packages: [], audits: [] });
    expect(harness.counters.assetInsertAttempts).toBe(2);
    expect(harness.counters.packageInsertAttempts).toBe(1);
    expect(harness.counters.auditInsertAttempts).toBe(1);
  });

  it("rejects missing or unaccepted room-only evidence before opening a transaction", async () => {
    const harness = createFakeDatabase();
    const store = createDatabaseGrandHallRegistrationStore(harness.db);
    const wrong = roomOnlyAdmission();

    await expect(store.registerExactFrontier(
      ACTOR_USER_ID,
      { ...wrong, acceptedEvidenceSha256: "f".repeat(64) },
    )).rejects.toMatchObject({
      code: "GRAND_HALL_ROOM_ONLY_EVIDENCE_REQUIRED",
    } satisfies Partial<GrandHallRuntimeIntakeError>);

    expect(harness.counters.transactions).toBe(0);
    expect(harness.state()).toEqual({ assets: [], packages: [], audits: [] });
  });
});
