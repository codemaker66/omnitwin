import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0 } from "@omnitwin/reconstruction-foundry";
import { describe, expect, it } from "vitest";
import { LOCAL_FOUNDRY_MAX_COMPLETE_HANDOFF_FILES } from "../local-app.js";
// @ts-expect-error -- The production builder deliberately runs as plain Node ESM.
import * as untypedReleaseBuilder from "../../scripts/build-windows-x64-production-release.mjs";

interface TreeSnapshot {
  readonly files: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  }[];
  readonly directories: readonly string[];
  readonly digest: string;
}

interface FileRecord {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface BoundedChildResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly closeObserved: boolean;
  readonly terminationReason: string | null;
  readonly terminationRequested: boolean;
  readonly terminationConfirmed: boolean;
  readonly temporaryHandoffRequired: boolean;
}

interface EsbuildOutputEvidence {
  readonly bundle: Buffer;
  readonly legal: Buffer;
  readonly graph: Readonly<Record<string, unknown>>;
}

interface TemporaryRootIdentity {
  readonly path: string;
  readonly parent: string;
  readonly realpath: string;
  readonly dev: number;
  readonly ino: number;
  readonly birthtimeMs: number;
}

interface ReleaseBuilderModule {
  readonly BUNDLED_RELEASE_NULL_SOURCE_SHA256: string;
  readonly BUILD_GRAPH_PATH: string;
  readonly BUNDLE_PATH: string;
  readonly ENTRY_PATH: string;
  readonly FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES: readonly string[];
  readonly LEGAL_PATH: string;
  readonly LOCAL_HD_WORKER_GENERATED_SOURCE_PATH: string;
  readonly LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH: string;
  readonly NODE_LICENSE_PATH: string;
  readonly NODE_RUNTIME_PATH: string;
  readonly RELEASE_MANIFEST_PATH: string;
  readonly SHARP_NATIVE_FILES: readonly string[];
  readonly START_HERE_PATH: string;
  readonly WINDOWS_LAUNCHER_PATH: string;
  readonly CHILD_PROCESS_LIMITS: Readonly<Record<string, Readonly<{
    readonly timeoutMs: number;
    readonly maxStdoutBytes: number;
    readonly maxStderrBytes: number;
  }>>>;
  readonly assertAuditedSourceInputPath: (inputPath: string) => string;
  readonly auditAndNormalizeMetafile: (rawMetafile: unknown) => Readonly<{
    readonly entryPoint: string;
    readonly inputs: readonly Readonly<{ readonly path: string }>[];
  }>;
  readonly assertBuilderInputsUnchanged: (
    initialRecords: readonly Readonly<Record<string, unknown>>[],
    finalRecords: readonly Readonly<Record<string, unknown>>[],
  ) => void;
  readonly assertBundledReleaseNullSourceBytes: (
    sourceBytes: Uint8Array,
  ) => Readonly<{
    path: string;
    sizeBytes: number;
    sha256: string;
    initializerForEveryBinding: null;
    importsOrAdditionalExecutableCodePermitted: false;
    enforcement: string;
  }>;
  readonly assertDeterministicEsbuildOutputs: (
    first: EsbuildOutputEvidence,
    second: EsbuildOutputEvidence,
  ) => void;
  readonly assertExactPayloadInventory: (
    inventory: { readonly files: readonly string[]; readonly directories: readonly string[] },
    expectedFiles: readonly string[],
    expectedDirectories: readonly string[],
  ) => void;
  readonly assertHeldRecordMatches: (
    observed: FileRecord,
    expected: FileRecord,
    description: string,
  ) => void;
  readonly assertNativeRuntimeInventory: (inventory: {
    readonly files: readonly string[];
    readonly directories: readonly string[];
  }) => void;
  readonly assertNoEmittedSourceSiblings: (paths: readonly string[]) => void;
  readonly assertRepositoryInputRecordsUnchanged: (
    held: readonly FileRecord[],
    rehashed: readonly FileRecord[],
    description: string,
  ) => void;
  readonly assertSharedRepositoryInputsEqual: (
    main: readonly FileRecord[],
    probe: readonly FileRecord[],
    description: string,
  ) => Readonly<{
    description: string;
    sharedInputCount: number;
    sharedRecordsSha256: string;
  }>;
  readonly auditBundleText: (bundleText: string) => {
    readonly knownDoubleUnderscoreTestOnlyFactorySymbolsPresent: false;
    readonly testOnlyAllowSmallIoPresent: boolean;
    readonly knownInternalOptionSeams: readonly {
      readonly symbol: string;
      readonly present: boolean;
      readonly disposition: string;
    }[];
    readonly comprehensiveNoTestSeamProof: false;
  };
  readonly captureTemporaryRootIdentity: (
    path: string,
    parent: string,
  ) => Promise<TemporaryRootIdentity>;
  readonly finalizeReleaseOutcome: (options: {
    readonly result: Readonly<Record<string, unknown>> | null;
    readonly primaryError: Error | null;
    readonly cleanupError: Error | null;
    readonly cleanupSkippedReason: string | null;
    readonly temporaryRoot: string;
    readonly outputDirectory: string;
    readonly publicationVerified: boolean;
  }) => Readonly<Record<string, unknown>>;
  readonly publishAndVerify: (
    staging: string,
    output: string,
    expected: TreeSnapshot,
  ) => Promise<TreeSnapshot>;
  readonly removeVerifiedTemporaryRoot: (identity: TemporaryRootIdentity) => Promise<void>;
  readonly reconcileRepositoryInputRecords: (
    recordSets: readonly (readonly FileRecord[])[],
  ) => readonly FileRecord[];
  readonly runBoundedChildProcess: (options: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly description: string;
    readonly timeoutMs: number;
    readonly maxStdoutBytes: number;
    readonly maxStderrBytes: number;
    readonly killConfirmationMs: number;
  }) => Promise<BoundedChildResult>;
  readonly snapshotTree: (root: string) => Promise<TreeSnapshot>;
  readonly startHereBytes: () => Buffer;
  readonly validateOutputPathShape: (output: string) => string;
  readonly windowsLauncherBytes: () => Buffer;
}

const releaseBuilder: ReleaseBuilderModule = untypedReleaseBuilder;
const {
  BUNDLED_RELEASE_NULL_SOURCE_SHA256,
  BUILD_GRAPH_PATH,
  BUNDLE_PATH,
  ENTRY_PATH,
  FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES,
  LEGAL_PATH,
  LOCAL_HD_WORKER_GENERATED_SOURCE_PATH,
  LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH,
  NODE_LICENSE_PATH,
  NODE_RUNTIME_PATH,
  RELEASE_MANIFEST_PATH,
  SHARP_NATIVE_FILES,
  START_HERE_PATH,
  WINDOWS_LAUNCHER_PATH,
  CHILD_PROCESS_LIMITS,
  assertAuditedSourceInputPath,
  auditAndNormalizeMetafile,
  assertBuilderInputsUnchanged,
  assertBundledReleaseNullSourceBytes,
  assertDeterministicEsbuildOutputs,
  assertExactPayloadInventory,
  assertHeldRecordMatches,
  assertNativeRuntimeInventory,
  assertNoEmittedSourceSiblings,
  assertRepositoryInputRecordsUnchanged,
  assertSharedRepositoryInputsEqual,
  auditBundleText,
  captureTemporaryRootIdentity,
  finalizeReleaseOutcome,
  publishAndVerify,
  removeVerifiedTemporaryRoot,
  reconcileRepositoryInputRecords,
  runBoundedChildProcess,
  snapshotTree,
  startHereBytes,
  validateOutputPathShape,
  windowsLauncherBytes,
} = releaseBuilder;

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(TEST_DIRECTORY, "../../scripts/build-windows-x64-production-release.mjs");
const REPOSITORY_ROOT = resolve(TEST_DIRECTORY, "../../../..");
const BUNDLED_RELEASE_SOURCE_PATH = resolve(
  TEST_DIRECTORY,
  "../local-offline-normalization-preview-bundled-release.generated.ts",
);

interface BuildSummary {
  readonly outputDirectory: string;
  readonly bundleSha256: string;
  readonly repeatBuildsByteIdentical: boolean;
  readonly normalizedGraphsIdentical: boolean;
  readonly postPublishFullTreeVerified: boolean;
  readonly allMainAndProbeInputsFinalRehashed: boolean;
  readonly publishedBundleMatchesHeldBytes: boolean;
  readonly temporaryBuildCleanupCompleted: boolean;
  readonly cleanupWarning: Readonly<Record<string, unknown>> | null;
  readonly productionNormalizationQualified: boolean;
}

interface ReleaseManifestEvidence {
  readonly payloadFiles: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  }[];
  readonly payloadDirectories: readonly string[];
  readonly publication: {
    readonly outputMustNotExist: boolean;
    readonly mechanism: string;
    readonly directoryRenameCount: number;
    readonly strictAtomicNoReplaceEstablished: boolean;
    readonly sameUserRaceResistanceEstablished: boolean;
    readonly verificationScope: string;
    readonly publishedTreePreservedOnPostPublishFailure: boolean;
  };
  readonly thirdPartyLicenseEvidence: {
    readonly esbuildLegalOutputIncluded: boolean;
    readonly sharpNativeLicenseIncluded: boolean;
    readonly nodeMsiLicenseRtfIncluded: boolean;
    readonly thirdPartyLicenseClosureEstablished: boolean;
    readonly commercialRedistributionApprovedByThisBuild: boolean;
  };
  readonly normalizationQualification: {
    readonly productionNormalizationQualified: boolean;
    readonly bundledReleaseManifestInCurrentSource: null;
    readonly dockerQualificationAuthorized: boolean;
  };
  readonly runtime: {
    readonly nodeVersion: string;
    readonly systemNodeRequired: boolean;
    readonly includedNodeExecutable: {
      readonly path: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };
    readonly includedNodeLicense: {
      readonly path: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };
  };
  readonly smokeTest: {
    readonly cliHelp: {
      readonly command: readonly string[];
      readonly environment: string;
      readonly exitCode: number;
    };
    readonly bundledReleaseLookup: {
      readonly command: readonly string[];
      readonly environment: string;
      readonly exitCode: number;
      readonly observedStatus: "unavailable";
      readonly observedCode: "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE";
      readonly observedCapability: null;
      readonly observedRejectionCode: null;
    };
  };
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function testFileRecord(path: string, contents: string): FileRecord {
  const bytes = Buffer.from(contents, "utf8");
  return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
}

function reviewedMainMetafile(
  includeHdWorkerGeneratedSource: boolean,
  includeE57EnvironmentGeneratedSource = includeHdWorkerGeneratedSource,
  e57EnvironmentBytesInOutput = 1,
): Readonly<Record<string, unknown>> {
  const bundledReleaseSourcePath =
    "tools/reconstruction-foundry/src/local-offline-normalization-preview-bundled-release.generated.ts";
  const inputs: Record<string, unknown> = {
    [ENTRY_PATH]: {
      bytes: 1,
      format: "esm",
      imports: [
        {
          path: "packages/types/src/reconstruction-dsse.ts",
          kind: "import-statement",
          external: false,
          original: "@omnitwin/types/reconstruction-dsse",
        },
        {
          path: "packages/reconstruction-foundry/src/index.ts",
          kind: "import-statement",
          external: false,
          original: "@omnitwin/reconstruction-foundry",
        },
        {
          path: "packages/types/src/index.ts",
          kind: "import-statement",
          external: false,
          original: "@omnitwin/types",
        },
      ],
    },
    [bundledReleaseSourcePath]: { bytes: 1, format: "esm", imports: [] },
  };
  const outputInputs: Record<string, unknown> = {
    [ENTRY_PATH]: { bytesInOutput: 1 },
    [bundledReleaseSourcePath]: { bytesInOutput: 1 },
  };
  if (includeHdWorkerGeneratedSource) {
    inputs[LOCAL_HD_WORKER_GENERATED_SOURCE_PATH] = {
      bytes: 1,
      format: "esm",
      imports: [],
    };
    outputInputs[LOCAL_HD_WORKER_GENERATED_SOURCE_PATH] = { bytesInOutput: 1 };
  }
  if (includeE57EnvironmentGeneratedSource) {
    inputs[LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH] = {
      bytes: 1,
      format: "esm",
      imports: [],
    };
    outputInputs[LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH] = {
      bytesInOutput: e57EnvironmentBytesInOutput,
    };
  }
  return {
    inputs,
    outputs: {
      "stage/foundry.mjs": {
        bytes: 3,
        entryPoint: ENTRY_PATH,
        exports: [],
        imports: [],
        inputs: outputInputs,
      },
      "stage/foundry.mjs.LEGAL.txt": {
        bytes: 0,
        exports: [],
        imports: [],
        inputs: {},
      },
    },
  };
}

interface BuildGraphEvidence {
  readonly builder: {
    readonly inputs: readonly {
      readonly path: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    }[];
  };
  readonly aliases: readonly { readonly specifier: string; readonly target: string }[];
  readonly normalizedGraph: {
    readonly inputs: readonly { readonly path: string }[];
  };
  readonly sourceCustody: {
    readonly sharedMainProbeInputs: readonly {
      readonly sharedInputCount: number;
      readonly sharedRecordsSha256: string;
    }[];
    readonly completeInputUnion: {
      readonly inputCount: number;
      readonly recordsSha256: string;
    };
    readonly postBuildUnifiedRehash: {
      readonly inputCount: number;
      readonly recordsSha256: string;
    };
    readonly finalPrepublicationUnifiedRehash: {
      readonly required: true;
      readonly expectedInputCount: number;
      readonly expectedRecordsSha256: string;
      readonly completionReportedByBuilderSummary: true;
    };
  };
  readonly includedNodeRuntime: {
    readonly executable: {
      readonly source: {
        readonly path: string;
        readonly sizeBytes: number;
        readonly sha256: string;
      };
      readonly destination: {
        readonly path: string;
        readonly sizeBytes: number;
        readonly sha256: string;
      };
    };
    readonly license: {
      readonly installer: {
        readonly path: string;
        readonly sizeBytes: number;
        readonly sha256: string;
      };
      readonly authenticode: {
        readonly status: string;
        readonly signerSubject: string;
        readonly signerThumbprint: string;
        readonly timestampSubject: string;
        readonly timestampThumbprint: string;
        readonly independentlyVerifiedByBuilder: false;
      };
      readonly extraction: {
        readonly mechanism: string;
        readonly databaseOpenMode: number;
        readonly msiInstallationOrCustomActionsExecuted: false;
      };
      readonly source: {
        readonly path: string;
        readonly sizeBytes: number;
        readonly sha256: string;
      };
      readonly destination: {
        readonly path: string;
        readonly sizeBytes: number;
        readonly sha256: string;
      };
    };
  };
  readonly bundledReleaseNullSource: {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly initializerForEveryBinding: null;
    readonly importsOrAdditionalExecutableCodePermitted: false;
    readonly enforcement: string;
  };
  readonly bundleAudit: {
    readonly knownInternalOptionSeams: readonly {
      readonly symbol: string;
      readonly present: boolean;
    }[];
  };
}

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "foundry-windows-release-test-"));
}

async function removeOwnedTemporaryDirectory(path: string): Promise<void> {
  if (!resolve(path).startsWith(resolve(tmpdir()) + sep) ||
      !path.includes("foundry-windows-release-test-")) {
    throw new Error("test cleanup path is outside the owned temporary root");
  }
  await rm(path, { recursive: true, force: true });
}

describe("Windows x64 production release builder policy", () => {
  it("rejects relative and non-canonical output paths", async () => {
    expect(() => validateOutputPathShape("relative-release")).toThrow(/absolute path/u);
    const root = await temporaryDirectory();
    try {
      const nonCanonical = `${root}${sep}nested${sep}..${sep}release`;
      expect(() => validateOutputPathShape(nonCanonical)).toThrow(/canonical and normalized/u);
      expect(validateOutputPathShape(join(root, "release"))).toBe(join(root, "release"));
    } finally {
      await removeOwnedTemporaryDirectory(root);
    }
  });

  it.each([
    "tools/reconstruction-foundry/src/__tests__/cli.test.ts",
    "tools/reconstruction-foundry/src/support/fixture.ts",
    "tools/reconstruction-foundry/src/cli.spec.ts",
    "tools/reconstruction-foundry/src/dist/entry.ts",
    "tools/reconstruction-foundry/src/entry.js",
    "packages/reconstruction-foundry/src/captured-quality-comparison.js",
    "packages/types/dist/index.js",
    "packages/web/src/unreviewed.ts",
  ])("rejects forbidden, stale, or unreviewed graph input %s", (path) => {
    expect(() => assertAuditedSourceInputPath(path)).toThrow(/build graph|build input|source present/u);
  });

  it("keeps the build-owned HD worker plan in the audited normalized release graph", async () => {
    expect(assertAuditedSourceInputPath(LOCAL_HD_WORKER_GENERATED_SOURCE_PATH)).toBe(
      LOCAL_HD_WORKER_GENERATED_SOURCE_PATH,
    );
    const normalizedGraph = auditAndNormalizeMetafile(reviewedMainMetafile(true));
    expect(normalizedGraph.inputs.map(({ path }) => path)).toContain(
      LOCAL_HD_WORKER_GENERATED_SOURCE_PATH,
    );
    expect(assertAuditedSourceInputPath(
      LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH,
    )).toBe(LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH);
    expect(normalizedGraph.inputs.map(({ path }) => path)).toContain(
      LOCAL_E57_INTAKE_ENVIRONMENT_GENERATED_SOURCE_PATH,
    );
    const readinessSource = await readFile(
      resolve(
        REPOSITORY_ROOT,
        "tools/reconstruction-foundry/src/local-hd-worker-readiness.ts",
      ),
      "utf8",
    );
    const localAppSource = await readFile(
      resolve(REPOSITORY_ROOT, "tools/reconstruction-foundry/src/local-app.ts"),
      "utf8",
    );
    expect(readinessSource).toContain(
      'from "./local-hd-worker-manifest.generated.js"',
    );
    expect(readinessSource).toContain(
      'from "./local-e57-intake-environment-readiness.js"',
    );
    expect(localAppSource).toContain(
      'from "./local-hd-worker-readiness.js"',
    );
  });

  it("rejects a release graph that omits the build-owned HD worker plan", () => {
    expect(() => auditAndNormalizeMetafile(reviewedMainMetafile(false))).toThrow(
      /HD worker generated source is absent from the audited graph/u,
    );
  });

  it("rejects a release graph that omits the build-owned E57 environment", () => {
    expect(() => auditAndNormalizeMetafile(reviewedMainMetafile(true, false)))
      .toThrow(/E57 environment generated source is absent from the audited graph/u);
  });

  it("rejects a tree-shaken E57 environment that contributes no release bytes", () => {
    expect(() => auditAndNormalizeMetafile(reviewedMainMetafile(true, true, 0)))
      .toThrow(/E57 environment generated source contributes no bytes/u);
  });

  it("accepts only the exact sharp win32-x64 native inventory", () => {
    expect(() => {
      assertNativeRuntimeInventory({
        files: [...SHARP_NATIVE_FILES],
        directories: ["lib"],
      });
    }).not.toThrow();
    expect(() => {
      assertNativeRuntimeInventory({
        files: [...SHARP_NATIVE_FILES, "lib/unreviewed.dll"],
        directories: ["lib"],
      });
    }).toThrow(/exact reviewed allowlist/u);
    expect(() => {
      assertNativeRuntimeInventory({
        files: SHARP_NATIVE_FILES.filter((path) => path !== "versions.json"),
        directories: ["lib"],
      });
    }).toThrow(/exact reviewed allowlist/u);
  });

  it("rejects emitted siblings even when esbuild would not import them", () => {
    expect(() => {
      assertNoEmittedSourceSiblings([
        "packages/reconstruction-foundry/src/gltf-validator.d.ts",
        "tools/reconstruction-foundry/src/entry.ts",
      ]);
    }).not.toThrow();
    for (const path of [
      "packages/reconstruction-foundry/src/unreferenced.js",
      "packages/reconstruction-foundry/src/unreferenced.js.map",
      "packages/types/src/unreferenced.d.ts",
      "tools/reconstruction-foundry/src/unreferenced.d.ts.map",
    ]) {
      expect(() => {
        assertNoEmittedSourceSiblings([path]);
      }).toThrow(/emitted source sibling/u);
    }
  });

  it("pins deterministic launcher/help bytes and safe special-space quoting", () => {
    const launcher = windowsLauncherBytes();
    const startHere = startHereBytes();
    expect(sha256(launcher)).toBe(
      "sha256:0e375eaf3b9bc12d12328884036b532e29b614446ae11067dc85c7c6b314fbb5",
    );
    expect(sha256(startHere)).toBe(
      "sha256:45a68648709b8edaa1e69ea7e9bfc96956f15e9f076b839f5c7b9763da40cce8",
    );
    const launcherText = launcher.toString("utf8");
    const startHereText = startHere.toString("utf8");
    expect(launcherText).not.toMatch(/(?<!\r)\n/u);
    expect(startHereText).not.toMatch(/(?<!\r)\n/u);
    expect(startHereText).toContain("HOW TO SAVE YOUR WORK");
    expect(startHereText).toContain("Choose Download one complete file");
    expect(startHereText).toContain(
      `sources with ${String(LOCAL_FOUNDRY_MAX_COMPLETE_HANDOFF_FILES)} or fewer inspected files`,
    );
    expect(startHereText).toContain(
      `no larger than ${String(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0 / (1024 * 1024))} MiB`,
    );
    expect(startHereText).toContain(
      "the app builds the file and reads the source again",
    );
    expect(startHereText).toContain(
      "If the source changed or the completed file is too large, nothing is saved.",
    );
    expect(startHereText).toContain(
      "If you change any review or plan choices, build the updated review or plan first, then download the complete file again.",
    );
    expect(launcherText).toContain('set "FOUNDRY_SOURCE=%~f1"');
    expect(launcherText).toContain(
      '"%FOUNDRY_NODE%" --disable-warning=ExperimentalWarning "%~dp0foundry.mjs" local-app --source "%FOUNDRY_SOURCE%" --open',
    );
    expect(launcherText).toContain('set "FOUNDRY_NODE=%~dp0runtime\\node.exe"');
    expect(launcherText).not.toMatch(/(^|\r\n)node /u);
    expect(launcherText).toContain('set "NODE_OPTIONS="');
    expect(launcherText).toContain('set "NODE_PATH="');
    expect(launcherText).toContain('set "NODE_ENV=production"');
    const launcherLines = launcherText.split("\r\n");
    const invocationIndex = launcherLines.indexOf(
      '"%FOUNDRY_NODE%" --disable-warning=ExperimentalWarning "%~dp0foundry.mjs" local-app --source "%FOUNDRY_SOURCE%" --open',
    );
    const cloudClearLines = launcherLines.filter((line) =>
      line.startsWith('set "FOUNDRY_R2_') || line === 'set "R2_SESSION_TOKEN="');
    expect(cloudClearLines).toEqual(
      FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES.map((name) => `set "${name}="`),
    );
    for (const name of FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES) {
      expect(launcherLines.indexOf(`set "${name}="`)).toBeGreaterThan(-1);
      expect(launcherLines.indexOf(`set "${name}="`)).toBeLessThan(invocationIndex);
    }
    expect(startHere.toString("utf8")).toContain(
      "uses the private Node runtime included and byte-checked when this release was built",
    );
    expect(startHere.toString("utf8")).toContain(
      "Windows may fetch source bytes if the selected path is mapped or cloud-backed",
    );
    expect(startHere.toString("utf8")).toContain(
      "Downloads location, which may be cloud-synced",
    );
    expect(startHere.toString("utf8")).toContain(
      "launcher removes these six Foundry cloud settings",
    );
    for (const name of FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES) {
      expect(startHere.toString("utf8")).toContain(name);
    }
  });

  it.runIf(process.platform === "win32" && process.version === "v22.18.0")(
    "removes inherited Foundry cloud settings from the real launcher-spawned child",
    async () => {
      const root = await temporaryDirectory();
      const runtimeDirectory = join(root, "runtime");
      const sourcePath = join(root, "trusted-source.obj");
      try {
        await mkdir(runtimeDirectory);
        await copyFile(process.execPath, join(runtimeDirectory, "node.exe"));
        await writeFile(join(root, WINDOWS_LAUNCHER_PATH), windowsLauncherBytes());
        await writeFile(sourcePath, "trusted source", "utf8");
        const expectedArguments = ["local-app", "--source", sourcePath, "--open"];
        const childScript = [
          `const names = ${JSON.stringify(FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES)};`,
          `const expected = ${JSON.stringify(expectedArguments)};`,
          "const leaked = names.filter((name) => process.env[name] !== undefined);",
          "if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) {",
          "  process.stderr.write('launcher arguments changed\\n');",
          "  process.exit(72);",
          "}",
          "if (leaked.length > 0) {",
          "  process.stderr.write(`inherited cloud settings: ${leaked.join(',')}\\n`);",
          "  process.exit(73);",
          "}",
          "process.stdout.write('LOCAL_APP_CHILD_ENV_CLEARED\\n');",
        ].join("\n");
        await writeFile(join(root, BUNDLE_PATH), childScript, "utf8");
        const commandProcessor = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
        const sentinelEnvironment = Object.fromEntries(
          FOUNDRY_CLOUD_ENVIRONMENT_VARIABLES.map((name) => [name, `sentinel-${name}`]),
        );
        const launched = spawnSync(
          commandProcessor,
          ["/d", "/c", "call", WINDOWS_LAUNCHER_PATH, sourcePath],
          {
            cwd: root,
            env: {
              ComSpec: commandProcessor,
              SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
              ...sentinelEnvironment,
            },
            encoding: "utf8",
            windowsHide: true,
          },
        );
        expect(launched.status, launched.stderr).toBe(0);
        expect(launched.stdout).toContain("LOCAL_APP_CHILD_ENV_CLEARED");
        expect(launched.stderr).toBe("");
      } finally {
        await removeOwnedTemporaryDirectory(root);
      }
    },
    30_000,
  );

  it("rejects test-only factories but reports production-disabled small-I/O code", () => {
    expect(() => auditBundleText(
      "const __testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox = 1;",
    )).toThrow(/test-only factory symbol/u);
    const result = auditBundleText(
      "value.testOnlyAllowSmallIo; throw new Error('testOnlyAllowSmallIo is forbidden outside NODE_ENV=test.');",
    );
    expect(result).toMatchObject({
      knownDoubleUnderscoreTestOnlyFactorySymbolsPresent: false,
      testOnlyAllowSmallIoPresent: true,
      comprehensiveNoTestSeamProof: false,
    });
  });

  it("rejects builder/runtime/esbuild provenance drift", () => {
    const initial = [{ path: "host/node.exe", sha256: "sha256:initial" }];
    expect(() => {
      assertBuilderInputsUnchanged(initial, initial);
    }).not.toThrow();
    expect(() => {
      assertBuilderInputsUnchanged(initial, [
        { path: "host/node.exe", sha256: "sha256:changed" },
      ]);
    }).toThrow(/input bytes or file identity changed/u);
  });

  it("accepts only the exact canonical null bundled-release source bytes", async () => {
    const source = await readFile(BUNDLED_RELEASE_SOURCE_PATH);
    const proof = assertBundledReleaseNullSourceBytes(source);
    expect(proof).toMatchObject({
      sizeBytes: 781,
      sha256: BUNDLED_RELEASE_NULL_SOURCE_SHA256,
      initializerForEveryBinding: null,
      importsOrAdditionalExecutableCodePermitted: false,
      enforcement: "exact_canonical_source_bytes",
    });

    const hostileCommentAndNonNullExport = Buffer.from(
      source.toString("utf8").replace(
        "  unknown = null;",
        [
          "  unknown = { injected: true };",
          "// LOCAL_OFFLINE_PREVIEW_GENERATED_BUNDLED_RELEASE_MANIFEST:",
          "//   unknown = null;",
        ].join("\n"),
      ),
      "utf8",
    );
    expect(() => {
      assertBundledReleaseNullSourceBytes(hostileCommentAndNonNullExport);
    }).toThrow(/exactly the reviewed two null exports/u);

    const additionalExecutableCode = Buffer.concat([
      source,
      Buffer.from("process.stdout.write('hidden executable');\n", "utf8"),
    ]);
    expect(() => {
      assertBundledReleaseNullSourceBytes(additionalExecutableCode);
    }).toThrow(/no imports, aliases, or additional executable code/u);
  });

  it("rejects byte and normalized-graph nondeterminism", () => {
    const first = {
      bundle: Buffer.from("bundle", "utf8"),
      legal: Buffer.from("legal", "utf8"),
      graph: { inputs: ["current-source.ts"] },
    };
    expect(() => {
      assertDeterministicEsbuildOutputs(first, {
        ...first,
        bundle: Buffer.from("changed", "utf8"),
      });
    }).toThrow(/different foundry\.mjs bytes/u);
    expect(() => {
      assertDeterministicEsbuildOutputs(first, {
        ...first,
        graph: { inputs: ["stale-source.js"] },
      });
    }).toThrow(/different normalized graphs/u);
  });

  it("reconciles every main/probe input and rejects a shared-record split", () => {
    const generatedPath =
      "tools/reconstruction-foundry/src/local-offline-normalization-preview-bundled-release.generated.ts";
    const modulePath =
      "tools/reconstruction-foundry/src/local-offline-normalization-preview-bundled-release.ts";
    const generated = testFileRecord(generatedPath, "generated");
    const module = testFileRecord(modulePath, "module");
    const main = [testFileRecord("tools/reconstruction-foundry/src/entry.ts", "main"), module, generated];
    const probeEntry = testFileRecord(
      "tools/reconstruction-foundry/scripts/production-bundled-release-absence-probe.mjs",
      "probe",
    );
    const probe = [
      probeEntry,
      module,
      generated,
    ];
    expect(assertSharedRepositoryInputsEqual(main, probe, "stage-a")).toMatchObject({
      sharedInputCount: 2,
      sharedRecordsSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    const union = reconcileRepositoryInputRecords([main, probe]);
    expect(union.map(({ path }) => path)).toEqual([
      "tools/reconstruction-foundry/scripts/production-bundled-release-absence-probe.mjs",
      "tools/reconstruction-foundry/src/entry.ts",
      generatedPath,
      modulePath,
    ].sort());
    expect(() => assertSharedRepositoryInputsEqual(
      main,
      probe.map((record) => record.path === modulePath
        ? testFileRecord(modulePath, "changed module")
        : record),
      "stage-a",
    )).toThrow(/shared source or dependency differs/u);
    expect(() => assertSharedRepositoryInputsEqual(
      main,
      probe.filter(({ path }) => path !== modulePath),
      "stage-a",
    )).toThrow(/does not share required bundled-release input/u);
    expect(() => reconcileRepositoryInputRecords([main, [...probe, probeEntry]])).toThrow(
      /repeats input path/u,
    );
  });

  it("rejects changed, missing, or added records during the final input rehash", () => {
    const heldA = testFileRecord("a.ts", "a");
    const heldB = testFileRecord("b.ts", "b");
    const held = [heldA, heldB];
    expect(() => {
      assertRepositoryInputRecordsUnchanged(held, [...held], "final");
    }).not.toThrow();
    expect(() => {
      assertRepositoryInputRecordsUnchanged(
        held,
        [heldA, testFileRecord("b.ts", "changed")],
        "final",
      );
    }).toThrow(/input records changed during final rehash/u);
    expect(() => {
      assertRepositoryInputRecordsUnchanged(held, [heldA], "final");
    }).toThrow(
      /input records changed during final rehash/u,
    );
    expect(() => {
      assertRepositoryInputRecordsUnchanged(
        held,
        [...held, testFileRecord("c.ts", "c")],
        "final",
      );
    }).toThrow(/input records changed during final rehash/u);
  });

  it("binds the exact staged file/directory allowlist and held records", () => {
    const exactInventory = { files: ["a", "nested/b"], directories: ["nested"] };
    expect(() => {
      assertExactPayloadInventory(exactInventory, ["nested/b", "a"], ["nested"]);
    }).not.toThrow();
    for (const inventory of [
      { files: ["a", "nested/b", "extra"], directories: ["nested"] },
      { files: ["a"], directories: ["nested"] },
      { files: ["a", "nested/b"], directories: ["nested", "empty"] },
      { files: ["a", "nested/b"], directories: [] },
    ]) {
      expect(() => {
        assertExactPayloadInventory(inventory, ["a", "nested/b"], ["nested"]);
      }).toThrow(/exact staged payload inventory differs/u);
    }
    const held = testFileRecord("foundry.mjs", "held bundle");
    expect(() => {
      assertHeldRecordMatches(held, { ...held }, "bundle");
    }).not.toThrow();
    expect(() => {
      assertHeldRecordMatches(
        testFileRecord("foundry.mjs", "same-size!!"),
        held,
        "bundle",
      );
    }).toThrow(/differs from its held size\/hash record/u);
  });

  it("preserves primary failure precedence and warns after verified cleanup failure", () => {
    const success = finalizeReleaseOutcome({
      result: { published: true },
      primaryError: null,
      cleanupError: null,
      cleanupSkippedReason: null,
      temporaryRoot: "C:\\temp\\stage",
      outputDirectory: "C:\\release",
      publicationVerified: true,
    });
    expect(success).toMatchObject({
      published: true,
      temporaryBuildCleanupCompleted: true,
      cleanupWarning: null,
    });
    const warned = finalizeReleaseOutcome({
      result: { published: true },
      primaryError: null,
      cleanupError: new Error("cleanup locked"),
      cleanupSkippedReason: null,
      temporaryRoot: "C:\\temp\\stage",
      outputDirectory: "C:\\release",
      publicationVerified: true,
    });
    expect(warned).toMatchObject({
      published: true,
      temporaryBuildCleanupCompleted: false,
      cleanupWarning: {
        message: expect.stringContaining("cleanup locked"),
        publicationVerified: true,
      },
    });
    const primary = new Error("primary build failure");
    let thrown: unknown;
    try {
      finalizeReleaseOutcome({
        result: null,
        primaryError: primary,
        cleanupError: new Error("secondary cleanup failure"),
        cleanupSkippedReason: null,
        temporaryRoot: "C:\\temp\\stage",
        outputDirectory: "C:\\release",
        publicationVerified: false,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(primary);
    expect(primary.message).toMatch(/^primary build failure.*Cleanup warning:/u);
  });

  it("enforces named child policies and confirms timeout/output-limit termination", async () => {
    expect(Object.keys(CHILD_PROCESS_LIMITS).sort()).toEqual([
      "esbuild",
      "nodeVersion",
      "powershellLicenseExtraction",
      "smoke",
    ]);
    expect(Object.values(CHILD_PROCESS_LIMITS).every((policy) =>
      Object.isFrozen(policy) && policy.timeoutMs > 0 &&
      policy.maxStdoutBytes > 0 && policy.maxStderrBytes > 0)).toBe(true);
    const timeout = await runBoundedChildProcess({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"],
      cwd: REPOSITORY_ROOT,
      description: "test timeout child",
      timeoutMs: 200,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      killConfirmationMs: 5_000,
    });
    expect(timeout).toMatchObject({
      terminationReason: "timeout",
      terminationRequested: true,
      terminationConfirmed: true,
      closeObserved: true,
      temporaryHandoffRequired: false,
    });
    const outputFlood = await runBoundedChildProcess({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.alloc(65536,0x78));setInterval(()=>{},1000)"],
      cwd: REPOSITORY_ROOT,
      description: "test output-bound child",
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      killConfirmationMs: 5_000,
    });
    expect(outputFlood).toMatchObject({
      terminationReason: "stdout_limit_exceeded",
      terminationRequested: true,
      terminationConfirmed: true,
      closeObserved: true,
      temporaryHandoffRequired: false,
    });
    expect(outputFlood.stdout.byteLength).toBeLessThanOrEqual(1024);
  }, 10_000);

  it("preserves the published directory when the full post-publish hash fails", async () => {
    const root = await temporaryDirectory();
    const staging = join(root, "staging");
    const output = join(root, "published");
    try {
      await mkdir(staging);
      await writeFile(join(staging, "foundry.mjs"), "before", "utf8");
      const expected = await snapshotTree(staging);
      await writeFile(join(staging, "foundry.mjs"), "after", "utf8");
      await mkdir(join(staging, "unexpected-empty-directory"));
      await expect(publishAndVerify(staging, output, expected)).rejects.toThrow(
        /full post-publication tree re-read\/re-hash/u,
      );
      await expect(access(output)).resolves.toBeUndefined();
      await expect(readFile(join(output, "foundry.mjs"), "utf8")).resolves.toBe("after");
    } finally {
      await removeOwnedTemporaryDirectory(root);
    }
  });

  it("preserves a replaced temporary root instead of recursively deleting it", async () => {
    const parent = await temporaryDirectory();
    const temporaryRoot = await mkdtemp(join(parent, ".foundry-windows-x64-release-"));
    const displacedRoot = `${temporaryRoot}-original`;
    try {
      const identity = await captureTemporaryRootIdentity(temporaryRoot, parent);
      await rename(temporaryRoot, displacedRoot);
      await mkdir(temporaryRoot);
      await writeFile(join(temporaryRoot, "preserve.txt"), "replacement", "utf8");
      await expect(removeVerifiedTemporaryRoot(identity)).rejects.toThrow(
        /identity changed; preserving/u,
      );
      await expect(readFile(join(temporaryRoot, "preserve.txt"), "utf8")).resolves.toBe(
        "replacement",
      );
    } finally {
      await removeOwnedTemporaryDirectory(parent);
    }
  });
});

it.runIf(
  process.version === "v22.18.0" && process.platform === "win32" && process.arch === "x64",
)("builds, smokes, publishes by one directory rename, and re-hashes the complete release", async () => {
  const root = await temporaryDirectory();
  const output = join(root, "release with spaces");
  try {
    const first = spawnSync(process.execPath, [SCRIPT_PATH, output], {
      cwd: REPOSITORY_ROOT,
      env: {},
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    expect(first.status, first.stderr).toBe(0);
    const summary = JSON.parse(first.stdout) as BuildSummary;
    expect(summary).toMatchObject({
      outputDirectory: output,
      repeatBuildsByteIdentical: true,
      normalizedGraphsIdentical: true,
      postPublishFullTreeVerified: true,
      allMainAndProbeInputsFinalRehashed: true,
      publishedBundleMatchesHeldBytes: true,
      temporaryBuildCleanupCompleted: true,
      cleanupWarning: null,
      productionNormalizationQualified: false,
    });
    const [manifestText, graphText, bundle, legal] = await Promise.all([
      readFile(join(output, RELEASE_MANIFEST_PATH), "utf8"),
      readFile(join(output, BUILD_GRAPH_PATH), "utf8"),
      readFile(join(output, BUNDLE_PATH)),
      readFile(join(output, LEGAL_PATH)),
    ]);
    const manifest = JSON.parse(manifestText) as ReleaseManifestEvidence;
    const graph = JSON.parse(graphText) as BuildGraphEvidence;
    expect(summary.bundleSha256).toBe(sha256(bundle));
    expect(manifest.normalizationQualification).toEqual({
      productionNormalizationQualified: false,
      bundledReleaseManifestInCurrentSource: null,
      dockerQualificationAuthorized: false,
    });
    expect(manifest.smokeTest.cliHelp).toMatchObject({
      command: ["runtime/node.exe", "foundry.mjs", "--help"],
      environment: "empty",
      exitCode: 0,
    });
    expect(manifest.smokeTest.bundledReleaseLookup).toMatchObject({
      command: [
        "runtime/node.exe",
        "<ephemeral>/production-bundled-release-absence-probe.mjs",
      ],
      environment: "empty",
      exitCode: 0,
      observedStatus: "unavailable",
      observedCode: "NO_DOCKER_QUALIFIED_BUNDLED_RELEASE",
      observedCapability: null,
      observedRejectionCode: null,
    });
    expect(manifest.publication).toEqual({
      outputMustNotExist: true,
      mechanism: "single_best_available_windows_directory_rename",
      directoryRenameCount: 1,
      strictAtomicNoReplaceEstablished: false,
      sameUserRaceResistanceEstablished: false,
      verificationScope: "point_in_time_full_tree_reread_and_rehash_after_rename",
      publishedTreePreservedOnPostPublishFailure: true,
    });
    expect(manifest.thirdPartyLicenseEvidence).toEqual({
      esbuildLegalOutputIncluded: true,
      sharpNativeLicenseIncluded: true,
      nodeMsiLicenseRtfIncluded: true,
      thirdPartyLicenseClosureEstablished: false,
      commercialRedistributionApprovedByThisBuild: false,
    });
    expect(manifest.payloadFiles.some(({ path }) => path.endsWith(".msi"))).toBe(false);
    expect(graph.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        specifier: "@omnitwin/types",
        target: "packages/types/src/index.ts",
      }),
      expect.objectContaining({
        specifier: "@omnitwin/types/reconstruction-dsse",
        target: "packages/types/src/reconstruction-dsse.ts",
      }),
    ]));
    expect(graph.builder.inputs.map(({ path }) => path)).toEqual([
      "tools/reconstruction-foundry/scripts/build-windows-x64-production-release.mjs",
      "host/node.exe",
      "host/node-installer.msi",
      "host/windows-powershell.exe",
      "tools/reconstruction-foundry/scripts/production-bundled-release-absence-probe.mjs",
      "node_modules/.pnpm/@esbuild+win32-x64@0.25.0/node_modules/@esbuild/win32-x64/esbuild.exe",
    ]);
    expect(graph.sourceCustody.sharedMainProbeInputs).toHaveLength(2);
    expect(graph.sourceCustody.sharedMainProbeInputs.every(({ sharedInputCount }) =>
      sharedInputCount >= 2)).toBe(true);
    expect(graph.sourceCustody.completeInputUnion).toEqual(
      graph.sourceCustody.postBuildUnifiedRehash,
    );
    expect(graph.sourceCustody.finalPrepublicationUnifiedRehash).toEqual({
      required: true,
      expectedInputCount: graph.sourceCustody.completeInputUnion.inputCount,
      expectedRecordsSha256: graph.sourceCustody.completeInputUnion.recordsSha256,
      completionReportedByBuilderSummary: true,
    });
    expect(manifest.runtime).toMatchObject({
      nodeVersion: "v22.18.0",
      systemNodeRequired: false,
      includedNodeExecutable: {
        path: NODE_RUNTIME_PATH,
      },
      includedNodeLicense: {
        path: NODE_LICENSE_PATH,
      },
    });
    expect(graph.includedNodeRuntime.executable.destination).toEqual(
      manifest.runtime.includedNodeExecutable,
    );
    expect(graph.includedNodeRuntime.executable.source).toMatchObject({
      path: "host/node.exe",
      sizeBytes: manifest.runtime.includedNodeExecutable.sizeBytes,
      sha256: manifest.runtime.includedNodeExecutable.sha256,
    });
    expect(graph.includedNodeRuntime.license.destination).toEqual(
      manifest.runtime.includedNodeLicense,
    );
    expect(graph.includedNodeRuntime.license.source).toMatchObject({
      sizeBytes: manifest.runtime.includedNodeLicense.sizeBytes,
      sha256: manifest.runtime.includedNodeLicense.sha256,
    });
    expect(graph.includedNodeRuntime.license.installer).toMatchObject({
      path: "host/node-installer.msi",
      sha256: "sha256:dffd8e34d8eb1a1a2e6f5e6f129c4b1b8a34aa54e02799007adc99d73efac75c",
    });
    expect(graph.includedNodeRuntime.license.authenticode).toMatchObject({
      status: "Valid",
      signerSubject:
        "CN=OpenJS Foundation, O=OpenJS Foundation, L=San Francisco, S=California, C=US",
      signerThumbprint: "EAE583500C412290DF17D286ADCB1FAD1DB06971",
      independentlyVerifiedByBuilder: false,
    });
    expect(graph.includedNodeRuntime.license.authenticode.timestampSubject).not.toBe("");
    expect(graph.includedNodeRuntime.license.authenticode.timestampThumbprint).toMatch(
      /^[A-F0-9]{40}$/u,
    );
    expect(graph.includedNodeRuntime.license.extraction).toMatchObject({
      mechanism: "read_only_windows_installer_database_com_query",
      databaseOpenMode: 0,
      msiInstallationOrCustomActionsExecuted: false,
    });
    expect(graph.bundledReleaseNullSource).toMatchObject({
      sizeBytes: 781,
      sha256: BUNDLED_RELEASE_NULL_SOURCE_SHA256,
      initializerForEveryBinding: null,
      importsOrAdditionalExecutableCodePermitted: false,
      enforcement: "exact_canonical_source_bytes",
    });
    expect(graph.normalizedGraph.inputs.every(({ path }) =>
      !path.startsWith("packages/types/dist/") &&
      !path.startsWith("tools/reconstruction-foundry/dist/") &&
      !path.includes("/__tests__/") &&
      !path.includes("/support/"))).toBe(true);
    const bundleText = bundle.toString("utf8");
    expect(bundleText).not.toContain("__testOnlyCreateLocalOfflineNormalizationPreviewDockerSandbox");
    for (const symbol of [
      "helperFactory",
      "offlineNormalizationPreviewTestHooks",
      "referenceVerificationTestHooks",
      "sourceHandleCloser",
    ]) {
      expect(bundleText).toContain(symbol);
      expect(graph.bundleAudit.knownInternalOptionSeams).toContainEqual(
        expect.objectContaining({ symbol, present: true }),
      );
    }
    expect(legal.byteLength).toBeGreaterThan(0);
    const includedNodeBytes = await readFile(join(output, ...NODE_RUNTIME_PATH.split("/")));
    expect(sha256(includedNodeBytes)).toBe(
      manifest.runtime.includedNodeExecutable.sha256,
    );
    expect(includedNodeBytes.byteLength).toBe(
      manifest.runtime.includedNodeExecutable.sizeBytes,
    );
    const includedNodeVersion = spawnSync(
      join(output, ...NODE_RUNTIME_PATH.split("/")),
      ["--version"],
      { cwd: output, env: {}, encoding: "utf8", windowsHide: true },
    );
    expect(includedNodeVersion.status).toBe(0);
    expect(includedNodeVersion.stdout.trim()).toBe("v22.18.0");
    const includedNodeLicense = await readFile(
      join(output, ...NODE_LICENSE_PATH.split("/")),
    );
    expect(sha256(includedNodeLicense)).toBe(manifest.runtime.includedNodeLicense.sha256);
    expect(includedNodeLicense.byteLength).toBe(
      manifest.runtime.includedNodeLicense.sizeBytes,
    );
    expect(includedNodeLicense.subarray(0, 6).toString("utf8")).toBe("{\\rtf1");
    expect(includedNodeLicense.toString("utf8")).toContain(
      "Node.js is licensed for use as follows:",
    );
    expect(manifest.payloadFiles.find(({ path }) => path === NODE_LICENSE_PATH)).toEqual(
      manifest.runtime.includedNodeLicense,
    );
    for (const [path, bytes] of [
      [WINDOWS_LAUNCHER_PATH, windowsLauncherBytes()],
      [START_HERE_PATH, startHereBytes()],
    ] as const) {
      const publishedBytes = await readFile(join(output, path));
      expect(publishedBytes.equals(bytes)).toBe(true);
      expect(manifest.payloadFiles.find((record) => record.path === path)).toEqual({
        path,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
    for (const path of SHARP_NATIVE_FILES) {
      await expect(access(join(
        output,
        "node_modules",
        "@img",
        "sharp-win32-x64",
        ...path.split("/"),
      ))).resolves.toBeUndefined();
    }
    const publishedSnapshot = await snapshotTree(output);
    const expectedPublishedFiles = [
      BUILD_GRAPH_PATH,
      BUNDLE_PATH,
      LEGAL_PATH,
      RELEASE_MANIFEST_PATH,
      WINDOWS_LAUNCHER_PATH,
      START_HERE_PATH,
      NODE_RUNTIME_PATH,
      NODE_LICENSE_PATH,
      ...SHARP_NATIVE_FILES.map((path) => `node_modules/@img/sharp-win32-x64/${path}`),
    ].sort((left, right) => left.localeCompare(right, "en"));
    expect(publishedSnapshot.files.map(({ path }) => path)).toEqual(expectedPublishedFiles);
    expect(publishedSnapshot.directories).toEqual([
      "node_modules",
      "node_modules/@img",
      "node_modules/@img/sharp-win32-x64",
      "node_modules/@img/sharp-win32-x64/lib",
      "runtime",
    ]);
    expect(manifest.payloadFiles).toEqual(
      publishedSnapshot.files.filter(({ path }) => path !== RELEASE_MANIFEST_PATH),
    );
    expect(manifest.payloadDirectories).toEqual(publishedSnapshot.directories);
    const commandProcessor = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
    const commandEnvironment = {
      ComSpec: commandProcessor,
      SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    };
    const noArgument = spawnSync(
      commandProcessor,
      ["/d", "/c", "call", WINDOWS_LAUNCHER_PATH],
      { cwd: output, env: commandEnvironment, encoding: "utf8", windowsHide: true },
    );
    expect(noArgument.status).toBe(64);
    expect(noArgument.stdout).toContain("Drag exactly one local file or folder");
    const extraArguments = spawnSync(
      commandProcessor,
      ["/d", "/c", "call", WINDOWS_LAUNCHER_PATH, "one", "two"],
      { cwd: output, env: commandEnvironment, encoding: "utf8", windowsHide: true },
    );
    expect(extraArguments.status).toBe(64);
    expect(extraArguments.stdout).toContain("not multiple items");
    const repeated = spawnSync(process.execPath, [SCRIPT_PATH, output], {
      cwd: REPOSITORY_ROOT,
      env: {},
      encoding: "utf8",
      windowsHide: true,
    });
    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toMatch(/output directory already exists/u);
  } finally {
    await removeOwnedTemporaryDirectory(root);
  }
}, 120_000);
