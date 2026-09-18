import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Euler, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { createNativeRoomClip, mergeNativeSplatSources } from "../native-splat-merge.js";

function geometry(position = [1, 2, 3], covariance = [1, 0, 0, 4, 0, 9]): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  result.setAttribute("covariance", new BufferAttribute(new Float32Array(covariance), 6));
  result.setAttribute("color", new BufferAttribute(new Uint8Array([128, 64, 32, 200]), 4, true));
  return result;
}

describe("native global splat merge", () => {
  it("preserves source order and attributes across tiles and transformed parent groups", () => {
    const first = geometry();
    const parent = new Object3D();
    parent.rotation.z = Math.PI / 2;
    const anchor = new Object3D();
    anchor.position.set(10, 0, 0);
    parent.add(anchor);
    anchor.updateWorldMatrix(true, false);
    const merged = mergeNativeSplatSources([
      { geometry: first, matrix: new Matrix4(), maxSh: 3 },
      { geometry: first, matrix: anchor.matrixWorld, maxSh: 3 },
    ]);
    expect([...merged.tileIndices]).toEqual([0, 1]);
    expect([...merged.geometry.getAttribute("position").array]).toEqual([1, 2, 3, -2, 11, 3]);
    expect([...merged.geometry.getAttribute("color").array]).toEqual([128, 64, 32, 200, 128, 64, 32, 200]);
    const c = merged.geometry.getAttribute("covariance");
    expect(c.getComponent(1, 0)).toBeCloseTo(4);
    expect(c.getComponent(1, 3)).toBeCloseTo(1);
    expect(c.getComponent(1, 5)).toBeCloseTo(9);
    expect([...first.getAttribute("position").array]).toEqual([1, 2, 3]);
  });

  it("transforms covariance under arbitrary rotation/nonuniform scale and preserves SH basis", () => {
    const source = geometry();
    const matrix = new Matrix4().compose(new Vector3(7, -2, 4), new Quaternion().setFromEuler(new Euler(0.3, -0.6, 0.9)), new Vector3(2, 3, 4));
    const merged = mergeNativeSplatSources([{ geometry: source, matrix, maxSh: 3 }]);
    const linear = new Matrix3().setFromMatrix4(matrix);
    const expected = linear.clone().multiply(new Matrix3().set(1, 0, 0, 0, 4, 0, 0, 0, 9)).multiply(linear.clone().transpose());
    const values = merged.geometry.getAttribute("covariance").array;
    const e = expected.elements;
    [e[0], e[3], e[6], e[4], e[7], e[8]].forEach((value, index) => { expect(values[index]).toBeCloseTo(value, 4); });
    const originalDirection = new Vector3(1, -2, 3).normalize();
    const worldDirection = originalDirection.clone().applyMatrix3(linear);
    const restored = worldDirection.applyMatrix3(merged.inverseTransforms[0] ?? new Matrix3()).normalize();
    expect(restored.distanceTo(originalDirection)).toBeLessThan(1e-12);
  });

  it("honors each source SH cap and fills absent bands with exact packed zero coefficients", () => {
    const first = geometry(), second = geometry();
    first.setAttribute("sphericalHarmonics1", new BufferAttribute(new Uint32Array([1, 2, 3]), 3));
    first.setAttribute("sphericalHarmonics2", new BufferAttribute(new Uint32Array([4, 5, 6, 7]), 4));
    second.setAttribute("sphericalHarmonics1", new BufferAttribute(new Uint32Array([8, 9, 10]), 3));
    const merged = mergeNativeSplatSources([
      { geometry: first, matrix: new Matrix4(), maxSh: 2 },
      { geometry: second, matrix: new Matrix4(), maxSh: 0 },
    ]);
    expect([...merged.geometry.getAttribute("sphericalHarmonics1").array]).toEqual([1, 2, 3, 0x80808080, 0x80808080, 0x80808080]);
    expect([...merged.geometry.getAttribute("sphericalHarmonics2").array]).toEqual([4, 5, 6, 7, 0x80808080, 0x80808080, 0x80808080, 0x80808080]);
    expect(merged.geometry.hasAttribute("sphericalHarmonics3")).toBe(false);
  });

  it("rejects malformed data, singular transforms and a device limit before allocating the merged scene", () => {
    const source = geometry();
    expect(() => mergeNativeSplatSources([{ geometry: source, matrix: new Matrix4(), maxSh: 3 }], 15)).toThrow("coarser complete capture level");
    expect(() => mergeNativeSplatSources([{ geometry: source, matrix: new Matrix4().makeScale(0, 1, 1), maxSh: 3 }])).toThrow("invertible");
    const perspective = new Matrix4(); perspective.elements[3] = 0.1;
    expect(() => mergeNativeSplatSources([{ geometry: source, matrix: perspective, maxSh: 3 }])).toThrow("affine");
    const malformed = geometry();
    malformed.setAttribute("color", new BufferAttribute(new Float32Array([1, 1, 1, 1]), 4));
    expect(() => mergeNativeSplatSources([{ geometry: malformed, matrix: new Matrix4(), maxSh: 3 }])).toThrow("RGBA bytes");
    const nonfinite = geometry([NaN, 2, 3]);
    expect(() => mergeNativeSplatSources([{ geometry: nonfinite, matrix: new Matrix4(), maxSh: 3 }])).toThrow("non-finite");
  });
});

describe("native room cutaway", () => {
  it("preserves floor, wall margin, ceiling cut and edge width", () => {
    expect(createNativeRoomClip([10, 4, 8])).toEqual({ center: [0, 2, 0], halfExtent: [5.35, 2.35, 4.35], softEdge: 0.12 });
    expect(createNativeRoomClip([10, 4, 8], 0.35, 0.12, 0.5)).toEqual({ center: [0, 1, 0], halfExtent: [5.35, 1, 4.35], softEdge: 0.12 });
    expect(createNativeRoomClip([10, 4, 8], 0.35, 0, 0)?.halfExtent[1]).toBe(0.2);
    expect(createNativeRoomClip([10, NaN, 8])).toBeNull();
  });
});
