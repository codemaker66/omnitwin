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
/** Equirect LODs are WIDTHS (2:1 aspect): 512×256 preview, 4096×2048 base,
 *  8192×4096 zoom tier. The base streams on every node (11.4 px/deg); the
 *  8192 tier (22.8 px/deg — the extractor's supersampled render, near the
 *  ~45.5 px/deg native photos over a typical zoomed fov) loads on zoom
 *  intent only, and only where the GPU's maxTextureSize admits it. */
export const TWIN_EQUIRECT_LODS = [512, 4096, 8192] as const;

export type TwinFace = (typeof TWIN_FACES)[number];
export type TwinLod = (typeof TWIN_LODS)[number];
export type TwinEquirectLod = (typeof TWIN_EQUIRECT_LODS)[number];

/**
 * Imagery mode of a bundle. `cube-faces` is the original six-face pipeline;
 * `equirect` is one seamless world-frame equirectangular pano per node
 * (E57 workspace extract_equirect.py — no per-face table, no cube seams).
 * The `.default("cube-faces")` keeps every pre-equirect manifest parsing.
 */
export const TwinImagerySchema = z.enum(["cube-faces", "equirect"]).default("cube-faces");
export type TwinImagery = z.infer<typeof TwinImagerySchema>;

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

export const TwinMeshSchema = z.object({
  /** Bundle-relative location — fixed so viewers never guess. */
  path: z.literal("mesh/dollhouse.glb"),
  bytes: z.number().int().positive(),
  /** Basename of the source GLB the forge optimized (provenance). */
  sourceName: z.string().min(1),
});
export type TwinMesh = z.infer<typeof TwinMeshSchema>;

export const TwinCaptureSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matterport-e57"), scanCount: z.number().int().positive() }),
  z.object({ kind: z.literal("xgrids-lcc") }),
  z.object({ kind: z.literal("photo-mapanything") }),
]);
export type TwinCaptureSource = z.infer<typeof TwinCaptureSourceSchema>;

/** ADR-015-aligned planning tier; never implies certification (ADR-012). */
export const TwinTierSchema = z.enum([
  "survey-grade-1cm",
  "ops-grade-2cm",
  "planning-grade-5cm",
]);

export const TwinManifestSchema = z
  .object({
    schema: z.literal(TWIN_SCHEMA_ID),
    venueSlug: z.string().min(1),
    name: z.string().min(1),
    capture: TwinCaptureSourceSchema,
    tier: TwinTierSchema,
    upAxis: z.literal("z"),
    units: z.literal("m"),
    /** Absent in pre-equirect bundles → defaults to the cube-face pipeline. */
    imagery: TwinImagerySchema,
    /** Vestigial in equirect mode (kept so older manifests parse unchanged). */
    faces: z.tuple([
      z.literal("front"), z.literal("back"), z.literal("left"),
      z.literal("right"), z.literal("up"), z.literal("down"),
    ]),
    /** Cube mode: face edge px [256, 1024]. Equirect: widths [512, 4096, 8192]. */
    lods: z.union([
      z.tuple([z.literal(256), z.literal(1024)]),
      z.tuple([z.literal(512), z.literal(4096), z.literal(8192)]),
    ]),
    generatedAt: z.string().datetime(),
    nodes: z.array(TwinScanNodeSchema).min(1),
    edges: z.array(TwinNavEdgeSchema),
    /** The node the walk opens on — the venue's hero viewpoint. Absent (or an
     *  unknown id) falls back to scan_000 / the first node. */
    entryNodeId: z.string().optional(),
    /** The authored opening camera at the hero viewpoint — the first frame is
     *  the product, so it faces the room's best view, never a default axis.
     *  Angles in degrees; applied only when the walk opens on entryNodeId. */
    entryLook: z
      .object({
        yawDeg: z.number().finite(),
        pitchDeg: z.number().finite(),
        fovDeg: z.number().finite(),
      })
      .optional(),
    /** Optional dollhouse mesh — bundles without one keep working (Phase 2). */
    mesh: TwinMeshSchema.optional(),
    /** SHA-256 per bundle entry, filled by twin-forge hash step (D-014 shape). */
    contentHashes: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((manifest, ctx) => {
    const expected: readonly number[] =
      manifest.imagery === "equirect" ? TWIN_EQUIRECT_LODS : TWIN_LODS;
    const lods: readonly number[] = manifest.lods;
    if (lods.length !== expected.length || expected.some((lod, i) => lods[i] !== lod)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lods"],
        message: `${manifest.imagery} bundles must declare lods [${expected.join(", ")}]`,
      });
    }
  });
export type TwinManifest = z.infer<typeof TwinManifestSchema>;

export function twinTilePath(nodeId: string, face: TwinFace, lod: TwinLod): string {
  return `tiles/${nodeId}/${face}_${String(lod)}.webp`;
}

/** Bundle-relative path of one node's equirect pano at the given width. */
export function twinEquirectPath(nodeId: string, lod: TwinEquirectLod): string {
  return `tiles/${nodeId}/equirect_${String(lod)}.webp`;
}
