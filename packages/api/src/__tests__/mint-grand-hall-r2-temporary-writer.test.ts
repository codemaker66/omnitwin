import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  GRAND_HALL_V1_INTAKE_RETIRED_CODE,
  GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE,
  GrandHallV1IntakeRetiredError,
} from "../scripts/grand-hall-v1-intake-retired.js";
import {
  protectGrandHallR2CredentialWithCurrentUserDpapi,
  stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi,
} from "../scripts/grand-hall-r2-credential-dpapi.js";
import {
  mintGrandHallR2TemporaryWriter,
  runGrandHallR2TemporaryWriterMint,
  writeGrandHallR2TemporaryWriterSecretFileAtomic,
  type GrandHallR2TemporaryWriterParent,
  type GrandHallR2TemporaryWriterSecretFile,
} from "../scripts/mint-grand-hall-r2-temporary-writer.js";
import { runGrandHallR2RailwayStage } from "../scripts/stage-grand-hall-r2-temporary-writer-in-railway.js";

const parent: GrandHallR2TemporaryWriterParent = {
  accountId: "a".repeat(32),
  bucket: "trades-hall-grand-hall-staging",
  accessKeyId: "A".repeat(32),
  secretAccessKey: "s".repeat(64),
};

const retiredCredentialShape = {
  schemaVersion: "venviewer.grand-hall-r2-temporary-writer.v1",
  issuedAt: "2026-08-25T00:00:00.000Z",
  expiresAt: "2026-08-25T01:00:00.000Z",
  issuedAtEpochSeconds: 1_787_606_400,
  expiresAtEpochSeconds: 1_787_610_000,
  ttlSeconds: 3_600,
  restriction: {
    bucket: "trades-hall-grand-hall-staging",
    scope: "object-read-write",
    actions: ["PutObject"],
    prefixPaths: ["venues/trades-hall/rooms/grand-hall/xgrids/grand-hall-big-model-sog-fine-v1/"],
  },
  railwayVariables: {
    RUNTIME_PROFILE_INTAKE_R2_ACCESS_KEY_ID: "retired",
    RUNTIME_PROFILE_INTAKE_R2_SECRET_ACCESS_KEY: "retired",
    RUNTIME_PROFILE_INTAKE_R2_SESSION_TOKEN: "retired",
  },
} as const satisfies GrandHallR2TemporaryWriterSecretFile;

function expectRetired(error: unknown): void {
  expect(error).toBeInstanceOf(GrandHallV1IntakeRetiredError);
  expect(error).toMatchObject({
    code: GRAND_HALL_V1_INTAKE_RETIRED_CODE,
    message: GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE,
  });
}

describe("retired Grand Hall v1 writer capability", () => {
  it("cannot mint a credential even through the former pure helper", () => {
    try {
      mintGrandHallR2TemporaryWriter(parent, 1_787_606_400, 3_600);
      throw new Error("Expected retired mint to fail.");
    } catch (error: unknown) {
      expectRetired(error);
    }
  });

  it("fails the mint runner before path validation or parent environment access", async () => {
    const assertExternalOutput = vi.fn<() => Promise<string>>();
    await expect(runGrandHallR2TemporaryWriterMint({
      argv: ["--out", "not-an-absolute-path"],
      env: new Proxy({}, {
        get: () => { throw new Error("environment must not be read"); },
      }),
      assertExternalOutput,
    })).rejects.toSatisfy((error: unknown) => {
      expectRetired(error);
      return true;
    });
    expect(assertExternalOutput).not.toHaveBeenCalled();
  });

  it("cannot write or DPAPI-protect a retired credential", async () => {
    await expect(writeGrandHallR2TemporaryWriterSecretFileAtomic(
      "not-an-absolute-path",
      retiredCredentialShape,
    )).rejects.toSatisfy((error: unknown) => {
      expectRetired(error);
      return true;
    });
    await expect(protectGrandHallR2CredentialWithCurrentUserDpapi(
      "not-an-absolute-path",
      Buffer.from("secret"),
    )).rejects.toSatisfy((error: unknown) => {
      expectRetired(error);
      return true;
    });
  });

  it("cannot inspect, decrypt, or stage a retired Railway handoff", async () => {
    const inspectTarget = vi.fn();
    const stageCredential = vi.fn();
    await expect(runGrandHallR2RailwayStage({
      argv: [],
      dependencies: { inspectTarget, stageCredential },
    })).rejects.toSatisfy((error: unknown) => {
      expectRetired(error);
      return true;
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(stageCredential).not.toHaveBeenCalled();

    await expect(stageGrandHallR2CredentialInRailwayWithCurrentUserDpapi(
      "not-an-absolute-path",
      "not-an-absolute-path",
      { projectId: "x", environmentId: "y", serviceId: "z" },
    )).rejects.toSatisfy((error: unknown) => {
      expectRetired(error);
      return true;
    });
  });

  it("keeps the standalone PowerShell handoff unconditionally unreachable", async () => {
    const scriptPath = fileURLToPath(new URL(
      "../scripts/grand-hall-r2-dpapi-railway-handoff.ps1",
      import.meta.url,
    ));
    const source = await readFile(scriptPath, "utf8");
    const retirement = source.indexOf("GRAND_HALL_V1_INTAKE_RETIRED");
    const firstEnvironmentRead = source.indexOf("GetEnvironmentVariable");
    expect(retirement).toBeGreaterThanOrEqual(0);
    expect(firstEnvironmentRead).toBeGreaterThan(retirement);
    expect(source.slice(retirement, firstEnvironmentRead)).toContain("exit 64");
  });
});
