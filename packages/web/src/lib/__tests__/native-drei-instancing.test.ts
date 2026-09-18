import { describe, expect, it } from "vitest";
import { InstancedBufferAttribute } from "three";
import { setUpdateRange } from "@react-three/drei/helpers/deprecated.js";

describe("Drei instance uploads to native Three renderers", () => {
  it.each([3, 16])("uses Three's current update-range contract for %i-component attributes", (itemSize) => {
    const attribute = new InstancedBufferAttribute(new Float32Array(160 * itemSize), itemSize);
    // Drei Instances supplies an offset; WebGPU expects a finite `start` index.
    // A missing start becomes NaN in GPUQueue.writeBuffer and aborts the frame.
    setUpdateRange(attribute, { offset: 2 * itemSize, count: 144 * itemSize });
    expect(attribute.updateRanges).toEqual([{ start: 2 * itemSize, count: 144 * itemSize }]);
    const range = attribute.updateRanges[0];
    if (range === undefined) throw new Error("Expected a GPU upload range");
    expect(Number.isSafeInteger(range.start * attribute.array.BYTES_PER_ELEMENT)).toBe(true);
    expect(range.start + range.count).toBeLessThanOrEqual(attribute.array.length);
    attribute.clearUpdateRanges();
    setUpdateRange(attribute, { offset: 0, count: 18 * itemSize });
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 18 * itemSize }]);
  });
});
