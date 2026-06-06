import { z } from "zod";

// ---------------------------------------------------------------------------
// Runtime visual asset provenance — AssetVersion + RuntimePackage contracts
//
// An AssetVersion is the provenance-bearing record for one processed visual
// asset (a Gaussian-splat bundle in R2). A RuntimePackage is a publishable
// pointer that exposes an AssetVersion to the runtime renderer.
//
// SAFE-language note: `evidenceStatus` is the ONLY trust signal. It never
// asserts legal/safety certification. "human_reviewed" means a human looked
// at it — not that it is legally certified, survey-grade, or approved for
// occupancy. The UI copy derived from these statuses must stay within the
// planning-evidence vocabulary.
// ---------------------------------------------------------------------------

/** How honestly an asset's accuracy has been established. Ordered weakest→strongest. */
export const ASSET_EVIDENCE_STATUSES = ["unverified", "machine_checked", "human_reviewed"] as const;
export const AssetEvidenceStatusSchema = z.enum(ASSET_EVIDENCE_STATUSES);
export type AssetEvidenceStatus = z.infer<typeof AssetEvidenceStatusSchema>;

/** Where the captured/processed asset came from. */
export const ASSET_SOURCES = ["runpod", "xgrids", "matterport", "manual"] as const;
export const AssetSourceSchema = z.enum(ASSET_SOURCES);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

/** Runtime package lifecycle. Only `published` packages are served to the runtime. */
export const RUNTIME_PACKAGE_STATUSES = ["draft", "published", "retired"] as const;
export const RuntimePackageStatusSchema = z.enum(RUNTIME_PACKAGE_STATUSES);
export type RuntimePackageStatus = z.infer<typeof RuntimePackageStatusSchema>;

/** Splat container extensions Spark can load. Canonical list — shared by API validation and web. */
export const RUNTIME_SPLAT_EXTENSIONS = [".ply", ".spz", ".splat", ".ksplat", ".rad", ".radc"] as const;
export type RuntimeSplatExtension = (typeof RUNTIME_SPLAT_EXTENSIONS)[number];

/**
 * Substrings that mark a fixture/demo asset rather than a real captured one.
 * A real runtime AssetVersion must never point at one of these — registering
 * a fixture as a runtime asset would let a demo masquerade as real evidence.
 */
export const FORBIDDEN_ASSET_FIXTURE_MARKERS = ["textsplats", "text-splats", "spark-fixture", "splat-fixture"] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the splat extension for an R2 key/path, or null if it isn't a splat container. */
export function splatExtensionForKey(key: string): RuntimeSplatExtension | null {
  const lower = key.toLowerCase();
  return RUNTIME_SPLAT_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? null;
}

/** True if the key names a fixture/demo asset that must not be registered as a runtime asset. */
export function isForbiddenAssetFixtureKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_ASSET_FIXTURE_MARKERS.some((marker) => lower.includes(marker));
}

// ---------------------------------------------------------------------------
// Register input — request payload (validated server-side, never trusted)
// ---------------------------------------------------------------------------

export const RegisterAssetVersionInputSchema = z
  .object({
    venueId: z.string().uuid(),
    spaceId: z.string().uuid().nullable().optional(),
    source: AssetSourceSchema,
    /** Object key in R2 — must end in a splat extension and must not be a fixture. */
    r2Key: z.string().trim().min(1).max(1024),
    sha256: z.string().regex(SHA256_HEX, "sha256 must be 64 lowercase hex characters"),
    captureDate: z.string().regex(ISO_DATE, "captureDate must be an ISO date (YYYY-MM-DD)"),
    evidenceStatus: AssetEvidenceStatusSchema.default("unverified"),
    sizeBytes: z.number().int().positive().nullable().optional(),
    label: z.string().trim().max(200).optional(),
    /** When true, also create and publish a RuntimePackage pointing at the new version. */
    publish: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    if (isForbiddenAssetFixtureKey(body.r2Key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["r2Key"],
        message: "Fixture/demo asset keys cannot be registered as runtime assets.",
      });
    }
    if (splatExtensionForKey(body.r2Key) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["r2Key"],
        message: "Asset key must end in .ply, .spz, .splat, .ksplat, .rad, or .radc.",
      });
    }
  });

export type RegisterAssetVersionInput = z.infer<typeof RegisterAssetVersionInputSchema>;

// ---------------------------------------------------------------------------
// Response schemas — parsed from server JSON at the web client boundary.
// No .default()/.passthrough() here (keeps ZodType<T> inference clean).
// ---------------------------------------------------------------------------

export const AssetVersionSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  spaceId: z.string().nullable(),
  source: AssetSourceSchema,
  r2Key: z.string(),
  splatExtension: z.string(),
  sha256: z.string(),
  captureDate: z.string().nullable(),
  evidenceStatus: AssetEvidenceStatusSchema,
  sizeBytes: z.number().nullable(),
  label: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type AssetVersion = z.infer<typeof AssetVersionSchema>;

export const RuntimePackageSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  spaceId: z.string().nullable(),
  assetVersionId: z.string(),
  status: RuntimePackageStatusSchema,
  label: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  assetVersion: AssetVersionSchema,
  /** Resolved fetchable URL for the asset (server resolves r2Key → public URL); null if unresolvable. */
  assetUrl: z.string().nullable(),
});
export type RuntimePackage = z.infer<typeof RuntimePackageSchema>;
