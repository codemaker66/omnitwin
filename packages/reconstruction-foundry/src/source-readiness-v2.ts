import {
  FoundryFileDetectionSchema,
  FoundryInputTypeSchema,
  FoundryRelativePathSchema,
  type FoundryInputType,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeFile,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";
import {
  FoundryUniversalSourceFactsV2Schema,
  type FoundryUniversalSourceFactsV2,
  type UniversalSourceFactsV2Asset,
} from "./source-facts-v2.js";
import { FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION } from "./source-facts.js";

export const FOUNDRY_SOURCE_READINESS_MAP_V2 =
  "omnitwin.foundry.source-readiness-map.v2";
export const FOUNDRY_SOURCE_READINESS_MAP_V2_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_SOURCE_READINESS_MAP_V2";
export const FOUNDRY_SOURCE_READINESS_MAP_MEANING =
  "pre_admission_source_candidate_map";
export const FOUNDRY_SOURCE_READINESS_MAP_BASIS =
  "exact_intake_receipt_and_universal_source_facts";
export const FOUNDRY_SOURCE_READINESS_MAP_DISCLAIMER =
  "This map describes source candidates and observed format facts only; it is not processing readiness, admission, route selection, recipe compilation, registration, accuracy, rights, or execution authorization.";
export const FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS = [
  "FORMAT_FACTS_ARE_NOT_PROCESSING_READINESS",
  "UNTARGETED_FORMATS_HAVE_DETECTION_ONLY",
  "FILESYSTEM_CHANGES_AFTER_RECEIPT_ARE_NOT_DETECTED",
  "DUPLICATE_CONTENT_IS_NOT_INDEPENDENT_EVIDENCE",
] as const;

export const FOUNDRY_SOURCE_READINESS_LANE_IDS = [
  "point_geometry",
  "mesh_geometry",
  "image_video",
  "registration_and_control",
  "visual_scene_representation",
  "context_and_evidence",
  "vendor_or_opaque_package",
  "unclassified",
] as const;

export const FoundrySourceReadinessLaneIdSchema = z.enum(
  FOUNDRY_SOURCE_READINESS_LANE_IDS,
);
export type FoundrySourceReadinessLaneId = z.infer<
  typeof FoundrySourceReadinessLaneIdSchema
>;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;

const LANE_DESCRIPTORS = [
  {
    id: "point_geometry",
    heading: "Point geometry",
    meaning: "Sources that may contain measured or reconstructed point geometry.",
  },
  {
    id: "mesh_geometry",
    heading: "Mesh geometry",
    meaning: "Sources that may contain polygonal or surface geometry.",
  },
  {
    id: "image_video",
    heading: "Image and video",
    meaning: "Sources that may contain still imagery, panoramic imagery, RGB-D frames, or video.",
  },
  {
    id: "registration_and_control",
    heading: "Registration and control",
    meaning: "Sources that may describe calibration, trajectories, sensor observations, or control relationships.",
  },
  {
    id: "visual_scene_representation",
    heading: "Visual scene representation",
    meaning: "Sources that may contain splats, Gaussian scene data, or scene-description representations.",
  },
  {
    id: "context_and_evidence",
    heading: "Context and evidence",
    meaning: "Sources that may contain plans, annotations, provenance context, or evidence records.",
  },
  {
    id: "vendor_or_opaque_package",
    heading: "Vendor or opaque package",
    meaning: "Sources whose useful content may depend on a vendor export or documented package interface.",
  },
  {
    id: "unclassified",
    heading: "Unclassified",
    meaning: "Sources for which the receipt establishes no candidate source family.",
  },
] as const satisfies readonly {
  readonly id: FoundrySourceReadinessLaneId;
  readonly heading: string;
  readonly meaning: string;
}[];

const LANE_DESCRIPTOR_BY_ID = new Map(
  LANE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor] as const),
);

const INPUT_TYPE_LANES: Readonly<
  Record<FoundryInputType, readonly FoundrySourceReadinessLaneId[]>
> = {
  matterport_e57: ["point_geometry"],
  matterpak_bundle: ["vendor_or_opaque_package"],
  generic_e57: ["point_geometry"],
  las_laz: ["point_geometry"],
  xyz_point_cloud: ["point_geometry"],
  ply_point_cloud: ["point_geometry"],
  matterport_panorama: ["image_video"],
  dslr_image: ["image_video"],
  generic_image: ["image_video"],
  panorama_360: ["image_video"],
  phone_image: ["image_video"],
  drone_media: ["image_video"],
  video: ["image_video"],
  rgbd: ["point_geometry", "image_video"],
  sensor_log_mcap: ["registration_and_control"],
  imu: ["registration_and_control"],
  gnss_rtk: ["registration_and_control"],
  xgrids_xbin: ["vendor_or_opaque_package"],
  lcc: ["vendor_or_opaque_package"],
  lcc2: ["vendor_or_opaque_package"],
  spz: ["visual_scene_representation"],
  sog: ["visual_scene_representation"],
  gaussian_ply: ["visual_scene_representation"],
  obj: ["mesh_geometry"],
  fbx: ["mesh_geometry"],
  glb_gltf: ["mesh_geometry"],
  floor_plan: ["context_and_evidence"],
  cad_bim: ["mesh_geometry", "vendor_or_opaque_package"],
  openusd: ["visual_scene_representation"],
  calibration_bundle: ["registration_and_control"],
  trajectory: ["registration_and_control"],
  control_network: ["registration_and_control"],
  colmap_database: ["registration_and_control"],
  colmap_sparse_model: ["registration_and_control"],
  manual_evidence: ["context_and_evidence"],
  evidence_record: ["context_and_evidence"],
};

const FILE_STATUSES = [
  "facts_established",
  "facts_not_established",
  "outside_source_facts_v2",
  "ambiguous_format",
  "unclassified_format",
] as const;
const FileStatusSchema = z.enum(FILE_STATUSES);
type FileStatus = z.infer<typeof FileStatusSchema>;

const LANE_STATUSES = [
  "all_observed_facts_established",
  "evidence_incomplete",
  "no_source_observed",
  "blocked",
] as const;
const LaneStatusSchema = z.enum(LANE_STATUSES);

const UnknownFactSchema = z
  .object({
    code: z.string().regex(STABLE_CODE),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    decisiveNextTest: z.string().trim().min(1).max(500),
  })
  .strict();
type UnknownFact = z.infer<typeof UnknownFactSchema>;

const InspectionSchema = z
  .object({
    state: z.enum(["established", "facts_not_established"]),
    category: z.enum([
      "established",
      "resource_limit",
      "parse_failure",
      "unsupported_variant",
      "unsupported_container",
    ]),
    code: z.string().regex(STABLE_CODE),
    coverage: z.enum([
      "none",
      "physical_header",
      "container_header",
      "container_header_and_json",
      "complete_container_structure",
      "complete_stream",
    ]),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (
      (inspection.state === "established") !==
      (inspection.category === "established")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "inspection state and category must agree",
      });
    }
  });

const DuplicateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unique"), groupSha256: z.null() }).strict(),
  z
    .object({
      status: z.literal("exact_content_duplicate"),
      groupSha256: z.string().regex(SHA256_HEX),
    })
    .strict(),
]);

const ReadinessFileSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
    duplicate: DuplicateSchema,
    detection: FoundryFileDetectionSchema,
    status: FileStatusSchema,
    inputType: FoundryInputTypeSchema.nullable(),
    format: z.enum(["e57", "glb", "gltf_json", "obj", "sog", "spz"]).nullable(),
    laneIds: z.array(FoundrySourceReadinessLaneIdSchema).min(1).max(
      FOUNDRY_SOURCE_READINESS_LANE_IDS.length,
    ),
    inspection: InspectionSchema.nullable(),
    unknowns: z.array(UnknownFactSchema).max(256),
    decisiveNextTests: z.array(z.string().trim().min(1).max(500)).max(256),
  })
  .strict()
  .superRefine((file, ctx) => {
    const expectedLaneIds = canonicalLaneIds(file.laneIds);
    if (JSON.stringify(file.laneIds) !== JSON.stringify(expectedLaneIds)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "file lane identifiers must be unique and canonically ordered",
      });
    }
    if (
      file.unknowns.some(
        (unknown, index) =>
          index > 0 &&
          compareCanonicalStrings(
            file.unknowns[index - 1]?.code ?? "",
            unknown.code,
          ) >= 0,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unknowns"],
        message: "file unknowns must have unique, canonically ordered codes",
      });
    }
    const genericStatusTest = statusDecisiveTest(file.status);
    const expectedTests = uniqueSorted([
      ...file.unknowns.map((unknown) => unknown.decisiveNextTest),
      ...(genericStatusTest === null ? [] : [genericStatusTest]),
    ]);
    if (JSON.stringify(file.decisiveNextTests) !== JSON.stringify(expectedTests)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisiveNextTests"],
        message: "file decisive tests must be derived from its unknown facts",
      });
    }
    if (
      file.duplicate.status === "exact_content_duplicate" &&
      file.duplicate.groupSha256 !== file.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duplicate", "groupSha256"],
        message: "duplicate group digest must equal the file digest",
      });
    }
    validateFileEvidenceState(file, ctx);
  });
type ReadinessFile = z.infer<typeof ReadinessFileSchema>;

const RepresentedSourceSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sha256: z.string().regex(SHA256_HEX),
    status: FileStatusSchema,
  })
  .strict();

const GroupedUnknownSchema = UnknownFactSchema.extend({
  sourcePaths: z.array(FoundryRelativePathSchema).min(1),
}).strict();

const LaneCountsSchema = z
  .object({
    observedFileCount: z.number().int().nonnegative(),
    distinctContentCount: z.number().int().nonnegative(),
    factsEstablishedCount: z.number().int().nonnegative(),
    factsNotEstablishedCount: z.number().int().nonnegative(),
    outsideSourceFactsV2Count: z.number().int().nonnegative(),
    ambiguousFormatCount: z.number().int().nonnegative(),
    unclassifiedFormatCount: z.number().int().nonnegative(),
  })
  .strict();

const LaneSchema = z
  .object({
    id: FoundrySourceReadinessLaneIdSchema,
    heading: z.string().trim().min(1).max(120),
    meaning: z.string().trim().min(1).max(500),
    status: LaneStatusSchema,
    reasonCode: z.enum([
      "ALL_OBSERVED_FACTS_ESTABLISHED",
      "EVIDENCE_INCOMPLETE",
      "NO_SOURCE_OBSERVED",
      "XGRIDS_XBIN_BLOCKED",
    ]),
    counts: LaneCountsSchema,
    representedSources: z.array(RepresentedSourceSchema),
    unknowns: z.array(GroupedUnknownSchema),
    decisiveNextTests: z.array(z.string().trim().min(1).max(500)),
  })
  .strict()
  .superRefine((lane, ctx) => {
    const descriptor = LANE_DESCRIPTOR_BY_ID.get(lane.id);
    if (
      descriptor === undefined ||
      descriptor.heading !== lane.heading ||
      descriptor.meaning !== lane.meaning
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heading"],
        message: "lane heading and meaning must match its canonical identifier",
      });
    }
    const expectedReason = reasonForLaneStatus(lane.status);
    if (lane.reasonCode !== expectedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "lane reason code must match its status",
      });
    }
    if (lane.counts.observedFileCount !== lane.representedSources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counts", "observedFileCount"],
        message: "lane observed count must equal its represented-source count",
      });
    }
    if (!isSortedUnique(lane.representedSources.map((source) => source.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["representedSources"],
        message: "represented sources must be unique and canonically ordered",
      });
    }
    if (!isSortedUnique(lane.unknowns.map((unknown) => unknown.code))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unknowns"],
        message: "lane unknowns must have unique, canonically ordered codes",
      });
    }
    for (const [index, unknown] of lane.unknowns.entries()) {
      if (!isSortedUnique(unknown.sourcePaths)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unknowns", index, "sourcePaths"],
          message: "unknown source paths must be unique and canonically ordered",
        });
      }
    }
    if (
      JSON.stringify(lane.decisiveNextTests) !==
      JSON.stringify(uniqueSorted(lane.decisiveNextTests))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisiveNextTests"],
        message: "lane decisive tests must be unique and canonically ordered",
      });
    }
  });
type Lane = z.infer<typeof LaneSchema>;

const GapSchema = z
  .object({
    code: z.enum([
      "AMBIGUOUS_FORMAT",
      "NO_SOURCE_OBSERVED",
      "OUTSIDE_SOURCE_FACTS_V2",
      "SOURCE_FACTS_NOT_ESTABLISHED",
      "UNCLASSIFIED_FORMAT",
    ]),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    decisiveNextTest: z.string().trim().min(1).max(500),
    laneIds: z.array(FoundrySourceReadinessLaneIdSchema),
    sourcePaths: z.array(FoundryRelativePathSchema),
  })
  .strict()
  .superRefine((gap, ctx) => {
    if (JSON.stringify(gap.laneIds) !== JSON.stringify(canonicalLaneIds(gap.laneIds))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "gap lane identifiers must be unique and canonically ordered",
      });
    }
    if (!isSortedUnique(gap.sourcePaths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePaths"],
        message: "gap source paths must be unique and canonically ordered",
      });
    }
  });
type Gap = z.infer<typeof GapSchema>;

const SummarySchema = z
  .object({
    receiptFileCount: z.number().int().nonnegative(),
    representedFileCount: z.number().int().nonnegative(),
    distinctContentCount: z.number().int().nonnegative(),
    factsEstablishedCount: z.number().int().nonnegative(),
    factsNotEstablishedCount: z.number().int().nonnegative(),
    outsideSourceFactsV2Count: z.number().int().nonnegative(),
    ambiguousFormatCount: z.number().int().nonnegative(),
    unclassifiedFormatCount: z.number().int().nonnegative(),
    representedLaneCount: z.number().int().nonnegative(),
    gapCount: z.number().int().nonnegative(),
    affectedSourceCount: z.number().int().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    reconstruction: z.literal("none"),
    networkAccess: z.literal("none"),
    admission: z.literal("not_evaluated"),
    routeCompilation: z.literal("none"),
    recipeCompilation: z.literal("none"),
    workerSelection: z.literal("none"),
    providerSelection: z.literal("none"),
    execution: z.literal("not_authorized"),
    authority: z.literal("none"),
    rights: z.literal("not_evaluated"),
    accuracy: z.literal("not_evaluated"),
    registration: z.literal("not_evaluated"),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[3]),
]);

const AffectedSourceSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
    inputType: z.literal("xgrids_xbin"),
  })
  .strict();

const BlockedReasonSchema = z
  .object({
    code: z.literal("XGRIDS_XBIN_BLOCKED"),
    message: z.literal(
      "The source set includes an XGRIDS XBIN candidate, so Source Readiness Map V2 exposes no partial file or lane evidence.",
    ),
    nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
    affectedSources: z.array(AffectedSourceSchema).min(1),
  })
  .strict();

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V2),
    meaning: z.literal(FOUNDRY_SOURCE_READINESS_MAP_MEANING),
    basis: z.literal(FOUNDRY_SOURCE_READINESS_MAP_BASIS),
    disclaimer: z.literal(FOUNDRY_SOURCE_READINESS_MAP_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    lanes: z.array(LaneSchema).length(FOUNDRY_SOURCE_READINESS_LANE_IDS.length),
    readinessSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  files: z.array(ReadinessFileSchema),
  gaps: z.array(GapSchema),
  blockedReason: z.null(),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  files: z.tuple([]),
  gaps: z.tuple([]),
  blockedReason: BlockedReasonSchema,
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

export const FoundrySourceReadinessMapV2Schema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);
export type FoundrySourceReadinessMapV2 = z.infer<
  typeof FoundrySourceReadinessMapV2Schema
>;

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  reconstruction: "none",
  networkAccess: "none",
  admission: "not_evaluated",
  routeCompilation: "none",
  recipeCompilation: "none",
  workerSelection: "none",
  providerSelection: "none",
  execution: "not_authorized",
  authority: "none",
  rights: "not_evaluated",
  accuracy: "not_evaluated",
  registration: "not_evaluated",
};

const GENERIC_GAP_DETAILS = {
  AMBIGUOUS_FORMAT: {
    label: "Ambiguous format",
    reason: "The receipt preserves more than one candidate interpretation and this map does not select a winner.",
    decisiveNextTest: "Use a bounded format-aware inspection and operator-confirmed source context against this exact receipted content.",
  },
  NO_SOURCE_OBSERVED: {
    label: "No source observed",
    reason: "No receipted source is represented in one or more source-family lanes.",
    decisiveNextTest: "First bind a desired-output scope, then record each named family as selected or not needed; only selected families require a new source and rebuilt intake receipt and Source Facts artifact.",
  },
  OUTSIDE_SOURCE_FACTS_V2: {
    label: "Outside Source Facts V2",
    reason: "The receipt has candidate source families, but Source Facts V2 does not inspect this file format.",
    decisiveNextTest: "Add a bounded facts inspector for this exact format and rebuild Source Facts without selecting a processing route.",
  },
  SOURCE_FACTS_NOT_ESTABLISHED: {
    label: "Source facts not established",
    reason: "Source Facts V2 targeted the file but did not establish its bounded format facts.",
    decisiveNextTest: "Resolve the recorded inspection failure or limit against this exact content digest, then rebuild Source Facts.",
  },
  UNCLASSIFIED_FORMAT: {
    label: "Unclassified format",
    reason: "The receipt establishes no candidate source family for this file.",
    decisiveNextTest: "Identify the format from authoritative source context or obtain a documented official export, then rebuild the intake receipt.",
  },
} as const;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function isSortedUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) =>
        index === 0 ||
        compareCanonicalStrings(values[index - 1] ?? "", value) < 0,
    )
  );
}

function canonicalLaneIds(
  laneIds: readonly FoundrySourceReadinessLaneId[],
): FoundrySourceReadinessLaneId[] {
  const present = new Set(laneIds);
  return FOUNDRY_SOURCE_READINESS_LANE_IDS.filter((id) => present.has(id));
}

function expectedDuplicateForFile(
  files: readonly ReadinessFile[],
  file: ReadinessFile,
): z.infer<typeof DuplicateSchema> {
  const matchingContentCount = files.filter(
    (candidate) =>
      candidate.sha256 === file.sha256 && candidate.sizeBytes === file.sizeBytes,
  ).length;
  return matchingContentCount > 1
    ? { status: "exact_content_duplicate", groupSha256: file.sha256 }
    : { status: "unique", groupSha256: null };
}

function lanesForDetection(
  detection: z.infer<typeof FoundryFileDetectionSchema>,
): FoundrySourceReadinessLaneId[] {
  const laneIds = detection.candidates.flatMap(
    (candidate) => INPUT_TYPE_LANES[candidate.inputType],
  );
  const canonical = canonicalLaneIds(laneIds);
  return canonical.length > 0 ? canonical : ["unclassified"];
}

function reasonForLaneStatus(
  status: z.infer<typeof LaneStatusSchema>,
): z.infer<typeof LaneSchema>["reasonCode"] {
  switch (status) {
    case "all_observed_facts_established":
      return "ALL_OBSERVED_FACTS_ESTABLISHED";
    case "evidence_incomplete":
      return "EVIDENCE_INCOMPLETE";
    case "no_source_observed":
      return "NO_SOURCE_OBSERVED";
    case "blocked":
      return "XGRIDS_XBIN_BLOCKED";
  }
}

function validateFileEvidenceState(
  file: z.infer<typeof ReadinessFileSchema>,
  ctx: z.RefinementCtx,
): void {
  const factsStatus =
    file.status === "facts_established" ||
    file.status === "facts_not_established";
  if (
    factsStatus !==
    (file.inputType !== null && file.format !== null && file.inspection !== null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inspection"],
      message: "Source Facts identity and inspection fields must agree with file status",
    });
    return;
  }
  if (factsStatus) {
    const expectedInspectionState =
      file.status === "facts_established"
        ? "established"
        : "facts_not_established";
    if (file.inspection?.state !== expectedInspectionState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection", "state"],
        message: "inspection state must agree with file status",
      });
    }
    if (
      file.inputType !== null &&
      JSON.stringify(file.laneIds) !==
        JSON.stringify(canonicalLaneIds(INPUT_TYPE_LANES[file.inputType]))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "Source Facts input type must be authoritative for its lanes",
      });
    }
    const formatMatches =
      (file.format === "e57" &&
        (file.inputType === "generic_e57" ||
          file.inputType === "matterport_e57")) ||
      ((file.format === "glb" || file.format === "gltf_json") &&
        file.inputType === "glb_gltf") ||
      (file.format === "obj" && file.inputType === "obj") ||
      (file.format === "sog" && file.inputType === "sog") ||
      (file.format === "spz" && file.inputType === "spz");
    if (!formatMatches) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: "Source Facts format and authoritative input type disagree",
      });
    }
    if (
      file.inputType !== null &&
      !file.detection.candidates.some(
        (candidate) => candidate.inputType === file.inputType,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detection", "candidates"],
        message: "Source Facts input type must remain present in receipt detection evidence",
      });
    }
    if (file.detection.status === "unknown") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detection", "status"],
        message: "a Source Facts target cannot carry an unknown receipt detection state",
      });
    }
    return;
  }
  if (file.unknowns.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknowns"],
      message: "files outside Source Facts V2 cannot claim format unknowns",
    });
  }
  const expectedStatus: FileStatus =
    file.detection.status === "ambiguous"
      ? "ambiguous_format"
      : file.detection.status === "unknown"
        ? "unclassified_format"
        : "outside_source_facts_v2";
  if (file.status !== expectedStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "untargeted status must match the receipt detection state",
    });
  }
  if (
    JSON.stringify(file.laneIds) !==
    JSON.stringify(lanesForDetection(file.detection))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["laneIds"],
      message: "untargeted lanes must preserve all receipt detection candidates",
    });
  }
}

function laneStatus(represented: readonly ReadinessFile[]): z.infer<typeof LaneStatusSchema> {
  if (represented.length === 0) return "no_source_observed";
  return represented.every((file) => file.status === "facts_established")
    ? "all_observed_facts_established"
    : "evidence_incomplete";
}

function statusDecisiveTest(status: FileStatus): string | null {
  switch (status) {
    case "facts_established":
      return null;
    case "facts_not_established":
      return GENERIC_GAP_DETAILS.SOURCE_FACTS_NOT_ESTABLISHED.decisiveNextTest;
    case "outside_source_facts_v2":
      return GENERIC_GAP_DETAILS.OUTSIDE_SOURCE_FACTS_V2.decisiveNextTest;
    case "ambiguous_format":
      return GENERIC_GAP_DETAILS.AMBIGUOUS_FORMAT.decisiveNextTest;
    case "unclassified_format":
      return GENERIC_GAP_DETAILS.UNCLASSIFIED_FORMAT.decisiveNextTest;
  }
}

function groupLaneUnknowns(files: readonly ReadinessFile[]): z.infer<typeof GroupedUnknownSchema>[] {
  const groups = new Map<string, z.infer<typeof GroupedUnknownSchema>>();
  for (const file of files) {
    for (const unknown of file.unknowns) {
      const existing = groups.get(unknown.code);
      if (existing === undefined) {
        groups.set(unknown.code, { ...unknown, sourcePaths: [file.path] });
        continue;
      }
      if (
        existing.label !== unknown.label ||
        existing.reason !== unknown.reason ||
        existing.decisiveNextTest !== unknown.decisiveNextTest
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_READINESS_UNKNOWN_CONTRADICTION",
          `Unknown fact ${unknown.code} has contradictory definitions.`,
        );
      }
      existing.sourcePaths.push(file.path);
    }
  }
  return [...groups.values()]
    .map((unknown) => ({ ...unknown, sourcePaths: uniqueSorted(unknown.sourcePaths) }))
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));
}

function countsForFiles(files: readonly ReadinessFile[]): z.infer<typeof LaneCountsSchema> {
  return {
    observedFileCount: files.length,
    distinctContentCount: new Set(
      files.map((file) => `${file.sha256}:${String(file.sizeBytes)}`),
    ).size,
    factsEstablishedCount: files.filter(
      (file) => file.status === "facts_established",
    ).length,
    factsNotEstablishedCount: files.filter(
      (file) => file.status === "facts_not_established",
    ).length,
    outsideSourceFactsV2Count: files.filter(
      (file) => file.status === "outside_source_facts_v2",
    ).length,
    ambiguousFormatCount: files.filter(
      (file) => file.status === "ambiguous_format",
    ).length,
    unclassifiedFormatCount: files.filter(
      (file) => file.status === "unclassified_format",
    ).length,
  };
}

function buildLanes(
  files: readonly ReadinessFile[],
  state: "available" | "blocked",
): Lane[] {
  return LANE_DESCRIPTORS.map((descriptor) => {
    if (state === "blocked") {
      return {
        ...descriptor,
        status: "blocked" as const,
        reasonCode: "XGRIDS_XBIN_BLOCKED" as const,
        counts: countsForFiles([]),
        representedSources: [],
        unknowns: [],
        decisiveNextTests: [],
      };
    }
    const represented = files
      .filter((file) => file.laneIds.includes(descriptor.id))
      .sort((left, right) => compareCanonicalStrings(left.path, right.path));
    const status = laneStatus(represented);
    const unknowns = groupLaneUnknowns(represented);
    const tests = uniqueSorted([
      ...unknowns.map((unknown) => unknown.decisiveNextTest),
      ...represented.flatMap((file) => {
        const test = statusDecisiveTest(file.status);
        return test === null ? [] : [test];
      }),
      ...(represented.length === 0
        ? [GENERIC_GAP_DETAILS.NO_SOURCE_OBSERVED.decisiveNextTest]
        : []),
    ]);
    return {
      ...descriptor,
      status,
      reasonCode: reasonForLaneStatus(status),
      counts: countsForFiles(represented),
      representedSources: represented.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        status: file.status,
      })),
      unknowns,
      decisiveNextTests: tests,
    };
  });
}

function gapForStatus(
  code: keyof typeof GENERIC_GAP_DETAILS,
  files: readonly ReadinessFile[],
  lanes: readonly Lane[],
): Gap | null {
  const statusByCode: Partial<Record<keyof typeof GENERIC_GAP_DETAILS, FileStatus>> = {
    AMBIGUOUS_FORMAT: "ambiguous_format",
    OUTSIDE_SOURCE_FACTS_V2: "outside_source_facts_v2",
    SOURCE_FACTS_NOT_ESTABLISHED: "facts_not_established",
    UNCLASSIFIED_FORMAT: "unclassified_format",
  };
  const selected =
    code === "NO_SOURCE_OBSERVED"
      ? []
      : files.filter((file) => file.status === statusByCode[code]);
  const laneIds =
    code === "NO_SOURCE_OBSERVED"
      ? lanes
          .filter((lane) => lane.status === "no_source_observed")
          .map((lane) => lane.id)
      : canonicalLaneIds(selected.flatMap((file) => file.laneIds));
  if (
    (code === "NO_SOURCE_OBSERVED" && laneIds.length === 0) ||
    (code !== "NO_SOURCE_OBSERVED" && selected.length === 0)
  ) {
    return null;
  }
  return {
    code,
    ...GENERIC_GAP_DETAILS[code],
    laneIds,
    sourcePaths: uniqueSorted(selected.map((file) => file.path)),
  };
}

function buildGaps(files: readonly ReadinessFile[], lanes: readonly Lane[]): Gap[] {
  return (
    Object.keys(GENERIC_GAP_DETAILS) as Array<
      keyof typeof GENERIC_GAP_DETAILS
    >
  )
    .map((code) => gapForStatus(code, files, lanes))
    .filter((gap): gap is Gap => gap !== null)
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));
}

function summaryForAvailable(
  files: readonly ReadinessFile[],
  lanes: readonly Lane[],
  gaps: readonly Gap[],
): z.infer<typeof SummarySchema> {
  const counts = countsForFiles(files);
  return {
    receiptFileCount: files.length,
    representedFileCount: files.length,
    distinctContentCount: counts.distinctContentCount,
    factsEstablishedCount: counts.factsEstablishedCount,
    factsNotEstablishedCount: counts.factsNotEstablishedCount,
    outsideSourceFactsV2Count: counts.outsideSourceFactsV2Count,
    ambiguousFormatCount: counts.ambiguousFormatCount,
    unclassifiedFormatCount: counts.unclassifiedFormatCount,
    representedLaneCount: lanes.filter(
      (lane) => lane.counts.observedFileCount > 0,
    ).length,
    gapCount: new Set([
      ...gaps.map((gap) => gap.code),
      ...lanes.flatMap((lane) => lane.unknowns.map((unknown) => unknown.code)),
    ]).size,
    affectedSourceCount: 0,
  };
}

function summaryForBlocked(
  receiptFileCount: number,
  affectedSourceCount: number,
): z.infer<typeof SummarySchema> {
  return {
    receiptFileCount,
    representedFileCount: 0,
    distinctContentCount: 0,
    factsEstablishedCount: 0,
    factsNotEstablishedCount: 0,
    outsideSourceFactsV2Count: 0,
    ambiguousFormatCount: 0,
    unclassifiedFormatCount: 0,
    representedLaneCount: 0,
    gapCount: 0,
    affectedSourceCount,
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { readinessSha256: _readinessSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_SOURCE_READINESS_MAP_V2_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (
    JSON.stringify(value.lanes.map((lane) => lane.id)) !==
    JSON.stringify(FOUNDRY_SOURCE_READINESS_LANE_IDS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lanes"],
      message: "lanes must use the fixed canonical order",
    });
  }
  if (value.state === "available") {
    if (!isSortedUnique(value.files.map((file) => file.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "files must be unique and canonically ordered",
      });
    }
    for (const [index, file] of value.files.entries()) {
      const expectedDuplicate = expectedDuplicateForFile(value.files, file);
      if (JSON.stringify(file.duplicate) !== JSON.stringify(expectedDuplicate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "duplicate"],
          message: "file duplicate status contradicts the complete readiness file set",
        });
      }
    }
    let expectedLanes: Lane[];
    try {
      expectedLanes = buildLanes(value.files, "available");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lanes"],
        message: "file unknown facts contain contradictory definitions",
      });
      return;
    }
    const expectedGaps = buildGaps(value.files, expectedLanes);
    const expectedSummary = summaryForAvailable(
      value.files,
      expectedLanes,
      expectedGaps,
    );
    if (JSON.stringify(value.lanes) !== JSON.stringify(expectedLanes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lanes"],
        message: "lanes contradict the canonical aggregation of files",
      });
    }
    if (JSON.stringify(value.gaps) !== JSON.stringify(expectedGaps)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gaps"],
        message: "gaps contradict the canonical aggregation of files and lanes",
      });
    }
    if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "summary contradicts the canonical file aggregation",
      });
    }
  } else {
    const expectedLanes = buildLanes([], "blocked");
    const expectedSummary = summaryForBlocked(
      value.summary.receiptFileCount,
      value.blockedReason.affectedSources.length,
    );
    if (JSON.stringify(value.lanes) !== JSON.stringify(expectedLanes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lanes"],
        message: "blocked lanes must expose no partial references or evidence",
      });
    }
    if (!isSortedUnique(value.blockedReason.affectedSources.map((source) => source.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockedReason", "affectedSources"],
        message: "affected sources must be unique and canonically ordered",
      });
    }
    if (
      value.summary.receiptFileCount <
      value.blockedReason.affectedSources.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "receiptFileCount"],
        message: "blocked receipt count cannot be smaller than its affected-source count",
      });
    }
    if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "blocked summary contradicts affected sources",
      });
    }
  }
  if (value.readinessSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["readinessSha256"],
      message: "readiness digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: Omit<ArtifactWithoutValidation, "readinessSha256">,
): FoundrySourceReadinessMapV2 {
  const candidate = {
    ...payload,
    readinessSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  const issued = { ...payload, readinessSha256: artifactDigest(candidate) };
  return FoundrySourceReadinessMapV2Schema.parse(issued);
}

function hasCandidate(file: FoundryUniversalIntakeFile, inputType: FoundryInputType): boolean {
  return file.detection.candidates.some(
    (candidate) => candidate.inputType === inputType,
  );
}

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

interface ExpectedTarget {
  readonly inputType: "generic_e57" | "matterport_e57" | "glb_gltf" | "obj" | "sog" | "spz";
  readonly format: "e57" | "glb" | "gltf_json" | "obj" | "sog" | "spz";
}

function expectedTarget(file: FoundryUniversalIntakeFile): ExpectedTarget | null {
  const magic = file.inspection.magicHex;
  const e57Magic = magic.startsWith("4153544d2d453537");
  const glbMagic = magic.startsWith("676c5446");
  if (e57Magic) {
    return {
      inputType: hasCandidate(file, "matterport_e57")
        ? "matterport_e57"
        : "generic_e57",
      format: "e57",
    };
  }
  if (glbMagic) return { inputType: "glb_gltf", format: "glb" };
  if (hasCandidate(file, "spz") || extension(file.path) === ".spz") {
    return { inputType: "spz", format: "spz" };
  }
  if (hasCandidate(file, "sog") || extension(file.path) === ".sog") {
    return { inputType: "sog", format: "sog" };
  }
  if (
    hasCandidate(file, "generic_e57") ||
    hasCandidate(file, "matterport_e57") ||
    extension(file.path) === ".e57"
  ) {
    return {
      inputType: hasCandidate(file, "matterport_e57")
        ? "matterport_e57"
        : "generic_e57",
      format: "e57",
    };
  }
  if (hasCandidate(file, "glb_gltf")) {
    return {
      inputType: "glb_gltf",
      format: extension(file.path) === ".gltf" ? "gltf_json" : "glb",
    };
  }
  if (extension(file.path) === ".obj") {
    return { inputType: "obj", format: "obj" };
  }
  return null;
}

function assetIdentity(asset: UniversalSourceFactsV2Asset): {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
} {
  return asset.source;
}

function exactIdentityMatches(
  file: FoundryUniversalIntakeFile,
  identity: ReturnType<typeof assetIdentity>,
): boolean {
  return (
    file.path === identity.path &&
    file.sizeBytes === identity.sizeBytes &&
    file.sha256 === identity.sha256
  );
}

function assertAvailableSourceFactsCoverage(
  receipt: FoundryUniversalIntakeReceipt,
  sourceFacts: Extract<FoundryUniversalSourceFactsV2, { readonly state: "available" }>,
): Map<string, UniversalSourceFactsV2Asset> {
  const assetsByPath = new Map(
    sourceFacts.assets.map((asset) => [asset.source.path, asset] as const),
  );
  const expectedPaths: string[] = [];
  for (const file of receipt.files) {
    const target = expectedTarget(file);
    const asset = assetsByPath.get(file.path);
    if (target === null) {
      if (asset !== undefined) {
        throw new FoundryIntegrityError(
          "SOURCE_READINESS_UNEXPECTED_FACTS_TARGET",
          `Source Facts targets ${file.path}, which is outside its V2 target rules.`,
        );
      }
      continue;
    }
    expectedPaths.push(file.path);
    if (asset === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_FACTS_TARGET_MISSING",
        `Source Facts omits required target ${file.path}.`,
      );
    }
    if (!exactIdentityMatches(file, assetIdentity(asset))) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_SOURCE_IDENTITY_MISMATCH",
        `Source Facts identity does not match receipt file ${file.path}.`,
      );
    }
    if (
      asset.source.inputType !== target.inputType ||
      asset.format !== target.format
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_FACTS_TARGET_CONTRADICTION",
        `Source Facts target classification contradicts receipt evidence for ${file.path}.`,
      );
    }
  }
  const assetPaths = [...assetsByPath.keys()].sort(compareCanonicalStrings);
  expectedPaths.sort(compareCanonicalStrings);
  if (JSON.stringify(assetPaths) !== JSON.stringify(expectedPaths)) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_FACTS_TARGET_SET_MISMATCH",
      "Source Facts target paths do not exactly match the receipt-derived target set.",
    );
  }
  return assetsByPath;
}

function sortedUnknowns(asset: UniversalSourceFactsV2Asset): UnknownFact[] {
  return asset.unknowns
    .map((unknown) => UnknownFactSchema.parse(unknown))
    .sort((left, right) => compareCanonicalStrings(left.code, right.code));
}

function fileFromReceipt(
  file: FoundryUniversalIntakeFile,
  asset: UniversalSourceFactsV2Asset | undefined,
): ReadinessFile {
  if (asset !== undefined) {
    const unknowns = sortedUnknowns(asset);
    return ReadinessFileSchema.parse({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      duplicate: file.duplicate,
      detection: file.detection,
      status:
        asset.inspection.state === "established"
          ? "facts_established"
          : "facts_not_established",
      inputType: asset.source.inputType,
      format: asset.format,
      laneIds: canonicalLaneIds(INPUT_TYPE_LANES[asset.source.inputType]),
      inspection: asset.inspection,
      unknowns,
      decisiveNextTests: uniqueSorted(
        [
          ...unknowns.map((unknown) => unknown.decisiveNextTest),
          ...(asset.inspection.state === "facts_not_established"
            ? [GENERIC_GAP_DETAILS.SOURCE_FACTS_NOT_ESTABLISHED.decisiveNextTest]
            : []),
        ],
      ),
    });
  }
  const status: FileStatus =
    file.detection.status === "ambiguous"
      ? "ambiguous_format"
      : file.detection.status === "unknown"
        ? "unclassified_format"
        : "outside_source_facts_v2";
  return ReadinessFileSchema.parse({
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    duplicate: file.duplicate,
    detection: file.detection,
    status,
    inputType: null,
    format: null,
    laneIds: lanesForDetection(file.detection),
    inspection: null,
    unknowns: [],
    decisiveNextTests: [
      status === "ambiguous_format"
        ? GENERIC_GAP_DETAILS.AMBIGUOUS_FORMAT.decisiveNextTest
        : status === "unclassified_format"
          ? GENERIC_GAP_DETAILS.UNCLASSIFIED_FORMAT.decisiveNextTest
          : GENERIC_GAP_DETAILS.OUTSIDE_SOURCE_FACTS_V2.decisiveNextTest,
    ],
  });
}

function xbinReceiptSources(receipt: FoundryUniversalIntakeReceipt): Array<
  z.infer<typeof AffectedSourceSchema>
> {
  return receipt.files
    .filter((file) => hasCandidate(file, "xgrids_xbin"))
    .map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      inputType: "xgrids_xbin" as const,
    }))
    .sort((left, right) => compareCanonicalStrings(left.path, right.path));
}

function assertExactXbinBinding(
  expected: readonly z.infer<typeof AffectedSourceSchema>[],
  sourceFacts: Extract<FoundryUniversalSourceFactsV2, { readonly state: "unavailable" }>,
): void {
  const actual = sourceFacts.affectedSources.map((source) => ({
    path: source.path,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    inputType: source.inputType,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_XBIN_SOURCE_MISMATCH",
      "Source Facts XBIN sources do not exactly match the receipt XBIN candidates.",
    );
  }
}

export interface CompileFoundrySourceReadinessMapV2Input {
  readonly receipt: unknown;
  readonly sourceFacts: unknown;
}

/**
 * Compiles a deterministic pre-admission source-family map from only an exact
 * Universal Intake Receipt and its exact Universal Source Facts artifact.
 */
export function compileFoundrySourceReadinessMapV2(
  input: CompileFoundrySourceReadinessMapV2Input,
): FoundrySourceReadinessMapV2 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input.receipt);
  const sourceFacts = FoundryUniversalSourceFactsV2Schema.parse(input.sourceFacts);
  if (sourceFacts.receiptSha256 !== receipt.receiptSha256) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_RECEIPT_BINDING_MISMATCH",
      "Source Facts does not bind the supplied intake receipt.",
    );
  }
  if (sourceFacts.summary.receiptFileCount !== receipt.files.length) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_RECEIPT_COUNT_MISMATCH",
      "Source Facts receipt count does not match the supplied intake receipt.",
    );
  }

  const xbinSources = xbinReceiptSources(receipt);
  if (xbinSources.length > 0) {
    if (sourceFacts.state !== "unavailable") {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_XBIN_BLOCK_REQUIRED",
        "An XBIN receipt candidate requires the all-or-nothing Source Facts block.",
      );
    }
    assertExactXbinBinding(xbinSources, sourceFacts);
    return issueArtifact({
      schemaVersion: FOUNDRY_SOURCE_READINESS_MAP_V2,
      meaning: FOUNDRY_SOURCE_READINESS_MAP_MEANING,
      basis: FOUNDRY_SOURCE_READINESS_MAP_BASIS,
      disclaimer: FOUNDRY_SOURCE_READINESS_MAP_DISCLAIMER,
      receiptSha256: receipt.receiptSha256,
      sourceFactsSha256: sourceFacts.factsSha256,
      state: "blocked",
      policy: POLICY,
      limitations: [
        FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[0],
        FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[1],
        FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[2],
        FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[3],
      ],
      summary: summaryForBlocked(receipt.files.length, xbinSources.length),
      files: [],
      lanes: buildLanes([], "blocked"),
      gaps: [],
      blockedReason: {
        code: "XGRIDS_XBIN_BLOCKED",
        message:
          "The source set includes an XGRIDS XBIN candidate, so Source Readiness Map V2 exposes no partial file or lane evidence.",
        nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
        affectedSources: xbinSources,
      },
    });
  }
  if (sourceFacts.state !== "available") {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_UNEXPECTED_FACTS_BLOCK",
      "Source Facts is unavailable without a matching XBIN receipt candidate.",
    );
  }

  const assetsByPath = assertAvailableSourceFactsCoverage(receipt, sourceFacts);
  const files = receipt.files.map((file) =>
    fileFromReceipt(file, assetsByPath.get(file.path)),
  );
  const lanes = buildLanes(files, "available");
  const gaps = buildGaps(files, lanes);
  return issueArtifact({
    schemaVersion: FOUNDRY_SOURCE_READINESS_MAP_V2,
    meaning: FOUNDRY_SOURCE_READINESS_MAP_MEANING,
    basis: FOUNDRY_SOURCE_READINESS_MAP_BASIS,
    disclaimer: FOUNDRY_SOURCE_READINESS_MAP_DISCLAIMER,
    receiptSha256: receipt.receiptSha256,
    sourceFactsSha256: sourceFacts.factsSha256,
    state: "available",
    policy: POLICY,
    limitations: [
      FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[0],
      FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[1],
      FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[2],
      FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS[3],
    ],
    summary: summaryForAvailable(files, lanes, gaps),
    files,
    lanes,
    gaps,
    blockedReason: null,
  });
}

export function serializeFoundrySourceReadinessMapV2(
  value: FoundrySourceReadinessMapV2,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundrySourceReadinessMapV2Schema.parse(value)),
  );
}
