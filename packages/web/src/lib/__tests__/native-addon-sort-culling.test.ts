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

function footprintEnabled(mesh: GaussianSplat): number {
  const footprint: unknown = Reflect.get(mesh, "_sortCullFootprint");
  const value: unknown = typeof footprint === "object" && footprint !== null ? Reflect.get(footprint, "value") : null;
  if (!(value instanceof Vector3)) throw new Error("Invalid sort footprint uniform");
  return value.x;
}

function cullPlanesFor(camera: PerspectiveCamera): Vector4[] {
  const f = fixture(camera);
  try { f.sort(); return cullPlanes(f.mesh); } finally { f.cleanup(); }
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

const KERNEL = 2 * Math.SQRT2; // Venviewer's maxStdDev sqrt(8)
const DILATION = 4 * 0.3 / (256 * 256); // KERNEL_2D_SIZE px^2 in NDC for a buffer >= 256 px

type Covariance = readonly [number, number, number, number, number, number]; // c00 c01 c02 c11 c12 c22
interface Splat { readonly centre: Vector3; readonly covariance: Covariance }

function randomCovariance(next: () => number): Covariance {
  const axis = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize();
  const turn = new Quaternion().setFromAxisAngle(axis, next() * Math.PI);
  const sigma = [0, 1, 2].map(() => 0.001 * Math.exp(next() * Math.log(500)));
  const basis = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyQuaternion(turn));
  const c = (i: number, j: number): number => basis.reduce((sum, v, k) => sum + (sigma[k] ?? 0) ** 2 * v.getComponent(i) * v.getComponent(j), 0);
  return [c(0, 0), c(0, 1), c(0, 2), c(1, 1), c(1, 2), c(2, 2)];
}

function rotateCovariance(m: Covariance, q: Quaternion): Covariance {
  const r = new Matrix4().makeRotationFromQuaternion(q).elements;
  const full = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const rot = [[r[0] ?? 0, r[4] ?? 0, r[8] ?? 0], [r[1] ?? 0, r[5] ?? 0, r[9] ?? 0], [r[2] ?? 0, r[6] ?? 0, r[10] ?? 0]];
  const out = (i: number, j: number): number => {
    let sum = 0;
    for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) sum += (rot[i]?.[a] ?? 0) * (full[a]?.[b] ?? 0) * (rot[j]?.[b] ?? 0);
    return sum;
  };
  return [out(0, 0), out(0, 1), out(0, 2), out(1, 1), out(1, 2), out(2, 2)];
}

/** The vertex stage for one splat: culled by its centre test, or its fragment ellipse fully off-screen. */
function producesNoFragments(p: Matrix4, width: number, height: number, splat: Splat): boolean {
  const { centre: v, covariance: s } = splat;
  if (vertexCulls(p, v, false)) return true;
  const e = p.elements;
  const z = Math.min(v.z, -0.01);
  const fx = width / 2 * (e[0] ?? 0), fy = height / 2 * (e[5] ?? 0);
  const j00 = -fx / z, j11 = -fy / z, j02 = fx * v.x / (z * z), j12 = fy * v.y / (z * z);
  const a = j00 * j00 * s[0] + 2 * j00 * j02 * s[2] + j02 * j02 * s[5] + 0.3;
  const c = j11 * j11 * s[3] + 2 * j11 * j12 * s[4] + j12 * j12 * s[5] + 0.3;
  const clip = new Vector4(v.x, v.y, v.z, 1).applyMatrix4(p);
  const x = clip.x / clip.w, y = clip.y / clip.w;
  const hx = KERNEL * Math.sqrt(a) * 2 / width, hy = KERNEL * Math.sqrt(c) * 2 / height;
  return x - hx > 1 || x + hx < -1 || y - hy > 1 || y + hy < -1;
}

/** The sort's footprint rule as the patch writes it (perspective, unit model-view scale). */
function footprintExcluded(p: Matrix4, splat: Splat): boolean {
  const { centre: v, covariance: s } = splat;
  const e = p.elements;
  const reach = TRANSLATION + (v.length() + TRANSLATION) * ROTATION;
  const depth = -v.z - reach;
  if (!(depth > 0.05)) return false;
  const variance = (s[0] + s[3] + s[5]) / (depth * depth);
  const tanX = (Math.abs(v.x) + reach) / depth, tanY = (Math.abs(v.y) + reach) / depth;
  const edgeX = KERNEL * Math.sqrt((e[0] ?? 0) ** 2 * (1 + tanX * tanX) * variance + DILATION) + 1;
  const edgeY = KERNEL * Math.sqrt((e[5] ?? 0) ** 2 * (1 + tanY * tanY) * variance + DILATION) + 1;
  const row = (r: number): Vector4 => new Vector4(e[r], e[r + 4], e[r + 8], e[r + 12]);
  const [r0, r1, r3] = [row(0), row(1), row(3)];
  const centre = new Vector4(v.x, v.y, v.z, 1);
  const cx = r0.dot(centre), cy = r1.dot(centre), cw = r3.dot(centre);
  const plane = (n: Vector4, sign: number, edge: number, value: number): number =>
    (sign * value - edge * cw) / Math.hypot(sign * n.x - edge * r3.x, sign * n.y - edge * r3.y, sign * n.z - edge * r3.z);
  return Math.max(plane(r0, 1, edgeX, cx), plane(r0, -1, edgeX, cx), plane(r1, 1, edgeY, cy), plane(r1, -1, edgeY, cy)) > reach;
}

describe("sort-time footprint culling", () => {
  it("never excludes a splat that could put a fragment on screen inside the re-sort thresholds", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const next = random(41);
    const planes = cullPlanesFor(camera);
    let excluded = 0;
    for (let i = 0; i < 1_000_000 && excluded < 20_000; i += 1) {
      // Centres near the screen edges, where only the footprint test decides.
      const depth = 0.3 + next() * 40;
      const angleX = (next() - 0.5) * 2.6, angleY = (next() - 0.5) * 1.6;
      const splat: Splat = { centre: new Vector3(Math.tan(angleX) * depth, Math.tan(angleY) * depth, -depth), covariance: randomCovariance(next) };
      if (outside(planes, splat.centre) > TRANSLATION + (splat.centre.length() + TRANSLATION) * ROTATION) continue;
      if (!footprintExcluded(camera.projectionMatrix, splat)) continue;
      excluded += 1;
      for (let trial = 0; trial < 3; trial += 1) {
        const axis = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize();
        const turn = new Quaternion().setFromAxisAngle(axis, 0.9 * ROTATION * next());
        const shift = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize().multiplyScalar(0.9 * TRANSLATION * next());
        const moved: Splat = { centre: splat.centre.clone().applyQuaternion(turn).add(shift), covariance: rotateCovariance(splat.covariance, turn) };
        // 16:9 drawing buffers from the smallest the bound admits to 2x desktop.
        for (const [width, height] of [[455, 256], [1600, 900], [3200, 1800]] as const) {
          expect(producesNoFragments(camera.projectionMatrix, width, height, moved)).toBe(true);
        }
      }
    }
    expect(excluded).toBe(20_000);
  });

  it("enables the footprint test for perspective views only", () => {
    const perspective = fixture();
    const orthographic = fixture(new OrthographicCamera(-12, 9, 6, -7, 0.1, 200));
    try {
      perspective.sort();
      orthographic.sort();
      expect(footprintEnabled(perspective.mesh)).toBe(1);
      expect(footprintEnabled(orthographic.mesh)).toBe(0);
    } finally { perspective.cleanup(); orthographic.cleanup(); }
  });
});
