import { DirectionalLight, PointLight, type Light } from "three";
import { lights } from "three/tsl";
import type { NodeBuilder } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { HALL_DAYLIGHT_LAMP, HallFloorLights, floorLightsOf } from "../hall-floor-lights.js";

// ---------------------------------------------------------------------------
// The floor's lights (T-744). What the tests below can hold is the floor's own
// node: which lights it builds a program from, given what three's builder
// holds at that moment. That three hands a material's own lights node the
// builder as these tests do is read from three's source (NodeMaterial
// setupLighting, NodeManager getForRender, LightingModel start) and shown on
// the GPU, which no test here can do.
// ---------------------------------------------------------------------------

interface HallLights {
  readonly chandeliers: readonly [PointLight, PointLight];
  readonly lamp: DirectionalLight;
  readonly sun: DirectionalLight;
}

/** The lights a drawn hall's scene holds: chandeliers, the rig's daylight lamp and, under the real sky, the sun. */
function hallLights(): HallLights {
  const chandeliers: [PointLight, PointLight] = [new PointLight(), new PointLight()];
  chandeliers[0].name = "chandelier-a";
  chandeliers[1].name = "chandelier-b";
  const lamp = new DirectionalLight();
  lamp.name = HALL_DAYLIGHT_LAMP;
  const sun = new DirectionalLight();
  sun.name = "grand-hall-sun";
  sun.castShadow = true;
  return { chandeliers, lamp, sun };
}

/** What three makes of one light as a program is built, stood in for by the light itself. */
class LightNodeStandIn {
  readonly isAnalyticLightNode = true;
  readonly light: Light;

  constructor(light: Light) {
    this.light = light;
  }

  getHash(): string {
    return `light-${String(this.light.id)}`;
  }
}

/**
 * As much of three's builder as a lights node reads while a program is built: the scene's lights node (three's
 * NodeManager sets it from the drawn object), the material's own lightings, the renderer's class for a light, and
 * the builder's own notes on each node. One builder is one build.
 */
function buildHolding(sceneLights: unknown): NodeBuilder {
  const notes = new Map<object, Record<string, unknown>>();
  const builder = {
    lightsNode: sceneLights,
    context: { materialLightings: [] },
    renderer: { library: { getLightNodeClass: (): typeof LightNodeStandIn => LightNodeStandIn } },
    getDataFromNode: (node: object): Record<string, unknown> => {
      const known = notes.get(node) ?? {};
      notes.set(node, known);
      return known;
    },
    getNodeProperties: (): Record<string, unknown> => ({}),
  };
  return builder as unknown as NodeBuilder;
}

/** The lights `floor` builds a program from in this build, by name, in three's own order (by id: as made above). */
function builtFrom(floor: HallFloorLights, build: NodeBuilder): string[] {
  return floor.setupLightsNode(build).map((lightNode) => (lightNode as unknown as LightNodeStandIn).light.name);
}

describe("the floor's lights", () => {
  it("are the scene's without the rig's daylight lamp, in the scene's order", () => {
    const { chandeliers, lamp, sun } = hallLights();
    expect(floorLightsOf([chandeliers[0], lamp, chandeliers[1], sun])).toEqual([chandeliers[0], chandeliers[1], sun]);
    expect(floorLightsOf([lamp])).toEqual([]);
    expect(floorLightsOf([])).toEqual([]);
  });

  it("are taken from the scene as a program is built: the chandeliers stay and the lamp is left out", () => {
    const { chandeliers, lamp } = hallLights();
    const floor = new HallFloorLights();
    expect(builtFrom(floor, buildHolding(lights([chandeliers[0], lamp, chandeliers[1]])))).toEqual(["chandelier-a", "chandelier-b"]);
  });

  // Under the real sky the sun joins the scene after the floor has been drawn. It casts the furniture's shadows
  // across the floor, so a floor that kept its first list would have neither the sun's light nor its shadows.
  it("take the sun when it joins the scene later, at the next build", () => {
    const { chandeliers, lamp, sun } = hallLights();
    const scene = lights([...chandeliers, lamp]);
    const floor = new HallFloorLights();
    const first = buildHolding(scene);
    const before = floor.getHash(first);
    expect(builtFrom(floor, first)).toEqual(["chandelier-a", "chandelier-b"]);
    scene.setLights([...chandeliers, lamp, sun]);
    const next = buildHolding(scene);
    // The hash is the first thing a build asks a node for, and three works it out from the list: the new one.
    expect(floor.getHash(next)).not.toBe(before);
    expect(builtFrom(floor, next)).toEqual(["chandelier-a", "chandelier-b", "grand-hall-sun"]);
  });

  // three puts the node being set up in the scene's place for the length of its setup.
  it("keep their list while their own setup runs, when the builder's node is this one", () => {
    const { chandeliers, lamp, sun } = hallLights();
    const floor = new HallFloorLights();
    builtFrom(floor, buildHolding(lights([...chandeliers, lamp, sun])));
    expect(builtFrom(floor, buildHolding(floor))).toEqual(["chandelier-a", "chandelier-b", "grand-hall-sun"]);
  });

  it("are taken as the node is set up too, and the builder holds the scene's node again after", () => {
    const { chandeliers, lamp } = hallLights();
    const scene = lights([...chandeliers, lamp]);
    const floor = new HallFloorLights();
    const build = buildHolding(scene);
    floor.setup(build);
    expect(floor.getLights().map((light) => light.name)).toEqual(["chandelier-a", "chandelier-b"]);
    const held: unknown = Reflect.get(build, "lightsNode");
    expect(held).toBe(scene);
  });

  it("are none in a build that has no scene's lights, whatever the last build had", () => {
    const { chandeliers } = hallLights();
    const floor = new HallFloorLights();
    expect(builtFrom(floor, buildHolding(lights([...chandeliers])))).toHaveLength(2);
    expect(builtFrom(floor, buildHolding(null))).toEqual([]);
  });

  // Both are asked before the first build, when no list has been taken.
  it("say they have lights before any list is taken, and keep one key whatever the list", () => {
    const { chandeliers, lamp, sun } = hallLights();
    const floor = new HallFloorLights();
    expect(floor.hasLights).toBe(true);
    const key = floor.customCacheKey();
    builtFrom(floor, buildHolding(lights([...chandeliers, lamp, sun])));
    expect(floor.customCacheKey()).toBe(key);
    expect(new HallFloorLights().customCacheKey()).toBe(key);
  });
});
