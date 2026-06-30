// ---------------------------------------------------------------------------
// gdtf-model — pick the best 3D model from a GDTF archive (Epic 6 import, slice 4).
//
// A `.gdtf` bundles models under models/{gltf,3ds,svg}/ (+ LOD gltf_low/gltf_high).
// GDTF says glTF is the preferred 3D format, so this picks the most loadable glTF
// for a preview: a self-contained `.glb` beats a `.gltf` (which references external
// buffers/textures), and the default `models/gltf/` LOD beats low/high. Pure — it
// only inspects the in-memory model map; the actual load happens in the preview
// component (three.js GLTFLoader). 3ds/svg are out of scope.
// ---------------------------------------------------------------------------

export type FixtureModelKind = "glb" | "gltf";

export interface SelectedFixtureModel {
  readonly path: string;
  readonly kind: FixtureModelKind;
  readonly bytes: Uint8Array;
  /** All model files (path → bytes), to resolve a .gltf's external buffers/textures. */
  readonly siblings: ReadonlyMap<string, Uint8Array>;
}

/** Higher is better; negative means "not a loadable glTF". */
function score(path: string): number {
  const lower = path.toLowerCase();
  let s: number;
  if (lower.endsWith(".glb")) s = 100;
  else if (lower.endsWith(".gltf")) s = 50;
  else return -1;
  if (/\/gltf\//.test(lower)) s += 10; // default LOD
  else if (/\/gltf_high\//.test(lower)) s += 5;
  return s; // gltf_low gets no LOD bonus
}

/** The preferred glTF model in the archive, or null when there is none. */
export function selectFixtureModel(models: ReadonlyMap<string, Uint8Array>): SelectedFixtureModel | null {
  let best: { path: string; score: number } | null = null;
  for (const path of models.keys()) {
    const sc = score(path);
    if (sc < 0) continue;
    if (best === null || sc > best.score) best = { path, score: sc };
  }
  if (best === null) return null;
  const bytes = models.get(best.path);
  if (bytes === undefined) return null;
  return {
    path: best.path,
    kind: best.path.toLowerCase().endsWith(".glb") ? "glb" : "gltf",
    bytes,
    siblings: models,
  };
}

/** Basename of a model path, for matching a .gltf's relative resource URIs. */
export function fixtureModelBasename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}
