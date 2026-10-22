import { describe, expect, it, vi } from "vitest";
import { Color, Group, Scene } from "three";

// The PMREM generator needs a GPU; a stand-in records what it was asked and
// hands back the render target it was given, or a new one, as three's does.
interface FakeTarget { readonly texture: { readonly serial: number }; dispose(): void }
const made = vi.hoisted(() => ({ targets: 0, calls: [] as { readonly given: boolean; readonly children: number }[] }));
vi.mock("three/webgpu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/webgpu")>();
  class FakePMREMGenerator {
    fromScene(scene: Scene, _sigma: number, _near: number, _far: number, options: { readonly renderTarget: FakeTarget | null }): FakeTarget {
      made.calls.push({ given: options.renderTarget !== null, children: scene.children.length });
      if (options.renderTarget !== null) return options.renderTarget;
      made.targets += 1;
      return { texture: { serial: made.targets }, dispose: () => undefined };
    }
    dispose(): void { /* nothing held */ }
  }
  return { ...actual, PMREMGenerator: FakePMREMGenerator };
});

const { HallEnvironmentCapture } = await import("../hall-capture.js");
const { WebGPURenderer } = await import("three/webgpu");

describe("the hall's captured environment", () => {
  it("exists before the first capture, as the texture every capture refills (review R2: no rebuild when it lands)", () => {
    // A renderer that is never initialised: the stand-in generator never reaches it.
    const capture = new HallEnvironmentCapture(new WebGPURenderer(), new Color(0x120e0b));
    const prepared = capture.prepare();
    // The void alone, filtered into a target of its own.
    expect(made.calls[0]).toEqual({ given: false, children: 0 });
    expect(capture.prepare()).toBe(prepared);
    const world = new Scene();
    const room = new Group();
    world.add(room);
    const captured = capture.capture(room);
    // The room is filtered into the same target, and handed straight back.
    expect(captured).toBe(prepared);
    expect(made.calls[made.calls.length - 1]).toEqual({ given: true, children: 1 });
    expect(room.parent).toBe(world);
    expect(made.targets).toBe(1);
    capture.dispose();
  });
});
