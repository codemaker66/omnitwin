import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import {
  TWIN_EQUIRECT_LODS,
  TwinManifestSchema,
  twinEquirectPath,
  type TwinManifest,
} from "@omnitwin/types";

const webpFixtures = new Map<string, Promise<Buffer>>();

export function vp8xWebp(width: number, height: number): Promise<Buffer> {
  const key = `${String(width)}x${String(height)}`;
  const existing = webpFixtures.get(key);
  if (existing !== undefined) return existing;
  const created = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 36, g: 48, b: 65 },
    },
  }).webp({ lossless: true, effort: 0 }).toBuffer();
  webpFixtures.set(key, created);
  return created;
}

export function glbFixture(): Buffer {
  const positions = Buffer.alloc(36);
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0] as const;
  vertices.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(6);
  indices.writeUInt16LE(0, 0);
  indices.writeUInt16LE(1, 2);
  indices.writeUInt16LE(2, 4);
  const binaryLength = positions.length + indices.length;
  const binaryPaddedLength = Math.ceil(binaryLength / 4) * 4;
  const binary = Buffer.alloc(binaryPaddedLength);
  positions.copy(binary, 0);
  indices.copy(binary, positions.length);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [2] },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 },
    ],
    buffers: [{ byteLength: binaryLength }],
  };
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(20 + paddedLength + 8 + binary.length, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  const binaryHeader = 20 + paddedLength;
  bytes.writeUInt32LE(binary.length, binaryHeader);
  bytes.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(bytes, binaryHeader + 8);
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface TwinFixture {
  readonly root: string;
  readonly manifest: TwinManifest;
  readonly files: ReadonlyMap<string, Buffer>;
}

export async function twinFixture(): Promise<TwinFixture> {
  const root = await mkdtemp(join(tmpdir(), "foundry-twin-"));
  const files = new Map<string, Buffer>();
  for (const nodeId of ["scan_000", "scan_001"] as const) {
    for (const width of TWIN_EQUIRECT_LODS) {
      files.set(twinEquirectPath(nodeId, width), await vp8xWebp(width, width / 2));
    }
  }
  const mesh = glbFixture();
  files.set("mesh/dollhouse.glb", mesh);
  const contentHashes = Object.fromEntries(
    [...files.entries()].map(([path, bytes]) => [path, sha256(bytes)]),
  );
  const manifest = TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: "fixture-hall",
    name: "Fixture Hall",
    capture: { kind: "matterport-e57", scanCount: 2 },
    tier: "planning-grade-5cm",
    upAxis: "z",
    units: "m",
    imagery: "equirect",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [512, 4096, 8192],
    generatedAt: "2026-07-11T00:00:00.000Z",
    nodes: [
      { id: "scan_000", index: 0, pose: { q: [1, 0, 0, 0], t: [0, 0, 1.5] }, floor: 0, roomSlug: null },
      { id: "scan_001", index: 1, pose: { q: [1, 0, 0, 0], t: [1, 0, 1.5] }, floor: 0, roomSlug: null },
    ],
    edges: [{ a: "scan_000", b: "scan_001", distanceM: 1 }],
    entryNodeId: "scan_000",
    mesh: { path: "mesh/dollhouse.glb", bytes: mesh.length, sourceName: "fixture.glb" },
    contentHashes,
  });
  for (const [path, bytes] of files) {
    const destination = join(root, ...path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest, files };
}
