import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { RenderTarget } from "three";
import { mrt, output, vec4 } from "three/tsl";
import { NodeBuilder, WebGPURenderer, type MRTNode, type Renderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { floorLightOutput } from "../../components/editor/floor-light-output.js";
import { lightOnlyOutput } from "../../components/grand-hall/hall-street-light.js";
import { TargetSafeMRTNode, outputsForTarget, targetSafeMrt } from "../target-safe-mrt.js";

// three r186 writes only the outputs a draw's target names (MRTNode.setup). A
// snapshot's target (one texture, no name) names none of a material's own
// outputs, so three wrote `struct OutputType { }`, WebGPU refused the pipeline,
// and the plan sent with a layout came back blank with the sky on (4 Nov 2026,
// D:/claude/webgpu-target-safe-mrt/snap). PMREM's cube ("PMREM.cubeUv") is such
// a target too.

/** r186's own node builder, drawing into whatever `renderer` targets. */
class DrawBuilder extends NodeBuilder {
  constructor(renderer: Renderer) {
    super();
    this.renderer = renderer;
  }
}

/** A target with one texture per name, as a pass, a snapshot or PMREM makes one. */
function targetNamed(...names: string[]): RenderTarget {
  const target = new RenderTarget(1, 1, { count: names.length });
  names.forEach((name, index) => { target.textures[index]!.name = name; });
  return target;
}

/** How many attachments `outputs` writes, drawn into `target` (r186's MRTNode.setup). */
function membersDrawnInto(outputs: MRTNode, target: RenderTarget): number {
  const renderer = new WebGPURenderer();
  renderer.setRenderTarget(target);
  outputs.setup(new DrawBuilder(renderer));
  // No hole before the last attachment written: three's struct would read an undefined member.
  expect(Object.keys(outputs.members)).toHaveLength(outputs.members.length);
  return outputs.members.length;
}

const paneOutputs = () => ({ output, normal: vec4(0, 0, 0, 0), velocity: vec4(0, 0, 0, 0) });

describe("a material's own pass outputs", () => {
  it("left three r186 with nothing to write into a target that names none of them", () => {
    // The fault itself: an empty output struct, which WebGPU refuses.
    expect(membersDrawnInto(mrt(paneOutputs()), targetNamed(""))).toBe(0);
    expect(membersDrawnInto(mrt(paneOutputs()), targetNamed("PMREM.cubeUv"))).toBe(0);
  });

  it("write their colour into a snapshot's target, or any such as PMREM's cube", () => {
    expect(membersDrawnInto(targetSafeMrt(paneOutputs()), targetNamed(""))).toBe(1);
    expect(membersDrawnInto(targetSafeMrt(paneOutputs()), targetNamed("PMREM.cubeUv"))).toBe(1);
  });

  it("write what they wrote before into a target that names them", () => {
    const pass = targetNamed("output", "normal", "velocity");
    expect(membersDrawnInto(targetSafeMrt(paneOutputs()), pass)).toBe(membersDrawnInto(mrt(paneOutputs()), pass));
    expect(membersDrawnInto(targetSafeMrt(paneOutputs()), pass)).toBe(3);
    // Named in part (a pass without velocity): only those named, as three does.
    expect(membersDrawnInto(targetSafeMrt(paneOutputs()), targetNamed("output", "normal"))).toBe(2);
  });

  it("keep their own outputs once drawn, for the next draw and the scene pass's merge", () => {
    const outputs = targetSafeMrt(paneOutputs());
    const own = outputs.outputNodes;
    membersDrawnInto(outputs, targetNamed(""));
    expect(outputs.outputNodes).toBe(own);
    expect(Object.keys(mrt({ output }).merge(outputs).outputNodes).sort()).toEqual(["normal", "output", "velocity"]);
    expect(membersDrawnInto(outputs, targetNamed("output", "normal", "velocity"))).toBe(3);
  });

  it("choose per target: the colour alone only where no output is named", () => {
    const own = paneOutputs();
    expect(outputsForTarget(own, ["output", "normal"])).toBe(own);
    expect(outputsForTarget(own, ["velocity"])).toBe(own);
    expect(outputsForTarget(own, ["PMREM.cubeUv"])).toEqual({ "PMREM.cubeUv": own.output });
    expect(outputsForTarget(own, [""])).toEqual({ "": own.output });
    // No target texture, or no colour to fall back to: three's own behaviour.
    expect(outputsForTarget(own, [])).toBe(own);
    const normalOnly = { normal: vec4(0, 0, 0, 0) };
    expect(outputsForTarget(normalOnly, [""])).toBe(normalOnly);
    // A name on Object.prototype is not an output.
    expect(outputsForTarget(own, ["toString"])).toEqual({ toString: own.output });
  });

  it("are target-safe for the floor marks and the street's light", () => {
    expect(floorLightOutput()).toBeInstanceOf(TargetSafeMRTNode);
    expect(lightOnlyOutput()).toBeInstanceOf(TargetSafeMRTNode);
  });

  it("are made target-safe wherever a material sets its own", () => {
    // Every `material.mrtNode = ...` in the app is a call to a maker of target-safe outputs, and only
    // the scene pass, whose outputs name its own targets, makes plain ones (`mrt` or `new MRTNode`).
    const root = resolve(import.meta.dirname, "../..");
    const assigned = new Set<string>();
    const plain: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(path);
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          for (const match of source.matchAll(/\.mrtNode\s*=(?!=)\s*([^;]*)/g)) assigned.add(match[1]!.trim().replace(/\(.*$/s, "("));
          const tsl = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"three\/tsl"/g)].some((match) => /\bmrt\b/.test(match[1]!));
          if (tsl || /\bnew\s+MRTNode\s*\(/.test(source)) plain.push(relative(root, path).replaceAll("\\", "/"));
        }
      }
    };
    walk(root);
    expect(assigned.size).toBeGreaterThan(0);
    expect([...assigned].filter((maker) => !["targetSafeMrt(", "floorLightOutput(", "lightOnlyOutput("].includes(maker))).toEqual([]);
    expect(plain).toEqual(["components/scene/PlannerRenderPipeline.tsx"]);
  });
});
