import { describe, expect, it } from "vitest";
import { sha256Hex } from "../canonical-layout-snapshot.js";
import {
  VENREPLAY_MANIFEST_FILE_PATH,
  VENREPLAY_REQUIRED_PAYLOAD_FILE_PATHS,
} from "../venreplay-artifact.js";
import {
  VENREPLAY_SYNTHETIC_ARTIFACT_FILES,
  VENREPLAY_SYNTHETIC_FIXTURE,
  VENREPLAY_SYNTHETIC_FIXTURE_FILE_NAME,
  VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT,
  VENREPLAY_SYNTHETIC_FIXTURE_ID,
  VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES,
  VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MDATE_DOS,
  VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MTIME_DOS,
  VENREPLAY_SYNTHETIC_FIXTURE_ZIP_SHA256,
  VENREPLAY_SYNTHETIC_LOGICAL_ARTIFACT_DIGEST,
  VENREPLAY_SYNTHETIC_MANIFEST,
  VENREPLAY_SYNTHETIC_MANIFEST_FILE_BYTE_SIZE,
  VENREPLAY_SYNTHETIC_MANIFEST_FILE_SHA256,
  VENREPLAY_SYNTHETIC_PAYLOAD_FILES,
  VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE,
} from "../venreplay-fixture.js";
import { validateVenreplayArtifact } from "../venreplay-validator.js";

interface StoredZipEntry {
  readonly path: string;
  readonly content: string;
  readonly compressionMethod: number;
  readonly modifiedTime: number;
  readonly modifiedDate: number;
}

describe("Venreplay synthetic fixture", () => {
  it("exports a clearly synthetic internal replay artifact", () => {
    expect(VENREPLAY_SYNTHETIC_FIXTURE.fixtureId).toBe(VENREPLAY_SYNTHETIC_FIXTURE_ID);
    expect(VENREPLAY_SYNTHETIC_FIXTURE.fileName).toBe(
      VENREPLAY_SYNTHETIC_FIXTURE_FILE_NAME,
    );
    expect(VENREPLAY_SYNTHETIC_FIXTURE.generatedAt).toBe(
      VENREPLAY_SYNTHETIC_FIXTURE_GENERATED_AT,
    );
    expect(VENREPLAY_SYNTHETIC_FIXTURE_FILE_NAME.endsWith(".venreplay.zip")).toBe(true);
    expect(VENREPLAY_SYNTHETIC_SCENARIO_INSTANCE.instanceId).toContain("synthetic");
    expect(VENREPLAY_SYNTHETIC_MANIFEST.exposureTier).toBe("internal_only");
    expect(VENREPLAY_SYNTHETIC_MANIFEST.manifestExtension).toEqual({
      fixtureId: VENREPLAY_SYNTHETIC_FIXTURE_ID,
      fixtureKind: "synthetic_internal",
      intendedUse: "unit_tests_and_browser_loader_development",
    });
  });

  it("contains the minimum replay files with three agents and short trajectories", () => {
    expect(VENREPLAY_SYNTHETIC_ARTIFACT_FILES.map((file) => file.path).sort()).toEqual([
      "agents.csv",
      "bottlenecks.geojson",
      "geometry.geojson",
      "manifest.json",
      "metrics.json",
      "scenario.json",
      "trajectory.csv",
      "witness.json",
    ]);
    expect(VENREPLAY_SYNTHETIC_PAYLOAD_FILES.map((file) => file.path).sort()).toEqual(
      [...VENREPLAY_REQUIRED_PAYLOAD_FILE_PATHS].sort(),
    );

    const agents = stringContent("agents.csv").trim().split("\n");
    const trajectory = stringContent("trajectory.csv").trim().split("\n");
    expect(agents).toHaveLength(4);
    expect(trajectory).toHaveLength(10);
    expect(agents.slice(1).map((line) => line.split(",")[0])).toEqual([
      "agent_001",
      "agent_002",
      "agent_003",
    ]);
  });

  it("validates through the shared artifact validator", () => {
    const result = validateVenreplayArtifact(VENREPLAY_SYNTHETIC_ARTIFACT_FILES);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.artifactId).toBe(VENREPLAY_SYNTHETIC_FIXTURE_ID);
    expect(result.manifestFileSha256).toBe(VENREPLAY_SYNTHETIC_MANIFEST_FILE_SHA256);
    expect(result.manifestFileByteSize).toBe(VENREPLAY_SYNTHETIC_MANIFEST_FILE_BYTE_SIZE);
    expect(result.logicalArtifactDigest).toBe(VENREPLAY_SYNTHETIC_LOGICAL_ARTIFACT_DIGEST);
  });

  it("keeps manifest self-hash out of payload file hashes", () => {
    expect(VENREPLAY_SYNTHETIC_MANIFEST.fileHashes.map((fileHash) => fileHash.path))
      .not.toContain(VENREPLAY_MANIFEST_FILE_PATH);
    expect(VENREPLAY_SYNTHETIC_MANIFEST.fileHashes.map((fileHash) => fileHash.path).sort())
      .toEqual([...VENREPLAY_REQUIRED_PAYLOAD_FILE_PATHS].sort());
  });

  it("emits deterministic stored zip bytes for browser-loader development", () => {
    const zipEntries = readStoredZipLocalEntries(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES);
    const manifestEntry = zipEntries.find((entry) => entry.path === "manifest.json");

    expect(Array.from(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES.slice(0, 4))).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    expect(readUint32LE(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES, zipEndOffset())).toBe(
      0x06054b50,
    );
    expect(readUint16LE(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES, zipEndOffset() + 8)).toBe(
      VENREPLAY_SYNTHETIC_ARTIFACT_FILES.length,
    );
    expect(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_SHA256).toBe(
      sha256Hex(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES),
    );
    expect(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES.byteLength).toBe(13575);
    expect(VENREPLAY_SYNTHETIC_FIXTURE_ZIP_SHA256).toBe(
      "b0e5e60cc82de6b67bb69cf58be854766563bb01641981b1ab347041121974eb",
    );
    expect(zipEntries.map((entry) => entry.path)).toEqual([
      "agents.csv",
      "bottlenecks.geojson",
      "geometry.geojson",
      "manifest.json",
      "metrics.json",
      "scenario.json",
      "trajectory.csv",
      "witness.json",
    ]);
    expect(zipEntries.every((entry) => entry.compressionMethod === 0)).toBe(true);
    expect(zipEntries.every((entry) => entry.modifiedTime === VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MTIME_DOS))
      .toBe(true);
    expect(zipEntries.every((entry) => entry.modifiedDate === VENREPLAY_SYNTHETIC_FIXTURE_ZIP_MDATE_DOS))
      .toBe(true);
    expect(manifestEntry?.content).toBe(stringContent("manifest.json"));
  });

  it("contains no unsupported public-claim wording", () => {
    const combinedText = VENREPLAY_SYNTHETIC_ARTIFACT_FILES
      .map((file) => (typeof file.content === "string" ? file.content : ""))
      .join("\n");

    expect(combinedText).not.toMatch(/\bcertified\s+safe\b/iu);
    expect(combinedText).not.toMatch(/\bsurvey[\s-]+grade\b/iu);
    expect(combinedText).not.toMatch(/\bphotoreal\s+digital\s+twin\b/iu);
    expect(validateVenreplayArtifact(VENREPLAY_SYNTHETIC_ARTIFACT_FILES).valid).toBe(true);
  });
});

function stringContent(path: string): string {
  const file = VENREPLAY_SYNTHETIC_ARTIFACT_FILES.find((entry) => entry.path === path);
  if (file === undefined || typeof file.content !== "string") {
    throw new Error(`Missing text fixture file ${path}.`);
  }
  return file.content;
}

function zipEndOffset(): number {
  return VENREPLAY_SYNTHETIC_FIXTURE_ZIP_BYTES.byteLength - 22;
}

function readStoredZipLocalEntries(bytes: Uint8Array): StoredZipEntry[] {
  const entries: StoredZipEntry[] = [];
  let offset = 0;

  while (readUint32LE(bytes, offset) === 0x04034b50) {
    const compressionMethod = readUint16LE(bytes, offset + 8);
    const modifiedTime = readUint16LE(bytes, offset + 10);
    const modifiedDate = readUint16LE(bytes, offset + 12);
    const compressedSize = readUint32LE(bytes, offset + 18);
    const fileNameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + fileNameLength + extraLength;
    const contentEnd = contentStart + compressedSize;

    entries.push({
      path: asciiString(bytes.slice(nameStart, nameStart + fileNameLength)),
      content: asciiString(bytes.slice(contentStart, contentEnd)),
      compressionMethod,
      modifiedTime,
      modifiedDate,
    });

    offset = contentEnd;
  }

  expect(readUint32LE(bytes, offset)).toBe(0x02014b50);
  return entries;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined) {
    throw new Error("Unexpected end of fixture zip bytes.");
  }
  return first | (second << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  const low = readUint16LE(bytes, offset);
  const high = readUint16LE(bytes, offset + 2);
  return (low | (high << 16)) >>> 0;
}

function asciiString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}
