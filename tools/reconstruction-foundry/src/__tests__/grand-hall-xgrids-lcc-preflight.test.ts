import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sha256RegularFileWithHead } from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_ROOM_MEMBERSHIP_SHA256,
  GRAND_HALL_XGRIDS_LCC_PREFLIGHT_V1,
  GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
  GRAND_HALL_XGRIDS_MINIMUM_SCRATCH_FREE_BYTES,
  GrandHallXgridsPreflightError,
  createGrandHallXgridsLccPreflightReceipt,
  evaluateGrandHallXgridsPreflight,
  verifyGrandHallXgridsSource,
  type GrandHallXgridsMachineObservationV1,
  type GrandHallXgridsSourceHashFunction,
  type XgridsExpectedFileV1,
  type XgridsSourcePolicyV1,
} from "../grand-hall-xgrids-lcc-preflight.js";
import {
  formatGrandHallXgridsLccPreflightFailure,
  parseGrandHallXgridsLccPreflightArguments,
  runGrandHallXgridsLccPreflightCli,
} from "../grand-hall-xgrids-lcc-preflight-cli.js";
import {
  collectGrandHallWindowsMachineObservation,
  createGrandHallWindowsSubprocessEnvironment,
  parseNvidiaSmiObservation,
} from "../grand-hall-xgrids-lcc-windows.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function portalCamJson(): string {
  return JSON.stringify({
    DeviceInfo: {
      DeviceModel: "PortalCam",
      DeviceType: "AA",
      ScanMode: "LCC",
      CameraList: ["left_main", "left_seco", "right_main", "right_seco"],
      SoftwareVersion: "V3.2.1_20250829.122027",
      AlgorithmVersion: "v2.1.2.20250828.beta",
      TimeZone: "Europe/London",
      DeviceSN: "must-not-escape",
      ActivitionInfo: { UserName: "must-not-escape" },
    },
    ProjectInfo: {
      ScanMode: 1,
      Timestamp: 1_780_219_117_200,
      ScanTime: 4_402,
    },
  });
}

function timestampDecimal(microseconds: bigint): string {
  const seconds = microseconds / 1_000_000n;
  const fraction = (microseconds % 1_000_000n).toString().padStart(6, "0");
  return `${seconds.toString()}.${fraction}`;
}

function poseCsv(): string {
  const first = 1_780_219_119_879_549n;
  const duration = 4_285_622_582n;
  const intervals = 42_849n;
  const lines: string[] = [];
  for (let index = 0n; index <= intervals; index += 1n) {
    const timestamp = first + (duration * index) / intervals;
    lines.push(`${timestampDecimal(timestamp)},0.000000,0.000000,0.000000,1.000000,0.000000,0.000000,0.000000`);
  }
  return `${lines.join("\n")}\n`;
}

const FIXED_PATHS = [
  "2026-05-31-101837.xbin",
  "project_data/control_points.csv",
  "project_data/gnss.csv",
  "project_data/log/data.ulg",
  "project_data/log/lixel.zip",
  "project_data/log/project.json",
  "project_data/model/hierarchy.bin",
  "project_data/model/log.txt",
  "project_data/model/metadata.json",
  "project_data/model/octree.bin",
  "project_data/poses.csv",
  "project_data/preview_photo.jpg",
] as const;

interface Fixture {
  readonly root: string;
  readonly policy: XgridsSourcePolicyV1;
}

async function fixture(overrides: Readonly<Record<string, string | Buffer>> = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-xgrids-preflight-"));
  roots.push(root);
  for (const directory of ["external_data", "project_data/log", "project_data/model"]) {
    await mkdir(resolve(root, ...directory.split("/")), { recursive: true });
  }
  const contents: Record<string, string | Buffer> = {
    "2026-05-31-101837.xbin": Buffer.from("XBAGfixture"),
    "project_data/control_points.csv": "",
    "project_data/gnss.csv": "gnss",
    "project_data/log/data.ulg": "ulg",
    "project_data/log/lixel.zip": "zip",
    "project_data/log/project.json": portalCamJson(),
    "project_data/model/hierarchy.bin": "hierarchy",
    "project_data/model/log.txt": "log",
    "project_data/model/metadata.json": "{}",
    "project_data/model/octree.bin": "octree",
    "project_data/poses.csv": poseCsv(),
    "project_data/preview_photo.jpg": "jpeg",
    ...overrides,
  };
  const files: XgridsExpectedFileV1[] = [];
  for (const relativePath of FIXED_PATHS) {
    const bytes = Buffer.from(contents[relativePath] ?? "");
    const absolutePath = resolve(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
    files.push({
      relativePath,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    root,
    policy: {
      expectedDirectories: [
        "external_data",
        "project_data",
        "project_data/log",
        "project_data/model",
      ],
      expectedFiles: files,
      expectedTotalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      xbinRelativePath: "2026-05-31-101837.xbin",
      projectJsonRelativePath: "project_data/log/project.json",
      posesRelativePath: "project_data/poses.csv",
    },
  };
}

function eligibleMachine(): GrandHallXgridsMachineObservationV1 {
  return {
    platform: "win32",
    architecture: "x64",
    totalPhysicalMemoryBytes: GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
    gpu: {
      state: "observed",
      gpuCount: 1,
      name: "NVIDIA GeForce RTX 4090",
      memoryMiB: 24_564,
      driverVersion: "596.49",
      computeCapability: 8.9,
      query: "nvidia_smi_fixed_read_only_query",
    },
    scratch: {
      state: "observed",
      locator: "SCRATCH_ROOT",
      freeBytes: GRAND_HALL_XGRIDS_MINIMUM_SCRATCH_FREE_BYTES,
      fileSystem: "NTFS",
      driveType: "Fixed",
      busType: "NVMe",
      healthStatus: "Healthy",
      operationalStatus: "Online",
      diskCount: 1,
      directoryEmpty: true,
      writeAccessCheck: "passed",
      writeBenchmarkPerformed: false,
    },
    lcc: {
      state: "observed",
      locator: "LCC_INSTALL_ROOT",
      executable: {
        relativePath: "LccStudio.exe",
        sizeBytes: 123,
        sha256: `sha256:${"a".repeat(64)}`,
      },
      versionFile: {
        relativePath: "build/version.json",
        sizeBytes: 30,
        sha256: `sha256:${"b".repeat(64)}`,
      },
      reportedInternalVersion: "0.15.0.7",
      releaseCompatibilityReview: "reviewed_lcc_studio_2_3_or_newer",
      futureSettingsEvidence: {
        creatorDataEnabled: "required_not_recorded",
        nvidiaNcoreDataSelected: "required_not_recorded",
        pointCloudPreviewAccepted: "required_not_recorded",
        lccResourceEstimatorAccepted: "required_not_recorded",
        intelligentSpaceRecognitionDisabled: "required_not_recorded",
        reconstructionConfigurationReviewed: "required_not_recorded",
      },
    },
  };
}

describe("Grand Hall XGRIDS source verifier", () => {
  it("verifies one exact, linked-path-free tree and emits no source path or private identifier", async () => {
    const input = await fixture();
    const before = await stat(resolve(input.root, "project_data/log/project.json"));
    const source = await verifyGrandHallXgridsSource({
      sourceRoot: input.root,
      testOnlyPolicy: input.policy,
    });
    const after = await stat(resolve(input.root, "project_data/log/project.json"));

    expect(source.proof).toEqual({
      exactAllowlistedTree: true,
      noLinkedOrHardlinkedFiles: true,
      everyFileSizeAndSha256Matched: true,
      allFilesStableDuringRead: true,
      sourceWrites: "none",
      networkAccess: "none",
    });
    expect(source.xbin).toMatchObject({ signatureAscii: "XBAG", signatureHex: "58424147" });
    expect(source.poses).toMatchObject({
      rowCount: 42_850,
      firstTimestampMicroseconds: "1780219119879549",
      lastTimestampMicroseconds: "1780223405502131",
      durationMicroseconds: "4285622582",
    });
    const serialized = JSON.stringify(source);
    expect(serialized).not.toContain(input.root);
    expect(serialized).not.toContain("must-not-escape");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.files)).toBe(true);
  });

  it("rejects missing, extra, digest-drifted, and non-XBAG sources", async () => {
    const missing = await fixture();
    await rm(resolve(missing.root, "project_data/gnss.csv"));
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: missing.root,
      testOnlyPolicy: missing.policy,
    })).rejects.toMatchObject({ code: "SOURCE_TREE_MISMATCH" });

    const extra = await fixture();
    await writeFile(resolve(extra.root, "unexpected.txt"), "unexpected");
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: extra.root,
      testOnlyPolicy: extra.policy,
    })).rejects.toMatchObject({ code: "SOURCE_TREE_MISMATCH" });

    const drift = await fixture();
    await writeFile(resolve(drift.root, "project_data/gnss.csv"), "same-length-drift");
    const driftFile = drift.policy.expectedFiles.find((file) => file.relativePath === "project_data/gnss.csv");
    if (driftFile === undefined) throw new Error("missing fixture file");
    await writeFile(resolve(drift.root, "project_data/gnss.csv"), "x".repeat(driftFile.sizeBytes));
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: drift.root,
      testOnlyPolicy: drift.policy,
    })).rejects.toMatchObject({ code: "SOURCE_FILE_DIGEST_MISMATCH" });

    const signature = await fixture({ "2026-05-31-101837.xbin": "NOPEfixture" });
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: signature.root,
      testOnlyPolicy: signature.policy,
    })).rejects.toMatchObject({ code: "XBIN_SIGNATURE_MISMATCH" });
  });

  it("rejects a hard link and a source mutation after hashing", async () => {
    const hardlinked = await fixture();
    const original = resolve(hardlinked.root, "project_data/gnss.csv");
    const alias = resolve(hardlinked.root, "project_data/gnss-alias.csv");
    await link(original, alias);
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: hardlinked.root,
      testOnlyPolicy: hardlinked.policy,
    })).rejects.toMatchObject({ code: "SOURCE_FILE_HARDLINKED" });

    const changed = await fixture();
    let calls = 0;
    const hashFile: GrandHallXgridsSourceHashFunction = async (request) => {
      const digest = await sha256RegularFileWithHead(
        request.absolutePath,
        request.headBytes,
        request.expectedIdentity,
        request.signal,
      );
      calls += 1;
      if (calls === changed.policy.expectedFiles.length) {
        await writeFile(resolve(changed.root, "project_data/model/log.txt"), "changed");
      }
      return {
        sha256: digest.sha256,
        sizeBytes: digest.sizeBytes,
        headBytes: digest.headBytes,
        capturedContents: request.captureContents ? await readFile(request.absolutePath) : null,
      };
    };
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: changed.root,
      testOnlyPolicy: changed.policy,
      hashFile,
    })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });

  it("rejects metadata or trajectory facts even when their changed bytes are re-bound", async () => {
    const metadata = await fixture({
      "project_data/log/project.json": portalCamJson().replace("PortalCam", "OtherCam"),
    });
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: metadata.root,
      testOnlyPolicy: metadata.policy,
    })).rejects.toMatchObject({ code: "PORTALCAM_METADATA_MISMATCH" });

    const poses = await fixture({
      "project_data/poses.csv": poseCsv().replace("1780219119.879549", "1780219119.879548"),
    });
    await expect(verifyGrandHallXgridsSource({
      sourceRoot: poses.root,
      testOnlyPolicy: poses.policy,
    })).rejects.toMatchObject({ code: "POSES_FACTS_MISMATCH" });
  });
});

describe("Grand Hall XGRIDS machine evaluator and receipt", () => {
  it("can grant only estimator eligibility and never reconstruction authority", async () => {
    const input = await fixture();
    const source = await verifyGrandHallXgridsSource({
      sourceRoot: input.root,
      testOnlyPolicy: input.policy,
    });
    const machine = eligibleMachine();
    const decision = evaluateGrandHallXgridsPreflight(machine);
    const first = createGrandHallXgridsLccPreflightReceipt(source, machine);
    const second = createGrandHallXgridsLccPreflightReceipt(source, machine);

    expect(decision).toMatchObject({
      status: "eligible_for_lcc_estimator_only",
      blockers: [],
      lccEstimatorEligible: true,
      lccLaunchPerformed: false,
      reconstructionAuthorized: false,
      trainingAuthorized: false,
      runtimeAuthorized: false,
      stagingAuthorized: false,
      publicationAuthorized: false,
      outputAuthority: "diagnostic_preflight_only",
    });
    expect(first.schemaVersion).toBe(GRAND_HALL_XGRIDS_LCC_PREFLIGHT_V1);
    expect(first.membershipEvidenceSha256).toBe(GRAND_HALL_ROOM_MEMBERSHIP_SHA256);
    expect(first.receiptSha256).toBe(second.receiptSha256);
    expect(first.receiptSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("fails every readiness boundary closed with stable blocker codes", () => {
    const machine = eligibleMachine();
    const blocked: GrandHallXgridsMachineObservationV1 = {
      ...machine,
      platform: "linux",
      totalPhysicalMemoryBytes: GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES - 1,
      gpu: {
        ...machine.gpu,
        gpuCount: 2,
        memoryMiB: 23_999,
        driverVersion: "581.89",
        computeCapability: 7.5,
      },
      scratch: {
        ...machine.scratch,
        freeBytes: GRAND_HALL_XGRIDS_MINIMUM_SCRATCH_FREE_BYTES - 1,
        fileSystem: "exFAT",
        driveType: "Network",
        busType: "USB",
        healthStatus: "Warning",
        directoryEmpty: false,
        writeAccessCheck: "failed",
      },
      lcc: {
        ...machine.lcc,
        releaseCompatibilityReview: "required_not_recorded",
      },
    };
    const decision = evaluateGrandHallXgridsPreflight(blocked);
    expect(decision.status).toBe("blocked");
    expect(decision.lccEstimatorEligible).toBe(false);
    expect(decision.blockers).toEqual([
      "PLATFORM_WINDOWS_X64_REQUIRED",
      "RAM_128_GIB_REQUIRED",
      "SINGLE_NVIDIA_GPU_REQUIRED",
      "GPU_COMPUTE_CAPABILITY_ABOVE_7_5_REQUIRED",
      "GPU_MEMORY_24000_MIB_REQUIRED",
      "GPU_DRIVER_581_90_REQUIRED",
      "SCRATCH_LOCAL_FIXED_DRIVE_REQUIRED",
      "SCRATCH_NVME_REQUIRED",
      "SCRATCH_HEALTHY_REQUIRED",
      "SCRATCH_NTFS_OR_REFS_REQUIRED",
      "SCRATCH_500_GIB_FREE_REQUIRED",
      "SCRATCH_EMPTY_DIRECTORY_REQUIRED",
      "SCRATCH_WRITE_ACCESS_REQUIRED",
      "LCC_2_3_OR_NEWER_REVIEW_REQUIRED",
    ]);
    expect(decision.reconstructionAuthorized).toBe(false);
  });

  it("rejects synthetic source policies outside the test environment", async () => {
    const input = await fixture();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(verifyGrandHallXgridsSource({
        sourceRoot: input.root,
        testOnlyPolicy: input.policy,
      })).rejects.toBeInstanceOf(GrandHallXgridsPreflightError);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("Grand Hall Windows collector and safe CLI", () => {
  it("builds a fixed probe environment without inheriting operator secrets", () => {
    const previousProgramFiles = process.env.ProgramFiles;
    process.env.GRAND_HALL_TEST_API_TOKEN = "must-not-reach-child";
    process.env.ProgramFiles = "Z:\\operator-controlled-program-files";
    try {
      const environment = createGrandHallWindowsSubprocessEnvironment(
        "C:\\Windows",
        "D:\\private\\scratch",
      );
      expect(Object.keys(environment).sort()).toEqual([
        "ComSpec",
        "OMNITWIN_PREFLIGHT_SCRATCH_ROOT",
        "PATHEXT",
        "ProgramFiles",
        "PSModulePath",
        "Path",
        "SystemDrive",
        "SystemRoot",
        "WINDIR",
      ].sort());
      expect(environment.GRAND_HALL_TEST_API_TOKEN).toBeUndefined();
      expect(environment.ProgramFiles).toBe("C:\\Program Files");
      expect(JSON.stringify(environment)).not.toContain("must-not-reach-child");
      expect(JSON.stringify(environment)).not.toContain("operator-controlled");
      expect(Object.isFrozen(environment)).toBe(true);
    } finally {
      delete process.env.GRAND_HALL_TEST_API_TOKEN;
      if (previousProgramFiles === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = previousProgramFiles;
    }
  });

  it("parses only one exact official NVIDIA query row", () => {
    expect(parseNvidiaSmiObservation(
      "0, NVIDIA GeForce RTX 4090, 24564, 596.49, 8.9\r\n",
    )).toEqual({
      state: "observed",
      gpuCount: 1,
      name: "NVIDIA GeForce RTX 4090",
      memoryMiB: 24_564,
      driverVersion: "596.49",
      computeCapability: 8.9,
      query: "nvidia_smi_fixed_read_only_query",
    });
    expect(parseNvidiaSmiObservation(
      "0, NVIDIA A, 24564, 596.49, 8.9\n1, NVIDIA B, 24564, 596.49, 8.9\n",
    ).state).toBe("unavailable");
    expect(parseNvidiaSmiObservation("malformed").state).toBe("unavailable");
  });

  it("collects bounded read-only Windows observations and leaves LCC compatibility pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-windows-probe-"));
    roots.push(root);
    const scratch = resolve(root, "scratch");
    const lcc = resolve(root, "lcc");
    await mkdir(resolve(lcc, "build"), { recursive: true });
    await mkdir(scratch);
    await writeFile(resolve(lcc, "LccStudio.exe"), "signed-binary-placeholder");
    await writeFile(
      resolve(lcc, "build/version.json"),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('{ "version": "0.15.0.7" }\r\n'),
      ]),
    );
    const invocations: Array<{
      readonly arguments_: readonly string[];
      readonly environment: Readonly<Record<string, string>>;
    }> = [];
    const observation = await collectGrandHallWindowsMachineObservation({
      scratchRoot: scratch,
      lccInstallRoot: lcc,
    }, {
      platform: "win32",
      architecture: "x64",
      totalPhysicalMemoryBytes: GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
      runProcess: (_executable, arguments_, environment) => {
        invocations.push({ arguments_, environment });
        const gpu = arguments_.some((argument) => argument.startsWith("--query-gpu="));
        return Promise.resolve({
          outcome: "completed" as const,
          exitCode: 0,
          stdout: gpu
            ? "0, NVIDIA GeForce RTX 4090, 24564, 596.49, 8.9\n"
            : JSON.stringify({
                diskCount: 1,
                busType: "NVMe",
                healthStatus: "Healthy",
                operationalStatus: "Online",
                fileSystem: "NTFS",
                driveType: "Fixed",
              }),
        });
      },
    });

    expect(observation.gpu.state).toBe("observed");
    expect(observation.scratch).toMatchObject({
      state: "observed",
      directoryEmpty: true,
      writeAccessCheck: "passed",
      writeBenchmarkPerformed: false,
      busType: "NVMe",
    });
    expect(observation.lcc).toMatchObject({
      state: "observed",
      reportedInternalVersion: "0.15.0.7",
      releaseCompatibilityReview: "required_not_recorded",
    });
    expect(observation.lcc.executable?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const powerShellInvocation = invocations.find((entry) =>
      entry.arguments_.includes("-Command"));
    expect(powerShellInvocation?.arguments_.join(" ")).not.toContain(scratch);
    expect(powerShellInvocation?.environment.OMNITWIN_PREFLIGHT_SCRATCH_ROOT).toBe(scratch);
    expect(Object.keys(powerShellInvocation?.environment ?? {}).sort()).toEqual([
      "ComSpec",
      "OMNITWIN_PREFLIGHT_SCRATCH_ROOT",
      "PATHEXT",
      "ProgramFiles",
      "PSModulePath",
      "Path",
      "SystemDrive",
      "SystemRoot",
      "WINDIR",
    ].sort());
    expect(invocations.every((entry) => entry.environment.USERPROFILE === undefined)).toBe(true);
  });

  it("rejects malformed UTF-8 and trailing data in the LCC version evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-lcc-version-probe-"));
    roots.push(root);
    const scratch = resolve(root, "scratch");
    const lcc = resolve(root, "lcc");
    const versionPath = resolve(lcc, "build/version.json");
    await mkdir(resolve(lcc, "build"), { recursive: true });
    await mkdir(scratch);
    await writeFile(resolve(lcc, "LccStudio.exe"), "signed-binary-placeholder");
    const runProcess = (_executable: string, arguments_: readonly string[]) => {
      const gpu = arguments_.some((argument) => argument.startsWith("--query-gpu="));
      return Promise.resolve({
        outcome: "completed" as const,
        exitCode: 0,
        stdout: gpu
          ? "0, NVIDIA GeForce RTX 4090, 24564, 596.49, 8.9\n"
          : JSON.stringify({
              diskCount: 1,
              busType: "NVMe",
              healthStatus: "Healthy",
              operationalStatus: "Online",
              fileSystem: "NTFS",
              driveType: "Fixed",
            }),
      });
    };

    await writeFile(versionPath, Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]));
    const malformed = await collectGrandHallWindowsMachineObservation({
      scratchRoot: scratch,
      lccInstallRoot: lcc,
    }, {
      platform: "win32",
      architecture: "x64",
      totalPhysicalMemoryBytes: GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
      runProcess,
    });
    expect(malformed.lcc.state).toBe("unavailable");

    await writeFile(versionPath, '{ "version": "0.15.0.7" }\ntrailing-data');
    const trailing = await collectGrandHallWindowsMachineObservation({
      scratchRoot: scratch,
      lccInstallRoot: lcc,
    }, {
      platform: "win32",
      architecture: "x64",
      totalPhysicalMemoryBytes: GRAND_HALL_XGRIDS_MINIMUM_RAM_BYTES,
      runProcess,
    });
    expect(trailing.lcc.state).toBe("unavailable");
  });

  it("parses exact CLI flags, returns 2 for a blocked receipt, and never echoes paths", async () => {
    expect(parseGrandHallXgridsLccPreflightArguments([
      "--source", "C:\\capture",
      "--scratch", "D:\\scratch",
      "--lcc-install", "E:\\LccStudio",
    ])).toEqual({
      sourceRoot: "C:\\capture",
      scratchRoot: "D:\\scratch",
      lccInstallRoot: "E:\\LccStudio",
    });
    expect(() => parseGrandHallXgridsLccPreflightArguments([
      "--source", "a", "--source", "b", "--scratch", "c", "--lcc-install", "d",
    ])).toThrow("Invalid Grand Hall XGRIDS preflight invocation.");
    expect(() => parseGrandHallXgridsLccPreflightArguments([
      "--source", "a", "--scratch", "b", "--unknown", "c",
    ])).toThrow("Invalid Grand Hall XGRIDS preflight invocation.");

    const privatePath = "C:\\Users\\private-operator\\secret-capture";
    let malformedFailure: unknown;
    try {
      parseGrandHallXgridsLccPreflightArguments([privatePath, "value"]);
    } catch (error: unknown) {
      malformedFailure = error;
    }
    const malformedOutput = formatGrandHallXgridsLccPreflightFailure(malformedFailure);
    expect(malformedOutput).not.toContain(privatePath);
    expect(malformedOutput).not.toContain("private-operator");
    expect(formatGrandHallXgridsLccPreflightFailure(
      new Error(`ENOENT while reading ${privatePath}`),
    )).not.toContain(privatePath);
    expect(formatGrandHallXgridsLccPreflightFailure(
      new GrandHallXgridsPreflightError(
        "SOURCE_ROOT_UNAVAILABLE",
        `Source unavailable at ${privatePath}`,
      ),
    )).not.toContain(privatePath);

    const input = await fixture();
    const source = await verifyGrandHallXgridsSource({
      sourceRoot: input.root,
      testOnlyPolicy: input.policy,
    });
    const machine = eligibleMachine();
    const blockedMachine: GrandHallXgridsMachineObservationV1 = {
      ...machine,
      lcc: { ...machine.lcc, releaseCompatibilityReview: "required_not_recorded" },
    };
    let output = "";
    const exitCode = await runGrandHallXgridsLccPreflightCli([
      "--source", "C:\\private\\capture",
      "--scratch", "D:\\private\\scratch",
      "--lcc-install", "E:\\private\\lcc",
    ], {
      verifySource: () => Promise.resolve(source),
      collectMachine: () => Promise.resolve(blockedMachine),
      write: (text) => { output += text; },
    });
    expect(exitCode).toBe(2);
    expect(JSON.parse(output).decision.status).toBe("blocked");
    expect(output).not.toContain("C:\\private\\capture");
    expect(output).not.toContain("D:\\private\\scratch");
    expect(output).not.toContain("E:\\private\\lcc");
    expect(output).not.toContain(input.root);
  });

  it("returns 0 only for estimator eligibility and help never probes", async () => {
    const input = await fixture();
    const source = await verifyGrandHallXgridsSource({
      sourceRoot: input.root,
      testOnlyPolicy: input.policy,
    });
    let output = "";
    const exitCode = await runGrandHallXgridsLccPreflightCli([
      "--source", "C:\\capture",
      "--scratch", "D:\\scratch",
      "--lcc-install", "E:\\lcc",
    ], {
      verifySource: () => Promise.resolve(source),
      collectMachine: () => Promise.resolve(eligibleMachine()),
      write: (text) => { output += text; },
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output).decision).toMatchObject({
      status: "eligible_for_lcc_estimator_only",
      lccLaunchPerformed: false,
      reconstructionAuthorized: false,
    });

    let probed = false;
    output = "";
    expect(await runGrandHallXgridsLccPreflightCli(["--help"], {
      verifySource: () => { probed = true; return Promise.resolve(source); },
      write: (text) => { output += text; },
    })).toBe(0);
    expect(probed).toBe(false);
    expect(output).toContain("Read-only Grand Hall XGRIDS/LCC estimator preflight");
  });
});
