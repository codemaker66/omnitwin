import type { Light } from "three";
import { LightsNode, type LightingNode, type Node, type NodeBuilder } from "three/webgpu";

// ---------------------------------------------------------------------------
// The floor's lights: every light the scene has but the daylight lamp (T-744)
//
// The hall's rig keeps one directional lamp in the windows' place
// (HallLightRig.tsx). It is there for furniture, and for the windows'
// highlights in small glossy things. On the floor it is wrong: the floor takes
// no diffuse light from real lights, so the lamp adds only its mirror image,
// and a lamp has no size. Seen from low down, facing the windows, that image
// was a patch about four times white (on the stage, 1 % of the picture within
// twenty levels of white; shown on the live site on 22 Nov 2026 by not
// drawing the lamp). The windows are already in the floor: the room's
// reflection environment draws them, at their real size.
//
// So the floor is lit by the scene's own list with that lamp left out. The
// list is taken afresh each time the floor's program is built, never kept:
// under the real sky a second directional light arrives, the sun, which casts
// the furniture's shadows across the floor, and the floor must have it.
// ---------------------------------------------------------------------------

/** The rig's daylight lamp, by name: the rig gives it, the floor leaves it out. */
export const HALL_DAYLIGHT_LAMP = "grand-hall-daylight";

/** The scene's lights the floor takes: all of them but the rig's daylight lamp, in the scene's order. */
export function floorLightsOf(sceneLights: readonly Light[]): Light[] {
  return sceneLights.filter((light) => light.name !== HALL_DAYLIGHT_LAMP);
}

/** One key, whatever the list: see customCacheKey. */
const HALL_FLOOR_LIGHTS_KEY = 0x744f100;

/**
 * The floor's lights node, set as its material's `lightsNode`.
 *
 * three builds a material's lights from the list its lights node holds, and
 * gives a node of the material's own no list. This one takes the scene's list
 * from the builder each time it is asked to build: the builder holds the
 * scene's lights node (three's NodeManager sets it from the drawn object)
 * until this node's own setup begins. A light that joins the scene later is in
 * the next build, and that build comes by itself: a drawn object's key
 * includes the scene's lights, so a new light rebuilds every program, the
 * floor's among them.
 */
export class HallFloorLights extends LightsNode {
  /**
   * Takes the scene's list from the builder. three puts the node being set up in the scene's place for the length
   * of its setup: taken then, this node's own list gives the same list back.
   */
  private take(builder: NodeBuilder): void {
    // three's own types do not declare the builder's lights node.
    const scene: unknown = Reflect.get(builder, "lightsNode");
    this.setLights(scene instanceof LightsNode ? floorLightsOf(scene.getLights()) : []);
  }

  // Where three reads the list, whoever asks. A build's first question to a node, its hash, comes through here.
  override setupLightsNode(builder: NodeBuilder): LightingNode[] {
    this.take(builder);
    return super.setupLightsNode(builder);
  }

  // And as the setup begins, while the builder still holds the scene's node: three asks for the hash first today,
  // and a build that one day did not would otherwise set this node up from the last build's list.
  override setup(builder: NodeBuilder): Node | null | undefined {
    this.take(builder);
    return super.setup(builder);
  }

  /**
   * The same for every list. Which lights there are is the scene's to say, and the drawn object's own key already
   * says it. three keeps a node's key once it has been asked for, so a key made from this node's list would say
   * whichever list it held at that moment: none, before the first build.
   */
  override customCacheKey(): number {
    return HALL_FLOOR_LIGHTS_KEY;
  }

  /** Asked before the first build, when no list has been taken yet: a floor that said no would be built unlit. */
  override get hasLights(): boolean {
    return true;
  }
}
