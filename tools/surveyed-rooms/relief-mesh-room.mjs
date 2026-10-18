// Meshes depth maps (the walls' from wall-depth, or the ceiling's height field) and simplifies
// each to a fixed geometric error, then packs them into one GHR1 file, the format hall-relief.ts
// reads:
//   "GHR1", u32 entryCount, then per entry (4-byte aligned):
//   char[12] id, u32 vertexCount, u32 triangleCount, u32 indexBytes (2|4),
//   f32[6] ranges (u0 u1 v0 v1 d0 d1), u16[vertexCount*3] quantised (u, v, depth),
//   indices (u16|u32)[triangleCount*3]
// tools/grand-hall-survey/relief-mesh.mjs with its Grand Hall constants moved into a job file:
//   { "out": "proj/walls-relief.bin", "error": 0.005,
//     "entries": [{ "id": "window", "file": "relief/window", "u0": 0, "vRange": [0, 6.7], "dRange": [-1, 0.9] }] }
// Each entry reads <file>.json ({width, height, ppm, top, length}) and <file>.f32. u runs from u0
// to u0 + length; for u0 = 0 every position is the old script's (0 + x === x). A .json may give
// ppmU and ppmV, the exact texel spacing along u and v (the ceiling's); without them both are ppm,
// so the walls' arithmetic is the old script's. With "record" the job also writes which
// meshoptimizer simplified the file (nodemods.nodeRecord) to that path.
// Usage: node $ROOMS/relief-mesh-room.mjs <job.json>      (run in the work directory)
import { readFileSync, writeFileSync } from "node:fs";
import { meshoptimizer, nodeRecord } from "./nodemods.mjs";

const { MeshoptSimplifier } = await meshoptimizer();
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const error = Number(job.error ?? 0.005);
await MeshoptSimplifier.ready;

function checkId(id) {
  if (typeof id !== "string" || !/^[\x20-\x7e]{1,12}$/.test(id)) {
    // Buffer.write would silently run a longer id into the vertex count.
    throw new Error(`GHR1 id ${JSON.stringify(id)} must be 1-12 ASCII characters`);
  }
}

function meshEntry(entry) {
  const meta = JSON.parse(readFileSync(`${entry.file}.json`, "utf8"));
  const raw = readFileSync(`${entry.file}.f32`);
  const D = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const { width, height, ppm, top, length } = meta;
  const ppmU = meta.ppmU ?? ppm;
  const ppmV = meta.ppmV ?? ppm;
  const u0 = entry.u0 ?? 0;
  const u1 = u0 + length;
  const [V_MIN, V_MAX] = entry.vRange;
  const [D_MIN, D_MAX] = entry.dRange;
  const r0 = Math.max(0, Math.round((top - V_MAX) * ppmV));
  const r1 = Math.min(height - 1, Math.round((top - V_MIN) * ppmV));
  const rows = r1 - r0 + 1;
  // Grid vertices on texel centres, with the outermost pinned to the ends and the v range's
  // edges so neighbouring surfaces meet exactly.
  const columns = width;
  const positions = new Float32Array(columns * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const k = (r * columns + c) * 3;
      positions[k] = c === 0 ? u0 : c === columns - 1 ? u1 : u0 + (c + 0.5) / ppmU;
      positions[k + 1] = r === 0 ? V_MAX : r === rows - 1 ? V_MIN : top - (r0 + r + 0.5) / ppmV;
      positions[k + 2] = Math.min(D_MAX, Math.max(D_MIN, D[(r0 + r) * width + c]));
    }
  }
  const grid = new Uint32Array((rows - 1) * (columns - 1) * 6);
  let n = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c, b = a + 1, d = a + columns, e = d + 1;
      // Counter-clockwise seen from the depth side: u right, v up, depth toward the viewer.
      grid[n++] = a; grid[n++] = d; grid[n++] = b;
      grid[n++] = b; grid[n++] = d; grid[n++] = e;
    }
  }
  const [simplified, achieved] = MeshoptSimplifier.simplify(grid, positions, 3, 0, error, ["ErrorAbsolute"]);
  // Keep only the vertices the simplified mesh uses.
  const remap = new Int32Array(columns * rows).fill(-1);
  const kept = [];
  const indices = new Uint32Array(simplified.length);
  for (let i = 0; i < simplified.length; i++) {
    const v = simplified[i];
    if (remap[v] < 0) { remap[v] = kept.length; kept.push(v); }
    indices[i] = remap[v];
  }
  const ranges = [u0, u1, V_MIN, V_MAX, D_MIN, D_MAX];
  const quantised = new Uint16Array(kept.length * 3);
  kept.forEach((v, i) => {
    for (let axis = 0; axis < 3; axis++) {
      const lo = ranges[axis * 2], hi = ranges[axis * 2 + 1];
      quantised[i * 3 + axis] = Math.round(((positions[v * 3 + axis] - lo) / (hi - lo)) * 65535);
    }
  });
  console.log(entry.file.split("/").pop(), "grid", grid.length / 3, "->", indices.length / 3, "triangles,", kept.length, "vertices, error", achieved.toFixed(4));
  return { ranges, quantised, indices, vertexCount: kept.length };
}

for (const entry of job.entries) checkId(entry.id);
if (new Set(job.entries.map((entry) => entry.id)).size !== job.entries.length) throw new Error("GHR1 ids repeat");
const chunks = [];
const header = new ArrayBuffer(8);
new Uint8Array(header).set([0x47, 0x48, 0x52, 0x31]);
new DataView(header).setUint32(4, job.entries.length, true);
chunks.push(Buffer.from(header));
const pad = () => { const size = chunks.reduce((s, c) => s + c.length, 0); if (size % 4) chunks.push(Buffer.alloc(4 - (size % 4))); };
for (const entry of job.entries) {
  const mesh = meshEntry(entry);
  const indexBytes = mesh.vertexCount <= 65535 ? 2 : 4;
  const head = Buffer.alloc(12 + 12 + 24);
  head.write(entry.id, 0, "ascii");
  head.writeUInt32LE(mesh.vertexCount, 12);
  head.writeUInt32LE(mesh.indices.length / 3, 16);
  head.writeUInt32LE(indexBytes, 20);
  mesh.ranges.forEach((value, i) => head.writeFloatLE(value, 24 + i * 4));
  chunks.push(head);
  chunks.push(Buffer.from(mesh.quantised.buffer));
  pad();
  const idx = indexBytes === 2 ? new Uint16Array(mesh.indices) : mesh.indices;
  chunks.push(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
  pad();
}
const file = Buffer.concat(chunks);
writeFileSync(job.out, file);
console.log(job.out, file.length, "bytes");
if (job.record) writeFileSync(job.record, `${JSON.stringify({ out: job.out, bytes: file.length, ...nodeRecord() }, null, 1)}\n`);
