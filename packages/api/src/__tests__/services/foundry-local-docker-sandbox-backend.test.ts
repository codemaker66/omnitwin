import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  FoundryLocalSandboxBackendResult,
} from "../../services/foundry-local-command-adapter.js";
import { createFoundryLocalDockerSandboxBackend } from
  "../support/foundry-local-docker-sandbox-backend.js";
import {
  createLocalOsSandboxFixtureCommandRequest,
  createLocalOsSandboxFixturePolicy,
  createLocalOsSandboxFixtureRequest,
  LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
  LOCAL_SANDBOX_FIXTURE_SOURCE,
  LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
  LOCAL_SANDBOX_FIXTURE_SOURCE_SHA256,
} from "../support/foundry-local-os-sandbox-fixture.js";

const SECURITY_PROFILE_PATH = fileURLToPath(
  new URL("../fixtures/local-sandbox/networkless-seccomp.json", import.meta.url),
);
const DOCKER_EXECUTABLE = process.env.OMNITWIN_FOUNDRY_DOCKER_EXE ??
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const liveIt = process.env.OMNITWIN_FOUNDRY_DOCKER_SANDBOX_TEST === "1"
  ? it
  : it.skip;

async function securityProfileSha256(): Promise<string> {
  const bytes = await readFile(SECURITY_PROFILE_PATH);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function proofOptions(now?: () => Date) {
  return {
    dockerExecutable: DOCKER_EXECUTABLE,
    securityProfilePath: SECURITY_PROFILE_PATH,
    policy: createLocalOsSandboxFixturePolicy({
      securityProfileSha256: await securityProfileSha256(),
    }),
    source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
    sourceBytes: LOCAL_SANDBOX_FIXTURE_SOURCE,
    output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
    ...(now === undefined ? {} : { now }),
  } as const;
}

function createRequestForOptions(
  options: Awaited<ReturnType<typeof proofOptions>>,
  overrides: Parameters<typeof createLocalOsSandboxFixtureRequest>[0] = {},
) {
  return createLocalOsSandboxFixtureRequest({
    ...overrides,
    terminalEnforcement: {
      mode: "required",
      policySha256: options.policy.policySha256,
      securityProfileSha256: options.policy.securityProfileSha256,
    },
  });
}

async function waitForTerminal(
  backend: ReturnType<typeof createFoundryLocalDockerSandboxBackend>["backend"],
  providerCommandRef: string,
  submitRequest: ReturnType<typeof createLocalOsSandboxFixtureRequest>,
): Promise<FoundryLocalSandboxBackendResult> {
  const pollRequest = createLocalOsSandboxFixtureCommandRequest(
    "provider_poll",
    providerCommandRef,
    submitRequest,
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await backend.pollExact(
      pollRequest,
      new AbortController().signal,
    );
    if (
      typeof result === "object" &&
      result !== null &&
      "kind" in result &&
      result.kind === "observed" &&
      "lifecycle" in result &&
      (result.lifecycle === "exited" || result.lifecycle === "terminated")
    ) {
      return result as FoundryLocalSandboxBackendResult;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("sandbox worker did not reach a terminal state");
}

describe("Foundry test-only Docker OS sandbox backend", () => {
  it("uses a default-deny seccomp profile with no socket or namespace syscall", async () => {
    const profile = JSON.parse(await readFile(SECURITY_PROFILE_PATH, "utf8")) as {
      defaultAction: string;
      syscalls: readonly { action: string; names: readonly string[] }[];
    };
    const denyActions = new Set([
      "SCMP_ACT_ERRNO",
      "SCMP_ACT_KILL",
      "SCMP_ACT_KILL_PROCESS",
      "SCMP_ACT_KILL_THREAD",
      "SCMP_ACT_TRAP",
    ]);
    const executable = new Set(
      profile.syscalls
        .filter((entry) => !denyActions.has(entry.action))
        .flatMap((entry) => entry.names),
    );
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
    for (const syscall of [
      "socket",
      "socketpair",
      "connect",
      "bind",
      "listen",
      "accept",
      "accept4",
      "mount",
      "umount2",
      "pivot_root",
      "ptrace",
      "unshare",
      "setns",
      "clone",
      "clone3",
      "bpf",
      "perf_event_open",
    ]) {
      expect(executable.has(syscall), syscall).toBe(false);
    }
  });

  it("treats Docker observation failure as unknown after pure policy admission", async () => {
    const options = await proofOptions();
    const proof = createFoundryLocalDockerSandboxBackend({
      ...options,
      dockerExecutable: "omnitwin-intentionally-missing-docker-executable",
    });

    await expect(proof.backend.submitExact(
      createRequestForOptions(options),
      new AbortController().signal,
    )).resolves.toMatchObject({
      kind: "unknown",
      providerKind: "local_cpu",
      providerCommandRef: expect.stringMatching(/^local-sandbox:/u),
      reasonCode: "sandbox_submit_unknown",
    });
  });

  liveIt("runs, reconciles, observes, verifies, and replays one engine-volume output", async () => {
    const options = await proofOptions();
    const submitRequest = createRequestForOptions(options);
    const proof = createFoundryLocalDockerSandboxBackend(options);
    await proof.cleanupExact(submitRequest);
    try {
      const engine = await proof.engineReceipt();
      expect(engine).toMatchObject({
        os: "linux",
        arch: "amd64",
        cgroupVersion: "2",
        liveRestoreEnabled: false,
      });
      expect(engine.securityOptions.some((value) => value.includes("seccomp")))
        .toBe(true);

      const first = await proof.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      expect(first, proof.diagnostics().join("\n")).toMatchObject({
        kind: "observed",
        providerKind: "local_cpu",
      });
      if (
        typeof first !== "object" || first === null ||
        !("providerCommandRef" in first) ||
        typeof first.providerCommandRef !== "string"
      ) {
        throw new Error("submit did not return an exact provider reference");
      }
      const providerCommandRef = first.providerCommandRef;
      const afterFirst = await proof.inspectExact(submitRequest);
      expect(afterFirst.container).not.toBeNull();
      const firstContainerId = afterFirst.container?.Id;

      const replay = await proof.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      expect(replay).toMatchObject({
        kind: "observed",
        providerCommandRef,
      });
      expect((await proof.inspectExact(submitRequest)).container?.Id)
        .toBe(firstContainerId);

      const restarted = createFoundryLocalDockerSandboxBackend(
        await proofOptions(),
      );
      const reconcile = await restarted.backend.reconcileExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_reconcile",
          undefined,
          submitRequest,
        ),
        new AbortController().signal,
      );
      expect(reconcile).toMatchObject({
        kind: "observed",
        providerCommandRef,
      });

      const terminal = await waitForTerminal(
        restarted.backend,
        providerCommandRef,
        submitRequest,
      );
      const frozen = await restarted.inspectExact(submitRequest);
      expect(
        terminal,
        JSON.stringify({ diagnostics: restarted.diagnostics(), frozen }, null, 2),
      ).toMatchObject({
        kind: "observed",
        lifecycle: "exited",
        enforcementReceipt: {
          exitCode: 0,
          oomKilled: false,
          deadlineExceeded: false,
          terminationIntent: "none",
          containerInitPidZero: true,
          processTreeEvidence: "docker_inspect_stopped_init_only",
          outputVerified: true,
        },
      });
      expect(frozen.input).toMatchObject({
        directoryMode: "555",
        entryCount: 1,
        fileName: "source.glb",
        mode: "444",
        linkCount: 1,
        byteLength: LOCAL_SANDBOX_FIXTURE_SOURCE.byteLength,
        rawSha256: LOCAL_SANDBOX_FIXTURE_SOURCE_SHA256.slice(7),
      });
      expect(frozen.output).toMatchObject({
        directoryMode: "555",
        entryCount: 1,
        fileName: "normalized.glb",
        uid: 0,
        gid: 65_534,
        mode: "620",
        linkCount: 1,
        byteLength: LOCAL_SANDBOX_FIXTURE_SOURCE.byteLength,
        rawSha256: LOCAL_SANDBOX_FIXTURE_SOURCE_SHA256.slice(7),
      });
      expect(frozen.container).toMatchObject({
        HostConfig: {
          NetworkMode: "none",
          ReadonlyRootfs: true,
          PidsLimit: 16,
          Memory: 1_073_741_824,
          MemorySwap: 1_073_741_824,
          NanoCpus: 1_000_000_000,
          PidMode: "",
          CgroupnsMode: "private",
          Privileged: false,
          LogConfig: { Type: "none" },
        },
      });
      expect(frozen.container?.HostConfig.Mounts).toEqual(
        expect.arrayContaining([expect.objectContaining({
          Type: "volume",
          Target: "/run/omnitwin-foundry-control",
          ReadOnly: true,
          VolumeOptions: { NoCopy: true },
        })]),
      );
      expect(frozen.container?.Mounts).toEqual(
        expect.arrayContaining([expect.objectContaining({
          Type: "volume",
          Destination: "/run/omnitwin-foundry-control",
          RW: false,
        })]),
      );

      const drifted = createRequestForOptions(options, {
        stage: { command: ["/bin/sh", "-ceu", "exit 99"] },
      });
      expect(await restarted.backend.submitExact(
        drifted,
        new AbortController().signal,
      )).toMatchObject({ kind: "unknown", reasonCode: "sandbox_submit_unknown" });

      if (
        terminal.kind !== "observed" ||
        terminal.enforcementReceipt === undefined
      ) {
        throw new Error("terminal result did not include its enforcement receipt");
      }
      const replayedTerminal = await restarted.backend.pollExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_poll",
          providerCommandRef,
          submitRequest,
        ),
        new AbortController().signal,
      );
      expect(replayedTerminal).toMatchObject({
        kind: "observed",
        enforcementReceipt: terminal.enforcementReceipt,
      });

      await restarted.removeExactContainerForCrashTest(submitRequest);
      expect(await restarted.backend.reconcileExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_reconcile",
          undefined,
          submitRequest,
        ),
        new AbortController().signal,
      )).toMatchObject({
        kind: "unknown",
        reasonCode: "reserved_container_missing",
      });
      expect(await restarted.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      )).toMatchObject({
        kind: "unknown",
        reasonCode: "sandbox_submit_unknown",
      });
      expect((await restarted.inspectExact(submitRequest)).container).toBeNull();
    } finally {
      await proof.cleanupExact(submitRequest);
    }
  }, 60_000);

  liveIt("recovers persisted deadline intent and confirms termination after restart", async () => {
    let clock = new Date();
    const options = await proofOptions(() => clock);
    const baseRequest = createRequestForOptions(options);
    const submitRequest = createRequestForOptions(options, {
      stage: {
        command: baseRequest.authorization.stages[0]!.command.map((argument) =>
          argument.replace("exec /bin/sleep 3", "exec /bin/sleep 120")
        ),
      },
    });
    const proof = createFoundryLocalDockerSandboxBackend(options);
    await proof.cleanupExact(submitRequest);
    try {
      const submitted = await proof.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      expect(submitted, proof.diagnostics().join("\n"))
        .toMatchObject({ kind: "observed" });
      expect(submitRequest.authorization.stages[0]?.command.join("\n"))
        .toContain("exec /bin/sleep 120");
      expect((await proof.inspectExact(submitRequest)).container).toMatchObject({
        State: { Running: true },
      });
      clock = new Date("2100-01-01T00:00:00.000Z");
      await proof.persistExactDeadlineIntentForCrashTest(submitRequest);
      expect((await proof.inspectExact(submitRequest)).container?.State)
        .toMatchObject({ Running: true });
      let corruptObservation: FoundryLocalSandboxBackendResult | undefined;
      await proof.setExactTerminationControlCorruptForTest(submitRequest, true);
      try {
        const corruptBackend = createFoundryLocalDockerSandboxBackend(
          await proofOptions(() => clock),
        );
        corruptObservation = await corruptBackend.backend.reconcileExact(
          createLocalOsSandboxFixtureCommandRequest(
            "provider_reconcile",
            undefined,
            submitRequest,
          ),
          new AbortController().signal,
        ) as FoundryLocalSandboxBackendResult;
      } finally {
        await proof.setExactTerminationControlCorruptForTest(
          submitRequest,
          false,
        );
      }
      expect(corruptObservation).toMatchObject({
        kind: "unknown",
        reasonCode: "sandbox_reconcile_unknown",
      });
      expect((await proof.inspectExact(submitRequest)).container?.State)
        .toMatchObject({ Running: true });
      const restarted = createFoundryLocalDockerSandboxBackend(
        await proofOptions(() => clock),
      );
      const result = await restarted.backend.reconcileExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_reconcile",
          undefined,
          submitRequest,
        ),
        new AbortController().signal,
      );
      expect(result).toMatchObject({
        kind: "observed",
        lifecycle: "terminated",
        enforcementReceipt: {
          deadlineExceeded: true,
          terminationIntent: "deadline",
          containerInitPidZero: true,
          processTreeEvidence: "docker_inspect_stopped_init_only",
        },
      });
      const observedResult = result as FoundryLocalSandboxBackendResult;
      if (
        observedResult.kind !== "observed" ||
        observedResult.enforcementReceipt === undefined
      ) {
        throw new Error("deadline result did not include its enforcement receipt");
      }
      const terminalReplay = createFoundryLocalDockerSandboxBackend(
        await proofOptions(() => clock),
      );
      const replayed = await terminalReplay.backend.pollExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_poll",
          observedResult.providerCommandRef,
          submitRequest,
        ),
        new AbortController().signal,
      );
      expect(replayed).toMatchObject({
        kind: "observed",
        lifecycle: "terminated",
        enforcementReceipt: observedResult.enforcementReceipt,
      });
      expect((await restarted.inspectExact(submitRequest)).container?.State)
        .toMatchObject({ Running: false, Pid: 0 });
    } finally {
      await proof.cleanupExact(submitRequest);
    }
  }, 60_000);

  liveIt("persists operator-stop intent and replays it after backend restart", async () => {
    const options = await proofOptions();
    const baseRequest = createRequestForOptions(options);
    const submitRequest = createRequestForOptions(options, {
      stage: {
        command: baseRequest.authorization.stages[0]!.command.map((argument) =>
          argument.replace("exec /bin/sleep 3", "exec /bin/sleep 120")
        ),
      },
    });
    const proof = createFoundryLocalDockerSandboxBackend(options);
    await proof.cleanupExact(submitRequest);
    try {
      const submitted = await proof.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      if (
        typeof submitted !== "object" || submitted === null ||
        !("kind" in submitted) || submitted.kind !== "observed" ||
        !("providerCommandRef" in submitted) ||
        typeof submitted.providerCommandRef !== "string"
      ) {
        throw new Error(
          `operator-stop submit failed:${proof.diagnostics().join("|")}`,
        );
      }
      const stopRequest = createLocalOsSandboxFixtureCommandRequest(
        "provider_stop",
        submitted.providerCommandRef,
        submitRequest,
      );
      await proof.persistExactOperatorStopIntentForCrashTest(stopRequest);
      expect((await proof.inspectExact(submitRequest)).container?.State)
        .toMatchObject({ Running: true });
      const restartedBeforeStop = createFoundryLocalDockerSandboxBackend(
        await proofOptions(),
      );
      const stopped = await restartedBeforeStop.backend.stopExact(
        stopRequest,
        new AbortController().signal,
      );
      expect(stopped).toMatchObject({
        kind: "observed",
        lifecycle: "terminated",
        enforcementReceipt: {
          deadlineExceeded: false,
          terminationIntent: "operator_stop",
          containerInitPidZero: true,
        },
      });
      const observedStopped = stopped as FoundryLocalSandboxBackendResult;
      if (
        observedStopped.kind !== "observed" ||
        observedStopped.enforcementReceipt === undefined
      ) {
        throw new Error("operator-stop result omitted its enforcement receipt");
      }
      const restartedAfterStop = createFoundryLocalDockerSandboxBackend(
        await proofOptions(),
      );
      await expect(restartedAfterStop.backend.pollExact(
        createLocalOsSandboxFixtureCommandRequest(
          "provider_poll",
          observedStopped.providerCommandRef,
          submitRequest,
        ),
        new AbortController().signal,
      )).resolves.toMatchObject({
        kind: "observed",
        lifecycle: "terminated",
        enforcementReceipt: observedStopped.enforcementReceipt,
      });
    } finally {
      await proof.cleanupExact(submitRequest);
    }
  }, 60_000);

  liveIt("resumes exact cleanup from reservation-only and control-only crash states", async () => {
    const options = await proofOptions();
    const submitRequest = createRequestForOptions(options);
    const proof = createFoundryLocalDockerSandboxBackend(options);
    await proof.cleanupExact(submitRequest);
    try {
      await proof.createExactReservationOnlyForCrashTest(submitRequest);
      const afterReservationCrash = createFoundryLocalDockerSandboxBackend(
        await proofOptions(),
      );
      await afterReservationCrash.cleanupExact(submitRequest);

      for (const phase of [
        "data_volumes_created",
        "control_volume_uninitialized",
      ] as const) {
        const partialLaunch = createFoundryLocalDockerSandboxBackend(
          await proofOptions(),
        );
        await partialLaunch.createExactPartialLaunchForCrashTest(
          submitRequest,
          phase,
        );
        const afterPartialLaunchCrash = createFoundryLocalDockerSandboxBackend(
          await proofOptions(),
        );
        await afterPartialLaunchCrash.cleanupExact(submitRequest);
      }

      const submitted = await afterReservationCrash.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      if (
        typeof submitted !== "object" || submitted === null ||
        !("kind" in submitted) || submitted.kind !== "observed" ||
        !("providerCommandRef" in submitted) ||
        typeof submitted.providerCommandRef !== "string"
      ) {
        throw new Error(
          `cleanup crash fixture submit failed:${afterReservationCrash
            .diagnostics().join("|")}`,
        );
      }
      await waitForTerminal(
        afterReservationCrash.backend,
        submitted.providerCommandRef,
        submitRequest,
      );
      await afterReservationCrash
        .leaveExactTerminationControlForCleanupCrashTest(submitRequest);

      const afterControlCrash = createFoundryLocalDockerSandboxBackend(
        await proofOptions(),
      );
      await afterControlCrash.cleanupExact(submitRequest);
      await afterControlCrash.cleanupExact(submitRequest);
    } finally {
      await proof.cleanupExact(submitRequest);
    }
  }, 60_000);

  liveIt("observes Bash UDP socket open fail under the exact installed profile", async () => {
    const options = await proofOptions();
    const submitRequest = createRequestForOptions(options, {
      stage: {
        command: [
          "/bin/bash",
          "-c",
          "if exec 3<>/dev/udp/127.0.0.1/9; then exit 93; else exit 0; fi",
        ],
      },
    });
    const proof = createFoundryLocalDockerSandboxBackend(options);
    await proof.cleanupExact(submitRequest);
    try {
      const submitted = await proof.backend.submitExact(
        submitRequest,
        new AbortController().signal,
      );
      if (
        typeof submitted !== "object" || submitted === null ||
        !("kind" in submitted) || submitted.kind !== "observed" ||
        !("providerCommandRef" in submitted) ||
        typeof submitted.providerCommandRef !== "string"
      ) {
        throw new Error(
          `socket probe submit failed:${proof.diagnostics().join("|")}`,
        );
      }
      const terminal = await waitForTerminal(
        proof.backend,
        submitted.providerCommandRef,
        submitRequest,
      );
      expect(terminal).toMatchObject({
        kind: "observed",
        lifecycle: "exited",
        enforcementReceipt: {
          exitCode: 0,
          terminationIntent: "none",
          outputVerified: false,
        },
      });
    } finally {
      await proof.cleanupExact(submitRequest);
    }
  }, 60_000);
});
