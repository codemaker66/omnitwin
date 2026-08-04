/**
 * Prepare the audited Reception Room Mobile SPZ fine-frontier composition.
 *
 * The default mode is read-only. It verifies all seven pinned room database
 * rows, validates the authoritative LCC2 tree plus every declared SPZ
 * container, and requires the frozen Mobile frontier receipt. It then prints
 * the exact immutable runtime-package payload. `--apply` sends that payload only to the
 * authenticated create-only revision API. This script never uploads a file and
 * never inserts, updates, or deletes a database row directly.
 *
 * Run from packages/api:
 *   node --env-file=.env --import tsx src/scripts/register-reception-room-mobile-frontier.ts \
 *     --manifest "C:\\path\\to\\lcc2-result\\Reception Room Mobile.lcc2"
 *
 * Add `--apply` only after deployment review and explicit operator approval.
 */
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectLcc2HighestDetailFrontier,
  type Lcc2HighestDetailFrontierReceiptV0,
} from "@omnitwin/reconstruction-foundry-cli";
import {
  RegisterRuntimePackageInputSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackageRevisionReceiptSchema,
  type CreateRuntimePackageRevisionInput,
  type RegisterRuntimePackageInput,
  type RuntimePackageRevisionCreateResponse,
  type RuntimePackageRevisionReceipt,
} from "@omnitwin/types";
import { createDb, type Database } from "../db/client.js";
import { runtimeAssetStorageKeySha256 } from "../lib/runtime-asset-receipt.js";
import { computeRuntimePackageRevisionDigest } from "../services/runtime-package-revisions.js";
import {
  EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
  PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
  RUNTIME_PACKAGE_REVISION_ENDPOINT,
  createReceptionQualityFrontierApiClient,
  createReceptionQualityFrontierReadStore,
  evaluateRuntimePackageRevisionContract,
  runtimePackageRevisionDatabaseBlocker,
  type ReceptionFrontierAssetRecord,
  type ReceptionFrontierRuntimePackageRecord,
  type ReceptionFrontierValidation,
  type ReceptionQualityFrontierReadStore,
} from "./register-reception-room-quality-frontier.js";

const VENUE_SLUG = "trades-hall";
const ROOM_SLUG = "reception-room";

export const RECEPTION_MOBILE_FRONTIER_GENERATED_AT = "2026-07-14T07:36:21.000Z";
export const RECEPTION_MOBILE_FRONTIER_DECISION_ID =
  "reception-room-mobile-fixed-fine-frontier-v1";
export const RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256 =
  "a5f0ffeda6ae8d20784774aadf0a69205271d1c4a8210c8cacc5487b231b5cc2";
export const RECEPTION_MOBILE_FRONTIER_RECEIPT_SHA256 =
  "sha256:c897dd55fd8efc5397a76d96572a654058defd232f10767b1827fe684e7b6357";

export interface ReceptionMobileFrontierAssetSpec {
  readonly id: string;
  readonly fileName: string;
  readonly r2Key: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly gaussianCount: number;
}

export const RECEPTION_MOBILE_FRONTIER_ASSETS = [
  {
    id: "daa01028-999a-4566-a306-9f43242efe1f",
    fileName: "0_13_0_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_13_0_0.spz",
    sha256: "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
    sizeBytes: 8_620_036,
    gaussianCount: 565_974,
  },
  {
    id: "1a1a9be2-d397-4c11-b9b5-d83b3b6b38eb",
    fileName: "0_3_0_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_3_0_0.spz",
    sha256: "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3",
    sizeBytes: 9_199_830,
    gaussianCount: 604_926,
  },
  {
    id: "dfe479b9-e6c7-4749-827d-a8acbc52c764",
    fileName: "0_7_0_1.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_7_0_1.spz",
    sha256: "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df",
    sizeBytes: 8_768_751,
    gaussianCount: 582_881,
  },
  {
    id: "1c895eb8-ad58-4bad-afe3-c9a1ff569170",
    fileName: "0_8_0_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_8_0_0.spz",
    sha256: "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed",
    sizeBytes: 3_422_064,
    gaussianCount: 224_477,
  },
] as const satisfies readonly ReceptionMobileFrontierAssetSpec[];

export const RECEPTION_MOBILE_ANCESTOR_ASSETS = [
  {
    id: "28119878-4de1-4f54-8d2e-bb52dc9963e3",
    fileName: "0_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_0.spz",
    sha256: "d605163555ba8a7a2b27319294ad93c219601399bcb206d634b48c1283235a7e",
    sizeBytes: 7_652_108,
    gaussianCount: 491_784,
  },
  {
    id: "7cbfef9d-2807-478f-81e8-dbfb3f5bf69d",
    fileName: "0_2_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_2_0.spz",
    sha256: "d9536be11f0bf94197d2dd7ee2bc70dbf2054ada95addd29a29fe8f69087ea1b",
    sizeBytes: 8_397_200,
    gaussianCount: 544_867,
  },
  {
    id: "591ba12b-d043-4a75-97ba-0fa2d7ec3067",
    fileName: "0_3_0.spz",
    r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-15/lcc2-result-spz/data/3dgs/0_3_0.spz",
    sha256: "58e4bbf0e1a5d27efd3b5b1e83930f7d1b1dc24053e6ba444550a84905412a27",
    sizeBytes: 6_778_655,
    gaussianCount: 440_823,
  },
] as const satisfies readonly ReceptionMobileFrontierAssetSpec[];

export const RECEPTION_MOBILE_REGISTERED_ASSETS = [
  ...RECEPTION_MOBILE_ANCESTOR_ASSETS,
  ...RECEPTION_MOBILE_FRONTIER_ASSETS,
] as const satisfies readonly ReceptionMobileFrontierAssetSpec[];

export interface ReceptionMobileFrontierReport {
  readonly schemaVersion: "venviewer.reception-mobile-frontier-preflight.v1";
  readonly generatedAt: typeof RECEPTION_MOBILE_FRONTIER_GENERATED_AT;
  readonly requestedMode: "dry_run" | "apply";
  readonly preflightStatus: "validated_payload" | "validation_failed";
  readonly payload: RegisterRuntimePackageInput;
  readonly expectedContentDigest: string;
  readonly manifestPath: string;
  readonly frontierReceipt: Lcc2HighestDetailFrontierReceiptV0;
  readonly databaseAssets: readonly ReceptionFrontierAssetRecord[];
  readonly validations: readonly ReceptionFrontierValidation[];
  readonly existingMatchingCompositionId: string | null;
  readonly protectedPackageId: string;
  readonly apply: {
    readonly databaseReady: boolean;
    readonly databaseBlocker: string | null;
    readonly databaseContract: ReturnType<typeof evaluateRuntimePackageRevisionContract>;
    readonly endpointDeploymentVerified: boolean;
    readonly endpoint: typeof RUNTIME_PACKAGE_REVISION_ENDPOINT;
    readonly requested: boolean;
    readonly receipt: RuntimePackageRevisionReceipt | null;
  };
}

interface PrepareReceptionMobileFrontierOptions {
  readonly store: ReceptionQualityFrontierReadStore;
  readonly manifestPath: string;
  readonly applyRequested?: boolean;
  readonly inspectFrontier?: (
    manifestPath: string,
  ) => Promise<Lcc2HighestDetailFrontierReceiptV0>;
}

interface RunReceptionMobileFrontierOptions {
  readonly args: readonly string[];
  readonly store: ReceptionQualityFrontierReadStore;
  readonly inspectFrontier?: (
    manifestPath: string,
  ) => Promise<Lcc2HighestDetailFrontierReceiptV0>;
  readonly createRevision?: (
    input: CreateRuntimePackageRevisionInput,
  ) => Promise<RuntimePackageRevisionCreateResponse>;
  readonly log?: (line: string) => void;
}

export interface ReceptionMobileFrontierArgs {
  readonly applyRequested: boolean;
  readonly manifestPath: string;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mismatch(
  label: string,
  expected: string | number,
  actual: string | number | null,
): string | null {
  return actual === expected
    ? null
    : `${label}: expected ${String(expected)}, received ${String(actual)}`;
}

function validation(
  name: string,
  errors: readonly string[],
  successDetail: string,
): ReceptionFrontierValidation {
  return errors.length === 0
    ? { name, status: "passed", detail: successDetail }
    : { name, status: "failed", detail: errors.join("; ") };
}

export function buildReceptionMobileFrontierPayload(): RegisterRuntimePackageInput {
  const ids = RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset) => asset.id);
  const primaryVisualAssetVersionId = ids[0];
  if (primaryVisualAssetVersionId === undefined) {
    throw new Error("Reception Mobile fine-frontier specification has no primary asset.");
  }

  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: VENUE_SLUG,
    roomSlug: ROOM_SLUG,
    primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: VENUE_SLUG,
      roomSlug: ROOM_SLUG,
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId,
        visualAssetVersionIds: ids,
        visualAssetReceipts: RECEPTION_MOBILE_FRONTIER_ASSETS.map((asset) => ({
          assetVersionId: asset.id,
          fileName: asset.fileName,
          fileExt: ".spz" as const,
          sha256: asset.sha256,
          sizeBytes: asset.sizeBytes,
          storageKeySha256: runtimeAssetStorageKeySha256(asset.r2Key),
        })),
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
      },
      compositionBasis: {
        decisionId: RECEPTION_MOBILE_FRONTIER_DECISION_ID,
        decisionRef: "docs/reports/reception-room-hd-evidence.json#mobile-sh0-lcc2-spz-container",
        hierarchySha256: RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256,
        format: "spz",
        level: "fine",
        lodSelectionPolicy: "fixed_fine_frontier_v1",
        expectedGaussianCount: 1_978_258,
      },
      generatedAt: RECEPTION_MOBILE_FRONTIER_GENERATED_AT,
      notes: "Internal-only Reception Mobile LCC2 fine-frontier comparator using four audited SPZ leaf assets in declared order. Unverified: visual superiority, signed alignment, metric authority, exposure review, distribution rights, and public release remain separate gates.",
    },
    evidenceStatus: "unverified",
    runtimeStatus: "internal_ready",
  });
}

function receiptDigest(sha256: string): string {
  return `sha256:${sha256}`;
}

function validateFrontierReceipt(
  receipt: Lcc2HighestDetailFrontierReceiptV0,
): ReceptionFrontierValidation {
  const errors: string[] = [];
  const addMismatch = (
    label: string,
    expected: string | number,
    actual: string | number,
  ): void => {
    const error = mismatch(label, expected, actual);
    if (error !== null) errors.push(error);
  };

  addMismatch("receiptSha256", RECEPTION_MOBILE_FRONTIER_RECEIPT_SHA256, receipt.receiptSha256);
  addMismatch("manifest fileName", "Reception Room Mobile.lcc2", receipt.sourceManifest.fileName);
  addMismatch("manifest sizeBytes", 56_168, receipt.sourceManifest.sizeBytes);
  addMismatch(
    "manifest sha256",
    receiptDigest(RECEPTION_MOBILE_FRONTIER_HIERARCHY_SHA256),
    receipt.sourceManifest.sha256,
  );
  addMismatch("LCC2 version", "0.0.3", receipt.source.lcc2Version);
  addMismatch("source guid", "05eddf2f6217755d32a06d04cfac49f1", receipt.source.guid);
  addMismatch("source splatType", ".spz", receipt.source.splatType);
  addMismatch("source totalLevels", 3, receipt.source.totalLevels);
  addMismatch("selection policy", "authoritative_leaf_nodes_v1", receipt.selection.policy);
  addMismatch("selection depth", 3, receipt.selection.depth);
  addMismatch("selection nodeCount", 18, receipt.selection.nodeCount);
  addMismatch("selection gaussianCount", 1_978_258, receipt.selection.gaussianCount);
  addMismatch("selection sizeBytes", 30_010_681, receipt.selection.sizeBytes);

  if (receipt.selection.members.length !== RECEPTION_MOBILE_FRONTIER_ASSETS.length) {
    errors.push(
      `selection member count: expected ${String(RECEPTION_MOBILE_FRONTIER_ASSETS.length)}, received ${String(receipt.selection.members.length)}`,
    );
  }
  RECEPTION_MOBILE_FRONTIER_ASSETS.forEach((expected, index) => {
    const actual = receipt.selection.members[index];
    if (actual === undefined) return;
    const prefix = `selected member ${String(index)}`;
    addMismatch(`${prefix} relativePath`, `data/3dgs/${expected.fileName}`, actual.relativePath);
    addMismatch(`${prefix} depth`, 3, actual.depth);
    addMismatch(`${prefix} gaussianCount`, expected.gaussianCount, actual.gaussianCount);
    addMismatch(`${prefix} sizeBytes`, expected.sizeBytes, actual.sizeBytes);
    addMismatch(`${prefix} sha256`, receiptDigest(expected.sha256), actual.sha256);
  });

  if (receipt.ancestorAlternatives.length !== RECEPTION_MOBILE_ANCESTOR_ASSETS.length) {
    errors.push(
      `ancestor member count: expected ${String(RECEPTION_MOBILE_ANCESTOR_ASSETS.length)}, received ${String(receipt.ancestorAlternatives.length)}`,
    );
  }
  RECEPTION_MOBILE_ANCESTOR_ASSETS.forEach((expected, index) => {
    const actual = receipt.ancestorAlternatives[index];
    if (actual === undefined) return;
    const prefix = `ancestor member ${String(index)}`;
    addMismatch(`${prefix} relativePath`, `data/3dgs/${expected.fileName}`, actual.relativePath);
    addMismatch(`${prefix} gaussianCount`, expected.gaussianCount, actual.gaussianCount);
    addMismatch(`${prefix} sizeBytes`, expected.sizeBytes, actual.sizeBytes);
    addMismatch(`${prefix} sha256`, receiptDigest(expected.sha256), actual.sha256);
  });

  addMismatch("environment policy", "exclude", receipt.environment.policy);
  if (receipt.environment.runtimeLoaded) errors.push("environment must not be runtime-loaded");
  addMismatch("environment relativePath", "data/3dgs/env.spz", receipt.environment.relativePath);
  addMismatch("environment gaussianCount", 3_971, receipt.environment.gaussianCount);
  addMismatch("environment sizeBytes", 72_986, receipt.environment.sizeBytes);
  addMismatch(
    "environment sha256",
    "sha256:00ba83257962930fc002c1c9a16b1bf96185dc9f9244c27374facd061775f84b",
    receipt.environment.sha256,
  );
  const expectedPaths = RECEPTION_MOBILE_FRONTIER_ASSETS.map(
    (asset) => `data/3dgs/${asset.fileName}`,
  );
  if (!arraysEqual(receipt.runtime.memberPaths, expectedPaths)) {
    errors.push("runtime member paths do not match the authoritative ordered fine frontier");
  }
  addMismatch("runtime gaussianCount", 1_978_258, receipt.runtime.gaussianCount);
  addMismatch("runtime sizeBytes", 30_010_681, receipt.runtime.sizeBytes);
  const networkAccess: string = receipt.proof.networkAccess;
  const sourceWrites: string = receipt.proof.sourceWrites;
  if (networkAccess !== "none") errors.push("frontier worker used network access");
  if (sourceWrites !== "none") errors.push("frontier worker wrote source data");

  return validation(
    "authoritative LCC2 frontier receipt",
    errors,
    `Receipt ${RECEPTION_MOBILE_FRONTIER_RECEIPT_SHA256} proves the exact four-leaf Mobile frontier and excludes the environment.`,
  );
}

function validateDatabaseAssets(
  rows: readonly ReceptionFrontierAssetRecord[],
): readonly ReceptionFrontierValidation[] {
  const rowsById = new Map<string, ReceptionFrontierAssetRecord[]>();
  for (const row of rows) {
    const matches = rowsById.get(row.id) ?? [];
    matches.push(row);
    rowsById.set(row.id, matches);
  }

  return RECEPTION_MOBILE_REGISTERED_ASSETS.map((expected) => {
    const matches = rowsById.get(expected.id) ?? [];
    if (matches.length !== 1) {
      return validation(
        `database asset ${expected.fileName}`,
        [`expected exactly one row for ${expected.id}, received ${String(matches.length)}`],
        "",
      );
    }
    const actual = matches[0];
    if (actual === undefined) {
      return validation(`database asset ${expected.fileName}`, ["asset row is missing"], "");
    }
    const errors = [
      mismatch("venueSlug", VENUE_SLUG, actual.venueSlug),
      mismatch("roomSlug", ROOM_SLUG, actual.roomSlug),
      mismatch(
        "captureSessionId",
        EXPECTED_RECEPTION_CAPTURE_SESSION_ID,
        actual.captureSessionId,
      ),
      mismatch("assetKind", "splat", actual.assetKind),
      mismatch("sourceType", "xgrids", actual.sourceType),
      mismatch("fileName", expected.fileName, actual.fileName),
      mismatch("fileExt", ".spz", actual.fileExt),
      mismatch("r2Key", expected.r2Key, actual.r2Key),
      mismatch("sha256", expected.sha256, actual.sha256),
      mismatch("sizeBytes", expected.sizeBytes, actual.sizeBytes),
      mismatch("runtimeStatus", "usable", actual.runtimeStatus),
      actual.evidenceStatus === "rejected" ? "evidenceStatus must not be rejected" : null,
    ].filter((value): value is string => value !== null);
    return validation(
      `database asset ${expected.fileName}`,
      errors,
      `${actual.id} is the exact usable Reception Mobile SPZ row from capture ${EXPECTED_RECEPTION_CAPTURE_SESSION_ID}`,
    );
  });
}

function orderedDatabaseAssets(
  rows: readonly ReceptionFrontierAssetRecord[],
): readonly ReceptionFrontierAssetRecord[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return RECEPTION_MOBILE_REGISTERED_ASSETS
    .map((asset) => rowsById.get(asset.id))
    .filter((row): row is ReceptionFrontierAssetRecord => row !== undefined);
}

function hasMatchingComposition(
  existing: ReceptionFrontierRuntimePackageRecord,
  payload: RegisterRuntimePackageInput,
): boolean {
  if (
    existing.venueSlug !== payload.venueSlug ||
    existing.roomSlug !== payload.roomSlug ||
    existing.primaryVisualAssetVersionId !== (payload.primaryVisualAssetVersionId ?? null) ||
    existing.semanticMeshAssetVersionId !== (payload.semanticMeshAssetVersionId ?? null) ||
    existing.collisionAssetVersionId !== (payload.collisionAssetVersionId ?? null) ||
    existing.pointCloudAssetVersionId !== (payload.pointCloudAssetVersionId ?? null)
  ) {
    return false;
  }
  const parsedManifest = RuntimePackageManifestJsonSchema.safeParse(existing.manifestJson);
  if (!parsedManifest.success) return false;
  const existingIds = parsedManifest.data.assets.visualAssetVersionIds;
  const expectedIds = payload.manifestJson.assets.visualAssetVersionIds;
  return existingIds !== undefined &&
    expectedIds !== undefined &&
    arraysEqual(existingIds, expectedIds);
}

function preflightStatus(
  validations: readonly ReceptionFrontierValidation[],
): ReceptionMobileFrontierReport["preflightStatus"] {
  return validations.some((item) => item.status === "failed")
    ? "validation_failed"
    : "validated_payload";
}

export async function prepareReceptionMobileFrontier(
  options: PrepareReceptionMobileFrontierOptions,
): Promise<ReceptionMobileFrontierReport> {
  const manifestPath = resolve(options.manifestPath);
  const payload = buildReceptionMobileFrontierPayload();
  const ids = RECEPTION_MOBILE_REGISTERED_ASSETS.map((asset) => asset.id);
  const inspectFrontier = options.inspectFrontier ?? (async (path: string) =>
    inspectLcc2HighestDetailFrontier({
      manifestPath: path,
      environmentPolicy: "exclude",
    }));
  const [frontierReceipt, databaseRows, existingPackages, revisionContractEvidence] = await Promise.all([
    inspectFrontier(manifestPath),
    options.store.readAssetVersions(ids),
    options.store.readRuntimePackages(VENUE_SLUG, ROOM_SLUG),
    options.store.readRuntimePackageRevisionContract(),
  ]);
  const matchingComposition = existingPackages.find((existing) =>
    hasMatchingComposition(existing, payload)
  ) ?? null;
  const validations: readonly ReceptionFrontierValidation[] = [
    validation(
      "manifest payload",
      [],
      "Shared runtime-package schema accepts the exact internal_ready/unverified Mobile payload.",
    ),
    validateFrontierReceipt(frontierReceipt),
    ...validateDatabaseAssets(databaseRows),
    validation(
      "protected legacy package remains read-only",
      [],
      `Apply uses only the create-only revision API and cannot update ${PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID}.`,
    ),
    matchingComposition === null
      ? validation(
          "existing ordered composition",
          [],
          "No existing room package declares this exact ordered four-asset Mobile composition.",
        )
      : validation(
          "existing ordered composition",
          [],
          `Package ${matchingComposition.id} declares the same asset order. The create API will compare the full content digest and return the exact revision idempotently when appropriate.`,
        ),
  ];
  const databaseContract = evaluateRuntimePackageRevisionContract(revisionContractEvidence);

  return {
    schemaVersion: "venviewer.reception-mobile-frontier-preflight.v1",
    generatedAt: RECEPTION_MOBILE_FRONTIER_GENERATED_AT,
    requestedMode: options.applyRequested === true ? "apply" : "dry_run",
    preflightStatus: preflightStatus(validations),
    payload,
    expectedContentDigest: computeRuntimePackageRevisionDigest(payload),
    manifestPath,
    frontierReceipt,
    databaseAssets: orderedDatabaseAssets(databaseRows),
    validations,
    existingMatchingCompositionId: matchingComposition?.id ?? null,
    protectedPackageId: PROTECTED_RECEPTION_RUNTIME_PACKAGE_ID,
    apply: {
      databaseReady: databaseContract.ready,
      databaseBlocker: runtimePackageRevisionDatabaseBlocker(databaseContract),
      databaseContract,
      endpointDeploymentVerified: false,
      endpoint: RUNTIME_PACKAGE_REVISION_ENDPOINT,
      requested: options.applyRequested === true,
      receipt: null,
    },
  };
}

export function parseReceptionMobileFrontierArgs(
  args: readonly string[],
): ReceptionMobileFrontierArgs {
  let applyRequested = false;
  let manifestPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      if (applyRequested) throw new Error("--apply may only be supplied once.");
      applyRequested = true;
      continue;
    }
    if (argument === "--manifest") {
      if (manifestPath !== undefined) throw new Error("--manifest may only be supplied once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--manifest requires the absolute Reception Room Mobile.lcc2 path.");
      }
      manifestPath = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--manifest=") === true) {
      if (manifestPath !== undefined) throw new Error("--manifest may only be supplied once.");
      const value = argument.slice("--manifest=".length);
      if (value.trim() === "") {
        throw new Error("--manifest requires the absolute Reception Room Mobile.lcc2 path.");
      }
      manifestPath = value;
      continue;
    }
    throw new Error(
      `Unknown argument: ${argument ?? "<missing>"}. Use --manifest <absolute-path> and optional --apply.`,
    );
  }
  if (manifestPath === undefined) {
    throw new Error(
      "--manifest is required. Point it at the audited Reception Room Mobile.lcc2 file.",
    );
  }
  if (!isAbsolute(manifestPath)) {
    throw new Error("--manifest must be an absolute local path.");
  }
  return { applyRequested, manifestPath };
}

function returnedPackageInput(
  response: RuntimePackageRevisionCreateResponse,
): RegisterRuntimePackageInput {
  return RegisterRuntimePackageInputSchema.parse({
    venueSlug: response.data.venueSlug,
    roomSlug: response.data.roomSlug,
    primaryVisualAssetVersionId: response.data.primaryVisualAssetVersionId,
    semanticMeshAssetVersionId: response.data.semanticMeshAssetVersionId,
    collisionAssetVersionId: response.data.collisionAssetVersionId,
    pointCloudAssetVersionId: response.data.pointCloudAssetVersionId,
    manifestJson: response.data.manifestJson,
    evidenceStatus: response.data.evidenceStatus,
    runtimeStatus: response.data.runtimeStatus,
  });
}

export function validateReceptionMobileFrontierCreateResponse(
  response: RuntimePackageRevisionCreateResponse,
): RuntimePackageRevisionReceipt {
  const receipt = RuntimePackageRevisionReceiptSchema.parse(response.receipt);
  const expectedPayload = buildReceptionMobileFrontierPayload();
  const expectedDigest = computeRuntimePackageRevisionDigest(expectedPayload);
  const returnedDigest = computeRuntimePackageRevisionDigest(returnedPackageInput(response));
  if (receipt.packageId !== response.data.id) {
    throw new Error("Mobile frontier API response package ID does not match its receipt.");
  }
  if (receipt.contentDigest !== expectedDigest || returnedDigest !== expectedDigest) {
    throw new Error("Mobile frontier API response does not match the validated payload digest.");
  }
  const expectedIds = expectedPayload.manifestJson.assets.visualAssetVersionIds;
  const returnedIds = response.data.manifestJson.assets.visualAssetVersionIds;
  if (
    expectedIds === undefined ||
    returnedIds === undefined ||
    !arraysEqual(returnedIds, expectedIds)
  ) {
    throw new Error("Mobile frontier API response changed the ordered visual asset IDs.");
  }
  return receipt;
}

export async function runReceptionMobileFrontier(
  options: RunReceptionMobileFrontierOptions,
): Promise<ReceptionMobileFrontierReport> {
  const cli = parseReceptionMobileFrontierArgs(options.args);
  const log = options.log ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });
  let report = await prepareReceptionMobileFrontier({
    store: options.store,
    manifestPath: cli.manifestPath,
    applyRequested: cli.applyRequested,
    inspectFrontier: options.inspectFrontier,
  });
  if (report.preflightStatus === "validation_failed") {
    log(JSON.stringify(report, null, 2));
    throw new Error(
      "Reception Mobile fine-frontier preflight failed. No API request or write was attempted.",
    );
  }
  if (cli.applyRequested) {
    if (!report.apply.databaseReady) {
      throw new Error(
        `${report.apply.databaseBlocker ?? "Database migration 0052 is not ready."} No API request was sent.`,
      );
    }
    if (options.createRevision === undefined) {
      throw new Error(
        "--apply requires an authenticated immutable revision API client; no request was sent.",
      );
    }
    const response = await options.createRevision({ package: report.payload });
    report = {
      ...report,
      apply: {
        ...report.apply,
        endpointDeploymentVerified: true,
        receipt: validateReceptionMobileFrontierCreateResponse(response),
      },
    };
  }
  log(JSON.stringify(report, null, 2));
  return report;
}

export function createReceptionMobileFrontierReadStore(
  db: Database,
): ReceptionQualityFrontierReadStore {
  return createReceptionQualityFrontierReadStore(db);
}

export function createReceptionMobileFrontierApiClient(
  env: Readonly<Record<string, string | undefined>>,
  request: typeof fetch = fetch,
): (input: CreateRuntimePackageRevisionInput) => Promise<RuntimePackageRevisionCreateResponse> {
  return createReceptionQualityFrontierApiClient(env, request);
}

function requiredDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for the read-only Mobile asset preflight.");
  }
  return databaseUrl;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const cli = parseReceptionMobileFrontierArgs(process.argv.slice(2));
  const db = createDb(requiredDatabaseUrl(process.env));
  runReceptionMobileFrontier({
    args: process.argv.slice(2),
    store: createReceptionMobileFrontierReadStore(db),
    ...(cli.applyRequested
      ? { createRevision: createReceptionMobileFrontierApiClient(process.env) }
      : {}),
  }).then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
