import { BufferGeometry, type Material, type Mesh } from "three";

interface MaterialPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/**
 * Preserve GLTF primitive groups/draw ranges when merging a multi-material mesh.
 * Returned slices own only their index buffer; vertex attributes remain shared
 * until the merger clones them. The caller disposes these temporary geometries.
 */
export function furnitureMaterialParts(mesh: Mesh): {
  readonly parts: readonly MaterialPart[];
  readonly dispose: () => void;
} {
  const source = mesh.geometry;
  const count = source.index?.count ?? source.getAttribute("position").count;
  const drawStart = Math.max(0, source.drawRange.start);
  const drawEnd = Math.min(count, drawStart + source.drawRange.count);
  const owned: BufferGeometry[] = [];
  const slice = (start: number, end: number): BufferGeometry => {
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      geometry.setAttribute(name, attribute);
    }
    const indices: number[] = [];
    for (let index = start; index < end; index += 1) {
      indices.push(source.index?.getX(index) ?? index);
    }
    geometry.setIndex(indices);
    owned.push(geometry);
    return geometry;
  };
  const parts: MaterialPart[] = [];
  if (Array.isArray(mesh.material)) {
    for (const group of source.groups) {
      const material = mesh.material[group.materialIndex ?? 0];
      const start = Math.max(group.start, drawStart);
      const end = Math.min(group.start + group.count, drawEnd);
      if (material === undefined || end <= start) continue;
      parts.push({ geometry: slice(start, end), material });
    }
  } else if (drawEnd > drawStart) {
    parts.push({
      geometry: drawStart === 0 && drawEnd === count ? source : slice(drawStart, drawEnd),
      material: mesh.material,
    });
  }
  return { parts, dispose: () => { for (const geometry of owned) geometry.dispose(); } };
}
