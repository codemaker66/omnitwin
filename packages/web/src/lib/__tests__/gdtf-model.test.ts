import { describe, it, expect } from "vitest";
import { selectFixtureModel, fixtureModelBasename } from "../gdtf-model.js";

function map(...paths: string[]): Map<string, Uint8Array> {
  return new Map(paths.map((p) => [p, new Uint8Array([1, 2, 3])]));
}

describe("selectFixtureModel", () => {
  it("prefers a self-contained .glb over a .gltf", () => {
    const sel = selectFixtureModel(map("models/gltf/base.gltf", "models/gltf/base.glb"));
    expect(sel?.path).toBe("models/gltf/base.glb");
    expect(sel?.kind).toBe("glb");
  });

  it("prefers the default LOD over gltf_low", () => {
    const sel = selectFixtureModel(map("models/gltf_low/base.gltf", "models/gltf/base.gltf"));
    expect(sel?.path).toBe("models/gltf/base.gltf");
  });

  it("falls back to a .gltf when there is no .glb", () => {
    const sel = selectFixtureModel(map("models/gltf/base.gltf"));
    expect(sel?.kind).toBe("gltf");
    expect(sel?.bytes).toBeInstanceOf(Uint8Array);
  });

  it("ignores non-glTF models (3ds / svg)", () => {
    expect(selectFixtureModel(map("models/3ds/base.3ds", "models/svg/top.svg"))).toBeNull();
  });

  it("returns null for an archive with no models", () => {
    expect(selectFixtureModel(new Map())).toBeNull();
  });

  it("carries the sibling files for resolving a .gltf's external resources", () => {
    const sel = selectFixtureModel(map("models/gltf/base.gltf", "models/gltf/base.bin"));
    expect(sel?.path).toBe("models/gltf/base.gltf");
    expect(sel?.siblings.has("models/gltf/base.bin")).toBe(true);
  });
});

describe("fixtureModelBasename", () => {
  it("returns the file name", () => {
    expect(fixtureModelBasename("models/gltf/base.bin")).toBe("base.bin");
    expect(fixtureModelBasename("base.glb")).toBe("base.glb");
  });
});
