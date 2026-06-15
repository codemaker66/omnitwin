import { describe, expect, it } from "vitest";
import type { SpaceDimensions } from "@omnitwin/types";
import {
  minimapLayout,
  minimapProject,
  minimapToWorld,
} from "../cockpit-minimap-model.js";

const DIMS: SpaceDimensions = { width: 40, length: 60, height: 7 };

describe("minimapLayout", () => {
  it("fits the longest room axis to the max pixel box, preserving aspect", () => {
    const layout = minimapLayout(DIMS, 120);
    expect(layout.scale).toBe(2);
    expect(layout.width).toBe(80);
    expect(layout.height).toBe(120);
  });
});

describe("minimapProject", () => {
  it("places the room centre at the middle of the inset", () => {
    const layout = minimapLayout(DIMS, 120);
    expect(minimapProject(0, 0, layout)).toEqual({ left: 40, top: 60 });
  });

  it("places the far/-Z, left/-X corner at the top-left", () => {
    const layout = minimapLayout(DIMS, 120);
    expect(minimapProject(-20, -30, layout)).toEqual({ left: 0, top: 0 });
    expect(minimapProject(20, 30, layout)).toEqual({ left: 80, top: 120 });
  });
});

describe("minimapToWorld", () => {
  it("inverts minimapProject", () => {
    const layout = minimapLayout(DIMS, 120);
    expect(minimapToWorld(40, 60, layout)).toEqual({ x: 0, z: 0 });
    expect(minimapToWorld(0, 0, layout)).toEqual({ x: -20, z: -30 });
    expect(minimapToWorld(80, 120, layout)).toEqual({ x: 20, z: 30 });
  });
});
