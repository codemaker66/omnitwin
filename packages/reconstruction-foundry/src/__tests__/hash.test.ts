import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_HASH_BUFFER_BYTES,
  FOUNDRY_MAX_HASH_HEAD_BYTES,
  sha256RegularFileWithHead,
} from "../hash.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded streamed file hashing", () => {
  it("hashes a file larger than two work buffers while retaining only a bounded head", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-stream-hash-"));
    cleanup.push(root);
    const path = join(root, "large.e57");
    const handle = await open(path, "w");
    const marker = Buffer.from("ASTM-E57", "ascii");
    const zeroChunk = Buffer.alloc(1024 * 1024);
    const totalBytes = FOUNDRY_HASH_BUFFER_BYTES * 2 + 19;
    try {
      await handle.write(marker, 0, marker.length, 0);
      await handle.truncate(totalBytes);
    } finally {
      await handle.close();
    }

    const expected = createHash("sha256");
    expected.update(marker);
    let remaining = totalBytes - marker.length;
    while (remaining > 0) {
      const length = Math.min(remaining, zeroChunk.length);
      expected.update(zeroChunk.subarray(0, length));
      remaining -= length;
    }

    const digest = await sha256RegularFileWithHead(path, marker.length + 4);

    expect(FOUNDRY_HASH_BUFFER_BYTES).toBe(8 * 1024 * 1024);
    expect(digest.sizeBytes).toBe(totalBytes);
    expect(digest.sha256).toBe(expected.digest("hex"));
    expect(Buffer.from(digest.headBytes)).toEqual(Buffer.concat([marker, Buffer.alloc(4)]));
  });

  it("rejects an unbounded head request before opening the source", async () => {
    await expect(
      sha256RegularFileWithHead("missing.file", FOUNDRY_MAX_HASH_HEAD_BYTES + 1),
    ).rejects.toThrow("bounded head");
  });

  it("delivers the exact digest byte stream to a synchronous observer in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-observed-hash-"));
    cleanup.push(root);
    const path = join(root, "mesh.obj");
    const bytes = Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf8");
    await writeFile(path, bytes);
    const observed: Buffer[] = [];
    const offsets: number[] = [];

    const digest = await sha256RegularFileWithHead(
      path,
      16,
      undefined,
      undefined,
      (chunk, absoluteOffset) => {
        offsets.push(absoluteOffset);
        observed.push(Buffer.from(chunk));
      },
    );

    expect(offsets).toEqual([0]);
    expect(Buffer.concat(observed)).toEqual(bytes);
    expect(digest.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("runs bounded random-access inspection on the same open handle after the complete stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-open-handle-observer-"));
    cleanup.push(root);
    const path = join(root, "scene.sog");
    const bytes = Buffer.from("0123456789abcdef", "ascii");
    await writeFile(path, bytes);
    let streamedBytes = 0;
    let inspected = false;

    const digest = await sha256RegularFileWithHead(
      path,
      0,
      undefined,
      undefined,
      (chunk) => {
        streamedBytes += chunk.length;
      },
      async (handle, sizeBytes, sourceSha256) => {
        expect(streamedBytes).toBe(bytes.length);
        expect(sizeBytes).toBe(bytes.length);
        expect(sourceSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        const capture = Buffer.alloc(4);
        const { bytesRead } = await handle.read(capture, 0, capture.length, 6);
        expect(bytesRead).toBe(4);
        expect(capture.toString("ascii")).toBe("6789");
        inspected = true;
      },
    );

    expect(inspected).toBe(true);
    expect(digest.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("cancels before opening a source when the caller stops inspection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sha256RegularFileWithHead("missing.file", 0, undefined, controller.signal),
    ).rejects.toThrow("fingerprint was cancelled");
  });

  it("rejects a path replaced after discovery before reading replacement bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-replaced-hash-"));
    cleanup.push(root);
    const path = join(root, "capture.e57");
    await writeFile(path, "original-E57");
    const discovered = await lstat(path);
    await rm(path);
    await writeFile(path, "replaced-E57");

    await expect(sha256RegularFileWithHead(path, 8, {
      dev: discovered.dev,
      ino: discovered.ino,
      size: discovered.size,
      mtimeMs: discovered.mtimeMs,
      ctimeMs: discovered.ctimeMs,
    })).rejects.toThrow("identity changed after discovery");
  });
});
