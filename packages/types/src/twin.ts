import { z } from "zod";

// -----------------------------------------------------------------------------
// twin/0 — the Venviewer Twin bundle manifest (spec:
// docs/superpowers/specs/2026-07-02-twin-program-design.md §4.2).
// Poses stay in the E57 capture frame (Z-up, metres, +X scanner-forward);
// basis conversion is the viewer's job (packages/web twin-basis).
// -----------------------------------------------------------------------------

export const TWIN_SCHEMA_ID = "twin/0" as const;
export const TWIN_FACES = ["front", "back", "left", "right", "up", "down"] as const;
export const TWIN_LODS = [256, 1024] as const;

export type TwinFace = (typeof TWIN_FACES)[number];
export type TwinLod = (typeof TWIN_LODS)[number];

export const TwinPoseSchema = z.object({
  /** Quaternion [w, x, y, z] — scanner→E57-world rotation, as captured. */
  q: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Translation [x, y, z] in metres, E57 world frame (Z-up). */
  t: z.tuple([z.number(), z.number(), z.number()]),
});
export type TwinPose = z.infer<typeof TwinPoseSchema>;

export const TwinScanNodeSchema = z.object({
  id: z.string().regex(/^scan_\d{3}$/),
  index: z.number().int().nonnegative(),
  pose: TwinPoseSchema,
  /** Floor bucket derived from pose height clusters; 0 = ground. */
  floor: z.number().int(),
  /** Link into the venue's room taxonomy when known; null until tagged. */
  roomSlug: z.string().nullable(),
});
export type TwinScanNode = z.infer<typeof TwinScanNodeSchema>;

export const TwinNavEdgeSchema = z.object({
  a: z.string(),
  b: z.string(),
  distanceM: z.number().positive(),
});
export type TwinNavEdge = z.infer<typeof TwinNavEdgeSchema>;

export const TwinCaptureSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matterport-e57"), scanCount: z.number().int().positive() }),
  z.object({ kind: z.literal("xgrids-lcc") }),
  z.object({ kind: z.literal("photo-mapanything") }),
]);
export type TwinCaptureSource = z.infer<typeof TwinCaptureSourceSchema>;

export const TwinManifestSchema = z.object({
  schema: z.literal(TWIN_SCHEMA_ID),
  venueSlug: z.string().min(1),
  name: z.string().min(1),
  capture: TwinCaptureSourceSchema,
  /** ADR-015-aligned planning tier; never implies certification (ADR-012). */
  tier: z.enum(["survey-grade-1cm", "ops-grade-2cm", "planning-grade-5cm"]),
  upAxis: z.literal("z"),
  units: z.literal("m"),
  faces: z.tuple([
    z.literal("front"), z.literal("back"), z.literal("left"),
    z.literal("right"), z.literal("up"), z.literal("down"),
  ]),
  lods: z.tuple([z.literal(256), z.literal(1024)]),
  generatedAt: z.string().datetime(),
  nodes: z.array(TwinScanNodeSchema).min(1),
  edges: z.array(TwinNavEdgeSchema),
  /** SHA-256 per bundle entry, filled by twin-forge hash step (D-014 shape). */
  contentHashes: z.record(z.string(), z.string()).optional(),
});
export type TwinManifest = z.infer<typeof TwinManifestSchema>;

export function twinTilePath(nodeId: string, face: TwinFace, lod: TwinLod): string {
  return `tiles/${nodeId}/${face}_${String(lod)}.webp`;
}
