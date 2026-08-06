import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  S3CandidateObjectStore,
  admitUniversalIntakeReceipt,
  compileFoundryPlanOnlyDossier,
  inspectUniversalIntake,
  prepareReconstructionRelease,
  stageUniversalIntakeDraft,
  uploadCandidateRelease,
  verifyFoundryLocalIntakeWorkspaceV0,
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
import {
  createCapturedQualityComparisonProcessRunner,
} from "./captured-quality-comparison-process-runner.js";
import { startConfiguredLocalNativeIntakeApp } from "./local-native-intake-composition.js";

export const FOUNDRY_CLI_USAGE = `Usage:
  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli foundry -- local-app [--source <file-or-folder>] [--workspace <absolute-folder>] [--port <1024-65535>] [--open]
    [--captured-quality-repo-root <repo> --captured-quality-quality-root <folder>
     --captured-quality-mobile-root <folder> --captured-quality-output-root <folder>]
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

Run local-app without --source or --workspace to open the Windows picker-or-drop/path-reopen preview. This preview
can start a local intake from a Windows picker or a helper-owned Explorer drop target. It performs no upload,
reconstruction, enhancement, or training. Add --open to open its private local page automatically.

The legacy local-app --source flow reads the one source chosen at startup and cannot accept another path in
the browser. Add --workspace with --source to offer an explicit verified local copy, or reopen that saved copy
later with --workspace alone. It does not open a browser unless --open is present. Click "Stop local session"
or press Ctrl+C in the same terminal to stop it.

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
      readonly source?: string;
      readonly workspace?: string;
      readonly port: number;
      readonly open: boolean;
      readonly capturedQualityComparison?: {
        readonly repoRoot: string;
        readonly qualityRoot: string;
        readonly mobileRoot: string;
        readonly outputRoot: string;
      };
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
  let workspace: string | undefined;
  let port = 0;
  let open = false;
  const comparisonValues = new Map<string, string>();
  const comparisonFlags: ReadonlyMap<string, string> = new Map([
    ["--captured-quality-repo-root", "repoRoot"],
    ["--captured-quality-quality-root", "qualityRoot"],
    ["--captured-quality-mobile-root", "mobileRoot"],
    ["--captured-quality-output-root", "outputRoot"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === undefined) throw new Error("Missing local-app option.");
    if (flag === "--open") {
      if (open) throw new Error("Duplicate CLI option: --open.");
      open = true;
      continue;
    }
    if (
      flag !== "--source" &&
      flag !== "--workspace" &&
      flag !== "--port" &&
      !comparisonFlags.has(flag)
    ) {
      throw new Error(`Unknown CLI option: ${flag}.`);
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
    } else if (flag === "--workspace") {
      if (workspace !== undefined) throw new Error("Duplicate CLI option: --workspace.");
      const trimmed = value.trim();
      if (trimmed.length === 0 || !isAbsolute(trimmed)) {
        throw new Error("--workspace must be an absolute path.");
      }
      workspace = resolve(trimmed);
    } else if (flag === "--port") {
      if (port !== 0) throw new Error("Duplicate CLI option: --port.");
      if (!/^\d+$/u.test(value)) throw new Error("--port must be a whole number between 1024 and 65535.");
      port = Number(value);
      if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
        throw new Error("--port must be a whole number between 1024 and 65535.");
      }
    } else {
      if (comparisonValues.has(flag)) {
        throw new Error(`Duplicate CLI option: ${flag}.`);
      }
      const trimmed = value.trim();
      if (trimmed.length === 0 || !isAbsolute(trimmed)) {
        throw new Error(`${flag} must be an absolute path.`);
      }
      comparisonValues.set(flag, resolve(trimmed));
    }
  }
  if (comparisonValues.size !== 0 && comparisonValues.size !== comparisonFlags.size) {
    throw new Error("All four --captured-quality-* paths are required together.");
  }
  if (comparisonValues.size === 0) {
    return {
      kind: "local-app",
      ...(source === undefined ? {} : { source }),
      ...(workspace === undefined ? {} : { workspace }),
      port,
      open,
    };
  }
  if (source === undefined) {
    throw new Error("Captured-quality comparison requires --source.");
  }
  return {
    kind: "local-app",
    source,
    ...(workspace === undefined ? {} : { workspace }),
    port,
    open,
    capturedQualityComparison: {
      repoRoot: comparisonValues.get("--captured-quality-repo-root") ?? "",
      qualityRoot: comparisonValues.get("--captured-quality-quality-root") ?? "",
      mobileRoot: comparisonValues.get("--captured-quality-mobile-root") ?? "",
      outputRoot: comparisonValues.get("--captured-quality-output-root") ?? "",
    },
  };
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

export type FoundryCliShutdownSignal = "SIGINT" | "SIGTERM";

export interface FoundryCliSignalSource {
  on(signal: FoundryCliShutdownSignal, listener: () => void): void;
  off(signal: FoundryCliShutdownSignal, listener: () => void): void;
}

export interface FoundryCliDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly write: (text: string) => void;
  readonly signalSource?: FoundryCliSignalSource;
  readonly resolvePreparedHdPythonExecutable?: (
    env: NodeJS.ProcessEnv,
  ) => Promise<string>;
  readonly startLocalApp?: (options: LocalFoundryAppOptions) => Promise<LocalFoundryAppHandle>;
  readonly startNativeIntakeApp?: (
    options: LocalNativeIntakeCliAppOptions,
  ) => Promise<LocalNativeIntakeCliAppHandle>;
  readonly openLocalApp?: (url: string) => void;
  readonly verifyLocalIntakeWorkspace?: (
    workspaceDirectory: string,
  ) => Promise<{ readonly activeSourcePath: string }>;
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

export interface LocalNativeIntakeCliAppOptions {
  readonly port: number;
}

export interface LocalNativeIntakeCliAppHandle {
  readonly url: string;
  readonly closed: Promise<{ readonly reason: string }>;
  readonly stop: () => Promise<void>;
}

interface StoppableLocalApp<TClosed extends { readonly reason: string }> {
  readonly closed: Promise<TClosed>;
  readonly stop: () => Promise<void>;
}

interface LocalAppShutdownCoordinator {
  waitForConfirmedShutdown<TClosed extends { readonly reason: string }>(
    app: StoppableLocalApp<TClosed>,
  ): Promise<TClosed>;
  dispose(): void;
}

function createLocalAppShutdownCoordinator(
  dependencies: FoundryCliDependencies,
): LocalAppShutdownCoordinator {
  const signalSource = dependencies.signalSource;
  if (signalSource === undefined) {
    return {
      waitForConfirmedShutdown: <TClosed extends { readonly reason: string }>(
        app: StoppableLocalApp<TClosed>,
      ) => app.closed,
      dispose: () => undefined,
    };
  }

  let disposed = false;
  let stopRequested = false;
  let activeStop: (() => Promise<void>) | null = null;
  let stopAttempt: Promise<void> | null = null;

  const attemptStop = (): void => {
    if (disposed || activeStop === null || stopAttempt !== null) return;
    const attempt = Promise.resolve().then(activeStop);
    stopAttempt = attempt;
    void attempt.then(
      () => {
        if (!disposed && stopAttempt === attempt) stopAttempt = null;
      },
      () => {
        if (disposed || stopAttempt !== attempt) return;
        stopAttempt = null;
        try {
          dependencies.write(
            "Local shutdown was not confirmed. The process remains open; send Ctrl+C or SIGTERM again to retry.\n",
          );
        } catch {
          // A closed output stream must not bypass exact local-app cleanup.
        }
      },
    );
  };

  const stopFromSignal = (): void => {
    stopRequested = true;
    attemptStop();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    activeStop = null;
    signalSource.off("SIGINT", stopFromSignal);
    signalSource.off("SIGTERM", stopFromSignal);
  };

  signalSource.on("SIGINT", stopFromSignal);
  signalSource.on("SIGTERM", stopFromSignal);

  return {
    async waitForConfirmedShutdown<TClosed extends { readonly reason: string }>(
      app: StoppableLocalApp<TClosed>,
    ): Promise<TClosed> {
      activeStop = () => app.stop();
      if (stopRequested) attemptStop();
      try {
        const closed = await app.closed;
        const pendingStop = stopAttempt;
        if (pendingStop !== null) await pendingStop;
        return closed;
      } finally {
        dispose();
      }
    },
    dispose,
  };
}

interface ResolvePreparedHdPythonExecutableHooks {
  readonly platform?: NodeJS.Platform;
  readonly locate?: (
    command: string,
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
  ) => Promise<readonly string[]>;
  readonly canonicalize?: (path: string) => Promise<string>;
}

function locateExecutableOnce(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<readonly string[]> {
  const locator = platform === "win32" ? "where.exe" : "which";
  return new Promise((resolvePromise) => {
    execFile(
      locator,
      [command],
      {
        encoding: "utf8",
        env,
        maxBuffer: 64 * 1_024,
        timeout: 5_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          resolvePromise([]);
          return;
        }
        resolvePromise(
          stdout
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        );
      },
    );
  });
}

function isLocalAbsoluteExecutable(path: string): boolean {
  return isAbsolute(path) && !/^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/u.test(path);
}

export async function resolvePreparedHdPythonExecutable(
  env: NodeJS.ProcessEnv,
  hooks: ResolvePreparedHdPythonExecutableHooks = {},
): Promise<string> {
  const platform = hooks.platform ?? process.platform;
  const locate = hooks.locate ?? locateExecutableOnce;
  const canonicalize = hooks.canonicalize ?? realpath;
  const configured = env.PYTHON?.trim() ?? "";

  if (configured.length > 0 && isAbsolute(configured)) {
    const canonical = await canonicalize(resolve(configured));
    if (!isLocalAbsoluteExecutable(canonical)) {
      throw new Error("PYTHON must identify one local absolute interpreter file.");
    }
    return canonical;
  }
  if (configured.length > 0 && /[\\/:]/u.test(configured)) {
    throw new Error("PYTHON must be an absolute path or one executable name.");
  }

  const commands = configured.length > 0
    ? [configured]
    : platform === "win32"
      ? ["python", "py"]
      : ["python3", "python"];
  const located: string[] = [];
  for (const command of commands) {
    const candidates = await locate(command, env, platform);
    for (const candidate of candidates) {
      if (!isLocalAbsoluteExecutable(candidate)) continue;
      try {
        const canonical = await canonicalize(resolve(candidate));
        if (isLocalAbsoluteExecutable(canonical)) located.push(canonical);
      } catch {
        // Try the next locator result without exposing a host path.
      }
    }
    if (located.length > 0) break;
  }
  const unique = located.filter((candidate, index) => {
    const key = platform === "win32" ? candidate.toLocaleLowerCase("en-US") : candidate;
    return located.findIndex((other) => (
      platform === "win32" ? other.toLocaleLowerCase("en-US") : other
    ) === key) === index;
  });
  const withoutWindowsStoreShim = platform === "win32"
    ? unique.filter((candidate) =>
        !candidate.toLocaleLowerCase("en-US").includes("\\microsoft\\windowsapps\\"),
      )
    : unique;
  const selected = (withoutWindowsStoreShim.length > 0
    ? withoutWindowsStoreShim
    : unique)[0];
  if (selected === undefined) {
    throw new Error(
      "A fixed Python interpreter could not be found. Set PYTHON to its absolute path and start the local app again.",
    );
  }
  return selected;
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
    const workspace = command.workspace;
    if (command.source === undefined && workspace === undefined) {
      const shutdown = createLocalAppShutdownCoordinator(dependencies);
      try {
        const app = await (
          dependencies.startNativeIntakeApp ?? startConfiguredLocalNativeIntakeApp
        )({ port: command.port });
        dependencies.write([
          "Foundry native intake preview is running.",
          "",
          `1. Open this private local link: ${app.url}`,
          "2. Use the Windows picker or native drop panel to choose local source material.",
          "3. The preview reopens those selected paths locally to prepare a resumable workspace.",
          "",
          "Explorer drop target: open the drop area in the page, then drop files or folders into the separate Windows panel.",
          "Disabled here: uploads, reconstruction, enhancement, training, approval, and publishing.",
          "",
          "To stop: click \"Stop local session\" in the page, or press Ctrl+C in this same terminal.",
          "",
        ].join("\n"));
        if (command.open) (dependencies.openLocalApp ?? openLocalFoundryAppInBrowser)(app.url);
        const stopped = await shutdown.waitForConfirmedShutdown(app);
        dependencies.write(`Foundry native intake preview stopped (${stopped.reason.replaceAll("_", " ")}).\n`);
        return;
      } finally {
        shutdown.dispose();
      }
    }
    const source = command.source ?? (
      workspace === undefined
        ? undefined
        : (await (
            dependencies.verifyLocalIntakeWorkspace ??
            verifyFoundryLocalIntakeWorkspaceV0
          )(workspace)).activeSourcePath
    );
    if (source === undefined) {
      throw new Error("The local app needs a selected source or a verified saved workspace.");
    }
    const shutdown = createLocalAppShutdownCoordinator(dependencies);
    try {
      const app = await (dependencies.startLocalApp ?? startLocalFoundryApp)({
        source,
        port: command.port,
        ...(workspace === undefined
          ? {}
          : {
              localIntakeWorkspace: {
                trustedContext: {
                  sourceRoot: resolve(source),
                  workspaceDirectory: workspace,
                },
              },
            }),
        ...(command.capturedQualityComparison === undefined
          ? {}
          : {
              capturedQualityComparison: {
                trustedContext: command.capturedQualityComparison,
                runner: createCapturedQualityComparisonProcessRunner(),
              },
            }),
      });
      dependencies.write([
        "Foundry local check is running.",
        "",
        `1. Open this private local link: ${app.url}`,
        `2. Review the source named "${app.sourceLabel}". Every file starts as not approved yet.`,
        "3. Download the receipt if you want to keep the findings.",
        ...(workspace === undefined
          ? ["4. To keep a resumable verified copy, restart with --workspace and one absolute destination folder."]
          : command.source === undefined
            ? ["4. This session reopened the already verified local workspace; the original source is not required."]
            : ["4. A local workspace is configured. Copying starts only after you choose Keep verified copy in the page."]),
        "",
        "Safe here: reading names, sizes, format clues, and file fingerprints.",
        "Disabled here: uploads, reconstruction, training, approval, and publishing.",
        "",
        "To stop: click \"Stop local session\" in the page, or press Ctrl+C in this same terminal.",
        "",
      ].join("\n"));
      if (command.open) (dependencies.openLocalApp ?? openLocalFoundryAppInBrowser)(app.url);
      const stopped = await shutdown.waitForConfirmedShutdown(app);
      dependencies.write(`Foundry local check stopped (${stopped.reason.replaceAll("_", " ")}).\n`);
      return;
    } finally {
      shutdown.dispose();
    }
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
