import {
  FOUNDRY_CANONICAL_VENUE_PACKAGE_V0,
  FoundryCanonicalVenuePackageV0Schema,
  FoundryGeneratedRegionSchema,
  FoundryIngestManifestV0Schema,
  FoundryPackageReferenceCatalogSchema,
  FoundryPackageRepresentationSchema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryIngestManifestSha256,
  validateFoundryCanonicalPackageReferences,
  type FoundryCanonicalVenuePackageV0,
  type FoundryPackageReferenceCatalog,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_ROOM_REALITY_PACKAGE_DRAFT_V0 =
  "omnitwin.foundry.room-reality-package-draft.v0";
export const FOUNDRY_ROOM_REALITY_PACKAGE_ASSEMBLY_V0 =
  "omnitwin.foundry.room-reality-package-assembly.v0";

const PACKAGE_DRAFT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_ROOM_REALITY_PACKAGE_DRAFT_V0";
const REFERENCE_CATALOG_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_ROOM_REALITY_REFERENCE_CATALOG_V0";
const ASSEMBLY_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_ROOM_REALITY_PACKAGE_ASSEMBLY_V0";

const FoundryRoomRealityRoomDraftV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    label: z.string().trim().min(1).max(200),
    roomFrameId: RuntimeManifestKeySchema,
    venueTransformArtifactAssetId: RuntimeManifestKeySchema,
    sceneAuthorityMapAssetId: RuntimeManifestKeySchema,
    representations: z
      .array(FoundryPackageRepresentationSchema)
      .min(1)
      .max(100),
  })
  .strict();

export const FoundryRoomRealityPackageDraftV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROOM_REALITY_PACKAGE_DRAFT_V0),
    id: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    venueFrameId: RuntimeManifestKeySchema,
    rooms: z.array(FoundryRoomRealityRoomDraftV0Schema).min(1).max(10_000),
    generatedRegions: z.array(FoundryGeneratedRegionSchema).max(100_000),
    packageQualityReportId: RuntimeManifestKeySchema,
    releaseManifestAssetId: RuntimeManifestKeySchema.nullable(),
    createdAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((draft, ctx) => {
    const roomIds = draft.rooms.map((room) => room.id);
    if (new Set(roomIds).size !== roomIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message: "room IDs must be unique",
      });
    }

    const representationIds = draft.rooms.flatMap((room) =>
      room.representations.map((representation) => representation.id),
    );
    if (representationIds.length > 100_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message:
          "package drafts may contain at most 100,000 representations in aggregate",
      });
    }
    if (new Set(representationIds).size !== representationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message: "representation IDs must be unique across the package draft",
      });
    }

    const generatedRegionIds = draft.generatedRegions.map(
      (region) => region.id,
    );
    if (new Set(generatedRegionIds).size !== generatedRegionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generatedRegions"],
        message: "generated-region IDs must be unique",
      });
    }
  });
export type FoundryRoomRealityPackageDraftV0 = z.infer<
  typeof FoundryRoomRealityPackageDraftV0Schema
>;

export const FoundryRoomRealityPackageAssemblyInputV0Schema = z
  .object({
    ingestManifest: FoundryIngestManifestV0Schema,
    verifiedIngestManifestSha256: RuntimeSha256Schema,
    packageDraft: FoundryRoomRealityPackageDraftV0Schema,
    referenceCatalog: FoundryPackageReferenceCatalogSchema,
  })
  .strict();
export type FoundryRoomRealityPackageAssemblyInputV0 = z.infer<
  typeof FoundryRoomRealityPackageAssemblyInputV0Schema
>;

const AssemblyCapabilitiesSchema = z
  .object({
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    runtimeActivation: z.literal("not_authorized"),
    exportAuthority: z.literal("not_authorized"),
    runtimePackageRegistration: z.literal("not_authorized"),
  })
  .strict();

const AssemblyReleaseBlockerSchema = z.enum([
  "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
  "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
  "REFERENCE_CATALOG_UNAUTHENTICATED",
  "RIGHTS_BLOCKED",
  "RIGHTS_NOT_APPROVED",
]);

const ALWAYS_UNVERIFIED_RELEASE_BLOCKERS = [
  "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
  "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
  "REFERENCE_CATALOG_UNAUTHENTICATED",
] as const;

const AssemblyPayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROOM_REALITY_PACKAGE_ASSEMBLY_V0),
    status: z.enum(["local_unverified_candidate", "blocked"]),
    packageId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    ingestManifestSha256: RuntimeSha256Schema,
    packageDraftSha256: RuntimeSha256Schema,
    referenceCatalogSha256: RuntimeSha256Schema,
    ingestLegalReviewState: z.enum([
      "not_reviewed",
      "requires_review",
      "approved",
      "blocked",
    ]),
    referenceCatalogAuthority: z.literal("caller_supplied_unverified"),
    exactMemberIdentities: z.literal("not_verified"),
    movableObjectClassification: z.literal("not_verified"),
    releaseEligibility: z.literal("blocked"),
    releaseBlockers: z.array(AssemblyReleaseBlockerSchema).min(3).max(5),
    canonicalPackage: FoundryCanonicalVenuePackageV0Schema.nullable(),
    unresolvedReferences: z
      .array(z.string().trim().min(1).max(500))
      .max(1_000_000),
    authority: z.literal("none"),
    capabilities: AssemblyCapabilitiesSchema,
  })
  .strict();

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => {
    const previous = index === 0 ? undefined : values[index - 1];
    return (
      previous === undefined || compareCanonicalStrings(previous, value) <= 0
    );
  });
}

function validateAssemblyPayload(
  payload: z.infer<typeof AssemblyPayloadObjectV0Schema>,
  ctx: z.RefinementCtx,
): void {
  if (
    new Set(payload.unresolvedReferences).size !==
      payload.unresolvedReferences.length ||
    !isSorted(payload.unresolvedReferences)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unresolvedReferences"],
      message: "unresolved references must be unique and canonically sorted",
    });
  }
  if (
    payload.status === "local_unverified_candidate" &&
    (payload.canonicalPackage === null ||
      payload.unresolvedReferences.length !== 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message:
        "local unverified candidates require a canonical package and no unresolved structural references",
    });
  }
  const expectedReleaseBlockers = [
    ...ALWAYS_UNVERIFIED_RELEASE_BLOCKERS,
    ...(payload.ingestLegalReviewState === "blocked"
      ? (["RIGHTS_BLOCKED"] as const)
      : payload.ingestLegalReviewState === "approved"
        ? []
        : (["RIGHTS_NOT_APPROVED"] as const)),
  ].sort(compareCanonicalStrings);
  if (
    new Set(payload.releaseBlockers).size !== payload.releaseBlockers.length ||
    !isSorted(payload.releaseBlockers) ||
    JSON.stringify(payload.releaseBlockers) !==
      JSON.stringify(expectedReleaseBlockers)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["releaseBlockers"],
      message:
        "release blockers must preserve legal state and every unauthenticated local-candidate gate",
    });
  }
  if (
    payload.status === "blocked" &&
    payload.unresolvedReferences.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unresolvedReferences"],
      message:
        "blocked assemblies require at least one actionable unresolved reference",
    });
  }

  const venuePackage = payload.canonicalPackage;
  if (venuePackage === null) return;
  if (
    venuePackage.id !== payload.packageId ||
    venuePackage.projectId !== payload.projectId ||
    venuePackage.ingestManifestSha256 !== payload.ingestManifestSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["canonicalPackage"],
      message: "canonical package identity must match the assembly subject",
    });
  }
  if (!isSorted(venuePackage.rooms.map((room) => room.id))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["canonicalPackage", "rooms"],
      message: "canonical package rooms must be sorted by ID",
    });
  }
  for (const [roomIndex, room] of venuePackage.rooms.entries()) {
    if (
      !isSorted(room.representations.map((representation) => representation.id))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalPackage", "rooms", roomIndex, "representations"],
        message: "canonical room representations must be sorted by ID",
      });
    }
  }
  if (!isSorted(venuePackage.generatedRegions.map((region) => region.id))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["canonicalPackage", "generatedRegions"],
      message: "canonical generated regions must be sorted by ID",
    });
  }
  for (const [regionIndex, region] of venuePackage.generatedRegions.entries()) {
    if (
      !isSorted(region.sourceAssetIds) ||
      !isSorted(region.exportRestrictions)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalPackage", "generatedRegions", regionIndex],
        message: "generated-region sets must be canonically sorted",
      });
    }
  }
}

export const FoundryRoomRealityPackageAssemblyPayloadV0Schema =
  AssemblyPayloadObjectV0Schema.superRefine(validateAssemblyPayload);
export type FoundryRoomRealityPackageAssemblyPayloadV0 = z.infer<
  typeof FoundryRoomRealityPackageAssemblyPayloadV0Schema
>;

export const FoundryRoomRealityPackageAssemblyResultV0Schema =
  AssemblyPayloadObjectV0Schema.extend({
    assemblySha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((result, ctx) => {
      const { assemblySha256: _assemblySha256, ...payload } = result;
      validateAssemblyPayload(payload, ctx);
      const parsedPayload =
        FoundryRoomRealityPackageAssemblyPayloadV0Schema.safeParse(payload);
      if (
        parsedPayload.success &&
        result.assemblySha256 !==
          computeFoundryRoomRealityPackageAssemblySha256(parsedPayload.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assemblySha256"],
          message: "assembly digest must match its exact canonical payload",
        });
      }
    });
export type FoundryRoomRealityPackageAssemblyResultV0 = z.infer<
  typeof FoundryRoomRealityPackageAssemblyResultV0Schema
>;

function prefixedDomainDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function canonicalizePackageDraft(
  draft: FoundryRoomRealityPackageDraftV0,
): FoundryRoomRealityPackageDraftV0 {
  return FoundryRoomRealityPackageDraftV0Schema.parse({
    ...draft,
    rooms: [...draft.rooms]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map((room) => ({
        ...room,
        representations: [...room.representations].sort((left, right) =>
          compareCanonicalStrings(left.id, right.id),
        ),
      })),
    generatedRegions: [...draft.generatedRegions]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map((region) => ({
        ...region,
        sourceAssetIds: [...region.sourceAssetIds].sort(
          compareCanonicalStrings,
        ),
        exportRestrictions: [...region.exportRestrictions].sort(
          compareCanonicalStrings,
        ),
      })),
  });
}

function canonicalizeReferenceCatalog(
  catalog: FoundryPackageReferenceCatalog,
): FoundryPackageReferenceCatalog {
  return FoundryPackageReferenceCatalogSchema.parse({
    assets: [...catalog.assets]
      .sort((left, right) => compareCanonicalStrings(left.id, right.id))
      .map((asset) => ({
        ...asset,
        evidenceKinds: [...asset.evidenceKinds].sort(compareCanonicalStrings),
      })),
    coordinateFrameIds: [...catalog.coordinateFrameIds].sort(
      compareCanonicalStrings,
    ),
    qualityReports: [...catalog.qualityReports].sort((left, right) =>
      compareCanonicalStrings(left.id, right.id),
    ),
  });
}

export function computeFoundryRoomRealityPackageDraftSha256(
  input: FoundryRoomRealityPackageDraftV0,
): string {
  const draft = canonicalizePackageDraft(
    FoundryRoomRealityPackageDraftV0Schema.parse(input),
  );
  return prefixedDomainDigest(PACKAGE_DRAFT_DIGEST_DOMAIN, draft);
}

export function computeFoundryRoomRealityReferenceCatalogSha256(
  input: FoundryPackageReferenceCatalog,
): string {
  const catalog = canonicalizeReferenceCatalog(
    FoundryPackageReferenceCatalogSchema.parse(input),
  );
  return prefixedDomainDigest(REFERENCE_CATALOG_DIGEST_DOMAIN, catalog);
}

export function computeFoundryRoomRealityPackageAssemblySha256(
  input: FoundryRoomRealityPackageAssemblyPayloadV0,
): string {
  const payload = FoundryRoomRealityPackageAssemblyPayloadV0Schema.parse(input);
  return prefixedDomainDigest(ASSEMBLY_DIGEST_DOMAIN, payload);
}

function structuralUnresolvedReferences(
  draft: FoundryRoomRealityPackageDraftV0,
): string[] {
  const unresolved = new Set<string>();
  for (const room of draft.rooms) {
    const roles = new Set(
      room.representations.map((representation) => representation.role),
    );
    if (
      !["measured_geometry", "planning_mesh", "architectural_mesh"].some(
        (role) =>
          roles.has(role as (typeof room.representations)[number]["role"]),
      )
    ) {
      unresolved.add(
        `required_room_role:${room.id}:captured_metric_or_planning_geometry`,
      );
    }
    for (const role of [
      "semantic_graph",
      "camera_spawn_points",
      "room_connectivity",
    ] as const) {
      if (!roles.has(role))
        unresolved.add(`required_room_role:${room.id}:${role}`);
    }
  }

  const generatedRepresentationAssetIds = new Set(
    draft.rooms.flatMap((room) =>
      room.representations
        .filter(
          (representation) => representation.role === "generated_derivative",
        )
        .map((representation) => representation.assetId),
    ),
  );
  const generatedRegionAssetIds = new Set(
    draft.generatedRegions.map((region) => region.outputAssetId),
  );
  for (const assetId of generatedRepresentationAssetIds) {
    if (!generatedRegionAssetIds.has(assetId)) {
      unresolved.add(`generated_region:${assetId}`);
    }
  }
  for (const assetId of generatedRegionAssetIds) {
    if (!generatedRepresentationAssetIds.has(assetId)) {
      unresolved.add(`generated_representation:${assetId}`);
    }
  }
  return [...unresolved].sort(compareCanonicalStrings);
}

function buildAssemblyResult(
  draft: FoundryRoomRealityPackageDraftV0,
  ingestManifestSha256: string,
  ingestLegalReviewState:
    | "not_reviewed"
    | "requires_review"
    | "approved"
    | "blocked",
  referenceCatalog: FoundryPackageReferenceCatalog,
  canonicalPackage: FoundryCanonicalVenuePackageV0 | null,
  unresolvedReferences: readonly string[],
): FoundryRoomRealityPackageAssemblyResultV0 {
  const orderedUnresolved = [...new Set(unresolvedReferences)].sort(
    compareCanonicalStrings,
  );
  const payload = FoundryRoomRealityPackageAssemblyPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_ROOM_REALITY_PACKAGE_ASSEMBLY_V0,
    status:
      orderedUnresolved.length === 0 ? "local_unverified_candidate" : "blocked",
    packageId: draft.id,
    projectId: draft.projectId,
    ingestManifestSha256,
    packageDraftSha256: computeFoundryRoomRealityPackageDraftSha256(draft),
    referenceCatalogSha256:
      computeFoundryRoomRealityReferenceCatalogSha256(referenceCatalog),
    ingestLegalReviewState,
    referenceCatalogAuthority: "caller_supplied_unverified",
    exactMemberIdentities: "not_verified",
    movableObjectClassification: "not_verified",
    releaseEligibility: "blocked",
    releaseBlockers: [
      ...ALWAYS_UNVERIFIED_RELEASE_BLOCKERS,
      ...(ingestLegalReviewState === "blocked"
        ? (["RIGHTS_BLOCKED"] as const)
        : ingestLegalReviewState === "approved"
          ? []
          : (["RIGHTS_NOT_APPROVED"] as const)),
    ].sort(compareCanonicalStrings),
    canonicalPackage,
    unresolvedReferences: orderedUnresolved,
    authority: "none",
    capabilities: {
      signing: "not_authorized",
      publication: "not_authorized",
      runtimeActivation: "not_authorized",
      exportAuthority: "not_authorized",
      runtimePackageRegistration: "not_authorized",
    },
  });
  return FoundryRoomRealityPackageAssemblyResultV0Schema.parse({
    ...payload,
    assemblySha256: computeFoundryRoomRealityPackageAssemblySha256(payload),
  });
}

/**
 * Assembles a review-only package record. It performs no source reads, signing,
 * publication, export, runtime activation, or RuntimePackage registration.
 */
export function assembleFoundryRoomRealityPackage(
  input: unknown,
): FoundryRoomRealityPackageAssemblyResultV0 {
  const inputResult =
    FoundryRoomRealityPackageAssemblyInputV0Schema.safeParse(input);
  if (!inputResult.success) {
    throw new FoundryIntegrityError(
      "ROOM_REALITY_PACKAGE_ASSEMBLY_INPUT_INVALID",
      "Room Reality Package assembly input is invalid.",
      { cause: inputResult.error },
    );
  }
  const parsed = inputResult.data;
  const actualIngestManifestSha256 = computeFoundryIngestManifestSha256(
    parsed.ingestManifest,
  );
  if (actualIngestManifestSha256 !== parsed.verifiedIngestManifestSha256) {
    throw new FoundryIntegrityError(
      "ROOM_REALITY_PACKAGE_INGEST_DIGEST_MISMATCH",
      "The supplied ingest manifest does not match its verified digest.",
    );
  }
  if (parsed.ingestManifest.projectId !== parsed.packageDraft.projectId) {
    throw new FoundryIntegrityError(
      "ROOM_REALITY_PACKAGE_PROJECT_MISMATCH",
      "The package draft project does not match the verified ingest manifest.",
    );
  }

  const draft = canonicalizePackageDraft(parsed.packageDraft);
  const referenceCatalog = canonicalizeReferenceCatalog(
    parsed.referenceCatalog,
  );
  const structuralUnresolved = structuralUnresolvedReferences(draft);
  if (structuralUnresolved.length !== 0) {
    return buildAssemblyResult(
      draft,
      actualIngestManifestSha256,
      parsed.ingestManifest.legalReviewState,
      referenceCatalog,
      null,
      structuralUnresolved,
    );
  }

  const packageResult = FoundryCanonicalVenuePackageV0Schema.safeParse({
    schemaVersion: FOUNDRY_CANONICAL_VENUE_PACKAGE_V0,
    id: draft.id,
    projectId: draft.projectId,
    venueFrameId: draft.venueFrameId,
    ingestManifestSha256: actualIngestManifestSha256,
    rooms: draft.rooms,
    generatedRegions: draft.generatedRegions,
    packageQualityReportId: draft.packageQualityReportId,
    releaseManifestAssetId: draft.releaseManifestAssetId,
    createdAt: draft.createdAt,
  });
  if (!packageResult.success) {
    throw new FoundryIntegrityError(
      "ROOM_REALITY_CANONICAL_PACKAGE_INVALID",
      "The explicit package draft cannot form a canonical venue package.",
      { cause: packageResult.error },
    );
  }

  const referenceDecision = validateFoundryCanonicalPackageReferences(
    packageResult.data,
    referenceCatalog,
  );
  return buildAssemblyResult(
    draft,
    actualIngestManifestSha256,
    parsed.ingestManifest.legalReviewState,
    referenceCatalog,
    packageResult.data,
    referenceDecision.valid ? [] : referenceDecision.missingReferences,
  );
}

/** Recomputes a local candidate from the exact inputs; neither value is authority. */
export function verifyFoundryRoomRealityPackageAssembly(
  resultInput: unknown,
  input: unknown,
): FoundryRoomRealityPackageAssemblyResultV0 {
  const result =
    FoundryRoomRealityPackageAssemblyResultV0Schema.parse(resultInput);
  const expected = assembleFoundryRoomRealityPackage(input);
  if (result.assemblySha256 !== expected.assemblySha256) {
    throw new FoundryIntegrityError(
      "ROOM_REALITY_PACKAGE_ASSEMBLY_RECOMPUTATION_MISMATCH",
      "The Room Reality Package assembly does not match the exact supplied manifest, draft, and reference catalog.",
    );
  }
  return result;
}
