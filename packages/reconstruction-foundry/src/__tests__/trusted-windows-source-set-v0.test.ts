import { describe, expect, it } from "vitest";
import {
  TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0,
  TrustedWindowsSourceSetValidationError,
  assertTrustedWindowsSourceSetStructuralContractV0,
  buildTrustedWindowsSourceSetManifestV0,
  verifyTrustedWindowsSourceSetManifestV0,
  type TrustedWindowsNativeSourceSetInputV0,
  type TrustedWindowsSourceSelectionV0,
} from "../trusted-windows-source-set-v0.js";

const PATH_EVIDENCE = Object.freeze({
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

const DROP_PATH_EVIDENCE = Object.freeze({
  ...PATH_EVIDENCE,
  acquisition: "windows_native_drop_cfhdrop_then_handle_open" as const,
});

const OUTPUT_EVIDENCE = Object.freeze({
  acquisition: "trusted_launcher_output_configuration" as const,
  canonicalization: "resolved_existing_ancestor_and_validated_suffix" as const,
  inspectionMode: "read_only" as const,
  reparseInspectionScope: "volume_root_through_output_parent" as const,
  reparseInspectionComplete: true as const,
  reparsePointsEncountered: 0,
});

function hexId(seed: number): string {
  return seed.toString(16).toUpperCase().padStart(32, "0");
}

function selection(
  canonicalAbsolutePath: string,
  kind: "file" | "directory",
  seed: number,
  byteCountDecimal = "1024",
  fileCount = kind === "file" ? 1 : 10,
): TrustedWindowsSourceSelectionV0 {
  return {
    kind,
    canonicalAbsolutePath,
    resolvedAbsolutePath: canonicalAbsolutePath,
    byteCountDecimal,
    fileCount,
    identity: {
      volumeSerialNumberHex: "A1B2C3D4",
      fileIdHex: hexId(seed),
    },
    pathEvidence: PATH_EVIDENCE,
  };
}

function input(
  selections: readonly TrustedWindowsSourceSelectionV0[],
): TrustedWindowsNativeSourceSetInputV0 {
  return {
    schemaVersion: "trusted-windows-native-source-set-input.v0",
    origin: "trusted_windows_native_launcher",
    browserPathInputAccepted: false,
    sessionNonceHex: "ab".repeat(32),
    outputBoundary: {
      canonicalAbsolutePath: "D:\\Foundry Output\\Run 1",
      resolvedAbsolutePath: "D:\\Foundry Output\\Run 1",
      pathEvidence: OUTPUT_EVIDENCE,
    },
    selections,
  };
}

function expectCode(action: () => unknown, expectedCode: string): void {
  try {
    action();
  } catch (error: unknown) {
    if (!(error instanceof TrustedWindowsSourceSetValidationError)) throw error;
    expect(error.code).toBe(expectedCode);
    expect(error.message).not.toMatch(/[A-Z]:\\/u);
    expect(error.message).not.toContain("\\");
    expect(error.message).not.toContain("Users");
    return;
  }
  throw new Error(`Expected ${expectedCode} to be thrown.`);
}

describe("trusted Windows source-set V0", () => {
  it("accepts only picker and CF_HDROP-then-handle-open source acquisition without changing legacy manifests", () => {
    const picked = selection("C:\\Capture\\Reception.e57", "file", 1);
    const dropped: TrustedWindowsSourceSelectionV0 = {
      ...picked,
      pathEvidence: DROP_PATH_EVIDENCE,
    };
    const legacyManifest = buildTrustedWindowsSourceSetManifestV0(input([picked]));
    const droppedManifest = buildTrustedWindowsSourceSetManifestV0(input([dropped]));

    expect(droppedManifest).toEqual(legacyManifest);
    expect(verifyTrustedWindowsSourceSetManifestV0(droppedManifest)).toBe(true);
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...input([picked]),
      selections: [{
        ...picked,
        pathEvidence: {
          ...picked.pathEvidence,
          acquisition: "windows_native_drop_path",
        },
      }],
    }), "INCOMPLETE_TRUSTED_PATH_EVIDENCE");
  });

  it("models an ordered keyboard basket with mixed files and folders exactly once", () => {
    // This is the final basket after keyboard-adding all items, removing OBJ,
    // and keyboard-adding OBJ again at the end.
    const selections = [
      selection("C:\\Capture\\Reception.e57", "file", 1, "8000000000"),
      selection("C:\\Capture\\Photos", "directory", 2, "4500000000", 30),
      selection("C:\\Capture\\Model.glb", "file", 3, "200000000"),
      selection("C:\\Capture\\XGRIDS", "directory", 4, "500000000", 3),
      selection("C:\\Capture\\Gaussian\\Reception.sog", "file", 5, "129565"),
      selection("C:\\Capture\\Walkthrough.mp4", "file", 6, "900000000"),
      selection("C:\\Capture\\Control\\poses.csv", "file", 7, "3659287"),
      selection("C:\\Capture\\Reception.obj", "file", 8, "700000000"),
    ] as const;

    const manifest = buildTrustedWindowsSourceSetManifestV0(input(selections));

    expect(manifest.schemaVersion).toBe("trusted-windows-source-set-manifest.v0");
    expect(manifest.authority).toBe("none");
    expect(manifest.use).toBe("read_only_selection_review");
    expect(manifest.sources.map((source) => source.displayName)).toEqual([
      "Reception.e57",
      "Photos",
      "Model.glb",
      "XGRIDS",
      "Reception.sog",
      "Walkthrough.mp4",
      "poses.csv",
      "Reception.obj",
    ]);
    expect(manifest.sources.map((source) => source.basketPosition)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(manifest.sources.map((source) => source.sourceRef)).size).toBe(8);
    expect(manifest.totals).toEqual({
      selectedRoots: 8,
      discoveredFiles: 39,
      totalBytesDecimal: "14803788852",
    });
    expect(verifyTrustedWindowsSourceSetManifestV0(manifest)).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.sources)).toBe(true);
  });

  it("emits no absolute path, parent folder, nonce, cloud field, or command authority", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Users\\Blake\\Private Client\\Reception.e57", "file", 1),
    ]));
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("D:\\");
    expect(serialized).not.toContain("Users");
    expect(serialized).not.toContain("Private Client");
    expect(serialized).not.toContain("abababab");
    expect(serialized).not.toMatch(/bucket|endpoint|credential|command|permit|execute/iu);
    expect(manifest.sources[0]?.displayName).toBe("Reception.e57");
    expect(manifest.sources[0]?.sourceRef).toMatch(/^src_[a-f0-9]{64}$/u);
    expect(manifest.sourceSetRef).toMatch(/^set_[a-f0-9]{64}$/u);
    expect(manifest.manifestDigestSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("sanitizes a basename for plain-text browser display without exposing its parent", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Private & Hidden\\room&quote'.e57", "file", 1),
    ]));

    expect(manifest.sources[0]?.displayName).toBe("room�quote�.e57");
    expect(manifest.sources[0]?.displayNameWasSanitized).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("Private & Hidden");
  });

  it("is deterministic for one launch and unlinkable when the native nonce changes", () => {
    const trustedInput = input([selection("C:\\Capture\\Reception.e57", "file", 1)]);
    const first = buildTrustedWindowsSourceSetManifestV0(trustedInput);
    const repeated = buildTrustedWindowsSourceSetManifestV0(trustedInput);
    const nextLaunch = buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      sessionNonceHex: "cd".repeat(32),
    });

    expect(repeated).toEqual(first);
    expect(nextLaunch.sources[0]?.sourceRef).not.toBe(first.sources[0]?.sourceRef);
    expect(nextLaunch.sourceSetRef).not.toBe(first.sourceSetRef);
    expect(nextLaunch.manifestDigestSha256).not.toBe(first.manifestDigestSha256);
  });

  it("detects a changed digest-bound manifest", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Reception.e57", "file", 1),
    ]));
    const tampered = {
      ...manifest,
      totals: {
        ...manifest.totals,
        totalBytesDecimal: "1025",
      },
    };

    expect(verifyTrustedWindowsSourceSetManifestV0(tampered)).toBe(false);
  });

  it("rejects negative-zero manifest counts even when JSON and the digest collapse them to zero", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Empty", "directory", 0, "0", 0),
    ]));
    const attacks = [
      {
        ...manifest,
        sources: manifest.sources.map((source) => ({ ...source, fileCount: -0 })),
      },
      {
        ...manifest,
        totals: { ...manifest.totals, discoveredFiles: -0 },
      },
    ];

    for (const attack of attacks) {
      expect(JSON.stringify(attack)).toBe(JSON.stringify(manifest));
      expect(verifyTrustedWindowsSourceSetManifestV0(attack)).toBe(false);
    }
  });

  it("rejects an extra field even when an attacker recomputes the public digest", async () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Reception.e57", "file", 0, "10", 1),
    ]));
    const { domainSeparatedSha256, toCanonicalJson } = await import("../canonical-json.js");
    const { manifestDigestSha256: _digest, ...body } = manifest;
    const tamperedBody = { ...body, execute: true };
    const tampered = {
      ...tamperedBody,
      manifestDigestSha256: `sha256:${domainSeparatedSha256(
        "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_MANIFEST.V0",
        toCanonicalJson(tamperedBody),
      )}`,
    };
    expect(verifyTrustedWindowsSourceSetManifestV0(tampered)).toBe(false);
  });

  it("rejects internally inconsistent totals even when their digest is recomputed", async () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Reception.e57", "file", 0, "10", 1),
    ]));
    const { domainSeparatedSha256, toCanonicalJson } = await import("../canonical-json.js");
    const { manifestDigestSha256: _digest, ...body } = manifest;
    const tamperedBody = {
      ...body,
      totals: { ...body.totals, totalBytesDecimal: "11" },
    };
    const tampered = {
      ...tamperedBody,
      manifestDigestSha256: `sha256:${domainSeparatedSha256(
        "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_MANIFEST.V0",
        toCanonicalJson(tamperedBody),
      )}`,
    };
    expect(verifyTrustedWindowsSourceSetManifestV0(tampered)).toBe(false);
  });

  it("rejects a manifest source array with an extra property", () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Reception.e57", "file", 0, "10", 1),
    ]));
    const sources = [...manifest.sources] as typeof manifest.sources & { note?: string };
    sources.note = "not part of the schema";
    expect(verifyTrustedWindowsSourceSetManifestV0({ ...manifest, sources })).toBe(false);
  });

  it("rejects an empty-directory summary that claims positive bytes", async () => {
    const manifest = buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Empty", "directory", 0, "0", 0),
    ]));
    const { domainSeparatedSha256, toCanonicalJson } = await import("../canonical-json.js");
    const { manifestDigestSha256: _digest, ...body } = manifest;
    const tamperedBody = {
      ...body,
      sources: body.sources.map((source) => ({ ...source, byteCountDecimal: "1" })),
      totals: { ...body.totals, totalBytesDecimal: "1" },
    };
    const tampered = {
      ...tamperedBody,
      manifestDigestSha256: `sha256:${domainSeparatedSha256(
        "OMNITWIN.TRUSTED_WINDOWS_SOURCE_SET_MANIFEST.V0",
        toCanonicalJson(tamperedBody),
      )}`,
    };
    expect(verifyTrustedWindowsSourceSetManifestV0(tampered)).toBe(false);
  });

  it("refuses to build a manifest for an empty directory claiming positive bytes", () => {
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Empty", "directory", 0, "1", 0),
    ])), "INVALID_BYTE_COUNT");
  });

  it.each([
    ["\\\\server\\share\\Reception.e57", "UNC_PATH_REJECTED"],
    ["//server/share/Reception.e57", "UNC_PATH_REJECTED"],
    ["\\\\?\\C:\\Capture\\Reception.e57", "DEVICE_PATH_REJECTED"],
    ["\\\\.\\C:\\Capture\\Reception.e57", "DEVICE_PATH_REJECTED"],
    ["\\??\\C:\\Capture\\Reception.e57", "DEVICE_PATH_REJECTED"],
    ["Reception.e57", "INVALID_ABSOLUTE_DOS_PATH"],
    ["c:\\Capture\\Reception.e57", "NON_CANONICAL_PATH"],
    ["C:\\Capture\\.\\Reception.e57", "NON_CANONICAL_PATH"],
    ["C:\\Capture\\..\\Reception.e57", "NON_CANONICAL_PATH"],
    ["C:\\Capture\\CON.e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\COM¹.e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\COM².e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\COM³.e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\LPT¹.e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\LPT².e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\LPT³.e57", "UNSAFE_WINDOWS_PATH_SEGMENT"],
    ["C:\\Capture\\Reception.e57.", "UNSAFE_WINDOWS_PATH_SEGMENT"],
  ])("rejects unsafe Windows path %s", (path, code) => {
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection(path, "file", 1),
    ])), code);
  });

  it("requires the canonical path to match the handle-resolved path", () => {
    const source = selection("C:\\Capture\\Reception.e57", "file", 1);
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([{
      ...source,
      resolvedAbsolutePath: "C:\\Elsewhere\\Reception.e57",
    }])), "PATH_RESOLUTION_MISMATCH");
  });

  it("rejects browser path authority and unexpected cloud or execution fields", () => {
    const trustedInput = input([selection("C:\\Capture\\Reception.e57", "file", 1)]);

    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      origin: "browser_drop_zone",
    }), "UNTRUSTED_PATH_ORIGIN");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      browserPathInputAccepted: true,
    }), "BROWSER_PATH_INPUT_REJECTED");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      cloudBucket: "candidate-assets",
    }), "UNEXPECTED_FIELD");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      executionPermit: "run-now",
    }), "UNEXPECTED_FIELD");
  });

  it("requires complete read-only handle and reparse-point evidence", () => {
    const source = selection("C:\\Capture\\Reception.e57", "file", 1);
    const trustedInput = input([source]);

    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: [{
        ...source,
        pathEvidence: {
          ...source.pathEvidence,
          acquisition: "browser_path",
        },
      }],
    }), "INCOMPLETE_TRUSTED_PATH_EVIDENCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: [{
        ...source,
        pathEvidence: {
          ...source.pathEvidence,
          reparseInspectionComplete: false,
        },
      }],
    }), "INCOMPLETE_REPARSE_INSPECTION");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: [{
        ...source,
        pathEvidence: {
          ...source.pathEvidence,
          reparsePointsEncountered: 1,
        },
      }],
    }), "REPARSE_POINT_REJECTED");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: [{
        ...source,
        pathEvidence: {
          ...source.pathEvidence,
          reparsePointsEncountered: -0,
        },
      }],
    }), "INCOMPLETE_REPARSE_INSPECTION");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      outputBoundary: {
        ...trustedInput.outputBoundary,
        pathEvidence: {
          ...trustedInput.outputBoundary.pathEvidence,
          reparsePointsEncountered: -0,
        },
      },
    }), "INCOMPLETE_REPARSE_INSPECTION");
  });

  it("rejects malformed launcher identities, nonces, and sparse basket arrays", () => {
    const source = selection("C:\\Capture\\Reception.e57", "file", 1);
    const trustedInput = input([source]);

    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      sessionNonceHex: "not-a-native-nonce",
    }), "INVALID_SESSION_NONCE");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: [{
        ...source,
        identity: {
          ...source.identity,
          fileIdHex: "1",
        },
      }],
    }), "INVALID_SOURCE_IDENTITY");

    const sparseSelections: unknown[] = new Array<unknown>(1);
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      selections: sparseSelections,
    }), "INVALID_PAYLOAD");
  });

  it("requires the output parent to be fully checked for reparse points", () => {
    const trustedInput = input([selection("C:\\Capture\\Reception.e57", "file", 1)]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      outputBoundary: {
        ...trustedInput.outputBoundary,
        pathEvidence: {
          ...trustedInput.outputBoundary.pathEvidence,
          reparsePointsEncountered: 1,
        },
      },
    }), "REPARSE_POINT_REJECTED");
  });

  it("rejects duplicate paths without leaking either path in the error", () => {
    const first = selection("C:\\Private\\Reception.e57", "file", 1);
    const duplicate = selection("C:\\PRIVATE\\RECEPTION.E57", "file", 2);
    expectCode(
      () => buildTrustedWindowsSourceSetManifestV0(input([first, duplicate])),
      "DUPLICATE_SOURCE_PATH",
    );
  });

  it("rejects two paths that resolve to the same Windows file identity", () => {
    const first = selection("C:\\Capture\\Reception.e57", "file", 1);
    const hardLink = {
      ...selection("C:\\Aliases\\Reception-copy.e57", "file", 2),
      identity: first.identity,
    };
    expectCode(
      () => buildTrustedWindowsSourceSetManifestV0(input([first, hardLink])),
      "DUPLICATE_SOURCE_IDENTITY",
    );
  });

  it("rejects parent-child selections because the child would be inspected twice", () => {
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Photos", "directory", 1),
      selection("C:\\Capture\\Photos\\frame-001.jpg", "file", 2),
    ])), "SOURCE_PARENT_CHILD_OVERLAP");
  });

  it.each([
    ["C:\\Capture", "directory", "C:\\Capture\\Output", "SOURCE_OUTPUT_OVERLAP"],
    ["C:\\Capture\\Reception.e57", "file", "C:\\Capture", "SOURCE_OUTPUT_OVERLAP"],
    ["C:\\Capture\\Reception.e57", "file", "C:\\", "VOLUME_ROOT_REJECTED"],
  ] as const)("rejects source/output overlap with output %s", (sourcePath, kind, outputPath, code) => {
    const trustedInput = input([
      selection(sourcePath, kind, 1),
    ]);
    expectCode(() => buildTrustedWindowsSourceSetManifestV0({
      ...trustedInput,
      outputBoundary: {
        ...trustedInput.outputBoundary,
        canonicalAbsolutePath: outputPath,
        resolvedAbsolutePath: outputPath,
      },
    }), code);
  });

  it("enforces the hard selected-root limit", () => {
    const tooMany = Array.from(
      { length: TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxSelectedRoots + 1 },
      (_, index) => selection(`C:\\Capture\\source-${String(index)}.e57`, "file", index + 1),
    );
    expectCode(
      () => buildTrustedWindowsSourceSetManifestV0(input(tooMany)),
      "SELECTED_ROOT_LIMIT_EXCEEDED",
    );
  });

  it("enforces per-selection and total file-count limits", () => {
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection(
        "C:\\Capture\\Too Many Files",
        "directory",
        1,
        "1024",
        TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxFilesPerSelection + 1,
      ),
    ])), "SELECTION_FILE_LIMIT_EXCEEDED");

    const half = Math.floor(TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxDiscoveredFiles / 2) + 1;
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Part A", "directory", 1, "1024", half),
      selection("C:\\Capture\\Part B", "directory", 2, "1024", half),
    ])), "TOTAL_FILE_LIMIT_EXCEEDED");
  });

  it("enforces per-selection and total byte limits using exact decimal integers", () => {
    const selectionLimit = BigInt(
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxBytesPerSelectionDecimal,
    );
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection(
        "C:\\Capture\\Huge.e57",
        "file",
        1,
        String(selectionLimit + 1n),
      ),
    ])), "SELECTION_BYTE_LIMIT_EXCEEDED");

    const perSelectionMaximum = BigInt(
      TRUSTED_WINDOWS_SOURCE_SET_LIMITS_V0.maxBytesPerSelectionDecimal,
    );
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Part A", "directory", 1, String(perSelectionMaximum), 1),
      selection("C:\\Capture\\Part B", "directory", 2, String(perSelectionMaximum), 1),
      selection("C:\\Capture\\Part C", "directory", 3, "1", 1),
    ])), "TOTAL_BYTE_LIMIT_EXCEEDED");

    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Reception.e57", "file", 1, "001024"),
    ])), "INVALID_BYTE_COUNT");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Reception.e57", "file", 1, "9".repeat(10_000)),
    ])), "INVALID_BYTE_COUNT");
  });

  it("requires file selections to describe exactly one regular file", () => {
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([
      selection("C:\\Capture\\Reception.e57", "file", 1, "1024", 2),
    ])), "INVALID_FILE_COUNT");
    expectCode(() => buildTrustedWindowsSourceSetManifestV0(input([{
      ...selection("C:\\Capture\\Empty", "directory", 2, "0", 0),
      fileCount: -0,
    }])), "INVALID_FILE_COUNT");
  });

  it("keeps default V0 folding while its V1-only structural precheck makes no path relation", () => {
    const divergent = input([
      selection("C:\\Capture\\K.e57", "file", 71),
      selection("C:\\Capture\\K.e57", "file", 72),
    ]);
    expectCode(
      () => buildTrustedWindowsSourceSetManifestV0(divergent),
      "DUPLICATE_SOURCE_PATH",
    );
    expect(() => {
      assertTrustedWindowsSourceSetStructuralContractV0(divergent);
    }).not.toThrow();
  });
});
