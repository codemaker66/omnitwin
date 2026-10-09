// Meshes each wall's cleaned depth map (wall-depth.py) and simplifies it to
// a fixed geometric error, then packs all four into walls-relief.bin, the
// format hall-relief.ts reads:
//   "GHR1", u32 wallCount, then per wall (4-byte aligned):
//   char[12] id, u32 vertexCount, u32 triangleCount, u32 indexBytes (2|4),
//   f32[6] ranges (u0 u1 v0 v1 d0 d1), u16[vertexCount*3] quantised (u, v, depth),
//   indices (u16|u32)[triangleCount*3]
// Usage: node $SURVEY/relief-mesh.mjs <out.bin> [errorMetres]      (run in the work directory)
import { readFileSync, writeFileSync } from "node:fs";
import { meshoptimizer } from "./modules.mjs";

const { MeshoptSimplifier } = await meshoptimizer();
const [out, errArg] = process.argv.slice(2);
const error = Number(errArg ?? 0.005);
const V_MIN = 0, V_MAX = 6.7, D_MIN = -1.0, D_MAX = 0.9;
// HALL_WALLS order; the survey files call the fireplace wall "fire".
const WALLS = [["window", "window"], ["end", "end"], ["door", "door"], ["fireplace", "fire"]];
await MeshoptSimplifier.ready;

function meshWall(file) {
  const meta = JSON.parse(readFileSync(`relief/${file}.json`, "utf8"));
  const raw = readFileSync(`relief/${file}.f32`);
  const D = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const { width, height, ppm, top, length } = meta;
  const r0 = Math.max(0, Math.round((top - V_MAX) * ppm));
  const r1 = Math.min(height - 1, Math.round((top - V_MIN) * ppm));
  const rows = r1 - r0 + 1;
  // Grid vertices on texel centres, with the outermost pinned to the wall's
  // ends, the floor and the ceiling so neighbouring surfaces meet exactly.
  const columns = width;
  const positions = new Float32Array(columns * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const k = (r * columns + c) * 3;
      positions[k] = c === 0 ? 0 : c === columns - 1 ? length : (c + 0.5) / ppm;
      positions[k + 1] = r === 0 ? V_MAX : r === rows - 1 ? V_MIN : top - (r0 + r + 0.5) / ppm;
      positions[k + 2] = Math.min(D_MAX, Math.max(D_MIN, D[(r0 + r) * width + c]));
    }
  }
  const grid = new Uint32Array((rows - 1) * (columns - 1) * 6);
  let n = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c, b = a + 1, d = a + columns, e = d + 1;
      // Counter-clockwise seen from the room: u right, v up, depth toward the viewer.
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
  const ranges = [0, length, V_MIN, V_MAX, D_MIN, D_MAX];
  const quantised = new Uint16Array(kept.length * 3);
  kept.forEach((v, i) => {
    for (let axis = 0; axis < 3; axis++) {
      const lo = ranges[axis * 2], hi = ranges[axis * 2 + 1];
      quantised[i * 3 + axis] = Math.round(((positions[v * 3 + axis] - lo) / (hi - lo)) * 65535);
    }
  });
  console.log(file, "grid", grid.length / 3, "->", indices.length / 3, "triangles,", kept.length, "vertices, error", achieved.toFixed(4));
  return { ranges, quantised, indices, vertexCount: kept.length };
}

const chunks = [];
const header = new ArrayBuffer(8);
new Uint8Array(header).set([0x47, 0x48, 0x52, 0x31]);
new DataView(header).setUint32(4, WALLS.length, true);
chunks.push(Buffer.from(header));
const pad = () => { const size = chunks.reduce((s, c) => s + c.length, 0); if (size % 4) chunks.push(Buffer.alloc(4 - (size % 4))); };
for (const [id, file] of WALLS) {
  const wall = meshWall(file);
  const indexBytes = wall.vertexCount <= 65535 ? 2 : 4;
  const head = Buffer.alloc(12 + 12 + 24);
  head.write(id, 0, "ascii");
  head.writeUInt32LE(wall.vertexCount, 12);
  head.writeUInt32LE(wall.indices.length / 3, 16);
  head.writeUInt32LE(indexBytes, 20);
  wall.ranges.forEach((value, i) => head.writeFloatLE(value, 24 + i * 4));
  chunks.push(head);
  chunks.push(Buffer.from(wall.quantised.buffer));
  pad();
  const idx = indexBytes === 2 ? new Uint16Array(wall.indices) : wall.indices;
  chunks.push(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength));
  pad();
}
const file = Buffer.concat(chunks);
writeFileSync(out, file);
console.log(out, file.length, "bytes");
