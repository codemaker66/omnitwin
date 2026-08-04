import { Mesh, Vector3, type Material } from "three";
import { describe, expect, it, vi } from "vitest";
import { RENDER_SCALE } from "../../../../constants/scale.js";

import { createGeneratedFurnitureRenderInstance } from "../GeneratedFurnitureProxy.js";
import { GENERATED_FURNITURE_SLUGS } from "../generatedFurnitureRegistry.js";

describe("GeneratedFurnitureProxy render instance", () => {
  it.each(GENERATED_FURNITURE_SLUGS)(
    "maps the %s catalogue slug to a presentation-only render instance",
    (slug) => {
      const instance = createGeneratedFurnitureRenderInstance(
        slug,
        { castShadow: false, receiveShadow: true },
        0.35,
        0,
        { opacity: 1, selectedPartId: null },
      );

      expect(instance.marker.catalogueSlug).toBe(slug);
      expect(instance.marker.authority).toBe("presentation-only");
      expect(instance.marker.measuredGeometry).toBe(false);
      expect(instance.root.scale.toArray()).toEqual([RENDER_SCALE, 1, RENDER_SCALE]);
      expect(instance.controller.inspectionParts.length).toBeGreaterThan(0);

      instance.dispose();
    },
  );

  it("applies planner scale and updates explode progress reversibly", () => {
    const instance = createGeneratedFurnitureRenderInstance(
      "banquet-chair",
      {},
      0.35,
      0,
      { opacity: 1, selectedPartId: null },
    );
    const seat = instance.controller.inspectionParts.find(
      (part) => part.id === "seat-pad",
    );
    expect(seat).toBeDefined();
    if (seat === undefined) throw new Error("chair factory did not expose seat-pad");
    const originalPosition = seat.node.position.clone();

    expect(instance.root.scale.toArray()).toEqual([RENDER_SCALE, 1, RENDER_SCALE]);
    instance.controller.setExplodeProgress(1);
    expect(seat.node.position.equals(originalPosition)).toBe(false);
    instance.controller.setExplodeProgress(0);
    expect(seat.node.position.toArray()).toEqual(originalPosition.toArray());

    instance.dispose();
  });

  it("owns and idempotently disposes factory geometry and materials", () => {
    const instance = createGeneratedFurnitureRenderInstance(
      "round-table-6ft",
      {},
      0.35,
      0,
      { opacity: 1, selectedPartId: null },
    );
    const geometryDisposals: ReturnType<typeof vi.spyOn>[] = [];
    const materialDisposals: ReturnType<typeof vi.spyOn>[] = [];
    const seenMaterials = new Set<Material>();

    instance.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      geometryDisposals.push(vi.spyOn(object.geometry, "dispose"));
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (seenMaterials.has(material)) continue;
        seenMaterials.add(material);
        materialDisposals.push(vi.spyOn(material, "dispose"));
      }
    });

    instance.dispose();
    instance.dispose();
    instance.applyAppearance({
      opacity: 0.25,
      colorOverride: "#ffffff",
      selectedPartId: "tabletop",
    });

    expect(instance.disposed).toBe(true);
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("explodes the table radially above and below its envelope centre", () => {
    const instance = createGeneratedFurnitureRenderInstance(
      "round-table-6ft",
      {},
      0.35,
      0,
      { opacity: 1, selectedPartId: null },
    );
    const tabletop = instance.controller.inspectionParts.find(
      (part) => part.id === "tabletop",
    );
    const frame = instance.controller.inspectionParts.find(
      (part) => part.id === "frame-a",
    );
    if (tabletop === undefined || frame === undefined) {
      throw new Error("table factory did not expose its macro parts");
    }
    instance.root.updateWorldMatrix(true, true);
    const tabletopStart = tabletop.node.getWorldPosition(new Vector3());
    const frameStart = frame.node.getWorldPosition(new Vector3());

    instance.controller.setExplodeProgress(1);
    instance.root.updateWorldMatrix(true, true);
    const tabletopDelta = tabletop.node.getWorldPosition(new Vector3()).sub(tabletopStart);
    const frameDelta = frame.node.getWorldPosition(new Vector3()).sub(frameStart);

    expect(tabletopDelta.y).toBeGreaterThan(0);
    expect(frameDelta.y).toBeLessThan(0);
    instance.controller.restore();
    instance.root.updateWorldMatrix(true, true);
    expect(tabletop.node.getWorldPosition(new Vector3()).toArray()).toEqual(
      tabletopStart.toArray(),
    );
    expect(frame.node.getWorldPosition(new Vector3()).toArray()).toEqual(
      frameStart.toArray(),
    );
    instance.dispose();
  });

  it("keeps the adapter presentation-only and exposes the parent marker hook", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "src/components/meshes/generated/GeneratedFurnitureProxy.tsx",
      "utf8",
    );

    expect(source).toContain("<primitive");
    expect(source).toContain("object={container}");
    expect(source).toContain("resolveInspectionPart(event.object)");
    expect(source).toContain("onProxyMarkerChange");
    expect(source).toContain("container.add(next.root)");
    expect(source).toContain("container.remove(next.root)");
    expect(source).toContain(
      "[castShadow, explodeDistance, explodeProgress, receiveShadow, slug]",
    );
    expect(source).toMatch(
      /\[\s*castShadow,\s*colorOverride,\s*explodeDistance,\s*opacity,\s*receiveShadow,\s*selectedPartId,\s*slug,?\s*\]/,
    );
    expect(source).not.toMatch(
      /import[^;]*(Canvas|OrbitControls|PerspectiveCamera)|<(Canvas|OrbitControls|PerspectiveCamera)\b/,
    );
  });
});
