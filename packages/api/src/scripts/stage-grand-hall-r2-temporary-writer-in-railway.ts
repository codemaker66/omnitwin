import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { GRAND_HALL_STAGING_TARGET_ID } from "../lib/grand-hall-frontier-contract.js";
import {
  GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER,
  GrandHallR2DpapiError,
  stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi,
  type GrandHallR2RailwayTargetIds,
} from "./grand-hall-r2-credential-dpapi.js";
import {
  GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
  GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
} from "./grand-hall-railway-cli-contract.js";
import { rejectRetiredGrandHallV1Intake } from "./grand-hall-v1-intake-retired.js";

const RAILWAY_STATUS_DEADLINE_MS = 30_000;
const RAILWAY_VERSION_DEADLINE_MS = 10_000;
const RAILWAY_STATUS_MAX_BUFFER_BYTES = 1_048_576;
const RAILWAY_VERSION_MAX_BUFFER_BYTES = 1_024;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const execFile = promisify(execFileCallback);

export interface GrandHallR2RailwayStageOptions
  extends GrandHallR2RailwayTargetIds {
  readonly inputPath: string;
  readonly railwayExecutable: string;
  readonly confirmTarget: typeof GRAND_HALL_STAGING_TARGET_ID;
}

export interface GrandHallR2RailwayStatusExecution {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface GrandHallR2RailwayStageDependencies {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly resolveRegularFile?: (
    path: string,
    expectedBasename?: string,
  ) => Promise<string>;
  readonly inspectTarget?: (
    executable: string,
    target: GrandHallR2RailwayTargetIds,
    environment: Readonly<Record<string, string | undefined>>,
  ) => Promise<unknown>;
  readonly verifyRailwayExecutable?: (
    executable: string,
    environment: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
  readonly stageCredential?: (
    inputPath: string,
    executable: string,
    target: GrandHallR2RailwayTargetIds,
    environment: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
}

export class GrandHallR2RailwayStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrandHallR2RailwayStageError";
  }
}

function stageError(message: string): GrandHallR2RailwayStageError {
  return new GrandHallR2RailwayStageError(message);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function strictFlagValues(argv: readonly string[]): ReadonlyMap<string, string> {
  const allowedFlags = new Set([
    "--in",
    "--railway-executable",
    "--project-id",
    "--environment-id",
    "--service-id",
    "--confirm-target",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) {
      throw stageError("Unexpected positional argument.");
    }
    if (!allowedFlags.has(argument)) {
      throw stageError("Unknown argument.");
    }
    if (values.has(argument)) {
      throw stageError(`${argument} may be supplied only once.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw stageError(`${argument} requires a value.`);
    }
    if (
      value.length === 0 ||
      value.trim() !== value ||
      containsControlCharacter(value)
    ) {
      throw stageError(`${argument} has an invalid value shape.`);
    }
    values.set(argument, value);
    index += 1;
  }
  return values;
}

function requiredFlag(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) throw stageError(`${name} is required.`);
  return value;
}

function canonicalUuid(value: string, name: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw stageError(`${name} must be a canonical lowercase UUID.`);
  }
  return value;
}

export function parseGrandHallR2RailwayStageArgs(
  argv: readonly string[],
): GrandHallR2RailwayStageOptions {
  const values = strictFlagValues(argv);
  const inputPath = requiredFlag(values, "--in");
  const railwayExecutable = requiredFlag(values, "--railway-executable");
  if (!isAbsolute(inputPath)) {
    throw stageError("--in must be an absolute path.");
  }
  if (
    !isAbsolute(railwayExecutable) ||
    basename(railwayExecutable).toLowerCase() !== "railway.exe"
  ) {
    throw stageError(
      "--railway-executable must be an absolute native railway.exe path.",
    );
  }
  const confirmTarget = requiredFlag(values, "--confirm-target");
  if (confirmTarget !== GRAND_HALL_STAGING_TARGET_ID) {
    throw stageError(
      `--confirm-target must be exactly ${GRAND_HALL_STAGING_TARGET_ID}.`,
    );
  }
  return {
    inputPath: resolve(inputPath),
    railwayExecutable: resolve(railwayExecutable),
    projectId: canonicalUuid(requiredFlag(values, "--project-id"), "--project-id"),
    environmentId: canonicalUuid(
      requiredFlag(values, "--environment-id"),
      "--environment-id",
    ),
    serviceId: canonicalUuid(requiredFlag(values, "--service-id"), "--service-id"),
    confirmTarget,
  };
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const matchingEntry = Object.entries(environment).find(
    ([candidate]) => candidate.toUpperCase() === name.toUpperCase(),
  );
  const value = matchingEntry?.[1];
  if (
    value === undefined ||
    value.length === 0 ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    return undefined;
  }
  return value;
}

export function safeRailwayCliEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {
    CI: "true",
    NO_COLOR: "1",
  };
  for (const name of [
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
  ] as const) {
    const value = environmentValue(environment, name);
    if (value !== undefined) safe[name] = value;
  }
  const windowsRoot = safe["SystemRoot"] ?? safe["WINDIR"];
  const drive = windowsRoot === undefined
    ? undefined
    : /^([A-Za-z]:)[\\/]/u.exec(windowsRoot)?.[1]?.toUpperCase();
  if (drive !== undefined) {
    safe.SystemDrive = drive;
    const programData = environmentValue(environment, "ProgramData");
    safe.ProgramData = programData !== undefined &&
        programData.toUpperCase().startsWith(`${drive}\\`)
      ? programData
      : `${drive}\\ProgramData`;
  }
  return safe;
}

export interface GrandHallRailwayVersionExecution {
  readonly executable: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

async function executeRailwayVersion(
  execution: GrandHallRailwayVersionExecution,
): Promise<string> {
  try {
    const result = await execFile(execution.executable, ["--version"], {
      cwd: execution.cwd,
      encoding: "utf8",
      env: { ...execution.env },
      windowsHide: true,
      timeout: RAILWAY_VERSION_DEADLINE_MS,
      maxBuffer: RAILWAY_VERSION_MAX_BUFFER_BYTES,
    });
    return String(result.stdout);
  } catch {
    throw stageError(
      "The reviewed Railway CLI version could not be verified safely.",
    );
  }
}

export function assertGrandHallReviewedRailwayCliIdentity(
  sha256: string,
  versionOutput: string,
): void {
  if (
    sha256 !== GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256 ||
    versionOutput.trim() !== GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION
  ) {
    throw stageError(
      "The selected Railway CLI does not match the reviewed version and SHA-256.",
    );
  }
}

export async function assertGrandHallReviewedRailwayCli(
  executable: string,
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: {
    readonly readExecutable?: (path: string) => Promise<Buffer>;
    readonly executeVersion?: (
      execution: GrandHallRailwayVersionExecution,
    ) => Promise<string>;
  } = {},
): Promise<void> {
  const bytes = await (dependencies.readExecutable ?? readFile)(executable);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256) {
    throw stageError(
      "The selected Railway CLI does not match the reviewed version and SHA-256.",
    );
  }
  const versionOutput = await (dependencies.executeVersion ?? executeRailwayVersion)({
    executable,
    cwd: tmpdir(),
    env: safeRailwayCliEnvironment(environment),
  });
  assertGrandHallReviewedRailwayCliIdentity(sha256, versionOutput);
}

async function executeRailwayStatus(
  execution: GrandHallR2RailwayStatusExecution,
): Promise<string> {
  try {
    const result = await execFile(execution.executable, [...execution.args], {
      cwd: execution.cwd,
      encoding: "utf8",
      env: { ...execution.env },
      windowsHide: true,
      timeout: RAILWAY_STATUS_DEADLINE_MS,
      maxBuffer: RAILWAY_STATUS_MAX_BUFFER_BYTES,
    });
    return String(result.stdout);
  } catch {
    throw stageError(
      "Railway target status could not be read without disclosing provider output.",
    );
  }
}

export async function inspectGrandHallR2RailwayTarget(
  executable: string,
  target: GrandHallR2RailwayTargetIds,
  environment: Readonly<Record<string, string | undefined>>,
  executeStatus: (
    execution: GrandHallR2RailwayStatusExecution,
  ) => Promise<string> = executeRailwayStatus,
): Promise<unknown> {
  const stdout = await executeStatus({
    executable,
    args: [
      "status",
      "--project",
      target.projectId,
      "--environment",
      target.environmentId,
      "--json",
    ],
    cwd: tmpdir(),
    env: safeRailwayCliEnvironment(environment),
  });
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw stageError("Railway target status was not valid JSON.");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function connectionNodes(
  parent: Readonly<Record<string, unknown>>,
  property: string,
): readonly Readonly<Record<string, unknown>>[] | null {
  const connection = parent[property];
  if (!isRecord(connection) || !Array.isArray(connection["edges"])) return null;
  const nodes: Readonly<Record<string, unknown>>[] = [];
  for (const edge of connection["edges"]) {
    if (!isRecord(edge) || !isRecord(edge["node"])) return null;
    nodes.push(edge["node"]);
  }
  return nodes;
}

function hasExactIdentity(
  value: Readonly<Record<string, unknown>>,
  id: string,
): boolean {
  return value["id"] === id && value["name"] === GRAND_HALL_STAGING_TARGET_ID;
}

export function assertGrandHallR2RailwayStatusMatchesTarget(
  status: unknown,
  target: GrandHallR2RailwayTargetIds,
): void {
  if (!isRecord(status) || !hasExactIdentity(status, target.projectId)) {
    throw stageError("Railway status did not prove the dedicated staging project.");
  }
  const environments = connectionNodes(status, "environments");
  if (
    environments === null ||
    environments.length !== 1 ||
    environments[0] === undefined ||
    !hasExactIdentity(environments[0], target.environmentId)
  ) {
    throw stageError("Railway status did not prove the dedicated staging environment.");
  }
  const services = connectionNodes(status, "services");
  if (
    services === null ||
    services.length !== 1 ||
    services[0] === undefined ||
    !hasExactIdentity(services[0], target.serviceId)
  ) {
    throw stageError("Railway status did not prove the dedicated staging API service.");
  }
}

async function resolveRegularFile(
  path: string,
  expectedBasename?: string,
): Promise<string> {
  try {
    const initialMetadata = await lstat(path);
    if (!initialMetadata.isFile() || initialMetadata.isSymbolicLink()) {
      throw stageError("Local handoff input is not a regular non-link file.");
    }
    const canonical = await realpath(path);
    const canonicalMetadata = await lstat(canonical);
    if (!canonicalMetadata.isFile() || canonicalMetadata.isSymbolicLink()) {
      throw stageError("Local handoff input is not a regular non-link file.");
    }
    if (
      expectedBasename !== undefined &&
      basename(canonical).toLowerCase() !== expectedBasename.toLowerCase()
    ) {
      throw stageError("The selected Railway executable is not native railway.exe.");
    }
    return canonical;
  } catch (error: unknown) {
    if (error instanceof GrandHallR2RailwayStageError) throw error;
    throw stageError("A local handoff file could not be resolved safely.");
  }
}

async function assertDpapiArtifactHeader(path: string): Promise<void> {
  const header = Buffer.from(GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER, "ascii");
  const candidate = Buffer.alloc(header.length);
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= header.length) {
      throw stageError("The protected credential artifact is invalid.");
    }
    const result = await handle.read(candidate, 0, candidate.length, 0);
    if (result.bytesRead !== header.length || !candidate.equals(header)) {
      throw stageError("The protected credential artifact is invalid.");
    }
  } finally {
    candidate.fill(0);
    await handle.close();
  }
}

export async function runGrandHallR2RailwayStage(input: {
  readonly argv: readonly string[];
  readonly dependencies?: GrandHallR2RailwayStageDependencies;
}): Promise<void> {
  // Fail before parsing the artifact, inspecting Railway, or decrypting any
  // credential. The v1 handoff is permanently retired.
  rejectRetiredGrandHallV1Intake();
  const options = parseGrandHallR2RailwayStageArgs(input.argv);
  const dependencies = input.dependencies ?? {};
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32") {
    throw stageError("CurrentUser-DPAPI Railway handoff is available only on Windows.");
  }
  const environment = dependencies.environment ?? process.env;
  const resolveFile = dependencies.resolveRegularFile ?? resolveRegularFile;
  const inputPath = await resolveFile(options.inputPath);
  const executable = await resolveFile(options.railwayExecutable, "railway.exe");
  const verifyRailwayExecutable = dependencies.verifyRailwayExecutable ??
    assertGrandHallReviewedRailwayCli;
  await verifyRailwayExecutable(executable, environment);
  await assertDpapiArtifactHeader(inputPath);

  const target: GrandHallR2RailwayTargetIds = {
    projectId: options.projectId,
    environmentId: options.environmentId,
    serviceId: options.serviceId,
  };
  const inspectTarget = dependencies.inspectTarget ?? inspectGrandHallR2RailwayTarget;
  const status = await inspectTarget(executable, target, environment);
  assertGrandHallR2RailwayStatusMatchesTarget(status, target);

  // Recheck immediately before the DPAPI helper is permitted to decrypt; the
  // helper independently checks the same pinned identity before every write.
  await verifyRailwayExecutable(executable, environment);

  const stageCredential = dependencies.stageCredential ??
    stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi;
  try {
    await stageCredential(inputPath, executable, target, environment);
  } catch (error: unknown) {
    if (error instanceof GrandHallR2DpapiError) {
      throw stageError(error.message);
    }
    throw stageError(
      "Protected R2 fields could not be staged through Railway stdin safely.",
    );
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  runGrandHallR2RailwayStage({ argv: process.argv.slice(2) }).catch(
    (error: unknown) => {
      const message = error instanceof GrandHallR2RailwayStageError
        ? error.message
        : "Grand Hall R2 Railway handoff failed without disclosure.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
