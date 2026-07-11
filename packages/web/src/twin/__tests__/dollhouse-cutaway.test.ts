import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Vector3,
} from "three";
import {
  cloneSceneWithCutawayPlane,
  cloneSceneWithCutawayPlanes,
  disposeCutawayScene,
  setInertCutawayPlane,
  updateVerticalCutawayPlane,
} from "../dollhouse-cutaway.js";

describe("vertical dollhouse cutaway", () => {
  it("clips the camera-side shell while retaining the interior side", () => {
    const plane = new Plane();
    const updated = updateVerticalCutawayPlane(plane, {
      cameraPosition: new Vector3(20, 50, -3),
      target: new Vector3(10, 4, -3),
      witnesses: [new Vector3(12, 1, -3), new Vector3(8, 1, -3)],
      insetM: 2,
    });

    expect(updated).toBe(true);
    expect(plane.normal.toArray()).toEqual([-1, 0, -0]);
    expect(plane.distanceToPoint(new Vector3(9, 200, -3))).toBeCloseTo(1);
    expect(plane.distanceToPoint(new Vector3(11, -200, -3))).toBeCloseTo(-1);
  });

  it("uses only horizontal camera direction so elevation cannot slice floors or the dome", () => {
    const lowPlane = new Plane();
    const highPlane = new Plane();
    const input = {
      target: new Vector3(2, 3, 4),
      witnesses: [new Vector3(8, -10, 4), new Vector3(-2, 40, 4)],
      insetM: 2,
    };

    expect(
      updateVerticalCutawayPlane(lowPlane, {
        ...input,
        cameraPosition: new Vector3(20, 3, 4),
      }),
    ).toBe(true);
    expect(
      updateVerticalCutawayPlane(highPlane, {
        ...input,
        cameraPosition: new Vector3(20, 300, 4),
      }),
    ).toBe(true);
    expect(highPlane.normal.toArray()).toEqual(lowPlane.normal.toArray());
    expect(highPlane.constant).toBe(lowPlane.constant);
    expect(highPlane.normal.y).toBe(0);
  });

  it("moves the section inward by the requested inset", () => {
    const shallow = new Plane();
    const deep = new Plane();
    const common = {
      cameraPosition: new Vector3(10, 0, 0),
      target: new Vector3(0, 0, 0),
      witnesses: [new Vector3(5, 0, 0)],
    };

    updateVerticalCutawayPlane(shallow, { ...common, insetM: 1 });
    updateVerticalCutawayPlane(deep, { ...common, insetM: 3 });
    expect(shallow.distanceToPoint(new Vector3(3, 0, 0))).toBeCloseTo(1);
    expect(deep.distanceToPoint(new Vector3(3, 0, 0))).toBeCloseTo(-1);
  });

  it("fails safe to an inert plane for invalid inputs", () => {
    const cases = [
      {
        cameraPosition: new Vector3(0, 4, 0),
        target: new Vector3(0, 0, 0),
        witnesses: [new Vector3(1, 0, 0)],
        insetM: 2,
      },
      {
        cameraPosition: new Vector3(5, 4, 0),
        target: new Vector3(0, 0, 0),
        witnesses: [],
        insetM: 2,
      },
      {
        cameraPosition: new Vector3(5, 4, 0),
        target: new Vector3(0, 0, 0),
        witnesses: [new Vector3(Number.NaN, 0, 0)],
        insetM: 2,
      },
    ];

    for (const input of cases) {
      const plane = new Plane(new Vector3(1, 0, 0), -50);
      expect(updateVerticalCutawayPlane(plane, input)).toBe(false);
      expect(plane.distanceToPoint(new Vector3(0, 0, 0))).toBeGreaterThan(100_000);
    }
  });

  it("can explicitly reset an active plane without changing shader shape", () => {
    const plane = new Plane(new Vector3(-1, 0, 0), 2);
    setInertCutawayPlane(plane);
    expect(plane.normal.toArray()).toEqual([0, 1, 0]);
    expect(plane.constant).toBe(1_000_000);
  });
});

describe("cutaway scene material isolation", () => {
  it("clones shared and multi-materials once while sharing geometry", () => {
    const source = new Group();
    const geometry = new BoxGeometry();
    const shared = new MeshStandardMaterial({ color: "red" });
    const secondary = new MeshBasicMaterial({ color: "blue" });
    const existingPlane = new Plane(new Vector3(0, 1, 0), 3);
    shared.clippingPlanes = [existingPlane];
    source.add(new Mesh(geometry, shared));
    source.add(new Mesh(geometry, shared));
    source.add(new Mesh(geometry, [shared, secondary]));
    const cutawayPlane = new Plane(new Vector3(-1, 0, 0), 2);

    const cloned = cloneSceneWithCutawayPlane(source, cutawayPlane);
    const clonedMeshes: Mesh[] = [];
    cloned.scene.traverse((object) => {
      if (object instanceof Mesh) {
        clonedMeshes.push(object);
      }
    });

    expect(cloned.materials).toHaveLength(2);
    expect(clonedMeshes).toHaveLength(3);
    expect(clonedMeshes[0]?.geometry).toBe(geometry);
    expect(clonedMeshes[1]?.material).toBe(clonedMeshes[0]?.material);
    expect(clonedMeshes[0]?.material).not.toBe(shared);
    const firstMaterial = clonedMeshes[0]?.material;
    expect(Array.isArray(firstMaterial)).toBe(false);
    if (!Array.isArray(firstMaterial) && firstMaterial !== undefined) {
      expect(firstMaterial.clippingPlanes).toEqual([existingPlane, cutawayPlane]);
    }
    expect(shared.clippingPlanes).toEqual([existingPlane]);
    expect((clonedMeshes[2]?.material as MeshStandardMaterial[])[0]).toBe(firstMaterial);
  });

  it("adds both camera-facing and floor-section planes without duplicating existing planes", () => {
    const sourceMaterial = new MeshStandardMaterial();
    const existing = new Plane(new Vector3(0, 0, 1), 4);
    const vertical = new Plane(new Vector3(-1, 0, 0), 2);
    const floor = new Plane(new Vector3(0, 1, 0), 0.78);
    sourceMaterial.clippingPlanes = [existing, vertical];
    const source = new Mesh(new BoxGeometry(), sourceMaterial);

    const cloned = cloneSceneWithCutawayPlanes(source, [vertical, floor]);
    const material = (cloned.scene as Mesh).material as MeshStandardMaterial;

    expect(material.clippingPlanes).toEqual([existing, vertical, floor]);
    expect(material.clippingPlanes?.[1]).toBe(vertical);
    expect(material.clippingPlanes?.[2]).toBe(floor);
    vertical.constant = 9;
    floor.constant = 1.25;
    expect(material.clippingPlanes?.[1]?.constant).toBe(9);
    expect(material.clippingPlanes?.[2]?.constant).toBe(1.25);
    expect(sourceMaterial.clippingPlanes).toEqual([existing, vertical]);
  });

  it("preserves distinct live planes that begin with equal inert coefficients", () => {
    const sourceMaterial = new MeshStandardMaterial();
    const vertical = new Plane();
    const floor = new Plane();
    setInertCutawayPlane(vertical);
    setInertCutawayPlane(floor);
    const source = new Mesh(new BoxGeometry(), sourceMaterial);

    const cloned = cloneSceneWithCutawayPlanes(source, [vertical, floor]);
    const material = (cloned.scene as Mesh).material as MeshStandardMaterial;

    expect(material.clippingPlanes).toHaveLength(2);
    expect(material.clippingPlanes?.[0]).toBe(vertical);
    expect(material.clippingPlanes?.[1]).toBe(floor);
    vertical.setComponents(1, 0, 0, 2);
    floor.setComponents(0, 1, 0, 3);
    expect(material.clippingPlanes?.[0]).toBe(vertical);
    expect(material.clippingPlanes?.[0]?.normal.x).toBe(1);
    expect(material.clippingPlanes?.[1]).toBe(floor);
    expect(material.clippingPlanes?.[1]?.normal.y).toBe(1);
  });

  it("disposes only the owned material clones", () => {
    const sourceMaterial = new MeshStandardMaterial();
    const source = new Mesh(new BoxGeometry(), sourceMaterial);
    const cloned = cloneSceneWithCutawayPlane(source, new Plane());
    const cloneDispose = vi.spyOn(cloned.materials[0]!, "dispose");
    const sourceDispose = vi.spyOn(sourceMaterial, "dispose");

    disposeCutawayScene(cloned);

    expect(cloneDispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).not.toHaveBeenCalled();
  });
});
