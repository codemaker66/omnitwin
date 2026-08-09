import { describe, expect, it } from "vitest";
import { Group, Mesh, Scene } from "three";
import { prepareSceneForOperationalCapture } from "../scene-authority-capture.js";

describe("operational scene capture authority", () => {
  it("excludes generated and export-authority-none subtrees, then restores them", () => {
    const scene = new Scene();
    const measured = new Mesh();
    measured.name = "measured-shell";
    measured.userData.provenance = "measured";
    const generatedGroup = new Group();
    generatedGroup.name = "photo-guided-ornaments";
    generatedGroup.userData.provenance = "generated";
    const generatedChild = new Mesh();
    generatedGroup.add(generatedChild);
    const presentationProxy = new Mesh();
    presentationProxy.userData.exportAuthority = "none";
    scene.add(measured, generatedGroup, presentationProxy);

    const prepared = prepareSceneForOperationalCapture(scene);
    expect(prepared.excludedObjectCount).toBe(2);
    expect(measured.visible).toBe(true);
    expect(generatedGroup.visible).toBe(false);
    expect(generatedChild.visible).toBe(true);
    expect(presentationProxy.visible).toBe(false);

    prepared.restore();
    prepared.restore();
    expect(generatedGroup.visible).toBe(true);
    expect(presentationProxy.visible).toBe(true);
  });

  it("preserves an already-hidden excluded subtree", () => {
    const scene = new Scene();
    const hidden = new Group();
    hidden.visible = false;
    hidden.userData.exportAuthority = "none";
    scene.add(hidden);

    const prepared = prepareSceneForOperationalCapture(scene);
    expect(prepared.excludedObjectCount).toBe(1);
    prepared.restore();
    expect(hidden.visible).toBe(false);
  });
});
