import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { NodeIO, type Accessor, type Document, type mat4 } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import {
  orientTriangleIndicesTowardCapture,
  type InteriorWindingReport,
  type Vec3,
} from "./interior-winding.js";

function emptyWindingReport(): InteriorWindingReport {
  return { keep: 0, flip: 0, ambiguous: 0, degenerate: 0, triangles: 0 };
}

function addWindingReport(
  target: InteriorWindingReport,
  source: InteriorWindingReport,
): InteriorWindingReport {
  return {
    keep: target.keep + source.keep,
    flip: target.flip + source.flip,
    ambiguous: target.ambiguous + source.ambiguous,
    degenerate: target.degenerate + source.degenerate,
    triangles: target.triangles + source.triangles,
  };
}

function positionsInWorldFrame(position: Accessor, matrix: mat4): Float64Array {
  const transformed = new Float64Array(position.getCount() * 3);
  const local: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < position.getCount(); index += 1) {
    position.getElement(index, local);
    const [x, y, z] = local;
    const offset = index * 3;
    transformed[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    transformed[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    transformed[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return transformed;
}

/** Orient every indexed triangle toward its nearest interior capture witness. */
export function orientDocumentTowardCapture(
  doc: Document,
  capturePositions: readonly Vec3[],
): InteriorWindingReport {
  if (capturePositions.length === 0) {
    throw new Error("mesh winding repair requires at least one capture position");
  }
  const nodes = doc.getRoot().listNodes();
  let report = emptyWindingReport();
  for (const mesh of doc.getRoot().listMeshes()) {
    const instances = nodes.filter((node) => node.getMesh() === mesh);
    if (instances.length !== 1) {
      throw new Error(
        `mesh ${mesh.getName() || "<unnamed>"} must have exactly one node instance for winding repair`,
      );
    }
    const worldMatrix = instances[0]?.getWorldMatrix();
    if (worldMatrix === undefined) {
      throw new Error(`mesh ${mesh.getName() || "<unnamed>"} has no world transform`);
    }
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) {
        throw new Error("mesh winding repair supports indexed TRIANGLES primitives only");
      }
      if (primitive.getAttribute("NORMAL") !== null || primitive.getAttribute("TANGENT") !== null) {
        throw new Error("mesh winding repair requires geometry without stored normals or tangents");
      }
      const position = primitive.getAttribute("POSITION");
      const indices = primitive.getIndices();
      if (position === null || indices === null) {
        throw new Error("mesh winding repair requires indexed POSITION geometry");
      }
      const indexArray = indices.getArray();
      if (!(indexArray instanceof Uint16Array) && !(indexArray instanceof Uint32Array)) {
        throw new Error("mesh winding repair requires Uint16Array or Uint32Array indices");
      }
      const oriented = orientTriangleIndicesTowardCapture({
        positions: positionsInWorldFrame(position, worldMatrix),
        indices: indexArray,
        capturePositions,
      });
      indices.setArray(oriented.indices);
      report = addWindingReport(report, oriented.report);
    }
  }
  return report;
}

/**
 * Source GLB → bundle dollhouse: dedup/prune/weld, meshopt geometry
 * compression, WebP textures capped at 1024². Target ≤ 8 MiB (program spec
 * §6 Phase 2); forge promotion fails when the result misses the budget.
 */
export async function optimizeMesh(
  srcGlb: string,
  outDir: string,
  capturePositions: readonly Vec3[],
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
  );
  // Repair the dominant winding error before meshopt reorders indices so its
  // cache/size pass optimizes the interior-facing topology.
  orientDocumentTowardCapture(doc, capturePositions);
  await doc.transform(
    // Weight lives in the 144 per-chunk textures (12 of 16 MB at 1024²).
    // The dollhouse is a whole-building view: 512² per chunk keeps texel
    // density generous while landing the bundle inside the 8 MB budget.
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 75 }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  // meshopt() has now quantized the decoded accessors, but byte compression is
  // deferred until NodeIO.write(). Recheck final winding so quantization cannot
  // reclassify small boundary triangles afterward.
  orientDocumentTowardCapture(doc, capturePositions);
  await io.write(dest, doc);
  return { bytes: (await stat(dest)).size, sourceName };
}
