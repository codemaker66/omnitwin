/** Splat quads fitted to the 1/255 opacity contour in the patched native addon (T-644).
 * The reference 3DGS rasterizer never blends a fragment below 1/255 opacity, so the
 * trained scene carries no light there. The quad now reaches only that contour (never
 * beyond the kernel), the fragment stage discards below it, and the vertex stage culls a
 * splat whose peak never reaches it. Matched Grand Hall captures establish the image.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("three/examples/jsm/objects/GaussianSplat.js"), "utf8");

const KERNEL_RADIUS = Math.sqrt(8);
const THRESHOLD = 1 / 255;

// Mirror of the vertex stage: the quad's half-extent, in standard deviations, for a
// splat's opacity after the opacity node and anti-aliasing compensation.
function contourRadius(alpha: number): number {
  return Math.min(Math.sqrt(2 * Math.max(Math.log(255 * alpha), 0)), KERNEL_RADIUS);
}

describe("patched GaussianSplat opacity-contour quads (T-644)", () => {
  it("sizes each quad to its 1/255 contour and never beyond the kernel", () => {
    expect(source).toContain("const splatAlpha = color.a.mul( alphaScale ).toVar( 'splatAlpha' );");
    expect(source).toContain("const contourScale = min( max( splatAlpha.mul( 255 ).log(), 0 ).mul( 2 ).sqrt().div( kernelRadius ), 1 ).toVar( 'contourScale' );");
    expect(source).toContain("const contourCorner = corner.mul( contourScale ).toVar( 'contourCorner' );");
    expect(source).toContain("const offsetPixels = axis1.mul( contourCorner.x ).mul( scale1 ).add( axis2.mul( contourCorner.y ).mul( scale2 ) ).toVar( 'offsetPixels' );");
    expect(source).toContain("splatUv.assign( contourCorner );");
  });

  it("discards fragments below 1/255 and culls splats that never reach it", () => {
    expect(source).toContain("If( r2.greaterThan( kernelRadius * kernelRadius ).or( alpha.lessThan( 1 / 255 ) ), () => {");
    expect(source).toContain(".or( splatAlpha.lessThan( 1 / 255 ) )");
    expect(source).not.toContain(".or( color.a.lessThanEqual( 0.002 ) )");
  });

  it("keeps full quads for opaque splats and ends faint ones exactly at the threshold", () => {
    // From 255 alpha = e^4 (alpha ≈ 0.214) up, the contour lies outside the kernel: unchanged quad.
    for (const alpha of [1, 0.5, 0.215]) expect(contourRadius(alpha)).toBe(KERNEL_RADIUS);
    for (const alpha of [0.005, 0.01, 0.05, 0.1, 0.2]) {
      const radius = contourRadius(alpha);
      expect(radius).toBeLessThan(KERNEL_RADIUS);
      expect(alpha * Math.exp(-(radius * radius) / 2)).toBeCloseTo(THRESHOLD, 12);
    }
    // A splat whose peak is below the threshold has no quad at all.
    expect(contourRadius(THRESHOLD * 0.99)).toBe(0);
  });
});
