import { homedir } from "node:os";
import { join } from "node:path";
import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  openLocalOfflinePreviewSqlitePermitLedger,
  type LocalOfflinePreviewSqlitePermitLedger,
} from "./local-offline-normalization-preview-sqlite-permit-ledger.js";
import type {
  LocalOfflinePreviewPermitLeaseAudit,
  LocalOfflinePreviewPermitLeaseInput,
  LocalOfflinePreviewPermitLeaseStore,
} from "./local-offline-normalization-preview-permit-lease-store.js";

const PRODUCTION_LEDGER_EPOCH_DOMAIN =
  "OMNITWIN_OFFLINE_PREVIEW_PRODUCTION_PERMIT_LEDGER_EPOCH_V1";
const PRODUCTION_LEDGER_REPLAY_DOMAIN_V1 =
  "omnitwin.reconstruction-foundry.offline-preview-permit-replay-domain.v1";
const PRODUCTION_MAXIMUM_ENTRIES = 1_000_000;

/**
 * One stable local consumption domain across application releases and
 * permit-key rotations. This is at-most-once only while this local database
 * remains intact and unrolled-back; it is not a cross-machine authority.
 */
export const LOCAL_OFFLINE_PREVIEW_PRODUCTION_PERMIT_LEDGER_EPOCH_V1 =
  `sha256:${domainSeparatedSha256(
    PRODUCTION_LEDGER_EPOCH_DOMAIN,
    toCanonicalJson({
      replayDomain: PRODUCTION_LEDGER_REPLAY_DOMAIN_V1,
      scope: "one_intact_non_rolled_back_local_os_account_ledger",
      tombstoneIdentity: "sha256_of_canonical_signed_permit_payload",
      tombstoneRetention: "permanent",
    }),
  )}`;

function resolveProductionPermitLedgerDatabasePath(): string {
  return process.platform === "win32"
    ? join(
        homedir(),
        "AppData",
        "Local",
        "OmniTwin",
        "ReconstructionFoundry",
        "offline-preview-permit-ledger-v2.sqlite3",
      )
    : join(
        homedir(),
        ".local",
        "state",
        "omnitwin",
        "reconstruction-foundry",
        "offline-preview-permit-ledger-v2.sqlite3",
      );
}

// Resolve this once when the trusted application module loads. This prevents a
// later in-process environment change from silently redirecting the ledger.
// A same-user attacker who controls the process environment before startup or
// can replace local state remains outside this local-only guarantee.
const PRODUCTION_LEDGER_DATABASE_PATH =
  resolveProductionPermitLedgerDatabasePath();

export function localOfflinePreviewProductionPermitLedgerDatabasePath(): string {
  return PRODUCTION_LEDGER_DATABASE_PATH;
}

class ProductionPermitLeaseStore implements LocalOfflinePreviewPermitLeaseStore {
  readonly #ledger: LocalOfflinePreviewSqlitePermitLedger;

  constructor(ledger: LocalOfflinePreviewSqlitePermitLedger) {
    this.#ledger = ledger;
  }

  async reserve(input: LocalOfflinePreviewPermitLeaseInput) {
    await Promise.resolve();
    return this.#ledger.reserve(input);
  }

  async audit(): Promise<LocalOfflinePreviewPermitLeaseAudit> {
    await Promise.resolve();
    const audit = this.#ledger.audit();
    return Object.freeze({
      totalPermanentTombstones: audit.totalPermanentTombstones,
      unexpiredTombstones: audit.unexpiredTombstones,
      expiredTombstonesRetained: audit.expiredTombstonesRetained,
    });
  }

  async close(): Promise<void> {
    await Promise.resolve();
    this.#ledger.close();
  }
}

/**
 * Production-only, zero-input constructor. The database must already exist
 * with the exact schema and permanent replay epoch; runtime never creates or
 * migrates it. Any future storage-schema migration must copy every tombstone
 * and preserve this epoch before the new database can be accepted.
 */
export function createLocalOfflinePreviewProductionPermitLeaseStore(
): LocalOfflinePreviewPermitLeaseStore {
  return new ProductionPermitLeaseStore(
    openLocalOfflinePreviewSqlitePermitLedger({
      databasePath: localOfflinePreviewProductionPermitLedgerDatabasePath(),
      ledgerEpoch: LOCAL_OFFLINE_PREVIEW_PRODUCTION_PERMIT_LEDGER_EPOCH_V1,
      maximumEntries: PRODUCTION_MAXIMUM_ENTRIES,
    }),
  );
}
