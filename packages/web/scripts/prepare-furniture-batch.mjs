/**
 * Reproduce the supplied September furniture batch using pinned local dependencies.
 * node prepare-furniture-batch.mjs <repository> <extracted-sources> <manifest.json> <output>
 * The manifest contains reviewed hashes and planning envelopes, not measured dimensions.
 * Extract each ZIP's GLB by basename into <extracted-sources>/<folder>; never execute
 * archive contents. Source files remain untouched. Output uses <slug>/v1/model.glb.
 * Preview images are separate neutral Blender renders of the resulting GLB.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const [repository, sourceDirectory, manifestPath, outputDirectory] = process.argv.slice(2);
if (!repository || !sourceDirectory || !manifestPath || !outputDirectory) {
  throw new Error('Usage: node prepare-furniture-batch.mjs repository extracted-sources manifest.json output');
}
const require = createRequire(path.resolve(repository, 'tools/twin-forge/package.json'));
const { NodeIO } = await import(pathToFileURL(require.resolve('@gltf-transform/core')));
const { weld, compactPrimitive, prune, transformMesh, textureCompress } = await import(pathToFileURL(require.resolve('@gltf-transform/functions')));
const { EXTTextureWebP } = await import(pathToFileURL(require.resolve('@gltf-transform/extensions')));
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer')));
const sharp = (await import(pathToFileURL(require.resolve('sharp')))).default;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function inspect(document) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0, vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
    if (primitive.getMode() !== 4 || !position || !indices) throw new Error('Indexed triangles required.');
    triangles += indices.getCount() / 3;
    vertices += position.getCount();
    for (const index of indices.getArray()) if (index >= position.getCount()) throw new Error('Invalid index.');
    for (const attribute of primitive.listAttributes()) {
      for (const value of attribute.getArray()) if (!Number.isFinite(value)) throw new Error('Nonfinite attribute.');
    }
    const array = position.getArray();
    for (let i = 0; i < array.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], array[i + axis]);
      max[axis] = Math.max(max[axis], array[i + axis]);
    }
  }
  return { triangles, vertices, bounds: { min, max, size: min.map((value, axis) => max[axis] - value) },
    materials: document.getRoot().listMaterials().length,
    textures: document.getRoot().listTextures().map(texture => ({ name: texture.getName(), mimeType: texture.getMimeType(), size: texture.getSize(), bytes: texture.getImage().length })) };
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest) || !manifest.length) throw new Error('Expected a nonempty manifest.');
for (const row of manifest) {
  for (const value of [row.folder, row.sourceFilename, row.slug]) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(value) || value === '.' || value === '..') throw new Error('Invalid path component.');
  }
  const dimensions = [row.widthM, row.heightM, row.depthM];
  if (dimensions.some(value => !Number.isFinite(value) || value <= 0) || !Number.isFinite(row.rotationYDegrees)
    || !Number.isFinite(row.simplificationError) || row.simplificationError <= 0 || row.simplificationError > 0.01) throw new Error('Invalid calibration or error limit.');
  const source = await fs.readFile(path.join(sourceDirectory, row.folder, row.sourceFilename));
  if (digest(source) !== row.sourceSha256) throw new Error(`Source changed: ${row.folder}`);
  let document = await io.readBinary(source), root = document.getRoot();
  const nodes = root.listNodes();
  if (nodes.length !== 1 || root.listMeshes().length !== 1 || root.listSkins().length || root.listAnimations().length) throw new Error('Expected one static mesh.');
  const node = nodes[0];
  if (node.getTranslation().some(value => value !== 0) || node.getScale().some(value => value !== 1)
    || node.getRotation().some((value, axis) => value !== (axis === 3 ? 1 : 0))) throw new Error('Unexpected source transform.');
  const before = inspect(document);
  await document.transform(weld());
  const simplification = [];
  for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const streams = [primitive.getAttribute('NORMAL'), primitive.getAttribute('TEXCOORD_0')].filter(Boolean);
    const stride = streams.reduce((sum, stream) => sum + stream.getElementSize(), 0);
    const attributes = new Float32Array(position.getCount() * stride);
    for (let vertex = 0; vertex < position.getCount(); vertex++) {
      let offset = 0;
      for (const stream of streams) {
        const size = stream.getElementSize();
        attributes.set(stream.getArray().subarray(vertex * size, (vertex + 1) * size), vertex * stride + offset);
        offset += size;
      }
    }
    const indices = new Uint32Array(primitive.getIndices().getArray());
    const [simplified, actualError] = stride
      ? MeshoptSimplifier.simplifyWithAttributes(indices, position.getArray(), 3, attributes, stride, Array(stride).fill(1), null, 150000, row.simplificationError)
      : MeshoptSimplifier.simplify(indices, position.getArray(), 3, 150000, row.simplificationError);
    primitive.setIndices(document.createAccessor().setType('SCALAR').setBuffer(position.getBuffer()).setArray(simplified));
    compactPrimitive(primitive);
    if (primitive.getAttribute('POSITION').getCount() < 65535) primitive.getIndices().setArray(new Uint16Array(primitive.getIndices().getArray()));
    simplification.push({ targetTriangles: 50000, errorLimit: row.simplificationError, actualError, actualTriangles: simplified.length / 3, attributeWeights: Array(stride).fill(1) });
  }
  await document.transform(prune());
  // Retain the reviewed preparation sequence: first a lossless source-resolution
  // WebP derivative, then a fresh read before intentional delivery downsampling.
  if (root.listTextures().length) await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', lossless: true, effort: 80 }));
  document = await io.readBinary(await io.writeBinary(document));
  root = document.getRoot();
  const textureVerification = [];
  for (const texture of root.listTextures()) {
    const sourceSize = texture.getSize();
    const { data, info } = await sharp(texture.getImage()).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const encoded = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).webp({ lossless: true, effort: 6 }).toBuffer();
    const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer();
    if (!data.equals(decoded)) throw new Error('Lossless encoding changed resized pixels.');
    texture.setImage(encoded).setMimeType('image/webp');
    textureVerification.push({ name: texture.getName(), sourceSize, runtimeSize: [info.width, info.height], sourcePixelsPreserved: false, resizeKernel: 'Lanczos3', resizedPixelsPreserved: true, resizedRgbaSha256: digest(data) });
  }
  if (root.listTextures().length) document.createExtension(EXTTextureWebP).setRequired(true);
  document = await io.readBinary(await io.writeBinary(document));
  root = document.getRoot();
  const angle = row.rotationYDegrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  for (const mesh of root.listMeshes()) transformMesh(mesh, [cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1]);
  const rotated = inspect(document).bounds, scale = dimensions.map((value, axis) => value / rotated.size[axis]);
  const offset = [-(rotated.min[0] + rotated.max[0]) / 2, -rotated.min[1], -(rotated.min[2] + rotated.max[2]) / 2];
  for (const mesh of root.listMeshes()) transformMesh(mesh, [scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, offset[0] * scale[0], offset[1] * scale[1], offset[2] * scale[2], 1]);
  const bytes = await io.writeBinary(document), runtime = inspect(await io.readBinary(bytes));
  if (runtime.bounds.size.some((value, axis) => Math.abs(value - dimensions[axis]) > 1e-6) || Math.abs(runtime.bounds.min[1]) > 1e-6) throw new Error('Runtime calibration failed.');
  const output = path.join(outputDirectory, row.slug, 'v1');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'model.glb'), bytes);
  await fs.writeFile(path.join(output, 'provenance.json'), JSON.stringify({ asset: row.name, slug: row.slug,
    sourceKind: 'User-supplied Hyper3D Rodin generated model', source: { filename: row.sourceFilename, sha256: row.sourceSha256, bytes: source.length, ...before },
    runtime: { filename: 'model.glb', sha256: digest(bytes), bytes: bytes.length, ...runtime }, simplification, textureVerification,
    normalization: { description: 'Generated mesh calibrated to catalogue planning envelope; not a measured scan.', dimensionsMetres: { width: row.widthM, height: row.heightM, depth: row.depthM }, dimensionBasis: row.dimensionBasis, rotationYRadians: angle, axisScale: scale, translationBeforeScale: offset, pivot: 'centered X/Z, floor Y=0', up: '+Y' },
    limitations: [before.textures.length ? '1K maps intentionally reduce source texture detail; source pixels are not identical after downsampling.' : 'Source export has no texture maps and a uniform gray material.'],
    dependencies: { gltfTransform: '4.3.0', meshoptimizer: '1.2.0', sharp: '0.35.3' },
  }, null, 2) + '\n');
  console.log(`${row.slug}: ${runtime.triangles} triangles, ${bytes.length} bytes`);
}
