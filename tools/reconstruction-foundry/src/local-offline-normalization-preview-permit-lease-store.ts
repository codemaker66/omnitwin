import { randomBytes } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

export const LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_SCHEMA_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-permit-lease.v1";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REQUEST_ID = /^[a-f0-9]{32}$/u;
const CANONICAL_UTC =
  /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const LEASE_FILE = /^([a-f0-9]{64})\.lease\.json$/u;
const MAXIMUM_LEDGER_ENTRIES = 1_000_000;

export const LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_ERROR_CODES = [
  "STORE_PATH_REJECTED",
  "STORE_DIRECTORY_REJECTED",
  "LEASE_INPUT_REJECTED",
  "PERMIT_ALREADY_CONSUMED",
  "LEASE_PERSISTENCE_UNCONFIRMED",
  "LEDGER_ENTRY_REJECTED",
  "LEDGER_CAPACITY_EXCEEDED",
] as const;

export type LocalOfflinePreviewPermitLeaseErrorCode =
  (typeof LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_ERROR_CODES)[number];

export class LocalOfflinePreviewPermitLeaseError extends Error {
  readonly code: LocalOfflinePreviewPermitLeaseErrorCode;

  constructor(code: LocalOfflinePreviewPermitLeaseErrorCode) {
    super(`Offline preview permission reservation blocked (${code}).`);
    this.name = "LocalOfflinePreviewPermitLeaseError";
    this.code = code;
  }
}

export interface LocalOfflinePreviewPermitLeaseInput {
  readonly permitPayloadSha256: string;
  readonly requestId: string;
  readonly policyDigest: string;
  readonly expiresAt: string;
}

export interface LocalOfflinePreviewPermitLease {
  readonly permitPayloadSha256: string;
  readonly requestId: string;
  readonly expiresAt: string;
  readonly consumedAt: string;
}

export interface LocalOfflinePreviewPermitLeaseAudit {
  readonly totalPermanentTombstones: number;
  readonly unexpiredTombstones: number;
  readonly expiredTombstonesRetained: number;
}

export interface LocalOfflinePreviewPermitLeaseStore {
  /**
   * Permanently consumes one signed-permit payload digest within this intact
   * local ledger. The input contains authority metadata only; source bytes,
   * source paths, keys, and envelopes are deliberately absent.
   */
  reserve(
    input: unknown,
  ): Promise<LocalOfflinePreviewPermitLease>;

  /**
   * Validates every permanent tombstone. Expired entries are intentionally
   * retained so a wall-clock rollback cannot make an old permit reusable.
   */
  audit(): Promise<LocalOfflinePreviewPermitLeaseAudit>;

  close(): Promise<void>;
}

interface LocalOfflinePreviewPermitLeaseRecord
  extends LocalOfflinePreviewPermitLeaseInput {
  readonly schemaVersion: typeof LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_SCHEMA_V1;
  readonly consumedAt: string;
}

interface StoreDependencies {
  readonly rootDirectory: string;
  readonly now: () => number;
  readonly randomBytes: (size: number) => Uint8Array;
}

export interface LocalOfflinePreviewPermitLeaseStoreTestOptions {
  readonly rootDirectory: string;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}

function fail(code: LocalOfflinePreviewPermitLeaseErrorCode): never {
  throw new LocalOfflinePreviewPermitLeaseError(code);
}

function canonicalUtc(value: string): boolean {
  if (!CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalRecordBytes(record: LocalOfflinePreviewPermitLeaseRecord): Buffer {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: record.schemaVersion,
    permitPayloadSha256: record.permitPayloadSha256,
    requestId: record.requestId,
    policyDigest: record.policyDigest,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  })}\n`, "utf8");
}

function parseRecord(bytes: Uint8Array): LocalOfflinePreviewPermitLeaseRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (
    !isPlainObject(value) ||
    !exactKeys(value, [
      "consumedAt",
      "expiresAt",
      "permitPayloadSha256",
      "policyDigest",
      "requestId",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_SCHEMA_V1 ||
    typeof value.permitPayloadSha256 !== "string" ||
    !SHA256.test(value.permitPayloadSha256) ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.policyDigest !== "string" ||
    !SHA256.test(value.policyDigest) ||
    typeof value.expiresAt !== "string" ||
    !canonicalUtc(value.expiresAt) ||
    typeof value.consumedAt !== "string" ||
    !canonicalUtc(value.consumedAt)
  ) {
    return null;
  }
  const record: LocalOfflinePreviewPermitLeaseRecord = Object.freeze({
    schemaVersion: value.schemaVersion,
    permitPayloadSha256: value.permitPayloadSha256,
    requestId: value.requestId,
    policyDigest: value.policyDigest,
    expiresAt: value.expiresAt,
    consumedAt: value.consumedAt,
  });
  return Buffer.from(bytes).equals(canonicalRecordBytes(record)) ? record : null;
}

function systemErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string"
    ? (error as { readonly code: string }).code
    : null;
}

function comparablePath(value: string): string {
  const normalized = normalize(resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function ensureTrustedDirectory(rootDirectory: string): Promise<void> {
  if (!isAbsolute(rootDirectory) || comparablePath(rootDirectory) === comparablePath(dirname(rootDirectory))) {
    fail("STORE_PATH_REJECTED");
  }
  try {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    const [status, canonical] = await Promise.all([
      lstat(rootDirectory),
      realpath(rootDirectory),
    ]);
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      comparablePath(canonical) !== comparablePath(rootDirectory)
    ) {
      fail("STORE_DIRECTORY_REJECTED");
    }
  } catch (error: unknown) {
    if (error instanceof LocalOfflinePreviewPermitLeaseError) throw error;
    fail("STORE_DIRECTORY_REJECTED");
  }
}

async function syncDirectory(rootDirectory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(rootDirectory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function snapshotInput(
  input: unknown,
  now: number,
): LocalOfflinePreviewPermitLeaseInput {
  let descriptors: PropertyDescriptorMap;
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype
    ) {
      fail("LEASE_INPUT_REJECTED");
    }
    const ownKeys = Reflect.ownKeys(input);
    const expectedKeys = [
      "expiresAt",
      "permitPayloadSha256",
      "policyDigest",
      "requestId",
    ] as const;
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) =>
        typeof key !== "string" || !expectedKeys.includes(key as never)
      )
    ) {
      fail("LEASE_INPUT_REJECTED");
    }
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch (error: unknown) {
    if (error instanceof LocalOfflinePreviewPermitLeaseError) throw error;
    fail("LEASE_INPUT_REJECTED");
  }
  const values: Record<string, unknown> = {};
  for (const key of [
    "expiresAt",
    "permitPayloadSha256",
    "policyDigest",
    "requestId",
  ] as const) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail("LEASE_INPUT_REJECTED");
    }
    values[key] = descriptor.value;
  }
  const snapshot = Object.freeze({
    permitPayloadSha256: values.permitPayloadSha256,
    requestId: values.requestId,
    policyDigest: values.policyDigest,
    expiresAt: values.expiresAt,
  });
  const permitPayloadSha256 = snapshot.permitPayloadSha256;
  const requestId = snapshot.requestId;
  const policyDigest = snapshot.policyDigest;
  const expiresAt = snapshot.expiresAt;
  if (
    typeof permitPayloadSha256 !== "string" ||
    !SHA256.test(permitPayloadSha256) ||
    typeof requestId !== "string" ||
    !REQUEST_ID.test(requestId) ||
    typeof policyDigest !== "string" ||
    !SHA256.test(policyDigest) ||
    typeof expiresAt !== "string" ||
    !canonicalUtc(expiresAt) ||
    !Number.isSafeInteger(now) ||
    Date.parse(expiresAt) <= now
  ) {
    fail("LEASE_INPUT_REJECTED");
  }
  return Object.freeze({
    permitPayloadSha256,
    requestId,
    policyDigest,
    expiresAt,
  });
}

function randomSuffix(dependencies: StoreDependencies): string {
  const bytes = Buffer.from(dependencies.randomBytes(16));
  if (bytes.byteLength !== 16) fail("LEASE_PERSISTENCE_UNCONFIRMED");
  return bytes.toString("hex");
}

class PermitLeaseStore implements LocalOfflinePreviewPermitLeaseStore {
  readonly #dependencies: StoreDependencies;

  constructor(dependencies: StoreDependencies) {
    this.#dependencies = dependencies;
  }

  async reserve(
    input: unknown,
  ): Promise<LocalOfflinePreviewPermitLease> {
    const now = this.#dependencies.now();
    const snapshot = snapshotInput(input, now);
    await ensureTrustedDirectory(this.#dependencies.rootDirectory);

    const digestHex = snapshot.permitPayloadSha256.slice("sha256:".length);
    const destination = join(
      this.#dependencies.rootDirectory,
      `${digestHex}.lease.json`,
    );
    const temporary = join(
      this.#dependencies.rootDirectory,
      `.${digestHex}.${String(process.pid)}.${randomSuffix(this.#dependencies)}.tmp`,
    );
    const record: LocalOfflinePreviewPermitLeaseRecord = Object.freeze({
      schemaVersion: LOCAL_OFFLINE_PREVIEW_PERMIT_LEASE_SCHEMA_V1,
      permitPayloadSha256: snapshot.permitPayloadSha256,
      requestId: snapshot.requestId,
      policyDigest: snapshot.policyDigest,
      expiresAt: snapshot.expiresAt,
      consumedAt: new Date(now).toISOString(),
    });
    const bytes = canonicalRecordBytes(record);
    let temporaryCreated = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, destination);
      } catch (error: unknown) {
        if (systemErrorCode(error) === "EEXIST") {
          fail("PERMIT_ALREADY_CONSUMED");
        }
        throw error;
      }
      await syncDirectory(this.#dependencies.rootDirectory);
      const persisted = await readFile(destination);
      if (!persisted.equals(bytes)) fail("LEASE_PERSISTENCE_UNCONFIRMED");
      return Object.freeze({
        permitPayloadSha256: record.permitPayloadSha256,
        requestId: record.requestId,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
      });
    } catch (error: unknown) {
      if (error instanceof LocalOfflinePreviewPermitLeaseError) throw error;
      // If the atomic link succeeded, uncertainty must remain fail-closed: the
      // tombstone is deliberately left in place and the caller is blocked.
      throw new LocalOfflinePreviewPermitLeaseError(
        "LEASE_PERSISTENCE_UNCONFIRMED",
      );
    } finally {
      bytes.fill(0);
      if (temporaryCreated) {
        try {
          await unlink(temporary);
        } catch (error: unknown) {
          if (systemErrorCode(error) !== "ENOENT") {
            // A leftover private temp file is harmless and is ignored by audit.
          }
        }
      }
    }
  }

  async audit(): Promise<LocalOfflinePreviewPermitLeaseAudit> {
    await ensureTrustedDirectory(this.#dependencies.rootDirectory);
    let names: string[];
    try {
      names = await readdir(this.#dependencies.rootDirectory);
    } catch {
      fail("STORE_DIRECTORY_REJECTED");
    }
    const leaseNames = names.filter((name) => name.endsWith(".lease.json"));
    if (leaseNames.length > MAXIMUM_LEDGER_ENTRIES) {
      fail("LEDGER_CAPACITY_EXCEEDED");
    }
    const now = this.#dependencies.now();
    if (!Number.isSafeInteger(now)) fail("LEDGER_ENTRY_REJECTED");
    let expired = 0;
    for (const name of leaseNames) {
      const match = LEASE_FILE.exec(name);
      if (match === null) fail("LEDGER_ENTRY_REJECTED");
      let bytes: Buffer;
      try {
        const path = join(this.#dependencies.rootDirectory, name);
        const status = await lstat(path);
        if (!status.isFile() || status.isSymbolicLink()) {
          fail("LEDGER_ENTRY_REJECTED");
        }
        bytes = await readFile(path);
      } catch (error: unknown) {
        if (error instanceof LocalOfflinePreviewPermitLeaseError) throw error;
        fail("LEDGER_ENTRY_REJECTED");
      }
      const record = parseRecord(bytes);
      bytes.fill(0);
      if (
        record === null ||
        record.permitPayloadSha256 !== `sha256:${match[1] ?? ""}`
      ) {
        fail("LEDGER_ENTRY_REJECTED");
      }
      if (Date.parse(record.expiresAt) <= now) expired += 1;
    }
    return Object.freeze({
      totalPermanentTombstones: leaseNames.length,
      unexpiredTombstones: leaseNames.length - expired,
      expiredTombstonesRetained: expired,
    });
  }

  async close(): Promise<void> {
    await Promise.resolve();
  }
}

/**
 * Test-only file-ledger seam. Production uses the existing-only SQLite ledger;
 * this weaker cooperative-filesystem implementation grants no live authority.
 */
export function __testOnlyCreateLocalOfflinePreviewPermitLeaseStore(
  options: LocalOfflinePreviewPermitLeaseStoreTestOptions,
): LocalOfflinePreviewPermitLeaseStore {
  return new PermitLeaseStore({
    rootDirectory: options.rootDirectory,
    now: options.now ?? Date.now,
    randomBytes: options.randomBytes ?? randomBytes,
  });
}
