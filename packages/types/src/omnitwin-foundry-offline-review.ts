import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  FoundryRelativePathSchema,
  FoundryUtcInstantSchema,
} from "./omnitwin-foundry.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "./runtime-venue-manifest.js";
import { RuntimeSlugSchema } from "./asset-version.js";

/**
 * A digest-bound, tamper-evident offline evidence index. It confers no
 * transform authority, makes no physical-storage immutability claim, and
 * cannot be submitted as a T-486 review, evidence-registration, signing, or
 * publication request.
 */
export const FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0 =
  "omnitwin.foundry.offline-review-package.v0";
export const FOUNDRY_OFFLINE_REVIEW_PACKAGE_DIGEST_DOMAIN =
  `${FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0}\n`;

export const FOUNDRY_OFFLINE_REVIEW_ARTIFACT_KINDS = [
  "phase1_bundle",
  "ingest_manifest",
  "identity_review",
  "source_inspection",
  "residual_report",
  "transform_proposal",
  "fixed_view",
  "human_readable_report",
  "release_manifest",
  "qa_report",
  "scene_authority_draft",
  "supporting_evidence",
] as const;
export const FoundryOfflineReviewArtifactKindSchema = z.enum(
  FOUNDRY_OFFLINE_REVIEW_ARTIFACT_KINDS,
);
export type FoundryOfflineReviewArtifactKind = z.infer<
  typeof FoundryOfflineReviewArtifactKindSchema
>;

export const FoundryOfflineReviewArtifactV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: FoundryOfflineReviewArtifactKindSchema,
    relativePath: FoundryRelativePathSchema,
    sha256: RuntimeSha256Schema,
    byteLength: z.number().int().safe().positive(),
    mediaType: z.string().trim().min(1).max(160),
  })
  .strict();
export type FoundryOfflineReviewArtifactV0 = z.infer<
  typeof FoundryOfflineReviewArtifactV0Schema
>;

export const FoundryOfflineReviewEvidenceReadinessSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("ready"),
        blockers: z.array(z.never()).length(0),
      })
      .strict(),
    z
      .object({
        status: z.literal("blocked"),
        blockers: z.array(z.string().trim().min(10).max(1_000)).min(1).max(100),
      })
      .strict(),
  ],
);
export type FoundryOfflineReviewEvidenceReadiness = z.infer<
  typeof FoundryOfflineReviewEvidenceReadinessSchema
>;

export const FoundryOfflineReviewReadinessV0Schema = z
  .object({
    evidenceReview: FoundryOfflineReviewEvidenceReadinessSchema,
    publicApproval: z
      .object({
        status: z.literal("not_ready_offline"),
        requirements: z.array(z.string().trim().min(10).max(1_000)).min(1).max(100),
      })
      .strict(),
    signing: z
      .object({
        status: z.literal("not_ready_unsigned"),
        requirements: z.array(z.string().trim().min(10).max(1_000)).min(1).max(100),
      })
      .strict(),
  })
  .strict();
export type FoundryOfflineReviewReadinessV0 = z.infer<
  typeof FoundryOfflineReviewReadinessV0Schema
>;

const FoundryOfflineReviewPackageMaterialFields = {
  schemaVersion: z.literal(FOUNDRY_OFFLINE_REVIEW_PACKAGE_V0),
  packageId: RuntimeManifestKeySchema,
  projectId: RuntimeManifestKeySchema,
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  createdAt: FoundryUtcInstantSchema,
  createdBy: z.string().trim().min(1).max(200),
  mode: z.literal("offline_unsigned_preflight"),
  authority: z.literal("none"),
  subjectArtifactId: RuntimeManifestKeySchema,
  artifacts: z.array(FoundryOfflineReviewArtifactV0Schema).min(1).max(10_000),
  readiness: FoundryOfflineReviewReadinessV0Schema,
} as const;

const PHASE1_READY_KINDS = [
  "phase1_bundle",
  "ingest_manifest",
  "identity_review",
  "source_inspection",
  "residual_report",
  "transform_proposal",
  "fixed_view",
] as const satisfies readonly FoundryOfflineReviewArtifactKind[];

const RELEASE_READY_KINDS = [
  "release_manifest",
  "qa_report",
  "transform_proposal",
  "scene_authority_draft",
  "fixed_view",
] as const satisfies readonly FoundryOfflineReviewArtifactKind[];

function validateFoundryOfflineReviewPackageMaterial(
  reviewPackage: z.infer<z.ZodObject<typeof FoundryOfflineReviewPackageMaterialFields>>,
  ctx: z.RefinementCtx,
): void {
  const ids = reviewPackage.artifacts.map((artifact) => artifact.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "offline review artifact IDs must be unique",
    });
  }

  const paths = reviewPackage.artifacts.map((artifact) => artifact.relativePath);
  if (new Set(paths).size !== paths.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "offline review artifact paths must be unique",
    });
  }
  const caseFoldedPaths = paths.map((path) => path.toLocaleLowerCase("en-US"));
  if (new Set(caseFoldedPaths).size !== caseFoldedPaths.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "offline review artifact paths must be unique without case ambiguity",
    });
  }
  const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right, "en-US"));
  if (paths.some((path, index) => path !== sortedPaths[index])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifacts"],
      message: "offline review artifacts must be sorted by relativePath",
    });
  }

  const subjects = reviewPackage.artifacts.filter(
    (artifact) => artifact.id === reviewPackage.subjectArtifactId,
  );
  if (subjects.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectArtifactId"],
      message: "subjectArtifactId must resolve to exactly one indexed artifact",
    });
    return;
  }
  const subject = subjects[0];
  if (subject === undefined) return;
  if (subject.kind !== "phase1_bundle" && subject.kind !== "release_manifest") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectArtifactId"],
      message: "offline review subject must be a phase-one bundle or release manifest",
    });
    return;
  }

  if (reviewPackage.readiness.evidenceReview.status !== "ready") return;
  const requiredKinds =
    subject.kind === "phase1_bundle" ? PHASE1_READY_KINDS : RELEASE_READY_KINDS;
  const availableKinds = new Set(reviewPackage.artifacts.map((artifact) => artifact.kind));
  for (const requiredKind of requiredKinds) {
    if (!availableKinds.has(requiredKind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: `evidence-review-ready ${subject.kind} package requires ${requiredKind}`,
      });
    }
  }
}

export const FoundryOfflineReviewPackageMaterialV0Schema = z
  .object(FoundryOfflineReviewPackageMaterialFields)
  .strict()
  .superRefine(validateFoundryOfflineReviewPackageMaterial);
export type FoundryOfflineReviewPackageMaterialV0 = z.infer<
  typeof FoundryOfflineReviewPackageMaterialV0Schema
>;

function digestFoundryOfflineReviewPackageMaterial(
  material: FoundryOfflineReviewPackageMaterialV0,
): string {
  const canonical = CanonicalJsonValueSchema.parse(material);
  return `sha256:${sha256Hex(
    `${FOUNDRY_OFFLINE_REVIEW_PACKAGE_DIGEST_DOMAIN}${stableCanonicalJson(canonical)}`,
  )}`;
}

export function computeFoundryOfflineReviewPackageSha256(
  reviewPackage: FoundryOfflineReviewPackageMaterialV0,
): string {
  const material = FoundryOfflineReviewPackageMaterialV0Schema.parse(reviewPackage);
  return digestFoundryOfflineReviewPackageMaterial(material);
}

export const FoundryOfflineReviewPackageV0Schema = z
  .object({
    ...FoundryOfflineReviewPackageMaterialFields,
    packageSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((reviewPackage, ctx) => {
    validateFoundryOfflineReviewPackageMaterial(reviewPackage, ctx);
    const material: FoundryOfflineReviewPackageMaterialV0 = {
      schemaVersion: reviewPackage.schemaVersion,
      packageId: reviewPackage.packageId,
      projectId: reviewPackage.projectId,
      venueSlug: reviewPackage.venueSlug,
      roomSlug: reviewPackage.roomSlug,
      createdAt: reviewPackage.createdAt,
      createdBy: reviewPackage.createdBy,
      mode: reviewPackage.mode,
      authority: reviewPackage.authority,
      subjectArtifactId: reviewPackage.subjectArtifactId,
      artifacts: reviewPackage.artifacts,
      readiness: reviewPackage.readiness,
    };
    if (reviewPackage.packageSha256 !== digestFoundryOfflineReviewPackageMaterial(material)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packageSha256"],
        message: "packageSha256 must bind the exact offline review material",
      });
    }
  });
export type FoundryOfflineReviewPackageV0 = z.infer<
  typeof FoundryOfflineReviewPackageV0Schema
>;

export function buildFoundryOfflineReviewPackageV0(
  material: FoundryOfflineReviewPackageMaterialV0,
): FoundryOfflineReviewPackageV0 {
  const parsed = FoundryOfflineReviewPackageMaterialV0Schema.parse(material);
  return FoundryOfflineReviewPackageV0Schema.parse({
    ...parsed,
    packageSha256: computeFoundryOfflineReviewPackageSha256(parsed),
  });
}
