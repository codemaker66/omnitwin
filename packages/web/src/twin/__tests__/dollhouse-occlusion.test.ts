import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import type { TwinScanNode } from "@omnitwin/types";
import {
  PEEL_FOOTPRINT_MARGIN_M,
  PEEL_FRAGMENT_BLOCK,
  PEEL_FRAGMENT_PRELUDE,
  PEEL_RADIUS_MARGIN_M,
  PEEL_RADIUS_MAX_M,
  PEEL_RADIUS_MIN_M,
  PEEL_KEEP_BELOW_OFFSET_M,
  applyOcclusionPeel,
  computeRoomFocus,
  createPeelUniforms,
  updatePeelUniforms,
} from "../dollhouse-occlusion.js";

// e57PointToThree maps [x, y, z]e57 → [x, z, −y]three (twin-basis pinned).
function makeNode(
  id: string,
  t: readonly [number, number, number],
  floor: number,
  roomSlug: string | null,
): TwinScanNode {
  return { id, index: Number(id.slice(-3)), pose: { q: [1, 0, 0, 0], t: [...t] }, floor, roomSlug };
}

describe("computeRoomFocus", () => {
  it("returns null when the current node is unknown", () => {
    expect(computeRoomFocus([makeNode("scan_000", [0, 0, 1.5], 0, null)], "scan_999")).toBeNull();
  });

  it("centres on the current node and keeps the floor below tripod height", () => {
    const focus = computeRoomFocus(
      [makeNode("scan_001", [10, 5, 1.5], 1, "grand-hall")],
      "scan_001",
    );
    expect(focus).not.toBeNull();
    expect(focus?.center).toEqual([10, 1.5, -5]);
    expect(focus?.keepBelowY).toBeCloseTo(1.5 - PEEL_KEEP_BELOW_OFFSET_M);
  });

  it("sizes the window from the farthest same-room peer plus margin", () => {
    const nodes = [
      makeNode("scan_001", [10, 5, 1.5], 1, "grand-hall"),
      makeNode("scan_002", [14, 5, 1.5], 1, "grand-hall"),
      // Other room, farther away — must not widen the window.
      makeNode("scan_003", [30, 5, 1.5], 1, "saloon"),
    ];
    const focus = computeRoomFocus(nodes, "scan_001");
    expect(focus?.radiusM).toBeCloseTo(4 + PEEL_RADIUS_MARGIN_M);
  });

  it("clamps the window to its bounds", () => {
    const lonely = computeRoomFocus(
      [makeNode("scan_001", [0, 0, 1.5], 0, "saloon")],
      "scan_001",
    );
    expect(lonely?.radiusM).toBe(PEEL_RADIUS_MIN_M);
    const sprawling = computeRoomFocus(
      [
        makeNode("scan_001", [0, 0, 1.5], 0, "grand-hall"),
        makeNode("scan_002", [40, 0, 1.5], 0, "grand-hall"),
      ],
      "scan_001",
    );
    expect(sprawling?.radiusM).toBe(PEEL_RADIUS_MAX_M);
  });

  it("falls back to nearby same-floor peers when the node is untagged", () => {
    const nodes = [
      makeNode("scan_001", [0, 0, 1.5], 0, null),
      makeNode("scan_002", [5, 0, 1.5], 0, null), // within reach — counts
      makeNode("scan_003", [20, 0, 1.5], 0, null), // beyond reach — ignored
      makeNode("scan_004", [1, 0, 6.0], 1, null), // other floor — ignored
    ];
    const focus = computeRoomFocus(nodes, "scan_001");
    expect(focus?.radiusM).toBeCloseTo(5 + PEEL_RADIUS_MARGIN_M);
  });

  it("derives the room footprint from the node spread plus margin", () => {
    // e57 [x, y, z] → world [x, z, −y]: spread x 10..14, worldZ −8..−5.
    const nodes = [
      makeNode("scan_001", [10, 5, 1.5], 1, "grand-hall"),
      makeNode("scan_002", [14, 8, 1.5], 1, "grand-hall"),
      makeNode("scan_003", [12, 6, 1.5], 1, "grand-hall"),
    ];
    const focus = computeRoomFocus(nodes, "scan_001");
    expect(focus?.footprintCenter[0]).toBeCloseTo(12);
    expect(focus?.footprintCenter[1]).toBeCloseTo(-6.5);
    expect(focus?.footprintHalf[0]).toBeCloseTo(2 + PEEL_FOOTPRINT_MARGIN_M);
    expect(focus?.footprintHalf[1]).toBeCloseTo(1.5 + PEEL_FOOTPRINT_MARGIN_M);
  });

  it("keeps the footprint tight for a lone node (walls just outside can still peel)", () => {
    const focus = computeRoomFocus(
      [makeNode("scan_001", [3, 2, 1.5], 0, "saloon")],
      "scan_001",
    );
    expect(focus?.footprintCenter).toEqual([3, -2]);
    expect(focus?.footprintHalf[0]).toBeCloseTo(PEEL_FOOTPRINT_MARGIN_M);
    expect(focus?.footprintHalf[1]).toBeCloseTo(PEEL_FOOTPRINT_MARGIN_M);
  });
});

describe("updatePeelUniforms", () => {
  const focus = {
    center: [10, 1.5, -5] as const,
    radiusM: 5,
    keepBelowY: 0.3,
    footprintCenter: [10, -5] as const,
    footprintHalf: [4, 3] as const,
  };

  it("aims the cylinder from the camera at the focus", () => {
    const uniforms = createPeelUniforms();
    updatePeelUniforms(uniforms, new Vector3(10, 1.5, 15), focus, 0.6);
    expect(uniforms.venPeelDir.value.toArray()).toEqual([0, 0, -1]);
    expect(uniforms.venPeelFocusT.value).toBeCloseTo(20);
    expect(uniforms.venPeelRadius.value).toBe(5);
    expect(uniforms.venPeelKeepBelowY.value).toBe(0.3);
    expect(uniforms.venPeelStrength.value).toBeCloseTo(0.6);
    // Footprint side test inputs: box carried through, horizontal
    // room→camera direction normalized (+z here).
    expect(uniforms.venPeelRoomCenter.value.toArray()).toEqual([10, -5]);
    expect(uniforms.venPeelRoomHalf.value.toArray()).toEqual([4, 3]);
    expect(uniforms.venPeelDirHoriz.value.toArray()).toEqual([0, 1]);
  });

  it("zeroes strength directly overhead (degenerate horizontal direction)", () => {
    const uniforms = createPeelUniforms();
    updatePeelUniforms(uniforms, new Vector3(10, 30, -5), focus, 1);
    expect(uniforms.venPeelStrength.value).toBe(0);
  });

  it("clamps strength into [0, 1]", () => {
    const uniforms = createPeelUniforms();
    updatePeelUniforms(uniforms, new Vector3(0, 0, 10), focus, 7);
    expect(uniforms.venPeelStrength.value).toBe(1);
  });

  it("zeroes strength for a null focus and for a degenerate ray", () => {
    const uniforms = createPeelUniforms();
    updatePeelUniforms(uniforms, new Vector3(0, 0, 10), focus, 1);
    updatePeelUniforms(uniforms, new Vector3(0, 0, 10), null, 1);
    expect(uniforms.venPeelStrength.value).toBe(0);
    updatePeelUniforms(uniforms, new Vector3(10, 1.5, -5), focus, 1);
    expect(uniforms.venPeelStrength.value).toBe(0);
  });
});

describe("applyOcclusionPeel", () => {
  /** The patch reads exactly these three fields — assert the subset up. */
  function fakeShader(): WebGLProgramParametersWithUniforms {
    const shader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <fog_vertex>\n}",
      fragmentShader: "void main() {\n#include <clipping_planes_fragment>\n}",
    };
    return shader as WebGLProgramParametersWithUniforms;
  }

  /** The renderer is never dereferenced — three hands it through untouched. */
  function stubRenderer(): WebGLRenderer {
    return {} as WebGLRenderer;
  }

  it("injects the peel stages and shares the live uniform objects", () => {
    const material = new MeshStandardMaterial();
    const uniforms = createPeelUniforms();
    applyOcclusionPeel(material, uniforms);
    const shader = fakeShader();
    material.onBeforeCompile(shader, stubRenderer());
    expect(shader.vertexShader).toContain("venPeelWorldPos = ( modelMatrix");
    expect(shader.vertexShader).toContain("#include <fog_vertex>");
    expect(shader.fragmentShader).toContain(PEEL_FRAGMENT_PRELUDE);
    expect(shader.fragmentShader).toContain("#include <clipping_planes_fragment>");
    expect(shader.fragmentShader).toContain("discard");
    // Identity, not copies — the per-frame update must reach the program.
    expect(shader.uniforms["venPeelStrength"]).toBe(uniforms.venPeelStrength);
    material.dispose();
  });

  it("chains a pre-existing onBeforeCompile and namespaces the cache key", () => {
    const material = new MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    applyOcclusionPeel(material, createPeelUniforms());
    const shader = fakeShader();
    material.onBeforeCompile(shader, stubRenderer());
    expect(before).toHaveBeenCalledTimes(1);
    expect(material.customProgramCacheKey()).toContain("ven-peel");
    material.dispose();
  });

  it("keeps the dither block gated on strength so idle frames cost nothing", () => {
    expect(PEEL_FRAGMENT_BLOCK.startsWith("if ( venPeelStrength > 0.001 )")).toBe(true);
  });
});
