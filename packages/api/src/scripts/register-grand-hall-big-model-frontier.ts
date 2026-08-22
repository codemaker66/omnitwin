/**
 * Read-only intake validator for the exact Trades Hall Grand Hall SOG frontier.
 *
 * This legacy command remains a read-only database/schema validator. Apply is
 * deliberately confined to intake-grand-hall-big-model-frontier.ts, whose
 * authenticated server capability binds one explicitly selected deployment's
 * database and private runtime bucket. This command therefore continues to
 * reject --apply before opening the database and contains no upload client.
 *
 * Run from packages/api:
 *   node --env-file=.env --import tsx src/scripts/register-grand-hall-big-model-frontier.ts \
 *     --manifest "C:\\GRAND_HALL_BIG_MODEL_VARIATIONS\\scans_BIG_MODEL_TH_GH_1\\lcc2-result\\Grand_Hall.lcc2"
 *
 * The report verifies the local frontier, proposed private object identities,
 * current database conflicts, and immutable revision schema. It is evidence
 * for the dedicated server-side intake, not authority to register anything.
 */
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectLcc2HighestDetailFrontier,
  type Lcc2HighestDetailFrontierReceiptV0,
} from "@omnitwin/reconstruction-foundry-cli";
import {
  type RegisterAssetVersionInput,
  type RegisterRuntimePackageInput,
} from "@omnitwin/types";
import { inArray, sql } from "drizzle-orm";
import { createDb, type Database } from "../db/client.js";
import { assetVersions } from "../db/schema.js";
import {
  GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_LOD_SELECTION_POLICY,
  GRAND_HALL_MANIFEST_FILE_NAME,
  GRAND_HALL_MANIFEST_SHA256,
  GRAND_HALL_PRIVATE_STORAGE_ROOT,
  buildGrandHallAssetRegistrationInputs,
  buildGrandHallRuntimePackagePayload,
  grandHallAssetIdentityErrors,
  type GrandHallAssetRecord,
} from "../lib/grand-hall-frontier-contract.js";
import {
  evaluateRuntimePackageRevisionContract,
  runtimePackageRevisionDatabaseBlocker,
  type ReceptionRuntimePackageRevisionContractEvidence,
} from "./register-reception-room-quality-frontier.js";

export {
  GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  GRAND_HALL_FRONTIER_GAUSSIAN_COUNT,
  GRAND_HALL_FRONTIER_MEMBERS,
  GRAND_HALL_FRONTIER_RECEIPT_SHA256,
  GRAND_HALL_FRONTIER_TOTAL_BYTES,
  GRAND_HALL_LOD_SELECTION_POLICY,
  GRAND_HALL_MANIFEST_SHA256,
  GRAND_HALL_PRIVATE_STORAGE_ROOT,
  buildGrandHallAssetRegistrationInputs,
  buildGrandHallRuntimePackagePayload,
};
export type { GrandHallAssetRecord };

export const GRAND_HALL_APPLY_BLOCKER_CODE =
  "GRAND_HALL_SERVER_BOUND_INTAKE_REQUIRED";
export const GRAND_HALL_APPLY_BLOCKER =
  "Use the dedicated server-bound Grand Hall intake command for apply. This read-only validator never receives write authority, database credentials for mutation, or private-bucket credentials.";

export interface GrandHallRegistrationArgs {
  readonly manifestPath: string;
  readonly objectPrefix: string;
}

export interface GrandHallRegistrationReadStore {
  readonly readAssetVersionsByStorageKeys: (
    r2Keys: readonly string[],
  ) => Promise<readonly GrandHallAssetRecord[]>;
  readonly readRuntimePackageRevisionContract: () =>
    Promise<ReceptionRuntimePackageRevisionContractEvidence>;
  readonly hasAssetStorageKeyUniqueConstraint: () => Promise<boolean>;
}

export interface GrandHallValidation {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly detail: string;
}

export interface GrandHallRegistrationReport {
  readonly schemaVersion: "venviewer.grand-hall-big-model-intake.v1";
  readonly requestedMode: "dry_run";
  readonly preflightStatus: "validated_dry_run" | "validation_failed";
  readonly manifestPath: string;
  readonly sourceRoot: string;
  readonly objectPrefix: string;
  readonly frontierReceipt: Lcc2HighestDetailFrontierReceiptV0;
  readonly assetRegistrationInputs: readonly RegisterAssetVersionInput[];
  readonly databaseAssets: readonly GrandHallAssetRecord[];
  readonly proposedRuntimePackage: RegisterRuntimePackageInput | null;
  readonly validations: readonly GrandHallValidation[];
  readonly registration: {
    readonly status: "blocked";
    readonly code: typeof GRAND_HALL_APPLY_BLOCKER_CODE;
    readonly detail: typeof GRAND_HALL_APPLY_BLOCKER;
  };
}

interface PrepareGrandHallRegistrationOptions {
  readonly args: GrandHallRegistrationArgs;
  readonly store: GrandHallRegistrationReadStore;
  readonly inspectFrontier?: (
    manifestPath: string,
  ) => Promise<Lcc2HighestDetailFrontierReceiptV0>;
}

interface RunGrandHallRegistrationOptions {
  readonly args: readonly string[];
  readonly store: GrandHallRegistrationReadStore;
  readonly inspectFrontier?: (
    manifestPath: string,
  ) => Promise<Lcc2HighestDetailFrontierReceiptV0>;
  readonly log?: (line: string) => void;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validation(
  name: string,
  errors: readonly string[],
  successDetail: string,
): GrandHallValidation {
  return errors.length === 0
    ? { name, status: "passed", detail: successDetail }
    : { name, status: "failed", detail: errors.join("; ") };
}

function addMismatch(
  errors: string[],
  label: string,
  expected: string | number,
  actual: string | number,
): void {
  if (actual !== expected) {
    errors.push(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function receiptSha256(hex: string): string {
  return `sha256:${hex}`;
}

export function validateGrandHallFrontierReceipt(
  receipt: Lcc2HighestDetailFrontierReceiptV0,
): GrandHallValidation {
  const errors: string[] = [];
  addMismatch(errors, "receiptSha256", GRAND_HALL_FRONTIER_RECEIPT_SHA256, receipt.receiptSha256);
  addMismatch(errors, "manifest fileName", GRAND_HALL_MANIFEST_FILE_NAME, receipt.sourceManifest.fileName);
  addMismatch(errors, "manifest sizeBytes", 124_070, receipt.sourceManifest.sizeBytes);
  addMismatch(errors, "manifest sha256", receiptSha256(GRAND_HALL_MANIFEST_SHA256), receipt.sourceManifest.sha256);
  addMismatch(errors, "LCC2 version", "0.0.3", receipt.source.lcc2Version);
  addMismatch(errors, "source guid", "2d483e031ad40e259c75f765d6f5fcbb", receipt.source.guid);
  addMismatch(errors, "source fileType", "quality", receipt.source.fileType);
  addMismatch(errors, "source splatType", ".sog", receipt.source.splatType);
  addMismatch(errors, "source totalLevels", 5, receipt.source.totalLevels);
  addMismatch(errors, "source total alternatives", 11_487_038, receipt.source.totalSplatsAcrossAlternatives);
  if (!arraysEqual(receipt.source.lodSplatsHighestToLowest, [
    6_019_684,
    2_945_194,
    1_451_051,
    715_516,
    355_593,
  ])) {
    errors.push("source LOD totals do not match the supplied hierarchy");
  }
  addMismatch(errors, "selection policy", "authoritative_leaf_nodes_v1", receipt.selection.policy);
  addMismatch(errors, "selection depth", 5, receipt.selection.depth);
  addMismatch(errors, "selection nodeCount", 37, receipt.selection.nodeCount);
  addMismatch(errors, "selection gaussianCount", GRAND_HALL_FRONTIER_GAUSSIAN_COUNT, receipt.selection.gaussianCount);
  addMismatch(errors, "selection sizeBytes", GRAND_HALL_FRONTIER_TOTAL_BYTES, receipt.selection.sizeBytes);

  if (receipt.selection.members.length !== GRAND_HALL_FRONTIER_MEMBERS.length) {
    errors.push(
      `selection member count: expected ${String(GRAND_HALL_FRONTIER_MEMBERS.length)}, received ${String(receipt.selection.members.length)}`,
    );
  }
  GRAND_HALL_FRONTIER_MEMBERS.forEach((expected, index) => {
    const actual = receipt.selection.members[index];
    if (actual === undefined) return;
    const label = `selected member ${String(index)}`;
    addMismatch(errors, `${label} fileIndex`, expected.fileIndex, actual.fileIndex);
    addMismatch(errors, `${label} relativePath`, expected.relativePath, actual.relativePath);
    addMismatch(errors, `${label} depth`, expected.depth, actual.depth);
    addMismatch(errors, `${label} nodeCount`, expected.nodeCount, actual.nodeCount);
    addMismatch(errors, `${label} gaussianCount`, expected.gaussianCount, actual.gaussianCount);
    addMismatch(errors, `${label} sizeBytes`, expected.sizeBytes, actual.sizeBytes);
    addMismatch(errors, `${label} sha256`, receiptSha256(expected.sha256), actual.sha256);
  });

  const expectedPaths = GRAND_HALL_FRONTIER_MEMBERS.map((member) => member.relativePath);
  if (!arraysEqual(receipt.runtime.memberPaths, expectedPaths)) {
    errors.push("runtime member paths are not the exact ordered eleven-member frontier");
  }
  addMismatch(errors, "runtime gaussianCount", GRAND_HALL_FRONTIER_GAUSSIAN_COUNT, receipt.runtime.gaussianCount);
  addMismatch(errors, "runtime sizeBytes", GRAND_HALL_FRONTIER_TOTAL_BYTES, receipt.runtime.sizeBytes);
  addMismatch(errors, "ancestor alternative count", 12, receipt.ancestorAlternatives.length);
  addMismatch(errors, "environment policy", "exclude", receipt.environment.policy);
  if (receipt.environment.runtimeLoaded) errors.push("env.sog must not be runtime-loaded");
  addMismatch(errors, "environment path", "data/3dgs/env.sog", receipt.environment.relativePath);
  const ancestorPaths = new Set(receipt.ancestorAlternatives.map((member) => member.relativePath));
  if (receipt.runtime.memberPaths.some((path) => ancestorPaths.has(path))) {
    errors.push("an ancestor alternative appears in the runtime member paths");
  }
  if (receipt.runtime.memberPaths.includes(receipt.environment.relativePath)) {
    errors.push("env.sog appears in the runtime member paths");
  }

  return validation(
    "authoritative Grand Hall LCC2 frontier",
    errors,
    `Receipt ${GRAND_HALL_FRONTIER_RECEIPT_SHA256} proves the exact eleven SOG leaves; env.sog and twelve ancestor alternatives are excluded.`,
  );
}

function normalizedObjectPrefix(value: string): string {
  const prefix = value.trim();
  if (!prefix.endsWith("/")) throw new Error("--object-prefix must end with '/'.");
  if (
    !prefix.startsWith(GRAND_HALL_PRIVATE_STORAGE_ROOT) ||
    prefix.includes("\\") ||
    prefix.includes("?") ||
    prefix.includes("#") ||
    prefix.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `--object-prefix must be a safe private key prefix under ${GRAND_HALL_PRIVATE_STORAGE_ROOT}`,
    );
  }
  return prefix;
}

function optionValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseGrandHallRegistrationArgs(
  args: readonly string[],
): GrandHallRegistrationArgs {
  let manifestPath: string | undefined;
  let sourceRoot: string | undefined;
  let objectPrefix = GRAND_HALL_DEFAULT_OBJECT_PREFIX;
  let objectPrefixSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      throw new Error(`${GRAND_HALL_APPLY_BLOCKER_CODE}: ${GRAND_HALL_APPLY_BLOCKER}`);
    }
    if (argument === "--capture-session-id" || argument?.startsWith("--capture-session-id=") === true) {
      throw new Error(
        "--capture-session-id is not accepted. Grand Hall asset proposals keep captureSessionId null until an exact venue/room/source/device session is validated at the server boundary.",
      );
    }
    if (argument === "--manifest" || argument === "--root") {
      const value = optionValue(args, index, argument);
      if (argument === "--manifest") {
        if (manifestPath !== undefined) throw new Error("--manifest may only be supplied once.");
        manifestPath = value;
      } else {
        if (sourceRoot !== undefined) throw new Error("--root may only be supplied once.");
        sourceRoot = value;
      }
      index += 1;
      continue;
    }
    if (argument === "--object-prefix") {
      if (objectPrefixSeen) throw new Error("--object-prefix may only be supplied once.");
      objectPrefix = optionValue(args, index, argument);
      objectPrefixSeen = true;
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown argument: ${argument ?? "<missing>"}. Use --manifest <absolute-path> or --root <absolute-directory>, plus optional --object-prefix.`,
    );
  }

  if ((manifestPath === undefined) === (sourceRoot === undefined)) {
    throw new Error("Supply exactly one of --manifest or --root.");
  }
  const suppliedPath = manifestPath ?? sourceRoot;
  if (suppliedPath === undefined || !isAbsolute(suppliedPath)) {
    throw new Error("--manifest and --root require an absolute local path.");
  }
  const resolvedManifest = resolve(
    manifestPath === undefined ? join(suppliedPath, GRAND_HALL_MANIFEST_FILE_NAME) : suppliedPath,
  );
  if (basename(resolvedManifest) !== GRAND_HALL_MANIFEST_FILE_NAME) {
    throw new Error(`--manifest must point to ${GRAND_HALL_MANIFEST_FILE_NAME}.`);
  }
  return {
    manifestPath: resolvedManifest,
    objectPrefix: normalizedObjectPrefix(objectPrefix),
  };
}

function databaseValidations(
  rows: readonly GrandHallAssetRecord[],
  inputs: readonly RegisterAssetVersionInput[],
): readonly GrandHallValidation[] {
  const rowsByKey = new Map<string, GrandHallAssetRecord[]>();
  for (const row of rows) {
    if (row.r2Key === null) continue;
    const matches = rowsByKey.get(row.r2Key) ?? [];
    matches.push(row);
    rowsByKey.set(row.r2Key, matches);
  }
  return inputs.map((input) => {
    const key = input.r2Key;
    if (key === null || key === undefined) {
      return validation(`database asset ${input.fileName}`, ["private r2Key is missing"], "");
    }
    const matches = rowsByKey.get(key) ?? [];
    if (matches.length === 0) {
      return validation(
        `database asset ${input.fileName}`,
        [],
        "No row exists. This validator will not create one while server-bound intake is unavailable.",
      );
    }
    if (matches.length !== 1 || matches[0] === undefined) {
      return validation(
        `database asset ${input.fileName}`,
        [`expected at most one row for ${key}, received ${String(matches.length)}`],
        "",
      );
    }
    return validation(
      `database asset ${input.fileName}`,
      grandHallAssetIdentityErrors(matches[0], input),
      `Existing AssetVersion ${matches[0].id} is an exact reusable byte registration with no capture-session claim.`,
    );
  });
}

function orderedRegisteredAssets(
  rows: readonly GrandHallAssetRecord[],
  inputs: readonly RegisterAssetVersionInput[],
): readonly GrandHallAssetRecord[] {
  const byKey = new Map(rows.map((row) => [row.r2Key, row]));
  return inputs
    .map((input) => byKey.get(input.r2Key ?? null))
    .filter((row): row is GrandHallAssetRecord => row !== undefined);
}

export async function prepareGrandHallRegistration(
  options: PrepareGrandHallRegistrationOptions,
): Promise<GrandHallRegistrationReport> {
  const inspect = options.inspectFrontier ?? ((manifestPath: string) =>
    inspectLcc2HighestDetailFrontier({ manifestPath, environmentPolicy: "exclude" }));
  const inputs = buildGrandHallAssetRegistrationInputs(options.args);
  const keys = inputs.map((input) => input.r2Key)
    .filter((key): key is string => key !== null && key !== undefined);
  const [receipt, rows, revisionEvidence, assetKeyUnique] = await Promise.all([
    inspect(options.args.manifestPath),
    options.store.readAssetVersionsByStorageKeys(keys),
    options.store.readRuntimePackageRevisionContract(),
    options.store.hasAssetStorageKeyUniqueConstraint(),
  ]);
  const revisionReadiness = evaluateRuntimePackageRevisionContract(revisionEvidence);
  const validations = [
    validateGrandHallFrontierReceipt(receipt),
    validation(
      "private object namespace",
      keys.length === GRAND_HALL_FRONTIER_MEMBERS.length &&
        keys.every((key) => key.startsWith(GRAND_HALL_PRIVATE_STORAGE_ROOT))
        ? []
        : ["all eleven proposed object keys must be private Grand Hall keys"],
      `All proposed keys are confined beneath ${GRAND_HALL_PRIVATE_STORAGE_ROOT}`,
    ),
    ...databaseValidations(rows, inputs),
    validation(
      "asset storage-key identity constraint",
      assetKeyUnique ? [] : ["asset_versions_r2_key_unique is missing"],
      "asset_versions.r2_key is uniquely constrained.",
    ),
    validation(
      "immutable runtime-package revision contract",
      revisionReadiness.ready
        ? []
        : [runtimePackageRevisionDatabaseBlocker(revisionReadiness) ?? "runtime revision contract is incomplete"],
      "Runtime packages have content identity, monotonic revisions, and no-update/no-delete/no-truncate guards.",
    ),
  ] satisfies readonly GrandHallValidation[];
  const failed = validations.some((item) => item.status === "failed");
  const orderedAssets = orderedRegisteredAssets(rows, inputs);
  const proposedRuntimePackage = !failed && orderedAssets.length === GRAND_HALL_FRONTIER_MEMBERS.length
    ? buildGrandHallRuntimePackagePayload(orderedAssets)
    : null;
  return {
    schemaVersion: "venviewer.grand-hall-big-model-intake.v1",
    requestedMode: "dry_run",
    preflightStatus: failed ? "validation_failed" : "validated_dry_run",
    manifestPath: options.args.manifestPath,
    sourceRoot: dirname(options.args.manifestPath),
    objectPrefix: options.args.objectPrefix,
    frontierReceipt: receipt,
    assetRegistrationInputs: inputs,
    databaseAssets: orderedAssets,
    proposedRuntimePackage,
    validations,
    registration: {
      status: "blocked",
      code: GRAND_HALL_APPLY_BLOCKER_CODE,
      detail: GRAND_HALL_APPLY_BLOCKER,
    },
  };
}

export async function runGrandHallRegistration(
  options: RunGrandHallRegistrationOptions,
): Promise<GrandHallRegistrationReport> {
  // Parse first: --apply and removed capture-session flags fail before any DB
  // or filesystem callback can run.
  const args = parseGrandHallRegistrationArgs(options.args);
  const report = await prepareGrandHallRegistration({
    args,
    store: options.store,
    inspectFrontier: options.inspectFrontier,
  });
  const log = options.log ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });
  log(JSON.stringify(report, null, 2));
  if (report.preflightStatus === "validation_failed") {
    throw new Error("Grand Hall dry-run validation failed; registration remains disabled.");
  }
  return report;
}

export function createGrandHallRegistrationReadStore(
  db: Database,
): GrandHallRegistrationReadStore {
  return {
    readAssetVersionsByStorageKeys: async (r2Keys) => r2Keys.length === 0
      ? []
      : db
          .select({
            id: assetVersions.id,
            venueSlug: assetVersions.venueSlug,
            roomSlug: assetVersions.roomSlug,
            captureSessionId: assetVersions.captureSessionId,
            assetKind: assetVersions.assetKind,
            sourceType: assetVersions.sourceType,
            fileName: assetVersions.fileName,
            fileExt: assetVersions.fileExt,
            r2Key: assetVersions.r2Key,
            externalUrl: assetVersions.externalUrl,
            mimeType: assetVersions.mimeType,
            sha256: assetVersions.sha256,
            sizeBytes: assetVersions.sizeBytes,
            evidenceStatus: assetVersions.evidenceStatus,
            runtimeStatus: assetVersions.runtimeStatus,
          })
          .from(assetVersions)
          .where(inArray(assetVersions.r2Key, [...r2Keys])),
    readRuntimePackageRevisionContract: async () => db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      const result = await tx.execute(sql`
        SELECT 'column'::text AS kind, column_name::text AS name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runtime_packages'
          AND column_name IN ('revision', 'identity_kind', 'content_digest')
        UNION ALL
        SELECT 'constraint'::text AS kind, constraint_name::text AS name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'runtime_packages'
          AND constraint_name IN (
            'runtime_packages_revision_positive',
            'runtime_packages_identity_coherent',
            'runtime_packages_venue_room_revision_unique',
            'runtime_packages_venue_room_digest_unique'
          )
        UNION ALL
        SELECT 'trigger'::text AS kind, trigger_name::text AS name
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
          AND event_object_table = 'runtime_packages'
          AND trigger_name IN (
            'runtime_packages_revision_monotonic',
            'runtime_packages_no_update',
            'runtime_packages_no_delete',
            'runtime_packages_no_truncate'
          )
      `);
      const rows = result.rows as readonly Record<string, unknown>[];
      const names = (kind: string): readonly string[] => rows
        .filter((row) => row["kind"] === kind && typeof row["name"] === "string")
        .map((row) => row["name"] as string)
        .sort();
      return {
        columns: names("column"),
        constraints: names("constraint"),
        triggers: names("trigger"),
      };
    }),
    hasAssetStorageKeyUniqueConstraint: async () => {
      const result = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'asset_versions_r2_key_unique'
            AND conrelid = 'public.asset_versions'::regclass
        ) AS present
      `);
      return result.rows[0]?.["present"] === true;
    },
  };
}

function requiredDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env["DATABASE_URL"];
  if (value === undefined || value.trim() === "") {
    throw new Error("DATABASE_URL is required for the read-only registration preflight.");
  }
  return value;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  // Reject unsafe flags before constructing any database client.
  parseGrandHallRegistrationArgs(process.argv.slice(2));
  const db = createDb(requiredDatabaseUrl(process.env));
  runGrandHallRegistration({
    args: process.argv.slice(2),
    store: createGrandHallRegistrationReadStore(db),
  }).then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
