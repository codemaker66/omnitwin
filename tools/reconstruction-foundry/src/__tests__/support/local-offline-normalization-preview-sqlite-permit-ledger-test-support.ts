import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  rmSync,
  type Stats,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1,
} from "../../local-offline-normalization-preview-sqlite-permit-ledger.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const SQLITE_APPLICATION_ID = 0x4f_54_4c_50;
const SQLITE_USER_VERSION = 1;
const SQLITE_PAGE_SIZE_BYTES = 4_096;
const MAXIMUM_PAGE_COUNT = 131_072;

const METADATA_TABLE_SQL = `CREATE TABLE ledger_metadata (
  schema_version TEXT NOT NULL PRIMARY KEY CHECK (schema_version = '${LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1}'),
  ledger_epoch TEXT NOT NULL CHECK (length(ledger_epoch) = 71 AND substr(ledger_epoch, 1, 7) = 'sha256:' AND substr(ledger_epoch, 8) NOT GLOB '*[^0-9a-f]*'),
  highest_observed_at_ms INTEGER NOT NULL CHECK (highest_observed_at_ms >= 0),
  reservation_count INTEGER NOT NULL CHECK (reservation_count >= 0)
) STRICT, WITHOUT ROWID`;

const TOMBSTONE_TABLE_SQL = `CREATE TABLE permit_tombstones (
  permit_payload_sha256 TEXT NOT NULL PRIMARY KEY CHECK (length(permit_payload_sha256) = 71 AND substr(permit_payload_sha256, 1, 7) = 'sha256:' AND substr(permit_payload_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
  request_id TEXT NOT NULL CHECK (length(request_id) = 32 AND request_id NOT GLOB '*[^0-9a-f]*'),
  policy_digest TEXT NOT NULL CHECK (length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:' AND substr(policy_digest, 8) NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  consumed_at_ms INTEGER NOT NULL CHECK (consumed_at_ms >= 0)
) STRICT, WITHOUT ROWID`;

export interface TestOnlySqlitePermitLedgerProvisionOptions {
  readonly databasePath: string;
  readonly ledgerEpoch: string;
  readonly initialObservedAt: string;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function canonicalUtc(value: string): boolean {
  if (!CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

/** Test-bundle-only provisioning. This module is never imported by runtime. */
export function provisionTestOnlySqlitePermitLedger(
  options: TestOnlySqlitePermitLedgerProvisionOptions,
): void {
  if (
    typeof options.databasePath !== "string" ||
    typeof options.ledgerEpoch !== "string" ||
    !SHA256.test(options.ledgerEpoch) ||
    typeof options.initialObservedAt !== "string" ||
    !canonicalUtc(options.initialObservedAt)
  ) {
    throw new TypeError("Invalid test-ledger provisioning options.");
  }
  const reservationDescriptor = openSync(options.databasePath, "wx", 0o600);
  const reservedIdentity = fstatSync(reservationDescriptor);
  let database: DatabaseSync | null = null;
  let currentPathIsReservedFile = false;
  try {
    database = new DatabaseSync(options.databasePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readBigInts: true,
      timeout: 5_000,
    });
    database.exec(`PRAGMA page_size = ${String(SQLITE_PAGE_SIZE_BYTES)}`);
    database.exec("PRAGMA auto_vacuum = NONE");
    database.exec(`PRAGMA application_id = ${String(SQLITE_APPLICATION_ID)}`);
    database.exec(`PRAGMA user_version = ${String(SQLITE_USER_VERSION)}`);
    database.exec("PRAGMA trusted_schema = OFF");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA synchronous = EXTRA");
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec(`PRAGMA max_page_count = ${String(MAXIMUM_PAGE_COUNT)}`);
    database.exec("BEGIN IMMEDIATE");
    database.exec(`${METADATA_TABLE_SQL};`);
    database.exec(`${TOMBSTONE_TABLE_SQL};`);
    database.prepare(`
      INSERT INTO ledger_metadata (
        schema_version, ledger_epoch, highest_observed_at_ms, reservation_count
      ) VALUES (?, ?, ?, 0)
    `).run(
      LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1,
      options.ledgerEpoch,
      BigInt(Date.parse(options.initialObservedAt)),
    );
    database.exec("COMMIT");
    database.close();
    database = null;
    currentPathIsReservedFile = sameFile(
      reservedIdentity,
      lstatSync(options.databasePath),
    );
    if (!currentPathIsReservedFile) {
      throw new Error("Test ledger path identity changed during provisioning.");
    }
  } catch (error: unknown) {
    if (database !== null) {
      try {
        database.close();
      } catch {
        // The test remains failed; identity-checked cleanup follows.
      }
    }
    try {
      currentPathIsReservedFile = sameFile(
        reservedIdentity,
        lstatSync(options.databasePath),
      );
    } catch {
      currentPathIsReservedFile = false;
    }
    if (currentPathIsReservedFile) {
      for (const suffix of ["", "-journal", "-shm", "-wal"] as const) {
        rmSync(`${options.databasePath}${suffix}`, { force: true });
      }
    }
    throw error;
  } finally {
    closeSync(reservationDescriptor);
  }
}
