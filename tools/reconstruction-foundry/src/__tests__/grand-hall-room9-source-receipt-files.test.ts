import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { JsonValue } from "../grand-hall-room9-boundary.js";
import {
  computePythonCanonicalPoseSha256,
  createGrandHallRoom9SourceReceiptFromFiles,
  type GrandHallRoom9SourceReceiptFileOptions,
} from "../grand-hall-room9-source-receipt.js";

const MATTERPAK_GUID = "424ff41f6e5d41969c635fcd61be9b3f";
const OBJ_FILENAME = `${MATTERPAK_GUID}.obj`;
const MTL_FILENAME = `${MATTERPAK_GUID}.mtl`;

const SYNTHETIC_OBJ = `
v 0 0 0
v 2 0 0
v 0 2 0
g chunk000_group001_sub009
usemtl room9
f 1 2 3
`;

interface FileFixture {
  readonly root: string;
  readonly stageRoot: string;
  readonly poseRoot: string;
  readonly imageProbePath: string;
  readonly e57Path: string;
  readonly posesPath: string;
  readonly poseEvidencePath: string;
  readonly options: GrandHallRoom9SourceReceiptFileOptions;
}

const cleanupRoots: string[] = [];

afterEach(() => {
  const temporaryRoot = realpathSync(tmpdir());
  for (const root of cleanupRoots.splice(0)) {
    const fromTemporary = relative(temporaryRoot, root);
    if (
      fromTemporary.startsWith("..") ||
      !basename(root).startsWith("grand-hall-room9-receipt-")
    ) {
      throw new Error("refusing to clean an unexpected fixture root");
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(path: string, value: unknown): Uint8Array {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  writeFileSync(path, bytes);
  return bytes;
}

function tinyJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function tinyE57(rootGuid: string): Uint8Array {
  const xml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<e57Root type="Structure"><formatName type="String">ASTM E57</formatName>` +
      `<guid type="String"><![CDATA[${rootGuid}]]></guid>` +
      `<data3D type="Vector"></data3D><images2D type="Vector"></images2D></e57Root>`,
    "utf8",
  );
  const bytes = Buffer.alloc(2048);
  bytes.write("ASTM-E57", 0, "ascii");
  bytes.writeUInt32LE(1, 8);
  bytes.writeUInt32LE(0, 12);
  bytes.writeBigUInt64LE(BigInt(bytes.byteLength), 16);
  bytes.writeBigUInt64LE(48n, 24);
  bytes.writeBigUInt64LE(BigInt(xml.byteLength), 32);
  bytes.writeBigUInt64LE(1024n, 40);
  let physicalOffset = 48;
  for (const byte of xml) {
    if (physicalOffset % 1024 >= 1020) {
      physicalOffset = (Math.floor(physicalOffset / 1024) + 1) * 1024;
    }
    bytes[physicalOffset] = byte;
    physicalOffset += 1;
  }
  return bytes;
}

function jsonRecord(value: JsonValue, label: string): { readonly [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as { readonly [key: string]: JsonValue };
}

function createFixture(rootGuid = MATTERPAK_GUID): FileFixture {
  const root = mkdtempSync(join(tmpdir(), "grand-hall-room9-receipt-"));
  cleanupRoots.push(root);
  const stageRoot = join(root, "stage");
  const matterpakRoot = join(stageRoot, "source", "matterpak");
  const e57Root = join(stageRoot, "source", "e57");
  const poseRoot = join(root, "poses");
  const probeRoot = join(root, "probe");
  mkdirSync(matterpakRoot, { recursive: true });
  mkdirSync(e57Root, { recursive: true });
  mkdirSync(poseRoot, { recursive: true });
  mkdirSync(probeRoot, { recursive: true });

  const files = [
    {
      targetRelativePath: `source/matterpak/${OBJ_FILENAME}`,
      bytes: Buffer.from(SYNTHETIC_OBJ, "utf8"),
    },
    {
      targetRelativePath: `source/matterpak/${MTL_FILENAME}`,
      bytes: Buffer.from("newmtl room9\n", "utf8"),
    },
    {
      targetRelativePath: "source/matterpak/colorplan_001.jpg",
      bytes: tinyJpeg(10, 10),
    },
    {
      targetRelativePath: "source/matterpak/readme.pdf",
      bytes: Buffer.from("%PDF-1.4\n%%EOF\n", "utf8"),
    },
    {
      targetRelativePath: "source/e57/cloud_0.e57",
      bytes: tinyE57(rootGuid),
    },
  ] as const;
  for (const file of files) {
    writeFileSync(join(stageRoot, ...file.targetRelativePath.split("/")), file.bytes);
  }
  const planSha256 = "1".repeat(64);
  const stageManifest = {
    schemaVersion: "venviewer.capture-stage.v1",
    planSha256,
    files: files.map((file) => ({
      targetRelativePath: file.targetRelativePath,
      sizeBytes: file.bytes.byteLength,
      sha256: sha256Hex(file.bytes),
    })),
  };
  const stageManifestBytes = writeJson(
    join(stageRoot, "capture-stage-manifest.json"),
    stageManifest,
  );
  const e57 = files.at(-1);
  if (e57 === undefined) throw new Error("fixture E57 missing");

  const poses: Record<
    string,
    { readonly rotation: readonly number[]; readonly translation: readonly number[] }
  > = {};
  for (let index = 0; index < 50; index += 1) {
    poses[String(index)] = { rotation: [1, 0, 0, 0], translation: [0.25, 0.25, 2] };
  }
  const posesPath = join(poseRoot, "poses.json");
  writeJson(posesPath, poses);
  const canonicalPoseSha256 = computePythonCanonicalPoseSha256(poses).slice("sha256:".length);
  const poseEvidencePath = join(poseRoot, "pose-evidence.json");
  writeJson(poseEvidencePath, {
    schemaVersion: "venviewer.e57-poses.v1",
    captureStage: {
      planSha256,
      manifestSha256: sha256Hex(stageManifestBytes),
    },
    sourceE57: {
      targetRelativePath: e57.targetRelativePath,
      sizeBytes: e57.bytes.byteLength,
      sha256: sha256Hex(e57.bytes),
      hashVerifiedThisRun: true,
    },
    extractor: { name: "pye57", version: "0.4.19" },
    coordinateConvention:
      "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
    scanCount: 50,
    poseSha256: canonicalPoseSha256,
    data3DGuidSha256: "2".repeat(64),
  });
  const imageProbePath = join(probeRoot, "probe-evidence.json");
  writeJson(imageProbePath, {
    schemaVersion: "venviewer.e57-image2d-probe.v1",
    captureStagePlanSha256: planSha256,
    sourceE57Sha256: sha256Hex(e57.bytes),
    imageCount: 6,
    representation: "pinholeRepresentation",
  });
  const e57Path = join(e57Root, "cloud_0.e57");
  return {
    root,
    stageRoot,
    poseRoot,
    imageProbePath,
    e57Path,
    posesPath,
    poseEvidencePath,
    options: {
      captureStageRoot: stageRoot,
      poseEvidenceRoot: poseRoot,
      imageProbeEvidencePath: imageProbePath,
    },
  };
}

describe("file-backed Grand Hall room-9 source receipt", () => {
  it("matches a fixed Python json.dumps canonical pose digest across float formats", () => {
    const representativePoses = {
      "0": {
        rotation: [0.0, -0.0, 1.0, 1e-4],
        translation: [1e-5, 1e15, 1e16],
      },
      "1": {
        rotation: [
          0.7071067811865476,
          -0.7071067811865476,
          0.12345678901234568,
          -2.425,
        ],
        translation: [-11.334001, 1.553, 9.05],
      },
    };

    // Generated once with the extractor guard's Python 3 json.dumps(value,
    // ensure_ascii=False, allow_nan=False, separators=(",", ":"),
    // sort_keys=True), followed by hashlib.sha256. Python is not a test
    // dependency; this fixed value independently guards repr semantics.
    expect(computePythonCanonicalPoseSha256(representativePoses)).toBe(
      "sha256:67ad898d44158d72b6ce42af3e7b2664f4a6f023bebf8deb6405c0536d1e7854",
    );
  });

  it("binds the stage, E57 GUID/hash, Python pose digest, and image probe", () => {
    const fixture = createFixture();
    const receipt = createGrandHallRoom9SourceReceiptFromFiles(fixture.options);
    const document = jsonRecord(receipt.document, "receipt");
    expect(document.coordinateCrosswalk).toMatchObject({
      e57RootGuid: MATTERPAK_GUID,
      matterpakObjStemGuid: MATTERPAK_GUID,
      exactGuidMatch: true,
      reviewedTransformArtifactPresent: false,
    });
    expect(document.e57SameRunVerification).toMatchObject({
      byteLength: 2048,
      sha256: `sha256:${sha256Hex(readFileSync(fixture.e57Path))}`,
      rootGuid: MATTERPAK_GUID,
      fullByteHashVerifiedAgainstStageManifest: true,
      stableFileIdentityBeforeAndAfter: true,
    });
    expect(document.e57PoseInventory).toMatchObject({
      scanCount: 50,
      embeddedPinholeImageCount: 6,
      sourceHashVerifiedThisRun: true,
    });
  });

  it("rejects same-size staged E57 drift before the run", () => {
    const fixture = createFixture();
    const mutated = readFileSync(fixture.e57Path);
    mutated[mutated.length - 1] = (mutated[mutated.length - 1] ?? 0) ^ 0xff;
    writeFileSync(fixture.e57Path, mutated);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /E57 SHA-256 differs/u,
    );
  });

  it("rejects a wrong E57 hash before parsing an absurd XML allocation claim", () => {
    const fixture = createFixture();
    const mutated = readFileSync(fixture.e57Path);
    mutated.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER), 32);
    writeFileSync(fixture.e57Path, mutated);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /E57 SHA-256 differs/u,
    );
  });

  it("rejects same-size staged E57 mutation between hashing and XML acceptance", () => {
    const fixture = createFixture();
    expect(() =>
      createGrandHallRoom9SourceReceiptFromFiles({
        ...fixture.options,
        e57InspectionTestSeam: {
          afterHashBeforeXmlRead: () => {
            const mutated = readFileSync(fixture.e57Path);
            mutated[mutated.length - 1] = (mutated[mutated.length - 1] ?? 0) ^ 0xff;
            writeFileSync(fixture.e57Path, mutated);
          },
        },
      }),
    ).toThrow(/changed during same-run/u);
  });

  it("bounds a hostile XML length introduced after the E57 hash", () => {
    const fixture = createFixture();
    expect(() =>
      createGrandHallRoom9SourceReceiptFromFiles({
        ...fixture.options,
        e57InspectionTestSeam: {
          afterHashBeforeXmlRead: () => {
            const mutated = readFileSync(fixture.e57Path);
            mutated.writeBigUInt64LE(128n * 1024n * 1024n, 32);
            writeFileSync(fixture.e57Path, mutated);
          },
        },
      }),
    ).toThrow(/unsupported or inconsistent XML header layout/u);
  });

  it("rejects a pose mutation not reflected in the Python canonical pose digest", () => {
    const fixture = createFixture();
    const poses: unknown = JSON.parse(readFileSync(fixture.posesPath, "utf8"));
    if (poses === null || Array.isArray(poses) || typeof poses !== "object") {
      throw new Error("fixture poses must be an object");
    }
    const record = poses as Record<string, { rotation: number[]; translation: number[] }>;
    const pose49 = record["49"];
    if (pose49 === undefined) throw new Error("fixture pose 49 missing");
    pose49.translation[0] = 0.5;
    writeJson(fixture.posesPath, record);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /canonical SHA-256 differs/u,
    );
  });

  it("rejects pose-stage and image-probe binding drift", () => {
    const poseFixture = createFixture();
    const poseEvidence: unknown = JSON.parse(readFileSync(poseFixture.poseEvidencePath, "utf8"));
    if (poseEvidence === null || Array.isArray(poseEvidence) || typeof poseEvidence !== "object") {
      throw new Error("fixture pose evidence must be an object");
    }
    const poseRecord = poseEvidence as {
      captureStage: { manifestSha256: string };
    };
    poseRecord.captureStage.manifestSha256 = "f".repeat(64);
    writeJson(poseFixture.poseEvidencePath, poseRecord);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(poseFixture.options)).toThrow(
      /does not bind the supplied capture-stage manifest/u,
    );

    const probeFixture = createFixture();
    const imageProbe: unknown = JSON.parse(readFileSync(probeFixture.imageProbePath, "utf8"));
    if (imageProbe === null || Array.isArray(imageProbe) || typeof imageProbe !== "object") {
      throw new Error("fixture image probe must be an object");
    }
    const probeRecord = imageProbe as { sourceE57Sha256: string };
    probeRecord.sourceE57Sha256 = "e".repeat(64);
    writeJson(probeFixture.imageProbePath, probeRecord);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(probeFixture.options)).toThrow(
      /image probe does not bind the same staged E57/u,
    );
  });

  it("binds the exact capture-stage manifest bytes used by pose extraction", () => {
    const fixture = createFixture();
    const manifestPath = join(fixture.stageRoot, "capture-stage-manifest.json");
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest === null || Array.isArray(manifest) || typeof manifest !== "object") {
      throw new Error("fixture capture-stage manifest must be an object");
    }
    writeJson(manifestPath, { ...manifest, sameFilesDifferentManifestBytes: true });
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /does not bind the supplied capture-stage manifest/u,
    );
  });

  it("rejects a pose/probe plan digest that does not match the stage manifest", () => {
    const fixture = createFixture();
    const poseEvidence: unknown = JSON.parse(readFileSync(fixture.poseEvidencePath, "utf8"));
    const imageProbe: unknown = JSON.parse(readFileSync(fixture.imageProbePath, "utf8"));
    if (
      poseEvidence === null ||
      Array.isArray(poseEvidence) ||
      typeof poseEvidence !== "object" ||
      imageProbe === null ||
      Array.isArray(imageProbe) ||
      typeof imageProbe !== "object"
    ) {
      throw new Error("fixture pose/probe evidence must be objects");
    }
    const wrongPlanSha256 = "f".repeat(64);
    const poseRecord = poseEvidence as { captureStage: { planSha256: string } };
    const probeRecord = imageProbe as { captureStagePlanSha256: string };
    poseRecord.captureStage.planSha256 = wrongPlanSha256;
    probeRecord.captureStagePlanSha256 = wrongPlanSha256;
    writeJson(fixture.poseEvidencePath, poseRecord);
    writeJson(fixture.imageProbePath, probeRecord);
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /does not bind the capture-stage plan/u,
    );
  });

  it("extracts the staged E57 root GUID and rejects a nonmatching OBJ crosswalk", () => {
    const fixture = createFixture("00000000000000000000000000000000");
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /root GUID does not match the MatterPak OBJ stem/u,
    );
  });

  it("rejects a staged source tree that resolves through an escaping link", () => {
    const fixture = createFixture();
    const sourceRoot = join(fixture.stageRoot, "source");
    const outsideSourceRoot = join(fixture.root, "outside-source");
    renameSync(sourceRoot, outsideSourceRoot);
    symlinkSync(outsideSourceRoot, sourceRoot, process.platform === "win32" ? "junction" : "dir");
    expect(() => createGrandHallRoom9SourceReceiptFromFiles(fixture.options)).toThrow(
      /traverses a symbolic link/u,
    );
  });

  it("rejects a linked capture-stage trust root", () => {
    const fixture = createFixture();
    const linkedStageRoot = join(fixture.root, "linked-stage-root");
    symlinkSync(
      fixture.stageRoot,
      linkedStageRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      createGrandHallRoom9SourceReceiptFromFiles({
        ...fixture.options,
        captureStageRoot: linkedStageRoot,
      }),
    ).toThrow(/source root cannot be a symbolic link/u);
  });

});
