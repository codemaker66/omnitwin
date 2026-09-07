import { describe, it, expect } from "vitest";
import { Matrix4, Vector3 } from "three";
import { planTheatreLayout } from "../theatre-layout.js";

describe("planTheatreLayout", () => {
  it("faces the audience down the room's longer axis, split by a centre aisle", () => {
    // 21 m (X) × 10 m (Z): longer axis is X → stage at the −X end, chairs face −X.
    const plan = planTheatreLayout(21, 10, { targetGuests: 150 });
    expect(plan.alongLength).toBe(false);
    expect(plan.seatsPerBlock).toBe(7);
    expect(plan.seatsPerRow).toBe(14);
    expect(plan.rows).toBe(11); // ceil(150 / 14)
    expect(plan.seatCount).toBe(154);
    expect(plan.seats.every((s) => s.rotationY === Math.PI / 2)).toBe(true);
    // Front row sits nearest the −X stage end.
    expect(Math.min(...plan.seats.map((s) => s.xM))).toBeCloseTo(-8.1, 5);
  });

  it("stages at the −Z end for a portrait room (chairs face −Z)", () => {
    const plan = planTheatreLayout(10, 21, { targetGuests: 150 });
    expect(plan.alongLength).toBe(true);
    expect(plan.seats.every((s) => s.rotationY === 0)).toBe(true);
  });

  it.each([[21, 10], [10, 21]])("points rendered chair fronts toward the stage in a %s by %s room", (width, length) => {
    const plan = planTheatreLayout(width, length, { targetGuests: 150 });
    expect(plan.seats.length).toBeGreaterThan(0);
    const stageDirection = plan.alongLength ? new Vector3(0, 0, -1) : new Vector3(-1, 0, 0);
    for (const seat of plan.seats) {
      const forward = new Vector3(0, 0, -1).transformDirection(new Matrix4().makeRotationY(seat.rotationY));
      expect(forward.dot(stageDirection)).toBeCloseTo(1, 8);
    }
  });

  it("fills the room when no target is given", () => {
    const full = planTheatreLayout(21, 10);
    expect(full.rows).toBe(20);
    expect(full.seatCount).toBe(280);
  });

  it("keeps the centre aisle clear (no seat spans it)", () => {
    const plan = planTheatreLayout(21, 10, { targetGuests: 100 });
    const half = plan.aisleM / 2;
    // alongLength is false → the cross axis is Z; no seat within ±aisle/2 of centre.
    expect(plan.seats.every((s) => Math.abs(s.zM) >= half - 1e-6)).toBe(true);
  });

  it("is empty for a room too small to seat anyone", () => {
    const plan = planTheatreLayout(1.5, 1.5, { targetGuests: 50 });
    expect(plan.seatCount).toBe(0);
    expect(plan.seats).toHaveLength(0);
  });
});
