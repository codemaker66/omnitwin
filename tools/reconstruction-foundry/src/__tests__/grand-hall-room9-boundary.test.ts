import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyVerticalFirstHits,
  computeGrandHallRoom9EvidenceSha256,
  GRAND_HALL_ROOM_9,
  parseMatterportObjText,
  stableCanonicalJson,
  summarizeMatterportRoomSelection,
  summarizeSharedVertexInterface,
  type JsonValue,
} from "../grand-hall-room9-boundary.js";
import {
  createGrandHallRoom9SourceReceipt,
  GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE,
  GRAND_HALL_ROOM9_SOURCE_RECEIPT_SCHEMA,
  verifyGrandHallRoom9EvidenceAgainstReceipt,
  type GrandHallRoom9ReceiptInputs,
} from "../grand-hall-room9-source-receipt.js";

const SYNTHETIC_ROOM_OBJ = `
v 0 0 0
v 2 0 0
v 0 2 0
v 2 2 0
v 3 1 0
v -1 1 0
g chunk000_group001_sub009
usemtl room9
f 1 2 3
f 2 4 3
g chunk001_group001_sub011
usemtl room11
f 2 5 4
g chunk002_group001_sub014
usemtl room14
f 1 3 6
`;

function assertJsonValue(value: unknown, path = "$evidence"): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertJsonValue(entry, `${path}[${String(index)}]`);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} is not canonical JSON material`);
}

function jsonStrings(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const array = value as readonly JsonValue[];
    return array.flatMap(jsonStrings);
  }
  return Object.values(value).flatMap(jsonStrings);
}

function digestFields(value: JsonValue, path = "$evidence"): readonly [string, string][] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const array = value as readonly JsonValue[];
    return array.flatMap((entry, index) => digestFields(entry, `${path}[${String(index)}]`));
  }
  const fields: [string, string][] = [];
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key.toLowerCase().includes("sha256") && typeof entry === "string") {
      fields.push([childPath, entry]);
    }
    fields.push(...digestFields(entry, childPath));
  }
  return fields;
}

function requireJsonRecord(
  value: JsonValue,
  label: string,
): { readonly [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as { readonly [key: string]: JsonValue };
}

describe("MatterPak room-face selection", () => {
  it("selects only the exact room key and reports source topology", () => {
    const model = parseMatterportObjText(SYNTHETIC_ROOM_OBJ);
    const summary = summarizeMatterportRoomSelection(model, GRAND_HALL_ROOM_9);
    expect(summary).toEqual({
      groupIndex: 1,
      subIndex: 9,
      groupNames: ["chunk000_group001_sub009"],
      groupCount: 1,
      faceCount: 2,
      uniqueVertexCount: 4,
      materialNames: ["room9"],
      materialCount: 1,
      connectedComponentCount: 1,
      sourceSharedVertexCount: 4,
      bounds: { min: [0, 0, 0], max: [2, 2, 0] },
    });
  });

  it("reports source-shared interface bounds without inventing a closure plane", () => {
    const model = parseMatterportObjText(SYNTHETIC_ROOM_OBJ);
    expect(
      summarizeSharedVertexInterface(
        model,
        GRAND_HALL_ROOM_9,
        { groupIndex: 1, subIndex: 11 },
      ),
    ).toEqual({
      roomA: GRAND_HALL_ROOM_9,
      roomB: { groupIndex: 1, subIndex: 11 },
      sharedVertexCount: 2,
      bounds: { min: [2, 0, 0], max: [2, 2, 0] },
    });
  });

  it("supports negative OBJ indices but rejects ambiguous or invalid geometry", () => {
    const negativeIndexModel = parseMatterportObjText(`
v 0 0 0
v 1 0 0
v 0 1 0
g chunk000_group001_sub009
f -3 -2 -1
`);
    expect(negativeIndexModel.triangles[0]?.vertexIndices).toEqual([0, 1, 2]);

    expect(() =>
      parseMatterportObjText(`v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\ng room9\nf 1 2 3 4`),
    ).toThrow(/recognized MatterPak room group/u);
    expect(() =>
      parseMatterportObjText(
        `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\ng chunk000_group001_sub009\nf 1 2 3 4`,
      ),
    ).toThrow(/must be triangular/u);
    expect(() =>
      parseMatterportObjText(
        `v 0 0 0\nv 1 0 0\nv 0 1 0\ng chunk000_group001_sub009\nf 0 2 3`,
      ),
    ).toThrow(/index zero/u);
    expect(() =>
      parseMatterportObjText(
        `v 0 0 0\nv 1 0 0\nv 0 1 0\ng chunk000_group001_sub009\nf 1 2 4`,
      ),
    ).toThrow(/outside 3 vertices/u);
    expect(() =>
      parseMatterportObjText(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3`),
    ).toThrow(/before a recognized MatterPak group/u);
  });
});

describe("vertical first-hit camera classification", () => {
  it("chooses the nearest downward source face", () => {
    const model = parseMatterportObjText(`
v 0 0 0
v 2 0 0
v 0 2 0
v 0 0 1
v 2 0 1
v 0 2 1
g chunk000_group001_sub009
usemtl lower
f 1 2 3
g chunk001_group001_sub011
usemtl upper
f 4 5 6
`);
    const classification = classifyVerticalFirstHits(model, [
      { index: 7, translation: [0.25, 0.25, 2] },
    ]);
    expect(classification.method.direction).toEqual([0, 0, -1]);
    expect(classification.method.tieBreak).toBe("source-face-order");
    expect(classification.results).toEqual([
      {
        state: "hit",
        cameraIndex: 7,
        cameraTranslation: [0.25, 0.25, 2],
        distance: 1,
        hitPoint: [0.25, 0.25, 1],
        group: { name: "chunk001_group001_sub011", groupIndex: 1, subIndex: 11 },
        material: "upper",
        sourceFaceOrdinal: 1,
      },
    ]);
  });

  it("ignores XY-degenerate faces and reports no-hit explicitly", () => {
    const model = parseMatterportObjText(`
v 0 0 0
v 0 1 0
v 0 0 1
g chunk000_group001_sub009
f 1 2 3
`);
    expect(
      classifyVerticalFirstHits(model, [{ index: 3, translation: [0, 0.25, 2] }]).results,
    ).toEqual([
      { state: "no-hit", cameraIndex: 3, cameraTranslation: [0, 0.25, 2] },
    ]);
  });

  it("breaks equal-distance ties by source face order", () => {
    const model = parseMatterportObjText(`
v 0 0 0
v 2 0 0
v 0 2 0
g chunk000_group001_sub009
usemtl first
f 1 2 3
g chunk001_group001_sub011
usemtl second
f 1 2 3
`);
    const result = classifyVerticalFirstHits(model, [
      { index: 0, translation: [0.25, 0.25, 2] },
    ]).results[0];
    expect(result?.state).toBe("hit");
    if (result?.state !== "hit") throw new Error("expected a source-mesh hit");
    expect(result.sourceFaceOrdinal).toBe(0);
    expect(result.material).toBe("first");
  });
});

describe("hash-bound room-9 evidence", () => {
  it("is canonical and binds the exact read-only inputs and non-authoritative scope", () => {
    const evidenceUrl = new URL(
      "../../../../docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
      import.meta.url,
    );
    const parsed: unknown = JSON.parse(readFileSync(evidenceUrl, "utf8"));
    assertJsonValue(parsed);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("expected an evidence object");
    }
    const evidence = parsed as { readonly [key: string]: JsonValue };
    const evidenceSha256 = evidence.evidenceSha256;
    const material: { [key: string]: JsonValue } = { ...evidence };
    delete material.evidenceSha256;
    assertJsonValue(material);
    expect(evidenceSha256).toBe(computeGrandHallRoom9EvidenceSha256(material));
    expect(stableCanonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');

    const sourceBindings = evidence.sourceBindings;
    const authority = evidence.authority;
    const selection = evidence.room9FaceSelection;
    const interfaces = evidence.portalInterfaceCandidates;
    expect(sourceBindings).toMatchObject({
      obj: {
        sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj",
        sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      },
      mtl: {
        sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.mtl",
        sha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
      },
      colorPlan: {
        sourceLocator: "MATTERPAK_SOURCE_ROOT/colorplan_001.jpg",
        sha256: "sha256:95ea727b1c6426158f954a9f6f6c00fb60e838203f83a39b901ddb25f9417212",
      },
      e57: {
        sourceLocator: "E57_SOURCE_ROOT/cloud_0.e57",
        sha256: "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
      },
    });
    expect(selection).toMatchObject({ groupCount: 43, faceCount: 119564 });
    expect(interfaces).toHaveLength(2);
    expect(authority).toMatchObject({
      state: "none",
      runtimeAuthority: false,
      trainingAuthority: false,
      closedVolumeClaim: false,
      humanReview: { state: "pending" },
    });

    expect(evidence.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(evidence.generation).toMatchObject({
      sourceReceiptSha256:
        "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b",
      sourceReceiptSchemaVersion: GRAND_HALL_ROOM9_SOURCE_RECEIPT_SCHEMA,
      poseExtractorRef: "tools/twin-forge/e57-scripts/extract_e57_poses.py",
      stageGuardRef: "tools/twin-forge/e57-scripts/e57_stage_guard.py",
      reproducibility: {
        sourceDerivedProjectionDeterministicallyReproducible: true,
        fullArtifactByteForByteRegenerationClaimed: false,
      },
    });
    expect(evidence.e57PoseInventory).toMatchObject({
      sourceHashVerifiedThisRun: true,
      extractorName: "pye57",
      extractorVersion: "0.4.19",
      scanCount: 149,
      embeddedPinholeImageCount: 894,
      poseSha256:
        "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3",
    });
    expect(evidence.e57SameRunVerification).toEqual({
      byteLength: 20518437888,
      sha256: "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
      rootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
      fullByteHashVerifiedAgainstStageManifest: true,
      stableFileIdentityBeforeAndAfter: true,
    });
    expect(evidence.coordinateCrosswalk).toEqual({
      e57RootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
      matterpakObjStemGuid: "424ff41f6e5d41969c635fcd61be9b3f",
      exactGuidMatch: true,
      identityTransformUsedForClassifier: true,
      classificationFrameAuthority: "diagnostic-only",
      reviewedTransformArtifactPresent: false,
      runtimeOverlayAuthority: false,
    });

    for (const value of jsonStrings(evidence)) {
      expect(value).not.toMatch(/[A-Za-z]:[\\/]/u);
      expect(value).not.toMatch(/(?:^|[\\/])Users[\\/]/iu);
      expect(value).not.toMatch(/file:\/\//iu);
      expect(value.toLowerCase()).not.toContain("blake");
    }
    for (const [path, digest] of digestFields(evidence)) {
      expect(digest, path).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });
});

describe("deterministic path-redacted source receipt", () => {
  const digest = (character: string): `sha256:${string}` =>
    `sha256:${character.repeat(64)}`;

  function inputs(): GrandHallRoom9ReceiptInputs {
    return {
      sources: {
        obj: {
          sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj",
          byteLength: 1,
          sha256: digest("1"),
        },
        mtl: {
          sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.mtl",
          byteLength: 1,
          sha256: digest("2"),
        },
        colorPlan: {
          sourceLocator: "MATTERPAK_SOURCE_ROOT/colorplan_001.jpg",
          byteLength: 1,
          sha256: digest("3"),
          pixelWidth: 10,
          pixelHeight: 10,
        },
        readme: {
          sourceLocator: "MATTERPAK_SOURCE_ROOT/readme.pdf",
          byteLength: 1,
          sha256: digest("4"),
        },
        e57: {
          sourceLocator: "E57_SOURCE_ROOT/cloud_0.e57",
          byteLength: 1,
          sha256: digest("5"),
        },
      },
      objText: SYNTHETIC_ROOM_OBJ,
      cameras: Array.from({ length: 50 }, (_, index) => ({
        index,
        translation: [0.25, 0.25, 2] as const,
      })),
      e57PoseInventory: {
        schemaVersion: "venviewer.e57-poses.v1",
        captureStagePlanSha256: digest("6"),
        captureStageManifestSha256: digest("7"),
        sourceHashVerifiedThisRun: true,
        extractorName: "pye57",
        extractorVersion: "0.4.19",
        coordinateConvention: "test E57 frame",
        scanCount: 50,
        poseSha256: digest("8"),
        posesJsonFileSha256: digest("9"),
        data3DGuidSha256: digest("a"),
        embeddedPinholeImageCount: 1,
        imageProbeSchemaVersion: "venviewer.e57-image2d-probe.v1",
      },
      e57SameRunVerification: {
        byteLength: 1,
        sha256: digest("5"),
        rootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
        fullByteHashVerifiedAgainstStageManifest: true,
        stableFileIdentityBeforeAndAfter: true,
      },
      coordinateCrosswalk: {
        e57RootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
        matterpakObjStemGuid: "424ff41f6e5d41969c635fcd61be9b3f",
        exactGuidMatch: true,
        identityTransformUsedForClassifier: true,
        classificationFrameAuthority: "diagnostic-only",
        reviewedTransformArtifactPresent: false,
        runtimeOverlayAuthority: false,
      },
    };
  }

  it("emits a stable receipt without invocation paths", () => {
    const first = createGrandHallRoom9SourceReceipt(inputs());
    const second = createGrandHallRoom9SourceReceipt(inputs());
    expect(first.receiptSha256).toBe(second.receiptSha256);
    expect(first.document).toMatchObject({
      schemaVersion: GRAND_HALL_ROOM9_SOURCE_RECEIPT_SCHEMA,
      coordinateCrosswalk: {
        exactGuidMatch: true,
        reviewedTransformArtifactPresent: false,
        runtimeOverlayAuthority: false,
      },
    });
    for (const value of jsonStrings(first.document)) {
      expect(value).not.toMatch(/[A-Za-z]:[\\/]/u);
      expect(value.toLowerCase()).not.toContain("blake");
    }
    expect(GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE).not.toMatch(/[A-Za-z]:[\\/]/u);
    expect(GRAND_HALL_ROOM9_SOURCE_RECEIPT_FATAL_MESSAGE.toLowerCase()).not.toContain("path");
  });

  it("rejects absolute locators and a missing E57-to-OBJ identity crosswalk", () => {
    const unsafe = inputs();
    expect(() =>
      createGrandHallRoom9SourceReceipt({
        ...unsafe,
        sources: {
          ...unsafe.sources,
          obj: { ...unsafe.sources.obj, sourceLocator: "Q:\\synthetic\\hall.obj" },
        },
      }),
    ).toThrow(/unsafe stable source locator/u);

    expect(() =>
      createGrandHallRoom9SourceReceipt({
        ...unsafe,
        coordinateCrosswalk: {
          ...unsafe.coordinateCrosswalk,
          e57RootGuid: "00000000000000000000000000000000",
        },
      }),
    ).toThrow(/root GUID and MatterPak OBJ stem do not match/u);
  });

  it("verifies the persisted projection and fails closed on source-fact drift", () => {
    const receipt = createGrandHallRoom9SourceReceipt(inputs());
    const material = requireJsonRecord(receipt.material, "receipt material");
    const receiptBindings = requireJsonRecord(material.sourceBindings ?? null, "source bindings");
    const classification = requireJsonRecord(
      material.cameraClassification ?? null,
      "camera classification",
    );
    const artifactMaterial: JsonValue = {
      generation: { sourceReceiptSha256: receipt.receiptSha256 },
      sourceBindings: {
        obj: receiptBindings.obj ?? null,
        mtl: receiptBindings.mtl ?? null,
        colorPlan: receiptBindings.colorPlan ?? null,
        matterpakReadme: receiptBindings.readme ?? null,
        e57: receiptBindings.e57 ?? null,
      },
      e57PoseInventory: material.e57PoseInventory ?? null,
      e57SameRunVerification: material.e57SameRunVerification ?? null,
      coordinateCrosswalk: material.coordinateCrosswalk ?? null,
      objInventory: material.objInventory ?? null,
      room9FaceSelection: material.room9FaceSelection ?? null,
      verticalFirstHitClassification: {
        method: classification.method ?? null,
        classifiedCameraSet: {
          scanCount: classification.scanCount ?? null,
          scanIndexMinimum: classification.scanIndexMinimum ?? null,
          scanIndexMaximum: classification.scanIndexMaximum ?? null,
          grandHallRoom9ScanIndices: classification.grandHallRoom9ScanIndices ?? null,
          nonGrandHallScanIndices: classification.nonGrandHallScanIndices ?? null,
          noHitScanIndices: classification.noHitScanIndices ?? null,
        },
        contiguousHitRanges: classification.contiguousHitRanges ?? null,
        first50BoundaryChecks: classification.first50BoundaryChecks ?? null,
      },
      portalInterfaceCandidates: material.portalInterfaceCandidates ?? null,
    };
    const artifact: JsonValue = {
      ...requireJsonRecord(artifactMaterial, "artifact material"),
      evidenceSha256: computeGrandHallRoom9EvidenceSha256(artifactMaterial),
    };
    expect(() => {
      verifyGrandHallRoom9EvidenceAgainstReceipt(artifact, receipt);
    }).not.toThrow();

    const artifactRecord = requireJsonRecord(artifact, "artifact");
    const badSelfDigest: JsonValue = {
      ...artifactRecord,
      evidenceSha256: `sha256:${"0".repeat(64)}`,
    };
    expect(() => {
      verifyGrandHallRoom9EvidenceAgainstReceipt(badSelfDigest, receipt);
    }).toThrow(/canonical self-digest/u);

    const selection = requireJsonRecord(
      artifactRecord.room9FaceSelection ?? null,
      "room selection",
    );
    const driftedMaterial: JsonValue = {
      ...artifactRecord,
      room9FaceSelection: { ...selection, faceCount: 3 },
    };
    const driftedMaterialRecord = requireJsonRecord(driftedMaterial, "drifted material");
    const withoutOldDigest: { [key: string]: JsonValue } = { ...driftedMaterialRecord };
    delete withoutOldDigest.evidenceSha256;
    const drifted: JsonValue = {
      ...withoutOldDigest,
      evidenceSha256: computeGrandHallRoom9EvidenceSha256(withoutOldDigest),
    };
    expect(() => {
      verifyGrandHallRoom9EvidenceAgainstReceipt(drifted, receipt);
    }).toThrow(/room9FaceSelection\.faceCount/u);
  });
});
