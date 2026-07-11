import { afterEach, describe, expect, it } from "vitest";
import {
  TURN_FLOOR_BOUNDS,
  YOUR_TABLE_DEFAULT,
  clampToFloorBounds,
  hasYourTable,
  loadYourTable,
  saveYourTable,
  turnWeight,
} from "../turn.js";

// ---------------------------------------------------------------------------
// turn — the mode-change math and the endowment's persistence. The weight
// bell gates the scrim/sheet to the act; the clamp keeps the visitor's table
// on observed floor; storage degrades silently and never trusts what it
// reads back.
// ---------------------------------------------------------------------------

afterEach(() => {
  window.localStorage.clear();
});

describe("turnWeight — night rises, holds, and hands back", () => {
  it("is dark-free before the act and after it", () => {
    expect(turnWeight(0)).toBe(0);
    expect(turnWeight(0.05)).toBe(0);
    expect(turnWeight(1)).toBe(0);
  });

  it("holds full night while the visitor works the sheet", () => {
    expect(turnWeight(0.3)).toBe(1);
    expect(turnWeight(0.6)).toBe(1);
    expect(turnWeight(0.85)).toBe(1);
  });

  it("rises and falls monotonically within [0, 1]", () => {
    let prev = 0;
    for (let p = 0.05; p <= 0.3001; p += 0.01) {
      const w = turnWeight(p);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    prev = 1;
    for (let p = 0.85; p <= 1.0001; p += 0.01) {
      const w = turnWeight(p);
      expect(w).toBeLessThanOrEqual(prev);
      prev = w;
    }
  });
});

describe("clampToFloorBounds — the table stays on observed floor", () => {
  it("leaves interior positions untouched", () => {
    expect(clampToFloorBounds(-2, 7)).toEqual({ x: -2, z: 7 });
  });

  it("clamps runaways inside the margin", () => {
    const clamped = clampToFloorBounds(-100, 100);
    expect(clamped.x).toBe(TURN_FLOOR_BOUNDS.minX + 1.5);
    expect(clamped.z).toBe(TURN_FLOOR_BOUNDS.maxZ - 1.5);
  });

  it("keeps the default position legal under its own rule", () => {
    expect(clampToFloorBounds(YOUR_TABLE_DEFAULT.x, YOUR_TABLE_DEFAULT.z)).toEqual(
      YOUR_TABLE_DEFAULT,
    );
  });
});

describe("engagement — the adaptive threshold reads ownership", () => {
  it("is false for an untouched room and true once a table is saved", () => {
    expect(hasYourTable()).toBe(false);
    saveYourTable({ x: -2, z: 8 });
    expect(hasYourTable()).toBe(true);
    expect(hasYourTable("grand-hall")).toBe(false);
  });
});

describe("persistence — the endowment survives the visit", () => {
  it("round-trips a placement", () => {
    saveYourTable({ x: -3.25, z: 4.5 });
    expect(loadYourTable()).toEqual({ x: -3.25, z: 4.5 });
  });

  it("ignores another room's table", () => {
    saveYourTable({ x: -3, z: 4 }, "reception-room");
    expect(loadYourTable("grand-hall")).toBeNull();
  });

  it("never trusts corrupt storage", () => {
    window.localStorage.setItem("lh-your-table.v1", "{not json");
    expect(loadYourTable()).toBeNull();
    window.localStorage.setItem(
      "lh-your-table.v1",
      JSON.stringify({ v: 2, room: "reception-room", x: 1, z: 1 }),
    );
    expect(loadYourTable()).toBeNull();
    window.localStorage.setItem(
      "lh-your-table.v1",
      JSON.stringify({ v: 1, room: "reception-room", x: "a", z: 1 }),
    );
    expect(loadYourTable()).toBeNull();
  });

  it("clamps whatever it reads back onto the floor", () => {
    window.localStorage.setItem(
      "lh-your-table.v1",
      JSON.stringify({ v: 1, room: "reception-room", x: 999, z: -999 }),
    );
    expect(loadYourTable()).toEqual({
      x: TURN_FLOOR_BOUNDS.maxX - 1.5,
      z: TURN_FLOOR_BOUNDS.minZ + 1.5,
    });
  });
});
