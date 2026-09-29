/** Sort-time culling in the patched native addon (T-640).
 * A WebGPU sort leaves out splats the vertex stage would discard and draws the
 * rest indirectly. These tests pin the plane derivation, the margin arithmetic
 * and the forced re-sort triggers with the actual addon and intercepted GPU
 * dispatch. Browser readback and matched captures establish the GPU result.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute, BufferGeometry, IndirectStorageBufferAttribute, Matrix4, OrthographicCamera,
  PerspectiveCamera, Quaternion, Vector3, Vector4, WebGPURenderer, type Camera,
} from "three/webgpu";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";

afterEach(() => { vi.restoreAllMocks(); });

// Mirrors of the addon constants: the vertex stage's centre clip margin and the
// camera travel and turn a culled order must tolerate before a forced re-sort.
const CLIP_XY = 1.4;
const TRANSLATION = 0.25;
const ROTATION = 2.5 * Math.PI / 180;

function splatGeometry(count = 64): BufferGeometry {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) positions.set([(i % 8) - 4, Math.floor(i / 8) - 4, -3 - (i % 5)], i * 3);
  const covariance = new Float32Array(count * 6);
  for (let i = 0; i < count; i += 1) covariance.set([0.01, 0, 0, 0.01, 0, 0.01], i * 6);
  const colors = new Uint8Array(count * 4).fill(200);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("covariance", new BufferAttribute(covariance, 6));
  geometry.setAttribute("color", new BufferAttribute(colors, 4, true));
  return geometry;
}

function fixture(camera: Camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500)) {
  const geometry = splatGeometry();
  const mesh = new GaussianSplat(geometry, { autoSort: false });
  // Never initialized: dispatch interception exercises the real addon without a GPU.
  const renderer = new WebGPURenderer();
  const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
  const sort = (target: WebGPURenderer = renderer): boolean => {
    camera.updateMatrixWorld(true);
    return mesh.updateSort(target, camera);
  };
  return { mesh, geometry, camera, renderer, compute, sort,
    cleanup: () => { mesh.dispose(); geometry.dispose(); } };
}

function cullPlanes(mesh: GaussianSplat): Vector4[] {
  const planes: unknown = Reflect.get(mesh, "_sortCullPlanes");
  if (!Array.isArray(planes) || planes.length !== 4) throw new Error("Missing sort cull planes");
  return planes.map((plane: unknown) => {
    const value: unknown = typeof plane === "object" && plane !== null ? Reflect.get(plane, "value") : null;
    if (!(value instanceof Vector4)) throw new Error("Invalid sort cull plane uniform");
    return value.clone();
  });
}

function cullEnabled(mesh: GaussianSplat): number {
  const margin: unknown = Reflect.get(mesh, "_sortCullMargin");
  const value: unknown = typeof margin === "object" && margin !== null ? Reflect.get(margin, "value") : null;
  if (!(value instanceof Vector3)) throw new Error("Invalid sort cull margin uniform");
  return value.z;
}

function outside(planes: readonly Vector4[], v: Vector3): number {
  return Math.max(...planes.map((p) => p.x * v.x + p.y * v.y + p.z * v.z + p.w));
}

/** The vertex stage's centre test: culled when |clip.xy| > CLIP_XY * clip.w or behind the camera. */
function vertexCulls(projection: Matrix4, v: Vector3, orthographic: boolean): boolean {
  const clip = new Vector4(v.x, v.y, v.z, 1).applyMatrix4(projection);
  if (!orthographic && v.z >= -0.01) return true;
  const limit = clip.w * CLIP_XY;
  return clip.x < -limit || clip.x > limit || clip.y < -limit || clip.y > limit;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

describe("sort-time cull planes", () => {
  const cameras: Array<[string, () => Camera, boolean]> = [
    ["perspective", () => new PerspectiveCamera(60, 16 / 9, 0.1, 500), false],
    ["off-centre perspective", () => {
      const camera = new PerspectiveCamera(50, 1.3, 0.05, 300);
      camera.setViewOffset(1600, 900, 220, -90, 1200, 700);
      return camera;
    }, false],
    ["orthographic", () => new OrthographicCamera(-12, 9, 6, -7, 0.1, 200), true],
  ];

  it.each(cameras)("reproduce the vertex stage's centre test for a %s camera", (_name, make, orthographic) => {
    const camera = make();
    const f = fixture(camera);
    try {
      expect(f.sort()).toBe(true);
      const planes = cullPlanes(f.mesh);
      const next = random(7);
      let disagreements = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const v = new Vector3((next() - 0.5) * 60, (next() - 0.5) * 40, (next() - 0.8) * 80);
        if (!orthographic && v.z > -0.02) continue; // behind-camera points are covered separately
        const planeCull = outside(planes, v) > 0;
        if (planeCull !== vertexCulls(camera.projectionMatrix, v, orthographic)) disagreements += 1;
      }
      expect(disagreements).toBe(0);
    } finally { f.cleanup(); }
  });

  it("place every point behind a perspective camera outside a plane", () => {
    const f = fixture();
    try {
      f.sort();
      const planes = cullPlanes(f.mesh);
      const next = random(11);
      for (let i = 0; i < 10_000; i += 1) {
        const v = new Vector3((next() - 0.5) * 60, (next() - 0.5) * 40, next() * 50 + 1e-3);
        expect(outside(planes, v)).toBeGreaterThan(0);
      }
    } finally { f.cleanup(); }
  });
});

describe("sort-time cull margins", () => {
  // Property test of the shader rule: excluded when the plane distance exceeds
  // M + (|v| + M) * a. Any motion that does not force a re-sort must keep every
  // excluded splat culled by the vertex stage.
  it("keep every excluded splat culled for any motion inside the re-sort thresholds", () => {
    const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 500);
    const f = fixture(camera);
    try {
      f.sort();
      const planes = cullPlanes(f.mesh);
      const next = random(23);
      let tested = 0;
      for (let i = 0; i < 4_000_000 && tested < 20_000; i += 1) {
        const v = new Vector3((next() - 0.5) * 30, (next() - 0.5) * 20, (next() - 0.6) * 40);
        const reach = TRANSLATION + (v.length() + TRANSLATION) * ROTATION;
        const d = outside(planes, v);
        // Adversarial band: just beyond the exclusion reach.
        if (d <= reach || d > reach + 0.25) continue;
        tested += 1;
        const axis = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize();
        const turn = new Quaternion().setFromAxisAngle(axis, 0.9 * ROTATION * next());
        const shift = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize().multiplyScalar(0.9 * TRANSLATION * next());
        const moved = v.clone().applyQuaternion(turn).add(shift);
        expect(vertexCulls(camera.projectionMatrix, moved, false)).toBe(true);
      }
      expect(tested).toBe(20_000);
    } finally { f.cleanup(); }
  });
});

describe("forced WebGPU re-sorts", () => {
  it("draw WebGPU orders indirectly with the sorted count and cull enabled", () => {
    const f = fixture();
    try {
      expect(f.sort()).toBe(true);
      const indirect = f.mesh.geometry.indirect;
      expect(indirect).toBeInstanceOf(IndirectStorageBufferAttribute);
      expect(indirect === null ? [] : [...indirect.array]).toEqual([6, 64, 0, 0, 0]);
      expect(cullEnabled(f.mesh)).toBe(1);
      expect(f.compute).toHaveBeenCalledOnce();
    } finally { f.cleanup(); }
  });

  it("re-sort only when translation or rotation reaches 90% of its margin", () => {
    const f = fixture();
    try {
      f.sort();
      const base = f.camera.position.clone();
      f.camera.position.copy(base).add(new Vector3(0.9 * TRANSLATION - 0.01, 0, 0));
      expect(f.sort()).toBe(false);
      f.camera.position.copy(base).add(new Vector3(0.9 * TRANSLATION + 0.01, 0, 0));
      expect(f.sort()).toBe(true);
      // Roll leaves the view direction unchanged, so only the cull margin can force it.
      f.camera.rotateZ(0.9 * ROTATION - 0.002);
      expect(f.sort()).toBe(false);
      f.camera.rotateZ(0.004);
      expect(f.sort()).toBe(true);
      expect(f.compute).toHaveBeenCalledTimes(3);
    } finally { f.cleanup(); }
  });

  it("re-sort for a projection or mesh transform change and ignore the sort interval", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const f = fixture(camera);
    try {
      f.mesh.minSortIntervalMs = 60_000;
      f.sort();
      camera.fov = 61;
      camera.updateProjectionMatrix();
      expect(f.sort()).toBe(true);
      f.mesh.position.y += 0.01;
      f.mesh.updateMatrixWorld(true);
      expect(f.sort()).toBe(true);
      expect(f.sort()).toBe(false);
      expect(f.compute).toHaveBeenCalledTimes(3);
    } finally { f.cleanup(); }
  });

  it("keep WebGL orders complete, direct and free of cull re-sorts", () => {
    const f = fixture();
    const webgl = new WebGPURenderer({ forceWebGL: true });
    const webglCompute = vi.spyOn(webgl, "compute").mockImplementation(() => { throw new Error("WebGL sorts on the CPU"); });
    try {
      expect(f.sort(webgl)).toBe(true);
      expect(f.mesh.geometry.indirect).toBeNull();
      expect(cullEnabled(f.mesh)).toBe(0);
      expect(f.mesh.geometry.instanceCount).toBe(64);
      f.camera.position.x += 3;
      expect(f.sort(webgl)).toBe(false);
      expect(webglCompute).not.toHaveBeenCalled();
    } finally { f.cleanup(); }
  });

  it("release the indirect draw arguments with the mesh", () => {
    const f = fixture();
    f.sort();
    const indirect = f.mesh.geometry.indirect;
    if (!(indirect instanceof IndirectStorageBufferAttribute)) throw new Error("Missing indirect arguments");
    const released = vi.fn();
    indirect.addEventListener("dispose", released);
    f.cleanup();
    expect(released).toHaveBeenCalledOnce();
  });
});
