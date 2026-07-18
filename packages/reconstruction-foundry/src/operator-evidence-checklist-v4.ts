import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
} from "./source-facts.js";
import { FOUNDRY_GAUSSIAN_PLY_UNKNOWNS } from "./source-facts-v3.js";
import { FOUNDRY_MEDIA_CONTAINER_UNKNOWNS } from "./source-facts-v4.js";
import {
  FOUNDRY_SOURCE_READINESS_LANE_IDS,
  FoundrySourceReadinessLaneIdSchema,
  FoundrySourceReadinessMapV4Schema,
  type FoundrySourceReadinessLaneId,
  type FoundrySourceReadinessMapV4,
} from "./source-readiness-v4.js";

export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4 =
  "omnitwin.foundry.operator-evidence-checklist.v4";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_MEANING =
  "pre_admission_operator_evidence_action_plan";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_BASIS =
  "exact_source_readiness_map";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DISCLAIMER =
  "This checklist orders evidence requests by their relationship to the current Source Readiness gaps only; it does not decide which requests are necessary for a desired output, perform any request, approve a file, establish rights, accuracy, or registration, compile a route or recipe, select a worker or provider, or authorize work.";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS = [
  "DESIRED_OUTPUT_PROFILE_NOT_BOUND",
  "EVIDENCE_PRIORITY_IS_NOT_BUSINESS_PRIORITY",
  "REQUESTS_ARE_NOT_PERFORMED_OR_TRACKED",
  "COMPLETION_EVIDENCE_IS_NOT_EVALUATED",
  "NO_SOURCE_OBSERVED_IS_CONDITIONAL",
  "FILESYSTEM_CHANGES_AFTER_RECEIPT_ARE_NOT_DETECTED",
  "DUPLICATE_CONTENT_IS_NOT_INDEPENDENT_EVIDENCE",
] as const;

export const FOUNDRY_OPERATOR_EVIDENCE_CATEGORIES = [
  "official_export",
  "source_acquisition",
  "format_identification",
  "bounded_inspection",
  "source_provenance",
  "registration_input",
  "independent_control",
  "rights_decision",
  "appearance_reference",
] as const;
export const FoundryOperatorEvidenceCategorySchema = z.enum(
  FOUNDRY_OPERATOR_EVIDENCE_CATEGORIES,
);
export type FoundryOperatorEvidenceCategory = z.infer<
  typeof FoundryOperatorEvidenceCategorySchema
>;

export const FOUNDRY_OPERATOR_EVIDENCE_PRIORITIES = [
  "blocking",
  "high",
  "normal",
  "conditional",
] as const;
export const FoundryOperatorEvidencePrioritySchema = z.enum(
  FOUNDRY_OPERATOR_EVIDENCE_PRIORITIES,
);
export type FoundryOperatorEvidencePriority = z.infer<
  typeof FoundryOperatorEvidencePrioritySchema
>;

export const FOUNDRY_OPERATOR_EVIDENCE_COMPLETION_KINDS = [
  "official_export_receipt",
  "source_scope_decision_record",
  "format_identification_record",
  "bounded_inspection_report",
  "source_provenance_record",
  "registration_input_record",
  "independent_control_report",
  "rights_decision_record",
  "appearance_comparison_report",
] as const;
const CompletionEvidenceKindSchema = z.enum(
  FOUNDRY_OPERATOR_EVIDENCE_COMPLETION_KINDS,
);

export const FOUNDRY_OPERATOR_EVIDENCE_GAP_CODES = Object.freeze([
  "AMBIGUOUS_FORMAT",
  "NO_SOURCE_OBSERVED",
  "OUTSIDE_SOURCE_FACTS_V4",
  "SOURCE_FACTS_NOT_ESTABLISHED",
  "UNCLASSIFIED_FORMAT",
] as const);
export const FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES = Object.freeze([
  "E57_ACCURACY_UNKNOWN",
  "E57_BOUNDS_UNKNOWN",
  "E57_CRS_UNKNOWN",
  "E57_IMAGE_COUNT_UNKNOWN",
  "E57_POINT_COUNT_UNKNOWN",
  "E57_REGISTRATION_UNKNOWN",
  "E57_RIGHTS_UNKNOWN",
  "E57_SCAN_COUNT_UNKNOWN",
  "E57_UNITS_UNKNOWN",
  "GAUSSIAN_PLY_ACCURACY_UNKNOWN",
  "GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN",
  "GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN",
  "GAUSSIAN_PLY_FRAME_UNKNOWN",
  "GAUSSIAN_PLY_PHYSICAL_BOUNDS_UNKNOWN",
  "GAUSSIAN_PLY_PROVENANCE_UNKNOWN",
  "GAUSSIAN_PLY_REGISTRATION_UNKNOWN",
  "GAUSSIAN_PLY_RENDERER_COMPATIBILITY_UNKNOWN",
  "GAUSSIAN_PLY_RIGHTS_UNKNOWN",
  "GAUSSIAN_PLY_UNITS_UNKNOWN",
  "GAUSSIAN_PLY_VISUAL_FIDELITY_UNKNOWN",
  "GLB_ACCURACY_UNKNOWN",
  "GLB_APPEARANCE_FIDELITY_UNKNOWN",
  "GLB_DECODED_GEOMETRY_UNKNOWN",
  "GLB_FRAME_UNKNOWN",
  "GLB_REMAINING_CHUNKS_UNKNOWN",
  "GLB_RIGHTS_UNKNOWN",
  "GLB_UNITS_UNKNOWN",
  "MEDIA_CAMERA_CALIBRATION_UNKNOWN",
  "MEDIA_CAPTURE_DEVICE_UNKNOWN",
  "MEDIA_CAPTURE_ROLE_UNKNOWN",
  "MEDIA_CAPTURE_TIME_UNKNOWN",
  "MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN",
  "MEDIA_PROJECTION_UNKNOWN",
  "MEDIA_PROVENANCE_CLASS_UNKNOWN",
  "MEDIA_RIGHTS_UNKNOWN",
  "MEDIA_SEQUENCE_RELATIONSHIP_UNKNOWN",
  "MEDIA_VISUAL_FIDELITY_UNKNOWN",
  "OBJ_ACCURACY_UNKNOWN",
  "OBJ_FRAME_UNKNOWN",
  "OBJ_MATERIAL_COMPLETENESS_UNKNOWN",
  "OBJ_RIGHTS_UNKNOWN",
  "OBJ_TOPOLOGY_UNKNOWN",
  "OBJ_TRIANGULATION_UNKNOWN",
  "OBJ_UNITS_UNKNOWN",
  "OBJ_UP_AXIS_UNKNOWN",
  "SOG_ACCURACY_UNKNOWN",
  "SOG_ATTRIBUTE_VALUES_UNKNOWN",
  "SOG_FRAME_UNKNOWN",
  "SOG_PHYSICAL_BOUNDS_UNKNOWN",
  "SOG_PROVENANCE_UNKNOWN",
  "SOG_REGISTRATION_UNKNOWN",
  "SOG_RENDERER_COMPATIBILITY_UNKNOWN",
  "SOG_RIGHTS_UNKNOWN",
  "SOG_UNITS_UNKNOWN",
  "SOG_VISUAL_FIDELITY_UNKNOWN",
  "SPZ_ACCURACY_UNKNOWN",
  "SPZ_ATTRIBUTE_VALUES_UNKNOWN",
  "SPZ_FRAME_UNKNOWN",
  "SPZ_PHYSICAL_BOUNDS_UNKNOWN",
  "SPZ_PROVENANCE_UNKNOWN",
  "SPZ_REGISTRATION_UNKNOWN",
  "SPZ_RENDERER_COMPATIBILITY_UNKNOWN",
  "SPZ_RIGHTS_UNKNOWN",
  "SPZ_UNITS_UNKNOWN",
  "SPZ_VISUAL_FIDELITY_UNKNOWN",
] as const);

const EVIDENCE_CODES = [
  ...FOUNDRY_OPERATOR_EVIDENCE_GAP_CODES,
  ...FOUNDRY_OPERATOR_EVIDENCE_UNKNOWN_CODES,
] as const;
const EvidenceCodeSchema = z.enum(EVIDENCE_CODES);
type EvidenceCode = z.infer<typeof EvidenceCodeSchema>;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const CHECKLIST_ITEM_ID = /^(?:[a-z_]+):[A-Z][A-Z0-9_]{2,95}$/u;

interface CompletionDefinition {
  readonly kind: z.infer<typeof CompletionEvidenceKindSchema>;
  readonly criteria: readonly string[];
  readonly limits: string;
}

const COMPLETION_DEFINITIONS: Readonly<
  Record<FoundryOperatorEvidenceCategory, CompletionDefinition>
> = {
  official_export: {
    kind: "official_export_receipt",
    criteria: [
      "An official documented export produces E57, binary GLB, or OBJ without decoding or reverse-engineering the XBIN payload.",
      "A new intake receipt records every exported relative path, byte size, and exact SHA-256.",
      "A new Source Facts and Source Readiness chain binds the exact exported receipt.",
    ],
    limits:
      "An official export would establish an inspectable replacement source only; it would not establish accuracy, registration, rights, admission, or permission to run.",
  },
  source_acquisition: {
    kind: "source_scope_decision_record",
    criteria: [
      "A desired-output scope decision identifies which, if any, listed source-family lanes are applicable and records every not-needed or non-applicable lane explicitly.",
      "For each selected lane, a new exact intake receipt represents that lane; selecting no lane is a valid outcome.",
      "Any new Source Facts and Source Readiness artifacts bind the resulting receipt and keep unresolved facts explicit.",
    ],
    limits:
      "This conditional request does not require acquisition. Adding a selected source would only make that family observable; its quality, rights, registration, admission, and processing suitability would remain unevaluated.",
  },
  format_identification: {
    kind: "format_identification_record",
    criteria: [
      "A bounded format-aware record names every affected relative path and exact SHA-256.",
      "The record documents the method, execution, and result of the item's exact requested-evidence test, including format-aware inspection and operator-confirmed or authoritative source context as requested.",
      "The record states one evidence-backed detection; an unresolved result is valid only after the exact requested-evidence test was attempted and its limitation recorded.",
      "A rebuilt intake receipt reflects the result without selecting a processing route.",
    ],
    limits:
      "Format identification would establish a candidate type only; it would not establish accuracy, registration, rights, completeness, admission, or processing readiness.",
  },
  bounded_inspection: {
    kind: "bounded_inspection_report",
    criteria: [
      "A bounded read-only inspector report names every affected relative path and exact SHA-256.",
      "The report documents the method, execution, and result of the item's exact requested-evidence test, including its inspector scope and fixed byte, record, chunk, or topology limits.",
      "The report records established facts, unresolved facts, and any failure code; an unresolved result is valid only after the exact requested-evidence test was attempted.",
      "Canonical Source Facts and Source Readiness artifacts are rebuilt if their reviewed format coverage can represent the result.",
    ],
    limits:
      "A bounded inspection could establish only its reported format facts for the exact digest; it would not establish accuracy, rights, registration, admission, or permission to run.",
  },
  source_provenance: {
    kind: "source_provenance_record",
    criteria: [
      "An authoritative source-context record names every affected relative path and exact SHA-256.",
      "The record documents the method, execution, and result of the item's exact requested-evidence test, including every requested metadata inspection, provenance corroboration, or known-dimension verification.",
      "The record states the requested units, axis convention, exporter convention, or other provenance field and identifies its documentary source.",
      "An unresolved result is valid only after the exact requested-evidence test was attempted and its limitation was recorded explicitly.",
    ],
    limits:
      "A provenance record could establish only its stated source convention or context; it would not by itself establish physical accuracy, registration quality, rights, admission, or processing readiness.",
  },
  registration_input: {
    kind: "registration_input_record",
    criteria: [
      "A reviewed registration-input record names every affected relative path and exact SHA-256 and directly answers the checklist item's requested-evidence test.",
      "As applicable, the record states coordinate frames, transform direction and convention, units and control origin; camera intrinsics and distortion; projection model; and sequence timestamps, ordering, overlap, or synchronization.",
      "Any field not supplied by that exact record remains unresolved, and accuracy or registration quality remains unresolved unless a separate residual evaluation against independent control is supplied.",
    ],
    limits:
      "A registration-input record supplies only its declared spatial, camera, projection, or sequence context; it would not prove transform correctness, accuracy, rights, admission, or permission to run.",
  },
  independent_control: {
    kind: "independent_control_report",
    criteria: [
      "A frozen report names every affected source SHA-256 and records why the control is independent of those sources.",
      "The report records method, units, fit and blind samples, residuals, exclusions, and threshold provenance.",
      "The report states the observed result without extending it beyond the frozen sample and declared comparison scope.",
    ],
    limits:
      "An independent-control comparison could establish only its declared residual or accuracy result for the frozen scope; it would not establish rights, complete venue identity, admission, or permission to run.",
  },
  rights_decision: {
    kind: "rights_decision_record",
    criteria: [
      "A written authorized decision names every affected relative path and exact SHA-256.",
      "The decision states its exact purpose scope, including commercial use, model training, derivative output, and redistribution as applicable.",
      "Permitted, prohibited, conditional, and unresolved uses are recorded separately rather than inferred from a software licence.",
    ],
    limits:
      "This checklist would only record that a purpose-scoped rights decision is needed; it does not evaluate or apply such a decision and would still not establish physical accuracy, registration, quality, admission, or permission to run.",
  },
  appearance_reference: {
    kind: "appearance_comparison_report",
    criteria: [
      "A review report names every affected source SHA-256 and every rights-cleared reference observation.",
      "The report freezes viewpoints, renderer or viewer settings, crop and exposure treatment, and acceptance criteria.",
      "Observed differences and indeterminate regions are recorded without converting visual agreement into metric authority.",
    ],
    limits:
      "An appearance comparison could establish only the reviewed views under its frozen protocol; it would not establish metric accuracy, completeness, rights, admission, or permission to run.",
  },
};

interface RequestDefinition {
  readonly basisKind: "gap" | "unknown";
  readonly category: FoundryOperatorEvidenceCategory;
  readonly priority: Exclude<FoundryOperatorEvidencePriority, "blocking">;
  readonly label: string;
  readonly reason: string;
  readonly requestedEvidence: string;
}

function requestDefinition(
  basisKind: RequestDefinition["basisKind"],
  category: RequestDefinition["category"],
  priority: RequestDefinition["priority"],
  label: string,
  reason: string,
  requestedEvidence: string,
): RequestDefinition {
  return { basisKind, category, priority, label, reason, requestedEvidence };
}

type GaussianPlyEvidenceCode = Extract<
  EvidenceCode,
  `GAUSSIAN_PLY_${string}`
>;

function gaussianPlyRequestDefinition(
  code: GaussianPlyEvidenceCode,
  category: FoundryOperatorEvidenceCategory,
): RequestDefinition {
  const unknown = FOUNDRY_GAUSSIAN_PLY_UNKNOWNS.find(
    (candidate) => candidate.code === code,
  );
  if (unknown === undefined) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_GAUSSIAN_PLY_DEFINITION_MISSING",
      `Source Facts V4 does not export the frozen unknown definition ${code}.`,
    );
  }
  return requestDefinition(
    "unknown",
    category,
    "normal",
    unknown.label,
    unknown.reason,
    unknown.decisiveNextTest,
  );
}

type MediaEvidenceCode = Extract<EvidenceCode, `MEDIA_${string}`>;

function mediaRequestDefinition(
  code: MediaEvidenceCode,
  category: FoundryOperatorEvidenceCategory,
): RequestDefinition {
  const unknown = FOUNDRY_MEDIA_CONTAINER_UNKNOWNS.find(
    (candidate) => candidate.code === code,
  );
  if (unknown === undefined) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_MEDIA_DEFINITION_MISSING",
      `Source Facts V4 does not export the frozen media unknown definition ${code}.`,
    );
  }
  return requestDefinition(
    "unknown",
    category,
    "normal",
    unknown.label,
    unknown.reason,
    unknown.decisiveNextTest,
  );
}

const REQUEST_DEFINITIONS = {
  AMBIGUOUS_FORMAT: requestDefinition(
    "gap",
    "format_identification",
    "high",
    "Ambiguous format",
    "The receipt preserves more than one candidate interpretation and this map does not select a winner.",
    "Use a bounded format-aware inspection and operator-confirmed source context against this exact receipted content.",
  ),
  NO_SOURCE_OBSERVED: requestDefinition(
    "gap",
    "source_acquisition",
    "conditional",
    "No source observed",
    "No receipted source is represented in one or more source-family lanes.",
    "First bind a desired-output scope, then record each named family as selected or not needed; only selected families require a new source and rebuilt intake receipt and Source Facts artifact.",
  ),
  OUTSIDE_SOURCE_FACTS_V4: requestDefinition(
    "gap",
    "bounded_inspection",
    "high",
    "Outside Source Facts V4",
    "The receipt has candidate source families, but Source Facts V4 does not inspect this file format.",
    "Add a bounded facts inspector for this exact format and rebuild Source Facts without selecting a processing route.",
  ),
  SOURCE_FACTS_NOT_ESTABLISHED: requestDefinition(
    "gap",
    "bounded_inspection",
    "high",
    "Source facts not established",
    "Source Facts V4 targeted the file but did not establish its bounded format facts.",
    "Resolve the recorded inspection failure or limit against this exact content digest, then rebuild Source Facts.",
  ),
  UNCLASSIFIED_FORMAT: requestDefinition(
    "gap",
    "format_identification",
    "high",
    "Unclassified format",
    "The receipt establishes no candidate source family for this file.",
    "Identify the format from authoritative source context or obtain a documented official export, then rebuild the intake receipt.",
  ),
  E57_ACCURACY_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Measurement accuracy",
    "Container metadata cannot establish physical measurement accuracy.",
    "Compare the reconstruction with independent survey control and frozen blind checks.",
  ),
  E57_BOUNDS_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Spatial bounds",
    "Point payloads were not read.",
    "Run a bounded, read-only point-statistics pass against the same source digest.",
  ),
  E57_CRS_UNKNOWN: requestDefinition(
    "unknown",
    "registration_input",
    "normal",
    "Coordinate reference system",
    "No CRS claim is made from the physical header.",
    "Obtain authoritative CRS metadata or a survey-control record bound to this source.",
  ),
  E57_IMAGE_COUNT_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Image count",
    "The fixed physical header does not contain image2D counts.",
    "Inspect the E57 images2D metadata tree without extracting imagery.",
  ),
  E57_POINT_COUNT_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Point count",
    "The fixed physical header does not contain point-record counts.",
    "Inspect the E57 data3D metadata tree without reading point payloads.",
  ),
  E57_REGISTRATION_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Registration quality",
    "The physical header cannot establish alignment or registration quality.",
    "Evaluate residuals against independent control with a documented registration method.",
  ),
  E57_RIGHTS_UNKNOWN: requestDefinition(
    "unknown",
    "rights_decision",
    "normal",
    "Usage rights",
    "Byte and metadata inspection do not evaluate ownership, training, or redistribution rights.",
    "Obtain an authorized rights decision bound to this exact SHA-256.",
  ),
  E57_SCAN_COUNT_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Scan count",
    "The fixed physical header does not contain the scan count.",
    "Run a format-aware E57 metadata-tree inspection against the same SHA-256-bound file.",
  ),
  E57_UNITS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Units",
    "No unit claim is made from the physical header.",
    "Inspect documented E57 coordinate metadata and corroborate it with capture provenance.",
  ),
  GAUSSIAN_PLY_ACCURACY_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_ACCURACY_UNKNOWN",
    "independent_control",
  ),
  GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN",
    "bounded_inspection",
  ),
  GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN",
    "format_identification",
  ),
  GAUSSIAN_PLY_FRAME_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_FRAME_UNKNOWN",
    "registration_input",
  ),
  GAUSSIAN_PLY_PHYSICAL_BOUNDS_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_PHYSICAL_BOUNDS_UNKNOWN",
    "bounded_inspection",
  ),
  GAUSSIAN_PLY_PROVENANCE_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_PROVENANCE_UNKNOWN",
    "source_provenance",
  ),
  GAUSSIAN_PLY_REGISTRATION_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_REGISTRATION_UNKNOWN",
    "independent_control",
  ),
  GAUSSIAN_PLY_RENDERER_COMPATIBILITY_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_RENDERER_COMPATIBILITY_UNKNOWN",
    "bounded_inspection",
  ),
  GAUSSIAN_PLY_RIGHTS_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_RIGHTS_UNKNOWN",
    "rights_decision",
  ),
  GAUSSIAN_PLY_UNITS_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_UNITS_UNKNOWN",
    "source_provenance",
  ),
  GAUSSIAN_PLY_VISUAL_FIDELITY_UNKNOWN: gaussianPlyRequestDefinition(
    "GAUSSIAN_PLY_VISUAL_FIDELITY_UNKNOWN",
    "appearance_reference",
  ),
  MEDIA_CAMERA_CALIBRATION_UNKNOWN: mediaRequestDefinition(
    "MEDIA_CAMERA_CALIBRATION_UNKNOWN",
    "registration_input",
  ),
  MEDIA_CAPTURE_DEVICE_UNKNOWN: mediaRequestDefinition(
    "MEDIA_CAPTURE_DEVICE_UNKNOWN",
    "source_provenance",
  ),
  MEDIA_CAPTURE_ROLE_UNKNOWN: mediaRequestDefinition(
    "MEDIA_CAPTURE_ROLE_UNKNOWN",
    "source_provenance",
  ),
  MEDIA_CAPTURE_TIME_UNKNOWN: mediaRequestDefinition(
    "MEDIA_CAPTURE_TIME_UNKNOWN",
    "source_provenance",
  ),
  MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN: mediaRequestDefinition(
    "MEDIA_PIXEL_OR_SAMPLE_DECODE_UNKNOWN",
    "bounded_inspection",
  ),
  MEDIA_PROJECTION_UNKNOWN: mediaRequestDefinition(
    "MEDIA_PROJECTION_UNKNOWN",
    "registration_input",
  ),
  MEDIA_PROVENANCE_CLASS_UNKNOWN: mediaRequestDefinition(
    "MEDIA_PROVENANCE_CLASS_UNKNOWN",
    "source_provenance",
  ),
  MEDIA_RIGHTS_UNKNOWN: mediaRequestDefinition(
    "MEDIA_RIGHTS_UNKNOWN",
    "rights_decision",
  ),
  MEDIA_SEQUENCE_RELATIONSHIP_UNKNOWN: mediaRequestDefinition(
    "MEDIA_SEQUENCE_RELATIONSHIP_UNKNOWN",
    "registration_input",
  ),
  MEDIA_VISUAL_FIDELITY_UNKNOWN: mediaRequestDefinition(
    "MEDIA_VISUAL_FIDELITY_UNKNOWN",
    "appearance_reference",
  ),
  GLB_ACCURACY_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Physical accuracy",
    "Declared mesh structure does not establish reconstruction accuracy.",
    "Compare geometry against independent survey control and frozen blind checks.",
  ),
  GLB_APPEARANCE_FIDELITY_UNKNOWN: requestDefinition(
    "unknown",
    "appearance_reference",
    "normal",
    "Appearance fidelity",
    "JSON declarations do not establish visual fidelity to the captured venue.",
    "Perform a source-image comparison using rights-cleared reference imagery.",
  ),
  GLB_DECODED_GEOMETRY_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Decoded geometry",
    "V1 reads the container header and bounded JSON declarations but does not decode BIN chunks, accessors, indices, or positions.",
    "Run a separately reviewed bounded accessor decoder against this exact source digest.",
  ),
  GLB_FRAME_UNKNOWN: requestDefinition(
    "unknown",
    "registration_input",
    "normal",
    "Coordinate frame",
    "Container and JSON declarations do not establish the venue coordinate frame.",
    "Bind the asset to an authoritative frame transform and control network.",
  ),
  GLB_REMAINING_CHUNKS_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Remaining chunk structure",
    "V1 does not interpret chunks after the first JSON chunk.",
    "Inspect the complete GLB chunk table with fixed chunk-count and byte limits.",
  ),
  GLB_RIGHTS_UNKNOWN: requestDefinition(
    "unknown",
    "rights_decision",
    "normal",
    "Usage rights",
    "Byte inspection does not evaluate ownership, training, or redistribution rights.",
    "Obtain an authorized rights decision bound to this exact SHA-256.",
  ),
  GLB_UNITS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Physical units",
    "glTF does not require a source-specific physical-unit attestation.",
    "Obtain source provenance that declares units and verify a known dimension.",
  ),
  OBJ_ACCURACY_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Physical accuracy",
    "Syntactic geometry facts do not establish reconstruction accuracy.",
    "Compare geometry against independent survey control and frozen blind checks.",
  ),
  OBJ_FRAME_UNKNOWN: requestDefinition(
    "unknown",
    "registration_input",
    "normal",
    "Coordinate frame",
    "Vertex coordinates alone do not identify a venue frame.",
    "Bind the source to an authoritative coordinate-frame record.",
  ),
  OBJ_MATERIAL_COMPLETENESS_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Material completeness",
    "Material libraries were declared but never opened.",
    "Inspect separately receipted MTL and texture assets without resolving external paths implicitly.",
  ),
  OBJ_RIGHTS_UNKNOWN: requestDefinition(
    "unknown",
    "rights_decision",
    "normal",
    "Usage rights",
    "Byte inspection does not evaluate ownership, training, or redistribution rights.",
    "Obtain an authorized rights decision bound to this exact SHA-256.",
  ),
  OBJ_TOPOLOGY_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Topology quality",
    "Syntactic face checks do not establish manifoldness, winding, or self-intersection quality.",
    "Run a bounded geometry-topology validator against this exact source digest.",
  ),
  OBJ_TRIANGULATION_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Triangulation semantics",
    "The fan-triangle equivalent is a syntactic comparison only; V1 does not choose or prove a triangulation.",
    "Run the intended importer and compare its exact triangle topology against this digest-bound source.",
  ),
  OBJ_UNITS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Physical units",
    "Wavefront OBJ does not require a unit declaration.",
    "Obtain source provenance and verify a known physical dimension.",
  ),
  OBJ_UP_AXIS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Up axis",
    "Wavefront OBJ does not require an up-axis declaration.",
    "Obtain the exporter convention or an authoritative frame transform.",
  ),
  SOG_ACCURACY_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Physical accuracy",
    "A structurally valid SOG container does not establish metric accuracy.",
    "Compare decoded positions with independent survey control and frozen blind checks.",
  ),
  SOG_ATTRIBUTE_VALUES_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Decoded Gaussian attributes",
    "V1 validates the stored ZIP, meta.json, member CRCs, and complete WebP RIFF structures but does not decode pixels into Gaussian attribute values.",
    "Run a separately reviewed bounded SOG v2 attribute decoder against this exact source digest and record byte, point, finite-value, and cancellation limits.",
  ),
  SOG_FRAME_UNKNOWN: requestDefinition(
    "unknown",
    "registration_input",
    "normal",
    "Coordinate frame",
    "Container structure and encoded means ranges do not identify the venue coordinate frame or a transform into it.",
    "Bind this exact source digest to an authoritative frame transform and control record.",
  ),
  SOG_PHYSICAL_BOUNDS_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Physical spatial bounds",
    "The encoded means minima and maxima are reported only as format parameters and are not asserted as venue-space physical bounds.",
    "Decode positions under a documented SOG convention, bind authoritative units and frame, and compute bounds against this exact source digest.",
  ),
  SOG_PROVENANCE_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Source provenance",
    "Byte inspection does not establish the capture, training, conversion, or export lineage of the SOG asset.",
    "Obtain an authoritative lineage record bound to this exact SHA-256, including capture source and every material conversion step.",
  ),
  SOG_REGISTRATION_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Registration quality",
    "The container does not establish alignment quality or residuals in the venue frame.",
    "Evaluate digest-bound decoded positions against independent control with a documented registration method and residual protocol.",
  ),
  SOG_RENDERER_COMPATIBILITY_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Renderer compatibility",
    "Complete stored members and RIFF structures do not prove that a particular renderer decodes and presents the Gaussian attributes correctly.",
    "Run a pinned offline compatibility probe against this exact digest and record loader version, limits, result, and any unsupported feature.",
  ),
  SOG_RIGHTS_UNKNOWN: requestDefinition(
    "unknown",
    "rights_decision",
    "normal",
    "Usage rights",
    "Byte inspection does not evaluate ownership, model-training, derivative-output, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256.",
  ),
  SOG_UNITS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Physical units",
    "SOG v2 container metadata does not establish an authoritative physical-unit attestation for this venue source.",
    "Obtain authoritative source provenance that declares units and verify a known physical dimension.",
  ),
  SOG_VISUAL_FIDELITY_UNKNOWN: requestDefinition(
    "unknown",
    "appearance_reference",
    "normal",
    "Appearance fidelity",
    "Structural and declaration facts do not establish visual fidelity to the captured venue.",
    "Compare frozen views in a pinned offline renderer with rights-cleared reference observations and record indeterminate regions.",
  ),
  SPZ_ACCURACY_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Physical accuracy",
    "This inspection does not establish metric accuracy.",
    "Compare decoded positions with independent survey control and frozen blind checks.",
  ),
  SPZ_ATTRIBUTE_VALUES_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Decoded Gaussian attributes",
    "This inspection does not establish decoded Gaussian attribute values; structural success establishes only the header, declared layout, and complete compression ranges.",
    "Run a separately reviewed bounded SPZ attribute decoder against this exact source digest and record value, finite-number, byte, point, and cancellation limits.",
  ),
  SPZ_FRAME_UNKNOWN: requestDefinition(
    "unknown",
    "registration_input",
    "normal",
    "Coordinate frame",
    "This inspection does not establish the actual venue frame or a transform into it; nominal SPZ conventions and extension presence are insufficient.",
    "Bind this exact source digest to an authoritative frame transform and control record.",
  ),
  SPZ_PHYSICAL_BOUNDS_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Physical spatial bounds",
    "This inspection does not establish venue-space physical bounds; structural success traverses packed position bytes for compression integrity without decoding them.",
    "Decode positions under a documented SPZ convention, bind authoritative units and frame, and compute bounds against this exact source digest.",
  ),
  SPZ_PROVENANCE_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Source provenance",
    "This inspection does not establish the capture, training, conversion, or export lineage of the source.",
    "Obtain an authoritative lineage record bound to this exact SHA-256, including capture source and every material conversion step.",
  ),
  SPZ_REGISTRATION_UNKNOWN: requestDefinition(
    "unknown",
    "independent_control",
    "normal",
    "Registration quality",
    "This inspection does not establish alignment quality or residuals in the venue frame.",
    "Evaluate digest-bound decoded positions against independent control with a documented registration method and residual protocol.",
  ),
  SPZ_RENDERER_COMPATIBILITY_UNKNOWN: requestDefinition(
    "unknown",
    "bounded_inspection",
    "normal",
    "Renderer compatibility",
    "This inspection does not establish that a particular renderer supports or presents the source's exact version, SH degree, extensions, and semantics.",
    "Run a pinned offline compatibility probe against this exact digest and record loader version, limits, result, and every unsupported feature.",
  ),
  SPZ_RIGHTS_UNKNOWN: requestDefinition(
    "unknown",
    "rights_decision",
    "normal",
    "Usage rights",
    "This inspection does not evaluate ownership, model-training, derivative-output, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256.",
  ),
  SPZ_UNITS_UNKNOWN: requestDefinition(
    "unknown",
    "source_provenance",
    "normal",
    "Physical units",
    "This inspection does not establish authoritative physical units; supported SPZ structures contain no venue-specific unit attestation.",
    "Obtain authoritative source provenance that declares units and verify a known physical dimension.",
  ),
  SPZ_VISUAL_FIDELITY_UNKNOWN: requestDefinition(
    "unknown",
    "appearance_reference",
    "normal",
    "Appearance fidelity",
    "This inspection does not establish visual fidelity to the captured venue.",
    "Compare frozen views in a pinned offline renderer with rights-cleared reference observations and record indeterminate regions.",
  ),
} as const satisfies Readonly<Record<EvidenceCode, RequestDefinition>>;

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
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/u),
    coverage: z.enum([
      "none",
      "physical_header",
      "container_header",
      "container_header_and_json",
      "complete_container_structure",
      "complete_stream",
    ]),
  })
  .strict();

const DuplicateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unique"), groupSha256: z.null() }).strict(),
  z
    .object({
      status: z.literal("exact_content_duplicate"),
      groupSha256: z.string().regex(SHA256_HEX),
    })
    .strict(),
]);

const AffectedSourceSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
    duplicate: DuplicateSchema,
    laneIds: z
      .array(FoundrySourceReadinessLaneIdSchema)
      .min(1)
      .max(FOUNDRY_SOURCE_READINESS_LANE_IDS.length),
    readinessStatus: z.enum([
      "facts_established",
      "facts_not_established",
      "outside_source_facts_v4",
      "ambiguous_format",
      "unclassified_format",
    ]),
    inspection: InspectionSchema.nullable(),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (
      JSON.stringify(source.laneIds) !==
      JSON.stringify(canonicalLaneIds(source.laneIds))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "affected-source lane identifiers must be unique and canonically ordered",
      });
    }
    const hasFacts =
      source.readinessStatus === "facts_established" ||
      source.readinessStatus === "facts_not_established";
    if (hasFacts !== (source.inspection !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection"],
        message: "affected-source inspection must agree with its readiness status",
      });
    }
    if (
      source.readinessStatus === "facts_established" &&
      source.inspection?.state !== "established"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection", "state"],
        message: "established readiness requires an established inspection",
      });
    }
    if (
      source.readinessStatus === "facts_not_established" &&
      source.inspection?.state !== "facts_not_established"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection", "state"],
        message: "incomplete readiness requires a facts-not-established inspection",
      });
    }
    if (
      source.duplicate.status === "exact_content_duplicate" &&
      source.duplicate.groupSha256 !== source.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duplicate", "groupSha256"],
        message: "duplicate group digest must equal the affected-source digest",
      });
    }
  });
type AffectedSource = z.infer<typeof AffectedSourceSchema>;

const ChecklistItemSchema = z
  .object({
    id: z.string().regex(CHECKLIST_ITEM_ID).max(160),
    basisKind: z.enum(["gap", "unknown"]),
    evidenceCode: EvidenceCodeSchema,
    category: FoundryOperatorEvidenceCategorySchema,
    evidencePriority: FoundryOperatorEvidencePrioritySchema.exclude([
      "blocking",
    ]),
    necessity: z.literal("not_evaluated"),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    requestedEvidence: z.string().trim().min(1).max(500),
    completionEvidenceKind: CompletionEvidenceKindSchema,
    completionEvidenceRequirements: z
      .array(z.string().trim().min(1).max(500))
      .min(2)
      .max(4),
    completionLimits: z.string().trim().min(1).max(1_000),
    laneIds: z
      .array(FoundrySourceReadinessLaneIdSchema)
      .min(1)
      .max(FOUNDRY_SOURCE_READINESS_LANE_IDS.length),
    affectedSources: z.array(AffectedSourceSchema),
  })
  .strict()
  .superRefine((item, ctx) => {
    const definition = REQUEST_DEFINITIONS[item.evidenceCode];
    const completion = COMPLETION_DEFINITIONS[definition.category];
    const expectedId = `${definition.category}:${item.evidenceCode}`;
    const fixedFields = [
      ["id", item.id, expectedId],
      ["basisKind", item.basisKind, definition.basisKind],
      ["category", item.category, definition.category],
      ["evidencePriority", item.evidencePriority, definition.priority],
      ["label", item.label, definition.label],
      ["reason", item.reason, definition.reason],
      ["requestedEvidence", item.requestedEvidence, definition.requestedEvidence],
      ["completionEvidenceKind", item.completionEvidenceKind, completion.kind],
      ["completionLimits", item.completionLimits, completion.limits],
    ] as const;
    for (const [path, actual, expected] of fixedFields) {
      if (actual !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must match the canonical evidence-code definition`,
        });
      }
    }
    if (
      JSON.stringify(item.completionEvidenceRequirements) !==
      JSON.stringify(completion.criteria)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completionEvidenceRequirements"],
        message: "completion requirements must match the canonical evidence category",
      });
    }
    if (
      JSON.stringify(item.laneIds) !==
      JSON.stringify(canonicalLaneIds(item.laneIds))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "affected lane identifiers must be unique and canonically ordered",
      });
    }
    if (!isSortedUnique(item.affectedSources.map((source) => source.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedSources"],
        message: "affected sources must be unique and canonically ordered",
      });
    }
    const mayHaveNoSource = item.evidenceCode === "NO_SOURCE_OBSERVED";
    if (mayHaveNoSource !== (item.affectedSources.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedSources"],
        message: "only the conditional no-source request may omit affected sources",
      });
    }
    if (
      item.affectedSources.length > 0 &&
      JSON.stringify(item.laneIds) !==
        JSON.stringify(
          canonicalLaneIds(
            item.affectedSources.flatMap((source) => source.laneIds),
          ),
        )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["laneIds"],
        message: "item lanes must equal the union of its affected-source lanes",
      });
    }
  });
type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

const GROUP_DESCRIPTORS = [
  {
    id: "existing_source_foundations",
    priority: "high",
    heading: "Clarify or inspect sources already here",
    meaning:
      "Resolve format ambiguity, missing format identification, unsupported V4 coverage, or a bounded inspection failure before relying on deeper source facts.",
  },
  {
    id: "unestablished_source_facts",
    priority: "normal",
    heading: "Establish facts the current bytes did not prove",
    meaning:
      "Collect bounded inspection, provenance, registration, independent-control, rights, or appearance evidence without turning a request into an authority claim.",
  },
  {
    id: "conditional_source_opportunities",
    priority: "conditional",
    heading: "Consider additional source families only if the intended output needs them",
    meaning:
      "A missing family is an optional evidence opportunity until a separate desired-output profile proves that it is necessary.",
  },
] as const satisfies readonly {
  readonly id: string;
  readonly priority: Exclude<FoundryOperatorEvidencePriority, "blocking">;
  readonly heading: string;
  readonly meaning: string;
}[];

const GroupIdSchema = z.enum([
  GROUP_DESCRIPTORS[0].id,
  GROUP_DESCRIPTORS[1].id,
  GROUP_DESCRIPTORS[2].id,
]);

const GroupSchema = z
  .object({
    id: GroupIdSchema,
    priority: FoundryOperatorEvidencePrioritySchema.exclude(["blocking"]),
    heading: z.string().trim().min(1).max(160),
    meaning: z.string().trim().min(1).max(500),
    itemIds: z.array(z.string().regex(CHECKLIST_ITEM_ID).max(160)).min(1),
    counts: z
      .object({
        itemCount: z.number().int().positive(),
        affectedSourceCount: z.number().int().nonnegative(),
        distinctContentCount: z.number().int().nonnegative(),
        affectedLaneCount: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
type ChecklistGroup = z.infer<typeof GroupSchema>;

const SummarySchema = z
  .object({
    receiptFileCount: z.number().int().nonnegative(),
    evidenceRequestCount: z.number().int().nonnegative(),
    groupCount: z.number().int().nonnegative(),
    blockingCount: z.number().int().nonnegative(),
    highCount: z.number().int().nonnegative(),
    normalCount: z.number().int().nonnegative(),
    conditionalCount: z.number().int().nonnegative(),
    affectedSourceCount: z.number().int().nonnegative(),
    distinctContentCount: z.number().int().nonnegative(),
    affectedLaneCount: z.number().int().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    reconstruction: z.literal("none"),
    networkAccess: z.literal("none"),
    requestPerformance: z.literal("none"),
    completionTracking: z.literal("none"),
    desiredOutputProfile: z.literal("not_bound"),
    prioritization: z.literal("evidence_dependency_only"),
    necessity: z.literal("not_evaluated"),
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
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[0]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[1]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[2]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[3]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[4]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[5]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[6]),
]);

const BlockedSourceSchema = z
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
    category: z.literal("official_export"),
    evidencePriority: z.literal("blocking"),
    necessity: z.literal("not_evaluated"),
    label: z.literal("Request an official open-format export"),
    reason: z.literal(
      "The Source Readiness map is blocked because the source set includes an XGRIDS XBIN candidate.",
    ),
    requestedEvidence: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
    completionEvidenceKind: z.literal("official_export_receipt"),
    completionEvidenceRequirements: z
      .array(z.string().trim().min(1).max(500))
      .length(COMPLETION_DEFINITIONS.official_export.criteria.length),
    completionLimits: z.literal(COMPLETION_DEFINITIONS.official_export.limits),
    affectedSources: z.array(BlockedSourceSchema).min(1),
  })
  .strict()
  .superRefine((reason, ctx) => {
    if (
      JSON.stringify(reason.completionEvidenceRequirements) !==
      JSON.stringify(COMPLETION_DEFINITIONS.official_export.criteria)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completionEvidenceRequirements"],
        message: "blocked export requirements must match the canonical definition",
      });
    }
    if (!isSortedUnique(reason.affectedSources.map((source) => source.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedSources"],
        message: "blocked sources must be unique and canonically ordered",
      });
    }
  });

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4),
    meaning: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_MEANING),
    basis: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_BASIS),
    disclaimer: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    readinessSha256: z.string().regex(SHA256_HEX),
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    checklistSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  groups: z.array(GroupSchema).max(GROUP_DESCRIPTORS.length),
  items: z.array(ChecklistItemSchema).max(EVIDENCE_CODES.length),
  blockedReason: z.null(),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  groups: z.tuple([]),
  items: z.tuple([]),
  blockedReason: BlockedReasonSchema,
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

export const FoundryOperatorEvidenceChecklistV4Schema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);
export type FoundryOperatorEvidenceChecklistV4 = z.infer<
  typeof FoundryOperatorEvidenceChecklistV4Schema
>;

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  reconstruction: "none",
  networkAccess: "none",
  requestPerformance: "none",
  completionTracking: "none",
  desiredOutputProfile: "not_bound",
  prioritization: "evidence_dependency_only",
  necessity: "not_evaluated",
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

const PRIORITY_ORDER = new Map(
  FOUNDRY_OPERATOR_EVIDENCE_PRIORITIES.map((priority, index) => [
    priority,
    index,
  ] as const),
);
const CATEGORY_ORDER = new Map(
  FOUNDRY_OPERATOR_EVIDENCE_CATEGORIES.map((category, index) => [
    category,
    index,
  ] as const),
);

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
  return FOUNDRY_SOURCE_READINESS_LANE_IDS.filter((laneId) =>
    present.has(laneId),
  );
}

function canonicalSources(
  sources: readonly AffectedSource[],
): AffectedSource[] {
  const byPath = new Map<string, AffectedSource>();
  for (const source of sources) {
    const existing = byPath.get(source.path);
    if (
      existing !== undefined &&
      JSON.stringify(existing) !== JSON.stringify(source)
    ) {
      throw new FoundryIntegrityError(
        "OPERATOR_EVIDENCE_SOURCE_CONTRADICTION",
        `Evidence source ${source.path} has contradictory identities.`,
      );
    }
    byPath.set(source.path, source);
  }
  return [...byPath.values()].sort((left, right) =>
    compareCanonicalStrings(left.path, right.path),
  );
}

function compareItems(left: ChecklistItem, right: ChecklistItem): number {
  const priority =
    (PRIORITY_ORDER.get(left.evidencePriority) ?? Number.MAX_SAFE_INTEGER) -
    (PRIORITY_ORDER.get(right.evidencePriority) ?? Number.MAX_SAFE_INTEGER);
  if (priority !== 0) return priority;
  const category =
    (CATEGORY_ORDER.get(left.category) ?? Number.MAX_SAFE_INTEGER) -
    (CATEGORY_ORDER.get(right.category) ?? Number.MAX_SAFE_INTEGER);
  if (category !== 0) return category;
  const code = compareCanonicalStrings(left.evidenceCode, right.evidenceCode);
  return code !== 0 ? code : compareCanonicalStrings(left.id, right.id);
}

function canonicalItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return [...items].sort(compareItems);
}

function distinctContentCount(
  sources: readonly { readonly sha256: string; readonly sizeBytes: number }[],
): number {
  return new Set(
    sources.map((source) => `${source.sha256}:${String(source.sizeBytes)}`),
  ).size;
}

function sourceRefFromFile(
  file: Extract<
    FoundrySourceReadinessMapV4,
    { readonly state: "available" }
  >["files"][number],
): AffectedSource {
  return AffectedSourceSchema.parse({
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    duplicate: file.duplicate,
    laneIds: file.laneIds,
    readinessStatus: file.status,
    inspection: file.inspection,
  });
}

function itemFromEvidence(
  evidenceCode: EvidenceCode,
  laneIds: readonly FoundrySourceReadinessLaneId[],
  affectedSources: readonly AffectedSource[],
  observed: {
    readonly label: string;
    readonly reason: string;
    readonly requestedEvidence: string;
  },
): ChecklistItem {
  const definition = REQUEST_DEFINITIONS[evidenceCode];
  if (
    definition.label !== observed.label ||
    definition.reason !== observed.reason ||
    definition.requestedEvidence !== observed.requestedEvidence
  ) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_DEFINITION_MISMATCH",
      `Readiness evidence ${evidenceCode} contradicts the canonical checklist definition.`,
    );
  }
  const completion = COMPLETION_DEFINITIONS[definition.category];
  return ChecklistItemSchema.parse({
    id: `${definition.category}:${evidenceCode}`,
    basisKind: definition.basisKind,
    evidenceCode,
    category: definition.category,
    evidencePriority: definition.priority,
    necessity: "not_evaluated",
    label: definition.label,
    reason: definition.reason,
    requestedEvidence: definition.requestedEvidence,
    completionEvidenceKind: completion.kind,
    completionEvidenceRequirements: [...completion.criteria],
    completionLimits: completion.limits,
    laneIds: canonicalLaneIds(laneIds),
    affectedSources: canonicalSources(affectedSources),
  });
}

function buildGroups(items: readonly ChecklistItem[]): ChecklistGroup[] {
  return GROUP_DESCRIPTORS.flatMap((descriptor) => {
    const represented = items.filter(
      (item) => item.evidencePriority === descriptor.priority,
    );
    if (represented.length === 0) return [];
    const sources = canonicalSources(
      represented.flatMap((item) => item.affectedSources),
    );
    const laneIds = canonicalLaneIds(
      represented.flatMap((item) => item.laneIds),
    );
    return [
      GroupSchema.parse({
        ...descriptor,
        itemIds: represented.map((item) => item.id),
        counts: {
          itemCount: represented.length,
          affectedSourceCount: sources.length,
          distinctContentCount: distinctContentCount(sources),
          affectedLaneCount: laneIds.length,
        },
      }),
    ];
  });
}

function summaryForAvailable(
  receiptFileCount: number,
  items: readonly ChecklistItem[],
  groups: readonly ChecklistGroup[],
): z.infer<typeof SummarySchema> {
  const sources = canonicalSources(items.flatMap((item) => item.affectedSources));
  const laneIds = canonicalLaneIds(items.flatMap((item) => item.laneIds));
  return {
    receiptFileCount,
    evidenceRequestCount: items.length,
    groupCount: groups.length,
    blockingCount: 0,
    highCount: items.filter((item) => item.evidencePriority === "high").length,
    normalCount: items.filter((item) => item.evidencePriority === "normal").length,
    conditionalCount: items.filter(
      (item) => item.evidencePriority === "conditional",
    ).length,
    affectedSourceCount: sources.length,
    distinctContentCount: distinctContentCount(sources),
    affectedLaneCount: laneIds.length,
  };
}

function summaryForBlocked(
  receiptFileCount: number,
  sources: readonly z.infer<typeof BlockedSourceSchema>[],
): z.infer<typeof SummarySchema> {
  return {
    receiptFileCount,
    evidenceRequestCount: 1,
    groupCount: 0,
    blockingCount: 1,
    highCount: 0,
    normalCount: 0,
    conditionalCount: 0,
    affectedSourceCount: sources.length,
    distinctContentCount: distinctContentCount(sources),
    affectedLaneCount: 0,
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { checklistSha256: _checklistSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (value.state === "available") {
    const expectedItems = canonicalItems(value.items);
    if (JSON.stringify(value.items) !== JSON.stringify(expectedItems)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "checklist items must be unique and canonically ordered",
      });
    }
    if (
      new Set(value.items.map((item) => item.evidenceCode)).size !==
      value.items.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "each evidence code must appear exactly once",
      });
    }
    let expectedGroups: ChecklistGroup[];
    let expectedSummary: z.infer<typeof SummarySchema>;
    try {
      expectedGroups = buildGroups(expectedItems);
      expectedSummary = summaryForAvailable(
        value.summary.receiptFileCount,
        expectedItems,
        expectedGroups,
      );
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "checklist items contain contradictory affected-source identities",
      });
      return;
    }
    if (JSON.stringify(value.groups) !== JSON.stringify(expectedGroups)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups"],
        message: "checklist groups contradict the canonical item aggregation",
      });
    }
    if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "checklist summary contradicts the canonical item aggregation",
      });
    }
  } else {
    const expectedSummary = summaryForBlocked(
      value.summary.receiptFileCount,
      value.blockedReason.affectedSources,
    );
    if (
      value.summary.receiptFileCount <
      value.blockedReason.affectedSources.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "receiptFileCount"],
        message: "blocked receipt count cannot be smaller than affected sources",
      });
    }
    if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "blocked checklist summary contradicts the export request",
      });
    }
  }
  if (value.checklistSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checklistSha256"],
      message: "checklist digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: Omit<ArtifactWithoutValidation, "checklistSha256">,
): FoundryOperatorEvidenceChecklistV4 {
  const candidate = {
    ...payload,
    checklistSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryOperatorEvidenceChecklistV4Schema.parse({
    ...payload,
    checklistSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[0],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[1],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[2],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[3],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[4],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[5],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_LIMITATIONS[6],
  ];
}

function isEvidenceCode(value: string): value is EvidenceCode {
  return Object.hasOwn(REQUEST_DEFINITIONS, value);
}

export interface CompileFoundryOperatorEvidenceChecklistV4Input {
  readonly readiness: unknown;
}

/**
 * Builds a deterministic, unperformed evidence-request checklist from only an
 * exact Source Readiness Map V4. It performs no evidence acquisition or work.
 */
export function compileFoundryOperatorEvidenceChecklistV4(
  input: CompileFoundryOperatorEvidenceChecklistV4Input,
): FoundryOperatorEvidenceChecklistV4 {
  const readiness = FoundrySourceReadinessMapV4Schema.parse(input.readiness);
  if (readiness.state === "blocked") {
    const affectedSources = readiness.blockedReason.affectedSources.map(
      (source) => BlockedSourceSchema.parse(source),
    );
    return issueArtifact({
      schemaVersion: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4,
      meaning: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_MEANING,
      basis: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_BASIS,
      disclaimer: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DISCLAIMER,
      receiptSha256: readiness.receiptSha256,
      sourceFactsSha256: readiness.sourceFactsSha256,
      readinessSha256: readiness.readinessSha256,
      state: "blocked",
      policy: POLICY,
      limitations: limitations(),
      summary: summaryForBlocked(
        readiness.summary.receiptFileCount,
        affectedSources,
      ),
      groups: [],
      items: [],
      blockedReason: {
        code: "XGRIDS_XBIN_BLOCKED",
        category: "official_export",
        evidencePriority: "blocking",
        necessity: "not_evaluated",
        label: "Request an official open-format export",
        reason:
          "The Source Readiness map is blocked because the source set includes an XGRIDS XBIN candidate.",
        requestedEvidence: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
        completionEvidenceKind: "official_export_receipt",
        completionEvidenceRequirements: [
          ...COMPLETION_DEFINITIONS.official_export.criteria,
        ],
        completionLimits: COMPLETION_DEFINITIONS.official_export.limits,
        affectedSources,
      },
    });
  }

  const filesByPath = new Map(
    readiness.files.map((file) => [file.path, file] as const),
  );
  const sourceRefsForPaths = (paths: readonly string[]): AffectedSource[] =>
    paths.map((path) => {
      const file = filesByPath.get(path);
      if (file === undefined) {
        throw new FoundryIntegrityError(
          "OPERATOR_EVIDENCE_SOURCE_NOT_FOUND",
          `Evidence request source ${path} is absent from Source Readiness.`,
        );
      }
      return sourceRefFromFile(file);
    });

  const items: ChecklistItem[] = readiness.gaps.map((gap) => {
    return itemFromEvidence(
      gap.code,
      gap.laneIds,
      sourceRefsForPaths(gap.sourcePaths),
      {
        label: gap.label,
        reason: gap.reason,
        requestedEvidence: gap.decisiveNextTest,
      },
    );
  });

  const unknowns = new Map<
    string,
    {
      readonly label: string;
      readonly reason: string;
      readonly requestedEvidence: string;
      readonly laneIds: Set<FoundrySourceReadinessLaneId>;
      readonly sources: AffectedSource[];
    }
  >();
  for (const file of readiness.files) {
    for (const unknown of file.unknowns) {
      if (!isEvidenceCode(unknown.code)) {
        throw new FoundryIntegrityError(
          "OPERATOR_EVIDENCE_CODE_UNRECOGNIZED",
          `Source fact code ${unknown.code} has no reviewed checklist mapping.`,
        );
      }
      const existing = unknowns.get(unknown.code);
      if (existing === undefined) {
        unknowns.set(unknown.code, {
          label: unknown.label,
          reason: unknown.reason,
          requestedEvidence: unknown.decisiveNextTest,
          laneIds: new Set(file.laneIds),
          sources: [sourceRefFromFile(file)],
        });
        continue;
      }
      if (
        existing.label !== unknown.label ||
        existing.reason !== unknown.reason ||
        existing.requestedEvidence !== unknown.decisiveNextTest
      ) {
        throw new FoundryIntegrityError(
          "OPERATOR_EVIDENCE_UNKNOWN_CONTRADICTION",
          `Source fact ${unknown.code} has contradictory checklist evidence.`,
        );
      }
      for (const laneId of file.laneIds) existing.laneIds.add(laneId);
      existing.sources.push(sourceRefFromFile(file));
    }
  }
  for (const [code, unknown] of unknowns) {
    if (!isEvidenceCode(code)) {
      throw new FoundryIntegrityError(
        "OPERATOR_EVIDENCE_CODE_UNRECOGNIZED",
        `Source fact code ${code} has no reviewed checklist mapping.`,
      );
    }
    items.push(
      itemFromEvidence(
        code,
        [...unknown.laneIds],
        unknown.sources,
        unknown,
      ),
    );
  }

  const orderedItems = canonicalItems(items);
  const groups = buildGroups(orderedItems);
  return issueArtifact({
    schemaVersion: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V4,
    meaning: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_MEANING,
    basis: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_BASIS,
    disclaimer: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DISCLAIMER,
    receiptSha256: readiness.receiptSha256,
    sourceFactsSha256: readiness.sourceFactsSha256,
    readinessSha256: readiness.readinessSha256,
    state: "available",
    policy: POLICY,
    limitations: limitations(),
    summary: summaryForAvailable(
      readiness.summary.receiptFileCount,
      orderedItems,
      groups,
    ),
    groups,
    items: orderedItems,
    blockedReason: null,
  });
}

export interface VerifyFoundryOperatorEvidenceChecklistV4Input {
  readonly readiness: unknown;
  readonly checklist: unknown;
}

export function verifyFoundryOperatorEvidenceChecklistV4(
  input: VerifyFoundryOperatorEvidenceChecklistV4Input,
): FoundryOperatorEvidenceChecklistV4 {
  const actual = FoundryOperatorEvidenceChecklistV4Schema.parse(
    input.checklist,
  );
  const expected = compileFoundryOperatorEvidenceChecklistV4({
    readiness: input.readiness,
  });
  if (
    serializeFoundryOperatorEvidenceChecklistV4(actual) !==
    serializeFoundryOperatorEvidenceChecklistV4(expected)
  ) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_CHECKLIST_MISMATCH",
      "The checklist does not exactly match the supplied Source Readiness artifact.",
    );
  }
  return actual;
}

export function serializeFoundryOperatorEvidenceChecklistV4(
  value: FoundryOperatorEvidenceChecklistV4,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryOperatorEvidenceChecklistV4Schema.parse(value)),
  );
}
