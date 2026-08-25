import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  GRAND_HALL_DEFAULT_OBJECT_PREFIX,
  GRAND_HALL_STAGING_TARGET_ID,
} from "../lib/grand-hall-frontier-contract.js";
import {
  GrandHallR2DpapiError,
  protectGrandHallR2CredentialWithCurrentUserDpapi,
} from "./grand-hall-r2-credential-dpapi.js";
import { safeGitChildEnvironment } from "./safe-git-child-environment.js";
import { rejectRetiredGrandHallV1Intake } from "./grand-hall-v1-intake-retired.js";

export const GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX =
  GRAND_HALL_DEFAULT_OBJECT_PREFIX;
export const GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET =
  GRAND_HALL_STAGING_TARGET_ID;
export const GRAND_HALL_R2_TEMPORARY_WRITER_DEFAULT_TTL_SECONDS = 3_600;
export const GRAND_HALL_R2_TEMPORARY_WRITER_MIN_TTL_SECONDS = 900;
export const GRAND_HALL_R2_TEMPORARY_WRITER_MAX_TTL_SECONDS = 3_600;

export const GRAND_HALL_R2_TEMPORARY_WRITER_ENV = {
  accountId: "VENVIEWER_GRAND_HALL_R2_ACCOUNT_ID",
  bucket: "VENVIEWER_GRAND_HALL_R2_BUCKET",
  parentAccessKeyId: "VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_ACCESS_KEY_ID",
  parentSecretAccessKey: "VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_SECRET_ACCESS_KEY",
} as const;

const MIN_PARENT_SECRET_BYTES = 32;
const GIT_COMMAND_DEADLINE_MS = 30_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 1_048_576;
const execFile = promisify(execFileCallback);

export class GrandHallR2TemporaryWriterMintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrandHallR2TemporaryWriterMintError";
  }
}

export interface GrandHallR2TemporaryWriterCliOptions {
  readonly outPath: string;
  readonly ttlSeconds: number;
}

export interface GrandHallR2TemporaryWriterParent {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface GrandHallR2TemporaryWriterClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly bucket: string;
  readonly scope: "object-read-write";
  readonly actions: readonly ["PutObject"];
  readonly paths: {
    readonly prefixPaths: readonly [typeof GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX];
  };
}

export interface GrandHallR2TemporaryWriterSecretFile {
  readonly schemaVersion: "venviewer.grand-hall-r2-temporary-writer.v1";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
  readonly ttlSeconds: number;
  readonly restriction: {
    readonly bucket: string;
    readonly scope: "object-read-write";
    readonly actions: readonly ["PutObject"];
    readonly prefixPaths: readonly [typeof GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX];
  };
  readonly railwayVariables: {
    readonly RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: string;
    readonly RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: string;
    readonly RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: string;
  };
}

export interface GrandHallR2TemporaryWriterSecretOutputDependencies {
  readonly platform?: NodeJS.Platform;
  readonly protectWindowsCredential?: (
    outputPath: string,
    plaintext: Buffer,
  ) => Promise<void>;
}

export interface GrandHallR2TemporaryWriterExternalOutputDependencies {
  readonly scriptFilePath?: string;
  readonly resolveRealPath?: (path: string) => Promise<string>;
  readonly executeGit?: (args: readonly string[]) => Promise<string>;
  readonly discoverContainingGitRoot?: (directory: string) => Promise<string | null>;
}

function mintError(message: string): GrandHallR2TemporaryWriterMintError {
  return new GrandHallR2TemporaryWriterMintError(message);
}

function strictFlagValues(
  argv: readonly string[],
): ReadonlyMap<"--out" | "--ttl-seconds", string> {
  const allowedFlags = new Set(["--out", "--ttl-seconds"]);
  const values = new Map<"--out" | "--ttl-seconds", string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) {
      throw mintError("Unexpected positional argument.");
    }
    if (!allowedFlags.has(argument)) {
      throw mintError(argument === "--secret" ? "Unknown argument: --secret" : "Unknown argument.");
    }
    const flag = argument as "--out" | "--ttl-seconds";
    if (values.has(flag)) {
      throw mintError(`${flag} may be supplied only once.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw mintError(`${flag} requires a value.`);
    }
    values.set(flag, value);
    index += 1;
  }
  return values;
}

function parseTtlSeconds(rawValue: string | undefined): number {
  if (rawValue === undefined) return GRAND_HALL_R2_TEMPORARY_WRITER_DEFAULT_TTL_SECONDS;
  if (!/^[0-9]+$/u.test(rawValue)) {
    throw mintError("--ttl-seconds must be a canonical integer.");
  }
  const ttlSeconds = Number(rawValue);
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < GRAND_HALL_R2_TEMPORARY_WRITER_MIN_TTL_SECONDS ||
    ttlSeconds > GRAND_HALL_R2_TEMPORARY_WRITER_MAX_TTL_SECONDS
  ) {
    throw mintError(
      `--ttl-seconds must be between ${String(GRAND_HALL_R2_TEMPORARY_WRITER_MIN_TTL_SECONDS)} and ` +
      `${String(GRAND_HALL_R2_TEMPORARY_WRITER_MAX_TTL_SECONDS)}.`,
    );
  }
  return ttlSeconds;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function pathIsWithinOrEqual(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot.length === 0 || (
    !isAbsolute(pathFromRoot) &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`)
  );
}

async function runGitCommand(args: readonly string[]): Promise<string> {
  try {
    const result = await execFile("git", [...args], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: safeGitChildEnvironment(process.env),
      windowsHide: true,
      timeout: GIT_COMMAND_DEADLINE_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    });
    return String(result.stdout).trim();
  } catch {
    throw mintError("Credential output Git boundary could not be established locally.");
  }
}

async function hasGitMarkerAtOrAbove(directory: string): Promise<boolean> {
  try {
    await lstat(join(directory, ".git"));
    return true;
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "ENOENT") && !isNodeErrorCode(error, "ENOTDIR")) {
      throw mintError(
        "Credential output Git boundary is indeterminate; refusing local output.",
      );
    }
  }
  const parent = dirname(directory);
  return parent === directory ? false : hasGitMarkerAtOrAbove(parent);
}

async function discoverContainingGitRoot(directory: string): Promise<string | null> {
  try {
    return await runGitCommand(["-C", directory, "rev-parse", "--show-toplevel"]);
  } catch {
    if (await hasGitMarkerAtOrAbove(resolve(directory))) {
      throw mintError(
        "Credential output Git boundary is indeterminate; refusing local output.",
      );
    }
    return null;
  }
}

export async function assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree(
  outPath: string,
  dependencies: GrandHallR2TemporaryWriterExternalOutputDependencies = {},
): Promise<string> {
  const resolveRealPath = dependencies.resolveRealPath ?? realpath;
  const executeGit = dependencies.executeGit ?? runGitCommand;
  const discoverDestinationGitRoot = dependencies.discoverContainingGitRoot ??
    discoverContainingGitRoot;
  let scriptFilePath: string;
  let repositoryRoot: string;
  let outputParent: string;
  try {
    scriptFilePath = await resolveRealPath(
      dependencies.scriptFilePath ?? fileURLToPath(import.meta.url),
    );
    const discoveredRoot = await executeGit([
      "-C",
      dirname(scriptFilePath),
      "rev-parse",
      "--show-toplevel",
    ]);
    repositoryRoot = await resolveRealPath(discoveredRoot);
    outputParent = await resolveRealPath(dirname(outPath));
  } catch (error: unknown) {
    if (error instanceof GrandHallR2TemporaryWriterMintError) throw error;
    throw mintError("Credential output external location could not be proven safely.");
  }

  if (!pathIsWithinOrEqual(repositoryRoot, scriptFilePath)) {
    throw mintError("Credential mint helper is not inside its discovered Git worktree.");
  }
  const destination = resolve(outputParent, basename(outPath));
  if (pathIsWithinOrEqual(repositoryRoot, destination)) {
    throw mintError("Credential --out must resolve outside the executing Git worktree.");
  }
  let containingGitRoot: string | null;
  try {
    containingGitRoot = await discoverDestinationGitRoot(outputParent);
  } catch (error: unknown) {
    if (error instanceof GrandHallR2TemporaryWriterMintError) throw error;
    throw mintError("Credential output Git boundary could not be established safely.");
  }
  if (containingGitRoot !== null) {
    throw mintError("Credential --out must resolve outside every Git worktree.");
  }
  return destination;
}

export function parseGrandHallR2TemporaryWriterArgs(
  argv: readonly string[],
): GrandHallR2TemporaryWriterCliOptions {
  const values = strictFlagValues(argv);
  const outPath = values.get("--out");
  if (outPath === undefined) throw mintError("--out is required.");
  if (outPath.trim() !== outPath || containsControlCharacter(outPath)) {
    throw mintError("--out must not contain surrounding whitespace or control characters.");
  }
  if (!isAbsolute(outPath)) throw mintError("--out must be an absolute path.");
  return {
    outPath: resolve(outPath),
    ttlSeconds: parseTtlSeconds(values.get("--ttl-seconds")),
  };
}

function requiredEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw mintError(`${name} is required in the process environment.`);
  }
  if (value.trim() !== value || containsControlCharacter(value)) {
    throw mintError(`${name} must not contain surrounding whitespace or control characters.`);
  }
  return value;
}

export function readGrandHallR2TemporaryWriterParent(
  env: Readonly<Record<string, string | undefined>>,
): GrandHallR2TemporaryWriterParent {
  const accountId = requiredEnvironmentValue(env, GRAND_HALL_R2_TEMPORARY_WRITER_ENV.accountId);
  const bucket = requiredEnvironmentValue(env, GRAND_HALL_R2_TEMPORARY_WRITER_ENV.bucket);
  const accessKeyId = requiredEnvironmentValue(env, GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentAccessKeyId);
  const secretAccessKey = requiredEnvironmentValue(env, GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey);

  if (!/^[a-f0-9]{32}$/u.test(accountId)) {
    throw mintError(`${GRAND_HALL_R2_TEMPORARY_WRITER_ENV.accountId} must be a lowercase 32-digit hexadecimal account ID.`);
  }
  if (bucket !== GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET) {
    throw mintError(
      `${GRAND_HALL_R2_TEMPORARY_WRITER_ENV.bucket} must be exactly ${GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET}.`,
    );
  }
  if (!/^[A-Za-z0-9]{16,128}$/u.test(accessKeyId)) {
    throw mintError(`${GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentAccessKeyId} has an invalid access-key ID shape.`);
  }
  if (Buffer.byteLength(secretAccessKey, "utf8") < MIN_PARENT_SECRET_BYTES) {
    throw mintError(`${GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey} must contain at least ${String(MIN_PARENT_SECRET_BYTES)} bytes.`);
  }

  return { accountId, bucket, accessKeyId, secretAccessKey };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function mintGrandHallR2TemporaryWriter(
  parent: GrandHallR2TemporaryWriterParent,
  issuedAtEpochSeconds: number,
  ttlSeconds: number,
): GrandHallR2TemporaryWriterSecretFile {
  rejectRetiredGrandHallV1Intake();
  if (!Number.isSafeInteger(issuedAtEpochSeconds) || issuedAtEpochSeconds < 0) {
    throw mintError("Issued-at time must be a non-negative integer number of epoch seconds.");
  }
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < GRAND_HALL_R2_TEMPORARY_WRITER_MIN_TTL_SECONDS ||
    ttlSeconds > GRAND_HALL_R2_TEMPORARY_WRITER_MAX_TTL_SECONDS
  ) {
    throw mintError("Temporary-writer TTL is outside the permitted range.");
  }

  const expiresAtEpochSeconds = issuedAtEpochSeconds + ttlSeconds;
  if (!Number.isSafeInteger(expiresAtEpochSeconds)) {
    throw mintError("Temporary-writer expiry is outside the supported range.");
  }
  const issuedAt = new Date(issuedAtEpochSeconds * 1_000);
  const expiresAt = new Date(expiresAtEpochSeconds * 1_000);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    throw mintError("Temporary-writer timestamps are outside the supported date range.");
  }
  const claims: GrandHallR2TemporaryWriterClaims = {
    sub: parent.accountId,
    iss: parent.accessKeyId,
    aud: `${parent.accountId}.r2.cloudflarestorage.com`,
    iat: issuedAtEpochSeconds,
    exp: expiresAtEpochSeconds,
    bucket: parent.bucket,
    scope: "object-read-write",
    actions: ["PutObject"],
    paths: {
      prefixPaths: [GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX],
    },
  };
  const encodedHeader = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const encodedClaims = base64UrlJson(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", parent.secretAccessKey)
    .update(signingInput, "utf8")
    .digest("base64url");
  const signedJwt = `${signingInput}.${signature}`;
  const temporarySecret = createHash("sha256").update(signedJwt, "utf8").digest("hex");
  const sessionToken = Buffer.from(`jwt/${signedJwt}`, "utf8").toString("base64");

  return {
    schemaVersion: "venviewer.grand-hall-r2-temporary-writer.v1",
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
    ttlSeconds,
    restriction: {
      bucket: parent.bucket,
      scope: "object-read-write",
      actions: ["PutObject"],
      prefixPaths: [GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX],
    },
    railwayVariables: {
      RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: parent.accessKeyId,
      RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: temporarySecret,
      RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: sessionToken,
    },
  };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw mintError("Temporary credential output cleanup failed safely.");
    }
  }
}

export function assertGrandHallR2OwnerOnlyMode(input: {
  readonly isFile: boolean;
  readonly mode: number;
  readonly ownerUserId: number;
  readonly effectiveUserId: number | undefined;
}): void {
  if (
    !input.isFile ||
    input.effectiveUserId === undefined ||
    input.ownerUserId !== input.effectiveUserId ||
    (input.mode & 0o777) !== 0o600
  ) {
    throw mintError(
      "Credential output filesystem did not enforce current-user-only mode 0600.",
    );
  }
}

async function writePosixCredentialFile(
  temporary: string,
  serializedCredential: Buffer,
): Promise<void> {
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    const beforeWrite = await handle.stat();
    assertGrandHallR2OwnerOnlyMode({
      isFile: beforeWrite.isFile(),
      mode: beforeWrite.mode,
      ownerUserId: beforeWrite.uid,
      effectiveUserId: process.geteuid?.(),
    });
    await handle.writeFile(serializedCredential);
    await handle.sync();
    const afterWrite = await handle.stat();
    assertGrandHallR2OwnerOnlyMode({
      isFile: afterWrite.isFile(),
      mode: afterWrite.mode,
      ownerUserId: afterWrite.uid,
      effectiveUserId: process.geteuid?.(),
    });
  } finally {
    await handle.close();
  }
}

export async function writeGrandHallR2TemporaryWriterSecretFileAtomic(
  outPath: string,
  credential: GrandHallR2TemporaryWriterSecretFile,
  dependencies: GrandHallR2TemporaryWriterSecretOutputDependencies = {},
): Promise<void> {
  rejectRetiredGrandHallV1Intake();
  if (!isAbsolute(outPath)) throw mintError("Credential output path must be absolute.");
  const destination = resolve(outPath);
  const temporary = resolve(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  const platform = dependencies.platform ?? process.platform;
  const serializedCredential = Buffer.from(
    `${JSON.stringify(credential, null, 2)}\n`,
    "utf8",
  );
  let operationError: GrandHallR2TemporaryWriterMintError | null = null;
  try {
    if (platform === "win32") {
      const protectWindowsCredential = dependencies.protectWindowsCredential ??
        protectGrandHallR2CredentialWithCurrentUserDpapi;
      await protectWindowsCredential(temporary, serializedCredential);
    } else {
      await writePosixCredentialFile(temporary, serializedCredential);
    }
    try {
      await link(temporary, destination);
    } catch (error: unknown) {
      if (isNodeErrorCode(error, "EEXIST")) {
        throw mintError("Credential output already exists; refusing overwrite.");
      }
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof GrandHallR2TemporaryWriterMintError) {
      operationError = error;
    } else if (error instanceof GrandHallR2DpapiError) {
      operationError = mintError(error.message);
    } else {
      operationError = mintError("Credential output could not be created safely.");
    }
  } finally {
    serializedCredential.fill(0);
  }
  let cleanupError: GrandHallR2TemporaryWriterMintError | null = null;
  try {
    await removeTemporaryFile(temporary);
  } catch (error: unknown) {
    cleanupError = error instanceof GrandHallR2TemporaryWriterMintError
      ? error
      : mintError("Temporary credential output cleanup failed safely.");
  }
  if (operationError !== null) throw operationError;
  if (cleanupError !== null) throw cleanupError;
}

export async function runGrandHallR2TemporaryWriterMint(input: {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
  readonly assertExternalOutput?: (outPath: string) => Promise<string>;
}): Promise<void> {
  // Fail before parsing paths or reading parent credentials. This v1 prefix
  // targets the over-broad source frontier and must never regain PutObject.
  rejectRetiredGrandHallV1Intake();
  const options = parseGrandHallR2TemporaryWriterArgs(input.argv);
  const assertExternalOutput = input.assertExternalOutput ??
    assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree;
  const canonicalOutPath = await assertExternalOutput(options.outPath);
  const parent = readGrandHallR2TemporaryWriterParent(input.env);
  const now = input.now ?? new Date();
  const issuedAtEpochSeconds = Math.floor(now.getTime() / 1_000);
  const credential = mintGrandHallR2TemporaryWriter(
    parent,
    issuedAtEpochSeconds,
    options.ttlSeconds,
  );
  await writeGrandHallR2TemporaryWriterSecretFileAtomic(canonicalOutPath, credential);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  runGrandHallR2TemporaryWriterMint({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch((error: unknown) => {
    const message = error instanceof GrandHallR2TemporaryWriterMintError
      ? error.message
      : "Grand Hall R2 temporary-writer mint failed safely.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
