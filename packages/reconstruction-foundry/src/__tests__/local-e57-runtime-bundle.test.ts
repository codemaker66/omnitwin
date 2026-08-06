import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0,
  FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0_DIGEST_DOMAIN,
  FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0,
  domainSeparatedSha256,
  issueLocalE57RuntimeAdapterBinding,
  issueLocalE57RuntimeQualificationReceipt,
  isCanonicalLocalE57BundlePath,
  toCanonicalJson,
  verifyLocalE57RuntimeAdapterBinding,
  verifyLocalE57RuntimeBundleReceipt,
  verifyLocalE57RuntimeQualificationReceipt,
  type LocalE57RuntimeBundleReceipt,
} from "../index.js";

const RECEIPT_PATH = fileURLToPath(new URL(
  "../../../../configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json",
  import.meta.url,
));

async function productionReceipt(): Promise<LocalE57RuntimeBundleReceipt> {
  return verifyLocalE57RuntimeBundleReceipt(
    JSON.parse(await readFile(RECEIPT_PATH, "utf8")) as unknown,
  );
}

function recomputeReceiptDigest(
  receipt: LocalE57RuntimeBundleReceipt,
): LocalE57RuntimeBundleReceipt {
  const { bundleReceiptSha256: _oldDigest, ...payload } = receipt;
  return {
    ...payload,
    bundleReceiptSha256: domainSeparatedSha256(
      FOUNDRY_LOCAL_E57_RUNTIME_BUNDLE_V0_DIGEST_DOMAIN,
      toCanonicalJson(payload),
    ),
  };
}

describe("local E57 runtime bundle contracts", () => {
  it("verifies the complete deterministic production candidate receipt", async () => {
    const receipt = await productionReceipt();

    expect(receipt).toMatchObject({
      bundleReceiptSha256:
        "9d93928658fb650a319edf1b65bad250b8fa213d810e3554d5e345b42a974696",
      fileCount: 1032,
      totalFileBytes: 66757784,
      microsoftCppRuntime: {
        canonicalMsvcp140DllBundled: false,
        disposition: "central_prerequisite_direct_from_microsoft",
        officialCpythonVcruntimeDllsPreserved: true,
        receiptListedRenamedMsvcpDllPresent: true,
        selectedInstallerBundled: false,
      },
      pybind11: {
        versionClaim: "inferred_3.0.1_not_attested",
        exactPatchClaimAllowed: false,
      },
    });
    expect(receipt.files.filter((file) => file.role === "legal")).toHaveLength(30);
    expect(receipt.files.map((file) => file.path)).toEqual(
      [...receipt.files.map((file) => file.path)].sort(),
    );
    expect(receipt.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "runtime/vcruntime140.dll" }),
      expect.objectContaining({ path: "runtime/vcruntime140_1.dll" }),
      expect.objectContaining({
        path: "site-packages/numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll",
      }),
    ]));
  });

  it("rejects digest tampering, path traversal, and a substituted pybind11 notice", async () => {
    const receipt = await productionReceipt();
    expect(() => verifyLocalE57RuntimeBundleReceipt({
      ...receipt,
      bundleReceiptSha256: "0".repeat(64),
    })).toThrow("digest does not match");

    const traversing = recomputeReceiptDigest({
      ...receipt,
      files: receipt.files.map((file, index) =>
        index === 0 ? { ...file, path: "../outside" } : file
      ),
    });
    expect(() => verifyLocalE57RuntimeBundleReceipt(traversing)).toThrow();

    const wrongNotice = recomputeReceiptDigest({
      ...receipt,
      files: receipt.files.map((file) =>
        file.path === receipt.legalPack.pybind11NoticePath
          ? { ...file, sha256: "0".repeat(64) }
          : file
      ),
    });
    expect(() => verifyLocalE57RuntimeBundleReceipt(wrongNotice)).toThrow(
      "version-invariant pybind11 notice",
    );

    const wrongProbe = recomputeReceiptDigest({
      ...receipt,
      files: receipt.files.map((file) =>
        file.path === receipt.layout.probeScriptPath
          ? { ...file, sha256: "1".repeat(64) }
          : file
      ),
    });
    expect(() => verifyLocalE57RuntimeBundleReceipt(wrongProbe)).toThrow(
      "exact reviewed aggregate-E57 probe bytes",
    );

    for (const invalidPath of [
      "runtime/bad?.dll",
      "runtime/bad*.dll",
      "runtime/bad\".dll",
      "runtime/bad<.dll",
      "runtime/bad>.dll",
      "runtime/bad|.dll",
      "runtime/bad\u0001.dll",
    ]) {
      expect(isCanonicalLocalE57BundlePath(invalidPath)).toBe(false);
    }
  });

  it("cross-binds a clean-host qualification and adapter binding without source authority", async () => {
    const receipt = await productionReceipt();
    const qualification = issueLocalE57RuntimeQualificationReceipt({
      schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_QUALIFICATION_V0,
      authority: "synthetic_qualification_only",
      bundleReceiptSha256: receipt.bundleReceiptSha256,
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
          absolutePath: "C:\\Windows\\System32\\MSVCP140.dll",
          filename: "MSVCP140.dll",
          fileVersion: "14.51.36247.0",
          origin: "declared_microsoft_central_runtime",
          sha256: "a".repeat(64),
          sizeBytes: 1,
        }],
        undeclaredThirdPartyModulesObserved: false,
      },
      observedAtUtc: "2026-07-22T02:00:00.000Z",
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
        fixtureSha256: "b".repeat(64),
        fixtureSizeBytes: 4096,
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
      qualificationId: "contract-test-not-production-evidence",
    });
    const binding = issueLocalE57RuntimeAdapterBinding({
      schemaVersion: FOUNDRY_LOCAL_E57_RUNTIME_ADAPTER_BINDING_V0,
      adapterSchemaVersion: "venviewer.local-e57-metadata-probe.v0",
      authority: "runtime_bytes_only_no_source_or_job_authority",
      bundleReceiptSha256: receipt.bundleReceiptSha256,
      embeddedImageBytesReadAllowed: false,
      pointRecordsReadAllowed: false,
      qualificationSha256: qualification.qualificationSha256,
      scope: "read_only_e57_aggregate_metadata_only",
      writeModeAllowed: false,
    });

    expect(verifyLocalE57RuntimeQualificationReceipt(
      qualification,
      receipt.bundleReceiptSha256,
    )).toEqual(qualification);
    expect(verifyLocalE57RuntimeAdapterBinding(
      binding,
      receipt,
      qualification,
    )).toEqual(binding);
    expect(() => verifyLocalE57RuntimeAdapterBinding(
      { ...binding, bundleReceiptSha256: "0".repeat(64) },
      receipt,
      qualification,
    )).toThrow();
  });
});
