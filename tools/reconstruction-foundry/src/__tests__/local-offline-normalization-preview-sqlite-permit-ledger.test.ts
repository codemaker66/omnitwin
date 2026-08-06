import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  __testOnlyOpenLocalOfflinePreviewSqlitePermitLedger,
  LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_LIMITATIONS,
  LocalOfflinePreviewSqlitePermitLedgerError,
  openLocalOfflinePreviewSqlitePermitLedger,
  type LocalOfflinePreviewSqlitePermitLedger,
  type LocalOfflinePreviewSqlitePermitLedgerOpenOptions,
  type LocalOfflinePreviewSqlitePermitLedgerTestControls,
} from "../local-offline-normalization-preview-sqlite-permit-ledger.js";
import {
  provisionTestOnlySqlitePermitLedger,
} from "./support/local-offline-normalization-preview-sqlite-permit-ledger-test-support.js";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const INITIAL = "2026-07-18T12:00:00.000Z";
const EXPIRES = "2026-07-18T12:05:00.000Z";
const WORKER_EXPIRES = "2099-12-31T23:59:59.999Z";
const EPOCH = `sha256:${"e".repeat(64)}`;
const OTHER_EPOCH = `sha256:${"f".repeat(64)}`;
const DIGEST = `sha256:${"a".repeat(64)}`;
const POLICY = `sha256:${"b".repeat(64)}`;
const REQUEST = "c".repeat(32);
const PRODUCTION_MAXIMUM_PAGE_COUNT = 131_072;
const roots: string[] = [];
const stores: LocalOfflinePreviewSqlitePermitLedger[] = [];

interface WorkerOutcome {
  readonly status: "reserved" | "blocked";
  readonly code: string | null;
}

interface WorkerMessage {
  readonly status: "ready" | "reserved" | "blocked";
  readonly code?: string;
}

function makeRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "omnitwin-sqlite-permit-ledger-"));
  roots.push(value);
  return value;
}

function databasePath(): string {
  return join(makeRoot(), "permit-ledger.sqlite3");
}

function provision(path: string, ledgerEpoch = EPOCH, initialObservedAt = INITIAL): void {
  provisionTestOnlySqlitePermitLedger({
    databasePath: path,
    ledgerEpoch,
    initialObservedAt,
  });
}

function options(
  path: string,
  maximumEntries = 100,
  ledgerEpoch = EPOCH,
): LocalOfflinePreviewSqlitePermitLedgerOpenOptions {
  return { databasePath: path, ledgerEpoch, maximumEntries };
}

function controls(
  now: () => number = () => NOW,
  maximumPageCount = PRODUCTION_MAXIMUM_PAGE_COUNT,
  busyTimeoutMilliseconds = 100,
): LocalOfflinePreviewSqlitePermitLedgerTestControls {
  return { now, maximumPageCount, busyTimeoutMilliseconds };
}

function openTestStore(
  path: string,
  now: () => number = () => NOW,
  maximumEntries = 100,
  maximumPageCount = PRODUCTION_MAXIMUM_PAGE_COUNT,
  busyTimeoutMilliseconds = 100,
): LocalOfflinePreviewSqlitePermitLedger {
  const store = __testOnlyOpenLocalOfflinePreviewSqlitePermitLedger(
    options(path, maximumEntries),
    controls(now, maximumPageCount, busyTimeoutMilliseconds),
  );
  stores.push(store);
  return store;
}

function input(
  permitPayloadSha256 = DIGEST,
  expiresAt = EXPIRES,
) {
  return {
    permitPayloadSha256,
    requestId: REQUEST,
    policyDigest: POLICY,
    expiresAt,
  } as const;
}

function errorCode(error: unknown): string | null {
  return error instanceof LocalOfflinePreviewSqlitePermitLedgerError
    ? error.code
    : null;
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = (value as { readonly status?: unknown }).status;
  const code = (value as { readonly code?: unknown }).code;
  return (status === "ready" || status === "reserved" || status === "blocked") &&
    (code === undefined || typeof code === "string");
}

async function concurrentWorkerReservations(
  path: string,
  permitDigests: readonly string[],
  maximumEntries: number,
): Promise<readonly WorkerOutcome[]> {
  const moduleUrl = new URL(
    "../local-offline-normalization-preview-sqlite-permit-ledger.ts",
    import.meta.url,
  ).href;
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    void (async () => {
      const api = await import(workerData.moduleUrl);
      parentPort.postMessage({ status: "ready" });
      parentPort.once("message", () => {
        let store;
        try {
          store = api.openLocalOfflinePreviewSqlitePermitLedger(workerData.options);
          store.reserve(workerData.input);
          parentPort.postMessage({ status: "reserved" });
        } catch (error) {
          parentPort.postMessage({
            status: "blocked",
            code: error && typeof error === "object" && typeof error.code === "string"
              ? error.code
              : null,
          });
        } finally {
          if (store) store.close();
        }
      });
    })().catch((error) => {
      parentPort.postMessage({
        status: "blocked",
        code: error && typeof error === "object" && typeof error.code === "string"
          ? error.code
          : "WORKER_FAILURE",
      });
    });
  `;
  const workers = permitDigests.map((permitDigest) =>
    new Worker(workerSource, {
      eval: true,
      execArgv: ["--no-warnings"],
      workerData: {
        moduleUrl,
        options: options(path, maximumEntries),
        input: input(permitDigest, WORKER_EXPIRES),
      },
    })
  );
  let readyCount = 0;
  const outcomes = workers.map(async (worker) =>
    await new Promise<WorkerOutcome>((resolveWorker, rejectWorker) => {
      worker.on("error", rejectWorker);
      worker.on("message", (message: unknown) => {
        if (!isWorkerMessage(message)) {
          rejectWorker(new Error("Worker returned a malformed result."));
          return;
        }
        if (message.status === "ready") {
          readyCount += 1;
          if (readyCount === permitDigests.length) {
            for (const readyWorker of workers) readyWorker.postMessage("reserve");
          }
          return;
        }
        resolveWorker({
          status: message.status,
          code: message.code ?? null,
        });
      });
      worker.on("exit", (exitCode) => {
        if (exitCode !== 0) rejectWorker(new Error(`Worker exited with ${String(exitCode)}.`));
      });
    })
  );
  return await Promise.all(outcomes);
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // The assertion that exercised close owns any expected close failure.
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite-backed offline-preview permit ledger", () => {
  it(
    "allows exactly one winner across 64 simultaneous store instances",
    async () => {
      const path = databasePath();
      provision(path);

      const results = await concurrentWorkerReservations(
        path,
        Array.from({ length: 64 }, () => DIGEST),
        65,
      );

      expect(
        results.filter((result) => result.status === "reserved"),
        JSON.stringify(results),
      ).toHaveLength(1);
      expect(
        results
          .filter((result) => result.status === "blocked")
          .map((result) => result.code),
      ).toEqual(Array.from({ length: 63 }, () => "PERMIT_ALREADY_CONSUMED"));
      const reopened = openLocalOfflinePreviewSqlitePermitLedger(options(path));
      stores.push(reopened);
      expect(reopened.audit()).toMatchObject({
        totalPermanentTombstones: 1,
        reservationCount: 1,
      });
    },
    60_000,
  );

  it("keeps the tombstone across close and restart", () => {
    const path = databasePath();
    provision(path);
    const first = openTestStore(path);
    expect(first.reserve(input())).toEqual({
      permitPayloadSha256: DIGEST,
      requestId: REQUEST,
      expiresAt: EXPIRES,
      consumedAt: INITIAL,
    });
    first.close();

    const restarted = openTestStore(path, () => NOW + 1);
    expect(() => restarted.reserve(input())).toThrowError(
      expect.objectContaining({ code: "PERMIT_ALREADY_CONSUMED" }),
    );
    expect(restarted.audit()).toMatchObject({
      totalPermanentTombstones: 1,
      reservationCount: 1,
    });
  });

  it("never creates a missing runtime database or schema", () => {
    const path = databasePath();
    expect(existsSync(path)).toBe(false);
    expect(() => openLocalOfflinePreviewSqlitePermitLedger(options(path))).toThrowError(
      expect.objectContaining({ code: "LEDGER_NOT_FOUND" }),
    );
    expect(existsSync(path)).toBe(false);

    const empty = new DatabaseSync(path);
    empty.close();
    expect(() => openTestStore(path)).toThrowError(
      expect.objectContaining({ code: "LEDGER_INTEGRITY_CHECK_FAILED" }),
    );
    const inspection = new DatabaseSync(path);
    expect(
      inspection.prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'",
      ).get()?.count,
    ).toBe(0);
    inspection.close();
  });

  it("fails closed after deletion and rejects a recreated ledger with another epoch", () => {
    const path = databasePath();
    provision(path);
    const first = openTestStore(path);
    first.reserve(input());
    first.close();

    rmSync(path, { force: true });
    expect(() => openTestStore(path)).toThrowError(
      expect.objectContaining({ code: "LEDGER_NOT_FOUND" }),
    );
    expect(existsSync(path)).toBe(false);

    provision(path, OTHER_EPOCH);
    expect(() => openTestStore(path)).toThrowError(
      expect.objectContaining({ code: "LEDGER_EPOCH_MISMATCH" }),
    );
    expect(LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_LIMITATIONS.join(" ")).toMatch(
      /same-user attacker.*delete.*replace.*copy.*restore.*epoch/iu,
    );
  });

  it("binds the exact caller-supplied epoch", () => {
    const path = databasePath();
    provision(path);
    expect(() =>
      __testOnlyOpenLocalOfflinePreviewSqlitePermitLedger(
        options(path, 100, OTHER_EPOCH),
        controls(),
      )
    ).toThrowError(expect.objectContaining({ code: "LEDGER_EPOCH_MISMATCH" }));
    expect(() =>
      __testOnlyOpenLocalOfflinePreviewSqlitePermitLedger(
        options(path, 100, EPOCH.toUpperCase()),
        controls(),
      )
    ).toThrowError(expect.objectContaining({ code: "LEDGER_OPTIONS_REJECTED" }));
  });

  it("requires the exact STRICT, WITHOUT ROWID schema", () => {
    const path = databasePath();
    provision(path);
    const database = new DatabaseSync(path, { readBigInts: true });
    const rows = database.prepare(`
      SELECT name, type, wr, strict
      FROM pragma_table_list
      WHERE name IN ('ledger_metadata', 'permit_tombstones')
      ORDER BY name
    `).all();
    expect(rows).toEqual([
      expect.objectContaining({ name: "ledger_metadata", type: "table", wr: 1n, strict: 1n }),
      expect.objectContaining({ name: "permit_tombstones", type: "table", wr: 1n, strict: 1n }),
    ]);
    database.exec("CREATE TABLE unexpected_table (value TEXT) STRICT");
    database.close();

    expect(() => openTestStore(path)).toThrowError(
      expect.objectContaining({ code: "LEDGER_SCHEMA_REJECTED" }),
    );
  });

  it("rejects corrupt metadata and corrupt database bytes", () => {
    const metadataPath = databasePath();
    provision(metadataPath);
    const metadataDatabase = new DatabaseSync(metadataPath);
    metadataDatabase.exec("UPDATE ledger_metadata SET reservation_count = 1");
    metadataDatabase.close();
    expect(() => openTestStore(metadataPath)).toThrowError(
      expect.objectContaining({ code: "LEDGER_METADATA_REJECTED" }),
    );

    const corruptPath = databasePath();
    provision(corruptPath);
    writeFileSync(corruptPath, Buffer.from("not a SQLite database", "utf8"));
    expect(() => openTestStore(corruptPath)).toThrowError(
      expect.objectContaining({
        code: expect.stringMatching(
          /LEDGER_(?:OPEN_FAILED|INTEGRITY_CHECK_FAILED)/u,
        ),
      }),
    );
  });

  it("blocks a new reservation when another tombstone is corrupted after open", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path);
    store.reserve(input());

    const attacker = new DatabaseSync(path);
    attacker.exec("UPDATE permit_tombstones SET expires_at = 'not-a-time'");
    attacker.close();

    expect(() =>
      store.reserve(input(`sha256:${"d".repeat(64)}`))
    ).toThrowError(expect.objectContaining({ code: "LEDGER_METADATA_REJECTED" }));
    expect(() => store.reserve(input())).toThrowError(
      expect.objectContaining({ code: "LEDGER_METADATA_REJECTED" }),
    );
  });

  it("fails closed when the wall clock moves behind the durable high-water mark", () => {
    const path = databasePath();
    provision(path);
    let clock = NOW + 2_000;
    const store = openTestStore(path, () => clock);
    store.reserve(input(DIGEST, "2026-07-18T12:05:02.000Z"));
    clock = NOW + 1_000;
    expect(() => store.audit()).toThrowError(
      expect.objectContaining({ code: "LEDGER_CLOCK_ROLLBACK" }),
    );
    store.close();
    expect(() => openTestStore(path, () => NOW)).toThrowError(
      expect.objectContaining({ code: "LEDGER_CLOCK_ROLLBACK" }),
    );
  });

  it("retains expired tombstones and advances the audited high-water mark", () => {
    const path = databasePath();
    provision(path);
    let clock = NOW;
    const store = openTestStore(path, () => clock);
    store.reserve(input(DIGEST, "2026-07-18T12:00:01.000Z"));
    clock = NOW + 2_000;
    expect(store.audit()).toEqual({
      totalPermanentTombstones: 1,
      unexpiredTombstones: 0,
      expiredTombstonesRetained: 1,
      highestObservedAt: "2026-07-18T12:00:02.000Z",
      reservationCount: 1,
    });
    clock = NOW + 1_000;
    expect(() => store.reserve(input(`sha256:${"d".repeat(64)}`))).toThrowError(
      expect.objectContaining({ code: "LEDGER_CLOCK_ROLLBACK" }),
    );
  });

  it("enforces capacity atomically while still identifying an exact replay", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path, () => NOW, 2);
    store.reserve(input(`sha256:${"1".repeat(64)}`));
    store.reserve(input(`sha256:${"2".repeat(64)}`));
    expect(() => store.reserve(input(`sha256:${"1".repeat(64)}`))).toThrowError(
      expect.objectContaining({ code: "PERMIT_ALREADY_CONSUMED" }),
    );
    expect(() => store.reserve(input(`sha256:${"3".repeat(64)}`))).toThrowError(
      expect.objectContaining({ code: "LEDGER_CAPACITY_EXCEEDED" }),
    );
    expect(store.audit()).toMatchObject({
      totalPermanentTombstones: 2,
      reservationCount: 2,
    });
  });

  it(
    "never exceeds capacity when distinct writers arrive simultaneously",
    async () => {
      const path = databasePath();
      provision(path);
      const digests = Array.from(
        { length: 16 },
        (_, index) => `sha256:${index.toString(16).padStart(64, "0")}`,
      );

      const results = await concurrentWorkerReservations(path, digests, 4);

      expect(results.filter((result) => result.status === "reserved")).toHaveLength(4);
      expect(
        results
          .filter((result) => result.status === "blocked")
          .map((result) => result.code),
      ).toEqual(Array.from({ length: 12 }, () => "LEDGER_CAPACITY_EXCEEDED"));
      const reopened = openLocalOfflinePreviewSqlitePermitLedger(options(path, 4));
      stores.push(reopened);
      expect(reopened.audit()).toMatchObject({
        totalPermanentTombstones: 4,
        reservationCount: 4,
      });
    },
    30_000,
  );

  it("maps a held writer lock to a bounded fail-closed busy result", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path, () => NOW, 100, PRODUCTION_MAXIMUM_PAGE_COUNT, 10);
    const blocker = new DatabaseSync(path, { timeout: 10 });
    blocker.exec("BEGIN IMMEDIATE");
    try {
      expect(() => store.reserve(input())).toThrowError(
        expect.objectContaining({ code: "LEDGER_BUSY" }),
      );
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
  });

  it("maps the bounded SQLite page ceiling to storage exhaustion", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path, () => NOW, 1_000, 4, 100);
    let failure: unknown = null;
    for (let index = 0; index < 1_000; index += 1) {
      const digest = `sha256:${index.toString(16).padStart(64, "0")}`;
      try {
        store.reserve(input(digest));
      } catch (error: unknown) {
        failure = error;
        break;
      }
    }
    expect(errorCode(failure)).toBe("LEDGER_STORAGE_EXHAUSTED");
    const audit = store.audit();
    expect(audit.totalPermanentTombstones).toBeGreaterThan(0);
    expect(audit.totalPermanentTombstones).toBeLessThan(1_000);
    expect(audit.reservationCount).toBe(audit.totalPermanentTombstones);
  });

  it("rejects malformed, expired, accessor, proxy, and extra-key inputs", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path);
    const invalid: readonly unknown[] = [
      input("not-a-digest"),
      { ...input(), requestId: "not-canonical" },
      input(DIGEST, INITIAL),
      { ...input(), sourcePath: "C:\\private\\room.glb" },
      Object.assign(Object.create(null) as Record<string, unknown>, input()),
    ];
    for (const value of invalid) {
      expect(() => store.reserve(value)).toThrowError(
        expect.objectContaining({ code: "LEDGER_RESERVATION_INPUT_REJECTED" }),
      );
    }

    let getterReads = 0;
    const accessor = {
      ...input(),
      get permitPayloadSha256(): string {
        getterReads += 1;
        return DIGEST;
      },
    };
    expect(() => store.reserve(accessor)).toThrowError(
      expect.objectContaining({ code: "LEDGER_RESERVATION_INPUT_REJECTED" }),
    );
    expect(getterReads).toBe(0);

    let proxyTraps = 0;
    const proxy = new Proxy({ ...input() }, {
      get(): never {
        proxyTraps += 1;
        throw new Error("proxy read");
      },
      getOwnPropertyDescriptor(): never {
        proxyTraps += 1;
        throw new Error("proxy descriptor");
      },
      ownKeys(): never {
        proxyTraps += 1;
        throw new Error("proxy keys");
      },
    });
    expect(() => store.reserve(proxy)).toThrowError(
      expect.objectContaining({ code: "LEDGER_RESERVATION_INPUT_REJECTED" }),
    );
    expect(proxyTraps).toBe(0);

    const symbolExtra = { ...input() } as Record<PropertyKey, unknown>;
    symbolExtra[Symbol("hidden")] = "forbidden";
    expect(() => store.reserve(symbolExtra)).toThrowError(
      expect.objectContaining({ code: "LEDGER_RESERVATION_INPUT_REJECTED" }),
    );
  });

  it("rejects getters, proxies, and extra keys in open options", () => {
    const path = databasePath();
    provision(path);
    let reads = 0;
    const accessor = {
      ledgerEpoch: EPOCH,
      maximumEntries: 100,
      get databasePath(): string {
        reads += 1;
        return path;
      },
    };
    expect(() => openLocalOfflinePreviewSqlitePermitLedger(accessor)).toThrowError(
      expect.objectContaining({ code: "LEDGER_OPTIONS_REJECTED" }),
    );
    expect(reads).toBe(0);
    expect(() =>
      openLocalOfflinePreviewSqlitePermitLedger({
        ...options(path),
        sourcePath: "C:\\secret.glb",
      } as LocalOfflinePreviewSqlitePermitLedgerOpenOptions)
    ).toThrowError(expect.objectContaining({ code: "LEDGER_OPTIONS_REJECTED" }));

    const proxy = new Proxy(options(path), {});
    expect(() => openLocalOfflinePreviewSqlitePermitLedger(proxy)).toThrowError(
      expect.objectContaining({ code: "LEDGER_OPTIONS_REJECTED" }),
    );
  });

  it("stores authority metadata only and no source bytes or paths", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path);
    store.reserve(input());
    store.close();

    const raw = readFileSync(path).toString("utf8");
    expect(raw).not.toMatch(/C:\\private|room\.glb|sourceBytes|sourcePath|permitEnvelope|privateKey/iu);
    const database = new DatabaseSync(path);
    const columns = database.prepare("PRAGMA table_info(permit_tombstones)").all()
      .map((row) => row.name);
    database.close();
    expect(columns).toEqual([
      "permit_payload_sha256",
      "request_id",
      "policy_digest",
      "expires_at",
      "consumed_at",
      "consumed_at_ms",
    ]);
  });

  it("closes cleanly and releases the Windows file handle", () => {
    const path = databasePath();
    provision(path);
    const store = openTestStore(path);
    store.close();
    store.close();
    expect(() => store.audit()).toThrowError(
      expect.objectContaining({ code: "LEDGER_CLOSED" }),
    );
    rmSync(path, { force: true });
    expect(existsSync(path)).toBe(false);
  });
});
