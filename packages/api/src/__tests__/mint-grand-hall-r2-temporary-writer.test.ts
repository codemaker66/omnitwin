import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER,
  GRAND_HALL_R2_RAILWAY_FIELDS,
  grandHallDpapiChildProcessBoundary,
  protectGrandHallR2CredentialWithCurrentUserDpapi,
  stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi,
} from "../scripts/grand-hall-r2-credential-dpapi.js";
import {
  GRAND_HALL_R2_TEMPORARY_WRITER_DEFAULT_TTL_SECONDS,
  GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET,
  GRAND_HALL_R2_TEMPORARY_WRITER_ENV,
  GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX,
  assertGrandHallR2OwnerOnlyMode,
  assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree,
  mintGrandHallR2TemporaryWriter,
  parseGrandHallR2TemporaryWriterArgs,
  readGrandHallR2TemporaryWriterParent,
  runGrandHallR2TemporaryWriterMint,
  writeGrandHallR2TemporaryWriterSecretFileAtomic,
  type GrandHallR2TemporaryWriterParent,
} from "../scripts/mint-grand-hall-r2-temporary-writer.js";
import { safeGitChildEnvironment } from "../scripts/safe-git-child-environment.js";
import {
  GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
  GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
} from "../scripts/grand-hall-railway-cli-contract.js";
import {
  assertGrandHallReviewedRailwayCli,
  assertGrandHallReviewedRailwayCliIdentity,
  assertGrandHallR2RailwayStatusMatchesTarget,
  inspectGrandHallR2RailwayTarget,
  parseGrandHallR2RailwayStageArgs,
  runGrandHallR2RailwayStage,
  safeRailwayCliEnvironment,
} from "../scripts/stage-grand-hall-r2-temporary-writer-in-railway.js";

const ACCOUNT_ID = "a".repeat(32);
const BUCKET = GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET;
const PARENT_ACCESS_KEY_ID = "A".repeat(32);
const PARENT_SECRET_ACCESS_KEY = "s".repeat(64);
const ISSUED_AT = 1_787_577_600;
const TTL_SECONDS = 3_600;
const RAILWAY_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RAILWAY_ENVIRONMENT_ID = "22222222-2222-4222-8222-222222222222";
const RAILWAY_SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const REVIEWED_RAILWAY_CLI_PATH = process.env["APPDATA"] === undefined
  ? ""
  : join(
      process.env["APPDATA"],
      "npm",
      "node_modules",
      "@railway",
      "cli",
      "bin",
      "railway.exe",
    );
const REVIEWED_RAILWAY_CLI_AVAILABLE = process.platform === "win32" &&
  REVIEWED_RAILWAY_CLI_PATH.length > 0 &&
  existsSync(REVIEWED_RAILWAY_CLI_PATH) &&
  createHash("sha256")
    .update(readFileSync(REVIEWED_RAILWAY_CLI_PATH))
    .digest("hex") === GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256;

const parent: GrandHallR2TemporaryWriterParent = {
  accountId: ACCOUNT_ID,
  bucket: BUCKET,
  accessKeyId: PARENT_ACCESS_KEY_ID,
  secretAccessKey: PARENT_SECRET_ACCESS_KEY,
};

const env = {
  [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.accountId]: ACCOUNT_ID,
  [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.bucket]: BUCKET,
  [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentAccessKeyId]: PARENT_ACCESS_KEY_ID,
  [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey]: PARENT_SECRET_ACCESS_KEY,
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "venviewer-r2-writer-"));
  temporaryDirectories.push(path);
  return path;
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
}

function railwayTarget() {
  return {
    projectId: RAILWAY_PROJECT_ID,
    environmentId: RAILWAY_ENVIRONMENT_ID,
    serviceId: RAILWAY_SERVICE_ID,
  } as const;
}

function matchingRailwayStatus(): unknown {
  return {
    id: RAILWAY_PROJECT_ID,
    name: BUCKET,
    environments: {
      edges: [{
        node: {
          id: RAILWAY_ENVIRONMENT_ID,
          name: BUCKET,
        },
      }],
    },
    services: {
      edges: [{
        node: {
          id: RAILWAY_SERVICE_ID,
          name: BUCKET,
        },
      }],
    },
  };
}

function railwayStageArgv(inputPath: string, executable: string): readonly string[] {
  return [
    "--in",
    inputPath,
    "--railway-executable",
    executable,
    "--project-id",
    RAILWAY_PROJECT_ID,
    "--environment-id",
    RAILWAY_ENVIRONMENT_ID,
    "--service-id",
    RAILWAY_SERVICE_ID,
    "--confirm-target",
    BUCKET,
  ];
}

describe("Grand Hall R2 temporary-writer argument and environment validation", () => {
  it("requires one absolute output path and defaults to the maximum one-hour TTL", () => {
    const output = resolve("CREDENTIAL.json");
    expect(parseGrandHallR2TemporaryWriterArgs(["--out", output])).toEqual({
      outPath: output,
      ttlSeconds: GRAND_HALL_R2_TEMPORARY_WRITER_DEFAULT_TTL_SECONDS,
    });
    expect(() => parseGrandHallR2TemporaryWriterArgs(["--out", "relative.json"]))
      .toThrow("--out must be an absolute path");
    expect(() => parseGrandHallR2TemporaryWriterArgs(["--out", `${output}\nsecret`]))
      .toThrow("control characters");
    expect(() => parseGrandHallR2TemporaryWriterArgs(["--out", output, "--out", output]))
      .toThrow("--out may be supplied only once");
  });

  it("enforces the 900-3600 second canonical-integer TTL boundary", () => {
    const output = resolve("CREDENTIAL.json");
    expect(parseGrandHallR2TemporaryWriterArgs(["--out", output, "--ttl-seconds", "900"]).ttlSeconds).toBe(900);
    expect(parseGrandHallR2TemporaryWriterArgs(["--out", output, "--ttl-seconds", "3600"]).ttlSeconds).toBe(3_600);
    for (const invalid of ["899", "3601", "900.0", " 900", "+900"]) {
      expect(() => parseGrandHallR2TemporaryWriterArgs(["--out", output, "--ttl-seconds", invalid])).toThrow();
    }
  });

  it("rejects command-line or positional secret material without echoing it", () => {
    const secret = "command-line-parent-secret-that-must-not-leak";
    expect(() => parseGrandHallR2TemporaryWriterArgs(["--secret", secret]))
      .toThrow("Unknown argument: --secret");
    try {
      parseGrandHallR2TemporaryWriterArgs(["--out", resolve("CREDENTIAL.json"), secret]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
    }
  });

  it("reads the dedicated parent values only from the process environment", () => {
    expect(readGrandHallR2TemporaryWriterParent(env)).toEqual(parent);
    for (const name of Object.values(GRAND_HALL_R2_TEMPORARY_WRITER_ENV)) {
      const incomplete = { ...env, [name]: undefined };
      expect(() => readGrandHallR2TemporaryWriterParent(incomplete)).toThrow(`${name} is required`);
    }
  });

  it("rejects malformed identities and never leaks the parent secret", () => {
    expect(() => readGrandHallR2TemporaryWriterParent({
      ...env,
      [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.accountId]: "not-an-account",
    })).toThrow("lowercase 32-digit hexadecimal");
    expect(() => readGrandHallR2TemporaryWriterParent({
      ...env,
      [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.bucket]: "Invalid_Bucket",
    })).toThrow(`must be exactly ${GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET}`);
    expect(() => readGrandHallR2TemporaryWriterParent({
      ...env,
      [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.bucket]: "another-valid-staging-bucket",
    })).toThrow(`must be exactly ${GRAND_HALL_R2_TEMPORARY_WRITER_BUCKET}`);

    const weakSecret = "weak-parent-secret";
    try {
      readGrandHallR2TemporaryWriterParent({
        ...env,
        [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey]: weakSecret,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(weakSecret);
    }
  });
});

describe("Grand Hall R2 temporary-writer cryptographic contract", () => {
  it("mints the exact HS256 claims, signature, secret derivation, and session token", () => {
    const credential = mintGrandHallR2TemporaryWriter(parent, ISSUED_AT, TTL_SECONDS);
    const sessionPayload = Buffer.from(
      credential.railwayVariables.RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN,
      "base64",
    ).toString("utf8");
    expect(sessionPayload.startsWith("jwt/")).toBe(true);
    const jwt = sessionPayload.slice("jwt/".length);
    const segments = jwt.split(".");
    expect(segments).toHaveLength(3);
    const [headerSegment, claimsSegment, signatureSegment] = segments;
    expect(headerSegment).toBeDefined();
    expect(claimsSegment).toBeDefined();
    expect(signatureSegment).toBeDefined();
    if (headerSegment === undefined || claimsSegment === undefined || signatureSegment === undefined) {
      throw new Error("Expected a three-segment JWT");
    }

    expect(decodeJsonSegment(headerSegment)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodeJsonSegment(claimsSegment)).toEqual({
      sub: ACCOUNT_ID,
      iss: PARENT_ACCESS_KEY_ID,
      aud: `${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      iat: ISSUED_AT,
      exp: ISSUED_AT + TTL_SECONDS,
      bucket: BUCKET,
      scope: "object-read-write",
      actions: ["PutObject"],
      paths: { prefixPaths: [GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX] },
    });
    const signingInput = `${headerSegment}.${claimsSegment}`;
    expect(signatureSegment).toBe(
      createHmac("sha256", PARENT_SECRET_ACCESS_KEY).update(signingInput, "utf8").digest("base64url"),
    );
    expect(credential.railwayVariables).toEqual({
      RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: PARENT_ACCESS_KEY_ID,
      RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: createHash("sha256").update(jwt, "utf8").digest("hex"),
      RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: Buffer.from(`jwt/${jwt}`, "utf8").toString("base64"),
    });
  });

  it("keeps scope, action, and prefix fixed rather than accepting configuration", () => {
    const credential = mintGrandHallR2TemporaryWriter(parent, ISSUED_AT, 900);
    expect(credential.restriction).toEqual({
      bucket: BUCKET,
      scope: "object-read-write",
      actions: ["PutObject"],
      prefixPaths: [GRAND_HALL_R2_TEMPORARY_WRITER_PREFIX],
    });
    expect(credential.issuedAtEpochSeconds).toBe(ISSUED_AT);
    expect(credential.expiresAtEpochSeconds).toBe(ISSUED_AT + 900);
    expect(credential.ttlSeconds).toBe(900);
  });

  it("rejects epoch seconds outside JavaScript's supported date range", () => {
    expect(() => mintGrandHallR2TemporaryWriter(
      parent,
      Number.MAX_SAFE_INTEGER - TTL_SECONDS,
      TTL_SECONDS,
    )).toThrow("outside the supported date range");
  });
});

describe("Grand Hall R2 temporary-writer secret output", () => {
  it("requires --out to resolve outside the executing Git worktree", async () => {
    const externalDirectory = await temporaryDirectory();
    await expect(assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree(
      join(externalDirectory, "credential.dpapi"),
    )).resolves.toBe(join(externalDirectory, "credential.dpapi"));
    await expect(assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree(
      resolve("credential.dpapi"),
    )).rejects.toThrow("must resolve outside the executing Git worktree");
  });

  it("rejects output inside a different Git worktree", async () => {
    const externalDirectory = await temporaryDirectory();
    await expect(assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree(
      join(externalDirectory, "credential.dpapi"),
      {
        discoverContainingGitRoot: () => Promise.resolve(externalDirectory),
      },
    )).rejects.toThrow("outside every Git worktree");
  });

  it("fails closed when destination Git membership is indeterminate", async () => {
    const externalDirectory = await temporaryDirectory();
    await expect(assertGrandHallR2TemporaryWriterOutputOutsideGitWorktree(
      join(externalDirectory, "credential.dpapi"),
      {
        discoverContainingGitRoot: () => Promise.reject(new Error("private Git diagnostic")),
      },
    )).rejects.toThrow("Git boundary could not be established safely");
  });

  it("writes only to the canonical destination returned by the boundary proof", async () => {
    const directory = await temporaryDirectory();
    const requested = join(directory, "requested.secret");
    const canonical = join(directory, "canonical.secret");
    await runGrandHallR2TemporaryWriterMint({
      argv: ["--out", requested],
      env,
      now: new Date(ISSUED_AT * 1_000),
      assertExternalOutput: () => Promise.resolve(canonical),
    });
    await expect(readFile(canonical)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(requested)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not pass credential-bearing environment values to Git children", () => {
    const child = safeGitChildEnvironment({
      PATH: "safe-path",
      SystemRoot: "C:\\Windows",
      [GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey]:
        PARENT_SECRET_ACCESS_KEY,
      RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN: "admin-token",
      DATABASE_URL: "postgresql://private",
    }, "win32");
    expect(child).toMatchObject({
      PATH: "safe-path",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      SystemRoot: "C:\\Windows",
      SystemDrive: "C:",
      ProgramData: "C:\\ProgramData",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "NUL",
    });
    expect(child).not.toHaveProperty(
      GRAND_HALL_R2_TEMPORARY_WRITER_ENV.parentSecretAccessKey,
    );
    expect(child).not.toHaveProperty("RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN");
    expect(child).not.toHaveProperty("DATABASE_URL");
  });

  it("runs the DPAPI child from external temp with canonical Windows locations", () => {
    const boundary = grandHallDpapiChildProcessBoundary({
      SystemRoot: "C:\\Windows",
      SystemDrive: "C:",
      ProgramData: "C:\\ProgramData",
      USERPROFILE: "C:\\Users\\operator",
      DATABASE_URL: "postgresql://private",
    }, { VENVIEWER_TEST_HELPER: "allowed" });
    expect(boundary.cwd).toBe(tmpdir());
    expect(boundary.env).toMatchObject({
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      SystemDrive: "C:",
      ProgramData: "C:\\ProgramData",
      TEMP: tmpdir(),
      TMP: tmpdir(),
      USERPROFILE: "C:\\Users\\operator",
      VENVIEWER_TEST_HELPER: "allowed",
    });
    expect(boundary.env).not.toHaveProperty("DATABASE_URL");
  });

  it("creates atomically with no overwrite and platform-required confidentiality", async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, "credential.secret");
    const credential = mintGrandHallR2TemporaryWriter(parent, ISSUED_AT, TTL_SECONDS);

    await writeGrandHallR2TemporaryWriterSecretFileAtomic(output, credential);
    const original = await readFile(output);
    if (process.platform === "win32") {
      const header = Buffer.from(GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER, "ascii");
      expect(original.subarray(0, header.length)).toEqual(header);
      expect(original.subarray(header.length).length).toBeGreaterThan(0);
      expect(original.includes(Buffer.from(JSON.stringify(credential), "utf8"))).toBe(false);
      for (const secret of Object.values(credential.railwayVariables)) {
        expect(original.includes(Buffer.from(secret, "utf8"))).toBe(false);
      }
    } else {
      expect(JSON.parse(original.toString("utf8")) as unknown).toEqual(credential);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
    }
    await expect(writeGrandHallR2TemporaryWriterSecretFileAtomic(output, {
      ...credential,
      ttlSeconds: 900,
    })).rejects.toThrow("already exists; refusing overwrite");
    expect(await readFile(output)).toEqual(original);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("fails closed when current-user-only POSIX ownership or mode is not proven", () => {
    expect(() => {
      assertGrandHallR2OwnerOnlyMode({
        isFile: true,
        mode: 0o100600,
        ownerUserId: 1_000,
        effectiveUserId: 1_000,
      });
    }).not.toThrow();
    for (const unsafe of [
      { isFile: false, mode: 0o100600, ownerUserId: 1_000, effectiveUserId: 1_000 },
      { isFile: true, mode: 0o100640, ownerUserId: 1_000, effectiveUserId: 1_000 },
      { isFile: true, mode: 0o100600, ownerUserId: 2_000, effectiveUserId: 1_000 },
      { isFile: true, mode: 0o100600, ownerUserId: 1_000, effectiveUserId: undefined },
    ] as const) {
      expect(() => {
        assertGrandHallR2OwnerOnlyMode(unsafe);
      }).toThrow(
        "did not enforce current-user-only mode 0600",
      );
    }
  });

  it("passes plaintext only to the selected Windows protector and persists only its ciphertext", async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, "credential.dpapi");
    const credential = mintGrandHallR2TemporaryWriter(parent, ISSUED_AT, TTL_SECONDS);
    const protectedPayloads: Buffer[] = [];
    const protectWindowsCredential = vi.fn(async (
      temporaryPath: string,
      plaintext: Buffer,
    ): Promise<void> => {
      protectedPayloads.push(Buffer.from(plaintext));
      await writeFile(temporaryPath, "test-dpapi-ciphertext", { flag: "wx" });
    });

    await writeGrandHallR2TemporaryWriterSecretFileAtomic(output, credential, {
      platform: "win32",
      protectWindowsCredential,
    });

    expect(protectWindowsCredential).toHaveBeenCalledOnce();
    const protectedPlaintext = protectedPayloads[0];
    if (protectedPlaintext === undefined) {
      throw new Error("Expected the Windows protector to receive one payload.");
    }
    expect(JSON.parse(protectedPlaintext.toString("utf8")) as unknown).toEqual(credential);
    expect(await readFile(output, "utf8")).toBe("test-dpapi-ciphertext");
  });

  it("runs without writing secrets to stdout, stderr, or console", async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, "credential.secret");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runGrandHallR2TemporaryWriterMint({
      argv: ["--out", output],
      env,
      now: new Date(ISSUED_AT * 1_000),
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const written = await readFile(output);
    expect(written.includes(Buffer.from(PARENT_SECRET_ACCESS_KEY, "utf8"))).toBe(false);
    if (process.platform !== "win32") {
      expect(written.toString("utf8")).toContain("RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN");
    }
  });
});

describe("Grand Hall R2 temporary-writer Railway stdin boundary", () => {
  it("pins the reviewed native Railway CLI version and SHA-256 together", () => {
    expect(() => {
      assertGrandHallReviewedRailwayCliIdentity(
        GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
        `${GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION}\n`,
      );
    }).not.toThrow();
    expect(() => {
      assertGrandHallReviewedRailwayCliIdentity(
        "0".repeat(64),
        GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
      );
    }).toThrow("reviewed version and SHA-256");
    expect(() => {
      assertGrandHallReviewedRailwayCliIdentity(
        GRAND_HALL_REVIEWED_RAILWAY_CLI_SHA256,
        "railway 5.23.3",
      );
    }).toThrow("reviewed version and SHA-256");
  });

  it("rejects an unreviewed Railway binary hash before executing it", async () => {
    const executeVersion = vi.fn(() => Promise.resolve(
      GRAND_HALL_REVIEWED_RAILWAY_CLI_VERSION,
    ));
    await expect(assertGrandHallReviewedRailwayCli(
      resolve("railway.exe"),
      {},
      {
        readExecutable: () => Promise.resolve(Buffer.from("unreviewed-binary")),
        executeVersion,
      },
    )).rejects.toThrow("reviewed version and SHA-256");
    expect(executeVersion).not.toHaveBeenCalled();
  });

  it("requires exact target selectors, the DPAPI artifact, and native Railway executable", () => {
    const input = resolve("credential.dpapi");
    const executable = resolve("railway.exe");
    expect(parseGrandHallR2RailwayStageArgs(
      railwayStageArgv(input, executable),
    )).toEqual({
      inputPath: input,
      railwayExecutable: executable,
      ...railwayTarget(),
      confirmTarget: BUCKET,
    });
    expect(() => parseGrandHallR2RailwayStageArgs(
      railwayStageArgv("relative.dpapi", executable),
    )).toThrow("--in must be an absolute path");
    expect(() => parseGrandHallR2RailwayStageArgs(
      railwayStageArgv(input, resolve("railway.ps1")),
    )).toThrow("native railway.exe");
    const wrongTarget = [...railwayStageArgv(input, executable)];
    wrongTarget[wrongTarget.length - 1] = "production";
    expect(() => parseGrandHallR2RailwayStageArgs(wrongTarget))
      .toThrow(`must be exactly ${BUCKET}`);
    const wrongId = [...railwayStageArgv(input, executable)];
    wrongId[wrongId.indexOf("--service-id") + 1] = "service-name";
    expect(() => parseGrandHallR2RailwayStageArgs(wrongId))
      .toThrow("canonical lowercase UUID");
  });

  it("does not echo rejected positional or unknown argument material", () => {
    const secret = "credential-value-that-must-not-be-echoed";
    for (const argv of [
      [...railwayStageArgv(resolve("credential.dpapi"), resolve("railway.exe")), secret],
      ["--secret", secret],
    ]) {
      try {
        parseGrandHallR2RailwayStageArgs(argv);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
      }
    }
  });

  it("accepts only the exact one-project, one-environment, one-service staging identity", () => {
    expect(() => {
      assertGrandHallR2RailwayStatusMatchesTarget(
        matchingRailwayStatus(),
        railwayTarget(),
      );
    }).not.toThrow();
    expect(() => {
      assertGrandHallR2RailwayStatusMatchesTarget({
        ...(matchingRailwayStatus() as Readonly<Record<string, unknown>>),
        id: "44444444-4444-4444-8444-444444444444",
      }, railwayTarget());
    }).toThrow("dedicated staging project");
    expect(() => {
      assertGrandHallR2RailwayStatusMatchesTarget({
        ...(matchingRailwayStatus() as Readonly<Record<string, unknown>>),
        services: {
          edges: [
            { node: { id: RAILWAY_SERVICE_ID, name: BUCKET } },
            { node: { id: "44444444-4444-4444-8444-444444444444", name: "other" } },
          ],
        },
      }, railwayTarget());
    }).toThrow("dedicated staging API service");
  });

  it("runs read-only status with exact IDs and a credential-free environment", async () => {
    const executable = resolve("railway.exe");
    const executeStatus = vi.fn(() => Promise.resolve(
      JSON.stringify(matchingRailwayStatus()),
    ));
    const status = await inspectGrandHallR2RailwayTarget(
      executable,
      railwayTarget(),
      {
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\operator",
        RAILWAY_TOKEN: "railway-token-must-not-propagate",
        RAILWAY_API_TOKEN: "railway-api-token-must-not-propagate",
        VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_SECRET_ACCESS_KEY:
          PARENT_SECRET_ACCESS_KEY,
        DATABASE_URL: "postgresql://private",
        PATH: "untrusted-wrapper-path",
      },
      executeStatus,
    );
    expect(status).toEqual(matchingRailwayStatus());
    expect(executeStatus).toHaveBeenCalledWith({
      executable,
      args: [
        "status",
        "--project",
        RAILWAY_PROJECT_ID,
        "--environment",
        RAILWAY_ENVIRONMENT_ID,
        "--json",
      ],
      cwd: tmpdir(),
      env: {
        CI: "true",
        NO_COLOR: "1",
        SystemRoot: "C:\\Windows",
        SystemDrive: "C:",
        ProgramData: "C:\\ProgramData",
        USERPROFILE: "C:\\Users\\operator",
      },
    });
  });

  it("never includes provider or intake secrets in the Railway CLI environment", () => {
    const safe = safeRailwayCliEnvironment({
      APPDATA: "C:\\Users\\operator\\AppData\\Roaming",
      RAILWAY_TOKEN: "railway-token",
      RAILWAY_API_TOKEN: "railway-api-token",
      RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: "child-token",
      VENVIEWER_GRAND_HALL_R2_WRITER_PARENT_SECRET_ACCESS_KEY:
        PARENT_SECRET_ACCESS_KEY,
      RUNTIME_PROFILE_INTAKE_ADMIN_TOKEN: "admin-token",
      DATABASE_URL: "postgresql://private",
    });
    expect(safe).toEqual({
      CI: "true",
      NO_COLOR: "1",
      APPDATA: "C:\\Users\\operator\\AppData\\Roaming",
    });
  });

  it("proves the target before invoking the in-memory DPAPI-to-stdin boundary", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "credential.dpapi");
    const executable = join(directory, "railway.exe");
    await writeFile(
      input,
      Buffer.concat([
        Buffer.from(GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER, "ascii"),
        Buffer.from("test-ciphertext", "ascii"),
      ]),
      { flag: "wx" },
    );
    await writeFile(executable, "test native executable", { flag: "wx" });
    const order: string[] = [];
    const inspectTarget = vi.fn(() => {
      order.push("inspect");
      return Promise.resolve(matchingRailwayStatus());
    });
    const stageCredential = vi.fn(() => {
      order.push("seal");
      return Promise.resolve();
    });
    const verifyRailwayExecutable = vi.fn(() => {
      order.push("verify");
      return Promise.resolve();
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runGrandHallR2RailwayStage({
      argv: railwayStageArgv(input, executable),
      dependencies: {
        platform: "win32",
        environment: { SystemRoot: "C:\\Windows" },
        verifyRailwayExecutable,
        inspectTarget,
        stageCredential,
      },
    });

    expect(order).toEqual(["verify", "inspect", "verify", "seal"]);
    expect(stageCredential).toHaveBeenCalledWith(
      input,
      executable,
      railwayTarget(),
      { SystemRoot: "C:\\Windows" },
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("fails before decryption or mutation when Railway status does not match", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "credential.dpapi");
    const executable = join(directory, "railway.exe");
    await writeFile(
      input,
      `${GRAND_HALL_R2_DPAPI_ARTIFACT_HEADER}test-ciphertext`,
      { flag: "wx" },
    );
    await writeFile(executable, "test native executable", { flag: "wx" });
    const stageCredential = vi.fn(() => Promise.resolve());
    await expect(runGrandHallR2RailwayStage({
      argv: railwayStageArgv(input, executable),
      dependencies: {
        platform: "win32",
        verifyRailwayExecutable: () => Promise.resolve(),
        inspectTarget: () => Promise.resolve({
          ...(matchingRailwayStatus() as Readonly<Record<string, unknown>>),
          name: "production",
        }),
        stageCredential,
      },
    })).rejects.toThrow("dedicated staging project");
    expect(stageCredential).not.toHaveBeenCalled();
  });

  it("fails closed outside Windows before status or credential handling", async () => {
    const inspectTarget = vi.fn(() => Promise.resolve(matchingRailwayStatus()));
    const stageCredential = vi.fn(() => Promise.resolve());
    await expect(runGrandHallR2RailwayStage({
      argv: railwayStageArgv(resolve("credential.dpapi"), resolve("railway.exe")),
      dependencies: { platform: "linux", inspectTarget, stageCredential },
    })).rejects.toThrow("available only on Windows");
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(stageCredential).not.toHaveBeenCalled();
  });

  it.skipIf(!REVIEWED_RAILWAY_CLI_AVAILABLE)(
    "round-trips CurrentUser DPAPI far enough to reject an expired payload before Railway starts",
    async () => {
      const directory = await temporaryDirectory();
      const output = join(directory, "expired.dpapi");
      const executable = REVIEWED_RAILWAY_CLI_PATH;
      const credential = mintGrandHallR2TemporaryWriter(parent, 1_700_000_000, TTL_SECONDS);
      await writeGrandHallR2TemporaryWriterSecretFileAtomic(output, credential);
      await expect(stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi(
        output,
        executable,
        railwayTarget(),
      )).rejects.toThrow("exit 62, output bytes 0");
    },
  );

  it.skipIf(!REVIEWED_RAILWAY_CLI_AVAILABLE)(
    "rejects a DPAPI-authenticated payload whose integer lifetime fields are incoherent",
    async () => {
      const directory = await temporaryDirectory();
      const output = join(directory, "incoherent.dpapi");
      const executable = REVIEWED_RAILWAY_CLI_PATH;
      const issuedAt = Math.floor(Date.now() / 1_000);
      const credential = mintGrandHallR2TemporaryWriter(parent, issuedAt, 900);
      const malformed = Buffer.from(`${JSON.stringify({
        ...credential,
        ttlSeconds: 901,
      })}\n`, "utf8");
      try {
        await protectGrandHallR2CredentialWithCurrentUserDpapi(output, malformed);
      } finally {
        malformed.fill(0);
      }

      await expect(stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi(
        output,
        executable,
        railwayTarget(),
      )).rejects.toThrow("exit 62, output bytes 0");
    },
  );

  it.skipIf(!REVIEWED_RAILWAY_CLI_AVAILABLE)(
    "rejects a DPAPI-authenticated payload whose session token is not bound to its restriction",
    async () => {
      const directory = await temporaryDirectory();
      const output = join(directory, "unbound-session.dpapi");
      const executable = REVIEWED_RAILWAY_CLI_PATH;
      const issuedAt = Math.floor(Date.now() / 1_000);
      const credential = mintGrandHallR2TemporaryWriter(parent, issuedAt, 900);
      const malformed = Buffer.from(`${JSON.stringify({
        ...credential,
        railwayVariables: {
          ...credential.railwayVariables,
          RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: "eA==",
        },
      })}\n`, "utf8");
      try {
        await protectGrandHallR2CredentialWithCurrentUserDpapi(output, malformed);
      } finally {
        malformed.fill(0);
      }

      await expect(stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi(
        output,
        executable,
        railwayTarget(),
      )).rejects.toThrow("exit 63, output bytes 0");
    },
  );

  it("keeps the R2 Railway field allowlist exact", () => {
    expect(GRAND_HALL_R2_RAILWAY_FIELDS).toEqual([
      "RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID",
      "RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY",
      "RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN",
    ]);
  });
});
