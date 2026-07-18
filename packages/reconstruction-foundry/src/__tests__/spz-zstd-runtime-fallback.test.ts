import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:zlib", async () => {
  const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
  return { ...actual, createZstdDecompress: undefined };
});

const roots: string[] = [];
const SHA256 = "a".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function inspectBytes(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "foundry-spz-runtime-fallback-"));
  roots.push(root);
  const path = join(root, "scene.spz");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    const entrypoint = await import("../index.js");
    return await entrypoint.inspectSpzSourceFacts(handle, bytes.length, SHA256);
  } finally {
    await handle.close();
  }
}

function legacyFixture(gzipSync: typeof import("node:zlib").gzipSync): Buffer {
  const raw = Buffer.alloc(36);
  raw.writeUInt32LE(0x5053474e, 0);
  raw.writeUInt32LE(3, 4);
  raw.writeUInt32LE(1, 8);
  raw.writeUInt8(0, 12);
  raw.writeUInt8(12, 13);
  return gzipSync(raw);
}

function v4MagicOnlyFixture(): Buffer {
  const streamSizes = [9, 1, 3, 3, 4];
  const tocBytes = streamSizes.length * 16;
  const headerAndToc = Buffer.alloc(32 + tocBytes);
  headerAndToc.writeUInt32LE(0x5053474e, 0);
  headerAndToc.writeUInt32LE(4, 4);
  headerAndToc.writeUInt32LE(1, 8);
  headerAndToc.writeUInt8(0, 12);
  headerAndToc.writeUInt8(12, 13);
  headerAndToc.writeUInt8(streamSizes.length, 15);
  headerAndToc.writeUInt32LE(32, 16);
  for (const [index, uncompressedBytes] of streamSizes.entries()) {
    headerAndToc.writeBigUInt64LE(4n, 32 + index * 16);
    headerAndToc.writeBigUInt64LE(BigInt(uncompressedBytes), 32 + index * 16 + 8);
  }
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  return Buffer.concat([headerAndToc, ...streamSizes.map(() => magic)]);
}

describe("SPZ Zstandard runtime fallback", () => {
  it("keeps the package root and legacy SPZ usable when Zstandard is unavailable", async () => {
    const actual = await vi.importActual<typeof import("node:zlib")>("node:zlib");
    await expect(inspectBytes(legacyFixture(actual.gzipSync))).resolves.toMatchObject({
      state: "established",
      facts: { format: "spz_legacy_gzip", version: 3 },
    });
  });

  it("returns the stable unsupported-variant outcome for V4", async () => {
    await expect(inspectBytes(v4MagicOnlyFixture())).resolves.toMatchObject({
      state: "facts_not_established",
      category: "unsupported_variant",
      code: "SPZ_V4_ZSTD_RUNTIME_UNAVAILABLE",
    });
  });
});
