import { describe, expect, it } from "vitest";
import { Box3, Color, DirectionalLight, Matrix3, OrthographicCamera, Scene, Vector3, WebGLRenderTarget } from "three";
import { applyProps } from "@react-three/fiber";
import { GRAND_HALL_FURNITURE_LIGHTING_PROBE as measurement } from "../../data/grand-hall-furniture-lighting-probe.js";
import {
  createFurnitureLightProbe, furnitureShadowFrame, FURNITURE_KEY_DIRECTION,
  FURNITURE_KEY_RGB, resolveFurnitureLightingExperiment,
  refreshFurnitureShadowProjection,
} from "../furniture-lighting-experiment.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem } from "../placement.js";
import {
  createGeneratedFurnitureObject, disposeGeneratedFurnitureObject,
} from "../../components/meshes/generated/generatedFurnitureRegistry.js";

const active = { development: true, roomSlug: "grand-hall", layerMode: "splat", splatActive: true, timelinePreviewActive: false };
describe("furniture lighting experiment", () => {
  it("composes proper candidate panorama-to-E57-to-served rotations without silently accepting azimuth", () => {
    const fromRows = (rows: readonly (readonly number[])[]) => new Matrix3().fromArray(rows.flat()).transpose();
    const upright = fromRows(measurement.target_zup_to_served_yup_rotation);
    const targetFromE57 = fromRows(measurement.candidate_target_from_e57_rotation);
    const e57FromPanorama = fromRows(measurement.candidate_e57_from_panorama_rotation);
    const composed = upright.clone().multiply(targetFromE57).multiply(e57FromPanorama);
    const recorded = fromRows(measurement.candidate_served_from_panorama_rotation);
    for (const matrix of [upright, targetFromE57, e57FromPanorama, composed]) {
      expect(matrix.determinant()).toBeCloseTo(1, 6);
      const identity = matrix.clone().transpose().multiply(matrix);
      identity.elements.forEach((value, index) => { expect(value).toBeCloseTo(index % 4 === 0 ? 1 : 0, 6); });
    }
    composed.elements.forEach((value, index) => { expect(value).toBeCloseTo(recorded.elements[index] ?? 0, 10); });
    // The panorama's CV camera is right/down/forward. Its zenith is -camera-Y.
    const zenith = new Vector3(0, -1, 0).applyMatrix3(composed);
    expect(zenith.y).toBeGreaterThan(.999);
    // The independently identified window ROI should face the -X window wall
    // in the served hero view. This sign is a visual plausibility check only.
    expect(measurement.regions.window_blue_sky.candidate_served_direction[0]).toBeLessThan(-.7);
    expect(measurement.source_sha256).toBe("d9d056e2453a223144514bdca224bbdfb7e76f4bd7130008a3d811afa67eb974");
    expect(measurement.accepted_registration).toBe(false);
  });
  it("requires explicit local opt-in and the captured Grand Hall alone", () => {
    for (const value of ["panorama", "panorama-shadow"] as const) {
      const input = { ...active, search: `?furniture-lighting=${value}` };
      expect(resolveFurnitureLightingExperiment(input)).toBe(value);
      for (const override of [{ development: false }, { roomSlug: "saloon" }, { roomSlug: null },
        { layerMode: "hybrid" }, { layerMode: "mesh" }, { splatActive: false }, { timelinePreviewActive: true }]) {
        expect(resolveFurnitureLightingExperiment({ ...input, ...override })).toBe("baseline");
      }
    }
    for (const search of ["", "?furniture-lighting=1", "?furniture-lighting=PANORAMA", "?furniture-lighting=bad"]) {
      expect(resolveFurnitureLightingExperiment({ ...active, search })).toBe("baseline");
    }
  });

  it("matches baseline upward diffuse exposure with Three's actual SH convention", () => {
    const probe = createFurnitureLightProbe();
    const irradiance = probe.sh.getIrradianceAt(new Vector3(0, 1, 0), new Vector3())
      .addScaledVector(new Vector3(...FURNITURE_KEY_RGB), FURNITURE_KEY_DIRECTION.y);
    const luminance = irradiance.dot(new Vector3(.2126, .7152, .0722));
    const sky = new Color("#f0f0ff");
    const baseline = (sky.r*.2126+sky.g*.7152+sky.b*.0722)*1.2+.3;
    expect(luminance).toBeCloseTo(baseline, 5);
    expect(luminance).toBeCloseTo(measurement.upward_candidate_luminance, 8);
    expect(probe.sh.coefficients).toHaveLength(9);
  });

  it("retains positive diffuse light around the whole sphere without upgrading source authority", () => {
    const probe = createFurnitureLightProbe();
    for (let index = 0; index < 1000; index += 1) {
      const y = 1-2*(index+.5)/1000;
      const angle = index*Math.PI*(3-Math.sqrt(5));
      const radius = Math.sqrt(1-y*y);
      const light = probe.sh.getIrradianceAt(new Vector3(radius*Math.cos(angle), y, radius*Math.sin(angle)), new Vector3());
      expect(Math.min(light.x, light.y, light.z)).toBeGreaterThan(0);
    }
    expect(FURNITURE_KEY_DIRECTION.length()).toBeCloseTo(1, 10);
    expect(FURNITURE_KEY_DIRECTION.y).toBeGreaterThan(.9);
    expect(measurement.regions.window_blue_sky.candidate_served_direction[0]).toBeLessThan(0);
    expect(measurement.radiometrically_calibrated).toBe(false);
    expect(measurement.accepted_registration).toBe(false);
  });

  it("rejects malformed coefficients before sending them to the renderer", () => {
    expect(() => createFurnitureLightProbe([])).toThrow("nine finite");
    const invalid = Array.from({ length: 9 }, () => [0, 0, 0]);
    invalid[0] = [0, Number.NaN, 0];
    expect(() => createFurnitureLightProbe(invalid)).toThrow("nine finite");
  });

  it("fits actual generated furniture geometry after rotation, scale and elevation", () => {
    for (const slug of ["round-table-6ft", "banquet-chair", "trestle-6ft"] as const) {
      const item = getCatalogueItemBySlug(slug);
      if (item === undefined) throw new Error("missing catalogue fixture");
      const placed = { ...createPlacedItem(item.id, 7, -4, .73, null, 1.2), scale: 1.8 };
      const frame = furnitureShadowFrame([placed]);
      const camera = new OrthographicCamera(frame.left, frame.right, frame.top, frame.bottom, frame.near, frame.far);
      camera.position.fromArray(frame.position);
      camera.lookAt(new Vector3().fromArray(frame.target));
      camera.updateMatrixWorld(true);
      const root = createGeneratedFurnitureObject(slug);
      try {
        root.position.set(placed.x, placed.y, placed.z);
        root.rotation.y = placed.rotationY;
        root.scale.setScalar(placed.scale);
        root.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(root);
        // The axis-aligned world bounds are conservative relative to the mesh.
        // Its corners can overhang a tight projected fit, so verify actual vertices.
        expect(bounds.isEmpty()).toBe(false);
        root.traverse((object) => {
          if (!("geometry" in object) || typeof object.geometry !== "object" || object.geometry === null
            || !("getAttribute" in object.geometry)) return;
          const geometry = object.geometry as import("three").BufferGeometry;
          const positions = geometry.getAttribute("position");
          for (let index = 0; index < positions.count; index += 1) {
            const point = new Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(camera);
            expect(Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))).toBeLessThanOrEqual(1);
          }
        });
      } finally { disposeGeneratedFurnitureObject(root); }
    }
  });

  it("keeps an empty layout's shadow projection finite and usable", () => {
    const frame = furnitureShadowFrame([]);
    expect(frame.right).toBeGreaterThan(frame.left);
    expect(frame.top).toBeGreaterThan(frame.bottom);
    expect(frame.near).toBeGreaterThan(0);
    expect(frame.far).toBeGreaterThan(frame.near);
  });

  it("refreshes the existing shadow projection after furniture edits without replacing its light or map", () => {
    const item = getCatalogueItemBySlug("round-table-6ft");
    if (item === undefined) throw new Error("missing catalogue fixture");
    const original = { ...createPlacedItem(item.id, 0, 0, 0, null, 0), scale: 1 };
    const light = new DirectionalLight();
    const scene = new Scene();
    scene.add(light, light.target);
    // R3F's real applyProps invokes onUpdate only for attached instances.
    Object.assign(light, { __r3f: { parent: scene, eventCount: 0 } });
    const map = new WebGLRenderTarget(2048, 2048);
    light.shadow.map = map; // Simulate the allocation already made by the first shadow frame.
    const update = (frame: ReturnType<typeof furnitureShadowFrame>) => {
      light.target.position.fromArray(frame.target);
      applyProps(light, {
        position: frame.position,
        "shadow-camera-left": frame.left, "shadow-camera-right": frame.right,
        "shadow-camera-top": frame.top, "shadow-camera-bottom": frame.bottom,
        "shadow-camera-near": frame.near, "shadow-camera-far": frame.far,
        onUpdate: refreshFurnitureShadowProjection,
      });
      scene.updateMatrixWorld(true);
      light.shadow.updateMatrices(light);
    };
    try {
      update(furnitureShadowFrame([original]));
      const firstProjection = light.shadow.camera.projectionMatrix.clone();
      const moved = { ...original, x: 12, z: -7, y: 1.2, rotationY: .73, scale: 1.8 };
      update(furnitureShadowFrame([original, moved]));
      expect(light.shadow.map).toBe(map);
      expect(light.shadow.camera.projectionMatrix.equals(firstProjection)).toBe(false);
      for (const placed of [original, moved]) {
        const root = createGeneratedFurnitureObject("round-table-6ft");
        try {
          root.position.set(placed.x, placed.y, placed.z);
          root.rotation.y = placed.rotationY;
          root.scale.setScalar(placed.scale);
          root.updateMatrixWorld(true);
          root.traverse((object) => {
            if (!("geometry" in object) || typeof object.geometry !== "object" || object.geometry === null
              || !("getAttribute" in object.geometry)) return;
            const positions = (object.geometry as import("three").BufferGeometry).getAttribute("position");
            for (let index = 0; index < positions.count; index += 1) {
              const point = new Vector3().fromBufferAttribute(positions, index)
                .applyMatrix4(object.matrixWorld).project(light.shadow.camera);
              expect(Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))).toBeLessThanOrEqual(1);
            }
          });
        } finally { disposeGeneratedFurnitureObject(root); }
      }
    } finally { light.dispose(); }
  });
});
