import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_CAMERA_METRIC_SUBSET_STATE,
  GrandHallCameraMetricSubsetSchema,
} from "../grand-hall-camera-metric-subset-contract.js";
import {
  GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS,
  GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES,
  buildGrandHallCameraMetricSubsetMaterial,
  parseGrandHallCameraMetricSubset,
  parseGrandHallCameraMetricSubsetArguments,
  sealGrandHallCameraMetricSubset,
  serializeGrandHallCameraMetricSubset,
  type GrandHallCameraMetricSubsetInputs,
} from "../grand-hall-camera-metric-subset.js";

function fixedHex(value: number, length: number): string {
  return value.toString(16).padStart(length, "0");
}

function mappingForSweep(sweepNumber: number) {
  return GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS.find(
    (mapping) => mapping.sweepNumber === sweepNumber,
  );
}

function guidForScan(scanIndex: number): string {
  return mappingForSweep(scanIndex + 1)?.data3DGuid ?? fixedHex(scanIndex + 1, 32);
}

function crosswalkDocument(): unknown {
  const results = Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweepNumber) => sweepNumber !== 93)
    .map((sweepNumber) => {
      const mapping = mappingForSweep(sweepNumber);
      const selectedGuid = mapping?.data3DGuid ?? guidForScan((sweepNumber + 3) % 149);
      const selectedIndex = mapping?.scanIndex ?? (sweepNumber + 3) % 149;
      const ambiguous = sweepNumber === 78 || sweepNumber === 79;
      const selected = { data3DGuid: selectedGuid, displayScanIndex: selectedIndex, supported: true };
      const candidates = mapping?.supportedCandidateCount === 2
        ? [selected, { data3DGuid: fixedHex(10_000 + sweepNumber, 32), displayScanIndex: 120, supported: true }]
        : [selected];
      return {
        candidateData3DGuid: ambiguous ? null : selectedGuid,
        candidates,
        display: {
          relativePath: `sweep_${String(sweepNumber).padStart(3, "0")}jpg.jpg`,
          sweepNumber,
        },
        humanReviewRequired: true,
        panoramaSha256: mapping?.panoramaSha256 ?? fixedHex(20_000 + sweepNumber, 64),
        state: ambiguous ? "ambiguous_human_pending" : "candidate_human_pending",
      };
    });
  return {
    authority: "none",
    contract: {
      cameraPoseAuthority: "none",
      correspondenceAuthority: "candidate_feature_match_unverified",
      roomMembershipAuthority: "none",
      runtimeAuthority: false,
      trainingAuthority: false,
      transformAuthority: "none",
    },
    results,
    schemaVersion: "venviewer.panorama-e57-candidate-crosswalk-authority-none.v1",
    sourceBindings: {
      image2DManifest: {
        sha256: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Image2dManifest.sha256.slice(7),
        sizeBytes: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Image2dManifest.byteLength,
      },
    },
  };
}

function posesDocument(): unknown {
  return Object.fromEntries(Array.from({ length: 149 }, (_, scanIndex) => [String(scanIndex), {
    rotation: [1, scanIndex / 1_000, 0, 0],
    translation: [scanIndex, -scanIndex / 2, 1.5],
  }]));
}

function image2dDocument(): unknown {
  const data3D = Array.from({ length: 149 }, (_, scanIndex) => ({
    guid: guidForScan(scanIndex),
    scanIndex,
  }));
  const images = data3D.flatMap((scan) => Array.from({ length: 6 }, (_, faceIndex) => {
    const imageIndex = scan.scanIndex * 6 + faceIndex;
    return {
      associatedData3DGuid: scan.guid,
      blob: "jpegImage",
      data3DIndex: scan.scanIndex,
      decodedMode: "RGB",
      faceIndex,
      focalLength: 0.5,
      height: 4_096,
      imageGuid: fixedHex(100_000 + imageIndex, 32),
      imageIndex,
      imageName: `Skybox ${String(faceIndex)}`,
      pixelHeight: 0.000244140625,
      pixelWidth: 0.000244140625,
      principalPointX: 2_048,
      principalPointY: 2_048,
      relativePath: `images/scan_${String(scan.scanIndex).padStart(3, "0")}/image2d_${String(imageIndex)}_skybox_${String(faceIndex)}.jpg`,
      representation: "pinholeRepresentation",
      sha256: fixedHex(200_000 + imageIndex, 64),
      sizeBytes: 1_000 + imageIndex,
      width: 4_096,
    };
  }));
  return {
    authority: "none",
    contract: {
      associationMethod: "exact_associatedData3DGuid",
      cameraOrientationAuthority: "none",
      panoramaCorrespondenceAuthority: "none",
      runtimeAuthority: false,
      trainingAuthority: false,
    },
    data3D,
    images,
    schemaVersion: "venviewer.e57-image2d-evidence.v1",
    source: {
      e57Sha256: "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
      e57SizeBytes: 20_518_437_888,
    },
    summary: { data3DCount: 149, facesPerData3D: 6, image2DCount: 894 },
  };
}

function validInputs(): GrandHallCameraMetricSubsetInputs {
  return {
    candidateCrosswalkIdentity: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.candidateCrosswalk,
    candidateCrosswalkDocument: crosswalkDocument(),
    e57PosesIdentity: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Poses,
    e57PosesCanonicalSha256: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Poses.canonicalPoseSha256,
    e57PosesDocument: posesDocument(),
    e57Image2dIdentity: GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Image2dManifest,
    e57Image2dDocument: image2dDocument(),
  };
}

describe("Grand Hall authority-none camera/metric subset", () => {
  it("freezes exactly sweeps 041-048 with metric E57 poses and 48 native faces", () => {
    const bundle = sealGrandHallCameraMetricSubset(
      buildGrandHallCameraMetricSubsetMaterial(validInputs()),
    );

    expect(bundle.state).toBe(GRAND_HALL_CAMERA_METRIC_SUBSET_STATE);
    expect(bundle.subject.includedExternalSweepNumbers).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
    expect(bundle.subject.excludedExternalSweepNumbers).toEqual([49]);
    expect(bundle.subject.sweep49Included).toBe(false);
    expect(bundle.rows.map((row) => row.e57Scanner.scanIndex)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    expect(bundle.rows.flatMap((row) => row.nativeCubefaces)).toHaveLength(48);
    expect(bundle.rows[6]?.candidateCorrespondence).toMatchObject({
      supportedCandidateCount: 2,
      caveat: "two_matcher_supported_candidates_human_review_required",
    });
    for (const row of bundle.rows) {
      expect(row.externalPanorama.cameraPosition).toBeNull();
      expect(row.externalPanorama.cameraOrientation).toBeNull();
      expect(row.nativeCubefaces.map((face) => face.faceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(row.e57Scanner.orientationUseBlocked).toBe(true);
      expect(Object.values(row.guards)).not.toContain(true);
    }
    expect(Object.values(bundle.contract)).not.toContain(true);
    expect(bundle.summary).toMatchObject({
      acceptedRowCount: 0,
      trainingEligibleRowCount: 0,
      reconstructionEligibleRowCount: 0,
      runtimeEligibleRowCount: 0,
    });
  });

  it("round-trips only canonical bytes with an intact domain-separated self-digest", () => {
    const bundle = sealGrandHallCameraMetricSubset(
      buildGrandHallCameraMetricSubsetMaterial(validInputs()),
    );
    const bytes = serializeGrandHallCameraMetricSubset(bundle);

    expect(parseGrandHallCameraMetricSubset(bytes)).toEqual(bundle);
    expect(bytes.at(-1)).toBe(0x0a);
    const badDigest = serializeGrandHallCameraMetricSubset({
      ...bundle,
      bundleSha256: `sha256:${"0".repeat(64)}`,
    });
    expect(() => parseGrandHallCameraMetricSubset(badDigest)).toThrow("self-digest");
    expect(() => parseGrandHallCameraMetricSubset(Buffer.from(` ${bytes.toString("utf8")}`)))
      .toThrow("not canonical");
  });

  it("rejects every attempted authority or downstream-permission grant", () => {
    const bundle = sealGrandHallCameraMetricSubset(
      buildGrandHallCameraMetricSubsetMaterial(validInputs()),
    );
    expect(() => GrandHallCameraMetricSubsetSchema.parse({
      ...bundle,
      contract: { ...bundle.contract, trainingInputPermitted: true },
    })).toThrow();
    expect(() => GrandHallCameraMetricSubsetSchema.parse({
      ...bundle,
      rows: bundle.rows.map((row, index) => index === 0
        ? { ...row, externalPanorama: { ...row.externalPanorama, cameraPosition: [0, 0, 0] } }
        : row),
    })).toThrow();
    expect(() => GrandHallCameraMetricSubsetSchema.parse({
      ...bundle,
      subject: { ...bundle.subject, sweep49Included: true },
    })).toThrow();
  });

  it("fails closed when the selected crosswalk mapping drifts", () => {
    const inputs = validInputs();
    const crosswalk = structuredClone(inputs.candidateCrosswalkDocument) as {
      results: Array<{ display: { sweepNumber: number }; candidateData3DGuid: string }>;
    };
    const row = crosswalk.results.find((result) => result.display.sweepNumber === 41);
    if (row === undefined) throw new Error("Fixture sweep 41 is missing.");
    row.candidateData3DGuid = "0".repeat(32);

    expect(() => buildGrandHallCameraMetricSubsetMaterial({
      ...inputs,
      candidateCrosswalkDocument: crosswalk,
    })).toThrow("Sweep 41 crosswalk candidate drifted");
  });

  it("fails closed when an E57 scan does not have six exact associated faces", () => {
    const inputs = validInputs();
    const image2d = structuredClone(inputs.e57Image2dDocument) as {
      images: Array<{ data3DIndex: number; faceIndex: number }>;
    };
    image2d.images = image2d.images.filter((image) => !(image.data3DIndex === 40 && image.faceIndex === 5));

    expect(() => buildGrandHallCameraMetricSubsetMaterial({
      ...inputs,
      e57Image2dDocument: image2d,
    })).toThrow();
  });

  it("parses the no-replace and zero-write check CLI modes exactly", () => {
    const required = [
      "--crosswalk", "C:\\crosswalk.json",
      "--poses", "F:\\poses.json",
      "--image2d", "D:\\image2d.json",
      "--out", "C:\\subset.json",
    ];
    expect(parseGrandHallCameraMetricSubsetArguments(required)).toMatchObject({ check: false });
    expect(parseGrandHallCameraMetricSubsetArguments(["--check", ...required])).toMatchObject({ check: true });
    expect(() => parseGrandHallCameraMetricSubsetArguments([...required, "--publish", "yes"]))
      .toThrow("Unknown CLI option");
    expect(() => parseGrandHallCameraMetricSubsetArguments(["--check", "--check", ...required]))
      .toThrow("Duplicate CLI option: --check");
  });
});
