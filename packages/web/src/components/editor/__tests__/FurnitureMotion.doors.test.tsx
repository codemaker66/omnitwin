import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllFurnitureSettles, furnitureSettleOffset } from "../../../lib/furniture-motion.js";
import { announceDoorSlide } from "../../../stores/door-clear-space-store.js";
import { mountInStubRoot, type StubRoot } from "../../__tests__/stub-r3f-root.js";
import { FurnitureMotion } from "../FurnitureMotion.js";

// Pieces moved clear of a door (Blake's door rule) are drawn from where they
// were set down and slide to where they now stand; under reduced motion they
// simply stand there.

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => motion.reduced }));

let mounted: StubRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  motion.reduced = false;
  clearAllFurnitureSettles();
});

describe("FurnitureMotion and the doors", () => {
  it("starts pieces slid clear of a door where they were set down", () => {
    mounted = mountInStubRoot(<FurnitureMotion />);
    act(() => { announceDoorSlide({ ids: ["table", "chair"], dx: 0.5, dz: -1 }); });
    expect(furnitureSettleOffset("table")).toEqual({ x: -0.5, z: 1 });
    expect(furnitureSettleOffset("chair")).toEqual({ x: -0.5, z: 1 });
  });

  it("lets them stand where they now are under reduced motion", () => {
    motion.reduced = true;
    mounted = mountInStubRoot(<FurnitureMotion />);
    act(() => { announceDoorSlide({ ids: ["table"], dx: 0.5, dz: -1 }); });
    expect(furnitureSettleOffset("table")).toBeNull();
  });
});
