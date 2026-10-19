import { describe, expect, it } from "vitest";
import { FLOOR_BOARD_WIDTH, FLOOR_DETAIL_FADE, FLOOR_SEAM, createOakFloorMaterial } from "../hall-floor.js";
import { vec3 } from "three/tsl";

describe("the drawn oak floor's distance fades", () => {
  it("lets the seams go before the boards' own tones, so the floor never changes pattern part way across", () => {
    const [seamStart, seamEnd] = FLOOR_DETAIL_FADE.seams;
    const [toneStart, toneEnd] = FLOOR_DETAIL_FADE.tone;
    expect(seamStart).toBeLessThan(seamEnd);
    expect(toneStart).toBeLessThan(toneEnd);
    // The tones are still whole where the seams have gone...
    expect(toneStart).toBeGreaterThanOrEqual(seamStart);
    // ...and last until a board is about a pixel wide (one board a pixel or more).
    expect(toneEnd).toBeGreaterThanOrEqual(1);
    // The seams fade while a board is still a few pixels wide: under a tenth of
    // a pixel each, any later and they alias into lines along the strips.
    expect((FLOOR_SEAM / FLOOR_BOARD_WIDTH) * (1 / seamEnd)).toBeLessThan(0.1);
  });

  it("builds its material", () => {
    const material = createOakFloorMaterial(vec3(1, 1, 1));
    expect(material.emissiveNode).not.toBeNull();
    expect(material.roughnessNode).not.toBeNull();
    material.dispose();
  });
});
