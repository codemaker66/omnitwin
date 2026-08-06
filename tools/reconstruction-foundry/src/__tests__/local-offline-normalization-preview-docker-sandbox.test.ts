import { createHash, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "@omnitwin/reconstruction-foundry";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS,
  LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2,
  type LocalOfflinePreviewContainerConfiguration,
  type LocalOfflinePreviewContainerPreflightDependencies,
} from "../local-offline-normalization-preview-container-preflight.js";
import {
  __testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox,
  createLocalOfflineNormalizationPreviewDockerSandbox,
  defaultLocalOfflinePreviewDockerCommandExecutor,
  isLocalOfflinePreviewDockerSandboxLiveWitness,
  localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence,
  LocalOfflinePreviewDockerSandboxError,
  type LocalOfflinePreviewDockerCommandExecutor,
  type LocalOfflinePreviewDockerCommandRequest,
  type LocalOfflinePreviewDockerCommandResult,
  type LocalOfflinePreviewDockerSandboxReservationInput,
} from "../local-offline-normalization-preview-docker-sandbox.js";
import {
  LocalOfflinePreviewPermitLeaseError,
  type LocalOfflinePreviewPermitLeaseInput,
  type LocalOfflinePreviewPermitLeaseStore,
} from "../local-offline-normalization-preview-permit-lease-store.js";
import {
  compileLocalOfflinePreviewSandboxPolicy,
} from "../local-offline-normalization-preview-sandbox-contract.js";

const NOW = Date.parse("2026-07-17T10:05:00.000Z");
const DEADLINE = "2026-07-17T10:09:00.000Z";
const DOCKER_PATH = resolve("fixtures", "docker.exe");
const SECCOMP_PATH = resolve("fixtures", "offline-preview-seccomp.json");
const DIGEST = (character: string): string => `sha256:${character.repeat(64)}`;
const IMAGE_REFERENCE = `local/offline-preview@${DIGEST("1")}`;
const PERMIT_DIGEST = DIGEST("8");
const INVOCATION_DIGEST = DIGEST("9");
const REPORT_DIGEST = DIGEST("a");
const SOURCE_BYTES = Buffer.from([7, 8, 9]);
const CANDIDATE_BYTES = Buffer.from([4, 5, 6, 7]);
const TRANSFORM_REQUEST_WIRE = Buffer.from([1]);
const TRANSFORM_RESPONSE_WIRE = Buffer.from([2]);
const VERIFIER_REQUEST_WIRE = Buffer.from([3]);
const VERIFIER_RESPONSE_WIRE = Buffer.from([4]);
const ENVELOPE = Object.freeze({ fixture: "process-owned-envelope" });
const INVOCATION = Object.freeze({
  fixture: "verified-source-free-authority-metadata",
  source: {
    assetId: "asset-1",
    inputType: "glb_gltf",
    mediaType: "model/gltf-binary",
    sizeBytes: SOURCE_BYTES.byteLength,
    sha256: sha256(SOURCE_BYTES),
  },
  permit: { payloadSha256: PERMIT_DIGEST },
});
const REPORT = Object.freeze({
  invocationSha256: INVOCATION_DIGEST,
  source: INVOCATION.source,
  permit: { payloadSha256: PERMIT_DIGEST },
  output: { sizeBytes: CANDIDATE_BYTES.byteLength, sha256: sha256(CANDIDATE_BYTES) },
});

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sessionDigest(requestId: string, deadline: number, policyDigest: string): string {
  return `sha256:${domainSeparatedSha256(
    "OMNITWIN_OFFLINE_PREVIEW_SESSION_V0",
    toCanonicalJson({
      requestId,
      deadlineAt: new Date(deadline).toISOString(),
      policyDigest,
    }),
  )}`;
}

const SAFE_SECCOMP = Buffer.from(JSON.stringify({
  defaultAction: "SCMP_ACT_ERRNO",
  architectures: ["SCMP_ARCH_X86_64"],
  syscalls: [{ names: ["read", "write", "exit", "futex"], action: "SCMP_ACT_ALLOW" }],
}));

function configuration(): LocalOfflinePreviewContainerConfiguration {
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V2,
    authority: "none",
    fallbackPolicy: "block",
    containerPlatform: "linux/amd64",
    dockerExecutablePath: DOCKER_PATH,
    seccompProfilePath: SECCOMP_PATH,
    seccompProfileSha256: sha256(SAFE_SECCOMP),
    seccompDefaultAction: "SCMP_ACT_ERRNO",
    imageReference: IMAGE_REFERENCE,
    imageId: DIGEST("2"),
    imagePullPolicy: "never",
    networkMode: "none",
    rootFilesystem: "read_only",
    mountPolicy: "none",
    capabilityPolicy: "drop_all",
    noNewPrivileges: true,
    userId: 10_001,
    groupId: 10_001,
    workerKind: "offline_normalization_preview",
    workerProtocolSha256: DIGEST("3"),
    workerArtifactSha256: DIGEST("4"),
    fixedEntrypoint: LOCAL_OFFLINE_PREVIEW_CONTAINER_FIXED_ENTRYPOINT_V2,
    runtimeWatchdog: {
      kind: "busybox_timeout_pid1_wall_clock",
      executablePath: "/bin/busybox",
      artifactSha256: DIGEST("5"),
      coverage: "stdin_worker_stdout",
      terminationSignal: "SIGKILL",
      independentOfHostProcess: true,
      maximumRuntimeMilliseconds: 60_000,
    },
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

function imageLabels(config: LocalOfflinePreviewContainerConfiguration) {
  return {
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerKind]: config.workerKind,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerProtocolSha256]: config.workerProtocolSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.workerArtifactSha256]: config.workerArtifactSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.seccompProfileSha256]: config.seccompProfileSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.watchdogArtifactSha256]: config.runtimeWatchdog.artifactSha256,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.watchdogMaximumRuntimeMilliseconds]:
      String(config.runtimeWatchdog.maximumRuntimeMilliseconds),
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.approvalScope]:
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_APPROVAL_SCOPE_V2,
    [LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_LABELS.qualificationStatus]:
      LOCAL_OFFLINE_PREVIEW_CONTAINER_IMAGE_BUILD_QUALIFICATION_STATUS_V2,
  };
}

function preflightDependencies(
  config: LocalOfflinePreviewContainerConfiguration,
): LocalOfflinePreviewContainerPreflightDependencies {
  return {
    fileProbe: (request) => Promise.resolve({
      outcome: "ok",
      canonicalPath: request.absolutePath,
      fileType: "regular",
      symbolicLink: false,
      contents: request.readContents ? Buffer.from(SAFE_SECCOMP) : null,
    }),
    commandProbe: (request) => {
      const value = request.command === "version"
        ? { Client: { Version: "29" }, Server: { Version: "29", Os: "linux", Arch: "amd64" } }
        : request.command === "info"
          ? {
              OSType: "linux",
              Architecture: "x86_64",
              CgroupVersion: "2",
              SecurityOptions: ["name=seccomp,profile=builtin", "name=cgroupns"],
            }
          : {
              Id: config.imageId,
              RepoDigests: [config.imageReference],
              Os: "linux",
              Architecture: "amd64",
              Config: {
                User: `${String(config.userId)}:${String(config.groupId)}`,
                Entrypoint: [...config.fixedEntrypoint],
                Cmd: null,
                Env: [...LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2],
                WorkingDir: "/",
                StopSignal: "SIGKILL",
                Labels: imageLabels(config),
                ExposedPorts: null,
                Volumes: null,
                Healthcheck: null,
              },
            };
      return Promise.resolve({
        outcome: "completed" as const,
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(value)),
        stderrByteLength: 0,
      });
    },
  };
}

interface FakeContainer {
  readonly id: string;
  readonly labels: Record<string, string>;
  readonly inspect: Record<string, unknown>;
}

class FakeDocker {
  readonly requests: LocalOfflinePreviewDockerCommandRequest[] = [];
  readonly containers = new Map<string, FakeContainer>();
  startOutcome: LocalOfflinePreviewDockerCommandResult | null = null;
  createOutcomeAfterAccept: LocalOfflinePreviewDockerCommandResult | null = null;
  terminalExitCode = 0;
  readonly decodedSensitive: Buffer[] = [];
  freshResponseOverrides: Record<string, unknown> = {};
  afterCreate: (() => Promise<void>) | null = null;
  beforeStart: (() => Promise<void>) | null = null;
  failRemove = false;
  private counter = 0;
  requestId = "";

  constructor(readonly config: LocalOfflinePreviewContainerConfiguration) {}

  readonly execute = async (
    request: LocalOfflinePreviewDockerCommandRequest,
  ): Promise<LocalOfflinePreviewDockerCommandResult> => {
    await Promise.resolve();
    this.requests.push({
      ...request,
      stdin: request.stdin === null ? null : Buffer.from(request.stdin),
    });
    const args = request.arguments;
    if (args[0] === "version") return completedJson({ Server: { Version: "29" } });
    if (args[0] === "info") return completedJson({ OSType: "linux", CgroupVersion: "2" });
    if (args[0] === "container" && args[1] === "ls") return this.list(args);
    if (args[0] === "container" && args[1] === "create") return this.create(args);
    if (args[0] === "container" && args[1] === "inspect") return this.inspect(args);
    if (args[0] === "container" && args[1] === "start") return this.start(args, request.stdin);
    if (args[0] === "container" && args[1] === "kill") return completed(Buffer.alloc(0));
    if (args[0] === "container" && args[1] === "rm") {
      if (this.failRemove) {
        return {
          outcome: "completed",
          exitCode: 1,
          stdout: Buffer.alloc(0),
          stderrByteLength: 16,
        };
      }
      const id = args.at(-1);
      if (id !== undefined) this.containers.delete(id);
      return completed(Buffer.alloc(0));
    }
    return { outcome: "failed_to_start" };
  };

  seed(
    labels: Record<string, string>,
    state: "created" | "exited" = "created",
    name = `seed-${String(this.counter + 1)}`,
  ): string {
    const id = (++this.counter).toString(16).padStart(64, "0");
    const inspect = this.inspectShape(id, labels, state, name);
    this.containers.set(id, { id, labels, inspect });
    return id;
  }

  private async create(
    args: readonly string[],
  ): Promise<LocalOfflinePreviewDockerCommandResult> {
    const labels: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--label") {
        const pair = args[index + 1] ?? "";
        const separator = pair.indexOf("=");
        labels[pair.slice(0, separator)] = pair.slice(separator + 1);
      }
    }
    this.requestId = labels["io.omnitwin.foundry.offline-preview-sandbox.request"] ?? "";
    const nameIndex = args.indexOf("--name");
    const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
    if (name === undefined) return { outcome: "failed_to_start" };
    const id = this.seed(labels, "created", name);
    await this.afterCreate?.();
    if (this.createOutcomeAfterAccept !== null) {
      return this.createOutcomeAfterAccept;
    }
    return completed(Buffer.from(`${id}\n`));
  }

  private inspect(args: readonly string[]): LocalOfflinePreviewDockerCommandResult {
    const id = args.at(-1) ?? "";
    const container = this.containers.get(id);
    return container === undefined
      ? { outcome: "completed", exitCode: 1, stdout: Buffer.alloc(0), stderrByteLength: 12 }
      : completed(Buffer.from(JSON.stringify([container.inspect])));
  }

  private async start(
    args: readonly string[],
    stdin: Uint8Array | null,
  ): Promise<LocalOfflinePreviewDockerCommandResult> {
    await this.beforeStart?.();
    if (this.startOutcome !== null) return this.startOutcome;
    const id = args.at(-1) ?? "";
    const container = this.containers.get(id);
    if (container === undefined || stdin === null) return { outcome: "failed_to_start" };
    const state = container.inspect.State;
    if (typeof state === "object" && state !== null) {
      Object.assign(state, {
        Status: "exited", Running: false, Pid: 0, ExitCode: this.terminalExitCode,
        OOMKilled: false, Dead: false,
      });
    }
    return completed(Buffer.from(
      stdin[0] === 1 ? TRANSFORM_RESPONSE_WIRE : VERIFIER_RESPONSE_WIRE,
    ));
  }

  private list(args: readonly string[]): LocalOfflinePreviewDockerCommandResult {
    const filterArg = args[args.indexOf("--filter") + 1] ?? "";
    const expression = filterArg.startsWith("label=") ? filterArg.slice(6) : "";
    const separator = expression.indexOf("=");
    const key = separator < 0 ? expression : expression.slice(0, separator);
    const value = separator < 0 ? null : expression.slice(separator + 1);
    const ids = [...this.containers.values()]
      .filter((container) => key in container.labels && (value === null || container.labels[key] === value))
      .map((container) => container.id);
    return completed(Buffer.from(ids.length === 0 ? "" : `${ids.join("\n")}\n`));
  }

  private inspectShape(
    id: string,
    labels: Record<string, string>,
    state: "created" | "exited",
    name: string,
  ): Record<string, unknown> {
    const limits = this.config.resourceLimits;
    return {
      Id: id,
      Name: `/${name}`,
      Image: this.config.imageId,
      Path: this.config.fixedEntrypoint[0],
      Args: this.config.fixedEntrypoint.slice(1),
      Config: {
        Image: this.config.imageReference,
        Hostname: "foundry-offline-preview",
        User: `${String(this.config.userId)}:${String(this.config.groupId)}`,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: false,
        Tty: false,
        OpenStdin: true,
        Entrypoint: [...this.config.fixedEntrypoint],
        Cmd: null,
        Env: [...LOCAL_OFFLINE_PREVIEW_CONTAINER_SAFE_ENVIRONMENT_V2],
        WorkingDir: "/",
        StopSignal: "SIGKILL",
        StopTimeout: 1,
        Healthcheck: { Test: ["NONE"] },
        ExposedPorts: null,
        Volumes: null,
        Labels: labels,
      },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Privileged: false,
        CapDrop: ["ALL"],
        CapAdd: null,
        SecurityOpt: ["no-new-privileges=true", `seccomp=${this.config.seccompProfilePath}`],
        Runtime: "runc",
        PidMode: "private",
        CgroupnsMode: "private",
        IpcMode: "none",
        LogConfig: { Type: "none", Config: {} },
        RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
        AutoRemove: false,
        Memory: limits.memoryBytes,
        MemorySwap: limits.memorySwapBytes,
        PidsLimit: limits.pidsLimit,
        NanoCpus: limits.cpuCores * 1_000_000_000,
        ShmSize: 16_777_216,
        Ulimits: [
          { Name: "nofile", Soft: 64, Hard: 64 },
          { Name: "core", Soft: 0, Hard: 0 },
          { Name: "fsize", Soft: limits.maximumOutputBytes, Hard: limits.maximumOutputBytes },
        ],
        Binds: null,
        Mounts: null,
        VolumesFrom: null,
        Tmpfs: null,
        Devices: null,
        DeviceRequests: null,
        PublishAllPorts: false,
        PortBindings: null,
        Links: null,
        Dns: null,
        DnsOptions: null,
        DnsSearch: null,
        ExtraHosts: null,
        GroupAdd: null,
        UTSMode: "",
        UsernsMode: "",
        CgroupParent: "",
      },
      Mounts: [],
      NetworkSettings: { Networks: {} },
      State: state === "created"
        ? { Status: "created", Running: false, Pid: 0, ExitCode: 0, OOMKilled: false, Dead: false }
        : { Status: "exited", Running: false, Pid: 0, ExitCode: 0, OOMKilled: false, Dead: false },
    };
  }
}

function completed(stdout: Buffer): LocalOfflinePreviewDockerCommandResult {
  return { outcome: "completed", exitCode: 0, stdout, stderrByteLength: 0 };
}

function completedJson(value: unknown): LocalOfflinePreviewDockerCommandResult {
  return completed(Buffer.from(JSON.stringify(value)));
}

function fakeVerifyPermit(
  options: Readonly<{ readonly invocation: unknown }>,
) {
  return {
    invocation: options.invocation,
    permitPayloadSha256: PERMIT_DIGEST,
    validFrom: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:10:00.000Z",
  };
}

function decoder(fake: FakeDocker): (bytes: Uint8Array) => unknown {
  return (bytes) => {
    switch (bytes[0]) {
      case 1:
        {
          const sourceBytes = Buffer.from(SOURCE_BYTES);
          fake.decodedSensitive.push(sourceBytes);
        return {
          kind: "transform_request",
          metadata: {
            requestId: fake.requestId,
            deadlineAt: DEADLINE,
            invocation: INVOCATION,
            permitEnvelope: ENVELOPE,
          },
          sourceBytes,
        };
        }
      case 2:
        {
          const outputBytes = Buffer.from(CANDIDATE_BYTES);
          fake.decodedSensitive.push(outputBytes);
        return {
          kind: "transform_success",
          metadata: { requestId: fake.requestId, report: REPORT },
          outputBytes,
        };
        }
      case 3:
        {
          const sourceBytes = Buffer.from(SOURCE_BYTES);
          const candidateBytes = Buffer.from(CANDIDATE_BYTES);
          fake.decodedSensitive.push(sourceBytes, candidateBytes);
        return {
          kind: "fresh_verifier_request",
          metadata: {
            requestId: fake.requestId,
            deadlineAt: DEADLINE,
            invocation: INVOCATION,
            permitEnvelope: ENVELOPE,
            report: REPORT,
          },
          sourceBytes,
          candidateBytes,
        };
        }
      case 4:
        return {
          kind: "fresh_verifier_success",
          metadata: {
            requestId: fake.requestId,
            requestWireSha256: sha256(VERIFIER_REQUEST_WIRE),
            deadlineAt: DEADLINE,
            invocationSha256: INVOCATION_DIGEST,
            permitPayloadSha256: PERMIT_DIGEST,
            source: { kind: "source", sizeBytes: SOURCE_BYTES.byteLength, sha256: sha256(SOURCE_BYTES) },
            candidate: { kind: "candidate", sizeBytes: CANDIDATE_BYTES.byteLength, sha256: sha256(CANDIDATE_BYTES) },
            reportSha256: REPORT_DIGEST,
            ...fake.freshResponseOverrides,
          },
        };
      default:
        throw new Error("unknown fixture marker");
    }
  };
}

function randomGenerator(): (size: number) => Uint8Array {
  let value = 0;
  return (size) => {
    value += 1;
    return Buffer.alloc(size, value);
  };
}

class MemoryPermitLeaseStore implements LocalOfflinePreviewPermitLeaseStore {
  readonly consumed = new Set<string>();
  auditCount = 0;
  closeCount = 0;
  allowReplay = false;
  beforeReserve: (() => Promise<void>) | null = null;
  beforeAudit: (() => Promise<void>) | null = null;
  failClose = false;

  constructor(readonly onReserve?: () => void) {}

  async reserve(input: LocalOfflinePreviewPermitLeaseInput) {
    await Promise.resolve();
    await this.beforeReserve?.();
    if (!this.allowReplay && this.consumed.has(input.permitPayloadSha256)) {
      throw new LocalOfflinePreviewPermitLeaseError("PERMIT_ALREADY_CONSUMED");
    }
    this.onReserve?.();
    this.consumed.add(input.permitPayloadSha256);
    return Object.freeze({
      permitPayloadSha256: input.permitPayloadSha256,
      requestId: input.requestId,
      expiresAt: input.expiresAt,
      consumedAt: new Date(NOW).toISOString(),
    });
  }

  async audit() {
    await Promise.resolve();
    await this.beforeAudit?.();
    this.auditCount += 1;
    return Object.freeze({
      totalPermanentTombstones: this.consumed.size,
      unexpiredTombstones: this.consumed.size,
      expiredTombstonesRetained: 0,
    });
  }

  async close(): Promise<void> {
    await Promise.resolve();
    this.closeCount += 1;
    if (this.failClose) throw new Error("fixture close failure");
  }
}

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let release = (): void => {
    throw new Error("Deferred promise was not initialized.");
  };
  const promise = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return Object.freeze({ promise, resolve: release });
}

async function backendFixture(
  fake: FakeDocker,
  permitLeaseStore: LocalOfflinePreviewPermitLeaseStore = new MemoryPermitLeaseStore(),
  preflight: LocalOfflinePreviewContainerPreflightDependencies =
    preflightDependencies(fake.config),
  commandExecutor: LocalOfflinePreviewDockerCommandExecutor = fake.execute,
) {
  return await __testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox({
    configurationInput: fake.config,
    pinnedTrustedPermitKeys: new Map<string, KeyObject>(),
  }, {
    preflightDependencies: preflight,
    commandExecutor,
    randomBytes: randomGenerator(),
    now: () => NOW,
    decodeWire: decoder(fake),
    verifyPermit: fakeVerifyPermit,
    computeInvocationSha256: () => INVOCATION_DIGEST,
    computeReportSha256: () => REPORT_DIGEST,
    permitLeaseStore,
  });
}

async function reserve(fake: FakeDocker) {
  const backend = await backendFixture(fake);
  const session = await backend.reserveSession({
    invocation: INVOCATION,
    permitEnvelope: ENVELOPE,
    deadlineAt: DEADLINE,
  });
  return { backend, session };
}

function expectStableError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(LocalOfflinePreviewDockerSandboxError);
  expect((error as LocalOfflinePreviewDockerSandboxError).code).toBe(code);
  const serialized = JSON.stringify(error);
  expect(serialized).not.toContain(DOCKER_PATH);
  expect(serialized).not.toContain(SECCOMP_PATH);
  expect(serialized).not.toContain("stderr");
  expect(serialized).not.toMatch(/[a-f0-9]{64}/u);
}

describe("local offline preview Docker sandbox runner", () => {
  it("preserves an unconfirmed preflight process termination instead of masking it", async () => {
    const fake = new FakeDocker(configuration());
    const base = preflightDependencies(fake.config);
    const preflightWithUnconfirmedTermination:
    LocalOfflinePreviewContainerPreflightDependencies = {
      ...base,
      commandProbe: () => Promise.resolve({
        outcome: "termination_unconfirmed" as const,
      }),
    };

    await expect(backendFixture(
      fake,
      new MemoryPermitLeaseStore(),
      preflightWithUnconfirmedTermination,
    )).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    expect(fake.requests).toHaveLength(0);
  });

  it("preflights, reserves and inspects two source-free no-mount containers before stdin", async () => {
    const fake = new FakeDocker(configuration());
    const { backend, session } = await reserve(fake);
    expect(backend.runtimeMode).toBe("test_only_disabled");
    expect(backend.liveAuthorityCapable).toBe(false);
    expect(backend.authority).toBe("none");
    expect(backend.toJSON()).toEqual({
      runtimeMode: "test_only_disabled",
      liveAuthorityCapable: false,
      authority: "none",
      productionUse: "disabled",
    });
    expect(session.requestId).toMatch(/^[a-f0-9]{32}$/u);
    const reservedRequestId = session.requestId;
    const reservedDeadline = session.deadlineAt;
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(session))).toBe(true);
    expect(Reflect.defineProperty(session, "requestId", {
      value: "f".repeat(32),
    })).toBe(false);
    expect(Reflect.defineProperty(session, "deadlineAt", {
      value: "2099-01-01T00:00:00.000Z",
    })).toBe(false);
    expect(session.requestId).toBe(reservedRequestId);
    expect(session.deadlineAt).toBe(reservedDeadline);
    const createRequests = fake.requests.filter((request) => request.arguments[1] === "create");
    expect(createRequests).toHaveLength(2);
    expect(fake.requests.some((request) => request.arguments[1] === "start")).toBe(false);
    for (const request of createRequests) {
      expect(request.stdin).toBeNull();
      expect(request.arguments).toContain("--pull=never");
      expect(request.arguments).toContain("--network=none");
      expect(request.arguments).toContain("--read-only");
      expect(request.arguments).toContain("--cap-drop=ALL");
      expect(request.arguments).toContain("--security-opt=no-new-privileges=true");
      expect(request.arguments).toContain("--pid=private");
      expect(request.arguments).toContain("--cgroupns=private");
      expect(request.arguments).toContain("--log-driver=none");
      expect(request.arguments.join(" ")).not.toMatch(/--mount|--volume|-v(?:=|\s)|docker\.sock/u);
    }
    await session.stop();
    expect(fake.containers.size).toBe(0);
  });

  it("runs exact framed transform then fresh verifier and keeps serialized claims false", async () => {
    const fake = new FakeDocker(configuration());
    const { session } = await reserve(fake);
    const transformed = await session.runTransform(TRANSFORM_REQUEST_WIRE);
    expect(transformed.outputBytes).toEqual(CANDIDATE_BYTES);
    expect(Object.isFrozen(transformed.report)).toBe(true);
    expect(Object.isFrozen(transformed.report.source)).toBe(true);
    expect(Reflect.set(
      transformed.report.source,
      "sha256",
      DIGEST("f"),
    )).toBe(false);
    expect(transformed.report.source.sha256).toBe(sha256(SOURCE_BYTES));
    expect(transformed.receiptClaim.sandboxEstablished).toBe(false);
    const verified = await session.runFreshVerifier(VERIFIER_REQUEST_WIRE);
    expect(verified.receiptClaim.sandboxEstablished).toBe(false);
    expect(verified.evidenceClaim.sandboxEstablished).toBe(false);
    expect(verified.liveWitness).toBeNull();
    const forgedWitness = {
      sandboxEstablished: true,
      backend: "docker_linux_shared_kernel",
      requestId: session.requestId,
    };
    expect(isLocalOfflinePreviewDockerSandboxLiveWitness(forgedWitness)).toBe(false);
    expect(localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence(
      forgedWitness,
      verified.evidenceClaim,
    )).toBe(false);
    const starts = fake.requests.filter((request) => request.arguments[1] === "start");
    expect(starts.map((request) => request.stdin)).toEqual([
      TRANSFORM_REQUEST_WIRE,
      VERIFIER_REQUEST_WIRE,
    ]);
    expect(fake.containers.size).toBe(0);
    expect(fake.decodedSensitive.length).toBeGreaterThanOrEqual(4);
    expect(fake.decodedSensitive.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("atomically consumes the verified permit digest before the first container create", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore(() => {
      expect(fake.requests.some((request) => request.arguments[1] === "create")).toBe(false);
    });
    const backend = await backendFixture(fake, store);
    const first = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    await first.stop();
    const createsBeforeReplay = fake.requests.filter((request) =>
      request.arguments[1] === "create").length;
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "PERMIT_REPLAY_REJECTED" });
    expect(fake.requests.filter((request) => request.arguments[1] === "create")).toHaveLength(
      createsBeforeReplay,
    );
    expect(store.auditCount).toBeGreaterThanOrEqual(3);
  });

  it("blocks new work, waits for an in-flight permit reservation, and closes once", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const reserveEntered = deferred();
    const releaseReserve = deferred();
    store.beforeReserve = async () => {
      reserveEntered.resolve();
      await releaseReserve.promise;
    };
    const reservation = backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    await reserveEntered.promise;

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    const reservationRejection = expect(reservation).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "BACKEND_STOPPED" });
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
    expect(store.closeCount).toBe(0);
    expect(fake.requests.filter((request) => request.arguments[1] === "create")).toHaveLength(0);

    releaseReserve.resolve();
    await reservationRejection;
    await expect(firstStop).resolves.toBeUndefined();
    await expect(secondStop).resolves.toBeUndefined();
    expect(store.closeCount).toBe(1);
    expect(backend.stopAll()).toBe(firstStop);
    expect(fake.containers.size).toBe(0);
  });

  it("shares terminal shutdown while draining an already-created session", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    expect(fake.containers.size).toBe(2);

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await firstStop;

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
    await expect(session.stop()).resolves.toBeUndefined();
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "BACKEND_STOPPED" });
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
  });

  it("waits for an already-started reconciliation before closing its store", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const auditEntered = deferred();
    const releaseAudit = deferred();
    store.beforeAudit = async () => {
      auditEntered.resolve();
      await releaseAudit.promise;
    };
    const reconciliation = backend.reconcileExpired();
    await auditEntered.promise;

    const stop = backend.stopAll();
    expect(store.closeCount).toBe(0);
    releaseAudit.resolve();
    await expect(reconciliation).resolves.toBeUndefined();
    await expect(stop).resolves.toBeUndefined();

    expect(store.closeCount).toBe(1);
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
  });

  it("permanently quarantines the backend after an ambiguous permit-ledger audit", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    store.beforeAudit = () => Promise.reject(new Error("ledger read became ambiguous"));

    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "PERMIT_LEDGER_REJECTED",
    });
    const requestsAfterFailure = fake.requests.length;
    store.beforeAudit = null;

    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "PERMIT_LEDGER_REJECTED",
    });
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "PERMIT_LEDGER_REJECTED" });
    expect(fake.requests).toHaveLength(requestsAfterFailure);
    await expect(backend.stopAll()).rejects.toMatchObject({
      code: "PERMIT_LEDGER_REJECTED",
    });
    expect(store.closeCount).toBe(1);
  });

  it("permanently quarantines the backend after an ambiguous permit reservation", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    store.beforeReserve = () => Promise.reject(
      new Error("ledger write outcome is unknown"),
    );

    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "PERMIT_LEDGER_REJECTED" });
    const requestsAfterFailure = fake.requests.length;
    store.beforeReserve = null;

    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "PERMIT_LEDGER_REJECTED" });
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "PERMIT_LEDGER_REJECTED",
    });
    expect(fake.requests).toHaveLength(requestsAfterFailure);
  });

  it("serializes a direct session stop with backend shutdown cleanup", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });

    const directStop = session.stop();
    const backendStop = backend.stopAll();
    await expect(Promise.all([directStop, backendStop])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
    expect(fake.requests.filter((request) => request.arguments[1] === "rm")).toHaveLength(2);
  });

  it("cancels publication from an active transform and preserves the synchronous wire snapshot", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    const startEntered = deferred();
    const releaseStart = deferred();
    fake.beforeStart = async () => {
      startEntered.resolve();
      await releaseStart.promise;
    };
    const mutableWire = Buffer.from(TRANSFORM_REQUEST_WIRE);
    const transform = session.runTransform(mutableWire);
    mutableWire[0] = 99;
    await startEntered.promise;

    const stop = backend.stopAll();
    expect(store.closeCount).toBe(0);
    await expect(session.runFreshVerifier(VERIFIER_REQUEST_WIRE)).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
    releaseStart.resolve();
    await expect(transform).rejects.toMatchObject({ code: "BACKEND_STOPPED" });
    await expect(stop).resolves.toBeUndefined();

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
    expect(
      fake.requests.find((request) => request.arguments[1] === "start")?.stdin,
    ).toEqual(TRANSFORM_REQUEST_WIRE);
  });

  it("cannot publish verifier evidence after terminal shutdown begins", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    await session.runTransform(TRANSFORM_REQUEST_WIRE);
    const verifierEntered = deferred();
    const releaseVerifier = deferred();
    fake.beforeStart = async () => {
      verifierEntered.resolve();
      await releaseVerifier.promise;
    };
    const verification = session.runFreshVerifier(VERIFIER_REQUEST_WIRE);
    await verifierEntered.promise;

    const stop = backend.stopAll();
    releaseVerifier.resolve();
    await expect(verification).rejects.toMatchObject({ code: "BACKEND_STOPPED" });
    await expect(stop).resolves.toBeUndefined();

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
  });

  it("direct session stop cancels an active verifier before it can publish evidence", async () => {
    const fake = new FakeDocker(configuration());
    const { backend, session } = await reserve(fake);
    await session.runTransform(TRANSFORM_REQUEST_WIRE);
    const verifierEntered = deferred();
    const releaseVerifier = deferred();
    fake.beforeStart = async () => {
      verifierEntered.resolve();
      await releaseVerifier.promise;
    };
    const verification = session.runFreshVerifier(VERIFIER_REQUEST_WIRE);
    await verifierEntered.promise;

    const directStop = session.stop();
    let directStopSettled = false;
    void directStop.then(
      () => { directStopSettled = true; },
      () => { directStopSettled = true; },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(directStopSettled).toBe(false);
    expect(fake.containers.size).toBe(1);
    releaseVerifier.resolve();
    await expect(verification).rejects.toMatchObject({ code: "EXECUTION_CANCELLED" });
    await expect(directStop).resolves.toBeUndefined();
    expect(fake.containers.size).toBe(0);
    await expect(backend.stopAll()).resolves.toBeUndefined();
  });

  it("keeps returning the same failed cleanup proof from direct session stop", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    fake.failRemove = true;

    const firstStop = session.stop();
    const secondStop = session.stop();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    const thirdStop = session.stop();
    expect(thirdStop).toBe(firstStop);
    await expect(thirdStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });

    const backendStop = backend.stopAll();
    await expect(backendStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(backend.stopAll()).toBe(backendStop);
    expect(store.closeCount).toBe(1);
    expect(fake.containers.size).toBe(2);
  });

  it("blocks every remaining session phase after one session poisons cleanup", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    store.allowReplay = true;
    const backend = await backendFixture(fake, store);
    const sessionA = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    const sessionB = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    await sessionB.runTransform(TRANSFORM_REQUEST_WIRE);
    const startsBeforePoison = fake.requests.filter((request) =>
      request.arguments[1] === "start").length;

    fake.failRemove = true;
    await expect(sessionA.stop()).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    fake.failRemove = false;

    await expect(sessionB.runTransform(TRANSFORM_REQUEST_WIRE)).rejects.toMatchObject({
      code: "CLEANUP_UNPROVED",
    });
    await expect(sessionB.runFreshVerifier(VERIFIER_REQUEST_WIRE)).rejects.toMatchObject({
      code: "CLEANUP_UNPROVED",
    });
    expect(fake.requests.filter((request) => request.arguments[1] === "start")).toHaveLength(
      startsBeforePoison,
    );
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(store.closeCount).toBe(1);
    expect(fake.containers.size).toBe(2);
  });

  it("keeps termination-unconfirmed poison above a direct stop cancellation", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    const startEntered = deferred();
    const releaseStart = deferred();
    fake.beforeStart = async () => {
      startEntered.resolve();
      await releaseStart.promise;
    };
    fake.startOutcome = { outcome: "termination_unconfirmed" };
    const transform = session.runTransform(TRANSFORM_REQUEST_WIRE);
    await startEntered.promise;
    const directStop = session.stop();
    const transformRejection = expect(transform).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    const directStopRejection = expect(directStop).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    releaseStart.resolve();
    await transformRejection;
    await directStopRejection;
    expect(fake.containers.size).toBe(0);

    const backendStop = backend.stopAll();
    await expect(backendStop).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    expect(backend.stopAll()).toBe(backendStop);
    expect(store.closeCount).toBe(1);
  });

  it("keeps termination-unconfirmed poison above backend shutdown cancellation", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const session = await backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    const startEntered = deferred();
    const releaseStart = deferred();
    fake.beforeStart = async () => {
      startEntered.resolve();
      await releaseStart.promise;
    };
    fake.startOutcome = { outcome: "termination_unconfirmed" };
    const transform = session.runTransform(TRANSFORM_REQUEST_WIRE);
    await startEntered.promise;
    const backendStop = backend.stopAll();
    const transformRejection = expect(transform).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    const stopRejection = expect(backendStop).rejects.toMatchObject({
      code: "PROCESS_TERMINATION_UNCONFIRMED",
    });
    releaseStart.resolve();
    await transformRejection;
    await stopRejection;

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
    expect(backend.stopAll()).toBe(backendStop);
  });

  it("removes both containers instead of publishing a session created during stopping", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const secondCreateAccepted = deferred();
    const releaseSecondCreate = deferred();
    let createCount = 0;
    fake.afterCreate = async () => {
      createCount += 1;
      if (createCount === 2) {
        secondCreateAccepted.resolve();
        await releaseSecondCreate.promise;
      }
    };
    const backend = await backendFixture(fake, store);
    const reservation = backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    });
    await secondCreateAccepted.promise;
    expect(fake.containers.size).toBe(2);

    const stop = backend.stopAll();
    const reservationRejection = expect(reservation).rejects.toMatchObject({
      code: "BACKEND_STOPPED",
    });
    releaseSecondCreate.resolve();
    await reservationRejection;
    await expect(stop).resolves.toBeUndefined();

    expect(fake.containers.size).toBe(0);
    expect(store.closeCount).toBe(1);
    expect(backend.stopAll()).toBe(stop);
  });

  it("never turns a quarantined backend into a successful later shutdown", async () => {
    const fake = new FakeDocker(configuration());
    fake.createOutcomeAfterAccept = { outcome: "timed_out" };
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(backend.stopAll()).toBe(firstStop);
    expect(store.closeCount).toBe(1);
    expect(fake.containers.size).toBe(1);
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "CLEANUP_UNPROVED",
    });
  });

  it("caches a permit-store close failure and never retries or reopens", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    store.failClose = true;
    const backend = await backendFixture(fake, store);

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "PERMIT_LEDGER_REJECTED" });
    await expect(secondStop).rejects.toMatchObject({ code: "PERMIT_LEDGER_REJECTED" });
    expect(backend.stopAll()).toBe(firstStop);
    expect(store.closeCount).toBe(1);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "BACKEND_STOPPED" });
  });

  it.each([
    ["malformed create output", completed(Buffer.from("not-a-container-id\n")), "RESERVATION_FAILED"],
    ["completed create failure", {
      outcome: "completed",
      exitCode: 1,
      stdout: Buffer.alloc(0),
      stderrByteLength: 0,
    } as const, "RESERVATION_FAILED"],
  ])("finds and removes a container after %s", async (_label, outcome, code) => {
    const fake = new FakeDocker(configuration());
    fake.createOutcomeAfterAccept = outcome;
    const backend = await backendFixture(fake);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code });
    expect(fake.containers.size).toBe(0);
  });

  it.each([
    ["timeout", { outcome: "timed_out" } as const],
    ["output limit", { outcome: "output_limit_exceeded" } as const],
    ["unconfirmed termination", { outcome: "termination_unconfirmed" } as const],
  ])("blocks with cleanup unproved after an uncertain create %s", async (_label, outcome) => {
    const fake = new FakeDocker(configuration());
    fake.createOutcomeAfterAccept = outcome;
    const backend = await backendFixture(fake);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(fake.containers.size).toBe(1);
    const requestCount = fake.requests.length;
    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "CLEANUP_UNPROVED",
    });
    expect(fake.requests).toHaveLength(requestCount);
  });

  it("quarantines a rejected create command because daemon-side creation is uncertain", async () => {
    const fake = new FakeDocker(configuration());
    fake.afterCreate = () => Promise.reject(
      new Error("executor promise rejected after create was accepted"),
    );
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(fake.containers.size).toBe(1);
    expect(store.closeCount).toBe(1);
  });

  it("retains failed cleanup state when post-create validation cannot remove the container", async () => {
    const fake = new FakeDocker(configuration());
    fake.afterCreate = () => {
      const created = [...fake.containers.values()].at(-1);
      if (created === undefined) throw new Error("created container fixture missing");
      created.inspect.Name = "/tampered-after-create";
      fake.failRemove = true;
      return Promise.resolve();
    };
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(fake.containers.size).toBe(1);

    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(store.closeCount).toBe(1);
    expect(fake.containers.size).toBe(1);
  });

  it("rejects a hostile caller signal before any container process command", async () => {
    const fake = new FakeDocker(configuration());
    const { session } = await reserve(fake);
    const startCount = fake.requests.filter((request) => request.arguments[1] === "start").length;
    let signalGetTraps = 0;
    const hostileSignal = new Proxy(new AbortController().signal, {
      get: () => {
        signalGetTraps += 1;
        throw new Error("caller signal methods must never be used");
      },
    });

    await expect(
      session.runTransform(TRANSFORM_REQUEST_WIRE, hostileSignal),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    expect(signalGetTraps).toBe(0);
    expect(fake.requests.filter((request) => request.arguments[1] === "start")).toHaveLength(
      startCount,
    );
    await session.stop();

    const directExecutorResult = await defaultLocalOfflinePreviewDockerCommandExecutor({
      executablePath: process.execPath,
      arguments: ["-e", "process.exit(91)"],
      stdin: null,
      timeoutMilliseconds: 1_000,
      maximumStdoutBytes: 1_024,
      maximumStderrBytes: 1_024,
      signal: hostileSignal,
    });
    expect(directExecutorResult).toEqual({ outcome: "failed_to_start" });
    expect(signalGetTraps).toBe(0);
  });

  it("snapshots exact data descriptors before await and never invokes getters or Proxy get traps", async () => {
    const getterFake = new FakeDocker(configuration());
    const getterBackend = await backendFixture(getterFake);
    const commandCount = getterFake.requests.length;
    let getterCalls = 0;
    const hostile = Object.defineProperties({}, {
      invocation: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return INVOCATION;
        },
      },
      permitEnvelope: { enumerable: true, value: ENVELOPE },
      deadlineAt: { enumerable: true, value: DEADLINE },
    }) as LocalOfflinePreviewDockerSandboxReservationInput;
    await expect(getterBackend.reserveSession(hostile)).rejects.toMatchObject({
      code: "RESERVATION_INPUT_REJECTED",
    });
    expect(getterCalls).toBe(0);
    expect(getterFake.requests).toHaveLength(commandCount);

    const proxyFake = new FakeDocker(configuration());
    const proxyBackend = await backendFixture(proxyFake);
    let getTraps = 0;
    const proxied = new Proxy({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    }, {
      get: () => {
        getTraps += 1;
        throw new Error("Proxy get trap must not be reached.");
      },
    });
    const session = await proxyBackend.reserveSession(proxied);
    expect(getTraps).toBe(0);
    await session.stop();
  });

  it.each([
    ["timed_out", { outcome: "timed_out" } as const, "EXECUTION_TIMED_OUT"],
    ["output limited", { outcome: "output_limit_exceeded" } as const, "WIRE_OUTPUT_LIMIT_EXCEEDED"],
    ["aborted", { outcome: "aborted" } as const, "EXECUTION_CANCELLED"],
    ["unconfirmed termination", { outcome: "termination_unconfirmed" } as const, "PROCESS_TERMINATION_UNCONFIRMED"],
  ])("cleans both reservations after a %s start", async (_label, outcome, code) => {
    const fake = new FakeDocker(configuration());
    const { session } = await reserve(fake);
    fake.startOutcome = outcome;
    let caught: unknown;
    try {
      await session.runTransform(TRANSFORM_REQUEST_WIRE);
    } catch (error: unknown) {
      caught = error;
    }
    expectStableError(caught, code);
    expect(fake.containers.size).toBe(0);
    const cleanupRequests = fake.requests.filter((request) =>
      request.arguments[1] === "rm" || request.arguments[1] === "ls");
    expect(cleanupRequests.length).toBeGreaterThanOrEqual(4);
    expect(cleanupRequests.every((request) => request.signal === undefined)).toBe(true);
  });

  it("rejects a terminal-state mismatch and still proves both labels absent", async () => {
    const fake = new FakeDocker(configuration());
    const { session } = await reserve(fake);
    fake.terminalExitCode = 17;
    await expect(session.runTransform(TRANSFORM_REQUEST_WIRE)).rejects.toMatchObject({
      code: "TERMINAL_STATE_REJECTED",
    });
    expect(fake.containers.size).toBe(0);
  });

  it("revalidates the Docker executable and seccomp profile before lifecycle commands", async () => {
    const config = configuration();
    const fake = new FakeDocker(config);
    const base = preflightDependencies(config);
    const baseProbe = base.fileProbe;
    if (baseProbe === undefined) throw new Error("fixture file probe is required");
    let probes = 0;
    const changing: LocalOfflinePreviewContainerPreflightDependencies = {
      ...base,
      fileProbe: async (request) => {
        probes += 1;
        const result = await baseProbe(request);
        if (
          probes > 2 && request.absolutePath === config.seccompProfilePath &&
          result.outcome === "ok"
        ) {
          return { ...result, contents: Buffer.from("changed-profile") };
        }
        return result;
      },
    };
    await expect(backendFixture(
      fake,
      new MemoryPermitLeaseStore(),
      changing,
    )).rejects.toMatchObject({ code: "LIFECYCLE_FILE_IDENTITY_REJECTED" });
    expect(fake.requests).toHaveLength(0);
  });

  it("preserves a proved pre-spawn lifecycle failure without poisoning the backend", async () => {
    const config = configuration();
    const fake = new FakeDocker(config);
    const store = new MemoryPermitLeaseStore();
    const base = preflightDependencies(config);
    const baseProbe = base.fileProbe;
    if (baseProbe === undefined) throw new Error("fixture file probe is required");
    let invalidateLifecycle = false;
    let armAfterReservationReconcile = false;
    const changing: LocalOfflinePreviewContainerPreflightDependencies = {
      ...base,
      fileProbe: async (request) => {
        const result = await baseProbe(request);
        if (
          invalidateLifecycle &&
          request.absolutePath === config.seccompProfilePath &&
          result.outcome === "ok"
        ) return { ...result, contents: Buffer.from("changed-before-spawn") };
        return result;
      },
    };
    const executor: LocalOfflinePreviewDockerCommandExecutor = async (request) => {
      const result = await fake.execute(request);
      if (
        armAfterReservationReconcile &&
        request.arguments[0] === "container" && request.arguments[1] === "ls"
      ) invalidateLifecycle = true;
      return result;
    };
    const backend = await backendFixture(fake, store, changing, executor);
    armAfterReservationReconcile = true;
    const createsBefore = fake.requests.filter((request) =>
      request.arguments[1] === "create").length;

    await expect(backend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "LIFECYCLE_FILE_IDENTITY_REJECTED" });
    expect(fake.requests.filter((request) => request.arguments[1] === "create")).toHaveLength(
      createsBefore,
    );
    expect(fake.containers.size).toBe(0);

    invalidateLifecycle = false;
    armAfterReservationReconcile = false;
    await expect(backend.reconcileExpired()).resolves.toBeUndefined();
    await expect(backend.stopAll()).resolves.toBeUndefined();
    expect(store.closeCount).toBe(1);
  });

  it("cleans reservations when request decoding or verifier response binding fails", async () => {
    const invalidRequestFake = new FakeDocker(configuration());
    const invalidRequest = await reserve(invalidRequestFake);
    await expect(invalidRequest.session.runTransform(Buffer.from([99]))).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
    });
    expect(invalidRequestFake.containers.size).toBe(0);

    const verifierFake = new FakeDocker(configuration());
    const verifier = await reserve(verifierFake);
    await verifier.session.runTransform(TRANSFORM_REQUEST_WIRE);
    verifierFake.freshResponseOverrides = { requestWireSha256: DIGEST("0") };
    await expect(verifier.session.runFreshVerifier(VERIFIER_REQUEST_WIRE)).rejects.toMatchObject({
      code: "WORKER_RESPONSE_REJECTED",
    });
    expect(verifierFake.containers.size).toBe(0);
  });

  it("removes expired exact-label reservations, blocks live ones, and leaves mismatches untouched", async () => {
    const expiredFake = new FakeDocker(configuration());
    const expiredBackend = await backendFixture(expiredFake);
    const policy = expiredBackend.policy.policyDigest;
    const staleRequestId = "1".repeat(32);
    const labels = {
      "io.omnitwin.foundry.offline-preview-sandbox.namespace": "reservation-v0",
      "io.omnitwin.foundry.offline-preview-sandbox.backend": "docker_linux_shared_kernel",
      "io.omnitwin.foundry.offline-preview-sandbox.policy": policy,
      "io.omnitwin.foundry.offline-preview-sandbox.request": staleRequestId,
      "io.omnitwin.foundry.offline-preview-sandbox.phase": "transform",
      "io.omnitwin.foundry.offline-preview-sandbox.deadline-ms": String(NOW - 1),
      "io.omnitwin.foundry.offline-preview-sandbox.session":
        sessionDigest(staleRequestId, NOW - 1, policy),
      "io.omnitwin.foundry.offline-preview-sandbox.private": DIGEST("7"),
    };
    expiredFake.seed(labels);
    const mismatchId = expiredFake.seed({
      ...labels,
      ["io.omnitwin.foundry.offline-preview-sandbox.policy"]: DIGEST("f"),
      ["io.omnitwin.foundry.offline-preview-sandbox.private"]: DIGEST("e"),
    });
    await expect(expiredBackend.reconcileExpired()).rejects.toMatchObject({
      code: "RECONCILIATION_FAILED",
    });
    expect(expiredFake.containers.has(mismatchId)).toBe(true);
    expect(expiredFake.containers.size).toBe(1);
    expiredFake.containers.delete(mismatchId);
    const requestsAfterAmbiguity = expiredFake.requests.length;
    await expect(expiredBackend.reconcileExpired()).rejects.toMatchObject({
      code: "RECONCILIATION_FAILED",
    });
    await expect(expiredBackend.reserveSession({
      invocation: INVOCATION,
      permitEnvelope: ENVELOPE,
      deadlineAt: DEADLINE,
    })).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
    expect(expiredFake.requests).toHaveLength(requestsAfterAmbiguity);

    const liveFake = new FakeDocker(configuration());
    const liveBackend = await backendFixture(liveFake);
    const liveDeadline = NOW + 60_000;
    liveFake.seed({
      ...labels,
      ["io.omnitwin.foundry.offline-preview-sandbox.policy"]: liveBackend.policy.policyDigest,
      ["io.omnitwin.foundry.offline-preview-sandbox.deadline-ms"]: String(liveDeadline),
      ["io.omnitwin.foundry.offline-preview-sandbox.session"]:
        sessionDigest(staleRequestId, liveDeadline, liveBackend.policy.policyDigest),
    });
    await expect(liveBackend.reconcileExpired()).rejects.toMatchObject({
      code: "FOREIGN_RESERVATION_ACTIVE",
    });
    expect(liveFake.containers.size).toBe(1);
  });

  it("quarantines an exact expired reservation when its removal cannot be proved", async () => {
    const fake = new FakeDocker(configuration());
    const store = new MemoryPermitLeaseStore();
    const backend = await backendFixture(fake, store);
    const policy = backend.policy.policyDigest;
    const staleRequestId = "2".repeat(32);
    const staleDeadline = NOW - 1;
    fake.seed({
      "io.omnitwin.foundry.offline-preview-sandbox.namespace": "reservation-v0",
      "io.omnitwin.foundry.offline-preview-sandbox.backend": "docker_linux_shared_kernel",
      "io.omnitwin.foundry.offline-preview-sandbox.policy": policy,
      "io.omnitwin.foundry.offline-preview-sandbox.request": staleRequestId,
      "io.omnitwin.foundry.offline-preview-sandbox.phase": "transform",
      "io.omnitwin.foundry.offline-preview-sandbox.deadline-ms": String(staleDeadline),
      "io.omnitwin.foundry.offline-preview-sandbox.session":
        sessionDigest(staleRequestId, staleDeadline, policy),
      "io.omnitwin.foundry.offline-preview-sandbox.private": DIGEST("8"),
    });
    fake.failRemove = true;

    await expect(backend.reconcileExpired()).rejects.toMatchObject({
      code: "CLEANUP_UNPROVED",
    });
    const firstStop = backend.stopAll();
    const secondStop = backend.stopAll();
    expect(secondStop).toBe(firstStop);
    await expect(firstStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    await expect(secondStop).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(backend.stopAll()).toBe(firstStop);
    expect(store.closeCount).toBe(1);
    expect(fake.containers.size).toBe(1);
  });

  it("rejects backend creation when exact-orphan cleanup cannot be proved", async () => {
    const config = configuration();
    const fake = new FakeDocker(config);
    const policy = compileLocalOfflinePreviewSandboxPolicy(config);
    if (policy === null) throw new TypeError("Expected a valid sandbox policy.");
    const staleRequestId = "3".repeat(32);
    const staleDeadline = NOW - 1;
    fake.seed({
      "io.omnitwin.foundry.offline-preview-sandbox.namespace": "reservation-v0",
      "io.omnitwin.foundry.offline-preview-sandbox.backend": "docker_linux_shared_kernel",
      "io.omnitwin.foundry.offline-preview-sandbox.policy": policy.policyDigest,
      "io.omnitwin.foundry.offline-preview-sandbox.request": staleRequestId,
      "io.omnitwin.foundry.offline-preview-sandbox.phase": "transform",
      "io.omnitwin.foundry.offline-preview-sandbox.deadline-ms":
        String(staleDeadline),
      "io.omnitwin.foundry.offline-preview-sandbox.session":
        sessionDigest(staleRequestId, staleDeadline, policy.policyDigest),
      "io.omnitwin.foundry.offline-preview-sandbox.private": DIGEST("9"),
    });
    fake.failRemove = true;

    await expect(backendFixture(
      fake,
      new MemoryPermitLeaseStore(),
    )).rejects.toMatchObject({ code: "CLEANUP_UNPROVED" });
    expect(fake.containers.size).toBe(1);
  });

  it("keeps production construction dependency-free and uses drain-aware bounded stdin", async () => {
    await expect(createLocalOfflineNormalizationPreviewDockerSandbox()).rejects.toMatchObject({
      code: "BUNDLED_RELEASE_UNAVAILABLE",
    });
    const source = await readFile(new URL("../local-offline-normalization-preview-docker-sandbox.ts", import.meta.url), "utf8");
    const productionStart = source.indexOf(
      "export async function createLocalOfflineNormalizationPreviewDockerSandbox",
    );
    const productionSignature = source.slice(
      productionStart,
      source.indexOf("{", productionStart),
    );
    expect(productionSignature).not.toContain("dependencies:");
    expect(productionSignature).not.toContain("configurationInput");
    expect(productionSignature).not.toContain("pinnedTrustedPermitKeys");
    const lookupCheck = source.indexOf('if (lookup.status !== "available")');
    const productionLedgerOpen = source.indexOf(
      "createLocalOfflinePreviewProductionPermitLeaseStore()",
      lookupCheck,
    );
    const productionBackendCall = source.indexOf("return await createBackend(options", lookupCheck);
    expect(lookupCheck).toBeGreaterThan(productionStart);
    expect(productionLedgerOpen).toBeGreaterThan(lookupCheck);
    expect(productionBackendCall).toBeGreaterThan(lookupCheck);
    expect(source).toContain('child.stdin.once("drain", pump)');
    expect(source).toContain('spawnedChild.once("close"');
    expect(source).toContain('spawnedChild.stdin.on("error", streamError)');
    expect(source).toContain('spawnedChild.stdout.on("error", streamError)');
    expect(source).toContain('spawnedChild.stderr.on("error", streamError)');
    expect(source).toContain('outcome: "termination_unconfirmed"');
    expect(source).toContain("PROCESS_TERMINATION_CONFIRMATION_MS");
    expect(source).toContain("revalidateLifecycleFiles");
    expect(source).toContain("evidenceDigest: evidence.evidenceDigest");
    expect(source).toContain("permitPayloadSha256: this.#permitPayloadSha256");
    expect(source).toContain("invocationSha256: this.#invocationSha256");
    expect(source).toContain("mintAuthority !== liveWitnessMintAuthority");
    expect(source).toContain("mintAuthority !== sessionMintAuthority");
    expect(source).toContain("Object.freeze(LiveWitness.prototype)");
    expect(source).toContain("Object.freeze(Session.prototype)");
    expect(source).toContain("maximumStdoutBytes");
    expect(source).toContain("chunks.length = 0");
    expect(source).not.toContain("sandboxEstablished: true as const");
    const constructionClose = source.indexOf("let closeFailed = false", productionBackendCall);
    const uncertaintyPrecedence = source.indexOf(
      'originalCode === "PROCESS_TERMINATION_UNCONFIRMED"',
      constructionClose,
    );
    const ledgerClosePrecedence = source.indexOf(
      'if (closeFailed) fail("PERMIT_LEDGER_REJECTED")',
      constructionClose,
    );
    expect(constructionClose).toBeGreaterThan(productionBackendCall);
    expect(uncertaintyPrecedence).toBeGreaterThan(constructionClose);
    expect(ledgerClosePrecedence).toBeGreaterThan(uncertaintyPrecedence);
  });

  it("streams real child stdin through drain backpressure and confirms timeout termination", async () => {
    const input = Buffer.alloc(2 * 1024 * 1024, 7);
    const streamed = await defaultLocalOfflinePreviewDockerCommandExecutor({
      executablePath: process.execPath,
      arguments: [
        "-e",
        "let n=0;process.stdin.pause();setTimeout(()=>{process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>process.stdout.write(String(n)));process.stdin.resume()},30)",
      ],
      stdin: input,
      timeoutMilliseconds: 5_000,
      maximumStdoutBytes: 1_024,
      maximumStderrBytes: 1_024,
    });
    expect(streamed).toMatchObject({ outcome: "completed", exitCode: 0 });
    if (streamed.outcome !== "completed") throw new Error("child fixture did not complete");
    expect(streamed.stdout.toString("utf8")).toBe(String(input.byteLength));
    streamed.stdout.fill(0);

    const timed = await defaultLocalOfflinePreviewDockerCommandExecutor({
      executablePath: process.execPath,
      arguments: ["-e", "setInterval(()=>{},1000)"],
      stdin: null,
      timeoutMilliseconds: 30,
      maximumStdoutBytes: 1_024,
      maximumStderrBytes: 1_024,
    });
    expect(timed).toEqual({ outcome: "timed_out" });
  });
});
