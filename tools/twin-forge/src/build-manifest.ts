import {
  TWIN_EQUIRECT_LODS,
  TWIN_FACES,
  TWIN_LODS,
  TwinManifestSchema,
  type TwinManifest,
  type TwinScanNode,
} from "@omnitwin/types";
import { buildNavGraph, floorOf, type NavGraphOptions } from "./nav-graph.js";

export type RawPoses = Record<
  string,
  { rotation: [number, number, number, number]; translation: [number, number, number] }
>;

export interface ManifestOptions {
  readonly venueSlug: string;
  readonly name: string;
  readonly tier: TwinManifest["tier"];
  readonly generatedAt: string;
  readonly nav?: NavGraphOptions;
  /** Dollhouse mesh descriptor from the forge mesh step; omitted → no mesh. */
  readonly mesh?: TwinManifest["mesh"];
  /** Imagery mode; omitted → the original cube-face pipeline. */
  readonly imagery?: TwinManifest["imagery"];
}

/** poses.json (E57-native) → schema-valid twin/0 manifest. */
export function buildManifest(raw: RawPoses, opts: ManifestOptions): TwinManifest {
  const nodes: TwinScanNode[] = Object.entries(raw)
    .map(([indexStr, pose]) => {
      const index = Number(indexStr);
      return {
        id: `scan_${String(index).padStart(3, "0")}`,
        index,
        pose: { q: pose.rotation, t: pose.translation },
        floor: floorOf(pose.translation[2]),
        roomSlug: null,
      };
    })
    .sort((a, b) => a.index - b.index);

  const imagery = opts.imagery ?? "cube-faces";
  return TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: opts.venueSlug,
    name: opts.name,
    capture: { kind: "matterport-e57", scanCount: nodes.length },
    tier: opts.tier,
    upAxis: "z",
    units: "m",
    imagery,
    faces: [...TWIN_FACES],
    lods: imagery === "equirect" ? [...TWIN_EQUIRECT_LODS] : [...TWIN_LODS],
    generatedAt: opts.generatedAt,
    nodes,
    edges: buildNavGraph(nodes, opts.nav),
    // Conditional spread keeps the key absent (not `undefined`) when omitted.
    ...(opts.mesh === undefined ? {} : { mesh: opts.mesh }),
  });
}
