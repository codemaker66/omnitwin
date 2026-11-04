import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RenderTarget } from "three";
import { mrt, output, vec4 } from "three/tsl";
import { NodeBuilder, WebGPURenderer, type MRTNode, type Renderer } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { floorLightOutput } from "../../components/editor/floor-light-output.js";
import { lightOnlyOutput } from "../../components/grand-hall/hall-street-light.js";
import { TargetSafeMRTNode, outputsForTarget, targetSafeMrt } from "../target-safe-mrt.js";

// three r186 writes only the outputs a draw's target names (MRTNode.setup). A
// snapshot's target (one texture, no name) and PMREM's cube ("PMREM.cubeUv")
// name none of a material's own outputs, so three wrote `struct OutputType { }`,
// WebGPU refused the pipeline, and the plan sent with a layout came back blank
// with the sky on (4 Nov 2026, D:/claude/webgpu-target-safe-mrt/snap).

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
  return outputs.members.filter((member) => member !== undefined).length;
}

const paneOutputs = () => ({ output, normal: vec4(0, 0, 0, 0), velocity: vec4(0, 0, 0, 0) });

describe("a material's own pass outputs", () => {
  it("left three r186 with nothing to write into a target that names none of them", () => {
    // The fault itself: an empty output struct, which WebGPU refuses.
    expect(membersDrawnInto(mrt(paneOutputs()), targetNamed(""))).toBe(0);
    expect(membersDrawnInto(mrt(paneOutputs()), targetNamed("PMREM.cubeUv"))).toBe(0);
  });

  it("write their colour into a snapshot's target or the reflection cube", () => {
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
    // Every `material.mrtNode = f(...)` in the app calls a maker of target-safe outputs.
    const root = resolve(import.meta.dirname, "../..");
    const makers = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(path);
        } else if (/\.tsx?$/.test(entry.name)) {
          for (const match of readFileSync(path, "utf8").matchAll(/\.mrtNode\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g)) makers.add(match[1]!);
        }
      }
    };
    walk(root);
    expect(makers.size).toBeGreaterThan(0);
    expect([...makers].filter((maker) => !["targetSafeMrt", "floorLightOutput", "lightOnlyOutput"].includes(maker))).toEqual([]);
  });
});
