import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectGlb } from "../glb.js";
import { parseWebpDimensions } from "../webp.js";
import { glbFixture, vp8xWebp } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded media inspection", () => {
  it("reads complete WebP dimensions and pins the RIFF byte count", async () => {
    const image = await vp8xWebp(4096, 2048);
    expect(parseWebpDimensions(image, image.length)).toMatchObject({ width: 4096, height: 2048 });
    const corruptLength = Buffer.from(image);
    corruptLength.writeUInt32LE(image.length - 4, 4);
    expect(() => parseWebpDimensions(corruptLength, corruptLength.length)).toThrow("does not match file size");
  });

  it("accepts a bounded glTF 2 binary and rejects a corrupt declared length", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-formats-"));
    cleanup.push(root);
    const path = join(root, "mesh.glb");
    const valid = glbFixture();
    await writeFile(path, valid);
    await expect(inspectGlb(path, valid.length)).resolves.toMatchObject({ version: 2, sizeBytes: valid.length });
    const corrupt = Buffer.from(valid);
    corrupt.writeUInt32LE(valid.length + 4, 8);
    await writeFile(path, corrupt);
    await expect(inspectGlb(path, corrupt.length)).rejects.toThrow("declared byte length");
  });

  it("rejects a valid-looking GLB header when its JSON or chunk structure is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-formats-"));
    cleanup.push(root);
    const path = join(root, "mesh.glb");

    const invalidJson = glbFixture();
    invalidJson.write("not-json", 20, "utf8");
    await writeFile(path, invalidJson);
    await expect(inspectGlb(path, invalidJson.length)).rejects.toThrow("valid UTF-8 JSON");

    const truncatedChunk = Buffer.concat([glbFixture(), Buffer.alloc(4)]);
    truncatedChunk.writeUInt32LE(truncatedChunk.length, 8);
    await writeFile(path, truncatedChunk);
    await expect(inspectGlb(path, truncatedChunk.length)).rejects.toThrow("exact final BIN chunk");
  });
});
