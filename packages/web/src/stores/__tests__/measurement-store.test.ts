import { describe, it, expect, beforeEach } from "vitest";
import { useMeasurementStore } from "../measurement-store.js";
import type { Point3 } from "../../lib/measurement.js";
import { RENDER_SCALE } from "../../constants/scale.js";

const initialState = useMeasurementStore.getState();

beforeEach(() => {
  useMeasurementStore.setState(initialState, true);
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initial state", () => {
  it("starts inactive", () => {
    expect(useMeasurementStore.getState().active).toBe(false);
  });

  it("starts with no pending point", () => {
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });

  it("starts with no measurements", () => {
    expect(useMeasurementStore.getState().measurements).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// activate / deactivate / toggle
// ---------------------------------------------------------------------------

describe("activate / deactivate", () => {
  it("activate sets active to true", () => {
    useMeasurementStore.getState().activate();
    expect(useMeasurementStore.getState().active).toBe(true);
  });

  it("deactivate sets active to false and clears pending", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    expect(useMeasurementStore.getState().pendingPoint).not.toBeNull();

    useMeasurementStore.getState().deactivate();
    expect(useMeasurementStore.getState().active).toBe(false);
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });

  it("toggle flips active state", () => {
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(true);
    useMeasurementStore.getState().toggle();
    expect(useMeasurementStore.getState().active).toBe(false);
  });

  it("toggle clears pending when deactivating", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([1, 2, 3]);
    useMeasurementStore.getState().toggle(); // deactivate
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// placePoint
// ---------------------------------------------------------------------------

describe("placePoint", () => {
  it("does nothing when inactive", () => {
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
    expect(useMeasurementStore.getState().measurements).toHaveLength(0);
  });

  it("first click sets pending point", () => {
    useMeasurementStore.getState().activate();
    const point: Point3 = [1, 2, 3];
    useMeasurementStore.getState().placePoint(point);
    expect(useMeasurementStore.getState().pendingPoint).toEqual(point);
    expect(useMeasurementStore.getState().measurements).toHaveLength(0);
  });

  it("second click completes a measurement", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([6, 0, 0]);

    const { measurements, pendingPoint } = useMeasurementStore.getState();
    expect(measurements).toHaveLength(1);
    expect(pendingPoint).toBeNull();

    const m = measurements[0];
    expect(m).toBeDefined();
    if (m !== undefined) {
      expect(m.pointA).toEqual([0, 0, 0]);
      expect(m.pointB).toEqual([6, 0, 0]);
      expect(m.distance).toBeCloseTo(6 / RENDER_SCALE);
      expect(m.id).toBe(1);
    }
  });

  it("increments ID for each measurement", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([1, 0, 0]);
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([2, 0, 0]);

    const { measurements } = useMeasurementStore.getState();
    expect(measurements).toHaveLength(2);
    expect(measurements[0]?.id).toBe(1);
    expect(measurements[1]?.id).toBe(2);
  });

  it("can place multiple measurements sequentially", () => {
    useMeasurementStore.getState().activate();
    for (let i = 0; i < 5; i++) {
      useMeasurementStore.getState().placePoint([0, 0, 0]);
      useMeasurementStore.getState().placePoint([i + 1, 0, 0]);
    }
    expect(useMeasurementStore.getState().measurements).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// cancelPending
// ---------------------------------------------------------------------------

describe("cancelPending", () => {
  it("clears pending point", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([1, 2, 3]);
    expect(useMeasurementStore.getState().pendingPoint).not.toBeNull();

    useMeasurementStore.getState().cancelPending();
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });

  it("does not affect completed measurements", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([1, 0, 0]);
    useMeasurementStore.getState().placePoint([5, 5, 5]); // new pending

    useMeasurementStore.getState().cancelPending();
    expect(useMeasurementStore.getState().measurements).toHaveLength(1);
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// removeMeasurement
// ---------------------------------------------------------------------------

describe("removeMeasurement", () => {
  it("removes a measurement by ID", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([1, 0, 0]);
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([2, 0, 0]);

    useMeasurementStore.getState().removeMeasurement(1);
    const { measurements } = useMeasurementStore.getState();
    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.id).toBe(2);
  });

  it("does nothing for non-existent ID", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([1, 0, 0]);

    useMeasurementStore.getState().removeMeasurement(999);
    expect(useMeasurementStore.getState().measurements).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------

describe("clearAll", () => {
  it("removes all measurements and pending point", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().placePoint([0, 0, 0]);
    useMeasurementStore.getState().placePoint([1, 0, 0]);
    useMeasurementStore.getState().placePoint([5, 5, 5]); // pending

    useMeasurementStore.getState().clearAll();
    expect(useMeasurementStore.getState().measurements).toHaveLength(0);
    expect(useMeasurementStore.getState().pendingPoint).toBeNull();
  });

  it("does not deactivate the tool", () => {
    useMeasurementStore.getState().activate();
    useMeasurementStore.getState().clearAll();
    expect(useMeasurementStore.getState().active).toBe(true);
  });
});
