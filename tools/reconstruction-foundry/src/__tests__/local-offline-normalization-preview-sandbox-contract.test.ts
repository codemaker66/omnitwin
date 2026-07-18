import { describe, expect, it } from "vitest";
import {
  LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1,
  type LocalOfflinePreviewContainerConfiguration,
} from "../local-offline-normalization-preview-container-preflight.js";
import {
  compileLocalOfflinePreviewSandboxPolicy,
  createLocalOfflinePreviewSandboxEvidence,
  createLocalOfflinePreviewSandboxTerminalReceipt,
  LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND,
  parseLocalOfflinePreviewSandboxEvidence,
  parseLocalOfflinePreviewSandboxPolicy,
  parseLocalOfflinePreviewSandboxTerminalReceipt,
  type LocalOfflinePreviewSandboxPolicy,
  type LocalOfflinePreviewSandboxTerminalReceipt,
  type LocalOfflinePreviewSandboxTerminalReceiptInput,
} from "../local-offline-normalization-preview-sandbox-contract.js";

const digest = (character: string): string =>
  `sha256:${character.repeat(64)}`;

function validConfiguration(): LocalOfflinePreviewContainerConfiguration {
  return {
    schemaVersion: LOCAL_OFFLINE_PREVIEW_CONTAINER_CONFIGURATION_V1,
    authority: "none",
    fallbackPolicy: "block",
    containerPlatform: "linux/amd64",
    dockerExecutablePath: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    seccompProfilePath: "C:\\fixed\\offline-preview-seccomp.json",
    seccompProfileSha256: digest("1"),
    seccompDefaultAction: "SCMP_ACT_ERRNO",
    imageReference: `local/offline-preview@${digest("2")}`,
    imageId: digest("3"),
    imagePullPolicy: "never",
    networkMode: "none",
    rootFilesystem: "read_only",
    mountPolicy: "none",
    capabilityPolicy: "drop_all",
    noNewPrivileges: true,
    userId: 10_001,
    groupId: 10_001,
    workerKind: "offline_normalization_preview",
    workerProtocolSha256: digest("4"),
    workerArtifactSha256: digest("5"),
    fixedEntrypoint: [
      "/opt/omnitwin/bin/node",
      "/opt/omnitwin/worker/offline-preview.mjs",
    ],
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

function policy(): LocalOfflinePreviewSandboxPolicy {
  const result = compileLocalOfflinePreviewSandboxPolicy(validConfiguration());
  if (result === null) throw new Error("valid policy fixture was rejected");
  return result;
}

function input(
  value: LocalOfflinePreviewSandboxPolicy,
  phase: "transform" | "fresh_verifier",
  overrides: Readonly<Record<string, unknown>> = {},
): LocalOfflinePreviewSandboxTerminalReceiptInput {
  const transform = phase === "transform";
  return {
    phase,
    requestId: "0123456789abcdef0123456789abcdef",
    policyDigest: value.policyDigest,
    engineDigest: digest("6"),
    containerConfigurationDigest: transform ? digest("7") : digest("8"),
    containerIdentityDigest: transform ? digest("9") : digest("a"),
    deadlineAt: "2030-01-02T10:01:00.000Z",
    startedAt: transform
      ? "2030-01-02T10:00:00.000Z"
      : "2030-01-02T10:00:03.000Z",
    finishedAt: transform
      ? "2030-01-02T10:00:02.000Z"
      : "2030-01-02T10:00:05.000Z",
    wireInput: { sizeBytes: transform ? 2_000 : 3_000, sha256: digest("b") },
    wireOutput: { sizeBytes: transform ? 1_500 : 500, sha256: digest("c") },
    source: { sizeBytes: 1_000, sha256: digest("d") },
    candidate: { sizeBytes: 900, sha256: digest("e") },
    reportSha256: digest("f"),
    verificationResult: transform ? "not_applicable" : "exact_match",
    terminal: {
      status: "exited",
      running: false,
      pid: 0,
      exitCode: 0,
      oomKilled: false,
      dead: false,
    },
    effectiveControls: value.effectiveControls,
    containerRemoved: true,
    exactPrivateLabelAbsent: true,
    privateLabelDigest: transform ? digest("0") : digest("1"),
    matchingPrivateLabelContainerCount: 0,
    ...overrides,
  } as LocalOfflinePreviewSandboxTerminalReceiptInput;
}

function receipt(
  value: LocalOfflinePreviewSandboxPolicy,
  phase: "transform" | "fresh_verifier",
  overrides: Readonly<Record<string, unknown>> = {},
): LocalOfflinePreviewSandboxTerminalReceipt {
  const result = createLocalOfflinePreviewSandboxTerminalReceipt(
    input(value, phase, overrides),
    value,
  );
  if (result === null) throw new Error(`valid ${phase} receipt was rejected`);
  return result;
}

describe("local offline preview sandbox evidence contract", () => {
  it("compiles a strict, immutable, path-free, authority-none policy", () => {
    const value = policy();
    const serialized = JSON.stringify(value);

    expect(value.backend).toBe(LOCAL_OFFLINE_PREVIEW_SANDBOX_BACKEND);
    expect(value.authority).toBe("none");
    expect(value.productionExecution).toBe("disabled");
    expect(value.effectiveControls).toMatchObject({
      networkMode: "none",
      readOnlyRootFilesystem: true,
      mountCount: 0,
      capDrop: ["ALL"],
      noNewPrivileges: true,
      runtime: "runc",
      logDriver: "none",
      attachStderr: false,
    });
    expect(serialized).not.toContain("docker.exe");
    expect(serialized).not.toContain("offline-preview-seccomp.json");
    expect(serialized).not.toContain("C:\\");
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.effectiveControls)).toBe(true);
    expect(parseLocalOfflinePreviewSandboxPolicy(value)).toEqual(value);
  });

  it("rejects malformed configuration, policy drift, digest drift, and extra keys", () => {
    const configuration = validConfiguration();
    expect(
      compileLocalOfflinePreviewSandboxPolicy({
        ...configuration,
        mountPolicy: "host_directory",
      }),
    ).toBeNull();

    const value = policy();
    expect(
      parseLocalOfflinePreviewSandboxPolicy({
        ...value,
        effectiveControls: {
          ...value.effectiveControls,
          networkMode: "bridge",
        },
      }),
    ).toBeNull();
    expect(
      parseLocalOfflinePreviewSandboxPolicy({
        ...value,
        policyDigest: digest("a"),
      }),
    ).toBeNull();
    expect(
      parseLocalOfflinePreviewSandboxPolicy({ ...value, unexpected: true }),
    ).toBeNull();
  });

  it("creates receipts only after clean exit, bounded transport, removal, and an empty exact-label scan", () => {
    const value = policy();
    const transform = receipt(value, "transform");

    expect(transform.sandboxEstablished).toBe(true);
    expect(transform.terminal).toEqual({
      status: "exited",
      running: false,
      pid: 0,
      exitCode: 0,
      oomKilled: false,
      dead: false,
    });
    expect(transform.containerRemoved).toBe(true);
    expect(transform.exactPrivateLabelAbsent).toBe(true);
    expect(parseLocalOfflinePreviewSandboxTerminalReceipt(transform, value)).toEqual(
      transform,
    );

    expect(
      createLocalOfflinePreviewSandboxTerminalReceipt(
        input(value, "transform", {
          terminal: { ...transform.terminal, oomKilled: true },
        }),
        value,
      ),
    ).toBeNull();
    expect(
      createLocalOfflinePreviewSandboxTerminalReceipt(
        input(value, "transform", { containerRemoved: false }),
        value,
      ),
    ).toBeNull();
    expect(
      createLocalOfflinePreviewSandboxTerminalReceipt(
        input(value, "transform", {
          matchingPrivateLabelContainerCount: 1,
        }),
        value,
      ),
    ).toBeNull();
  });

  it("rejects control, deadline, runtime, and byte-limit lies", () => {
    const value = policy();
    const invalidInputs: readonly Readonly<Record<string, unknown>>[] = [
      {
        effectiveControls: {
          ...value.effectiveControls,
          networkMode: "bridge",
        },
      },
      { finishedAt: "2030-01-02T10:01:01.000Z" },
      {
        deadlineAt: "2030-01-02T10:02:00.000Z",
        startedAt: "2030-01-02T10:00:00.000Z",
        finishedAt: "2030-01-02T10:01:00.001Z",
      },
      {
        wireInput: {
          sizeBytes: value.effectiveControls.maximumInputBytes + 1,
          sha256: digest("b"),
        },
      },
      {
        wireOutput: {
          sizeBytes: value.effectiveControls.maximumOutputBytes + 1,
          sha256: digest("c"),
        },
      },
    ];
    for (const overrides of invalidInputs) {
      expect(
        createLocalOfflinePreviewSandboxTerminalReceipt(
          input(value, "transform", overrides),
          value,
        ),
      ).toBeNull();
    }
  });

  it("establishes evidence only from two distinct, sequential, matching, removed containers", () => {
    const value = policy();
    const transform = receipt(value, "transform");
    const verifier = receipt(value, "fresh_verifier");
    const evidence = createLocalOfflinePreviewSandboxEvidence({
      policy: value,
      transformReceipt: transform,
      freshVerifierReceipt: verifier,
    });

    expect(evidence).not.toBeNull();
    expect(evidence).toMatchObject({
      sandboxEstablished: true,
      productionExecution: "disabled",
      distinctContainers: true,
      freshVerifierStartedAfterTransformFinished: true,
      bothContainersRemoved: true,
      privateLabelOrphanScanEmpty: true,
      source: transform.source,
      candidate: transform.candidate,
      reportSha256: transform.reportSha256,
    });
    expect(evidence?.limitations.join(" ")).toContain("not a dedicated virtual machine");
    expect(parseLocalOfflinePreviewSandboxEvidence(evidence)).toEqual(evidence);
    expect(JSON.stringify(evidence)).not.toContain("C:\\");
  });

  it.each([
    ["same container", { containerIdentityDigest: digest("9") }],
    ["different engine", { engineDigest: digest("7") }],
    ["different source", { source: { sizeBytes: 1_000, sha256: digest("7") } }],
    ["different candidate", { candidate: { sizeBytes: 900, sha256: digest("7") } }],
    ["different report", { reportSha256: digest("7") }],
    ["different request", { requestId: "11111111111111111111111111111111" }],
    ["reused private label", { privateLabelDigest: digest("0") }],
    [
      "overlapping execution",
      {
        startedAt: "2030-01-02T10:00:01.000Z",
        finishedAt: "2030-01-02T10:00:03.000Z",
      },
    ],
  ] as const)("rejects evidence with %s", (_label, verifierOverrides) => {
    const value = policy();
    expect(
      createLocalOfflinePreviewSandboxEvidence({
        policy: value,
        transformReceipt: receipt(value, "transform"),
        freshVerifierReceipt: receipt(
          value,
          "fresh_verifier",
          verifierOverrides,
        ),
      }),
    ).toBeNull();
  });

  it("rejects receipt and evidence field, digest, and shape tampering", () => {
    const value = policy();
    const transform = receipt(value, "transform");
    const verifier = receipt(value, "fresh_verifier");
    const evidence = createLocalOfflinePreviewSandboxEvidence({
      policy: value,
      transformReceipt: transform,
      freshVerifierReceipt: verifier,
    });
    if (evidence === null) throw new Error("valid evidence fixture was rejected");

    expect(
      parseLocalOfflinePreviewSandboxTerminalReceipt({
        ...transform,
        candidate: { ...transform.candidate, sizeBytes: 901 },
      }),
    ).toBeNull();
    expect(
      parseLocalOfflinePreviewSandboxTerminalReceipt({
        ...transform,
        rawContainerId: "must-not-be-accepted",
      }),
    ).toBeNull();
    expect(
      parseLocalOfflinePreviewSandboxEvidence({
        ...evidence,
        sandboxEstablished: false,
      }),
    ).toBeNull();
    expect(
      parseLocalOfflinePreviewSandboxEvidence({
        ...evidence,
        unexpected: true,
      }),
    ).toBeNull();
  });
});
