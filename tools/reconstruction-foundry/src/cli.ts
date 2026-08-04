import { readFile } from "node:fs/promises";
import {
  S3CandidateObjectStore,
  admitUniversalIntakeReceipt,
  compileFoundryPlanOnlyDossier,
  inspectUniversalIntake,
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
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app --source <file-or-folder> [--port <1024-65535>] [--open]
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- inspect-intake --source <file-or-folder>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- admit-intake-draft --receipt <receipt.json> --review <review.json>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- stage-intake-draft --source <file-or-folder> --receipt <receipt.json> --review <review.json> --out <folder>
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- plan-job-draft --request <request.json> --manifest <manifest.json>
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
    }
  | { readonly kind: "inspect-intake"; readonly source: string }
  | { readonly kind: "admit-intake-draft"; readonly receipt: string; readonly review: string }
  | {
      readonly kind: "stage-intake-draft";
      readonly source: string;
      readonly receipt: string;
      readonly review: string;
      readonly out: string;
    }
  | { readonly kind: "plan-job-draft"; readonly request: string; readonly manifest: string }
  | {
      readonly kind: "verify-training-candidate";
      readonly bundle: string;
      readonly venueId: string;
      readonly runId: string;
    }
  | { readonly kind: "prepare"; readonly bundle: string; readonly out: string }
  | { readonly kind: "upload-candidate"; readonly prepared: string }
  | { readonly kind: "verify-candidate"; readonly prefix: string }
  | { readonly kind: "prepare-signing-request"; readonly payload: string; readonly out: string }
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
    if (flag === undefined || value === undefined || !flag.startsWith("--") || value.startsWith("--")) {
      throw new Error("Every CLI option must be a --flag followed by one value.");
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
    if (!flags.has(flag)) throw new Error(`Missing required CLI option: ${flag}.`);
  }
}

function requiredFlag(flags: ReadonlyMap<string, string>, flag: string): string {
  const value = flags.get(flag)?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing required CLI option: ${flag}.`);
  return value;
}

function parseLocalAppArgs(args: readonly string[]): FoundryCliCommand {
  let source: string | undefined;
  let port = 0;
  let open = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--open") {
      if (open) throw new Error("Duplicate CLI option: --open.");
      open = true;
      continue;
    }
    if (flag !== "--source" && flag !== "--port") {
      throw new Error(`Unknown CLI option: ${flag ?? "missing option"}.`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing required value for CLI option: ${flag}.`);
    }
    index += 1;
    if (flag === "--source") {
      if (source !== undefined) throw new Error("Duplicate CLI option: --source.");
      source = value.trim();
      if (source.length === 0) throw new Error("Missing required CLI option: --source.");
    } else {
      if (port !== 0) throw new Error("Duplicate CLI option: --port.");
      if (!/^\d+$/u.test(value)) throw new Error("--port must be a whole number between 1024 and 65535.");
      port = Number(value);
      if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
        throw new Error("--port must be a whole number between 1024 and 65535.");
      }
    }
  }
  if (source === undefined) throw new Error("Missing required CLI option: --source.");
  return { kind: "local-app", source, port, open };
}

export function parseFoundryCliArgs(args: readonly string[]): FoundryCliCommand {
  const [command, ...optionArgs] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (optionArgs.length > 0) throw new Error("The help command does not accept options.");
    return { kind: "help" };
  }
  if (command === "local-app") return parseLocalAppArgs(optionArgs);
  const flags = flagMap(optionArgs);
  if (command === "inspect-intake") {
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
    return { kind: command, bundle: requiredFlag(flags, "--bundle"), out: requiredFlag(flags, "--out") };
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
    return { kind: command, payload: requiredFlag(flags, "--payload"), out: requiredFlag(flags, "--out") };
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
  if (value === undefined || value.length === 0) throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}

export function candidateStoreFromEnvironment(env: NodeJS.ProcessEnv): CandidateObjectStore {
  const sessionToken = env.R2_SESSION_TOKEN?.trim();
  const endpoint = env.FOUNDRY_R2_ENDPOINT?.trim();
  return new S3CandidateObjectStore({
    accountId: requiredEnvironment(env, "FOUNDRY_R2_ACCOUNT_ID"),
    accessKeyId: requiredEnvironment(env, "FOUNDRY_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment(env, "FOUNDRY_R2_SECRET_ACCESS_KEY"),
    bucketName: requiredEnvironment(env, "FOUNDRY_R2_CANDIDATE_BUCKET"),
    ...(sessionToken !== undefined && sessionToken.length > 0 ? { sessionToken } : {}),
    ...(endpoint !== undefined && endpoint.length > 0 ? { endpoint } : {}),
  });
}

export interface FoundryCliDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly write: (text: string) => void;
  readonly startLocalApp?: (options: LocalFoundryAppOptions) => Promise<LocalFoundryAppHandle>;
  readonly openLocalApp?: (url: string) => void;
  readonly createStore?: (env: NodeJS.ProcessEnv) => CandidateObjectStore;
  readonly inspectIntake?: (source: string) => Promise<unknown>;
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
  readonly verifyTrainingCandidate?: (input: {
    readonly bundleRoot: string;
    readonly expectedVenueId: string;
    readonly expectedRunId: string;
  }) => Promise<unknown>;
  readonly prepare?: (input: { readonly bundleRoot: string; readonly outDir: string }) => Promise<unknown>;
  readonly upload?: (input: { readonly preparedDirectory: string; readonly store: CandidateObjectStore }) => Promise<unknown>;
  readonly verify?: (input: { readonly candidatePrefix: string; readonly store: CandidateObjectStore }) => Promise<unknown>;
  readonly prepareSigning?: (input: { readonly payloadPath: string; readonly outDirectory: string }) => Promise<unknown>;
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
    });
    dependencies.write([
      "Foundry local check is running.",
      "",
      `1. Open this private local link: ${app.url}`,
      `2. Review the source named "${app.sourceLabel}". Every file starts as not approved yet.`,
      "3. Download the receipt if you want to keep the findings.",
      "",
      "Safe here: reading names, sizes, format clues, and file fingerprints.",
      "Disabled here: uploads, reconstruction, training, approval, and publishing.",
      "",
      "To stop: click \"Stop local session\" in the page, or press Ctrl+C in this same terminal.",
      "",
    ].join("\n"));
    if (command.open) (dependencies.openLocalApp ?? openLocalFoundryAppInBrowser)(app.url);
    const stopped = await app.closed;
    dependencies.write(`Foundry local check stopped (${stopped.reason.replaceAll("_", " ")}).\n`);
    return;
  }
  let result: unknown;
  if (command.kind === "inspect-intake") {
    result = await (dependencies.inspectIntake ?? inspectUniversalIntake)(command.source);
  } else if (command.kind === "admit-intake-draft") {
    result = await (dependencies.admitIntake ?? admitIntakeDraftFromFiles)({
      receiptPath: command.receipt,
      reviewPath: command.review,
    });
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
  } else if (command.kind === "verify-training-candidate") {
    result = await (dependencies.verifyTrainingCandidate ?? verifyTrainingCandidateBundle)({
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
    const store = (dependencies.createStore ?? candidateStoreFromEnvironment)(dependencies.env);
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
