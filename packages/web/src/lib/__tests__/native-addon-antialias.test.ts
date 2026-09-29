import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("three/examples/jsm/objects/GaussianSplat.js"), "utf8");

describe("patched GaussianSplat anti-aliasing option (T-639)", () => {
  it("accepts an antialias option that defaults to upstream behaviour", () => {
    expect(source).toContain("constructor( splatGeometry, { antialias = true, autoSort = true,");
  });

  it("skips the opacity compensation when antialias is false", () => {
    expect(source).toContain("const alphaScale = ( antialias ? sqrt( max( detBase.div( max( det, 0.000001 ) ), 0 ) ) : float( 1 ) ).toVar( 'alphaScale' );");
  });
});
