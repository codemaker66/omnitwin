import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import {
  FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0,
  FoundryLocalSandboxExecutionRequestV0Schema,
  computeFoundryLocalSandboxEnforcementReceiptSha256,
  type FoundryDeepReadonly,
  type FoundryLocalSandboxBackend,
  type FoundryLocalSandboxBackendResult,
  type FoundryLocalSandboxExecutionRequestV0,
} from "../../services/foundry-local-command-adapter.js";
import {
  FoundryLocalOsSandboxPolicyV0Schema,
  compileFoundryLocalOsSandboxInstanceSpec,
  type FoundryLocalOsSandboxInstanceSpecV0,
} from "../../services/foundry-local-os-sandbox-policy.js";

const execFileAsync = promisify(execFile);
const PROOF_LABEL = "omnitwin.foundry.local-os-sandbox-proof.v0";
const DOCKER_ENGINE_ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
const HELPER_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const EMPTY_RAW_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TERMINATION_CONTROL_SENTINEL =
  "omnitwin.foundry.termination-control.v0\n";

interface DockerCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface DockerContainerInspect {
  readonly Id: string;
  readonly Image: string;
  readonly Name: string;
  readonly Path: string;
  readonly Args: readonly string[];
  readonly Config: {
    readonly Image: string;
    readonly User: string;
    readonly Labels: Readonly<Record<string, string>>;
    readonly AttachStdin: boolean;
    readonly OpenStdin: boolean;
    readonly StdinOnce: boolean;
    readonly Tty: boolean;
    readonly StopSignal?: string;
    readonly Healthcheck?: {
      readonly Test: readonly string[];
    } | null;
  };
  readonly State: {
    readonly Status: string;
    readonly Running: boolean;
    readonly OOMKilled: boolean;
    readonly Dead: boolean;
    readonly Pid: number;
    readonly ExitCode: number;
    readonly StartedAt: string;
    readonly FinishedAt: string;
  };
  readonly HostConfig: {
    readonly Runtime: string;
    readonly NetworkMode: string;
    readonly ReadonlyRootfs: boolean;
    readonly CapAdd: readonly string[] | null;
    readonly CapDrop: readonly string[] | null;
    readonly Privileged: boolean;
    readonly Devices: readonly unknown[] | null;
    readonly DeviceRequests: readonly unknown[] | null;
    readonly PidMode: string;
    readonly CgroupnsMode: string;
    readonly SecurityOpt: readonly string[] | null;
    readonly PidsLimit: number | null;
    readonly Memory: number;
    readonly MemorySwap: number;
    readonly NanoCpus: number;
    readonly IpcMode: string;
    readonly ShmSize: number;
    readonly LogConfig: { readonly Type: string };
    readonly RestartPolicy: { readonly Name: string };
    readonly Mounts: readonly {
      readonly Type: string;
      readonly Source?: string;
      readonly Target: string;
      readonly ReadOnly?: boolean;
      readonly VolumeOptions?: { readonly NoCopy?: boolean };
      readonly TmpfsOptions?: {
        readonly SizeBytes: number;
        readonly Mode?: number;
      };
    }[] | null;
    readonly Ulimits: readonly {
      readonly Name: string;
      readonly Soft: number;
      readonly Hard: number;
    }[] | null;
  };
  readonly Mounts: readonly {
    readonly Type: string;
    readonly Name?: string;
    readonly Destination: string;
    readonly RW: boolean;
  }[];
}

interface VolumeInspect {
  readonly Name: string;
  readonly Driver: string;
  readonly Labels: Readonly<Record<string, string>>;
}

interface VolumeWitness {
  readonly directoryMode: string;
  readonly entryCount: number;
  readonly fileName: string;
  readonly fileType: string;
  readonly uid: number;
  readonly gid: number;
  readonly mode: string;
  readonly linkCount: number;
  readonly byteLength: number;
  readonly device: string;
  readonly inode: string;
  readonly rawSha256: string;
}

function isRegularFileType(value: string): boolean {
  return value === "regular file" || value === "regular empty file";
}

interface EngineReceipt {
  readonly serverVersion: string;
  readonly apiVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly kernelVersion: string;
  readonly cgroupVersion: string;
  readonly cgroupDriver: string;
  readonly securityOptions: readonly string[];
  readonly dockerRootDir: string;
  readonly driver: string;
  readonly liveRestoreEnabled: boolean;
}

export interface FoundryLocalDockerSandboxBackendOptions {
  readonly dockerExecutable: string;
  readonly securityProfilePath: string;
  readonly policy: unknown;
  readonly source: {
    readonly assetId: string;
    readonly sourceRawSha256: string;
    readonly sourceByteLength: number;
    readonly sourceVersion: string;
  };
  readonly sourceBytes: Uint8Array;
  readonly output: {
    readonly reservationId: string;
    readonly reservationSha256: string;
    readonly outputSlot: "normalized_mesh_glb";
    readonly maximumOutputBytes: number;
  };
  readonly now?: () => Date;
}

export interface FoundryLocalDockerSandboxProof {
  readonly backend: FoundryLocalSandboxBackend;
  readonly engineReceipt: () => Promise<EngineReceipt>;
  readonly inspectExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<{
    readonly spec: FoundryLocalOsSandboxInstanceSpecV0;
    readonly container: DockerContainerInspect | null;
    readonly input: VolumeWitness | null;
    readonly output: VolumeWitness | null;
  }>;
  readonly cleanupExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly createExactReservationOnlyForCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly createExactPartialLaunchForCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    phase: "data_volumes_created" | "control_volume_uninitialized",
  ) => Promise<void>;
  readonly leaveExactTerminationControlForCleanupCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly removeExactContainerForCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly persistExactDeadlineIntentForCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly persistExactOperatorStopIntentForCrashTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => Promise<void>;
  readonly setExactTerminationControlCorruptForTest: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    corrupt: boolean,
  ) => Promise<void>;
  readonly diagnostics: () => readonly string[];
}

function canonicalDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function namesFor(spec: FoundryLocalOsSandboxInstanceSpecV0) {
  const marker = spec.durableResourceMarker.markerSha256.slice(7, 31);
  const base = `otf-losp-${marker}`;
  return {
    container: base,
    reservationContainer: `${base}-reservation`,
    inputVolume: `${base}-input`,
    outputVolume: `${base}-output`,
    launchWitnessVolume: `${base}-launch-witness`,
    terminationIntentVolume: `${base}-termination-intent`,
    providerCommandRef: `local-sandbox:${marker}`,
  } as const;
}

function labelsFor(spec: FoundryLocalOsSandboxInstanceSpecV0) {
  return {
    "omnitwin.foundry.proof": PROOF_LABEL,
    "omnitwin.foundry.marker": spec.durableResourceMarker.markerSha256,
    "omnitwin.foundry.instance": spec.instanceSpecSha256,
    "omnitwin.foundry.policy": spec.policySha256,
    "omnitwin.foundry.stage-lease": spec.stageLeaseIdentitySha256,
    "omnitwin.foundry.output-reservation": spec.output.reservationSha256,
  } as const;
}

function engineIdentitySha256(receipt: EngineReceipt): string {
  return canonicalDigest(
    "OMNITWIN_FOUNDRY_LOCAL_DOCKER_ENGINE_RECEIPT_V0",
    receipt,
  );
}

function stableContainerIdentityPayload(container: DockerContainerInspect) {
  return {
    id: container.Id,
    imageId: container.Image,
    name: container.Name,
    path: container.Path,
    args: container.Args,
    config: {
      image: container.Config.Image,
      user: container.Config.User,
      labels: container.Config.Labels,
      attachStdin: container.Config.AttachStdin,
      openStdin: container.Config.OpenStdin,
      stdinOnce: container.Config.StdinOnce,
      tty: container.Config.Tty,
      stopSignal: container.Config.StopSignal ?? null,
      healthcheck: container.Config.Healthcheck ?? null,
    },
    host: {
      runtime: container.HostConfig.Runtime,
      networkMode: container.HostConfig.NetworkMode,
      readonlyRootfs: container.HostConfig.ReadonlyRootfs,
      capAdd: container.HostConfig.CapAdd,
      capDrop: container.HostConfig.CapDrop,
      privileged: container.HostConfig.Privileged,
      devices: container.HostConfig.Devices,
      deviceRequests: container.HostConfig.DeviceRequests,
      pidMode: container.HostConfig.PidMode,
      cgroupnsMode: container.HostConfig.CgroupnsMode,
      securityOpt: container.HostConfig.SecurityOpt,
      pidsLimit: container.HostConfig.PidsLimit,
      memory: container.HostConfig.Memory,
      memorySwap: container.HostConfig.MemorySwap,
      nanoCpus: container.HostConfig.NanoCpus,
      ipcMode: container.HostConfig.IpcMode,
      shmSize: container.HostConfig.ShmSize,
      logConfig: container.HostConfig.LogConfig,
      restartPolicy: container.HostConfig.RestartPolicy,
      mounts: container.HostConfig.Mounts,
      ulimits: [...(container.HostConfig.Ulimits ?? [])]
        .sort((left, right) => left.Name.localeCompare(right.Name)),
    },
    mounts: container.Mounts.map((mount) => ({
      type: mount.Type,
      name: mount.Name ?? null,
      destination: mount.Destination,
      readWrite: mount.RW,
    })).sort((left, right) => left.destination.localeCompare(right.destination)),
  };
}

function lifecycleFor(container: DockerContainerInspect):
  "queued" | "running" | "exited" | "terminated" {
  if (container.State.Running) return "running";
  if (container.State.Status === "created") return "queued";
  if (container.State.Status !== "exited" || container.State.Dead) {
    throw new Error("Docker container is neither running, created, nor cleanly exited");
  }
  return container.State.ExitCode === 143 || container.State.ExitCode === 137
    ? "terminated"
    : "exited";
}

function isDockerNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const value = error as Error & { stderr?: string; stdout?: string };
  return `${value.message}\n${value.stderr ?? ""}\n${value.stdout ?? ""}`
    .toLowerCase()
    .includes("no such");
}

function parseSingleJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error("expected exactly one Docker object");
    return parsed[0];
  }
  return parsed;
}

export function createFoundryLocalDockerSandboxBackend(
  options: FoundryLocalDockerSandboxBackendOptions,
): FoundryLocalDockerSandboxProof {
  const policy = FoundryLocalOsSandboxPolicyV0Schema.parse(options.policy);
  const diagnostics: string[] = [];
  const recordDiagnostic = (phase: string, error: unknown): void => {
    diagnostics.push(
      `${phase}:${error instanceof Error ? error.message : String(error)}`,
    );
  };
  const securityProfileBytes = readFileSync(options.securityProfilePath);
  const securityProfileValue: unknown = JSON.parse(
    securityProfileBytes.toString("utf8"),
  );
  const securityProfileCanonical = stableCanonicalJson(
    toCanonicalJson(securityProfileValue),
  );
  const pinnedSecurityProfileSha256 =
    `sha256:${rawSha256(securityProfileBytes)}`;
  if (pinnedSecurityProfileSha256 !== policy.securityProfileSha256) {
    throw new Error("pinned seccomp profile digest mismatch");
  }
  const now = options.now ?? (() => new Date());
  const dockerEnvironment: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    DOCKER_HOST: DOCKER_ENGINE_ENDPOINT,
    DOCKER_CLI_HINTS: "false",
    DOCKER_CONTENT_TRUST: "0",
  };
  const sourceBytes = Buffer.from(options.sourceBytes);
  if (
    sourceBytes.byteLength !== options.source.sourceByteLength ||
    `sha256:${rawSha256(sourceBytes)}` !== options.source.sourceRawSha256
  ) {
    throw new Error("test-only Docker backend source bytes do not match their binding");
  }

  const docker = async (
    args: readonly string[],
    timeout = 20_000,
  ): Promise<DockerCommandResult> => {
    const result = await execFileAsync(options.dockerExecutable, [...args], {
      env: dockerEnvironment,
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1_024 * 1_024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  };

  const engineReceipt = async (): Promise<EngineReceipt> => {
    const [versionResult, infoResult] = await Promise.all([
      docker(["version", "--format", "{{json .Server}}"]),
      docker(["info", "--format", "{{json .}}"]),
    ]);
    const version = JSON.parse(versionResult.stdout) as {
      Version: string;
      ApiVersion: string;
      Os: string;
      Arch: string;
      Components: readonly { Name: string; Details?: Record<string, string> }[];
    };
    const info = JSON.parse(infoResult.stdout) as {
      OSType: string;
      Architecture: string;
      KernelVersion: string;
      CgroupVersion: string;
      CgroupDriver: string;
      SecurityOptions: readonly string[];
      DockerRootDir: string;
      Driver: string;
      LiveRestoreEnabled: boolean;
    };
    if (
      version.Os !== "linux" ||
      version.Arch !== "amd64" ||
      info.OSType !== "linux" ||
      info.Architecture !== "x86_64" ||
      info.CgroupVersion !== "2" ||
      !info.SecurityOptions.some((value) => value.includes("seccomp"))
    ) {
      throw new Error("Docker engine does not meet the bounded Linux/cgroup-v2/seccomp proof profile");
    }
    const engineComponent = version.Components.find(
      (component) => component.Name === "Engine",
    );
    return {
      serverVersion: version.Version,
      apiVersion: version.ApiVersion,
      os: version.Os,
      arch: version.Arch,
      kernelVersion:
        info.KernelVersion ?? engineComponent?.Details?.KernelVersion ?? "unknown",
      cgroupVersion: info.CgroupVersion,
      cgroupDriver: info.CgroupDriver,
      securityOptions: [...info.SecurityOptions].sort(),
      dockerRootDir: info.DockerRootDir,
      driver: info.Driver,
      liveRestoreEnabled: info.LiveRestoreEnabled,
    };
  };

  const specFor = (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): FoundryLocalOsSandboxInstanceSpecV0 => {
    const request = FoundryLocalSandboxExecutionRequestV0Schema.parse(requestValue);
    return compileFoundryLocalOsSandboxInstanceSpec({
      request,
      policy,
      source: options.source,
      output: options.output,
    });
  };

  const inspectContainer = async (
    name: string,
  ): Promise<DockerContainerInspect | null> => {
    try {
      const result = await docker(["container", "inspect", name]);
      return parseSingleJson(result.stdout) as DockerContainerInspect;
    } catch (error: unknown) {
      if (isDockerNotFound(error)) return null;
      throw error;
    }
  };

  const inspectVolume = async (name: string): Promise<VolumeInspect | null> => {
    try {
      const result = await docker(["volume", "inspect", name]);
      return parseSingleJson(result.stdout) as VolumeInspect;
    } catch (error: unknown) {
      if (isDockerNotFound(error)) return null;
      throw error;
    }
  };

  const assertLabels = (
    actual: Readonly<Record<string, string>>,
    expected: Readonly<Record<string, string>>,
    kind: string,
  ): void => {
    if (!canonicalValuesEqual(Object.keys(actual).sort(), Object.keys(expected).sort())) {
      throw new Error(`${kind} label set mismatch`);
    }
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        throw new Error(`${kind} label mismatch for ${key}`);
      }
    }
  };

  const helperBase = (image: string, user: string): string[] => [
    "run",
    "--rm",
    "--pull=never",
    "--platform=linux/amd64",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--pids-limit=16",
    "--memory=134217728",
    "--memory-swap=134217728",
    "--cpus=1",
    "--ipc=none",
    "--shm-size=65536b",
    "--no-healthcheck",
    "--restart=no",
    `--user=${user}`,
    "--mount=type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=65536,tmpfs-mode=0100",
    "--entrypoint=/usr/bin/env",
    image,
    "-i",
    `PATH=${HELPER_PATH}`,
    "HOME=/nonexistent",
  ];

  const helperWithMount = (
    image: string,
    user: string,
    mount: string,
    command: readonly string[],
  ): string[] => {
    const base = helperBase(image, user);
    const entrypointIndex = base.indexOf("--entrypoint=/usr/bin/env");
    if (entrypointIndex < 0) throw new Error("helper entrypoint boundary missing");
    return [
      ...base.slice(0, entrypointIndex),
      mount,
      ...base.slice(entrypointIndex),
      ...command,
    ];
  };

  const ensureVolume = async (
    name: string,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    kind: "input" | "output",
  ): Promise<boolean> => {
    const expectedLabels = { ...labelsFor(spec), "omnitwin.foundry.volume-kind": kind };
    return ensureLabeledVolume(name, expectedLabels, `${kind} volume`);
  };

  const requireLabeledVolume = async (
    name: string,
    expectedLabels: Readonly<Record<string, string>>,
    kind: string,
  ): Promise<VolumeInspect> => {
    const volume = await inspectVolume(name);
    if (volume === null) throw new Error(`${kind} is absent`);
    if (volume.Name !== name || volume.Driver !== "local") {
      throw new Error(`${kind} name or driver mismatch`);
    }
    assertLabels(volume.Labels, expectedLabels, kind);
    return volume;
  };

  const ensureLabeledVolume = async (
    name: string,
    expectedLabels: Readonly<Record<string, string>>,
    kind: string,
  ): Promise<boolean> => {
    const existing = await inspectVolume(name);
    if (existing !== null) {
      if (existing.Name !== name || existing.Driver !== "local") {
        throw new Error(`${kind} name or driver mismatch`);
      }
      assertLabels(existing.Labels, expectedLabels, kind);
      return false;
    }
    const args = ["volume", "create", "--driver=local"];
    for (const [key, value] of Object.entries(expectedLabels)) {
      args.push("--label", `${key}=${value}`);
    }
    args.push(name);
    await docker(args);
    const created = await inspectVolume(name);
    if (created === null) throw new Error(`${kind} creation was not observable`);
    if (created.Name !== name || created.Driver !== "local") {
      throw new Error(`${kind} name or driver mismatch`);
    }
    assertLabels(created.Labels, expectedLabels, kind);
    return true;
  };

  const launchWitnessSha256 = (
    input: VolumeWitness,
    output: VolumeWitness,
  ): string => canonicalDigest(
    "OMNITWIN_FOUNDRY_LOCAL_DOCKER_LAUNCH_WITNESS_V0",
    { input, output },
  );

  const launchWitnessLabels = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    engineIdentitySha256: string,
    input: VolumeWitness,
    output: VolumeWitness,
  ) => ({
    ...labelsFor(spec),
    "omnitwin.foundry.volume-kind": "launch-witness",
    "omnitwin.foundry.engine-identity": engineIdentitySha256,
    "omnitwin.foundry.launch-witness": launchWitnessSha256(input, output),
    "omnitwin.foundry.input-device": input.device,
    "omnitwin.foundry.input-inode": input.inode,
    "omnitwin.foundry.output-device": output.device,
    "omnitwin.foundry.output-inode": output.inode,
  });

  interface LaunchWitnessIdentity {
    readonly engineIdentitySha256: string;
    readonly launchWitnessSha256: string;
    readonly inputDevice: string;
    readonly inputInode: string;
    readonly outputDevice: string;
    readonly outputInode: string;
  }

  const reservationLabels = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    engineSha256: string,
  ) => ({
    ...labelsFor(spec),
    "omnitwin.foundry.resource-kind": "launch-reservation",
    "omnitwin.foundry.engine-identity": engineSha256,
  });

  const workerLabels = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    launch: LaunchWitnessIdentity,
  ) => ({
    ...labelsFor(spec),
    "omnitwin.foundry.resource-kind": "worker",
    "omnitwin.foundry.engine-identity": launch.engineIdentitySha256,
    "omnitwin.foundry.launch-witness": launch.launchWitnessSha256,
    "omnitwin.foundry.input-device": launch.inputDevice,
    "omnitwin.foundry.input-inode": launch.inputInode,
    "omnitwin.foundry.output-device": launch.outputDevice,
    "omnitwin.foundry.output-inode": launch.outputInode,
  });

  type TerminationIntentReason = "deadline" | "operator_stop";

  const terminationControlLabels = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ) => ({
    ...labelsFor(spec),
    "omnitwin.foundry.volume-kind": "termination-control",
  });

  const readTerminationIntent = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<TerminationIntentReason | null> => {
    const names = namesFor(spec);
    const volume = await inspectVolume(names.terminationIntentVolume);
    if (volume === null) {
      throw new Error("termination control volume is absent");
    }
    if (
      volume.Name !== names.terminationIntentVolume ||
      volume.Driver !== "local"
    ) {
      throw new Error("termination control volume identity mismatch");
    }
    assertLabels(
      volume.Labels,
      terminationControlLabels(spec),
      "termination control volume",
    );
    const result = await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${names.terminationIntentVolume},destination=/volume,readonly,volume-nocopy`,
      [
        "/bin/sh",
        "-ceu",
        `dmode=$(stat -c '%a' /volume); count=$(find /volume -mindepth 1 -maxdepth 1 | wc -l); initmeta=$(stat -c '%F|%u|%g|%a|%h|%s' /volume/initialized); inithash=$(sha256sum /volume/initialized | cut -d ' ' -f 1); if test -e /volume/intent; then intentmeta=$(stat -c '%F|%u|%g|%a|%h|%s' /volume/intent); intenthash=$(sha256sum /volume/intent | cut -d ' ' -f 1); else intentmeta='absent|0|0|0|0|0'; intenthash=absent; fi; printf '%s|%s|%s|%s|%s|%s\n' "$dmode" "$count" "$initmeta" "$inithash" "$intentmeta" "$intenthash"`,
      ],
    ));
    const fields = result.stdout.trim().split("|");
    if (fields.length !== 16) {
      throw new Error("termination control witness field count mismatch");
    }
    const [
      directoryMode,
      countValue,
      initializedType,
      initializedUid,
      initializedGid,
      initializedMode,
      initializedLinks,
      initializedBytes,
      initializedHash,
      intentType,
      intentUid,
      intentGid,
      intentMode,
      intentLinks,
      intentBytes,
      intentHash,
    ] = fields;
    const count = Number(countValue);
    if (
      directoryMode !== "700" ||
      (count !== 1 && count !== 2) ||
      initializedType !== "regular file" ||
      Number(initializedUid) !== 0 ||
      Number(initializedGid) !== 0 ||
      initializedMode !== "400" ||
      Number(initializedLinks) !== 1 ||
      Number(initializedBytes) !== Buffer.byteLength(TERMINATION_CONTROL_SENTINEL) ||
      initializedHash !== rawSha256(Buffer.from(TERMINATION_CONTROL_SENTINEL))
    ) {
      throw new Error("termination control initialization witness mismatch");
    }
    if (count === 1) {
      if (
        intentType !== "absent" ||
        [intentUid, intentGid, intentMode, intentLinks, intentBytes].some(
          (value) => value !== "0",
        ) ||
        intentHash !== "absent"
      ) {
        throw new Error("termination control absent-intent witness mismatch");
      }
      return null;
    }
    if (
      intentType !== "regular file" ||
      Number(intentUid) !== 0 ||
      Number(intentGid) !== 0 ||
      intentMode !== "400" ||
      Number(intentLinks) !== 1
    ) {
      throw new Error("termination control intent metadata mismatch");
    }
    for (const reason of ["deadline", "operator_stop"] as const) {
      const bytes = Buffer.from(`${reason}\n`, "utf8");
      if (
        Number(intentBytes) === bytes.byteLength &&
        intentHash === rawSha256(bytes)
      ) {
        return reason;
      }
    }
    throw new Error("termination control intent content mismatch");
  };

  const ensureTerminationControl = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<boolean> => {
    const names = namesFor(spec);
    const created = await ensureLabeledVolume(
      names.terminationIntentVolume,
      terminationControlLabels(spec),
      "termination control volume",
    );
    if (created) {
      await docker(helperWithMount(
        spec.workerImage,
        "0:0",
        `--mount=type=volume,source=${names.terminationIntentVolume},destination=/volume,volume-nocopy`,
        [
          "/bin/sh",
          "-ceu",
          "test \"$(find /volume -mindepth 1 -maxdepth 1 | wc -l)\" -eq 0; printf '%s' \"$1\" > /volume/initialized; chmod 0400 /volume/initialized; chmod 0700 /volume; sync /volume/initialized; sync /volume",
          "foundry-termination-control-preparer",
          TERMINATION_CONTROL_SENTINEL,
        ],
      ));
    }
    if (await readTerminationIntent(spec) !== null) {
      throw new Error("termination control contains intent before launch");
    }
    return created;
  };

  const ensureTerminationIntent = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    requestedReason: TerminationIntentReason,
  ): Promise<TerminationIntentReason> => {
    const existingReason = await readTerminationIntent(spec);
    if (existingReason !== null) return existingReason;
    const names = namesFor(spec);
    await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${names.terminationIntentVolume},destination=/volume,volume-nocopy`,
      [
        "/bin/bash",
        "-ceu",
        "if (umask 077; set -o noclobber; printf '%s\\n' \"$1\" > /volume/intent) 2>/dev/null; then chmod 0400 /volume/intent; sync /volume/intent; fi; sync /volume",
        "foundry-termination-intent-writer",
        requestedReason,
      ],
    ));
    const winningReason = await readTerminationIntent(spec);
    if (winningReason === null) {
      throw new Error("termination intent write was not observable");
    }
    return winningReason;
  };

  const readLaunchWitnessIdentity = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    expectedEngineIdentitySha256: string,
    input: VolumeWitness,
    output: VolumeWitness,
    requireExactPrelaunchSnapshot: boolean,
  ): Promise<LaunchWitnessIdentity> => {
    const volume = await inspectVolume(namesFor(spec).launchWitnessVolume);
    if (volume === null) throw new Error("launch witness volume is absent");
    if (
      volume.Name !== namesFor(spec).launchWitnessVolume ||
      volume.Driver !== "local"
    ) {
      throw new Error("launch witness volume identity mismatch");
    }
    const launchSha256 = volume.Labels["omnitwin.foundry.launch-witness"] ?? "";
    if (!/^sha256:[a-f0-9]{64}$/u.test(launchSha256)) {
      throw new Error("launch witness digest label is invalid");
    }
    const expectedLabels = {
      ...labelsFor(spec),
      "omnitwin.foundry.volume-kind": "launch-witness",
      "omnitwin.foundry.engine-identity": expectedEngineIdentitySha256,
      "omnitwin.foundry.launch-witness": launchSha256,
      "omnitwin.foundry.input-device": input.device,
      "omnitwin.foundry.input-inode": input.inode,
      "omnitwin.foundry.output-device": output.device,
      "omnitwin.foundry.output-inode": output.inode,
    };
    assertLabels(
      volume.Labels,
      expectedLabels,
      "launch witness volume",
    );
    if (
      requireExactPrelaunchSnapshot &&
      launchSha256 !== launchWitnessSha256(input, output)
    ) {
      throw new Error("launch witness no longer matches its prelaunch snapshot");
    }
    return {
      engineIdentitySha256: expectedEngineIdentitySha256,
      launchWitnessSha256: launchSha256,
      inputDevice: input.device,
      inputInode: input.inode,
      outputDevice: output.device,
      outputInode: output.inode,
    };
  };

  const prepareInput = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    volumeName: string,
  ): Promise<void> => {
    const base64 = sourceBytes.toString("base64");
    await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${volumeName},destination=/volume,volume-nocopy`,
      [
      "/bin/sh",
      "-ceu",
      "test \"$(find /volume -mindepth 1 -maxdepth 1 | wc -l)\" -eq 0; printf '%s' \"$1\" | base64 -d > /volume/source.glb; chmod 0444 /volume/source.glb; chmod 0555 /volume; sync /volume/source.glb; sync /volume",
      "foundry-input-preparer",
      base64,
      ],
    ));
  };

  const prepareOutput = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    volumeName: string,
  ): Promise<void> => {
    await docker(helperWithMount(
      spec.workerImage,
      `0:${String(policy.groupId)}`,
      `--mount=type=volume,source=${volumeName},destination=/volume,volume-nocopy`,
      [
      "/bin/sh",
      "-ceu",
      `test "$(find /volume -mindepth 1 -maxdepth 1 | wc -l)" -eq 0; : > /volume/${policy.persistentOutputFileName}; chmod 0620 /volume/${policy.persistentOutputFileName}; chmod 0555 /volume; sync /volume/${policy.persistentOutputFileName}; sync /volume`,
      ],
    ));
  };

  const witnessVolume = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    volumeName: string,
    fileName: string,
  ): Promise<VolumeWitness> => {
    const result = await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${volumeName},destination=/volume,readonly,volume-nocopy`,
      [
      "/bin/sh",
      "-ceu",
      `count=$(find /volume -mindepth 1 -maxdepth 1 | wc -l); dmode=$(stat -c '%a' /volume); meta=$(stat -c '%F|%u|%g|%a|%h|%s|%d|%i' /volume/${fileName}); hash=$(sha256sum /volume/${fileName} | cut -d ' ' -f 1); printf '%s|%s|%s|%s\\n' "$dmode" "$count" "$meta" "$hash"`,
      ],
    ));
    const fields = result.stdout.trim().split("|");
    if (fields.length !== 11) throw new Error("unexpected volume witness field count");
    const [directoryMode, count, fileType, uid, gid, mode, links, bytes, device, inode, hash] = fields;
    return {
      directoryMode: directoryMode ?? "",
      entryCount: Number(count),
      fileName,
      fileType: fileType ?? "",
      uid: Number(uid),
      gid: Number(gid),
      mode: mode ?? "",
      linkCount: Number(links),
      byteLength: Number(bytes),
      device: device ?? "",
      inode: inode ?? "",
      rawSha256: hash ?? "",
    };
  };

  const verifyInputWitness = (
    witness: VolumeWitness,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): void => {
    if (
      witness.directoryMode !== "555" ||
      witness.entryCount !== 1 ||
      witness.fileName !== "source.glb" ||
      witness.fileType !== "regular file" ||
      witness.uid !== 0 ||
      witness.gid !== 0 ||
      witness.mode !== "444" ||
      witness.linkCount !== 1 ||
      witness.byteLength !== spec.source.sourceByteLength ||
      `sha256:${witness.rawSha256}` !== spec.source.sourceRawSha256
    ) {
      throw new Error("read-only input volume witness failed");
    }
  };

  const verifyOutputWitness = (
    witness: VolumeWitness,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): boolean =>
    witness.directoryMode === "555" &&
    witness.entryCount === 1 &&
    witness.fileName === policy.persistentOutputFileName &&
    witness.fileType === "regular file" &&
    witness.uid === 0 &&
    witness.gid === policy.groupId &&
    witness.mode === "620" &&
    witness.linkCount === 1 &&
    witness.byteLength === spec.source.sourceByteLength &&
    witness.byteLength <= spec.output.maximumOutputBytes &&
    `sha256:${witness.rawSha256}` === spec.source.sourceRawSha256;

  const ensureImage = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<void> => {
    const result = await docker(["image", "inspect", spec.workerImage]);
    const image = parseSingleJson(result.stdout) as {
      Id: string;
      RepoDigests: readonly string[] | null;
      Config: { Volumes: Readonly<Record<string, unknown>> | null };
    };
    const expectedId = `sha256:${spec.workerImage.split("@sha256:")[1] ?? ""}`;
    if (
      image.Id !== expectedId ||
      image.RepoDigests?.includes(spec.workerImage) !== true
    ) {
      throw new Error("local proof image does not match the exact cached digest");
    }
    const declaredVolumes = Object.keys(image.Config.Volumes ?? {});
    if (
      declaredVolumes.some((value) => value !== "/var/lib/postgresql/data")
    ) {
      throw new Error("proof image contains an unaccounted declared volume");
    }
  };

  const createArgs = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    launch: LaunchWitnessIdentity,
  ): string[] => {
    const names = namesFor(spec);
    const args = [
      "create",
      "--pull=never",
      `--platform=${policy.containerPlatform}`,
      `--runtime=${policy.containerRuntime}`,
      `--name=${names.container}`,
      "--hostname=foundry-sandbox",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges=true",
      `--security-opt=seccomp=${options.securityProfilePath}`,
      `--pids-limit=${String(policy.hardLimits.maximumPids)}`,
      `--memory=${String(spec.memoryBytes)}`,
      `--memory-swap=${String(spec.memoryBytes)}`,
      `--cpus=${String(spec.cpuCores)}`,
      `--ulimit=cpu=${String(policy.hardLimits.maximumPerProcessCpuSeconds)}:${String(policy.hardLimits.maximumPerProcessCpuSeconds)}`,
      `--ulimit=nofile=${String(policy.hardLimits.maximumPerProcessOpenFiles)}:${String(policy.hardLimits.maximumPerProcessOpenFiles)}`,
      `--ulimit=fsize=${String(spec.output.maximumOutputBytes)}:${String(spec.output.maximumOutputBytes)}`,
      "--ulimit=core=0:0",
      "--ipc=none",
      "--cgroupns=private",
      `--shm-size=${String(policy.hardLimits.sharedMemoryBytes)}b`,
      "--log-driver=none",
      "--no-healthcheck",
      "--restart=no",
      `--stop-signal=${policy.terminationSignal}`,
      `--stop-timeout=${String(policy.hardLimits.terminationGraceSeconds)}`,
      `--user=${String(policy.userId)}:${String(policy.groupId)}`,
      "--workdir=/",
      `--mount=type=volume,source=${names.inputVolume},destination=/input,readonly,volume-nocopy`,
      `--mount=type=volume,source=${names.outputVolume},destination=/output,volume-nocopy`,
      `--mount=type=volume,source=${names.terminationIntentVolume},destination=/run/omnitwin-foundry-control,readonly,volume-nocopy`,
      "--mount=type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=65536,tmpfs-mode=0100",
      "--entrypoint=/usr/bin/env",
    ];
    for (const [key, value] of Object.entries(workerLabels(spec, launch))) {
      args.push("--label", `${key}=${value}`);
    }
    args.push(
      spec.workerImage,
      "-i",
      `PATH=${HELPER_PATH}`,
      "HOME=/nonexistent",
      ...spec.workerCommand,
    );
    return args;
  };

  const reservationCreateArgs = (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    engineSha256: string,
  ): string[] => {
    const names = namesFor(spec);
    const args = [
      "create",
      "--pull=never",
      `--platform=${policy.containerPlatform}`,
      `--runtime=${policy.containerRuntime}`,
      `--name=${names.reservationContainer}`,
      "--hostname=foundry-reservation",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges=true",
      `--security-opt=seccomp=${options.securityProfilePath}`,
      "--pids-limit=1",
      "--memory=67108864",
      "--memory-swap=67108864",
      "--cpus=0.25",
      "--ipc=none",
      "--cgroupns=private",
      "--shm-size=65536b",
      "--log-driver=none",
      "--no-healthcheck",
      "--restart=no",
      `--stop-signal=${policy.terminationSignal}`,
      `--user=${String(policy.userId)}:${String(policy.groupId)}`,
      "--workdir=/",
      "--mount=type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=65536,tmpfs-mode=0100",
      "--entrypoint=/bin/false",
    ];
    for (const [key, value] of Object.entries(
      reservationLabels(spec, engineSha256),
    )) {
      args.push("--label", `${key}=${value}`);
    }
    args.push(spec.workerImage);
    return args;
  };

  const hasExactSeccompProfile = (
    container: DockerContainerInspect,
  ): boolean => {
    const securityOptions = container.HostConfig.SecurityOpt ?? [];
    if (
      securityOptions.length !== 2 ||
      securityOptions.filter((value) => value === "no-new-privileges=true")
        .length !== 1
    ) {
      return false;
    }
    const seccompOptions = securityOptions
      .filter((value) => value.startsWith("seccomp="));
    if (seccompOptions.length !== 1 || seccompOptions[0] === "seccomp=unconfined") {
      return false;
    }
    try {
      const actualProfile: unknown = JSON.parse(
        seccompOptions[0]?.slice("seccomp=".length) ?? "",
      );
      return stableCanonicalJson(toCanonicalJson(actualProfile)) ===
        securityProfileCanonical;
    } catch {
      return false;
    }
  };

  const assertContainerIdentity = (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    launch: LaunchWitnessIdentity,
  ): void => {
    const names = namesFor(spec);
    assertLabels(
      container.Config.Labels,
      workerLabels(spec, launch),
      "worker container",
    );
    const input = container.Mounts.find((mount) => mount.Destination === "/input");
    const output = container.Mounts.find((mount) => mount.Destination === "/output");
    const control = container.Mounts.find(
      (mount) => mount.Destination === "/run/omnitwin-foundry-control",
    );
    const pgdata = container.Mounts.find(
      (mount) => mount.Destination === "/var/lib/postgresql/data",
    );
    const pgdataHostMount = container.HostConfig.Mounts?.find(
      (mount) => mount.Target === "/var/lib/postgresql/data",
    );
    const inputHostMount = container.HostConfig.Mounts?.find(
      (mount) => mount.Target === "/input",
    );
    const outputHostMount = container.HostConfig.Mounts?.find(
      (mount) => mount.Target === "/output",
    );
    const controlHostMount = container.HostConfig.Mounts?.find(
      (mount) => mount.Target === "/run/omnitwin-foundry-control",
    );
    const ulimitEntries = container.HostConfig.Ulimits ?? [];
    const ulimits = new Map(
      ulimitEntries.map((limit) => [limit.Name, limit]),
    );
    const expectedArgs = [
      "-i",
      `PATH=${HELPER_PATH}`,
      "HOME=/nonexistent",
      ...spec.workerCommand,
    ];
    const healthcheckDisabled = container.Config.Healthcheck === undefined ||
      container.Config.Healthcheck === null ||
      (
        container.Config.Healthcheck.Test.length === 1 &&
        container.Config.Healthcheck.Test[0] === "NONE"
      );
    if (
      container.Name !== `/${names.container}` ||
      container.Image !== spec.workerImage.split("@")[1] ||
      container.Config.Image !== spec.workerImage ||
      container.Config.User !== `${String(policy.userId)}:${String(policy.groupId)}` ||
      container.Config.AttachStdin ||
      container.Config.OpenStdin ||
      container.Config.StdinOnce ||
      container.Config.Tty ||
      container.Config.StopSignal !== policy.terminationSignal ||
      container.Path !== "/usr/bin/env" ||
      !canonicalValuesEqual(container.Args, expectedArgs) ||
      !healthcheckDisabled ||
      container.HostConfig.Runtime !== policy.containerRuntime ||
      container.HostConfig.NetworkMode !== "none" ||
      !container.HostConfig.ReadonlyRootfs ||
      (container.HostConfig.CapAdd?.length ?? 0) !== 0 ||
      !canonicalValuesEqual(container.HostConfig.CapDrop, ["ALL"]) ||
      container.HostConfig.Privileged ||
      (container.HostConfig.Devices?.length ?? 0) !== 0 ||
      (container.HostConfig.DeviceRequests?.length ?? 0) !== 0 ||
      container.HostConfig.PidMode !== "" ||
      container.HostConfig.CgroupnsMode !== policy.cgroupNamespace ||
      !hasExactSeccompProfile(container) ||
      container.HostConfig.PidsLimit !== policy.hardLimits.maximumPids ||
      container.HostConfig.Memory !== spec.memoryBytes ||
      container.HostConfig.MemorySwap !== spec.memoryBytes ||
      container.HostConfig.NanoCpus !== spec.cpuCores * 1_000_000_000 ||
      container.HostConfig.IpcMode !== "none" ||
      container.HostConfig.ShmSize !== policy.hardLimits.sharedMemoryBytes ||
      container.HostConfig.LogConfig.Type !== "none" ||
      container.HostConfig.RestartPolicy.Name !== "no" ||
      ulimitEntries.length !== 4 ||
      ulimits.size !== 4 ||
      !canonicalValuesEqual(
        [...ulimits.keys()].sort(),
        ["core", "cpu", "fsize", "nofile"],
      ) ||
      container.Mounts.length !== 4 ||
      input?.Type !== "volume" || input.Name !== names.inputVolume || input.RW ||
      output?.Type !== "volume" || output.Name !== names.outputVolume || !output.RW ||
      control?.Type !== "volume" ||
      control.Name !== names.terminationIntentVolume ||
      control.RW ||
      pgdata?.Type !== "tmpfs" || !pgdata.RW ||
      container.HostConfig.Mounts?.length !== 4 ||
      inputHostMount?.Type !== "volume" ||
      inputHostMount.Source !== names.inputVolume ||
      inputHostMount.ReadOnly !== true ||
      inputHostMount.VolumeOptions?.NoCopy !== true ||
      outputHostMount?.Type !== "volume" ||
      outputHostMount.Source !== names.outputVolume ||
      outputHostMount.ReadOnly === true ||
      outputHostMount.VolumeOptions?.NoCopy !== true ||
      controlHostMount?.Type !== "volume" ||
      controlHostMount.Source !== names.terminationIntentVolume ||
      controlHostMount.ReadOnly !== true ||
      controlHostMount.VolumeOptions?.NoCopy !== true ||
      pgdataHostMount?.Type !== "tmpfs" ||
      pgdataHostMount.TmpfsOptions?.SizeBytes !== 65_536 ||
      pgdataHostMount.TmpfsOptions.Mode !== 0o100 ||
      ulimits.get("core")?.Soft !== 0 ||
      ulimits.get("core")?.Hard !== 0 ||
      ulimits.get("cpu")?.Soft !== policy.hardLimits.maximumPerProcessCpuSeconds ||
      ulimits.get("cpu")?.Hard !== policy.hardLimits.maximumPerProcessCpuSeconds ||
      ulimits.get("nofile")?.Soft !== policy.hardLimits.maximumPerProcessOpenFiles ||
      ulimits.get("nofile")?.Hard !== policy.hardLimits.maximumPerProcessOpenFiles ||
      ulimits.get("fsize")?.Soft !== spec.output.maximumOutputBytes ||
      ulimits.get("fsize")?.Hard !== spec.output.maximumOutputBytes
    ) {
      throw new Error("worker container does not match its exact hard sandbox spec");
    }
  };

  const assertReservationIdentity = (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    engineSha256: string,
  ): void => {
    const names = namesFor(spec);
    const healthcheckDisabled = container.Config.Healthcheck === undefined ||
      container.Config.Healthcheck === null ||
      (
        container.Config.Healthcheck.Test.length === 1 &&
        container.Config.Healthcheck.Test[0] === "NONE"
      );
    const pgdata = container.Mounts.find(
      (mount) => mount.Destination === "/var/lib/postgresql/data",
    );
    const pgdataHostMount = container.HostConfig.Mounts?.find(
      (mount) => mount.Target === "/var/lib/postgresql/data",
    );
    assertLabels(
      container.Config.Labels,
      reservationLabels(spec, engineSha256),
      "launch reservation container",
    );
    if (
      container.Name !== `/${names.reservationContainer}` ||
      container.Image !== spec.workerImage.split("@")[1] ||
      container.Config.Image !== spec.workerImage ||
      container.Config.User !== `${String(policy.userId)}:${String(policy.groupId)}` ||
      container.Config.AttachStdin ||
      container.Config.OpenStdin ||
      container.Config.StdinOnce ||
      container.Config.Tty ||
      container.Config.StopSignal !== policy.terminationSignal ||
      container.Path !== "/bin/false" ||
      container.Args.length !== 0 ||
      !healthcheckDisabled ||
      container.State.Status !== "created" ||
      container.State.Running ||
      container.State.Pid !== 0 ||
      container.HostConfig.Runtime !== policy.containerRuntime ||
      container.HostConfig.NetworkMode !== "none" ||
      !container.HostConfig.ReadonlyRootfs ||
      (container.HostConfig.CapAdd?.length ?? 0) !== 0 ||
      !canonicalValuesEqual(container.HostConfig.CapDrop, ["ALL"]) ||
      container.HostConfig.Privileged ||
      (container.HostConfig.Devices?.length ?? 0) !== 0 ||
      (container.HostConfig.DeviceRequests?.length ?? 0) !== 0 ||
      container.HostConfig.PidMode !== "" ||
      container.HostConfig.CgroupnsMode !== policy.cgroupNamespace ||
      !hasExactSeccompProfile(container) ||
      container.HostConfig.PidsLimit !== 1 ||
      container.HostConfig.Memory !== 67_108_864 ||
      container.HostConfig.MemorySwap !== 67_108_864 ||
      container.HostConfig.NanoCpus !== 250_000_000 ||
      container.HostConfig.IpcMode !== "none" ||
      container.HostConfig.ShmSize !== 65_536 ||
      container.HostConfig.LogConfig.Type !== "none" ||
      container.HostConfig.RestartPolicy.Name !== "no" ||
      container.Mounts.length !== 1 ||
      pgdata?.Type !== "tmpfs" ||
      !pgdata.RW ||
      pgdataHostMount?.Type !== "tmpfs" ||
      pgdataHostMount.TmpfsOptions?.SizeBytes !== 65_536 ||
      pgdataHostMount.TmpfsOptions.Mode !== 0o100
    ) {
      throw new Error("launch reservation container identity mismatch");
    }
  };

  const ensureReservation = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    engineSha256: string,
  ): Promise<boolean> => {
    const names = namesFor(spec);
    const existing = await inspectContainer(names.reservationContainer);
    if (existing !== null) {
      assertReservationIdentity(existing, spec, engineSha256);
      return false;
    }
    try {
      await docker(reservationCreateArgs(spec, engineSha256));
    } catch (error: unknown) {
      const raced = await inspectContainer(names.reservationContainer);
      if (raced === null) throw error;
      assertReservationIdentity(raced, spec, engineSha256);
      return false;
    }
    const created = await inspectContainer(names.reservationContainer);
    if (created === null) {
      throw new Error("launch reservation creation was not observable");
    }
    assertReservationIdentity(created, spec, engineSha256);
    return true;
  };

  const ensureResources = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<DockerContainerInspect> => {
    const engineSha256 = engineIdentitySha256(await engineReceipt());
    await ensureImage(spec);
    const names = namesFor(spec);
    const reservationCreated = await ensureReservation(spec, engineSha256);
    let container = await inspectContainer(names.container);

    if (!reservationCreated) {
      if (container === null) {
        throw new Error("launch reservation exists without its worker container");
      }
      await Promise.all([
        requireLabeledVolume(
          names.inputVolume,
          { ...labelsFor(spec), "omnitwin.foundry.volume-kind": "input" },
          "input volume",
        ),
        requireLabeledVolume(
          names.outputVolume,
          { ...labelsFor(spec), "omnitwin.foundry.volume-kind": "output" },
          "output volume",
        ),
        requireLabeledVolume(
          names.terminationIntentVolume,
          terminationControlLabels(spec),
          "termination control volume",
        ),
      ]);
      await readTerminationIntent(spec);
      const [inputWitness, outputWitness] = await Promise.all([
        witnessVolume(spec, names.inputVolume, "source.glb"),
        witnessVolume(
          spec,
          names.outputVolume,
          policy.persistentOutputFileName,
        ),
      ]);
      verifyInputWitness(inputWitness, spec);
      if (
        outputWitness.directoryMode !== "555" ||
        outputWitness.entryCount !== 1 ||
        !isRegularFileType(outputWitness.fileType) ||
        outputWitness.byteLength > spec.output.maximumOutputBytes ||
        outputWitness.uid !== 0 ||
        outputWitness.gid !== policy.groupId ||
        outputWitness.mode !== "620" ||
        outputWitness.linkCount !== 1
      ) {
        throw new Error("replayed output volume witness failed");
      }
      const launch = await readLaunchWitnessIdentity(
        spec,
        engineSha256,
        inputWitness,
        outputWitness,
        false,
      );
      assertContainerIdentity(container, spec, launch);
      return container;
    }

    const unexpectedExisting = await Promise.all([
      inspectContainer(names.container),
      inspectVolume(names.inputVolume),
      inspectVolume(names.outputVolume),
      inspectVolume(names.launchWitnessVolume),
      inspectVolume(names.terminationIntentVolume),
    ]);
    if (unexpectedExisting.some((value) => value !== null)) {
      throw new Error("fresh launch reservation collided with existing sandbox state");
    }
    const inputCreated = await ensureVolume(names.inputVolume, spec, "input");
    const outputCreated = await ensureVolume(names.outputVolume, spec, "output");
    const controlCreated = await ensureTerminationControl(spec);
    if (!inputCreated || !outputCreated || !controlCreated) {
      throw new Error(
        "fresh reservation did not exclusively create its data and control volumes",
      );
    }
    await prepareInput(spec, names.inputVolume);
    await prepareOutput(spec, names.outputVolume);
    const inputWitness = await witnessVolume(spec, names.inputVolume, "source.glb");
    const outputWitness = await witnessVolume(
      spec,
      names.outputVolume,
      policy.persistentOutputFileName,
    );
    verifyInputWitness(inputWitness, spec);
    if (
      outputWitness.directoryMode !== "555" ||
      outputWitness.entryCount !== 1 ||
      !isRegularFileType(outputWitness.fileType) ||
      outputWitness.byteLength > spec.output.maximumOutputBytes ||
      outputWitness.uid !== 0 ||
      outputWitness.gid !== policy.groupId ||
      outputWitness.mode !== "620" ||
      outputWitness.linkCount !== 1 ||
      outputWitness.byteLength !== 0 ||
      outputWitness.rawSha256 !== EMPTY_RAW_SHA256
    ) {
      throw new Error(
        `pre-reserved output volume witness failed:${JSON.stringify(outputWitness)}`,
      );
    }
    const launchWitnessCreated = await ensureLabeledVolume(
      names.launchWitnessVolume,
      launchWitnessLabels(spec, engineSha256, inputWitness, outputWitness),
      "launch witness volume",
    );
    if (!launchWitnessCreated) {
      throw new Error("fresh reservation did not create its launch witness");
    }
    const launch = await readLaunchWitnessIdentity(
      spec,
      engineSha256,
      inputWitness,
      outputWitness,
      true,
    );
    await docker(createArgs(spec, launch));
    container = await inspectContainer(names.container);
    if (container === null) {
      throw new Error("created worker container was not observable");
    }
    const [postCreateInput, postCreateOutput] = await Promise.all([
      witnessVolume(spec, names.inputVolume, "source.glb"),
      witnessVolume(
        spec,
        names.outputVolume,
        policy.persistentOutputFileName,
      ),
    ]);
    if (
      !canonicalValuesEqual(postCreateInput, inputWitness) ||
      !canonicalValuesEqual(postCreateOutput, outputWitness)
    ) {
      throw new Error("data volume witness changed between reservation and create");
    }
    assertContainerIdentity(container, spec, launch);
    return container;
  };

  const validateExistingWorker = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
    container: DockerContainerInspect,
  ): Promise<{
    readonly engineSha256: string;
    readonly inputWitness: VolumeWitness;
    readonly outputWitness: VolumeWitness;
    readonly launch: LaunchWitnessIdentity;
  }> => {
    const names = namesFor(spec);
    const engineSha256 = engineIdentitySha256(await engineReceipt());
    const reservation = await inspectContainer(names.reservationContainer);
    if (reservation === null) {
      throw new Error("worker exists without its launch reservation");
    }
    assertReservationIdentity(reservation, spec, engineSha256);
    await Promise.all([
      requireLabeledVolume(
        names.inputVolume,
        { ...labelsFor(spec), "omnitwin.foundry.volume-kind": "input" },
        "input volume",
      ),
      requireLabeledVolume(
        names.outputVolume,
        { ...labelsFor(spec), "omnitwin.foundry.volume-kind": "output" },
        "output volume",
      ),
      requireLabeledVolume(
        names.terminationIntentVolume,
        terminationControlLabels(spec),
        "termination control volume",
      ),
    ]);
    await readTerminationIntent(spec);
    const [inputWitness, outputWitness] = await Promise.all([
      witnessVolume(spec, names.inputVolume, "source.glb"),
      witnessVolume(
        spec,
        names.outputVolume,
        policy.persistentOutputFileName,
      ),
    ]);
    verifyInputWitness(inputWitness, spec);
    if (
      outputWitness.directoryMode !== "555" ||
      outputWitness.entryCount !== 1 ||
      !isRegularFileType(outputWitness.fileType) ||
      outputWitness.byteLength > spec.output.maximumOutputBytes ||
      outputWitness.uid !== 0 ||
      outputWitness.gid !== policy.groupId ||
      outputWitness.mode !== "620" ||
      outputWitness.linkCount !== 1
    ) {
      throw new Error("existing output volume witness failed");
    }
    const launch = await readLaunchWitnessIdentity(
      spec,
      engineSha256,
      inputWitness,
      outputWitness,
      false,
    );
    assertContainerIdentity(container, spec, launch);
    return { engineSha256, inputWitness, outputWitness, launch };
  };

  const deadlineExceeded = (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): boolean => {
    if (!container.State.Running) return false;
    const started = Date.parse(container.State.StartedAt);
    const current = now().getTime();
    return Number.isFinite(started) && Number.isFinite(current) &&
      current >= started + spec.maximumRuntimeSeconds * 1_000;
  };

  const stopAndConfirm = async (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<DockerContainerInspect> => {
    const names = namesFor(spec);
    if (container.State.Running) {
      try {
        await docker([
          "container",
          "stop",
          "--time",
          policy.hardLimits.terminationGraceSeconds.toString(),
          names.container,
        ], (policy.hardLimits.terminationGraceSeconds + 5) * 1_000);
      } catch {
        await docker(["container", "kill", names.container]);
      }
    }
    const stopped = await inspectContainer(names.container);
    if (stopped === null || stopped.State.Running || stopped.State.Pid !== 0) {
      throw new Error("Docker did not report a stopped container with init PID zero");
    }
    await validateExistingWorker(spec, stopped);
    return stopped;
  };

  const terminalReceipt = async (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ) => {
    const names = namesFor(spec);
    const startedAt = Date.parse(container.State.StartedAt);
    const finishedAt = Date.parse(container.State.FinishedAt);
    if (
      container.State.Running ||
      container.State.Status !== "exited" ||
      container.State.Dead ||
      container.State.Pid !== 0 ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(finishedAt) ||
      finishedAt < startedAt
    ) {
      throw new Error(
        "terminal receipt requires a cleanly exited container, init PID zero, and sane timestamps",
      );
    }
    const validated = await validateExistingWorker(spec, container);
    const { engineSha256, inputWitness, outputWitness } = validated;
    const terminationIntent: TerminationIntentReason | "none" =
      await readTerminationIntent(spec) ?? "none";
    const outputVerified = verifyOutputWitness(outputWitness, spec);
    const containerIdentitySha256 = canonicalDigest(
      "OMNITWIN_FOUNDRY_LOCAL_DOCKER_CONTAINER_IDENTITY_V0",
      stableContainerIdentityPayload(container),
    );
    const inputVolumeReceiptSha256 = canonicalDigest(
      "OMNITWIN_FOUNDRY_LOCAL_DOCKER_VOLUME_WITNESS_V0",
      inputWitness,
    );
    const outputVolumeReceiptSha256 = canonicalDigest(
      "OMNITWIN_FOUNDRY_LOCAL_DOCKER_VOLUME_WITNESS_V0",
      outputWitness,
    );
    const payload = {
      schemaVersion: FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0 as
        typeof FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0,
      instanceSpecSha256: spec.instanceSpecSha256,
      policySha256: spec.policySha256,
      markerSha256: spec.durableResourceMarker.markerSha256,
      providerCommandRef: names.providerCommandRef,
      engineIdentitySha256: engineSha256,
      containerIdentitySha256,
      securityProfileSha256: policy.securityProfileSha256,
      inputVolumeReceiptSha256,
      outputVolumeReceiptSha256,
      exitCode: container.State.ExitCode,
      oomKilled: container.State.OOMKilled,
      deadlineExceeded: terminationIntent === "deadline",
      terminationIntent,
      containerInitPidZero: true as const,
      processTreeEvidence: "docker_inspect_stopped_init_only" as const,
      outputVerified,
      containerFinishedAt: new Date(finishedAt).toISOString(),
    };
    return {
      ...payload,
      receiptSha256:
        computeFoundryLocalSandboxEnforcementReceiptSha256(payload),
    };
  };

  const observed = async (
    container: DockerContainerInspect,
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<FoundryLocalSandboxBackendResult> => {
    const names = namesFor(spec);
    const lifecycle = lifecycleFor(container);
    const enforcementReceipt = lifecycle === "exited" || lifecycle === "terminated"
      ? await terminalReceipt(container, spec)
      : undefined;
    return {
      kind: "observed",
      providerKind: "local_cpu",
      durableResourceMarker: spec.durableResourceMarker,
      providerCommandRef: names.providerCommandRef,
      lifecycle,
      ...(enforcementReceipt === undefined ? {} : { enforcementReceipt }),
    };
  };

  const submitExact: FoundryLocalSandboxBackend["submitExact"] = async (
    requestValue,
    signal,
  ) => {
    if (signal.aborted) {
      return {
        kind: "rejected",
        providerKind: "local_cpu",
        durableResourceMarker: requestValue.durableResourceMarker,
        reasonCode: "aborted_before_reserve",
      };
    }
    let spec: FoundryLocalOsSandboxInstanceSpecV0;
    try {
      spec = specFor(requestValue);
      if (requestValue.command.commandKind !== "provider_submit") {
        throw new Error("submit backend requires submit command");
      }
    } catch (error: unknown) {
      recordDiagnostic("submit_policy", error);
      return {
        kind: "rejected",
        providerKind: "local_cpu",
        durableResourceMarker: requestValue.durableResourceMarker,
        reasonCode: "sandbox_policy_rejected",
      };
    }
    try {
      let container = await ensureResources(spec);
      if (container.State.Status === "created") {
        await docker(["container", "start", namesFor(spec).container]);
        container = await inspectContainer(namesFor(spec).container) ?? container;
      }
      await validateExistingWorker(spec, container);
      return await observed(container, spec);
    } catch (error: unknown) {
      recordDiagnostic("submit_runtime", error);
      return {
        kind: "unknown",
        providerKind: "local_cpu",
        durableResourceMarker: requestValue.durableResourceMarker,
        providerCommandRef: namesFor(spec).providerCommandRef,
        reasonCode: "sandbox_submit_unknown",
      };
    }
  };

  const reconcileOrPoll = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    requireReference: boolean,
  ): Promise<FoundryLocalSandboxBackendResult> => {
    let spec: FoundryLocalOsSandboxInstanceSpecV0;
    try {
      spec = specFor(requestValue);
      const names = namesFor(spec);
      if (
        requireReference &&
        requestValue.command.providerCommandRef !== names.providerCommandRef
      ) {
        throw new Error("provider reference mismatch");
      }
      const resources = await Promise.all([
        inspectContainer(names.container),
        inspectContainer(names.reservationContainer),
        inspectVolume(names.inputVolume),
        inspectVolume(names.outputVolume),
        inspectVolume(names.launchWitnessVolume),
        inspectVolume(names.terminationIntentVolume),
      ]);
      const [container] = resources;
      if (container === null) {
        if (resources.slice(1).every((value) => value === null)) {
          return {
            kind: "not_found",
            providerKind: "local_cpu",
            durableResourceMarker: spec.durableResourceMarker,
          };
        }
        return {
          kind: "unknown",
          providerKind: "local_cpu",
          durableResourceMarker: spec.durableResourceMarker,
          providerCommandRef: names.providerCommandRef,
          reasonCode: "reserved_container_missing",
        };
      }
      await validateExistingWorker(spec, container);
      let terminationIntent = await readTerminationIntent(spec);
      if (
        container.State.Running &&
        terminationIntent === null &&
        deadlineExceeded(container, spec)
      ) {
        terminationIntent = await ensureTerminationIntent(spec, "deadline");
      }
      if (container.State.Running && terminationIntent !== null) {
        const stopped = await stopAndConfirm(container, spec);
        return await observed(stopped, spec);
      }
      return await observed(container, spec);
    } catch (error: unknown) {
      recordDiagnostic("reconcile", error);
      return {
        kind: "unknown",
        providerKind: "local_cpu",
        durableResourceMarker: requestValue.durableResourceMarker,
        providerCommandRef: requestValue.command.providerCommandRef,
        reasonCode: "sandbox_reconcile_unknown",
      };
    }
  };

  const backend: FoundryLocalSandboxBackend = {
    submitExact,
    reconcileExact: (requestValue, _signal) =>
      reconcileOrPoll(requestValue, false),
    pollExact: (requestValue, _signal) => reconcileOrPoll(requestValue, true),
    checkpointExact: (requestValue, _signal) =>
      Promise.resolve({
        kind: "rejected",
        providerKind: "local_cpu",
        durableResourceMarker: requestValue.durableResourceMarker,
        reasonCode: "checkpoint_not_supported",
      }),
    stopExact: async (requestValue, _signal) => {
      try {
        const spec = specFor(requestValue);
        const names = namesFor(spec);
        if (requestValue.command.providerCommandRef !== names.providerCommandRef) {
          throw new Error("provider reference mismatch");
        }
        const resources = await Promise.all([
          inspectContainer(names.container),
          inspectContainer(names.reservationContainer),
          inspectVolume(names.inputVolume),
          inspectVolume(names.outputVolume),
          inspectVolume(names.launchWitnessVolume),
          inspectVolume(names.terminationIntentVolume),
        ]);
        const [container] = resources;
        if (container === null) {
          return resources.slice(1).every((value) => value === null)
            ? {
                kind: "not_found" as const,
                providerKind: "local_cpu" as const,
                durableResourceMarker: spec.durableResourceMarker,
              }
            : {
                kind: "unknown" as const,
                providerKind: "local_cpu" as const,
                durableResourceMarker: spec.durableResourceMarker,
                providerCommandRef: names.providerCommandRef,
                reasonCode: "reserved_container_missing",
              };
        }
        await validateExistingWorker(spec, container);
        if (!container.State.Running) return await observed(container, spec);
        await ensureTerminationIntent(spec, "operator_stop");
        const stopped = await stopAndConfirm(container, spec);
        return await observed(stopped, spec);
      } catch (error: unknown) {
        recordDiagnostic("stop", error);
        return {
          kind: "unknown",
          providerKind: "local_cpu",
          durableResourceMarker: requestValue.durableResourceMarker,
          providerCommandRef: requestValue.command.providerCommandRef,
          reasonCode: "sandbox_stop_unknown",
        };
      }
    },
  };

  const inspectExact = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const [container, input, output] = await Promise.all([
      inspectContainer(names.container),
      inspectVolume(names.inputVolume).then((value) =>
        value === null ? null : witnessVolume(spec, names.inputVolume, "source.glb")
      ),
      inspectVolume(names.outputVolume).then((value) =>
        value === null
          ? null
          : witnessVolume(spec, names.outputVolume, policy.persistentOutputFileName)
      ),
    ]);
    if (container !== null) await validateExistingWorker(spec, container);
    return { spec, container, input, output };
  };

  const requireEmptyPrelaunchTerminationControl = async (
    spec: FoundryLocalOsSandboxInstanceSpecV0,
  ): Promise<void> => {
    const names = namesFor(spec);
    const result = await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${names.terminationIntentVolume},destination=/volume,readonly,volume-nocopy`,
      [
        "/bin/sh",
        "-ceu",
        "count=$(find /volume -mindepth 1 -maxdepth 1 | wc -l); test \"$count\" -eq 0; printf '%s' \"$count\"",
      ],
    ));
    if (result.stdout !== "0") {
      throw new Error("prelaunch termination control is not exactly empty");
    }
  };

  const cleanupExactState = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    leaveTerminationControlForCrashTest: boolean,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const engineSha256 = engineIdentitySha256(await engineReceipt());
    const [
      container,
      reservation,
      inputVolume,
      outputVolume,
      launchVolume,
      controlVolume,
    ] =
      await Promise.all([
        inspectContainer(names.container),
        inspectContainer(names.reservationContainer),
        inspectVolume(names.inputVolume),
        inspectVolume(names.outputVolume),
        inspectVolume(names.launchWitnessVolume),
        inspectVolume(names.terminationIntentVolume),
      ]);
    const anySandboxState = [
      container,
      reservation,
      inputVolume,
      outputVolume,
      launchVolume,
      controlVolume,
    ].some((value) => value !== null);
    if (!anySandboxState) return;

    const assertCleanupPostcondition = async (): Promise<void> => {
      const remaining = await Promise.all([
        inspectContainer(names.container),
        inspectContainer(names.reservationContainer),
        inspectVolume(names.inputVolume),
        inspectVolume(names.outputVolume),
        inspectVolume(names.launchWitnessVolume),
        inspectVolume(names.terminationIntentVolume),
      ]);
      if (remaining.some((value) => value !== null)) {
        throw new Error("cleanup exact postcondition left labeled sandbox state");
      }
    };

    if (reservation === null) {
      const onlyTerminationControlRemains =
        container === null &&
        inputVolume === null &&
        outputVolume === null &&
        launchVolume === null &&
        controlVolume !== null;
      if (!onlyTerminationControlRemains) {
        throw new Error("cleanup refuses sandbox state without its reservation");
      }
      await readTerminationIntent(spec);
      await requireLabeledVolume(
        names.terminationIntentVolume,
        terminationControlLabels(spec),
        "termination control volume",
      );
      await docker(["volume", "rm", names.terminationIntentVolume]);
      await assertCleanupPostcondition();
      return;
    }
    assertReservationIdentity(reservation, spec, engineSha256);

    const reservationOnly =
      container === null &&
      inputVolume === null &&
      outputVolume === null &&
      launchVolume === null &&
      controlVolume === null;
    if (reservationOnly) {
      await docker(["container", "rm", names.reservationContainer]);
      await assertCleanupPostcondition();
      return;
    }

    const removePresentDataVolumes = async (): Promise<void> => {
      for (const [volumeName, kind] of [
        [names.outputVolume, "output"],
        [names.inputVolume, "input"],
      ] as const) {
        const volume = await inspectVolume(volumeName);
        if (volume === null) continue;
        await requireLabeledVolume(
          volumeName,
          { ...labelsFor(spec), "omnitwin.foundry.volume-kind": kind },
          `${kind} volume`,
        );
        await docker(["volume", "rm", volumeName]);
      }
    };

    const hasLaunchEvidence = container !== null || launchVolume !== null;
    if (!hasLaunchEvidence) {
      if (leaveTerminationControlForCrashTest) {
        throw new Error("cleanup crash fixture requires launched sandbox state");
      }
      for (const [volumeName, kind, present] of [
        [names.inputVolume, "input", inputVolume],
        [names.outputVolume, "output", outputVolume],
      ] as const) {
        if (present === null) continue;
        await requireLabeledVolume(
          volumeName,
          { ...labelsFor(spec), "omnitwin.foundry.volume-kind": kind },
          `${kind} volume`,
        );
      }
      if (controlVolume !== null) {
        await requireLabeledVolume(
          names.terminationIntentVolume,
          terminationControlLabels(spec),
          "termination control volume",
        );
        try {
          await readTerminationIntent(spec);
        } catch {
          if (inputVolume === null || outputVolume === null) {
            throw new Error(
              "uninitialized prelaunch control requires both prior data volumes",
            );
          }
          await requireEmptyPrelaunchTerminationControl(spec);
        }
        await docker(["volume", "rm", names.terminationIntentVolume]);
      }
      await removePresentDataVolumes();
      await docker(["container", "rm", names.reservationContainer]);
      await assertCleanupPostcondition();
      return;
    }

    if (launchVolume === null) {
      throw new Error("cleanup refuses worker state without its launch witness");
    }
    if (controlVolume === null) {
      throw new Error("cleanup refuses initialized sandbox state without termination control");
    }
    await readTerminationIntent(spec);
    await requireLabeledVolume(
      names.terminationIntentVolume,
      terminationControlLabels(spec),
      "termination control volume",
    );

    if (inputVolume === null || outputVolume === null) {
      throw new Error("cleanup launch witness requires both data volumes");
    }
    const [inputWitness, outputWitness] = await Promise.all([
      witnessVolume(spec, names.inputVolume, "source.glb"),
      witnessVolume(
        spec,
        names.outputVolume,
        policy.persistentOutputFileName,
      ),
    ]);
    await readLaunchWitnessIdentity(
      spec,
      engineSha256,
      inputWitness,
      outputWitness,
      false,
    );

    if (container !== null) {
      await validateExistingWorker(spec, container);
      if (container.State.Running) {
        await ensureTerminationIntent(spec, "operator_stop");
        await stopAndConfirm(container, spec);
      }
      await docker(["container", "rm", names.container]);
    }
    await docker(["volume", "rm", names.launchWitnessVolume]);
    await removePresentDataVolumes();
    await docker(["container", "rm", names.reservationContainer]);
    if (leaveTerminationControlForCrashTest) {
      const remaining = await Promise.all([
        inspectContainer(names.container),
        inspectContainer(names.reservationContainer),
        inspectVolume(names.inputVolume),
        inspectVolume(names.outputVolume),
        inspectVolume(names.launchWitnessVolume),
        inspectVolume(names.terminationIntentVolume),
      ]);
      if (
        remaining.slice(0, 5).some((value) => value !== null) ||
        remaining[5] === null
      ) {
        throw new Error("cleanup crash fixture did not leave only termination control");
      }
      return;
    }
    await readTerminationIntent(spec);
    await requireLabeledVolume(
      names.terminationIntentVolume,
      terminationControlLabels(spec),
      "termination control volume",
    );
    await docker(["volume", "rm", names.terminationIntentVolume]);
    await assertCleanupPostcondition();
  };

  const cleanupExact = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => cleanupExactState(requestValue, false);

  const createExactReservationOnlyForCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const before = await Promise.all([
      inspectContainer(names.container),
      inspectContainer(names.reservationContainer),
      inspectVolume(names.inputVolume),
      inspectVolume(names.outputVolume),
      inspectVolume(names.launchWitnessVolume),
      inspectVolume(names.terminationIntentVolume),
    ]);
    if (before.some((value) => value !== null)) {
      throw new Error("reservation-only crash fixture requires exact clean state");
    }
    const engineSha256 = engineIdentitySha256(await engineReceipt());
    await ensureImage(spec);
    if (!await ensureReservation(spec, engineSha256)) {
      throw new Error("reservation-only crash fixture did not create its reservation");
    }
    const reservation = await inspectContainer(names.reservationContainer);
    if (reservation === null) {
      throw new Error("reservation-only crash fixture reservation is absent");
    }
    assertReservationIdentity(reservation, spec, engineSha256);
    const unexpected = await Promise.all([
      inspectContainer(names.container),
      inspectVolume(names.inputVolume),
      inspectVolume(names.outputVolume),
      inspectVolume(names.launchWitnessVolume),
      inspectVolume(names.terminationIntentVolume),
    ]);
    if (unexpected.some((value) => value !== null)) {
      throw new Error("reservation-only crash fixture created additional state");
    }
  };

  const createExactPartialLaunchForCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    phase: "data_volumes_created" | "control_volume_uninitialized",
  ): Promise<void> => {
    await createExactReservationOnlyForCrashTest(requestValue);
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const inputCreated = await ensureVolume(names.inputVolume, spec, "input");
    const outputCreated = await ensureVolume(names.outputVolume, spec, "output");
    if (!inputCreated || !outputCreated) {
      throw new Error("partial-launch crash fixture did not create both data volumes");
    }
    if (phase === "control_volume_uninitialized") {
      const controlCreated = await ensureLabeledVolume(
        names.terminationIntentVolume,
        terminationControlLabels(spec),
        "termination control volume",
      );
      if (!controlCreated) {
        throw new Error("partial-launch crash fixture did not create its control volume");
      }
    }
  };

  const leaveExactTerminationControlForCleanupCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => cleanupExactState(requestValue, true);

  const removeExactContainerForCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const container = await inspectContainer(names.container);
    if (container === null) return;
    await validateExistingWorker(spec, container);
    if (container.State.Running) {
      await ensureTerminationIntent(spec, "operator_stop");
      await stopAndConfirm(container, spec);
    }
    await docker(["container", "rm", names.container]);
  };

  const persistExactDeadlineIntentForCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const container = await inspectContainer(names.container);
    if (container === null) {
      throw new Error("deadline crash fixture requires an existing worker");
    }
    await validateExistingWorker(spec, container);
    if (!container.State.Running || !deadlineExceeded(container, spec)) {
      throw new Error("deadline crash fixture requires an over-deadline worker");
    }
    const reason = await ensureTerminationIntent(spec, "deadline");
    if (reason !== "deadline") {
      throw new Error("deadline crash fixture lost first-writer intent ordering");
    }
    const stillRunning = await inspectContainer(names.container);
    if (stillRunning === null || !stillRunning.State.Running) {
      throw new Error("deadline crash fixture must stop before worker termination");
    }
  };

  const persistExactOperatorStopIntentForCrashTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    if (requestValue.command.providerCommandRef !== names.providerCommandRef) {
      throw new Error("operator-stop crash fixture provider reference mismatch");
    }
    const container = await inspectContainer(names.container);
    if (container === null || !container.State.Running) {
      throw new Error("operator-stop crash fixture requires a running worker");
    }
    await validateExistingWorker(spec, container);
    const reason = await ensureTerminationIntent(spec, "operator_stop");
    if (reason !== "operator_stop") {
      throw new Error("operator-stop crash fixture lost first-writer intent ordering");
    }
    const stillRunning = await inspectContainer(names.container);
    if (stillRunning === null || !stillRunning.State.Running) {
      throw new Error("operator-stop crash fixture must stop before worker termination");
    }
  };

  const setExactTerminationControlCorruptForTest = async (
    requestValue: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    corrupt: boolean,
  ): Promise<void> => {
    const spec = specFor(requestValue);
    const names = namesFor(spec);
    const source = corrupt ? "initialized" : "initialized.corrupt";
    const destination = corrupt ? "initialized.corrupt" : "initialized";
    await docker(helperWithMount(
      spec.workerImage,
      "0:0",
      `--mount=type=volume,source=${names.terminationIntentVolume},destination=/volume,volume-nocopy`,
      [
        "/bin/sh",
        "-ceu",
        "test -f \"/volume/$1\"; test ! -e \"/volume/$2\"; mv \"/volume/$1\" \"/volume/$2\"; sync /volume",
        "foundry-termination-control-corruptor",
        source,
        destination,
      ],
    ));
  };

  return {
    backend: Object.freeze(backend),
    engineReceipt,
    inspectExact,
    cleanupExact,
    createExactReservationOnlyForCrashTest,
    createExactPartialLaunchForCrashTest,
    leaveExactTerminationControlForCleanupCrashTest,
    removeExactContainerForCrashTest,
    persistExactDeadlineIntentForCrashTest,
    persistExactOperatorStopIntentForCrashTest,
    setExactTerminationControlCorruptForTest,
    diagnostics: () => [...diagnostics],
  };
}
