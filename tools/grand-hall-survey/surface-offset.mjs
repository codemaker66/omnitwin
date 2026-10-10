// Finds the scanned surface along each texel's normal (used for the dome,
// whose coats of arms stand proud of its measured profile):
//   node $SURVEY/surface-offset.mjs in.f32 out.f32 front back      (run in the work directory)
// in: N × 6 float32 (point, inward normal), E57 frame. out: N float32 signed
// offsets along the normal (positive = proud of the profile, toward the
// room), NaN where the ray between `front` before and `back` behind misses.
import { readFileSync, writeFileSync } from "node:fs";
import { meshBvh, three } from "./modules.mjs";

const THREE = await three();
const { MeshBVH } = await meshBvh();
const [input, output, frontArg, backArg] = process.argv.slice(2);
const front = Number(frontArg ?? 0.45);
const back = Number(backArg ?? 0.3);
const read = (path, Type) => { const b = readFileSync(path); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(read("data/mesh/positions.f32", Float32Array), 3));
geometry.setIndex(new THREE.BufferAttribute(read("data/mesh/indices.u32", Uint32Array), 1));
const bvh = new MeshBVH(geometry);
const texels = read(input, Float32Array);
const n = texels.length / 6;
const out = new Float32Array(n);
const ray = new THREE.Ray();
let hits = 0;
for (let i = 0; i < n; i++) {
  const o = i * 6;
  ray.origin.set(texels[o] + texels[o + 3] * front, texels[o + 1] + texels[o + 4] * front, texels[o + 2] + texels[o + 5] * front);
  ray.direction.set(-texels[o + 3], -texels[o + 4], -texels[o + 5]);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, front + back);
  if (hit) { out[i] = front - hit.distance; hits++; } else out[i] = Number.NaN;
}
writeFileSync(output, Buffer.from(out.buffer));
console.log("hits", hits, "of", n);
