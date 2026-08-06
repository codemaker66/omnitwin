import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_TRADES_HALL_FACADE_MAX_DRAW_CALLS,
  createSyntheticTradesHallFacadeLayout,
} from "../SyntheticTradesHallFacade.js";

describe("SyntheticTradesHallFacade", () => {
  it("builds a bounded presentation-only facade behind the room envelope", () => {
    const room = { width: 21, length: 10.5, height: 7 } as const;
    const layout = createSyntheticTradesHallFacadeLayout(room);

    expect(layout.presentationOnly).toBe(true);
    expect(layout.position[2]).toBeLessThan(-(room.length / 2));
    expect(layout.estimatedDrawCalls).toBeLessThanOrEqual(
      SYNTHETIC_TRADES_HALL_FACADE_MAX_DRAW_CALLS,
    );
    expect(layout.massing.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...layout.massing.map((instance) => instance.scale[2]))).toBeLessThan(1);
    expect(layout.glass.length).toBeGreaterThanOrEqual(10);
    expect(layout.trim.length).toBeGreaterThanOrEqual(40);
    expect(layout.columns).toHaveLength(4);
  });

  it("produces finite positive transforms for every repeated detail", () => {
    const layout = createSyntheticTradesHallFacadeLayout({
      width: 21,
      length: 10.5,
      height: 7,
    });
    const instances = [
      ...layout.massing,
      ...layout.trim,
      ...layout.glass,
      ...layout.archGlass,
      ...layout.medallions,
      ...layout.columns,
      ...layout.copperDetails,
    ];

    for (const instance of instances) {
      expect(instance.position.every(Number.isFinite)).toBe(true);
      expect(instance.scale.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    }
  });

  it("rejects non-positive or non-finite room dimensions", () => {
    expect(() => createSyntheticTradesHallFacadeLayout({ width: 0, length: 10, height: 7 }))
      .toThrow(RangeError);
    expect(() => createSyntheticTradesHallFacadeLayout({ width: 21, length: Number.NaN, height: 7 }))
      .toThrow(RangeError);
  });

  it("does not ship facade photo textures into the runtime", async () => {
    const source = await readFile(
      resolve("src/components/editor/SyntheticTradesHallFacade.tsx"),
      "utf-8",
    );

    expect(source).not.toContain("useTexture");
    expect(source).not.toContain("TextureLoader");
    expect(source).not.toMatch(/\.(?:jpe?g|png|webp)/i);
    expect(source).toContain("affectsRoomEnvelope: false");
    expect(source).toContain("affectsCapacity: false");
    expect(source).toContain("affectsHistory: false");
  });
});
