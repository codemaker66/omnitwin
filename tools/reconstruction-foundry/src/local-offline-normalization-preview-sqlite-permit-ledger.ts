import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { types as utilTypes } from "node:util";

export const LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-sqlite-permit-ledger.v1";

export const LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_LIMITATIONS =
  Object.freeze([
    "SQLite DELETE-journal transactions with synchronous=EXTRA improve atomicity across ordinary Windows process, power, and restart failures.",
    "The ledger does not defend against a same-user attacker who can delete, replace, copy, or restore the database and also reproduce its externally supplied ledger epoch.",
    "The database path and ledger epoch must therefore come from an application-owned installation or release boundary, not dragged files or browser input.",
    "Replay prevention is local to one intact, non-rolled-back ledger. It does not stop the same permit being used on another machine, OS account, database, or restored snapshot.",
  ] as const);

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_FULL = 13;
const SQLITE_PRIMARY_CODE_MASK = 0xff;
const SQLITE_PAGE_SIZE_BYTES = 4_096;
const PRODUCTION_MAXIMUM_PAGE_COUNT = 131_072;
const PRODUCTION_BUSY_TIMEOUT_MILLISECONDS = 5_000;
const MAXIMUM_PERMITTED_ENTRIES = 1_000_000;
const SQLITE_APPLICATION_ID = 0x4f_54_4c_50;
const SQLITE_USER_VERSION = 1;

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

export const LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_ERROR_CODES = [
  "LEDGER_OPTIONS_REJECTED",
  "LEDGER_PATH_REJECTED",
  "LEDGER_NOT_FOUND",
  "LEDGER_OPEN_FAILED",
  "LEDGER_BUSY",
  "LEDGER_STORAGE_EXHAUSTED",
  "LEDGER_INTEGRITY_CHECK_FAILED",
  "LEDGER_SCHEMA_REJECTED",
  "LEDGER_METADATA_REJECTED",
  "LEDGER_EPOCH_MISMATCH",
  "LEDGER_CLOCK_ROLLBACK",
  "LEDGER_CAPACITY_EXCEEDED",
  "LEDGER_RESERVATION_INPUT_REJECTED",
  "PERMIT_ALREADY_CONSUMED",
  "LEDGER_PERSISTENCE_UNCONFIRMED",
  "LEDGER_CLOSED",
  "LEDGER_PROVISIONING_REJECTED",
] as const;

export type LocalOfflinePreviewSqlitePermitLedgerErrorCode =
  (typeof LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_ERROR_CODES)[number];

export class LocalOfflinePreviewSqlitePermitLedgerError extends Error {
  readonly code: LocalOfflinePreviewSqlitePermitLedgerErrorCode;

  constructor(code: LocalOfflinePreviewSqlitePermitLedgerErrorCode) {
    super(`Offline preview permission ledger blocked (${code}).`);
    this.name = "LocalOfflinePreviewSqlitePermitLedgerError";
    this.code = code;
  }
}

export interface LocalOfflinePreviewSqlitePermitLedgerOpenOptions {
  readonly databasePath: string;
  readonly ledgerEpoch: string;
  readonly maximumEntries: number;
}

export interface LocalOfflinePreviewSqlitePermitReservationInput {
  readonly permitPayloadSha256: string;
  readonly requestId: string;
  readonly policyDigest: string;
  readonly expiresAt: string;
}

export interface LocalOfflinePreviewSqlitePermitReservation {
  readonly permitPayloadSha256: string;
  readonly requestId: string;
  readonly expiresAt: string;
  readonly consumedAt: string;
}

export interface LocalOfflinePreviewSqlitePermitLedgerAudit {
  readonly totalPermanentTombstones: number;
  readonly unexpiredTombstones: number;
  readonly expiredTombstonesRetained: number;
  readonly highestObservedAt: string;
  readonly reservationCount: number;
}

export interface LocalOfflinePreviewSqlitePermitLedger {
  reserve(input: unknown): LocalOfflinePreviewSqlitePermitReservation;
  audit(): LocalOfflinePreviewSqlitePermitLedgerAudit;
  close(): void;
}

export interface LocalOfflinePreviewSqlitePermitLedgerTestControls {
  readonly now: () => number;
  readonly maximumPageCount: number;
  readonly busyTimeoutMilliseconds: number;
}

interface OpenSnapshot {
  readonly databasePath: string;
  readonly ledgerEpoch: string;
  readonly maximumEntries: number;
}

interface StoreDependencies {
  readonly now: () => number;
  readonly maximumPageCount: number;
  readonly busyTimeoutMilliseconds: number;
}

interface LedgerMetadata {
  readonly ledgerEpoch: string;
  readonly highestObservedAtMilliseconds: number;
  readonly reservationCount: number;
}

interface TombstoneAudit {
  readonly total: number;
  readonly expired: number;
}

function fail(code: LocalOfflinePreviewSqlitePermitLedgerErrorCode): never {
  throw new LocalOfflinePreviewSqlitePermitLedgerError(code);
}

function exactDataSnapshot(
  input: unknown,
  expectedKeys: readonly string[],
  code: LocalOfflinePreviewSqlitePermitLedgerErrorCode,
): Readonly<Record<string, unknown>> {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      utilTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    ) {
      fail(code);
    }
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) =>
        typeof key !== "string" || !expectedKeys.includes(key)
      )
    ) {
      fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const snapshot: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        fail(code);
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch (error: unknown) {
    if (error instanceof LocalOfflinePreviewSqlitePermitLedgerError) throw error;
    fail(code);
  }
}

function canonicalUtc(value: string): boolean {
  if (!CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

function canonicalMilliseconds(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  return canonicalUtc(new Date(value).toISOString());
}

function isClockFunction(value: unknown): value is () => number {
  return typeof value === "function";
}

function comparablePath(value: string): string {
  const resolved = normalize(resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateExistingDatabasePath(databasePath: string): void {
  if (
    !isAbsolute(databasePath) ||
    databasePath.includes("\0") ||
    comparablePath(databasePath) === comparablePath(dirname(databasePath))
  ) {
    fail("LEDGER_PATH_REJECTED");
  }
  try {
    const status = lstatSync(databasePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      fail("LEDGER_PATH_REJECTED");
    }
    if (comparablePath(realpathSync.native(databasePath)) !== comparablePath(databasePath)) {
      fail("LEDGER_PATH_REJECTED");
    }
  } catch (error: unknown) {
    if (error instanceof LocalOfflinePreviewSqlitePermitLedgerError) throw error;
    if (systemErrorCode(error) === "ENOENT") fail("LEDGER_NOT_FOUND");
    fail("LEDGER_PATH_REJECTED");
  }
}

function snapshotOpenOptions(
  input: LocalOfflinePreviewSqlitePermitLedgerOpenOptions,
): OpenSnapshot {
  const values = exactDataSnapshot(
    input,
    ["databasePath", "ledgerEpoch", "maximumEntries"],
    "LEDGER_OPTIONS_REJECTED",
  );
  const databasePath = values.databasePath;
  const ledgerEpoch = values.ledgerEpoch;
  const maximumEntries = values.maximumEntries;
  if (
    typeof databasePath !== "string" ||
    typeof ledgerEpoch !== "string" ||
    !SHA256.test(ledgerEpoch) ||
    typeof maximumEntries !== "number" ||
    !Number.isSafeInteger(maximumEntries) ||
    maximumEntries < 1 ||
    maximumEntries > MAXIMUM_PERMITTED_ENTRIES
  ) {
    fail("LEDGER_OPTIONS_REJECTED");
  }
  return Object.freeze({ databasePath, ledgerEpoch, maximumEntries });
}

function snapshotReservationInput(
  input: unknown,
  now: number,
): LocalOfflinePreviewSqlitePermitReservationInput {
  const values = exactDataSnapshot(
    input,
    ["expiresAt", "permitPayloadSha256", "policyDigest", "requestId"],
    "LEDGER_RESERVATION_INPUT_REJECTED",
  );
  const permitPayloadSha256 = values.permitPayloadSha256;
  const requestId = values.requestId;
  const policyDigest = values.policyDigest;
  const expiresAt = values.expiresAt;
  if (
    typeof permitPayloadSha256 !== "string" ||
    !SHA256.test(permitPayloadSha256) ||
    typeof requestId !== "string" ||
    !REQUEST_ID.test(requestId) ||
    typeof policyDigest !== "string" ||
    !SHA256.test(policyDigest) ||
    typeof expiresAt !== "string" ||
    !canonicalUtc(expiresAt) ||
    Date.parse(expiresAt) <= now
  ) {
    fail("LEDGER_RESERVATION_INPUT_REJECTED");
  }
  return Object.freeze({ permitPayloadSha256, requestId, policyDigest, expiresAt });
}

function snapshotTestControls(
  controls: LocalOfflinePreviewSqlitePermitLedgerTestControls,
): StoreDependencies {
  const values = exactDataSnapshot(
    controls,
    ["busyTimeoutMilliseconds", "maximumPageCount", "now"],
    "LEDGER_OPTIONS_REJECTED",
  );
  const now = values.now;
  const maximumPageCount = values.maximumPageCount;
  const busyTimeoutMilliseconds = values.busyTimeoutMilliseconds;
  if (
    !isClockFunction(now) ||
    typeof maximumPageCount !== "number" ||
    !Number.isSafeInteger(maximumPageCount) ||
    maximumPageCount < 4 ||
    maximumPageCount > PRODUCTION_MAXIMUM_PAGE_COUNT ||
    typeof busyTimeoutMilliseconds !== "number" ||
    !Number.isSafeInteger(busyTimeoutMilliseconds) ||
    busyTimeoutMilliseconds < 1 ||
    busyTimeoutMilliseconds > PRODUCTION_BUSY_TIMEOUT_MILLISECONDS
  ) {
    fail("LEDGER_OPTIONS_REJECTED");
  }
  return Object.freeze({ now, maximumPageCount, busyTimeoutMilliseconds });
}

function systemErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string"
    ? (error as { readonly code: string }).code
    : null;
}

function sqlitePrimaryErrorCode(error: unknown): number | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("errcode" in error) ||
    typeof (error as { readonly errcode?: unknown }).errcode !== "number"
  ) {
    return null;
  }
  return (error as { readonly errcode: number }).errcode & SQLITE_PRIMARY_CODE_MASK;
}

function normalizedFailure(
  error: unknown,
  fallback: LocalOfflinePreviewSqlitePermitLedgerErrorCode,
): LocalOfflinePreviewSqlitePermitLedgerError {
  if (error instanceof LocalOfflinePreviewSqlitePermitLedgerError) return error;
  const primaryCode = sqlitePrimaryErrorCode(error);
  if (primaryCode === SQLITE_BUSY || primaryCode === SQLITE_LOCKED) {
    return new LocalOfflinePreviewSqlitePermitLedgerError("LEDGER_BUSY");
  }
  if (primaryCode === SQLITE_FULL) {
    return new LocalOfflinePreviewSqlitePermitLedgerError(
      "LEDGER_STORAGE_EXHAUSTED",
    );
  }
  return new LocalOfflinePreviewSqlitePermitLedgerError(fallback);
}

function exactNow(dependencies: StoreDependencies): number {
  let value: number;
  try {
    value = dependencies.now();
  } catch {
    fail("LEDGER_CLOCK_ROLLBACK");
  }
  if (!canonicalMilliseconds(value)) fail("LEDGER_CLOCK_ROLLBACK");
  return value;
}

function existingOnlyUri(databasePath: string): string {
  const url = new URL(pathToFileURL(databasePath));
  url.searchParams.set("mode", "rw");
  return url.href;
}

function openDatabase(databasePath: string, dependencies: StoreDependencies): DatabaseSync {
  validateExistingDatabasePath(databasePath);
  try {
    const database = new DatabaseSync(existingOnlyUri(databasePath), {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readBigInts: true,
      timeout: dependencies.busyTimeoutMilliseconds,
    });
    if (
      database.location() === null ||
      comparablePath(database.location() ?? "") !== comparablePath(databasePath)
    ) {
      database.close();
      fail("LEDGER_PATH_REJECTED");
    }
    return database;
  } catch (error: unknown) {
    throw normalizedFailure(error, "LEDGER_OPEN_FAILED");
  }
}

function pragmaScalar(database: DatabaseSync, sql: string): string | bigint | number {
  const row = database.prepare(sql).get();
  if (row === undefined) fail("LEDGER_INTEGRITY_CHECK_FAILED");
  const keys = Object.keys(row);
  if (keys.length !== 1) fail("LEDGER_INTEGRITY_CHECK_FAILED");
  const value = row[keys[0] ?? ""];
  if (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") {
    fail("LEDGER_INTEGRITY_CHECK_FAILED");
  }
  return value;
}

function configureConnection(database: DatabaseSync, dependencies: StoreDependencies): void {
  database.exec("PRAGMA trusted_schema = OFF");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`PRAGMA busy_timeout = ${String(dependencies.busyTimeoutMilliseconds)}`);
  database.exec("PRAGMA synchronous = EXTRA");
  database.exec("PRAGMA journal_mode = DELETE");
  database.exec(`PRAGMA max_page_count = ${String(dependencies.maximumPageCount)}`);
  const checks = [
    [pragmaScalar(database, "PRAGMA trusted_schema"), 0n],
    [pragmaScalar(database, "PRAGMA foreign_keys"), 1n],
    [pragmaScalar(database, "PRAGMA busy_timeout"), BigInt(dependencies.busyTimeoutMilliseconds)],
    [pragmaScalar(database, "PRAGMA synchronous"), 3n],
    [pragmaScalar(database, "PRAGMA journal_mode"), "delete"],
    [pragmaScalar(database, "PRAGMA page_size"), BigInt(SQLITE_PAGE_SIZE_BYTES)],
    [pragmaScalar(database, "PRAGMA max_page_count"), BigInt(dependencies.maximumPageCount)],
    [pragmaScalar(database, "PRAGMA application_id"), BigInt(SQLITE_APPLICATION_ID)],
    [pragmaScalar(database, "PRAGMA user_version"), BigInt(SQLITE_USER_VERSION)],
    [pragmaScalar(database, "PRAGMA auto_vacuum"), 0n],
  ] as const;
  if (checks.some(([actual, expected]) => actual !== expected)) {
    fail("LEDGER_INTEGRITY_CHECK_FAILED");
  }
  const pageCount = pragmaScalar(database, "PRAGMA page_count");
  if (typeof pageCount !== "bigint" || pageCount > BigInt(dependencies.maximumPageCount)) {
    fail("LEDGER_STORAGE_EXHAUSTED");
  }
}

function validateQuickCheck(database: DatabaseSync): void {
  const rows = database.prepare("PRAGMA quick_check(1)").all();
  if (
    rows.length !== 1 ||
    Object.keys(rows[0] ?? {}).length !== 1 ||
    (rows[0] ?? {}).quick_check !== "ok"
  ) {
    fail("LEDGER_INTEGRITY_CHECK_FAILED");
  }
}

function validateExactSchema(database: DatabaseSync): void {
  const rows = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const expected = [
    { type: "table", name: "ledger_metadata", tbl_name: "ledger_metadata", sql: METADATA_TABLE_SQL },
    { type: "table", name: "permit_tombstones", tbl_name: "permit_tombstones", sql: TOMBSTONE_TABLE_SQL },
  ];
  if (rows.length !== expected.length) fail("LEDGER_SCHEMA_REJECTED");
  for (const [index, wanted] of expected.entries()) {
    const row = rows[index];
    if (
      row === undefined ||
      row.type !== wanted.type ||
      row.name !== wanted.name ||
      row.tbl_name !== wanted.tbl_name ||
      row.sql !== wanted.sql ||
      Object.keys(row).sort().join("\0") !== "name\0sql\0tbl_name\0type"
    ) {
      fail("LEDGER_SCHEMA_REJECTED");
    }
  }
}

function safeIntegerFromSql(value: unknown): number | null {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

function readMetadata(
  database: DatabaseSync,
  options: OpenSnapshot,
  now: number,
): LedgerMetadata {
  const rows = database.prepare(`
    SELECT schema_version, ledger_epoch, highest_observed_at_ms, reservation_count
    FROM ledger_metadata
  `).all();
  if (rows.length !== 1) fail("LEDGER_METADATA_REJECTED");
  const row = rows[0] ?? {};
  if (row.schema_version !== LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1) {
    fail("LEDGER_METADATA_REJECTED");
  }
  if (row.ledger_epoch !== options.ledgerEpoch) fail("LEDGER_EPOCH_MISMATCH");
  const highest = safeIntegerFromSql(row.highest_observed_at_ms);
  const count = safeIntegerFromSql(row.reservation_count);
  if (highest === null || count === null || !canonicalMilliseconds(highest)) {
    fail("LEDGER_METADATA_REJECTED");
  }
  if (now < highest) fail("LEDGER_CLOCK_ROLLBACK");
  if (count > options.maximumEntries) fail("LEDGER_CAPACITY_EXCEEDED");
  const countRow = database.prepare(
    "SELECT count(*) AS tombstone_count FROM permit_tombstones",
  ).get();
  const tombstoneCount = safeIntegerFromSql(countRow?.tombstone_count);
  if (tombstoneCount === null || tombstoneCount !== count) {
    fail("LEDGER_METADATA_REJECTED");
  }
  return Object.freeze({
    ledgerEpoch: options.ledgerEpoch,
    highestObservedAtMilliseconds: highest,
    reservationCount: count,
  });
}

function validateTombstoneRow(
  row: Readonly<Record<string, unknown>>,
  highestObservedAtMilliseconds: number,
): number {
  const permitDigest = row.permit_payload_sha256;
  const requestId = row.request_id;
  const policyDigest = row.policy_digest;
  const expiresAt = row.expires_at;
  const consumedAt = row.consumed_at;
  const consumedAtMilliseconds = safeIntegerFromSql(row.consumed_at_ms);
  if (
    typeof permitDigest !== "string" ||
    !SHA256.test(permitDigest) ||
    typeof requestId !== "string" ||
    !REQUEST_ID.test(requestId) ||
    typeof policyDigest !== "string" ||
    !SHA256.test(policyDigest) ||
    typeof expiresAt !== "string" ||
    !canonicalUtc(expiresAt) ||
    typeof consumedAt !== "string" ||
    !canonicalUtc(consumedAt) ||
    consumedAtMilliseconds === null ||
    Date.parse(consumedAt) !== consumedAtMilliseconds ||
    Date.parse(expiresAt) <= consumedAtMilliseconds ||
    consumedAtMilliseconds > highestObservedAtMilliseconds
  ) {
    fail("LEDGER_METADATA_REJECTED");
  }
  return Date.parse(expiresAt);
}

function auditTombstones(
  database: DatabaseSync,
  metadata: LedgerMetadata,
  now: number,
): TombstoneAudit {
  const statement = database.prepare(`
    SELECT permit_payload_sha256, request_id, policy_digest, expires_at, consumed_at, consumed_at_ms
    FROM permit_tombstones
    ORDER BY permit_payload_sha256
  `);
  let total = 0;
  let expired = 0;
  for (const row of statement.iterate()) {
    const expiration = validateTombstoneRow(row, metadata.highestObservedAtMilliseconds);
    total += 1;
    if (expiration <= now) expired += 1;
  }
  if (total !== metadata.reservationCount) fail("LEDGER_METADATA_REJECTED");
  return Object.freeze({ total, expired });
}

function validateLedger(
  database: DatabaseSync,
  options: OpenSnapshot,
  now: number,
  auditRows: boolean,
): { readonly metadata: LedgerMetadata; readonly tombstones: TombstoneAudit | null } {
  validateQuickCheck(database);
  validateExactSchema(database);
  const metadata = readMetadata(database, options, now);
  const tombstones = auditRows ? auditTombstones(database, metadata, now) : null;
  return Object.freeze({ metadata, tombstones });
}

function rollbackConfirmed(database: DatabaseSync): boolean {
  try {
    database.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}

function runReadValidation(
  database: DatabaseSync,
  options: OpenSnapshot,
  dependencies: StoreDependencies,
): void {
  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    validateLedger(database, options, exactNow(dependencies), true);
    database.exec("COMMIT");
    transactionStarted = false;
  } catch (error: unknown) {
    if (transactionStarted && !rollbackConfirmed(database)) {
      fail("LEDGER_PERSISTENCE_UNCONFIRMED");
    }
    throw normalizedFailure(error, "LEDGER_INTEGRITY_CHECK_FAILED");
  }
}

function findTombstone(
  database: DatabaseSync,
  permitPayloadSha256: string,
  highestObservedAtMilliseconds: number,
): boolean {
  const row = database.prepare(`
    SELECT permit_payload_sha256, request_id, policy_digest, expires_at, consumed_at, consumed_at_ms
    FROM permit_tombstones
    WHERE permit_payload_sha256 = ?
  `).get(permitPayloadSha256);
  if (row === undefined) return false;
  validateTombstoneRow(row, highestObservedAtMilliseconds);
  return true;
}

class SqlitePermitLedger implements LocalOfflinePreviewSqlitePermitLedger {
  readonly #database: DatabaseSync;
  readonly #options: OpenSnapshot;
  readonly #dependencies: StoreDependencies;
  #closed = false;

  constructor(
    database: DatabaseSync,
    options: OpenSnapshot,
    dependencies: StoreDependencies,
  ) {
    this.#database = database;
    this.#options = options;
    this.#dependencies = dependencies;
  }

  reserve(input: unknown): LocalOfflinePreviewSqlitePermitReservation {
    this.#ensureOpen();
    let transactionStarted = false;
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const now = exactNow(this.#dependencies);
      const snapshot = snapshotReservationInput(input, now);
      const consumedAt = new Date(now).toISOString();
      const { metadata } = validateLedger(
        this.#database,
        this.#options,
        now,
        true,
      );
      this.#insertOrReject(snapshot, consumedAt, now, metadata);
      this.#advanceMetadata(now, metadata);
      this.#database.exec("COMMIT");
      transactionStarted = false;
      return Object.freeze({
        permitPayloadSha256: snapshot.permitPayloadSha256,
        requestId: snapshot.requestId,
        expiresAt: snapshot.expiresAt,
        consumedAt,
      });
    } catch (error: unknown) {
      if (transactionStarted && !rollbackConfirmed(this.#database)) {
        fail("LEDGER_PERSISTENCE_UNCONFIRMED");
      }
      throw normalizedFailure(error, "LEDGER_PERSISTENCE_UNCONFIRMED");
    }
  }

  audit(): LocalOfflinePreviewSqlitePermitLedgerAudit {
    this.#ensureOpen();
    let transactionStarted = false;
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const now = exactNow(this.#dependencies);
      const validated = validateLedger(this.#database, this.#options, now, true);
      this.#advanceHighWater(now, validated.metadata);
      this.#database.exec("COMMIT");
      transactionStarted = false;
      const tombstones = validated.tombstones;
      if (tombstones === null) fail("LEDGER_METADATA_REJECTED");
      return Object.freeze({
        totalPermanentTombstones: tombstones.total,
        unexpiredTombstones: tombstones.total - tombstones.expired,
        expiredTombstonesRetained: tombstones.expired,
        highestObservedAt: new Date(now).toISOString(),
        reservationCount: validated.metadata.reservationCount,
      });
    } catch (error: unknown) {
      if (transactionStarted && !rollbackConfirmed(this.#database)) {
        fail("LEDGER_PERSISTENCE_UNCONFIRMED");
      }
      throw normalizedFailure(error, "LEDGER_INTEGRITY_CHECK_FAILED");
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#database.close();
    } catch (error: unknown) {
      throw normalizedFailure(error, "LEDGER_PERSISTENCE_UNCONFIRMED");
    }
  }

  #ensureOpen(): void {
    if (this.#closed) fail("LEDGER_CLOSED");
  }

  #insertOrReject(
    snapshot: LocalOfflinePreviewSqlitePermitReservationInput,
    consumedAt: string,
    now: number,
    metadata: LedgerMetadata,
  ): void {
    const result = this.#database.prepare(`
      INSERT INTO permit_tombstones (
        permit_payload_sha256, request_id, policy_digest, expires_at, consumed_at, consumed_at_ms
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE (
        SELECT reservation_count FROM ledger_metadata WHERE schema_version = ?
      ) < ?
      ON CONFLICT(permit_payload_sha256) DO NOTHING
    `).run(
      snapshot.permitPayloadSha256,
      snapshot.requestId,
      snapshot.policyDigest,
      snapshot.expiresAt,
      consumedAt,
      BigInt(now),
      LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1,
      BigInt(this.#options.maximumEntries),
    );
    if (result.changes === 1n) return;
    if (result.changes !== 0n) fail("LEDGER_PERSISTENCE_UNCONFIRMED");
    if (
      findTombstone(
        this.#database,
        snapshot.permitPayloadSha256,
        metadata.highestObservedAtMilliseconds,
      )
    ) {
      fail("PERMIT_ALREADY_CONSUMED");
    }
    if (metadata.reservationCount >= this.#options.maximumEntries) {
      fail("LEDGER_CAPACITY_EXCEEDED");
    }
    fail("LEDGER_PERSISTENCE_UNCONFIRMED");
  }

  #advanceMetadata(now: number, metadata: LedgerMetadata): void {
    const result = this.#database.prepare(`
      UPDATE ledger_metadata
      SET highest_observed_at_ms = ?, reservation_count = reservation_count + 1
      WHERE schema_version = ?
        AND ledger_epoch = ?
        AND highest_observed_at_ms = ?
        AND reservation_count = ?
    `).run(
      BigInt(now),
      LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1,
      this.#options.ledgerEpoch,
      BigInt(metadata.highestObservedAtMilliseconds),
      BigInt(metadata.reservationCount),
    );
    if (result.changes !== 1n) fail("LEDGER_PERSISTENCE_UNCONFIRMED");
  }

  #advanceHighWater(now: number, metadata: LedgerMetadata): void {
    if (now === metadata.highestObservedAtMilliseconds) return;
    const result = this.#database.prepare(`
      UPDATE ledger_metadata
      SET highest_observed_at_ms = ?
      WHERE schema_version = ?
        AND ledger_epoch = ?
        AND highest_observed_at_ms = ?
        AND reservation_count = ?
    `).run(
      BigInt(now),
      LOCAL_OFFLINE_PREVIEW_SQLITE_PERMIT_LEDGER_SCHEMA_V1,
      this.#options.ledgerEpoch,
      BigInt(metadata.highestObservedAtMilliseconds),
      BigInt(metadata.reservationCount),
    );
    if (result.changes !== 1n) fail("LEDGER_PERSISTENCE_UNCONFIRMED");
  }
}

function openWithDependencies(
  input: LocalOfflinePreviewSqlitePermitLedgerOpenOptions,
  dependencies: StoreDependencies,
): LocalOfflinePreviewSqlitePermitLedger {
  const options = snapshotOpenOptions(input);
  const database = openDatabase(options.databasePath, dependencies);
  try {
    configureConnection(database, dependencies);
    runReadValidation(database, options, dependencies);
    return new SqlitePermitLedger(database, options, dependencies);
  } catch (error: unknown) {
    try {
      database.close();
    } catch {
      throw new LocalOfflinePreviewSqlitePermitLedgerError(
        "LEDGER_PERSISTENCE_UNCONFIRMED",
      );
    }
    throw normalizedFailure(error, "LEDGER_INTEGRITY_CHECK_FAILED");
  }
}

/**
 * Opens an already-provisioned production ledger. The SQLite URI uses
 * `mode=rw`, which refuses a missing file instead of creating an empty one.
 */
export function openLocalOfflinePreviewSqlitePermitLedger(
  options: LocalOfflinePreviewSqlitePermitLedgerOpenOptions,
): LocalOfflinePreviewSqlitePermitLedger {
  return openWithDependencies(options, {
    now: Date.now,
    maximumPageCount: PRODUCTION_MAXIMUM_PAGE_COUNT,
    busyTimeoutMilliseconds: PRODUCTION_BUSY_TIMEOUT_MILLISECONDS,
  });
}

/** Test-only seam. A ledger opened here cannot mint a live sandbox witness. */
export function __testOnlyOpenLocalOfflinePreviewSqlitePermitLedger(
  options: LocalOfflinePreviewSqlitePermitLedgerOpenOptions,
  controls: LocalOfflinePreviewSqlitePermitLedgerTestControls,
): LocalOfflinePreviewSqlitePermitLedger {
  return openWithDependencies(options, snapshotTestControls(controls));
}
