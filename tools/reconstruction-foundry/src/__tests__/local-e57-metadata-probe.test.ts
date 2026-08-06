import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectFoundryInputFile } from "@omnitwin/types";
import {
  createUniversalSourceFactsStreamCollector,
  domainSeparatedSha256,
  FOUNDRY_LOCAL_E57_AGGREGATE_PROBE,
  FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256,
  FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME,
  FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE,
  FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0,
  FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0,
  FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0,
  issueLocalE57RuntimeAdapterBinding,
  issueLocalE57RuntimeBundleReceipt,
  issueLocalE57RuntimeQualificationReceipt,
  toCanonicalJson,
  type E57AggregateMetadata,
  type LocalE57RuntimeAdapterBinding,
  type UniversalSourceFactsFileResult,
  type UniversalSourceFactsReceiptFileIdentity,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES,
  LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES,
  LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS,
  LOCAL_E57_METADATA_PROBE_DIGEST_DOMAIN,
  LOCAL_E57_METADATA_PROBE_LIMITATIONS,
  LOCAL_E57_METADATA_PROBE_POLICY,
  LOCAL_E57_METADATA_PROBE_TIMEOUT_MS,
  LocalE57MetadataProbeError,
  __testOnlyCreateLocalE57MetadataProbeAdapter,
  verifyLocalE57MetadataProbeResultDigest,
  type LocalE57MetadataProbeInput,
  type LocalE57MetadataProbeProcessOutcome,
  type LocalE57MetadataProbeProcessRunner,
} from "../local-e57-metadata-probe.js";

const temporaryRoots: string[] = [];

async function removeTemporaryFixture(root: string): Promise<void> {
  const target = resolve(root);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith("venviewer-e57-adapter-")
  ) {
    throw new Error("Refusing to remove a path outside the E57 adapter test-fixture namespace.");
  }
  await rm(target, { force: true, recursive: true });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTemporaryFixture));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function e57Fixture(size = 64): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write("ASTM-E57", 0, "ascii");
  bytes.writeUInt32LE(1, 8);
  bytes.writeUInt32LE(0, 12);
  bytes.writeBigUInt64LE(BigInt(size), 16);
  bytes.writeBigUInt64LE(48n, 24);
  bytes.writeBigUInt64LE(0n, 32);
  bytes.writeBigUInt64LE(1024n, 40);
  return bytes;
}

function collectEstablishedHeader(
  path: string,
  bytes: Uint8Array,
): {
  readonly receiptIdentity: UniversalSourceFactsReceiptFileIdentity;
  readonly sourceFacts: UniversalSourceFactsFileResult;
} {
  const receiptIdentity: UniversalSourceFactsReceiptFileIdentity = {
    path,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    detection: detectFoundryInputFile({
      relativePath: path,
      magicHex: Buffer.from(bytes.subarray(0, 64)).toString("hex"),
      boundedHeaderText: null,
    }),
  };
  const collector = createUniversalSourceFactsStreamCollector(path);
  collector.observe(bytes, 0);
  return { receiptIdentity, sourceFacts: collector.finalize(receiptIdentity) };
}

function aggregateFixture(byteSize: number): E57AggregateMetadata {
  return {
    adapter: { name: "pye57", version: "0.4.19" },
    imageBlobBytesRead: false,
    openMode: "read-only",
    pointRecordsRead: false,
    runtimeVersions: { numpy: "2.5.1", python: "3.13.14" },
    blobDeclarationHistogram: [
      { declarationCount: 1, declaredByteTotal: "12", kind: "jpegImage" },
    ],
    coordinateMetadata: { present: true, sha256: "a".repeat(64), utf8ByteCount: 9 },
    declaredImageBlobByteTotal: "12",
    declaredPointRecordTotal: "42",
    file: { byteSize },
    imageCount: 1,
    imagePoseCounts: { absent: 0, present: 1 },
    imageRepresentationCardinality: { absent: 0, multiple: 0, single: 1 },
    imageRepresentationHistogram: [
      { declarationCount: 1, kind: "pinholeRepresentation" },
    ],
    pointFieldCoverage: [
      { field: "cartesianX", scanCount: 2 },
      { field: "cartesianY", scanCount: 2 },
      { field: "cartesianZ", scanCount: 2 },
    ],
    scanCount: 2,
    scanPoseCounts: { absent: 1, present: 1 },
  };
}

function completed(result: unknown, stderr = Buffer.alloc(0)): LocalE57MetadataProbeProcessOutcome {
  return {
    kind: "completed",
    exitCode: 0,
    signal: null,
    stderr,
    stdout: Buffer.from(JSON.stringify({
      mode: "inspect-e57-aggregate",
      result,
      schemaVersion: "omnitwin.foundry.phase1-probe.v0",
      status: "ok",
    }), "utf8"),
  };
}

interface ProbeFixture {
  readonly boundRuntime: LocalE57RuntimeAdapterBinding;
  readonly dependencyRootPath: string;
  readonly input: LocalE57MetadataProbeInput;
  readonly interpreterPath: string;
  readonly probePath: string;
  readonly sourceFacts: UniversalSourceFactsFileResult;
  readonly sourcePath: string;
}

async function createProbeFixture(): Promise<ProbeFixture> {
  const root = await mkdtemp(join(tmpdir(), "venviewer-e57-adapter-"));
  temporaryRoots.push(root);
  const sourceBytes = e57Fixture();
  const sourcePath = join(root, "capture.e57");
  const runtimeBundleRootPath = join(root, "runtime-bundle");
  const interpreterPath = join(runtimeBundleRootPath, "runtime", "python.exe");
  const probePath = join(runtimeBundleRootPath, "probe", "foundry_phase1_probe.py");
  const dependencyRootPath = join(runtimeBundleRootPath, "site-packages");
  const legalNoticePath = join(runtimeBundleRootPath, "legal", "pybind11-LICENSE.txt");
  const interpreterBytes = Buffer.from("pinned-python-interpreter", "utf8");
  const probeBytes = await readFile(fileURLToPath(new URL(
    "../../../capture-factory/python/foundry_phase1_probe.py",
    import.meta.url,
  )));
  expect(probeBytes.byteLength).toBe(FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sizeBytes);
  expect(sha256(probeBytes)).toBe(FOUNDRY_LOCAL_E57_AGGREGATE_PROBE.sha256);
  const vcruntimeBytes = Buffer.from("synthetic-vcruntime140", "utf8");
  const vcruntimeOneBytes = Buffer.from("synthetic-vcruntime140-1", "utf8");
  const renamedNumpyMsvcpBytes = Buffer.from("synthetic-renamed-numpy-msvcp140", "utf8");
  const numpyBytes = Buffer.from("# numpy 2.5.1\n", "utf8");
  const pye57Bytes = Buffer.from("# pye57 0.4.19\n", "utf8");
  const pye57ExtensionBytes = Buffer.from("synthetic-cp313-extension", "utf8");
  const pye57MetadataBytes = Buffer.from(
    "Metadata-Version: 2.1\nName: pye57\nVersion: 0.4.19\n",
    "utf8",
  );
  const pybind11LicenseBytes = await readFile(fileURLToPath(new URL(
    "../../../../legal/third-party/pybind11-LICENSE.txt",
    import.meta.url,
  )));
  await Promise.all([
    mkdir(dirname(interpreterPath), { recursive: true }),
    mkdir(dirname(probePath), { recursive: true }),
    mkdir(dirname(legalNoticePath), { recursive: true }),
    mkdir(join(dependencyRootPath, "numpy"), { recursive: true }),
    mkdir(join(dependencyRootPath, "numpy.libs"), { recursive: true }),
    mkdir(join(dependencyRootPath, "pye57"), { recursive: true }),
    mkdir(join(dependencyRootPath, "pye57-0.4.19.dist-info"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(sourcePath, sourceBytes),
    writeFile(interpreterPath, interpreterBytes),
    writeFile(probePath, probeBytes),
    writeFile(join(runtimeBundleRootPath, "runtime", "vcruntime140.dll"), vcruntimeBytes),
    writeFile(join(runtimeBundleRootPath, "runtime", "vcruntime140_1.dll"), vcruntimeOneBytes),
    writeFile(
      join(
        dependencyRootPath,
        "numpy.libs",
        "msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll",
      ),
      renamedNumpyMsvcpBytes,
    ),
    writeFile(join(dependencyRootPath, "numpy", "__init__.py"), numpyBytes),
    writeFile(join(dependencyRootPath, "pye57", "__init__.py"), pye57Bytes),
    writeFile(join(dependencyRootPath, "pye57", "libe57.cp313-win_amd64.pyd"), pye57ExtensionBytes),
    writeFile(join(dependencyRootPath, "pye57-0.4.19.dist-info", "METADATA"), pye57MetadataBytes),
    writeFile(legalNoticePath, pybind11LicenseBytes),
  ]);
  const established = collectEstablishedHeader("capture.e57", sourceBytes);
  const bundleFiles = [
    { path: "legal/pybind11-LICENSE.txt", role: "legal" as const, bytes: pybind11LicenseBytes },
    { path: "probe/foundry_phase1_probe.py", role: "probe" as const, bytes: probeBytes },
    { path: "runtime/python.exe", role: "python_runtime" as const, bytes: interpreterBytes },
    { path: "runtime/vcruntime140.dll", role: "python_runtime" as const, bytes: vcruntimeBytes },
    { path: "runtime/vcruntime140_1.dll", role: "python_runtime" as const, bytes: vcruntimeOneBytes },
    {
      path: "site-packages/numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll",
      role: "site_package" as const,
      bytes: renamedNumpyMsvcpBytes,
    },
    { path: "site-packages/numpy/__init__.py", role: "site_package" as const, bytes: numpyBytes },
    { path: "site-packages/pye57-0.4.19.dist-info/METADATA", role: "site_package" as const, bytes: pye57MetadataBytes },
    { path: "site-packages/pye57/__init__.py", role: "site_package" as const, bytes: pye57Bytes },
    { path: "site-packages/pye57/libe57.cp313-win_amd64.pyd", role: "site_package" as const, bytes: pye57ExtensionBytes },
  ].map(({ bytes, ...file }) => ({
    ...file,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  }));
  const bundleReceipt = issueLocalE57RuntimeBundleReceipt({
    schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0,
    authority: "none",
    bundleId: "synthetic-e57-adapter-test-bundle",
    createdAtUtc: "2026-07-22T00:00:00.000Z",
    execution: "disabled_until_clean_host_qualified_and_adapter_bound",
    files: bundleFiles,
    fileCount: bundleFiles.length,
    layout: {
      dependencyRootPath: "site-packages",
      interpreterPath: "runtime/python.exe",
      legalRootPath: "legal",
      probeScriptPath: "probe/foundry_phase1_probe.py",
    },
    legalPack: {
      microsoftInstallerBundled: false,
      parentEnvironmentLegalReceiptsApplied: true,
      pybind11NoticePath: "legal/pybind11-LICENSE.txt",
      rootPath: "legal",
      state: "assembled",
    },
    limitations: [
      "PYBIND11_EXACT_BUILD_VERSION_IS_INFERRED_NOT_ATTESTED",
      "SELECTED_MICROSOFT_VC_REDIST_INSTALLER_AND_CANONICAL_MSVCP140_DLL_ARE_NOT_BUNDLE_MEMBERS",
      "BUNDLE_BYTE_IDENTITY_DOES_NOT_ESTABLISH_PUBLISHER_BUILD_REPRODUCIBILITY",
    ],
    materialization: {
      completeAllowlist: true,
      directoriesExcludedFromReceipt: true,
      hardLinksEncountered: 0,
      regularFilesOnly: true,
      reparsePointsEncountered: 0,
    },
    microsoftCppRuntime: FOUNDRY_LOCAL_E57_MICROSOFT_CPP_RUNTIME,
    parentEnvironmentSha256: FOUNDRY_LOCAL_E57_INTAKE_ENVIRONMENT_V0_SHA256,
    pybind11: {
      ...FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE,
      binaryFingerprintMarkers: [
        ...FOUNDRY_LOCAL_E57_PYBIND11_PROVENANCE.binaryFingerprintMarkers,
      ],
    },
    target: {
      architecture: "x64",
      lane: "e57_read_only_aggregate_metadata",
      operatingSystem: "windows",
      pythonAbi: "cp313",
      pythonImplementation: "CPython",
      pythonVersion: "3.13.14",
    },
    totalFileBytes: bundleFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
  });
  const qualification = issueLocalE57RuntimeQualificationReceipt({
    schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0,
    authority: "synthetic_qualification_only",
    bundleReceiptSha256: bundleReceipt.bundleReceiptSha256,
    bundleEvidence: {
      canonicalMsvcp140DllPresentInBundle: false,
      completeTreeReceiptVerifiedAfterRun: true,
      completeTreeReceiptVerifiedBeforeRun: true,
      officialCpythonVcruntimeDllsPresent: true,
      receiptListedRenamedMsvcpDllPresent: true,
      sourceBundleMutated: false,
    },
    host: {
      architecture: "x64",
      centralV14RuntimePresentBeforeTest: false,
      disposableCleanHost: true,
      operatingSystem: "windows",
      supportedWindowsRelease: true,
      visualStudioInstalledBeforeTest: false,
    },
    moduleEvidence: {
      completeLoadedModuleInventoryRecorded: true,
      modules: [{
        absolutePath: "C:\\Windows\\System32\\msvcp140.dll",
        filename: "MSVCP140.dll",
        fileVersion: "14.51.36247.0",
        origin: "declared_microsoft_central_runtime",
        sha256: "d".repeat(64),
        sizeBytes: 1,
      }],
      undeclaredThirdPartyModulesObserved: false,
    },
    observedAtUtc: "2026-07-22T00:01:00.000Z",
    prerequisiteEvidence: {
      exactInstallerSha256Verified: true,
      expectedMissingRuntimeFailureObservedBeforeInstall: true,
      installedRuntimeRegistryPath:
        "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64",
      installedRuntimeVersion: "14.51.36247",
      installedVersionCompatibleWithSelectedV14: true,
      microsoftAuthenticodeSignerVerified: true,
      restartRequired: false,
    },
    probeEvidence: {
      fixture: "synthetic_three_cartesian_point_e57",
      fixtureSha256: established.receiptIdentity.sha256,
      fixtureSizeBytes: sourceBytes.byteLength,
      numpyVersion: "2.5.1",
      packageImportsPassed: true,
      productEmbeddedImageBytesRead: false,
      productPointRecordsRead: false,
      productProbeOpenMode: "read-only",
      pye57Version: "0.4.19",
      pyquaternionVersion: "0.9.9",
      pythonVersion: "3.13.14",
      syntheticWriteReadRoundtripPassed: true,
      userOrVenueDataAccessed: false,
    },
    qualificationId: "synthetic-e57-adapter-test-qualification",
  });
  const boundRuntime = issueLocalE57RuntimeAdapterBinding({
    schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0,
    adapterSchemaVersion: "venviewer.local-e57-metadata-probe.v0",
    authority: "runtime_bytes_only_no_source_or_job_authority",
    bundleReceiptSha256: bundleReceipt.bundleReceiptSha256,
    embeddedImageBytesReadAllowed: false,
    pointRecordsReadAllowed: false,
    qualificationSha256: qualification.qualificationSha256,
    scope: "read_only_e57_aggregate_metadata_only",
    writeModeAllowed: false,
  });
  return {
    boundRuntime,
    dependencyRootPath,
    interpreterPath,
    probePath,
    sourceFacts: established.sourceFacts,
    sourcePath,
    input: {
      establishedSourceFacts: established.sourceFacts,
      receiptIdentity: established.receiptIdentity,
      runtimeBundle: {
        qualification,
        receipt: bundleReceipt,
        rootPath: runtimeBundleRootPath,
      },
      sourceRootPath: root,
    },
  };
}

function expectProbeErrorCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(LocalE57MetadataProbeError);
  expect((error as LocalE57MetadataProbeError).code).toBe(code);
  return true;
}

function mutableRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object fixture.");
  }
  return parsed as Record<string, unknown>;
}

function recomputePublicDigest(value: Record<string, unknown>): Record<string, unknown> {
  const { adapterResultSha256: _oldDigest, ...payload } = value;
  return {
    ...payload,
    adapterResultSha256: domainSeparatedSha256(
      LOCAL_E57_METADATA_PROBE_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

function createTestAdapter(
  fixture: ProbeFixture,
  runner: LocalE57MetadataProbeProcessRunner,
  operationTimeoutMs = LOCAL_E57_METADATA_PROBE_OPERATION_TIMEOUT_MS,
): ReturnType<typeof __testOnlyCreateLocalE57MetadataProbeAdapter> {
  return __testOnlyCreateLocalE57MetadataProbeAdapter(
    runner,
    operationTimeoutMs,
    fixture.boundRuntime,
  );
}

describe("local digest-bound E57 metadata probe adapter", () => {
  it("freezes exported policy claims before any adapter result is issued", () => {
    expect(Object.isFrozen(LOCAL_E57_METADATA_PROBE_POLICY)).toBe(true);
    expect(Object.isFrozen(LOCAL_E57_METADATA_PROBE_LIMITATIONS)).toBe(true);
    expect(LOCAL_E57_METADATA_PROBE_LIMITATIONS).toContain(
      "THE_BOUND_RUNTIME_RECEIPT_ESTABLISHES_BYTE_IDENTITY_NOT_PUBLISHER_BUILD_REPRODUCIBILITY",
    );
  });

  it("attaches only schema-valid read-only metadata and is byte-deterministic on unchanged inputs", async () => {
    const fixture = await createProbeFixture();
    const beforeBytes = await readFile(fixture.sourcePath);
    const beforeStat = await stat(fixture.sourcePath);
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(beforeBytes.byteLength)))
    );
    const inspect = createTestAdapter(fixture, runner);

    const first = await inspect(fixture.input);
    const second = await inspect(fixture.input);

    expect(second).toEqual(first);
    expect(verifyLocalE57MetadataProbeResultDigest(first)).toBe(true);
    expect(first.establishedHeader).toEqual({
      code: "E57_PHYSICAL_HEADER_ESTABLISHED",
      coverage: "physical_header",
      state: "established",
    });
    expect(first.deepMetadata.state).toBe("available");
    if (first.deepMetadata.state === "available") {
      expect(first.deepMetadata.execution.runtimeVersions).toEqual({
        numpy: "2.5.1",
        pye57: "0.4.19",
        python: "3.13.14",
      });
      expect(first.deepMetadata.execution.interpreter.sha256).toBe(
        fixture.input.runtimeBundle.receipt.files.find(
          (file) => file.path === "runtime/python.exe",
        )?.sha256,
      );
      expect(first.deepMetadata.execution.probeScript.sha256).toBe(
        fixture.input.runtimeBundle.receipt.files.find(
          (file) => file.path === "probe/foundry_phase1_probe.py",
        )?.sha256,
      );
      expect(first.deepMetadata.execution.runtimeBundle).toMatchObject({
        adapterBindingSha256: fixture.boundRuntime.adapterBindingSha256,
        bundleReceiptSha256: fixture.input.runtimeBundle.receipt.bundleReceiptSha256,
        completeTreePrePostMatch: true,
      });
      expect(first.deepMetadata.aggregate).toMatchObject({
        imageBlobBytesRead: false,
        openMode: "read-only",
        pointRecordsRead: false,
      });
    }
    expect(first.sourceFacts).toMatchObject({
      kind: "asset",
      asset: { facts: { aggregateMetadata: { declaredPointRecordTotal: "42", scanCount: 2 } } },
    });
    expect(await readFile(fixture.sourcePath)).toEqual(beforeBytes);
    expect((await stat(fixture.sourcePath)).mtimeMs).toBe(beforeStat.mtimeMs);

    expect(runner).toHaveBeenCalledTimes(2);
    const invocation = vi.mocked(runner).mock.calls[0]?.[0];
    expect(invocation).toBeDefined();
    expect(invocation?.arguments.slice(0, 4)).toEqual(["-I", "-S", "-B", "-c"]);
    expect(invocation?.arguments).toContain("inspect-e57-aggregate");
    expect(invocation?.arguments).toContain("--e57");
    expect(invocation?.options).toMatchObject({ shell: false, windowsHide: true });
    expect(invocation?.limits).toEqual({
      maximumStderrBytes: LOCAL_E57_METADATA_PROBE_MAX_STDERR_BYTES,
      maximumStdoutBytes: LOCAL_E57_METADATA_PROBE_MAX_STDOUT_BYTES,
      timeoutMs: LOCAL_E57_METADATA_PROBE_TIMEOUT_MS,
    });
    const environmentKeys = Object.keys(invocation?.options.env ?? {}).map((key) => key.toLowerCase());
    expect(environmentKeys).not.toContain("path");
    expect(environmentKeys).not.toContain("appdata");
    expect(environmentKeys).not.toContain("home");
    expect(environmentKeys).not.toContain("http_proxy");
    expect(environmentKeys).not.toContain("https_proxy");
  });

  it("keeps deep metadata unavailable when the production release has no compiled bundle binding", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    const result = await __testOnlyCreateLocalE57MetadataProbeAdapter(runner)(fixture.input);

    expect(result.deepMetadata).toMatchObject({
      state: "unavailable",
      reason: { code: "RUNTIME_BUNDLE_UNBOUND" },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects an extra runtime-tree file before spawning", async () => {
    const fixture = await createProbeFixture();
    await writeFile(
      join(fixture.input.runtimeBundle.rootPath, "site-packages", "undeclared.py"),
      "# not in the immutable receipt\n",
      "utf8",
    );
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    await expect(createTestAdapter(fixture, runner)(fixture.input)).rejects.toSatisfy(
      (error: unknown) =>
        expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID"),
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects a non-entrypoint bundle mutation during the child process", async () => {
    const fixture = await createProbeFixture();
    const dependencyPath = join(fixture.dependencyRootPath, "pye57", "__init__.py");
    const original = await readFile(dependencyPath);
    const runner: LocalE57MetadataProbeProcessRunner = async () => {
      await writeFile(dependencyPath, Buffer.alloc(original.byteLength, 0x78));
      return completed(aggregateFixture(64));
    };

    await expect(createTestAdapter(fixture, runner)(fixture.input)).rejects.toSatisfy(
      (error: unknown) =>
        expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_MUTATED"),
    );
  });

  it("rejects a qualification that no longer cross-binds the exact bundle", async () => {
    const fixture = await createProbeFixture();
    const input: LocalE57MetadataProbeInput = {
      ...fixture.input,
      runtimeBundle: {
        ...fixture.input.runtimeBundle,
        qualification: {
          ...fixture.input.runtimeBundle.qualification,
          bundleReceiptSha256: "0".repeat(64),
        },
      },
    };
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    await expect(createTestAdapter(fixture, runner)(input)).rejects.toSatisfy(
      (error: unknown) =>
        expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID"),
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects recomputed digests over schema-invalid or cross-unbound result bodies", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = () =>
      Promise.resolve(completed(aggregateFixture(64)));
    const valid = await createTestAdapter(fixture, runner)(fixture.input);
    expect(verifyLocalE57MetadataProbeResultDigest(valid)).toBe(true);

    const extraField = mutableRecord(valid);
    extraField.unexpected = "accepted only by a digest-only verifier";

    const changedPolicy = mutableRecord(valid);
    (changedPolicy.policy as Record<string, unknown>).sourceAccess = "read-write";

    const aggregateMismatch = mutableRecord(valid);
    const deepMetadata = aggregateMismatch.deepMetadata as Record<string, unknown>;
    (deepMetadata.aggregate as Record<string, unknown>).declaredPointRecordTotal = "43";

    const runtimeMismatch = mutableRecord(valid);
    const execution = (runtimeMismatch.deepMetadata as Record<string, unknown>).execution as Record<string, unknown>;
    (execution.runtimeVersions as Record<string, unknown>).python = "different-runtime";

    for (const invalid of [extraField, changedPolicy, aggregateMismatch, runtimeMismatch]) {
      expect(verifyLocalE57MetadataProbeResultDigest(recomputePublicDigest(invalid))).toBe(false);
    }

    await rename(fixture.interpreterPath, `${fixture.interpreterPath}.missing`);
    const unavailable = await createTestAdapter(fixture, runner)(fixture.input);
    expect(verifyLocalE57MetadataProbeResultDigest(unavailable)).toBe(true);
    const changedReason = mutableRecord(unavailable);
    const reason = (changedReason.deepMetadata as Record<string, unknown>).reason as Record<string, unknown>;
    reason.message = "A recomputed digest must not make altered failure semantics valid.";
    expect(verifyLocalE57MetadataProbeResultDigest(recomputePublicDigest(changedReason))).toBe(false);

    const changedReceipt = mutableRecord(unavailable);
    (changedReceipt.receiptIdentity as Record<string, unknown>).path = "other.e57";
    expect(verifyLocalE57MetadataProbeResultDigest(recomputePublicDigest(changedReceipt))).toBe(false);
  });

  it("keeps the established physical header when Python is missing", async () => {
    const fixture = await createProbeFixture();
    await rename(fixture.interpreterPath, `${fixture.interpreterPath}.missing`);
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );
    const inspect = createTestAdapter(fixture, runner);

    const result = await inspect(fixture.input);

    expect(result.deepMetadata).toMatchObject({
      state: "unavailable",
      reason: { code: "PYTHON_EXECUTABLE_MISSING" },
    });
    expect(result.sourceFacts).toEqual(fixture.sourceFacts);
    expect(result.establishedHeader.state).toBe("established");
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not let a missing prerequisite hide a source/receipt mismatch", async () => {
    const fixture = await createProbeFixture();
    await rename(fixture.interpreterPath, `${fixture.interpreterPath}.missing`);
    await writeFile(fixture.sourcePath, Buffer.alloc(64, 0x61));
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    await expect(
      createTestAdapter(fixture, runner)(fixture.input),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RECEIPT_DIGEST_MISMATCH")
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("requires the exact pye57 0.4.19 dependency metadata before spawning", async () => {
    const fixture = await createProbeFixture();
    await rename(
      join(fixture.dependencyRootPath, "pye57-0.4.19.dist-info"),
      join(fixture.dependencyRootPath, "pye57-0.4.18.dist-info"),
    );
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    const result = await createTestAdapter(fixture, runner)(fixture.input);

    expect(result.deepMetadata).toMatchObject({
      state: "unavailable",
      reason: { code: "PYE57_0_4_19_UNAVAILABLE" },
    });
    expect(result.sourceFacts).toEqual(fixture.sourceFacts);
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wrong pye57 version",
      { adapter: { name: "pye57", version: "0.4.18" } },
      "PYE57_VERSION_MISMATCH",
    ],
    [
      "wrong qualified runtime versions",
      { runtimeVersions: { numpy: "2.4.2", python: "3.13.6" } },
      "RUNTIME_VERSION_MISMATCH",
    ],
    ["point payload read", { pointRecordsRead: true }, "PROBE_OUTPUT_INVALID"],
    ["image payload read", { imageBlobBytesRead: true }, "PROBE_OUTPUT_INVALID"],
    ["write-capable open mode", { openMode: "read-write" }, "PROBE_OUTPUT_INVALID"],
  ])("refuses metadata that claims %s", async (_label, override, expectedCode) => {
    const fixture = await createProbeFixture();
    const invalid = { ...aggregateFixture(64), ...override };
    const runner: LocalE57MetadataProbeProcessRunner = () => Promise.resolve(completed(invalid));

    const result = await createTestAdapter(fixture, runner)(fixture.input);

    expect(result.deepMetadata).toMatchObject({
      state: "unavailable",
      reason: { code: expectedCode },
    });
    expect(result.sourceFacts).toEqual(fixture.sourceFacts);
  });

  it("fails closed before spawning when current source bytes do not match the receipt", async () => {
    const fixture = await createProbeFixture();
    await writeFile(fixture.sourcePath, Buffer.alloc(64, 0x61));
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    await expect(
      createTestAdapter(fixture, runner)(fixture.input),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RECEIPT_DIGEST_MISMATCH")
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it.each(["source", "interpreter", "probe"] as const)(
    "fails closed when the %s changes while the child process is running",
    async (target) => {
      const fixture = await createProbeFixture();
      const selectedPath = target === "source"
        ? fixture.sourcePath
        : target === "interpreter"
          ? fixture.interpreterPath
          : fixture.probePath;
      const original = await readFile(selectedPath);
      const runner: LocalE57MetadataProbeProcessRunner = async () => {
        await writeFile(selectedPath, Buffer.alloc(original.byteLength, 0x7a));
        return completed(aggregateFixture(64));
      };
      const expectedCode = target === "source"
        ? "LOCAL_E57_METADATA_PROBE_SOURCE_MUTATED"
        : "LOCAL_E57_METADATA_PROBE_PINNED_FILE_MUTATED";

      await expect(
        createTestAdapter(fixture, runner)(fixture.input),
      ).rejects.toSatisfy((error: unknown) => expectProbeErrorCode(error, expectedCode));
    },
  );

  it("fails closed when the bound bundle receipt digest does not match before execution", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );
    const input: LocalE57MetadataProbeInput = {
      ...fixture.input,
      runtimeBundle: {
        ...fixture.input.runtimeBundle,
        receipt: {
          ...fixture.input.runtimeBundle.receipt,
          bundleReceiptSha256: "f".repeat(64),
        },
      },
    };

    await expect(
      createTestAdapter(fixture, runner)(input),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_RUNTIME_BUNDLE_INVALID")
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails closed when aggregate byte size contradicts the receipt", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = () =>
      Promise.resolve(completed(aggregateFixture(63)));

    await expect(
      createTestAdapter(fixture, runner)(fixture.input),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_AGGREGATE_SIZE_MISMATCH")
    );
  });

  it.each([
    ["timeout", { kind: "timed_out" } as const, "PROBE_TIMED_OUT"],
    ["stdout limit", { kind: "stdout_limit_exceeded" } as const, "PROBE_OUTPUT_LIMIT_EXCEEDED"],
    ["stderr limit", { kind: "stderr_limit_exceeded" } as const, "PROBE_OUTPUT_LIMIT_EXCEEDED"],
    ["spawn failure", { kind: "spawn_failed" } as const, "PROBE_PROCESS_FAILED"],
  ])("preserves the header after a bounded %s outcome", async (_label, outcome, expectedCode) => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = () => Promise.resolve(outcome);

    const result = await createTestAdapter(fixture, runner)(fixture.input);

    expect(result.deepMetadata).toMatchObject({ state: "unavailable", reason: { code: expectedCode } });
    expect(result.sourceFacts).toEqual(fixture.sourceFacts);
  });

  it("rejects unexpected stderr without retaining its content", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = () => Promise.resolve(
      completed(aggregateFixture(64), Buffer.from("sensitive diagnostic", "utf8")),
    );

    const result = await createTestAdapter(fixture, runner)(fixture.input);

    expect(result.deepMetadata).toMatchObject({
      state: "unavailable",
      reason: { code: "PROBE_STDERR_NOT_EMPTY" },
    });
    expect(JSON.stringify(result)).not.toContain("sensitive diagnostic");
  });

  it("issues no result when cancellation is already requested", async () => {
    const fixture = await createProbeFixture();
    const controller = new AbortController();
    controller.abort();
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );

    await expect(
      createTestAdapter(fixture, runner)({ ...fixture.input, signal: controller.signal }),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_CANCELLED")
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("issues no result when cancellation arrives during a runner that ignores the signal", async () => {
    const fixture = await createProbeFixture();
    const controller = new AbortController();
    const runner: LocalE57MetadataProbeProcessRunner = () => {
      controller.abort();
      return Promise.resolve(completed(aggregateFixture(64)));
    };

    await expect(
      createTestAdapter(fixture, runner)({ ...fixture.input, signal: controller.signal }),
    ).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_CANCELLED")
    );
  });

  it("applies one internal deadline across prerequisite resolution and hashing", async () => {
    const fixture = await createProbeFixture();
    const runner: LocalE57MetadataProbeProcessRunner = vi.fn(() =>
      Promise.resolve(completed(aggregateFixture(64)))
    );
    const inspect = createTestAdapter(fixture, runner, 0);

    await expect(inspect(fixture.input)).rejects.toSatisfy((error: unknown) =>
      expectProbeErrorCode(error, "LOCAL_E57_METADATA_PROBE_DEADLINE_EXCEEDED")
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
