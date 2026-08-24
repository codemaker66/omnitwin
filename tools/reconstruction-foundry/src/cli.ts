import { readFile } from "node:fs/promises";
import {
  S3CandidateObjectStore,
  admitUniversalIntakeReceipt,
  assembleFoundryRoomRealityPackage,
  compileFoundryAdapterCapabilityAssessmentV0,
  compileFoundryPlanOnlyDossier,
  composeFoundryMultiRootCaptureBundleV0,
  inspectUniversalIntake,
  inspectUniversalIntakeWithSourceFactsV6,
  prepareReconstructionRelease,
  stageUniversalIntakeDraft,
  uploadCandidateRelease,
  verifyTrainingCandidateBundle,
  verifyRemoteCandidateRelease,
  type CandidateObjectStore,
} from "@omnitwin/reconstruction-foundry";
import { assembleAttestation, prepareSigningRequest } from "./signing.js";
import {
  openLocalFoundryAppInBrowser,
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryAppOptions,
} from "./local-app.js";

export const FOUNDRY_CLI_USAGE = `Usage:
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source <file-or-folder> [--grand-hall-sog-manifest <relative-lcc2-path> --owner-authorized-venviewer-product-use [--candidate-consumer-origin <http://127.0.0.1:port>] [--grand-hall-twin-bundle <folder> [--grand-hall-public-reference-images <folder>] [--grand-hall-xgrids-raw <folder>] [--grand-hall-e57-stage <folder>] [--grand-hall-reference-video <file>] [--grand-hall-captured-reference-image <file>] [--grand-hall-generated-reference-image <file>]]] [--port <1024-65535>] [--open]
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- inspect-intake --source <file-or-folder>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- inspect-source-facts --source <file-or-folder>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- admit-intake-draft --receipt <receipt.json> --review <review.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- compose-capture-bundle --input <bundle-input.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- stage-intake-draft --source <file-or-folder> --receipt <receipt.json> --review <review.json> --out <folder>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- plan-job-draft --request <request.json> --manifest <manifest.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- assess-adapters --manifest <manifest.json> --host <host-capabilities.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- assemble-room-package --input <assembly-input.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- verify-training-candidate --bundle <extracted-folder> --venue-id <venue> --run-id <run>
  pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- prepare --bundle <twin-folder> --out <evidence-folder>
  pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- upload-candidate --prepared <evidence-folder>
  pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- verify-candidate --prefix <candidates/venue/digest>
  pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- prepare-signing-request --payload <signing-payload.json> --out <folder>
  pnpm --filter @omnitwin/reconstruction-foundry-cli foundry -- assemble-attestation --payload <signing-payload.json> --key-id <trusted-key-id> --signature-base64 <KMS-result> --out <envelope.json>

The upload and verify commands read FOUNDRY_R2_ACCOUNT_ID, FOUNDRY_R2_ACCESS_KEY_ID,
FOUNDRY_R2_SECRET_ACCESS_KEY, and FOUNDRY_R2_CANDIDATE_BUCKET. Optional variables are
R2_SESSION_TOKEN and FOUNDRY_R2_ENDPOINT.

Signing commands accept no private key and never perform signing.

For the simplest safe check, use local-app. It opens a private web address on this computer only. The app
reads the one source chosen at startup and cannot accept another path in the browser. It does not open a
browser unless --open is present. Click "Stop local session" or press Ctrl+C in the same terminal to stop it.

The intake commands are local and create no internet client. Inspection writes a deterministic "not approved
yet" receipt to stdout. Admission can compile only an all-path, digest-bound, non-authoritative draft manifest.
Staging rehashes the source, copies only admitted bytes into a new atomic local stage, and verifies its index.
Admission and staging authorize no job plan or execution. Planning emits only non-dispatchable JobSpecs.
Training-candidate verification is local, requires the exact extracted D-014 file set, and returns an
untrusted/blocked evidence dossier; legacy v0 carries no ingest, JobSpec, provider-plan, attempt-ledger,
quality-contract, or trusted-signature binding.
No intake command authorizes execution, model training, object-store mutation, signing, publication, or promotion.

This tool intentionally has no publish, promote, rollback, delete, or bucket-policy command.`;

export type FoundryCliCommand =
  | { readonly kind: "help" }
  | {
      readonly kind: "local-app";
      readonly source: string;
      readonly port: number;
      readonly open: boolean;
      readonly localSogCandidate?: {
        readonly manifestRelativePath: string;
        readonly ownerAuthorizedVenviewerProductUse: true;
        readonly allowedConsumerOrigin?: string;
      };
      readonly localRoomEvidence?: {
        readonly manifestRelativePath: string;
        readonly twinBundleRoot: string;
        readonly ownerAuthorizedVenviewerProductUse: true;
        readonly allowedConsumerOrigin?: string;
        readonly publicReferenceImageRoot?: string;
        readonly xgridsRawRoot?: string;
        readonly e57StageRoot?: string;
        readonly referenceVideoPath?: string;
        readonly capturedReferenceImagePath?: string;
        readonly generatedReferenceImagePath?: string;
      };
    }
  | { readonly kind: "inspect-intake"; readonly source: string }
  | { readonly kind: "inspect-source-facts"; readonly source: string }
  | {
      readonly kind: "admit-intake-draft";
      readonly receipt: string;
      readonly review: string;
    }
  | { readonly kind: "compose-capture-bundle"; readonly input: string }
  | {
      readonly kind: "stage-intake-draft";
      readonly source: string;
      readonly receipt: string;
      readonly review: string;
      readonly out: string;
    }
  | {
      readonly kind: "plan-job-draft";
      readonly request: string;
      readonly manifest: string;
    }
  | {
      readonly kind: "assess-adapters";
      readonly manifest: string;
      readonly host: string;
    }
  | { readonly kind: "assemble-room-package"; readonly input: string }
  | {
      readonly kind: "verify-training-candidate";
      readonly bundle: string;
      readonly venueId: string;
      readonly runId: string;
    }
  | { readonly kind: "prepare"; readonly bundle: string; readonly out: string }
  | { readonly kind: "upload-candidate"; readonly prepared: string }
  | { readonly kind: "verify-candidate"; readonly prefix: string }
  | {
      readonly kind: "prepare-signing-request";
      readonly payload: string;
      readonly out: string;
    }
  | {
      readonly kind: "assemble-attestation";
      readonly payload: string;
      readonly keyId: string;
      readonly signatureBase64: string;
      readonly out: string;
    };

function flagMap(args: readonly string[]): ReadonlyMap<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith("--") ||
      value.startsWith("--")
    ) {
      throw new Error(
        "Every CLI option must be a --flag followed by one value.",
      );
    }
    if (flags.has(flag)) throw new Error(`Duplicate CLI option: ${flag}.`);
    flags.set(flag, value);
  }
  return flags;
}

function exactFlags(
  flags: ReadonlyMap<string, string>,
  expected: readonly string[],
): void {
  const expectedSet = new Set(expected);
  for (const flag of flags.keys()) {
    if (!expectedSet.has(flag)) throw new Error(`Unknown CLI option: ${flag}.`);
  }
  for (const flag of expected) {
    if (!flags.has(flag))
      throw new Error(`Missing required CLI option: ${flag}.`);
  }
}

function requiredFlag(
  flags: ReadonlyMap<string, string>,
  flag: string,
): string {
  const value = flags.get(flag)?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required CLI option: ${flag}.`);
  return value;
}

function parseLocalAppArgs(args: readonly string[]): FoundryCliCommand {
  let source: string | undefined;
  let port = 0;
  let open = false;
  let manifestRelativePath: string | undefined;
  let allowedConsumerOrigin: string | undefined;
  let ownerAuthorizedVenviewerProductUse = false;
  let deprecatedLocalOnlyAttestation = false;
  let twinBundleRoot: string | undefined;
  let publicReferenceImageRoot: string | undefined;
  let xgridsRawRoot: string | undefined;
  let e57StageRoot: string | undefined;
  let referenceVideoPath: string | undefined;
  let capturedReferenceImagePath: string | undefined;
  let generatedReferenceImagePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--open") {
      if (open) throw new Error("Duplicate CLI option: --open.");
      open = true;
      continue;
    }
    if (flag === "--owner-authorized-venviewer-product-use") {
      if (ownerAuthorizedVenviewerProductUse) {
        throw new Error(
          "Duplicate CLI option: --owner-authorized-venviewer-product-use.",
        );
      }
      ownerAuthorizedVenviewerProductUse = true;
      continue;
    }
    if (flag === "--owner-authorized-local-product-use") {
      if (deprecatedLocalOnlyAttestation) {
        throw new Error(
          "Duplicate CLI option: --owner-authorized-local-product-use.",
        );
      }
      deprecatedLocalOnlyAttestation = true;
      continue;
    }
    if (
      flag !== "--source" &&
      flag !== "--port" &&
      flag !== "--grand-hall-sog-manifest" &&
      flag !== "--candidate-consumer-origin" &&
      flag !== "--grand-hall-twin-bundle" &&
      flag !== "--grand-hall-public-reference-images" &&
      flag !== "--grand-hall-xgrids-raw" &&
      flag !== "--grand-hall-e57-stage" &&
      flag !== "--grand-hall-reference-video" &&
      flag !== "--grand-hall-captured-reference-image" &&
      flag !== "--grand-hall-generated-reference-image"
    ) {
      throw new Error(`Unknown CLI option: ${flag ?? "missing option"}.`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing required value for CLI option: ${flag}.`);
    }
    index += 1;
    if (flag === "--source") {
      if (source !== undefined)
        throw new Error("Duplicate CLI option: --source.");
      source = value.trim();
      if (source.length === 0)
        throw new Error("Missing required CLI option: --source.");
    } else if (flag === "--port") {
      if (port !== 0) throw new Error("Duplicate CLI option: --port.");
      if (!/^\d+$/u.test(value))
        throw new Error(
          "--port must be a whole number between 1024 and 65535.",
        );
      port = Number(value);
      if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
        throw new Error(
          "--port must be a whole number between 1024 and 65535.",
        );
      }
    } else if (flag === "--grand-hall-sog-manifest") {
      if (manifestRelativePath !== undefined) {
        throw new Error("Duplicate CLI option: --grand-hall-sog-manifest.");
      }
      manifestRelativePath = value.trim();
      if (manifestRelativePath.length === 0) {
        throw new Error(
          "Missing required value for CLI option: --grand-hall-sog-manifest.",
        );
      }
    } else if (flag === "--candidate-consumer-origin") {
      if (allowedConsumerOrigin !== undefined) {
        throw new Error("Duplicate CLI option: --candidate-consumer-origin.");
      }
      allowedConsumerOrigin = value.trim();
      if (allowedConsumerOrigin.length === 0) {
        throw new Error(
          "Missing required value for CLI option: --candidate-consumer-origin.",
        );
      }
    } else {
      const mapping: Readonly<Record<string, string | undefined>> = {
        "--grand-hall-twin-bundle": twinBundleRoot,
        "--grand-hall-public-reference-images": publicReferenceImageRoot,
        "--grand-hall-xgrids-raw": xgridsRawRoot,
        "--grand-hall-e57-stage": e57StageRoot,
        "--grand-hall-reference-video": referenceVideoPath,
        "--grand-hall-captured-reference-image": capturedReferenceImagePath,
        "--grand-hall-generated-reference-image": generatedReferenceImagePath,
      };
      if (mapping[flag] !== undefined) {
        throw new Error(`Duplicate CLI option: ${flag}.`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`Missing required value for CLI option: ${flag}.`);
      }
      if (flag === "--grand-hall-twin-bundle") twinBundleRoot = trimmed;
      else if (flag === "--grand-hall-public-reference-images")
        publicReferenceImageRoot = trimmed;
      else if (flag === "--grand-hall-xgrids-raw") xgridsRawRoot = trimmed;
      else if (flag === "--grand-hall-e57-stage") e57StageRoot = trimmed;
      else if (flag === "--grand-hall-reference-video")
        referenceVideoPath = trimmed;
      else if (flag === "--grand-hall-captured-reference-image")
        capturedReferenceImagePath = trimmed;
      else generatedReferenceImagePath = trimmed;
    }
  }
  if (source === undefined)
    throw new Error("Missing required CLI option: --source.");
  if (deprecatedLocalOnlyAttestation && !ownerAuthorizedVenviewerProductUse) {
    throw new Error(
      "--owner-authorized-local-product-use is local-only and cannot mint this owner-authorized product candidate; use the explicit --owner-authorized-venviewer-product-use attestation.",
    );
  }
  if (
    manifestRelativePath !== undefined &&
    !ownerAuthorizedVenviewerProductUse
  ) {
    throw new Error(
      "--grand-hall-sog-manifest requires the explicit --owner-authorized-venviewer-product-use attestation.",
    );
  }
  if (
    manifestRelativePath === undefined &&
    ownerAuthorizedVenviewerProductUse
  ) {
    throw new Error(
      "--owner-authorized-venviewer-product-use requires --grand-hall-sog-manifest.",
    );
  }
  if (
    manifestRelativePath === undefined &&
    allowedConsumerOrigin !== undefined
  ) {
    throw new Error(
      "--candidate-consumer-origin requires --grand-hall-sog-manifest.",
    );
  }
  const roomEvidenceOptionSupplied = [
    publicReferenceImageRoot,
    xgridsRawRoot,
    e57StageRoot,
    referenceVideoPath,
    capturedReferenceImagePath,
    generatedReferenceImagePath,
  ].some((value) => value !== undefined);
  if (roomEvidenceOptionSupplied && twinBundleRoot === undefined) {
    throw new Error(
      "Grand Hall room-evidence source options require --grand-hall-twin-bundle.",
    );
  }
  if (twinBundleRoot !== undefined && manifestRelativePath === undefined) {
    throw new Error(
      "--grand-hall-twin-bundle requires --grand-hall-sog-manifest and the explicit owner authorization attestation.",
    );
  }
  return {
    kind: "local-app",
    source,
    port,
    open,
    ...(manifestRelativePath === undefined
      ? {}
      : {
          localSogCandidate: {
            manifestRelativePath,
            ownerAuthorizedVenviewerProductUse: true as const,
            ...(allowedConsumerOrigin === undefined
              ? {}
              : { allowedConsumerOrigin }),
          },
        }),
    ...(twinBundleRoot === undefined || manifestRelativePath === undefined
      ? {}
      : {
          localRoomEvidence: {
            manifestRelativePath,
            twinBundleRoot,
            ownerAuthorizedVenviewerProductUse: true as const,
            ...(allowedConsumerOrigin === undefined
              ? {}
              : { allowedConsumerOrigin }),
            ...(publicReferenceImageRoot === undefined
              ? {}
              : { publicReferenceImageRoot }),
            ...(xgridsRawRoot === undefined ? {} : { xgridsRawRoot }),
            ...(e57StageRoot === undefined ? {} : { e57StageRoot }),
            ...(referenceVideoPath === undefined ? {} : { referenceVideoPath }),
            ...(capturedReferenceImagePath === undefined
              ? {}
              : { capturedReferenceImagePath }),
            ...(generatedReferenceImagePath === undefined
              ? {}
              : { generatedReferenceImagePath }),
          },
        }),
  };
}

export function parseFoundryCliArgs(
  args: readonly string[],
): FoundryCliCommand {
  const [command, ...optionArgs] = args;
  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    if (optionArgs.length > 0)
      throw new Error("The help command does not accept options.");
    return { kind: "help" };
  }
  if (command === "local-app") return parseLocalAppArgs(optionArgs);
  const flags = flagMap(optionArgs);
  if (command === "inspect-intake" || command === "inspect-source-facts") {
    exactFlags(flags, ["--source"]);
    return { kind: command, source: requiredFlag(flags, "--source") };
  }
  if (command === "admit-intake-draft") {
    exactFlags(flags, ["--receipt", "--review"]);
    return {
      kind: command,
      receipt: requiredFlag(flags, "--receipt"),
      review: requiredFlag(flags, "--review"),
    };
  }
  if (
    command === "compose-capture-bundle" ||
    command === "assemble-room-package"
  ) {
    exactFlags(flags, ["--input"]);
    return { kind: command, input: requiredFlag(flags, "--input") };
  }
  if (command === "stage-intake-draft") {
    exactFlags(flags, ["--source", "--receipt", "--review", "--out"]);
    return {
      kind: command,
      source: requiredFlag(flags, "--source"),
      receipt: requiredFlag(flags, "--receipt"),
      review: requiredFlag(flags, "--review"),
      out: requiredFlag(flags, "--out"),
    };
  }
  if (command === "plan-job-draft") {
    exactFlags(flags, ["--request", "--manifest"]);
    return {
      kind: command,
      request: requiredFlag(flags, "--request"),
      manifest: requiredFlag(flags, "--manifest"),
    };
  }
  if (command === "assess-adapters") {
    exactFlags(flags, ["--manifest", "--host"]);
    return {
      kind: command,
      manifest: requiredFlag(flags, "--manifest"),
      host: requiredFlag(flags, "--host"),
    };
  }
  if (command === "verify-training-candidate") {
    exactFlags(flags, ["--bundle", "--venue-id", "--run-id"]);
    return {
      kind: command,
      bundle: requiredFlag(flags, "--bundle"),
      venueId: requiredFlag(flags, "--venue-id"),
      runId: requiredFlag(flags, "--run-id"),
    };
  }
  if (command === "prepare") {
    exactFlags(flags, ["--bundle", "--out"]);
    return {
      kind: command,
      bundle: requiredFlag(flags, "--bundle"),
      out: requiredFlag(flags, "--out"),
    };
  }
  if (command === "upload-candidate") {
    exactFlags(flags, ["--prepared"]);
    return { kind: command, prepared: requiredFlag(flags, "--prepared") };
  }
  if (command === "verify-candidate") {
    exactFlags(flags, ["--prefix"]);
    return { kind: command, prefix: requiredFlag(flags, "--prefix") };
  }
  if (command === "prepare-signing-request") {
    exactFlags(flags, ["--payload", "--out"]);
    return {
      kind: command,
      payload: requiredFlag(flags, "--payload"),
      out: requiredFlag(flags, "--out"),
    };
  }
  if (command === "assemble-attestation") {
    exactFlags(flags, ["--payload", "--key-id", "--signature-base64", "--out"]);
    return {
      kind: command,
      payload: requiredFlag(flags, "--payload"),
      keyId: requiredFlag(flags, "--key-id"),
      signatureBase64: requiredFlag(flags, "--signature-base64"),
      out: requiredFlag(flags, "--out"),
    };
  }
  throw new Error(`Unknown Foundry command: ${command}.`);
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}

export function candidateStoreFromEnvironment(
  env: NodeJS.ProcessEnv,
): CandidateObjectStore {
  const sessionToken = env.R2_SESSION_TOKEN?.trim();
  const endpoint = env.FOUNDRY_R2_ENDPOINT?.trim();
  return new S3CandidateObjectStore({
    accountId: requiredEnvironment(env, "FOUNDRY_R2_ACCOUNT_ID"),
    accessKeyId: requiredEnvironment(env, "FOUNDRY_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment(env, "FOUNDRY_R2_SECRET_ACCESS_KEY"),
    bucketName: requiredEnvironment(env, "FOUNDRY_R2_CANDIDATE_BUCKET"),
    ...(sessionToken !== undefined && sessionToken.length > 0
      ? { sessionToken }
      : {}),
    ...(endpoint !== undefined && endpoint.length > 0 ? { endpoint } : {}),
  });
}

export interface FoundryCliDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly write: (text: string) => void;
  readonly startLocalApp?: (
    options: LocalFoundryAppOptions,
  ) => Promise<LocalFoundryAppHandle>;
  readonly openLocalApp?: (url: string) => void;
  readonly createStore?: (env: NodeJS.ProcessEnv) => CandidateObjectStore;
  readonly inspectIntake?: (source: string) => Promise<unknown>;
  readonly inspectSourceFacts?: (source: string) => Promise<unknown>;
  readonly admitIntake?: (input: {
    readonly receiptPath: string;
    readonly reviewPath: string;
  }) => Promise<unknown>;
  readonly stageIntake?: (input: {
    readonly sourcePath: string;
    readonly receiptPath: string;
    readonly reviewPath: string;
    readonly outputDirectory: string;
  }) => Promise<unknown>;
  readonly planJob?: (input: {
    readonly requestPath: string;
    readonly manifestPath: string;
  }) => Promise<unknown>;
  readonly assessAdapters?: (input: {
    readonly manifestPath: string;
    readonly hostPath: string;
  }) => Promise<unknown>;
  readonly composeCaptureBundle?: (inputPath: string) => Promise<unknown>;
  readonly assembleRoomPackage?: (inputPath: string) => Promise<unknown>;
  readonly verifyTrainingCandidate?: (input: {
    readonly bundleRoot: string;
    readonly expectedVenueId: string;
    readonly expectedRunId: string;
  }) => Promise<unknown>;
  readonly prepare?: (input: {
    readonly bundleRoot: string;
    readonly outDir: string;
  }) => Promise<unknown>;
  readonly upload?: (input: {
    readonly preparedDirectory: string;
    readonly store: CandidateObjectStore;
  }) => Promise<unknown>;
  readonly verify?: (input: {
    readonly candidatePrefix: string;
    readonly store: CandidateObjectStore;
  }) => Promise<unknown>;
  readonly prepareSigning?: (input: {
    readonly payloadPath: string;
    readonly outDirectory: string;
  }) => Promise<unknown>;
  readonly assemble?: (input: {
    readonly payloadPath: string;
    readonly keyId: string;
    readonly signatureBase64: string;
    readonly outPath: string;
  }) => Promise<unknown>;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path)).toString("utf8"));
}

export async function admitIntakeDraftFromFiles(input: {
  readonly receiptPath: string;
  readonly reviewPath: string;
}): Promise<unknown> {
  const [receipt, review] = await Promise.all([
    readJson(input.receiptPath),
    readJson(input.reviewPath),
  ]);
  return admitUniversalIntakeReceipt(receipt, review);
}

export async function stageIntakeDraftFromFiles(input: {
  readonly sourcePath: string;
  readonly receiptPath: string;
  readonly reviewPath: string;
  readonly outputDirectory: string;
}): Promise<unknown> {
  const [receipt, review] = await Promise.all([
    readJson(input.receiptPath),
    readJson(input.reviewPath),
  ]);
  return stageUniversalIntakeDraft({
    sourcePath: input.sourcePath,
    outputDirectory: input.outputDirectory,
    receipt,
    review,
  });
}

export async function planJobDraftFromFiles(input: {
  readonly requestPath: string;
  readonly manifestPath: string;
}): Promise<unknown> {
  const [request, manifest] = await Promise.all([
    readJson(input.requestPath),
    readJson(input.manifestPath),
  ]);
  return compileFoundryPlanOnlyDossier(request, manifest);
}

export async function assessAdaptersFromFiles(input: {
  readonly manifestPath: string;
  readonly hostPath: string;
}): Promise<unknown> {
  const [manifest, hostCapabilities] = await Promise.all([
    readJson(input.manifestPath),
    readJson(input.hostPath),
  ]);
  return compileFoundryAdapterCapabilityAssessmentV0({
    manifest,
    hostCapabilities,
  });
}

export async function composeCaptureBundleFromFile(
  inputPath: string,
): Promise<unknown> {
  return composeFoundryMultiRootCaptureBundleV0(await readJson(inputPath));
}

export async function assembleRoomPackageFromFile(
  inputPath: string,
): Promise<unknown> {
  return assembleFoundryRoomRealityPackage(await readJson(inputPath));
}

export async function runFoundryCli(
  args: readonly string[],
  dependencies: FoundryCliDependencies,
): Promise<void> {
  const command = parseFoundryCliArgs(args);
  if (command.kind === "help") {
    dependencies.write(`${FOUNDRY_CLI_USAGE}\n`);
    return;
  }
  if (command.kind === "local-app") {
    const app = await (dependencies.startLocalApp ?? startLocalFoundryApp)({
      source: command.source,
      port: command.port,
      ...(command.localSogCandidate === undefined
        ? {}
        : { localSogCandidate: command.localSogCandidate }),
      ...(command.localRoomEvidence === undefined
        ? {}
        : { localRoomEvidence: command.localRoomEvidence }),
    });
    dependencies.write(
      [
        "Foundry local check is running.",
        "",
        `1. Open this private local link: ${app.url}`,
        `2. Review the source named "${app.sourceLabel}". Every file starts as not approved yet.`,
        "3. Download the receipt if you want to keep the findings.",
        "",
        "Safe here: reading names, sizes, format clues, and file fingerprints.",
        "Disabled here: uploads, reconstruction, training, approval, and publishing.",
        ...(app.localSogCandidateDescriptorUrl === undefined
          ? []
          : [
              "",
              `Local Grand Hall appearance descriptor: ${app.localSogCandidateDescriptorUrl}`,
            ]),
        ...(app.localSogCandidateConsumerUrl === undefined
          ? []
          : [
              `Open the Grand Hall local visual candidate: ${app.localSogCandidateConsumerUrl}`,
            ]),
        ...(app.localRoomEvidenceDescriptorUrl === undefined
          ? []
          : [
              "",
              `Local Grand Hall multimodal evidence descriptor: ${app.localRoomEvidenceDescriptorUrl}`,
            ]),
        ...(app.localRoomEvidenceConsumerUrl === undefined
          ? []
          : [
              `Open the Grand Hall multimodal evidence view: ${app.localRoomEvidenceConsumerUrl}`,
            ]),
        "",
        'To stop: click "Stop local session" in the page, or press Ctrl+C in this same terminal.',
        "",
      ].join("\n"),
    );
    if (command.open)
      (dependencies.openLocalApp ?? openLocalFoundryAppInBrowser)(app.url);
    const stopped = await app.closed;
    dependencies.write(
      `Foundry local check stopped (${stopped.reason.replaceAll("_", " ")}).\n`,
    );
    return;
  }
  let result: unknown;
  if (command.kind === "inspect-intake") {
    result = await (dependencies.inspectIntake ?? inspectUniversalIntake)(
      command.source,
    );
  } else if (command.kind === "inspect-source-facts") {
    result = await (
      dependencies.inspectSourceFacts ?? inspectUniversalIntakeWithSourceFactsV6
    )(command.source);
  } else if (command.kind === "admit-intake-draft") {
    result = await (dependencies.admitIntake ?? admitIntakeDraftFromFiles)({
      receiptPath: command.receipt,
      reviewPath: command.review,
    });
  } else if (command.kind === "compose-capture-bundle") {
    result = await (
      dependencies.composeCaptureBundle ?? composeCaptureBundleFromFile
    )(command.input);
  } else if (command.kind === "stage-intake-draft") {
    result = await (dependencies.stageIntake ?? stageIntakeDraftFromFiles)({
      sourcePath: command.source,
      receiptPath: command.receipt,
      reviewPath: command.review,
      outputDirectory: command.out,
    });
  } else if (command.kind === "plan-job-draft") {
    result = await (dependencies.planJob ?? planJobDraftFromFiles)({
      requestPath: command.request,
      manifestPath: command.manifest,
    });
  } else if (command.kind === "assess-adapters") {
    result = await (dependencies.assessAdapters ?? assessAdaptersFromFiles)({
      manifestPath: command.manifest,
      hostPath: command.host,
    });
  } else if (command.kind === "assemble-room-package") {
    result = await (
      dependencies.assembleRoomPackage ?? assembleRoomPackageFromFile
    )(command.input);
  } else if (command.kind === "verify-training-candidate") {
    result = await (
      dependencies.verifyTrainingCandidate ?? verifyTrainingCandidateBundle
    )({
      bundleRoot: command.bundle,
      expectedVenueId: command.venueId,
      expectedRunId: command.runId,
    });
  } else if (command.kind === "prepare") {
    result = await (dependencies.prepare ?? prepareReconstructionRelease)({
      bundleRoot: command.bundle,
      outDir: command.out,
    });
  } else if (command.kind === "prepare-signing-request") {
    result = await (dependencies.prepareSigning ?? prepareSigningRequest)({
      payloadPath: command.payload,
      outDirectory: command.out,
    });
  } else if (command.kind === "assemble-attestation") {
    result = await (dependencies.assemble ?? assembleAttestation)({
      payloadPath: command.payload,
      keyId: command.keyId,
      signatureBase64: command.signatureBase64,
      outPath: command.out,
    });
  } else {
    const store = (dependencies.createStore ?? candidateStoreFromEnvironment)(
      dependencies.env,
    );
    if (command.kind === "upload-candidate") {
      result = await (dependencies.upload ?? uploadCandidateRelease)({
        preparedDirectory: command.prepared,
        store,
      });
    } else {
      result = await (dependencies.verify ?? verifyRemoteCandidateRelease)({
        candidatePrefix: command.prefix,
        store,
      });
    }
  }
  dependencies.write(`${JSON.stringify(result, null, 2)}\n`);
}
