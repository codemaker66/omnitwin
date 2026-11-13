// A GHR1 relief file written as the tools write one (relief-container.ts has
// the layout), for tests that need a file's bytes rather than a parsed mesh.

export interface ReliefEntrySource {
  readonly id: string;
  /** (u, v, depth) per vertex, metres. */
  readonly positions: readonly number[];
  /** Three per triangle. */
  readonly indices: readonly number[];
}

const align = (offset: number): number => (offset + 3) & ~3;

/** The lowest and highest value on one axis, widened where they coincide (a range must increase). */
function axisRange(positions: readonly number[], axis: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = axis; i < positions.length; i += 3) {
    lo = Math.min(lo, positions[i] ?? 0);
    hi = Math.max(hi, positions[i] ?? 0);
  }
  return hi > lo ? [lo, hi] : [lo - 0.5, lo + 0.5];
}

/** Packs entries into one GHR1 file, quantising each axis to 16 bits over its own range. */
export function encodeReliefFile(entries: readonly ReliefEntrySource[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const head = new DataView(new ArrayBuffer(8));
  [0x47, 0x48, 0x52, 0x31].forEach((byte, i) => { head.setUint8(i, byte); });
  head.setUint32(4, entries.length, true);
  chunks.push(new Uint8Array(head.buffer));
  for (const entry of entries) {
    const ranges = [0, 1, 2].map((axis) => axisRange(entry.positions, axis));
    const header = new DataView(new ArrayBuffer(48));
    for (let i = 0; i < entry.id.length; i++) header.setUint8(i, entry.id.charCodeAt(i));
    header.setUint32(12, entry.positions.length / 3, true);
    header.setUint32(16, entry.indices.length / 3, true);
    header.setUint32(20, 2, true);
    ranges.forEach(([lo, hi], axis) => {
      header.setFloat32(24 + axis * 8, lo, true);
      header.setFloat32(28 + axis * 8, hi, true);
    });
    chunks.push(new Uint8Array(header.buffer));
    const vertices = new Uint8Array(align(entry.positions.length * 2));
    const quantised = new Uint16Array(vertices.buffer, 0, entry.positions.length);
    entry.positions.forEach((value, i) => {
      const [lo, hi] = ranges[i % 3] ?? [0, 1];
      quantised[i] = Math.round(((value - lo) / (hi - lo)) * 65535);
    });
    chunks.push(vertices);
    const indices = new Uint8Array(align(entry.indices.length * 2));
    new Uint16Array(indices.buffer, 0, entry.indices.length).set(entry.indices);
    chunks.push(indices);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

/** A wall's relief as one flat rectangle, counter-clockwise seen from the room. */
export function flatWallEntry(id: string, length: number, height: number, depth = 0): ReliefEntrySource {
  return { id, positions: [0, 0, depth, length, 0, depth, length, height, depth, 0, height, depth], indices: [0, 1, 2, 0, 2, 3] };
}

/** A ceiling's relief as one flat rectangle over (x, z), counter-clockwise seen from below. */
export function flatCeilingEntry(id: string, x: readonly [number, number], z: readonly [number, number], depth = 0): ReliefEntrySource {
  return { id, positions: [x[0], z[0], depth, x[1], z[0], depth, x[1], z[1], depth, x[0], z[1], depth], indices: [0, 1, 2, 0, 2, 3] };
}
