/**
 * Prepare Blake's supplied Rodin Turini chair using local, pinned project tools.
 * node prepare-burgess-turini.mjs <repository-root> <source-pbr.glb> <output-directory>
 * Outputs stay outside source control until independently reviewed.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const [repositoryRoot, sourcePath, outputDirectory] = process.argv.slice(2);
if (!repositoryRoot || !sourcePath || !outputDirectory) {
  throw new Error('Usage: node prepare-burgess-turini.mjs <repository-root> <source-pbr.glb> <output-directory>');
}
const require = createRequire(path.resolve(repositoryRoot, 'tools/twin-forge/package.json'));
const { NodeIO } = await import(pathToFileURL(require.resolve('@gltf-transform/core')));
const { weld, compactPrimitive, prune, transformMesh, textureCompress } = await import(pathToFileURL(require.resolve('@gltf-transform/functions')));
const { EXTTextureWebP } = await import(pathToFileURL(require.resolve('@gltf-transform/extensions')));
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer')));
const sharp = (await import(pathToFileURL(require.resolve('sharp')))).default;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await fs.readFile(sourcePath);
const sourceHash = digest(sourceBytes);
const expectedSourceHash = '9e7aa9ad1a2d818ca034971db2cd481ec7a37d8ea2c4469057179c3b10e5c37c';
if (sourceHash !== expectedSourceHash) throw new Error('Source differs from reviewed Rodin PBR output. Inspect it before reusing this recipe.');
const document = await io.read(sourcePath);
const root = document.getRoot();
if (root.listNodes().length !== 1 || root.listMeshes().length !== 1 || root.listSkins().length || root.listAnimations().length) {
  throw new Error('This recipe expects the reviewed single-mesh, static source.');
}
const node = root.listNodes()[0];
if (node.getTranslation().some((n) => n !== 0) || node.getScale().some((n) => n !== 1) || node.getRotation().some((n, i) => n !== (i === 3 ? 1 : 0))) {
  throw new Error('Unexpected source node transform; bounds inspection must include world transforms.');
}
function inspect(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0, vertices = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) throw new Error('Non-triangle primitive.');
      const positions = primitive.getAttribute('POSITION');
      if (!positions || !primitive.getIndices()) throw new Error('Missing indexed positions.');
      vertices += positions.getCount();
      triangles += primitive.getIndices().getCount() / 3;
      for (const index of primitive.getIndices().getArray()) {
        if (index >= positions.getCount()) throw new Error('Out-of-range mesh index.');
      }
      for (const attribute of primitive.listAttributes()) {
        for (const value of attribute.getArray()) if (!Number.isFinite(value)) throw new Error('Non-finite vertex attribute.');
      }
      const array = positions.getArray();
      for (let i = 0; i < array.length; i += 3) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], array[i + axis]);
        max[axis] = Math.max(max[axis], array[i + axis]);
      }
    }
  }
  return { triangles, vertices, bounds: { min, max, size: min.map((n, i) => max[i] - n) },
    materials: doc.getRoot().listMaterials().length,
    textures: doc.getRoot().listTextures().map((t) => ({ name: t.getName(), mimeType: t.getMimeType(), size: t.getSize(), bytes: t.getImage().length })) };
}
const source = inspect(document);
const originalTextures = new Map(root.listTextures().map((texture) => [texture.getName(), new Uint8Array(texture.getImage())]));
const center = [(source.bounds.min[0] + source.bounds.max[0]) / 2, source.bounds.min[1], (source.bounds.min[2] + source.bounds.max[2]) / 2];
const uniformScale = 0.88 / source.bounds.size[1];
for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const positions = primitive.getAttribute('POSITION').getArray();
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) positions[i + axis] = (positions[i + axis] - center[axis]) * uniformScale;
}
await fs.mkdir(outputDirectory, { recursive: true });
const master = await io.writeBinary(document);
await fs.writeFile(path.join(outputDirectory, 'height-normalized-master.glb'), master);
const heightNormalized = inspect(document);
await document.transform(weld());
const simplification = [];
for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const positions = primitive.getAttribute('POSITION');
  const normals = primitive.getAttribute('NORMAL');
  const uv = primitive.getAttribute('TEXCOORD_0');
  if (!normals || !uv) throw new Error('Missing source normal or UV stream.');
  const attributes = new Float32Array(positions.getCount() * 5);
  const normalArray = normals.getArray(), uvArray = uv.getArray();
  for (let i = 0; i < positions.getCount(); i++) {
    attributes.set(normalArray.subarray(i * 3, i * 3 + 3), i * 5);
    attributes.set(uvArray.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  const [indices, actualError] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(primitive.getIndices().getArray()), positions.getArray(), 3,
    attributes, 5, [1, 1, 1, 1, 1], null, 150000, 0.001,
  );
  primitive.setIndices(document.createAccessor().setType('SCALAR').setBuffer(positions.getBuffer()).setArray(indices));
  compactPrimitive(primitive);
  if (primitive.getAttribute('POSITION').getCount() < 65535) primitive.getIndices().setArray(new Uint16Array(primitive.getIndices().getArray()));
  simplification.push({ method: 'meshoptimizer.simplifyWithAttributes', targetTriangles: 50000, targetError: 0.001,
    normalAndUvWeights: [1, 1, 1, 1, 1], actualTriangles: indices.length / 3, actualError });
}
await document.transform(prune());
const simplifiedBounds = inspect(document).bounds;
const targetDimensions = [0.42, 0.88, 0.58];
const axisScale = targetDimensions.map((dimension, axis) => dimension / simplifiedBounds.size[axis]);
const offset = [-(simplifiedBounds.min[0] + simplifiedBounds.max[0]) / 2, -simplifiedBounds.min[1], -(simplifiedBounds.min[2] + simplifiedBounds.max[2]) / 2];
for (const mesh of root.listMeshes()) transformMesh(mesh, [
  axisScale[0], 0, 0, 0, 0, axisScale[1], 0, 0, 0, 0, axisScale[2], 0,
  offset[0] * axisScale[0], offset[1] * axisScale[1], offset[2] * axisScale[2], 1,
]);
await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', lossless: true, effort: 80 }));
const textureVerification = [];
for (const texture of root.listTextures()) {
  const before = await sharp(originalTextures.get(texture.getName())).ensureAlpha().raw().toBuffer();
  const after = await sharp(texture.getImage()).ensureAlpha().raw().toBuffer();
  if (!before.equals(after)) throw new Error(`Lossless texture check failed: ${texture.getName()}`);
  textureVerification.push({ name: texture.getName(), decodedRgbaSha256: digest(after), decodedPixelsEqual: true });
}
const finalBytes = await io.writeBinary(document);
await fs.writeFile(path.join(outputDirectory, 'chair.glb'), finalBytes);
const roundTrip = await io.readBinary(finalBytes);
const runtime = inspect(roundTrip);
for (let axis = 0; axis < 3; axis++) if (Math.abs(runtime.bounds.size[axis] - targetDimensions[axis]) > 1e-6) throw new Error('Runtime dimensions do not match calibrated envelope.');
if (Math.abs(runtime.bounds.min[1]) > 1e-6) throw new Error('Runtime floor pivot is not zero.');
const report = {
  asset: 'Burgess Turini 18/3 chair', sourceKind: 'User-supplied Hyper3D Rodin generated PBR model',
  source: { filename: path.basename(sourcePath), bytes: sourceBytes.length, sha256: sourceHash, ...source },
  dependencies: { gltfTransform: '4.3.0', meshoptimizer: '1.2.0', sharp: '0.35.3' },
  heightNormalizedMaster: { filename: 'height-normalized-master.glb', sha256: digest(master), ...heightNormalized },
  normalization: { uniformScale, sourceCenterSubtracted: center }, simplification,
  calibration: { description: 'Per-axis correction of AI-generated model to manufacturer overall envelope supplied by user; normals transformed by inverse transpose. Not a measured scan.',
    dimensionsMetres: { width: 0.42, height: 0.88, depth: 0.58 }, seatHeightMetres: 0.445, seatHeightStatus: 'Manufacturer nominal value; not independently calibrated on generated seat surface',
    axisScaleAfterSimplification: axisScale, translationBeforeScale: offset, forward: '+Z', up: '+Y', pivot: 'floor, centered width and depth' },
  runtime: { filename: 'chair.glb', bytes: finalBytes.length, sha256: digest(finalBytes), ...runtime, requiredExtensions: ['EXT_texture_webp'] },
  textureVerification,
  limitations: ['Supplied model has salmon/peach upholstery and a dark burgundy reflective frame; brochure red/gold appearance was not recreated.', 'Source texture maps are 2048 x 2048; no artificial upscaling.', 'Geometry and texture fidelity were visually compared in neutral studio renders; no furnished-hall performance or founder visual acceptance is claimed.'],
};
await fs.writeFile(path.join(outputDirectory, 'provenance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
