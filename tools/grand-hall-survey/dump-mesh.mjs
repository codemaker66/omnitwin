// Dumps the dollhouse mesh as world-space arrays for numpy (E57 frame, Z up):
//   node $SURVEY/dump-mesh.mjs data/dollhouse.glb data/mesh
// positions.f32 (x y z), uvs.f32, chunks.u16 (node index), indices.u32, names.json, tex/<node>.webp
import { writeFileSync, mkdirSync } from "node:fs";
import { gltfCore, gltfExtensions, meshoptimizer } from "./modules.mjs";

const { NodeIO } = await gltfCore();
const { ALL_EXTENSIONS } = await gltfExtensions();
const { MeshoptDecoder } = await meshoptimizer();
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const [input, out] = process.argv.slice(2);
const doc = await io.read(input);
mkdirSync(`${out}/tex`, { recursive: true });
const positions = [], uvs = [], chunks = [], indices = [];
let base = 0;
const nodes = doc.getRoot().listNodes();
nodes.forEach((node, chunkId) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const uv = prim.getAttribute("TEXCOORD_0");
    const tex = prim.getMaterial()?.getBaseColorTexture();
    if (tex) writeFileSync(`${out}/tex/${String(chunkId).padStart(3, "0")}.webp`, tex.getImage());
    const p = [0, 0, 0], t = [0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      positions.push(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]);
      if (uv) { uv.getElement(i, t); uvs.push(t[0], t[1]); } else uvs.push(0, 0);
      chunks.push(chunkId);
    }
    const idx = prim.getIndices();
    if (idx) for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
    else for (let i = 0; i < pos.getCount(); i++) indices.push(base + i);
    base += pos.getCount();
  }
});
writeFileSync(`${out}/positions.f32`, Buffer.from(new Float32Array(positions).buffer));
writeFileSync(`${out}/uvs.f32`, Buffer.from(new Float32Array(uvs).buffer));
writeFileSync(`${out}/chunks.u16`, Buffer.from(new Uint16Array(chunks).buffer));
writeFileSync(`${out}/indices.u32`, Buffer.from(new Uint32Array(indices).buffer));
writeFileSync(`${out}/names.json`, JSON.stringify(nodes.map((n) => n.getName())));
console.log(nodes.length, "nodes,", positions.length / 3, "vertices,", indices.length / 3, "triangles");
