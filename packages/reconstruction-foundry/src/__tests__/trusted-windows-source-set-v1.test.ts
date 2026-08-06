import { describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import {
  TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1,
  TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1,
  TrustedWindowsSourceSetV1ValidationError,
  buildTrustedWindowsSourceSetManifestV1,
  doesWindowsSourceSetManifestMatchExpectedDigestV1,
  deriveTrustedWindowsCrossSelectionIdentityEvidenceV1,
  deriveTrustedWindowsPathComparisonTranscriptSha256V1,
  deriveTrustedWindowsSelectionIdentityEvidenceV1,
  isStructurallyValidWindowsSourceSetManifestV1,
  type TrustedWindowsNativeSourceSetInputV1,
  type TrustedWindowsNativeSourceSetManifestV1,
  type TrustedWindowsNativePathComparisonsV1,
  type TrustedWindowsPathComparisonTranscriptInputV1,
  type TrustedWindowsSourceIdentityV1,
  type TrustedWindowsLocalVolumeEvidenceV1,
  type TrustedWindowsSourceSelectionV1,
} from "../trusted-windows-source-set-v1.js";

const SOURCE_PATH_EVIDENCE = Object.freeze({
  acquisition: "windows_native_picker_handle" as const,
  canonicalization: "final_path_by_handle" as const,
  inspectionMode: "read_only" as const,
  pathIdentityCheckedByHandle: true as const,
  reparseInspectionScope: "volume_root_through_complete_selection" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
  inventoryComplete: true as const,
  regularFilesOnly: true as const,
});

const DROP_SOURCE_PATH_EVIDENCE = Object.freeze({
  ...SOURCE_PATH_EVIDENCE,
  acquisition: "windows_native_drop_cfhdrop_then_handle_open" as const,
});

const OUTPUT_PATH_EVIDENCE = Object.freeze({
  acquisition: "windows_native_output_directory_handle" as const,
  canonicalization: "final_path_by_handle" as const,
  inspectionMode: "read_only" as const,
  pathIdentityCheckedByHandle: true as const,
  directoryTypeCheckedByHandle: true as const,
  reparseInspectionScope: "volume_root_through_output_directory" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

const ADAPTER_BUILD_SHA256 = `sha256:${"a1".repeat(32)}`;

function identity(seed: number): TrustedWindowsSourceIdentityV1 {
  return {
    volumeSerialNumberHex: "00000000A1B2C3D4",
    fileIdHex: seed.toString(16).toUpperCase().padStart(32, "0"),
  };
}

function localVolumeEvidence(
  sourceIdentity: TrustedWindowsSourceIdentityV1,
  driveType: "DRIVE_FIXED" | "DRIVE_REMOVABLE" = "DRIVE_FIXED",
): TrustedWindowsLocalVolumeEvidenceV1 {
  return {
    openedHandleFileType: "FILE_TYPE_DISK",
    volumePathResolution: "get_volume_path_name_w",
    driveTypeQuery: "get_drive_type_w",
    driveType,
    dosDeviceQuery: "query_dos_device_w",
    dosDeviceMapping: "direct_local_volume",
    dosDeviceAliasChainDetected: false,
    substTargetDetected: false,
    uncRedirectorDetected: false,
    networkDeviceTargetDetected: false,
    openedHandleVolumeCorroboration:
      "file_id_info_volume_serial_matches_opened_volume_root_handle",
    openedHandleVolumeSerialNumberHex: sourceIdentity.volumeSerialNumberHex,
    volumeRootHandleSerialNumberHex: sourceIdentity.volumeSerialNumberHex,
  };
}

function selection(
  canonicalAbsolutePath: string,
  kind: "file" | "directory",
  rootSeed: number,
  inventorySeeds: readonly number[],
  byteCountDecimal = "1024",
): TrustedWindowsSourceSelectionV1 {
  const identities = kind === "file" ? [identity(rootSeed)] : inventorySeeds.map(identity);
  const rootIdentity = identity(rootSeed);
  return {
    kind,
    canonicalAbsolutePath,
    resolvedAbsolutePath: canonicalAbsolutePath,
    byteCountDecimal,
    fileCount: identities.length,
    identity: rootIdentity,
    pathEvidence: SOURCE_PATH_EVIDENCE,
    localVolumeEvidence: localVolumeEvidence(rootIdentity),
    inventoryFileIdentities: identities,
    inventoryIdentityEvidence: deriveTrustedWindowsSelectionIdentityEvidenceV1(identities),
  };
}

function comparisons(selectionCount: number): TrustedWindowsNativePathComparisonsV1 {
  const sourcePairs: Array<{
    readonly leftSelectionIndex: number;
    readonly rightSelectionIndex: number;
    readonly relation: "disjoint";
  }> = [];
  for (let left = 1; left <= selectionCount; left += 1) {
    for (let right = left + 1; right <= selectionCount; right += 1) {
      sourcePairs.push({ leftSelectionIndex: left, rightSelectionIndex: right, relation: "disjoint" });
    }
  }
  return {
    sourcePairs,
    outputPairs: Array.from({ length: selectionCount }, (_, index) => ({
      selectionIndex: index + 1,
      relation: "disjoint" as const,
    })),
  };
}

function input(
  selections: readonly TrustedWindowsSourceSelectionV1[] = [
    selection("C:\\Users\\Blake\\Private Client\\Reception.e57", "file", 1, [1], "8000000000"),
    selection("C:\\Users\\Blake\\Private Client\\Photos", "directory", 2, [101, 102], "4500000000"),
    selection("C:\\Users\\Blake\\Private Client\\Empty", "directory", 3, [], "0"),
  ],
): TrustedWindowsNativeSourceSetInputV1 {
  const outputBoundary = {
    kind: "directory" as const,
    canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
    resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
    identity: identity(900_001),
    pathEvidence: OUTPUT_PATH_EVIDENCE,
    localVolumeEvidence: localVolumeEvidence(identity(900_001), "DRIVE_REMOVABLE"),
  } as const;
  const nativePathComparisons = comparisons(selections.length);
  const adapter = {
    adapterId: "venviewer.windows-native-picker.v1",
    adapterBuildSha256: ADAPTER_BUILD_SHA256,
    identityComparisonMechanism: "windows_volume_serial_plus_file_id_128" as const,
    pathComparisonMechanism: "windows_compare_string_ordinal_ignore_case" as const,
  };
  return {
    schemaVersion: "trusted-windows-native-source-set-input.v1",
    origin: "trusted_windows_native_launcher",
    browserPathInputAccepted: false,
    sessionNonceHex: "ab".repeat(32),
    outputBoundary,
    selections,
    adapterEvidence: {
      ...adapter,
      comparisonTranscriptSha256: deriveTrustedWindowsPathComparisonTranscriptSha256V1({
        ...adapter,
        sourceCanonicalAbsolutePaths: selections.map((source) => source.canonicalAbsolutePath),
        outputCanonicalAbsolutePath: outputBoundary.canonicalAbsolutePath,
        nativePathComparisons,
      }),
    },
    crossSelectionIdentityEvidence: deriveTrustedWindowsCrossSelectionIdentityEvidenceV1(selections),
    nativePathComparisons,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TrustedWindowsSourceSetV1ValidationError);
    if (!(error instanceof TrustedWindowsSourceSetV1ValidationError)) return;
    expect(error.code).toBe(code);
    expect(error.message).not.toMatch(/[A-Z]:\\/u);
    expect(error.message).not.toContain("\\");
    return;
  }
  throw new Error(`Expected V1 validation error ${code}.`);
}

function recomputeManifestDigest(
  manifest: TrustedWindowsNativeSourceSetManifestV1,
): TrustedWindowsNativeSourceSetManifestV1 {
  const { manifestDigestSha256: _digest, ...body } = manifest;
  const digest = domainSeparatedSha256(
    TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1,
    toCanonicalJson(body),
  );
  return { ...body, manifestDigestSha256: `sha256:${digest}` };
}

describe("trusted Windows source-set V1", () => {
  it("accepts only picker and CF_HDROP-then-handle-open acquisition and digest-binds the distinction", () => {
    const picked = selection("C:\\Capture\\Reception.e57", "file", 1, [1]);
    const dropped: TrustedWindowsSourceSelectionV1 = {
      ...picked,
      pathEvidence: DROP_SOURCE_PATH_EVIDENCE,
    };
    const legacyManifest = buildTrustedWindowsSourceSetManifestV1(input([picked]));
    const repeatedLegacyManifest = buildTrustedWindowsSourceSetManifestV1(input([picked]));
    const droppedManifest = buildTrustedWindowsSourceSetManifestV1(input([dropped]));

    expect(repeatedLegacyManifest).toEqual(legacyManifest);
    expect(droppedManifest.sources[0]?.sourceDigestSha256)
      .not.toBe(legacyManifest.sources[0]?.sourceDigestSha256);
    expect(droppedManifest.sourceSetDigestSha256).not.toBe(legacyManifest.sourceSetDigestSha256);
    expect(droppedManifest.manifestDigestSha256).not.toBe(legacyManifest.manifestDigestSha256);
    expect(isStructurallyValidWindowsSourceSetManifestV1(droppedManifest)).toBe(true);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...input([picked]),
      selections: [{
        ...picked,
        pathEvidence: {
          ...picked.pathEvidence,
          acquisition: "windows_native_drop_path",
        },
      }],
    }), "BASE_CONTRACT_REJECTED");
  });

  it("builds a deterministic inspection-only manifest containing counts and digests only", () => {
    const trustedInput = input();
    const first = buildTrustedWindowsSourceSetManifestV1(trustedInput);
    const repeated = buildTrustedWindowsSourceSetManifestV1(trustedInput);
    const serialized = JSON.stringify(first);

    expect(repeated).toEqual(first);
    expect(first.schemaVersion).toBe("trusted-windows-source-set-manifest.v1");
    expect(first.authority).toBe("none");
    expect(first.use).toBe("inspection_only");
    expect(first.totals).toEqual({
      selectedRoots: 3,
      discoveredFiles: 3,
      totalBytesDecimal: "12500000000",
      inventoryIdentityCount: 3,
    });
    expect(first.nativeEvidence).toMatchObject({
      adapterBuildSha256: ADAPTER_BUILD_SHA256,
      checkedIdentityCount: 3,
      sourcePairCount: 3,
      outputPairCount: 3,
      localVolumeProof: {
        checkedBoundaryCount: 4,
        openedHandleFileType: "FILE_TYPE_DISK",
        acceptedDriveTypes: "DRIVE_FIXED_OR_REMOVABLE",
        dosDeviceMapping: "QUERY_DOS_DEVICE_DIRECT_LOCAL_VOLUME",
        openedHandleVolumeCorroboration:
          "FILE_ID_INFO_VOLUME_SERIAL_MATCHES_OPENED_VOLUME_ROOT_HANDLE",
      },
    });
    expect(first.sources.map((source) => source.inventoryIdentityCount)).toEqual([1, 2, 0]);
    expect(first.sources.every((source) => source.inventoryIdentityCount === source.fileCount)).toBe(true);
    expect(isStructurallyValidWindowsSourceSetManifestV1(first)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sources)).toBe(true);

    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("D:\\");
    expect(serialized).not.toContain("Users");
    expect(serialized).not.toContain("Private Client");
    expect(serialized).not.toContain("Reception.e57");
    expect(serialized).not.toContain(identity(1).fileIdHex);
    expect(serialized).not.toContain(trustedInput.sessionNonceHex);
    expect(serialized).not.toContain(trustedInput.adapterEvidence.adapterId);
    expect(serialized).not.toContain(trustedInput.adapterEvidence.comparisonTranscriptSha256);
    expect(serialized).not.toContain(
      trustedInput.crossSelectionIdentityEvidence.globalIdentitySetSha256,
    );
    for (const source of trustedInput.selections) {
      expect(serialized).not.toContain(source.inventoryIdentityEvidence.identitySetSha256);
    }
    expect(Object.keys(first.sources[0] ?? {})).toEqual([
      "basketPosition",
      "sourceDigestSha256",
      "fileCount",
      "byteCountDecimal",
      "inventoryIdentityCount",
      "inventoryIdentitySetSha256",
    ]);
  });

  it("uses the private nonce to make every source-sensitive public digest unlinkable", () => {
    const firstInput = input();
    const nextInput = { ...firstInput, sessionNonceHex: "cd".repeat(32) };
    const first = buildTrustedWindowsSourceSetManifestV1(firstInput);
    const next = buildTrustedWindowsSourceSetManifestV1(nextInput);

    expect(next.sources[0]?.sourceDigestSha256).not.toBe(first.sources[0]?.sourceDigestSha256);
    expect(next.sources[0]?.inventoryIdentitySetSha256)
      .not.toBe(first.sources[0]?.inventoryIdentitySetSha256);
    expect(next.sourceSetDigestSha256).not.toBe(first.sourceSetDigestSha256);
    expect(next.nativeEvidence.comparisonTranscriptSha256)
      .not.toBe(first.nativeEvidence.comparisonTranscriptSha256);
    expect(next.nativeEvidence.globalIdentitySetSha256)
      .not.toBe(first.nativeEvidence.globalIdentitySetSha256);
    expect({
      ...next.nativeEvidence,
      comparisonTranscriptSha256: first.nativeEvidence.comparisonTranscriptSha256,
      globalIdentitySetSha256: first.nativeEvidence.globalIdentitySetSha256,
    }).toEqual(first.nativeEvidence);
    expect(next.manifestDigestSha256).not.toBe(first.manifestDigestSha256);
  });

  it("binds byte counts and the complete private evidence into the opaque source digests", () => {
    const originalInput = input([
      selection("C:\\Capture\\Reception.e57", "file", 1, [1], "1024"),
    ]);
    const changedInput = {
      ...originalInput,
      selections: [{ ...originalInput.selections[0]!, byteCountDecimal: "1025" }],
    };
    const original = buildTrustedWindowsSourceSetManifestV1(originalInput);
    const changed = buildTrustedWindowsSourceSetManifestV1(changedInput);

    expect(changed.sources[0]?.sourceDigestSha256)
      .not.toBe(original.sources[0]?.sourceDigestSha256);
    expect(changed.sourceSetDigestSha256).not.toBe(original.sourceSetDigestSha256);
  });

  it("requires an existing handle-opened output directory and binds its identity", () => {
    const valid = input([selection("C:\\Capture\\Reception.e57", "file", 1, [1])]);
    const original = buildTrustedWindowsSourceSetManifestV1(valid);
    const changedIdentityInput = {
      ...valid,
      outputBoundary: {
        ...valid.outputBoundary,
        identity: identity(900_002),
        localVolumeEvidence: localVolumeEvidence(identity(900_002)),
      },
    };
    const changedIdentity = buildTrustedWindowsSourceSetManifestV1(changedIdentityInput);
    expect(changedIdentity.sourceSetDigestSha256).not.toBe(original.sourceSetDigestSha256);
    expect(changedIdentity.manifestDigestSha256).not.toBe(original.manifestDigestSha256);

    const legacyConfiguredOutput = {
      canonicalAbsolutePath: valid.outputBoundary.canonicalAbsolutePath,
      resolvedAbsolutePath: valid.outputBoundary.resolvedAbsolutePath,
      pathEvidence: {
        acquisition: "trusted_launcher_output_configuration",
        canonicalization: "resolved_existing_ancestor_and_validated_suffix",
        inspectionMode: "read_only",
        reparseInspectionScope: "volume_root_through_output_parent",
        reparseInspectionComplete: true,
        reparsePointsEncountered: 0,
      },
    };
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      outputBoundary: legacyConfiguredOutput,
    }), "MISSING_REQUIRED_FIELD");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      outputBoundary: {
        ...valid.outputBoundary,
        pathEvidence: {
          ...valid.outputBoundary.pathEvidence,
          reparseInspectionScope: "volume_root_through_output_parent",
        },
      },
    }), "BASE_CONTRACT_REJECTED");
  });

  it("rejects the output root when a different path has the same Windows identity", () => {
    const source = selection("C:\\Capture\\Reception", "directory", 41, [4101]);
    const valid = input([source]);
    const outputIdentity = source.identity;
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      outputBoundary: {
        ...valid.outputBoundary,
        canonicalAbsolutePath: "E:\\Alias\\Different Name",
        resolvedAbsolutePath: "E:\\Alias\\Different Name",
        identity: outputIdentity,
        localVolumeEvidence: localVolumeEvidence(outputIdentity),
      },
    }), "OUTPUT_SOURCE_IDENTITY_DUPLICATE");
  });

  it("requires exact direct-local-volume evidence for every source and the output", () => {
    const valid = input([selection("C:\\Capture\\Reception.e57", "file", 1, [1])]);
    const source = valid.selections[0]!;
    const attacks: readonly Partial<TrustedWindowsLocalVolumeEvidenceV1>[] = [
      { openedHandleFileType: "FILE_TYPE_PIPE" as "FILE_TYPE_DISK" },
      { driveType: "DRIVE_REMOTE" as "DRIVE_FIXED" },
      { dosDeviceMapping: "subst_alias" as "direct_local_volume" },
      { dosDeviceAliasChainDetected: true as false },
      { substTargetDetected: true as false },
      { uncRedirectorDetected: true as false },
      { networkDeviceTargetDetected: true as false },
      { volumeRootHandleSerialNumberHex: "00000000DEADBEEF" },
    ];
    for (const attack of attacks) {
      expectCode(() => buildTrustedWindowsSourceSetManifestV1({
        ...valid,
        selections: [{
          ...source,
          localVolumeEvidence: { ...source.localVolumeEvidence, ...attack },
        }],
      }), "INVALID_LOCAL_VOLUME_EVIDENCE");
    }
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      outputBoundary: {
        ...valid.outputBoundary,
        localVolumeEvidence: {
          ...valid.outputBoundary.localVolumeEvidence,
          dosDeviceQuery: "drive_letter_only" as "query_dos_device_w",
        },
      },
    }), "INVALID_LOCAL_VOLUME_EVIDENCE");
    const { localVolumeEvidence: _missing, ...withoutVolume } = source;
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [withoutVolume],
    }), "MISSING_REQUIRED_FIELD");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...source,
        localVolumeEvidence: { ...source.localVolumeEvidence, rawDosDeviceTarget: "private" },
      }],
    }), "UNEXPECTED_FIELD");
  });

  it("requires one fixed 16-hex volume serial and rejects zero-extension aliases", () => {
    const valid = input([selection("C:\\Capture\\Reception.e57", "file", 1, [1])]);
    const source = valid.selections[0]!;
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...source,
        identity: { ...source.identity, volumeSerialNumberHex: "A1B2C3D4" },
        inventoryFileIdentities: [{
          ...source.inventoryFileIdentities[0]!,
          volumeSerialNumberHex: "A1B2C3D4",
        }],
        localVolumeEvidence: {
          ...source.localVolumeEvidence,
          openedHandleVolumeSerialNumberHex: "A1B2C3D4",
          volumeRootHandleSerialNumberHex: "A1B2C3D4",
        },
      }],
    }), "INVALID_IDENTITY_EVIDENCE");
  });

  it("uses only the native transcript for V1 path relations, including Unicode divergence", () => {
    expect("K".toLocaleLowerCase("en-US")).toBe("k");
    const trustedInput = input([
      selection("C:\\Capture\\K.e57", "file", 71, [71]),
      selection("C:\\Capture\\K.e57", "file", 72, [72]),
    ]);
    expect(buildTrustedWindowsSourceSetManifestV1(trustedInput).nativeEvidence.sourcePairCount).toBe(1);
  });

  it("rejects negative-zero file counts before canonical digesting", () => {
    const empty = selection("C:\\Capture\\Empty", "directory", 81, [], "0");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1(input([{
      ...empty,
      fileCount: -0,
    }])), "BASE_CONTRACT_REJECTED");
  });

  it("rejects negative zero in identity, reparse, and comparison evidence", () => {
    const empty = selection("C:\\Capture\\Empty", "directory", 82, [], "0");
    const validEmpty = input([empty]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      selections: [{
        ...empty,
        inventoryIdentityEvidence: {
          ...empty.inventoryIdentityEvidence,
          identityCount: -0,
        },
      }],
    }), "INVALID_IDENTITY_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      selections: [{
        ...empty,
        inventoryIdentityEvidence: {
          ...empty.inventoryIdentityEvidence,
          duplicateIdentityCount: -0,
        },
      }],
    }), "INVALID_IDENTITY_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      crossSelectionIdentityEvidence: {
        ...validEmpty.crossSelectionIdentityEvidence,
        checkedIdentityCount: -0,
      },
    }), "INVALID_IDENTITY_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      crossSelectionIdentityEvidence: {
        ...validEmpty.crossSelectionIdentityEvidence,
        duplicateIdentityCount: -0,
      },
    }), "INVALID_IDENTITY_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      selections: [{
        ...empty,
        pathEvidence: { ...empty.pathEvidence, reparsePointsEncountered: -0 },
      }],
    }), "BASE_CONTRACT_REJECTED");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      outputBoundary: {
        ...validEmpty.outputBoundary,
        pathEvidence: {
          ...validEmpty.outputBoundary.pathEvidence,
          reparsePointsEncountered: -0,
        },
      },
    }), "BASE_CONTRACT_REJECTED");

    const twoSelections = input([
      selection("C:\\Capture\\First.e57", "file", 83, [83]),
      selection("D:\\Capture\\Second.e57", "file", 84, [84]),
    ]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...twoSelections,
      nativePathComparisons: {
        ...twoSelections.nativePathComparisons,
        sourcePairs: twoSelections.nativePathComparisons.sourcePairs.map((pair, index) => index === 0
          ? { ...pair, leftSelectionIndex: -0 }
          : pair),
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validEmpty,
      nativePathComparisons: {
        ...validEmpty.nativePathComparisons,
        outputPairs: [{ selectionIndex: -0, relation: "disjoint" }],
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
  });

  it("rejects every negative-zero manifest count, including digest-colliding empty counts", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV1(input([
      selection("C:\\Capture\\Empty", "directory", 85, [], "0"),
    ]));
    const canonicalCollisions: unknown[] = [
      {
        ...manifest,
        sources: manifest.sources.map((source) => ({ ...source, fileCount: -0 })),
      },
      {
        ...manifest,
        sources: manifest.sources.map((source) => ({
          ...source,
          inventoryIdentityCount: -0,
        })),
      },
      { ...manifest, totals: { ...manifest.totals, discoveredFiles: -0 } },
      { ...manifest, totals: { ...manifest.totals, inventoryIdentityCount: -0 } },
      {
        ...manifest,
        nativeEvidence: { ...manifest.nativeEvidence, checkedIdentityCount: -0 },
      },
      {
        ...manifest,
        nativeEvidence: { ...manifest.nativeEvidence, sourcePairCount: -0 },
      },
    ];
    for (const attack of canonicalCollisions) {
      expect(JSON.stringify(attack)).toBe(JSON.stringify(manifest));
      expect(isStructurallyValidWindowsSourceSetManifestV1(attack)).toBe(false);
      expect(doesWindowsSourceSetManifestMatchExpectedDigestV1(
        attack,
        manifest.manifestDigestSha256,
      )).toBe(false);
    }

    const recomputedAttacks = [
      recomputeManifestDigest({
        ...manifest,
        sources: manifest.sources.map((source) => ({ ...source, basketPosition: -0 })),
      }),
      recomputeManifestDigest({
        ...manifest,
        totals: { ...manifest.totals, selectedRoots: -0 },
      }),
      recomputeManifestDigest({
        ...manifest,
        nativeEvidence: { ...manifest.nativeEvidence, outputPairCount: -0 },
      }),
      recomputeManifestDigest({
        ...manifest,
        nativeEvidence: {
          ...manifest.nativeEvidence,
          localVolumeProof: {
            ...manifest.nativeEvidence.localVolumeProof,
            checkedBoundaryCount: -0,
          },
        },
      }),
    ];
    for (const attack of recomputedAttacks) {
      expect(isStructurallyValidWindowsSourceSetManifestV1(attack)).toBe(false);
    }
  });

  it("enforces the V1 100,000-file per-selection and total caps", () => {
    expect(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxFilesPerSelection).toBe(100_000);
    expect(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1.maxDiscoveredFiles).toBe(100_000);
    expect(buildTrustedWindowsSourceSetManifestV1(input()).limits).toEqual(
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V1,
    );

    const base = selection("C:\\Capture\\Folder", "directory", 10, [101], "0");
    const repeatedIdentity = identity(101);
    const tooManyForOne = Array<TrustedWindowsSourceIdentityV1>(100_001).fill(repeatedIdentity);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...input([base]),
      selections: [{
        ...base,
        fileCount: tooManyForOne.length,
        inventoryFileIdentities: tooManyForOne,
      }],
    }), "BASE_CONTRACT_REJECTED");

    const halfPlusOne = 50_001;
    const firstIdentities = Array<TrustedWindowsSourceIdentityV1>(halfPlusOne).fill(identity(201));
    const secondIdentities = Array<TrustedWindowsSourceIdentityV1>(halfPlusOne).fill(identity(301));
    const first = {
      ...selection("C:\\Capture\\First", "directory", 20, [201], "0"),
      fileCount: halfPlusOne,
      inventoryFileIdentities: firstIdentities,
    };
    const second = {
      ...selection("D:\\Capture\\Second", "directory", 30, [301], "0"),
      fileCount: halfPlusOne,
      inventoryFileIdentities: secondIdentities,
    };
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...input([base]),
      selections: [first, second],
    }), "BASE_CONTRACT_REJECTED");
  });

  it("rejects a duplicate file identity across disjoint selections", () => {
    const first = selection("C:\\Capture A", "directory", 1, [101], "100");
    const second = selection("D:\\Capture B", "directory", 2, [101], "100");
    const valid = input([first, selection("D:\\Capture B", "directory", 2, [201], "100")]);
    const forged = {
      ...valid,
      selections: [first, second],
    };

    expectCode(
      () => buildTrustedWindowsSourceSetManifestV1(forged),
      "CROSS_SELECTION_IDENTITY_DUPLICATE",
    );
  });

  it("requires each dense identity list to match file count, root identity, and its digest", () => {
    const valid = input([selection("C:\\Capture\\Reception.e57", "file", 1, [1])]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        inventoryFileIdentities: [identity(2)],
      }],
    }), "FILE_ROOT_IDENTITY_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        inventoryIdentityEvidence: {
          ...valid.selections[0]?.inventoryIdentityEvidence,
          identitySetSha256: `sha256:${"00".repeat(32)}`,
        },
      }],
    }), "SELECTION_IDENTITY_EVIDENCE_MISMATCH");

    const directory = selection("C:\\Capture\\Photos", "directory", 10, [101, 102]);
    const validDirectory = input([directory]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...validDirectory,
      selections: [{
        ...directory,
        inventoryFileIdentities: [identity(101), identity(101)],
      }],
    }), "SELECTION_IDENTITY_DUPLICATE");

    expect(deriveTrustedWindowsSelectionIdentityEvidenceV1([
      identity(101),
      identity(102),
    ])).toEqual(deriveTrustedWindowsSelectionIdentityEvidenceV1([
      identity(102),
      identity(101),
    ]));

    const orderedInput = input([directory]);
    const reorderedInput = {
      ...orderedInput,
      selections: [{
        ...directory,
        inventoryFileIdentities: [...directory.inventoryFileIdentities].reverse(),
      }],
    };
    expect(buildTrustedWindowsSourceSetManifestV1(reorderedInput))
      .toEqual(buildTrustedWindowsSourceSetManifestV1(orderedInput));
  });

  it("requires the global count and identity-set digest to match every selection", () => {
    const valid = input();
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      crossSelectionIdentityEvidence: {
        ...valid.crossSelectionIdentityEvidence,
        checkedIdentityCount: valid.crossSelectionIdentityEvidence.checkedIdentityCount + 1,
      },
    }), "CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      crossSelectionIdentityEvidence: {
        ...valid.crossSelectionIdentityEvidence,
        globalIdentitySetSha256: `sha256:${"00".repeat(32)}`,
      },
    }), "CROSS_SELECTION_IDENTITY_EVIDENCE_MISMATCH");
  });

  it("requires exact sorted source/source and source/output comparison coverage", () => {
    const valid = input();
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        sourcePairs: valid.nativePathComparisons.sourcePairs.slice(1),
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        sourcePairs: [
          valid.nativePathComparisons.sourcePairs[1],
          valid.nativePathComparisons.sourcePairs[0],
          valid.nativePathComparisons.sourcePairs[2],
        ],
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        sourcePairs: [
          { leftSelectionIndex: 1, rightSelectionIndex: 1, relation: "disjoint" },
          ...valid.nativePathComparisons.sourcePairs.slice(1),
        ],
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        outputPairs: [...valid.nativePathComparisons.outputPairs, { selectionIndex: 1, relation: "disjoint" }],
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        outputPairs: valid.nativePathComparisons.outputPairs.slice(1),
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      nativePathComparisons: {
        ...valid.nativePathComparisons,
        outputPairs: [
          valid.nativePathComparisons.outputPairs[1],
          valid.nativePathComparisons.outputPairs[0],
          valid.nativePathComparisons.outputPairs[2],
        ],
      },
    }), "PATH_COMPARISON_COVERAGE_MISMATCH");
  });

  it("binds native comparisons to the exact private paths and adapter build", () => {
    const valid = input();
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      adapterEvidence: {
        ...valid.adapterEvidence,
        comparisonTranscriptSha256: `sha256:${"00".repeat(32)}`,
      },
    }), "COMPARISON_TRANSCRIPT_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      adapterEvidence: {
        ...valid.adapterEvidence,
        adapterBuildSha256: "not-a-digest",
      },
    }), "INVALID_ADAPTER_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      adapterEvidence: {
        ...valid.adapterEvidence,
        adapterBuildSha256: `sha256:${"b2".repeat(32)}`,
      },
    }), "COMPARISON_TRANSCRIPT_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      adapterEvidence: {
        ...valid.adapterEvidence,
        adapterId: "venviewer.windows-native-picker.v2",
      },
    }), "COMPARISON_TRANSCRIPT_MISMATCH");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        canonicalAbsolutePath: "C:\\Capture\\Changed.e57",
        resolvedAbsolutePath: "C:\\Capture\\Changed.e57",
      }, ...valid.selections.slice(1)],
    }), "COMPARISON_TRANSCRIPT_MISMATCH");
  });

  it("rejects sparse arrays, accessor-backed members, and unknown fields without invoking getters", () => {
    const valid = input();
    const sparse = new Array<TrustedWindowsSourceSelectionV1>(1);
    expectCode(
      () => buildTrustedWindowsSourceSetManifestV1({ ...valid, selections: sparse }),
      "INVALID_DENSE_ARRAY",
    );

    expectCode(
      () => buildTrustedWindowsSourceSetManifestV1({ ...valid, selections: new Array(129) }),
      "INVALID_DENSE_ARRAY",
    );

    expectCode(
      () => deriveTrustedWindowsSelectionIdentityEvidenceV1(
        new Array<TrustedWindowsSourceIdentityV1>(1_000_001),
      ),
      "INVALID_DENSE_ARRAY",
    );

    let getterCalled = false;
    const accessorIdentities: TrustedWindowsSourceIdentityV1[] = [];
    Object.defineProperty(accessorIdentities, "0", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("The getter must not run.");
      },
    });
    Object.defineProperty(accessorIdentities, "length", { value: 1 });
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        inventoryFileIdentities: accessorIdentities,
      }, ...valid.selections.slice(1)],
    }), "INVALID_DENSE_ARRAY");
    expect(getterCalled).toBe(false);

    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      cloudBucket: "candidate-assets",
    }), "UNEXPECTED_FIELD");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      adapterEvidence: { ...valid.adapterEvidence, command: "run" },
    }), "UNEXPECTED_FIELD");

    const transcriptInput: TrustedWindowsPathComparisonTranscriptInputV1 = {
      adapterId: valid.adapterEvidence.adapterId,
      adapterBuildSha256: valid.adapterEvidence.adapterBuildSha256,
      identityComparisonMechanism: valid.adapterEvidence.identityComparisonMechanism,
      pathComparisonMechanism: valid.adapterEvidence.pathComparisonMechanism,
      sourceCanonicalAbsolutePaths: valid.selections.map((source) => source.canonicalAbsolutePath),
      outputCanonicalAbsolutePath: valid.outputBoundary.canonicalAbsolutePath,
      nativePathComparisons: valid.nativePathComparisons,
    };
    const transcriptWithExtra = {
      ...transcriptInput,
      diagnosticCommand: "run",
    };
    expectCode(
      () => deriveTrustedWindowsPathComparisonTranscriptSha256V1(transcriptWithExtra),
      "UNEXPECTED_FIELD",
    );
    expectCode(() => deriveTrustedWindowsPathComparisonTranscriptSha256V1({
      ...transcriptInput,
      sourceCanonicalAbsolutePaths: new Array<string>(1),
    }), "INVALID_DENSE_ARRAY");

    let transcriptGetterCalled = false;
    const accessorTranscript = { ...transcriptInput };
    Object.defineProperty(accessorTranscript, "sourceCanonicalAbsolutePaths", {
      enumerable: true,
      get() {
        transcriptGetterCalled = true;
        throw new Error("The transcript helper must not run this getter.");
      },
    });
    expectCode(
      () => deriveTrustedWindowsPathComparisonTranscriptSha256V1(accessorTranscript),
      "INVALID_PAYLOAD",
    );
    expect(transcriptGetterCalled).toBe(false);
  });

  it("inherits the strict V0 path, reparse, overlap, and empty-directory rules", () => {
    const valid = input([selection("C:\\Capture\\Reception.e57", "file", 1, [1])]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        canonicalAbsolutePath: "\\\\server\\share\\Reception.e57",
        resolvedAbsolutePath: "\\\\server\\share\\Reception.e57",
      }],
    }), "BASE_CONTRACT_REJECTED");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1({
      ...valid,
      selections: [{
        ...valid.selections[0],
        pathEvidence: { ...valid.selections[0]?.pathEvidence, reparsePointsEncountered: 1 },
      }],
    }), "BASE_CONTRACT_REJECTED");

    const empty = selection("C:\\Capture\\Empty", "directory", 4, [], "0");
    expectCode(() => buildTrustedWindowsSourceSetManifestV1(input([{
      ...empty,
      byteCountDecimal: "1",
    }])), "BASE_CONTRACT_REJECTED");
  });

  it("rejects semantic manifest attacks even after the attacker recomputes the public digest", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV1(input());
    const changedTotals = recomputeManifestDigest({
      ...manifest,
      totals: { ...manifest.totals, discoveredFiles: manifest.totals.discoveredFiles + 1 },
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(changedTotals)).toBe(false);

    const changedPairCount = recomputeManifestDigest({
      ...manifest,
      nativeEvidence: {
        ...manifest.nativeEvidence,
        sourcePairCount: manifest.nativeEvidence.sourcePairCount + 1,
      },
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(changedPairCount)).toBe(false);

    const changedIdentityCount = recomputeManifestDigest({
      ...manifest,
      sources: manifest.sources.map((source, index) => index === 0
        ? { ...source, inventoryIdentityCount: source.inventoryIdentityCount + 1 }
        : source),
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(changedIdentityCount)).toBe(false);

    const duplicateSourceDigest = recomputeManifestDigest({
      ...manifest,
      sources: manifest.sources.map((source, index) => index === 1
        ? { ...source, sourceDigestSha256: manifest.sources[0]?.sourceDigestSha256 ?? source.sourceDigestSha256 }
        : source),
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(duplicateSourceDigest)).toBe(false);

    const zeroFilesWithPositiveBytes = recomputeManifestDigest({
      ...manifest,
      sources: manifest.sources.map((source, index) => index === 0
        ? {
            ...source,
            fileCount: 0,
            inventoryIdentityCount: 0,
            byteCountDecimal: "1",
          }
        : source),
      totals: {
        ...manifest.totals,
        discoveredFiles: manifest.totals.discoveredFiles - manifest.sources[0]!.fileCount,
        inventoryIdentityCount:
          manifest.totals.inventoryIdentityCount - manifest.sources[0]!.inventoryIdentityCount,
        totalBytesDecimal: (
          BigInt(manifest.totals.totalBytesDecimal) -
          BigInt(manifest.sources[0]!.byteCountDecimal) +
          1n
        ).toString(10),
      },
      nativeEvidence: {
        ...manifest.nativeEvidence,
        checkedIdentityCount:
          manifest.nativeEvidence.checkedIdentityCount - manifest.sources[0]!.inventoryIdentityCount,
      },
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(zeroFilesWithPositiveBytes)).toBe(false);
  });

  it("rejects a fully fabricated record unless its digest came through the trusted channel", () => {
    const authentic = buildTrustedWindowsSourceSetManifestV1(input());
    const fabricated = recomputeManifestDigest({
      ...authentic,
      sourceSetDigestSha256: `sha256:${"f0".repeat(32)}`,
      sources: authentic.sources.map((source, index) => ({
        ...source,
        sourceDigestSha256: `sha256:${(index + 1).toString(16).padStart(2, "0").repeat(32)}`,
        inventoryIdentitySetSha256:
          `sha256:${(index + 17).toString(16).padStart(2, "0").repeat(32)}`,
      })),
      nativeEvidence: {
        ...authentic.nativeEvidence,
        adapterBuildSha256: `sha256:${"a0".repeat(32)}`,
        comparisonTranscriptSha256: `sha256:${"b0".repeat(32)}`,
        globalIdentitySetSha256: `sha256:${"c0".repeat(32)}`,
      },
    });

    expect(doesWindowsSourceSetManifestMatchExpectedDigestV1(
      fabricated,
      authentic.manifestDigestSha256,
    )).toBe(false);
    expect(doesWindowsSourceSetManifestMatchExpectedDigestV1(authentic, undefined)).toBe(false);
  });

  it("rejects recomputed-digest extra fields, sparse source arrays, and manifest accessors", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV1(input());
    const first = manifest.sources[0];
    if (first === undefined) throw new Error("Expected a source summary.");
    const extraFieldBody = {
      ...manifest,
      sources: [{ ...first, absolutePath: "C:\\private.e57" }, ...manifest.sources.slice(1)],
    };
    const { manifestDigestSha256: _oldDigest, ...body } = extraFieldBody;
    const recomputed = {
      ...body,
      manifestDigestSha256: `sha256:${domainSeparatedSha256(
        TRUSTED_WINDOWS_SOURCE_SET_MANIFEST_DIGEST_DOMAIN_V1,
        toCanonicalJson(body),
      )}`,
    };
    expect(isStructurallyValidWindowsSourceSetManifestV1(recomputed)).toBe(false);

    const sparse = new Array<(typeof manifest.sources)[number]>(manifest.sources.length);
    sparse[0] = first;
    expect(isStructurallyValidWindowsSourceSetManifestV1({
      ...manifest,
      sources: sparse,
    })).toBe(false);

    let getterCalled = false;
    const accessor = { ...manifest };
    Object.defineProperty(accessor, "sources", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("The verifier must not run this getter.");
      },
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(accessor)).toBe(false);
    expect(getterCalled).toBe(false);
  });

  it("rejects a changed manifest digest and fixed authority/use substitutions", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV1(input());
    expect(isStructurallyValidWindowsSourceSetManifestV1({
      ...manifest,
      manifestDigestSha256: `sha256:${"00".repeat(32)}`,
    })).toBe(false);
    const unchanged = recomputeManifestDigest({
      ...manifest,
      authority: "none" as const,
      use: "inspection_only" as const,
      schemaVersion: "trusted-windows-source-set-manifest.v1",
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(unchanged)).toBe(true);
    const changedUse = recomputeManifestDigest({
      ...manifest,
      use: "execution" as "inspection_only",
    });
    expect(isStructurallyValidWindowsSourceSetManifestV1(changedUse)).toBe(false);
  });
});
