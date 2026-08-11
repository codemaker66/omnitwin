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
    // Side-on vantage: 10 m out horizontally, only 4 m up (21.8 deg) — below
    // the retraction band, so the section sits at its full inset.
    const updated = updateVerticalCutawayPlane(plane, {
      cameraPosition: new Vector3(20, 8, -3),
      target: new Vector3(10, 4, -3),
      witnesses: [new Vector3(18, 1, -3), new Vector3(2, 1, -3)],
      insetM: 2,
    });

    expect(updated).toBe(true);
    expect(plane.normal.toArray()).toEqual([-1, 0, -0]);
    // Camera-most witness at x = 18, inset 2 → section at x = 16.
    expect(plane.distanceToPoint(new Vector3(15, 200, -3))).toBeCloseTo(1);
    expect(plane.distanceToPoint(new Vector3(17, -200, -3))).toBeCloseTo(-1);
  });

  it("engages side-on with a horizontal normal, and retracts clear of the hull when the camera climbs", () => {
    const lowPlane = new Plane();
    const highPlane = new Plane(new Vector3(-1, 0, 0), 2);
    const witnesses = [new Vector3(8, -10, 4), new Vector3(-2, 40, 4)];
    const input = {
      target: new Vector3(2, 3, 4),
      witnesses,
      insetM: 2,
    };

    // Eye-level orbit: engages, and the normal carries no vertical component
    // (floors and the dome can never be sliced by the section itself).
    expect(
      updateVerticalCutawayPlane(lowPlane, {
        ...input,
        cameraPosition: new Vector3(20, 3, 4),
      }),
    ).toBe(true);
    expect(lowPlane.normal.y).toBe(0);
    // Camera-most witness at x = 8, inset 2 → section at x = 6, so the
    // camera-side witness is removed and the far one survives.
    expect(lowPlane.distanceToPoint(witnesses[0]!)).toBeLessThan(0);
    expect(lowPlane.distanceToPoint(witnesses[1]!)).toBeGreaterThan(0);

    // Elevated orbit: the open-top scan already shows the interior, so the
    // section must be out of the way. It gets there by retracting to a parked
    // position beyond the hull — NOT by teleporting to an inert constant,
    // which is the step change that popped a slab of building into and out of
    // existence at 32 degrees. It still describes a real, finite plane.
    expect(
      updateVerticalCutawayPlane(highPlane, {
        ...input,
        cameraPosition: new Vector3(20, 300, 4),
      }),
    ).toBe(true);
    expect(highPlane.normal.y).toBe(0);
    expect(highPlane.constant).toBeLessThan(1_000);
    for (const witness of witnesses) {
      expect(highPlane.distanceToPoint(witness)).toBeGreaterThan(0);
    }
  });

  it("moves the section inward by the requested inset", () => {
    const shallow = new Plane();
    const deep = new Plane();
    const common = {
      cameraPosition: new Vector3(20, 0, 0),
      target: new Vector3(0, 0, 0),
      witnesses: [new Vector3(12, 0, 0)],
    };

    updateVerticalCutawayPlane(shallow, { ...common, insetM: 1 });
    updateVerticalCutawayPlane(deep, { ...common, insetM: 3 });
    expect(shallow.distanceToPoint(new Vector3(10, 0, 0))).toBeCloseTo(1);
    expect(deep.distanceToPoint(new Vector3(10, 0, 0))).toBeCloseTo(-1);
  });

  it("refuses to cut past the mid-point when the scan is sparse on the camera side", () => {
    // A witness set that barely reaches toward the camera: 3 m of reach
    // against a 6 m inset. Taken literally the section would land 3 m BEYOND
    // the target and black out well over half the building.
    const plane = new Plane();
    updateVerticalCutawayPlane(plane, {
      cameraPosition: new Vector3(40, 0, 0),
      target: new Vector3(0, 0, 0),
      witnesses: [new Vector3(3, 0, 0), new Vector3(-25, 0, 0)],
      insetM: 6,
    });

    // Held at half the camera-side reach instead: x = 1.5, so everything from
    // the target outward to the far wall survives.
    expect(plane.distanceToPoint(new Vector3(0, 0, 0))).toBeCloseTo(1.5);
    expect(plane.distanceToPoint(new Vector3(-25, 0, 0))).toBeCloseTo(26.5);
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

// -----------------------------------------------------------------------------
// Regression guard for the reported defect: "a weird cut off that blacks out a
// huge part of the model based on camera angle".
//
// The cause was a hard predicate at 32 degrees of elevation — full inset below,
// inert above — so one orbit step could add or remove a whole slab of building.
// Measured on the live dollhouse before the fix: 31.85 deg → constant 15.33,
// 33.98 deg → constant 1,000,000.
//
// These tests sweep the orbit and assert the section moves CONTINUOUSLY, both in
// the quantity we drive (the plane constant) and in what it actually removes
// (the share of a sample cloud spanning the building that ends up clipped).
// -----------------------------------------------------------------------------

/** Hall-sized scan poses: 18 m x 8 m of camera stations at standing height. */
function hallWitnesses(): Vector3[] {
  const witnesses: Vector3[] = [];
  for (let x = -9; x <= 9; x += 1.5) {
    for (let z = -4; z <= 4; z += 2) {
      witnesses.push(new Vector3(x, 1.6, z));
    }
  }
  return witnesses;
}

/**
 * A deterministic cloud standing in for the mesh, spread wider than the poses
 * so it covers the shell behind them. Random rather than gridded: a grid clips
 * a whole row at once, which quantises the measurement into steps far larger
 * than the plane's real per-step travel.
 */
function sampleCloud(): Vector3[] {
  let seed = 0x2f6e2b1;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const points: Vector3[] = [];
  for (let i = 0; i < 6000; i += 1) {
    points.push(
      new Vector3(random() * 26 - 13, random() * 8, random() * 14 - 7),
    );
  }
  return points;
}

function orbitCamera(
  target: Vector3,
  radiusM: number,
  elevationDeg: number,
  azimuthDeg: number,
): Vector3 {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  return new Vector3(
    target.x + radiusM * Math.cos(elevation) * Math.cos(azimuth),
    target.y + radiusM * Math.sin(elevation),
    target.z + radiusM * Math.cos(elevation) * Math.sin(azimuth),
  );
}

function clippedFraction(plane: Plane, cloud: readonly Vector3[]): number {
  let clipped = 0;
  for (const point of cloud) {
    if (plane.distanceToPoint(point) < 0) {
      clipped += 1;
    }
  }
  return clipped / cloud.length;
}

describe("cutaway continuity across the orbit", () => {
  const TARGET = new Vector3(0, 2, 0);
  const RADIUS_M = 25;
  const INSET_M = 4;
  const STEP_DEG = 0.25;

  it("moves the section continuously as the camera climbs through the old 32 degree switch", () => {
    const witnesses = hallWitnesses();
    const cloud = sampleCloud();
    const plane = new Plane();
    const constants: number[] = [];
    const clipped: number[] = [];

    for (let elevationDeg = 0; elevationDeg <= 89; elevationDeg += STEP_DEG) {
      const engaged = updateVerticalCutawayPlane(plane, {
        cameraPosition: orbitCamera(TARGET, RADIUS_M, elevationDeg, 37),
        target: TARGET,
        witnesses,
        insetM: INSET_M,
      });
      // A degenerate result anywhere in the band would be a teleport to the
      // inert constant — the exact defect. Every orbit angle must resolve.
      expect(engaged).toBe(true);
      constants.push(plane.constant);
      clipped.push(clippedFraction(plane, cloud));
    }

    // Epsilon, derived rather than guessed. Azimuth is fixed, so the witness
    // projections and therefore the section's travel are fixed too: it runs
    // from `max - inset` (5.59 m) out to `max + hull/2` (19.19 m), 13.6 m in
    // all. Smoothstep's steepest slope is 1.5 / band = 1.5 / 40 per degree, so
    // one 0.25 deg step can move the plane at most 13.6 * 0.0375 * 0.25 =
    // 0.13 m. 0.2 m leaves headroom without admitting anything a viewer could
    // read as a pop. The old code stepped by ~999,985 m here.
    const MAX_CONSTANT_STEP_M = 0.2;
    let worstConstantStep = 0;
    for (let i = 1; i < constants.length; i += 1) {
      worstConstantStep = Math.max(
        worstConstantStep,
        Math.abs(constants[i]! - constants[i - 1]!),
      );
    }
    expect(worstConstantStep).toBeLessThan(MAX_CONSTANT_STEP_M);

    // And continuity in what is actually removed. 0.13 m of plane travel across
    // a 26 m wide cloud is ~0.5% of the points; 2% absorbs the sampling noise
    // of a 6000-point cloud without admitting a visible slab.
    const MAX_CLIPPED_STEP = 0.02;
    let worstClippedStep = 0;
    for (let i = 1; i < clipped.length; i += 1) {
      worstClippedStep = Math.max(
        worstClippedStep,
        Math.abs(clipped[i]! - clipped[i - 1]!),
      );
    }
    expect(worstClippedStep).toBeLessThan(MAX_CLIPPED_STEP);

    // The sweep has to actually traverse the transition, or "continuous" is
    // vacuously true — a cutaway that never engages would also pass the two
    // assertions above. Side-on must remove a real slab; plan view must remove
    // nothing at all.
    expect(clipped[0]!).toBeGreaterThan(0.15);
    expect(clipped[clipped.length - 1]!).toBe(0);

    // Climbing may only ever reveal geometry, never hide it.
    for (let i = 1; i < clipped.length; i += 1) {
      expect(clipped[i]!).toBeLessThanOrEqual(clipped[i - 1]!);
    }
  });

  it("keeps the interior open at every side-on elevation", () => {
    const witnesses = hallWitnesses();
    const cloud = sampleCloud();
    const plane = new Plane();

    // The whole point of the cutaway. A "fix" that disables it fails here.
    for (let elevationDeg = 0; elevationDeg <= 30; elevationDeg += 1) {
      updateVerticalCutawayPlane(plane, {
        cameraPosition: orbitCamera(TARGET, RADIUS_M, elevationDeg, 37),
        target: TARGET,
        witnesses,
        insetM: INSET_M,
      });
      expect(clippedFraction(plane, cloud)).toBeGreaterThan(0.15);
      // The far side of the hall must survive at every one of them.
      expect(plane.distanceToPoint(new Vector3(-9, 1.6, -4))).toBeGreaterThan(0);
    }
  });

  it("moves the section continuously as the camera orbits around the building", () => {
    const witnesses = hallWitnesses();
    const cloud = sampleCloud();
    const plane = new Plane();
    const clipped: number[] = [];

    // Azimuth is the other half of "camera angle": the section depth comes from
    // a max over a discrete pose set, which can thin out on one side of the
    // building. Swept at a mid-band elevation so the retraction is live too.
    for (let azimuthDeg = 0; azimuthDeg <= 360; azimuthDeg += 0.5) {
      updateVerticalCutawayPlane(plane, {
        cameraPosition: orbitCamera(TARGET, RADIUS_M, 20, azimuthDeg),
        target: TARGET,
        witnesses,
        insetM: INSET_M,
      });
      clipped.push(clippedFraction(plane, cloud));
    }

    let worstStep = 0;
    let leanest = 1;
    for (let i = 1; i < clipped.length; i += 1) {
      worstStep = Math.max(worstStep, Math.abs(clipped[i]! - clipped[i - 1]!));
      leanest = Math.min(leanest, clipped[i]!);
    }
    expect(worstStep).toBeLessThan(0.02);
    // Not vacuous: the section is doing real work from every direction, so
    // "smooth" here cannot be satisfied by a plane that clips nothing.
    expect(leanest).toBeGreaterThan(0.1);
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
