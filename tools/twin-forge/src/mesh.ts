import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

/**
 * Source GLB → bundle dollhouse: dedup/prune/weld, meshopt geometry
 * compression, WebP textures capped at 1024². Target ≤ 8 MiB (program spec
 * §6 Phase 2); forge promotion fails when the result misses the budget.
 */
export async function optimizeMesh(
  srcGlb: string,
  outDir: string,
): Promise<{ bytes: number; sourceName: string }> {
  const dest = join(outDir, "mesh", "dollhouse.glb");
  const sourceName = basename(srcGlb);
  if (existsSync(dest)) {
    return { bytes: (await stat(dest)).size, sourceName };
  }
  await mkdir(join(outDir, "mesh"), { recursive: true });

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      // Matterpak exports arrive Draco-compressed (KHR_draco_mesh_compression);
      // the decoder is read-side only — output geometry is meshopt.
      "draco3d.decoder": await draco3d.createDecoderModule(),
    });

  const doc = await io.read(srcGlb);
  // Geometry is fully decoded at read time; drop the lingering Draco
  // declaration so the writer doesn't demand an encoder — the output's
  // compression is meshopt, not draco.
  doc
    .getRoot()
    .listExtensionsUsed()
    .find((ext) => ext.extensionName === "KHR_draco_mesh_compression")
    ?.dispose();
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    // The dollhouse is viewed from metres away — simplification is visually
    // cheap and is what brings the matterpak export inside the 8 MB budget
    // (Task 4's visual gate judges the result).
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.75, error: 0.001 }),
    // Weight lives in the 144 per-chunk textures (12 of 16 MB at 1024²).
    // The dollhouse is a whole-building view: 512² per chunk keeps texel
    // density generous while landing the bundle inside the 8 MB budget.
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 75 }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  await io.write(dest, doc);
  return { bytes: (await stat(dest)).size, sourceName };
}
