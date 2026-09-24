import { Raycaster, Vector3, type Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { BrickWall } from "../BrickWall.js";
import { mountInStubRoot, type StubRoot } from "./stub-r3f-root.js";

let mounted: StubRoot | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe("BrickWall click plane", () => {
  it("is not drawn yet still receives the selection raycast", () => {
    mounted = mountInStubRoot(
      <BrickWall wallWidth={6} wallHeight={3} position={[0, 1.5, -4]} rotation={[0, 0, 0]} color="#b08a68" name="wall-north" />,
    );
    const { scene } = mounted;
    const plane = scene.getObjectByName("wall-north-click-plane") as Mesh | undefined;
    expect(plane).toBeDefined();
    expect(plane?.visible).toBe(false);

    scene.updateMatrixWorld(true);
    const raycaster = new Raycaster(new Vector3(0, 1.5, 0), new Vector3(0, 0, -1));
    const hits = raycaster.intersectObjects(scene.children, true).map((hit) => hit.object.name);
    expect(hits).toContain("wall-north-click-plane");
  });
});
