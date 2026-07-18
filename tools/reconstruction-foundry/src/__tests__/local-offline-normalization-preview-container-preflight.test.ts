import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS,
  parseLocalOfflinePreviewContainerConfiguration,
  preflightLocalOfflineNormalizationPreviewContainer,
  type LocalOfflinePreviewContainerConfiguration,
  type LocalOfflinePreviewContainerFileProbe,
  type LocalOfflinePreviewContainerFileProbeResult,
  type LocalOfflinePreviewContainerPreflightDependencies,
  type LocalOfflinePreviewDockerCommandProbe,
  type LocalOfflinePreviewDockerCommandProbeRequest,
  type LocalOfflinePreviewDockerCommandProbeResult,
  type LocalOfflinePreviewDockerReadOnlyCommand,
} from "../local-offline-normalization-preview-container-preflight.js";

const DOCKER_PATH = resolve("fixtures", "docker.exe");
const SECCOMP_PATH = resolve("fixtures", "offline-preview-seccomp.json");
const IMAGE_REPOSITORY_DIGEST = `sha256:${"1".repeat(64)}`;
const IMAGE_REFERENCE =
  `local/offline-preview@${IMAGE_REPOSITORY_DIGEST}`;
const IMAGE_ID = `sha256:${"2".repeat(64)}`;
const WORKER_PROTOCOL_SHA256 = `sha256:${"3".repeat(64)}`;
const WORKER_ARTIFACT_SHA256 = `sha256:${"4".repeat(64)}`;
const FIXED_ENTRYPOINT = [
  "/opt/omnitwin/bin/node",
  "/opt/omnitwin/worker/offline-preview.mjs",
] as const;
const MAX_COMMAND_BYTES = 1024 * 1024;

const SAFE_SECCOMP_PROFILE = Object.freeze({
  defaultAction: "SCMP_ACT_ERRNO",
  architectures: ["SCMP_ARCH_X86_64"],
  syscalls: [
    {
      names: ["read", "write", "exit", "futex"],
      action: "SCMP_ACT_ALLOW",
    },
  ],
});

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const SAFE_SECCOMP_BYTES = jsonBytes(SAFE_SECCOMP_PROFILE);

function validConfiguration(
  seccompBytes: Uint8Array = SAFE_SECCOMP_BYTES,
): LocalOfflinePreviewContainerConfiguration {
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1,
    authority: "none",
    fallbackPolicy: "block",
    containerPlatform: "linux/amd64",
    dockerExecutablePath: DOCKER_PATH,
    seccompProfilePath: SECCOMP_PATH,
    seccompProfileSha256: sha256(seccompBytes),
    seccompDefaultAction: "SCMP_ACT_ERRNO",
    imageReference: IMAGE_REFERENCE,
    imageId: IMAGE_ID,
    imagePullPolicy: "never",
    networkMode: "none",
    rootFilesystem: "read_only",
    mountPolicy: "none",
    capabilityPolicy: "drop_all",
    noNewPrivileges: true,
    userId: 10_001,
    groupId: 10_001,
    workerKind: "offline_normalization_preview",
    workerProtocolSha256: WORKER_PROTOCOL_SHA256,
    workerArtifactSha256: WORKER_ARTIFACT_SHA256,
    fixedEntrypoint: FIXED_ENTRYPOINT,
    resourceLimits: {
      cpuCores: 2,
      memoryBytes: 768 * 1024 * 1024,
      memorySwapBytes: 768 * 1024 * 1024,
      pidsLimit: 32,
      maximumInputBytes: 64 * 1024 * 1024,
      maximumOutputBytes: 64 * 1024 * 1024,
      maximumRuntimeMilliseconds: 60_000,
    },
  };
}

function validVersion(): Record<string, unknown> {
  return {
    Client: { Version: "29.4.3" },
    Server: { Version: "29.4.3", Os: "linux", Arch: "amd64" },
  };
}

function validInfo(): Record<string, unknown> {
  return {
    OSType: "linux",
    Architecture: "x86_64",
    CgroupVersion: "2",
    SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
  };
}

function validLabels(
  configuration: LocalOfflinePreviewContainerConfiguration,
): Record<string, string> {
  return {
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerKind]:
      configuration.workerKind,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerProtocolSha256]:
      configuration.workerProtocolSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerArtifactSha256]:
      configuration.workerArtifactSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.seccompProfileSha256]:
      configuration.seccompProfileSha256,
  };
}

function validImage(
  configuration: LocalOfflinePreviewContainerConfiguration,
  imageOverrides: Readonly<Record<string, unknown>> = {},
  configOverrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    Id: configuration.imageId,
    RepoDigests: [configuration.imageReference],
    Os: "linux",
    Architecture: "amd64",
    Config: {
      User:
        `${String(configuration.userId)}:${String(configuration.groupId)}`,
      Entrypoint: [...configuration.fixedEntrypoint],
      Cmd: null,
      Labels: validLabels(configuration),
      ExposedPorts: null,
      Volumes: null,
      Healthcheck: null,
      ...configOverrides,
    },
    ...imageOverrides,
  };
}

function completedJson(value: unknown): LocalOfflinePreviewDockerCommandProbeResult {
  return {
    outcome: "completed",
    exitCode: 0,
    stdout: jsonBytes(value),
    stderrByteLength: 0,
  };
}

type CommandOverrides = Partial<
  Record<LocalOfflinePreviewDockerReadOnlyCommand, LocalOfflinePreviewDockerCommandProbeResult>
>;

interface DependencyOptions {
  readonly seccompBytes?: Uint8Array;
  readonly fileProbe?: LocalOfflinePreviewContainerFileProbe;
  readonly commandOverrides?: CommandOverrides;
  readonly capturedCommands?: LocalOfflinePreviewDockerCommandProbeRequest[];
}

function dependencies(
  configuration: LocalOfflinePreviewContainerConfiguration,
  options: DependencyOptions = {},
): LocalOfflinePreviewContainerPreflightDependencies {
  const seccompBytes = options.seccompBytes ?? SAFE_SECCOMP_BYTES;
  const fileProbe: LocalOfflinePreviewContainerFileProbe =
    options.fileProbe ?? ((request) => Promise.resolve({
      outcome: "ok",
      canonicalPath: request.absolutePath,
      fileType: "regular",
      symbolicLink: false,
      contents: request.readContents ? seccompBytes : null,
    }));
  const defaultResults: Record<
    LocalOfflinePreviewDockerReadOnlyCommand,
    LocalOfflinePreviewDockerCommandProbeResult
  > = {
    version: completedJson(validVersion()),
    info: completedJson(validInfo()),
    image_inspect: completedJson(validImage(configuration)),
  };
  const commandProbe: LocalOfflinePreviewDockerCommandProbe = (request) => {
    options.capturedCommands?.push(request);
    return Promise.resolve(
      options.commandOverrides?.[request.command] ??
        defaultResults[request.command],
    );
  };
  return { fileProbe, commandProbe };
}

async function expectBlocked(
  configuration: unknown,
  code: string,
  options: DependencyOptions = {},
): Promise<void> {
  const valid = validConfiguration(options.seccompBytes);
  const report = await preflightLocalOfflineNormalizationPreviewContainer(
    configuration,
    dependencies(valid, options),
  );
  expect(report).toEqual({ status: "blocked", code, sandboxEstablished: false });
}

describe("local offline preview container preflight", () => {
  it("returns only read-only eligibility and never claims a sandbox", async () => {
    const configuration = validConfiguration();
    const capturedCommands: LocalOfflinePreviewDockerCommandProbeRequest[] = [];
    const report = await preflightLocalOfflineNormalizationPreviewContainer(
      configuration,
      dependencies(configuration, { capturedCommands }),
    );

    expect(report).toEqual({
      status: "eligible",
      code: "PREFLIGHT_ELIGIBLE",
      sandboxEstablished: false,
    });
    expect(Object.keys(report).sort()).toEqual([
      "code",
      "sandboxEstablished",
      "status",
    ]);
    expect(capturedCommands.map((request) => request.command)).toEqual([
      "version",
      "info",
      "image_inspect",
    ]);
    expect(capturedCommands[0]?.imageReference).toBeNull();
    expect(capturedCommands[1]?.imageReference).toBeNull();
    expect(capturedCommands[2]?.imageReference).toBe(IMAGE_REFERENCE);
    expect(capturedCommands.every((request) => request.executablePath === DOCKER_PATH)).toBe(true);
  });

  it("exports a strict parser that returns a detached frozen configuration", () => {
    const input = validConfiguration();
    const parsed = parseLocalOfflinePreviewContainerConfiguration(input);

    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.fixedEntrypoint)).toBe(true);
    expect(Object.isFrozen(parsed?.resourceLimits)).toBe(true);
    expect(parseLocalOfflinePreviewContainerConfiguration({ ...input, extra: true })).toBeNull();
  });

  it.each([
    ["extra top-level key", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, extra: true })],
    ["extra resource key", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, extra: true } })],
    ["tag-only image", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, imageReference: "local/offline-preview:latest" })],
    ["root user", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, userId: 0 })],
    ["relative entrypoint", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, fixedEntrypoint: ["worker.mjs"] })],
    ["swap above memory", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, memorySwapBytes: base.resourceLimits.memoryBytes + 1 } })],
    ["too many processes", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, pidsLimit: 65 } })],
    ["oversized input", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, maximumInputBytes: 64 * 1024 * 1024 + 1 } })],
    ["oversized output", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, maximumOutputBytes: 64 * 1024 * 1024 + 1 } })],
    ["long runtime", (base: LocalOfflinePreviewContainerConfiguration) => ({ ...base, resourceLimits: { ...base.resourceLimits, maximumRuntimeMilliseconds: 60_001 } })],
  ])("rejects configuration invariant: %s", async (_name, mutate) => {
    const base = validConfiguration();
    await expectBlocked(mutate(base), "PREFLIGHT_CONFIGURATION_REJECTED");
  });

  it("rejects non-absolute and non-canonical process-owned paths", async () => {
    const base = validConfiguration();
    await expectBlocked(
      { ...base, dockerExecutablePath: "docker.exe" },
      "DOCKER_EXECUTABLE_PATH_REJECTED",
    );
    await expectBlocked(
      {
        ...base,
        seccompProfilePath:
          `${resolve("fixtures", "subdirectory")}\\..\\offline-preview-seccomp.json`,
      },
      "SECCOMP_PROFILE_PATH_REJECTED",
    );
  });

  it.each([
    [DOCKER_PATH, true, DOCKER_PATH, "DOCKER_EXECUTABLE_SYMLINK_REJECTED"],
    [DOCKER_PATH, false, `${DOCKER_PATH}.other`, "DOCKER_EXECUTABLE_CHANGED"],
    [SECCOMP_PATH, true, SECCOMP_PATH, "SECCOMP_PROFILE_SYMLINK_REJECTED"],
    [SECCOMP_PATH, false, `${SECCOMP_PATH}.other`, "SECCOMP_PROFILE_CHANGED"],
  ])("rejects symlink or canonical-path substitution", async (targetPath, symbolicLink, canonicalPath, code) => {
    const configuration = validConfiguration();
    const fileProbe: LocalOfflinePreviewContainerFileProbe = (request) => {
      const substituted = request.absolutePath === targetPath;
      const result: LocalOfflinePreviewContainerFileProbeResult = {
        outcome: "ok",
        canonicalPath: substituted ? canonicalPath : request.absolutePath,
        fileType: "regular",
        symbolicLink: substituted && symbolicLink,
        contents: request.readContents ? SAFE_SECCOMP_BYTES : null,
      };
      return Promise.resolve(result);
    };
    await expectBlocked(configuration, code, { fileProbe });
  });

  it("rejects changed and oversized probed files with stable codes", async () => {
    const configuration = validConfiguration();
    const changed: LocalOfflinePreviewContainerFileProbe = (request) =>
      Promise.resolve(request.readContents
        ? { outcome: "changed" }
        : { outcome: "ok", canonicalPath: request.absolutePath, fileType: "regular", symbolicLink: false, contents: null });
    await expectBlocked(configuration, "SECCOMP_PROFILE_CHANGED", { fileProbe: changed });

    const oversized: LocalOfflinePreviewContainerFileProbe = (request) =>
      Promise.resolve(request.readContents
        ? { outcome: "too_large" }
        : { outcome: "ok", canonicalPath: request.absolutePath, fileType: "regular", symbolicLink: false, contents: null });
    await expectBlocked(configuration, "SECCOMP_PROFILE_TOO_LARGE", { fileProbe: oversized });
  });

  it("rejects a seccomp digest change before trusting its rules", async () => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, "SECCOMP_PROFILE_DIGEST_MISMATCH", {
      seccompBytes: jsonBytes({ ...SAFE_SECCOMP_PROFILE, unexpected: true }),
    });
  });

  it("rejects malformed seccomp JSON and a non-denying default", async () => {
    const malformed = Buffer.from("{", "utf8");
    await expectBlocked(
      validConfiguration(malformed),
      "SECCOMP_PROFILE_MALFORMED",
      { seccompBytes: malformed },
    );
    const permissive = jsonBytes({
      ...SAFE_SECCOMP_PROFILE,
      defaultAction: "SCMP_ACT_ALLOW",
    });
    await expectBlocked(
      validConfiguration(permissive),
      "SECCOMP_DEFAULT_DENY_REQUIRED",
      { seccompBytes: permissive },
    );
  });

  it.each([
    "socket",
    "socketpair",
    "mount",
    "umount2",
    "ptrace",
    "bpf",
    "unshare",
    "setns",
  ])("rejects a permissive seccomp rule for %s", async (syscall) => {
    const profile = jsonBytes({
      defaultAction: "SCMP_ACT_ERRNO",
      syscalls: [{ names: [syscall], action: "SCMP_ACT_ALLOW" }],
    });
    await expectBlocked(
      validConfiguration(profile),
      "SECCOMP_FORBIDDEN_SYSCALL_ALLOWED",
      { seccompBytes: profile },
    );
  });

  const commandFailures: readonly [
    LocalOfflinePreviewDockerReadOnlyCommand,
    LocalOfflinePreviewDockerCommandProbeResult,
    string,
  ][] = [
    ["version", { outcome: "timed_out" }, "DOCKER_VERSION_TIMEOUT"],
    ["info", { outcome: "timed_out" }, "DOCKER_INFO_TIMEOUT"],
    ["image_inspect", { outcome: "timed_out" }, "IMAGE_INSPECT_TIMEOUT"],
    ["version", { outcome: "output_limit_exceeded" }, "DOCKER_VERSION_OUTPUT_LIMIT_EXCEEDED"],
    ["info", { outcome: "output_limit_exceeded" }, "DOCKER_INFO_OUTPUT_LIMIT_EXCEEDED"],
    ["image_inspect", { outcome: "output_limit_exceeded" }, "IMAGE_INSPECT_OUTPUT_LIMIT_EXCEEDED"],
    ["version", { outcome: "failed_to_start" }, "DOCKER_VERSION_INVOCATION_FAILED"],
    ["info", { outcome: "failed_to_start" }, "DOCKER_INFO_INVOCATION_FAILED"],
    ["image_inspect", { outcome: "failed_to_start" }, "IMAGE_INSPECT_INVOCATION_FAILED"],
  ];

  it.each(commandFailures)("maps %s probe failures without leaking command output", async (stage, result, code) => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, code, {
      commandOverrides: { [stage]: result },
    });
  });

  it.each([
    ["version", "DOCKER_VERSION_COMMAND_FAILED", "DOCKER_VERSION_RESPONSE_MALFORMED"],
    ["info", "DOCKER_INFO_COMMAND_FAILED", "DOCKER_INFO_RESPONSE_MALFORMED"],
    ["image_inspect", "IMAGE_INSPECT_COMMAND_FAILED", "IMAGE_INSPECT_RESPONSE_MALFORMED"],
  ] as const)("rejects failed and malformed %s output", async (stage, failedCode, malformedCode) => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, failedCode, {
      commandOverrides: {
        [stage]: { outcome: "completed", exitCode: 7, stdout: Buffer.from("secret stderr not retained"), stderrByteLength: 12 },
      },
    });
    await expectBlocked(configuration, malformedCode, {
      commandOverrides: {
        [stage]: { outcome: "completed", exitCode: 0, stdout: Buffer.from("{"), stderrByteLength: 0 },
      },
    });
  });

  it("rejects a completed probe that violates either output bound", async () => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, "DOCKER_VERSION_OUTPUT_LIMIT_EXCEEDED", {
      commandOverrides: {
        version: { outcome: "completed", exitCode: 0, stdout: Buffer.alloc(MAX_COMMAND_BYTES + 1), stderrByteLength: 0 },
      },
    });
    await expectBlocked(configuration, "DOCKER_VERSION_OUTPUT_LIMIT_EXCEEDED", {
      commandOverrides: {
        version: { outcome: "completed", exitCode: 0, stdout: jsonBytes(validVersion()), stderrByteLength: 64 * 1024 + 1 },
      },
    });
  });

  it("requires a reachable Linux amd64 Docker server", async () => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, "DOCKER_SERVER_UNAVAILABLE", {
      commandOverrides: { version: completedJson({ Client: {} }) },
    });
    await expectBlocked(configuration, "DOCKER_PLATFORM_UNSUPPORTED", {
      commandOverrides: {
        version: completedJson({ Client: {}, Server: { Version: "29", Os: "windows", Arch: "amd64" } }),
      },
    });
  });

  it("requires Linux amd64, cgroup v2, and Docker seccomp support", async () => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, "DOCKER_PLATFORM_UNSUPPORTED", {
      commandOverrides: { info: completedJson({ ...validInfo(), Architecture: "aarch64" }) },
    });
    await expectBlocked(configuration, "DOCKER_CGROUP_V2_REQUIRED", {
      commandOverrides: { info: completedJson({ ...validInfo(), CgroupVersion: "1" }) },
    });
    await expectBlocked(configuration, "DOCKER_SECCOMP_REQUIRED", {
      commandOverrides: { info: completedJson({ ...validInfo(), SecurityOptions: ["name=cgroupns"] }) },
    });
  });

  it.each([
    ["IMAGE_PLATFORM_MISMATCH", { Os: "windows" }, {}],
    ["IMAGE_ID_MISMATCH", { Id: `sha256:${"9".repeat(64)}` }, {}],
    ["IMAGE_REPOSITORY_DIGEST_MISMATCH", { RepoDigests: [`other/image@${IMAGE_REPOSITORY_DIGEST}`] }, {}],
    ["IMAGE_NONROOT_USER_MISMATCH", {}, { User: "0:0" }],
    ["IMAGE_ENTRYPOINT_MISMATCH", {}, { Entrypoint: ["/bin/sh"] }],
    ["IMAGE_DEFAULT_COMMAND_REJECTED", {}, { Cmd: ["--unexpected"] }],
    ["IMAGE_EXPOSED_PORTS_REJECTED", {}, { ExposedPorts: { "8080/tcp": {} } }],
    ["IMAGE_DECLARED_VOLUMES_REJECTED", {}, { Volumes: { "/data": {} } }],
    ["IMAGE_HEALTHCHECK_REJECTED", {}, { Healthcheck: { Test: ["CMD", "true"] } }],
  ])("rejects image invariant with %s", async (code, imageOverrides, configOverrides) => {
    const configuration = validConfiguration();
    await expectBlocked(configuration, code, {
      commandOverrides: {
        image_inspect: completedJson(validImage(configuration, imageOverrides, configOverrides)),
      },
    });
  });

  it("binds all security-sensitive image labels exactly", async () => {
    const configuration = validConfiguration();
    for (const label of Object.values(LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS)) {
      await expectBlocked(configuration, "IMAGE_LABEL_MISMATCH", {
        commandOverrides: {
          image_inspect: completedJson(validImage(configuration, {}, {
            Labels: { ...validLabels(configuration), [label]: "sha256:changed" },
          })),
        },
      });
    }
  });

  it("turns thrown probe errors into a path-free stable report", async () => {
    const configuration = validConfiguration();
    const fileProbe: LocalOfflinePreviewContainerFileProbe = () =>
      Promise.reject(new Error("C:\\secret\\must-not-leak"));
    const report = await preflightLocalOfflineNormalizationPreviewContainer(
      configuration,
      dependencies(configuration, { fileProbe }),
    );

    expect(report).toEqual({
      status: "blocked",
      code: "PREFLIGHT_INTERNAL_FAILURE",
      sandboxEstablished: false,
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
