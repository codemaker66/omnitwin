import { existsSync, mkdtempSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeMesh } from "../mesh.js";

/**
 * Deterministic 64×64 noise PNG. Noise keeps the lossless PNG large so the
 * lossy WebP conversion has real bytes to win back — a flat-colour PNG is
 * already near-minimal and would make the size assertion meaningless.
 */
async function noisePng(): Promise<Buffer> {
  const raw = Buffer.alloc(64 * 64 * 3);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < raw.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // High-order byte: the low bits of a power-of-two-modulus LCG are
    // periodic (period 256), which PNG compresses away — defeating the test.
    raw[i] = (seed >>> 16) & 0xff;
  }
  return sharp(raw, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
}

/** One textured quad — the smallest GLB that exercises geometry + texture. */
async function writeSourceGlb(dir: string): Promise<string> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType("VEC2")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 2, 1, 3]))
    .setBuffer(buffer);
  const texture = doc.createTexture("noise").setImage(await noisePng()).setMimeType("image/png");
  const material = doc.createMaterial("mat").setBaseColorTexture(texture);
  const prim = doc
    .createPrimitive()
    .setIndices(indices)
    .setAttribute("POSITION", position)
    .setAttribute("TEXCOORD_0", uv)
    .setMaterial(material);
  const node = doc.createNode("quad").setMesh(doc.createMesh("quad").addPrimitive(prim));
  doc.createScene("scene").addChild(node);
  const src = join(dir, "trades-hall-web.glb");
  await new NodeIO().write(src, doc);
  return src;
}

describe("optimizeMesh", () => {
  it("writes a meshopt+webp dollhouse smaller than the source, idempotently", async () => {
    const srcDir = mkdtempSync(join(tmpdir(), "forge-mesh-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-mesh-out-"));
    const src = await writeSourceGlb(srcDir);

    const first = await optimizeMesh(src, out);
    const dest = join(out, "mesh", "dollhouse.glb");
    expect(existsSync(dest)).toBe(true);
    expect(first.sourceName).toBe("trades-hall-web.glb");
    expect(first.bytes).toBe((await stat(dest)).size);
    expect(first.bytes).toBeLessThan((await stat(src)).size);

    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const reread = await io.read(dest);
    expect(reread.getRoot().listMeshes().length).toBe(1);
    const { json } = await io.readAsJSON(dest);
    expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
    expect(json.extensionsUsed).toContain("EXT_texture_webp");

    const mtimeBefore = (await stat(dest)).mtimeMs;
    const second = await optimizeMesh(src, out);
    expect(second).toEqual(first);
    expect((await stat(dest)).mtimeMs).toBe(mtimeBefore); // no rewrite
  });
});
