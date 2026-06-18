import { z } from "zod";
import { SafePlanningWordingSchema } from "./evidence-runtime.js";
import { RuntimeSlugSchema, TradesHallRuntimeRoomSlugSchema } from "./asset-version.js";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION = "runtime-composition-decision.v0";

export const RUNTIME_COMPOSITION_DECISIONS = [
  "serve_manifest_room_sog_chunks",
  "load_lcc2_graph_directly",
  "convert_lcc2_to_runtime_manifest",
] as const;
export const RuntimeCompositionDecisionSchema = z.enum(RUNTIME_COMPOSITION_DECISIONS);
export type RuntimeCompositionDecision = z.infer<typeof RuntimeCompositionDecisionSchema>;

export const RUNTIME_LOD_GRAPH_AUTHORITIES = [
  "not_runtime_authoritative",
  "runtime_authoritative",
  "conversion_source_only",
] as const;
export const RuntimeLodGraphAuthoritySchema = z.enum(RUNTIME_LOD_GRAPH_AUTHORITIES);
export type RuntimeLodGraphAuthority = z.infer<typeof RuntimeLodGraphAuthoritySchema>;

export const RUNTIME_COMPOSITION_REVIEW_TRIGGERS = [
  "runtime_package_changed",
  "chunk_hash_changed",
  "lcc2_loader_implemented",
  "lcc2_conversion_lane_implemented",
  "signed_transform_registered",
  "public_exposure_requested",
] as const;
export const RuntimeCompositionReviewTriggerSchema = z.enum(
  RUNTIME_COMPOSITION_REVIEW_TRIGGERS,
);
export type RuntimeCompositionReviewTrigger = z.infer<
  typeof RuntimeCompositionReviewTriggerSchema
>;

export const RuntimeCompositionEvidenceRefSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    ref: z.string().trim().min(1).max(260),
  })
  .strict();
export type RuntimeCompositionEvidenceRef = z.infer<
  typeof RuntimeCompositionEvidenceRefSchema
>;

export const RuntimeSogChunkDecisionSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_. -]+\.sog$/u),
    sha256: z.string().regex(SHA256_HEX),
    sizeBytes: z.number().int().positive(),
    loadedSplats: z.number().int().positive(),
    role: z.enum(["room_chunk", "environment_chunk"]),
    reason: SafePlanningWordingSchema,
  })
  .strict();
export type RuntimeSogChunkDecision = z.infer<typeof RuntimeSogChunkDecisionSchema>;

export const RuntimeCompositionDecisionV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION),
    decisionId: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    venueSlug: RuntimeSlugSchema,
    roomSlug: TradesHallRuntimeRoomSlugSchema,
    runtimePackageId: z.string().uuid(),
    decidedAt: z.string().datetime({ offset: true }),
    decidedBy: z.string().trim().min(1).max(160),
    decision: RuntimeCompositionDecisionSchema,
    lcc2Manifest: z.object({
      fileName: z.string().trim().min(1).max(255).regex(/\.lcc2$/u),
      sha256: z.string().regex(SHA256_HEX),
      sourceBundleHash: z.string().regex(SHA256_HEX),
      totalSplats: z.number().int().positive(),
      authority: RuntimeLodGraphAuthoritySchema,
      role: z.literal("source_manifest_provenance"),
      evidenceRefs: z.array(RuntimeCompositionEvidenceRefSchema).min(1),
    }).strict(),
    runtimeLoading: z.object({
      renderer: z.literal("@sparkjsdev/spark"),
      servedChunkStrategy: z.literal("manifest_room_sog_chunks"),
      chunkOrdering: z.literal("api_file_name_ascending"),
      visualAssetUrlsExpectedCount: z.number().int().positive(),
      loadedSplatsExpected: z.number().int().positive(),
      servedRoomChunks: z.array(RuntimeSogChunkDecisionSchema).min(1),
      excludedChunks: z.array(RuntimeSogChunkDecisionSchema).min(1),
    }).strict(),
    guardrails: z.object({
      lcc2DirectLoaderEnabled: z.boolean(),
      signedTransformCreated: z.literal(false),
      publicExposureChanged: z.literal(false),
      operationalGeometryCreated: z.literal(false),
    }).strict(),
    limitations: z.array(SafePlanningWordingSchema).min(1),
    reviewTriggers: z.array(RuntimeCompositionReviewTriggerSchema).min(1),
    evidenceRefs: z.array(RuntimeCompositionEvidenceRefSchema).min(1),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.decision === "serve_manifest_room_sog_chunks") {
      if (record.lcc2Manifest.authority !== "not_runtime_authoritative") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lcc2Manifest", "authority"],
          message: "Direct chunk-serving decisions must keep the LCC2 graph non-authoritative at runtime.",
        });
      }
      if (record.guardrails.lcc2DirectLoaderEnabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["guardrails", "lcc2DirectLoaderEnabled"],
          message: "Direct chunk-serving decisions cannot enable the LCC2 direct loader.",
        });
      }
    }

    const servedNames = new Set(record.runtimeLoading.servedRoomChunks.map((chunk) => chunk.fileName));
    for (const [index, chunk] of record.runtimeLoading.servedRoomChunks.entries()) {
      if (chunk.role !== "room_chunk") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "servedRoomChunks", index, "role"],
          message: "Served runtime chunks must be room chunks.",
        });
      }
    }

    for (const [index, chunk] of record.runtimeLoading.excludedChunks.entries()) {
      if (chunk.role !== "environment_chunk") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "excludedChunks", index, "role"],
          message: "Excluded chunks must be environment chunks.",
        });
      }
      if (servedNames.has(chunk.fileName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeLoading", "excludedChunks", index, "fileName"],
          message: "A chunk cannot be both served and excluded.",
        });
      }
    }

    if (record.runtimeLoading.visualAssetUrlsExpectedCount !== record.runtimeLoading.servedRoomChunks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeLoading", "visualAssetUrlsExpectedCount"],
        message: "visualAssetUrlsExpectedCount must match the served room chunk count.",
      });
    }

    const servedSplats = record.runtimeLoading.servedRoomChunks.reduce(
      (sum, chunk) => sum + chunk.loadedSplats,
      0,
    );
    if (record.runtimeLoading.loadedSplatsExpected !== servedSplats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeLoading", "loadedSplatsExpected"],
        message: "loadedSplatsExpected must equal the sum of served room chunk splats.",
      });
    }

    if (record.lcc2Manifest.totalSplats !== servedSplats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lcc2Manifest", "totalSplats"],
        message: "The LCC2 room total must equal the served room chunk splat total.",
      });
    }
  });
export type RuntimeCompositionDecisionV0 = z.infer<typeof RuntimeCompositionDecisionV0Schema>;
