import { useThree } from "@react-three/fiber";
import { describe, expect, it, vi } from "vitest";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { mountInStubRoot } from "../../../__tests__/stub-r3f-root.js";
import { CraftedFurniture } from "../CraftedFurniture.js";

// The real watcher list, with every watch and stop recorded.
const watched = vi.hoisted(() => ({ wakes: [] as (() => void)[], stopped: 0 }));
vi.mock("../crafted-textures.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crafted-textures.js")>();
  return {
    ...actual,
    onCraftedTexturePainted: (wake: () => void) => {
      watched.wakes.push(wake);
      const stop = actual.onCraftedTexturePainted(wake);
      return () => {
        watched.stopped += 1;
        stop();
      };
    },
  };
});

describe("CraftedFurniture", () => {
  it("watches for painted maps with its own canvas's invalidate, and stops when it unmounts", () => {
    const item = getCatalogueItemBySlug("chiavari-chair");
    if (item === undefined) throw new Error("Missing catalogue fixture chiavari-chair");
    const canvas: { invalidate: (() => void) | null } = { invalidate: null };
    function CanvasProbe(): null {
      canvas.invalidate = useThree((state) => state.invalidate);
      return null;
    }
    const mounted = mountInStubRoot(<><CanvasProbe /><CraftedFurniture item={item} /></>);
    try {
      expect(watched.wakes).toHaveLength(1);
      expect(watched.wakes[0]).toBe(canvas.invalidate);
      expect(watched.stopped).toBe(0);
    } finally {
      mounted.unmount();
    }
    expect(watched.stopped).toBe(1);
  });
});
