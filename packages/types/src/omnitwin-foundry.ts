import { z } from "zod";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  RuntimeTransformMatrix4dSchema,
} from "./runtime-venue-manifest.js";

// Control-plane contracts only. These schemas do not read source bytes, start
// reconstruction work, submit compute, or publish a runtime package.

export const FOUNDRY_INGEST_MANIFEST_V0 = "omnitwin.foundry.ingest-manifest.v0";
export const FOUNDRY_QUALITY_CONTRACT_V0 = "omnitwin.foundry.quality-contract.v0";
export const FOUNDRY_QUALITY_REPORT_V0 = "omnitwin.foundry.quality-report.v0";
export const FOUNDRY_JOB_SPEC_V0 = "omnitwin.foundry.job-spec.v0";
export const FOUNDRY_CANONICAL_VENUE_PACKAGE_V0 =
  "omnitwin.foundry.canonical-venue-package.v0";

const SAFE_CONTAINER_IMAGE = /^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/u;

const EXACT_UTC_MILLISECOND_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const FoundryUtcInstantSchema = z
  .string()
  .regex(
    EXACT_UTC_MILLISECOND_INSTANT,
    "timestamp must use exact YYYY-MM-DDTHH:mm:ss.sssZ form",
  )
  .refine((value) => !value.startsWith("0000-"), "timestamp year must be between 0001 and 9999")
  .refine(
    (value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
    },
    "timestamp must be a canonical real UTC millisecond instant",
  );

function hasValidUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const FoundryCanonicalActorSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim() === value, "actor identity must already be trimmed")
  .refine((value) => value.normalize("NFC") === value, "actor identity must use NFC")
  .refine(hasValidUnicodeScalarSequence, "actor identity must contain valid Unicode scalars")
  .refine(
    (value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value),
    "actor identity must not contain control, format, or line-separator characters",
  );

export const FOUNDRY_MICRO_USD_PER_USD = 1_000_000;

/** Exact bridge for the legacy V0 USD-number fields; null means precision loss. */
export function foundryUsdNumberToMicroUsd(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const scaled = value * FOUNDRY_MICRO_USD_PER_USD;
  return Number.isSafeInteger(scaled) ? String(scaled) : null;
}

function isSafeFoundryRelativePath(value: string): boolean {
  if (
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[<>:"|?*]/u.test(value)
  ) {
    return false;
  }
  return value.split("/").every(
    (part) => {
      const windowsStem = part.split(".", 1)[0]?.toUpperCase() ?? "";
      const windowsDevice =
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsStem);
      return (
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !part.endsWith(".") &&
        !part.endsWith(" ") &&
        !windowsDevice &&
        Array.from(part).every((character) => {
          const code = character.charCodeAt(0);
          const codePoint = character.codePointAt(0) ?? code;
          const bidiControl =
            (codePoint >= 0x202a && codePoint <= 0x202e) ||
            (codePoint >= 0x2066 && codePoint <= 0x2069) ||
            codePoint === 0xfeff;
          return (
            code >= 0x20 &&
            code !== 0x7f &&
            !(code >= 0x80 && code <= 0x9f) &&
            !bidiControl
          );
        })
      );
    },
  );
}

export const FoundryRelativePathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(hasValidUnicodeScalarSequence, "path must contain valid Unicode scalars")
  .refine(isSafeFoundryRelativePath, "path must be a traversal-free relative POSIX path");

export const FoundryCommandArgumentSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(hasValidUnicodeScalarSequence, "command argument must contain valid Unicode scalars")
  .refine((value) => !value.includes("\u0000"), "command argument must not contain NUL");

export const FOUNDRY_INPUT_TYPES = [
  "matterport_e57",
  "matterpak_bundle",
  "generic_e57",
  "las_laz",
  "xyz_point_cloud",
  "ply_point_cloud",
  "matterport_panorama",
  "dslr_image",
  "generic_image",
  "panorama_360",
  "phone_image",
  "drone_media",
  "video",
  "rgbd",
  "sensor_log_mcap",
  "imu",
  "gnss_rtk",
  "xgrids_xbin",
  "lcc",
  "lcc2",
  "spz",
  "sog",
  "gaussian_ply",
  "obj",
  "fbx",
  "glb_gltf",
  "floor_plan",
  "cad_bim",
  "openusd",
  "calibration_bundle",
  "trajectory",
  "control_network",
  "colmap_database",
  "colmap_sparse_model",
  "manual_evidence",
  "evidence_record",
] as const;
export const FoundryInputTypeSchema = z.enum(FOUNDRY_INPUT_TYPES);
export type FoundryInputType = z.infer<typeof FoundryInputTypeSchema>;

export const FOUNDRY_DETECTION_CONFIDENCE = ["high", "medium", "low"] as const;
export const FoundryDetectionConfidenceSchema = z.enum(FOUNDRY_DETECTION_CONFIDENCE);
export const FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS = 64_000;

export const FoundryFileProbeSchema = z
  .object({
    relativePath: FoundryRelativePathSchema,
    magicHex: z.string().regex(/^(?:[a-f0-9]{2})*$/u).max(256),
    boundedHeaderText: z.string().max(FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS).nullable(),
  })
  .strict();
export type FoundryFileProbe = z.infer<typeof FoundryFileProbeSchema>;

export const FoundryDetectionCandidateSchema = z
  .object({
    inputType: FoundryInputTypeSchema,
    confidence: FoundryDetectionConfidenceSchema,
    evidence: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  })
  .strict();

export const FoundryFileDetectionSchema = z
  .object({
    status: z.enum(["detected", "ambiguous", "unknown"]),
    candidates: z.array(FoundryDetectionCandidateSchema).max(20),
    caveats: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();
export type FoundryFileDetection = z.infer<typeof FoundryFileDetectionSchema>;

const DETECTION_CONFIDENCE_RANK: Readonly<Record<
  z.infer<typeof FoundryDetectionConfidenceSchema>,
  number
>> = { high: 3, medium: 2, low: 1 };

function fileExtension(relativePath: string): string {
  const fileName = relativePath.split("/").at(-1) ?? relativePath;
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

const GAUSSIAN_PLY_MARKER_PROPERTIES = ["f_dc_0", "scale_0", "rot_0"] as const;
const PLY_CLASSIFIER_ENCODINGS = [
  "ascii",
  "binary_big_endian",
  "binary_little_endian",
  "binary_little_endian_compressed",
] as const;
type BoundedGaussianPlyClassification =
  | "gaussian_candidate"
  | "not_gaussian"
  | "incomplete_header";

function withoutPlyLineTerminator(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

/**
 * Classifies only a complete PLY header present in the caller's bounded probe.
 * Tokens remain case-sensitive, comments are never searched for properties,
 * and an absent `end_header` is reported as inconclusive rather than silently
 * treated as proof that the PLY is an ordinary point cloud.
 */
function classifyBoundedGaussianPlyHeader(
  boundedHeaderText: string | null,
): BoundedGaussianPlyClassification {
  if (boundedHeaderText === null || boundedHeaderText.length === 0) {
    return "incomplete_header";
  }
  const lines = boundedHeaderText.split("\n").map(withoutPlyLineTerminator);
  if (lines[0] !== "ply") return "not_gaussian";

  const formatTokens = (lines[1] ?? "").trim().split(/[ \t]+/u);
  if (
    formatTokens.length !== 3 ||
    formatTokens[0] !== "format" ||
    !PLY_CLASSIFIER_ENCODINGS.includes(
      formatTokens[1] as (typeof PLY_CLASSIFIER_ENCODINGS)[number],
    ) ||
    !/^[0-9]+\.[0-9]+$/u.test(formatTokens[2] ?? "")
  ) {
    return "not_gaussian";
  }

  let currentElement: string | null = null;
  const markers = new Set<string>();
  for (let index = 2; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (line === "end_header") {
      if (rawLine !== "end_header") return "not_gaussian";
      return GAUSSIAN_PLY_MARKER_PROPERTIES.every((name) => markers.has(name))
        ? "gaussian_candidate"
        : "not_gaussian";
    }
    if (line.length === 0) {
      return index === lines.length - 1 ? "incomplete_header" : "not_gaussian";
    }
    const tokens = line.split(/[ \t]+/u);
    const keyword = tokens[0];
    if (keyword === "comment" || keyword === "obj_info") continue;
    if (keyword === "element") {
      if (tokens.length !== 3) return "not_gaussian";
      currentElement = tokens[1] ?? null;
      continue;
    }
    if (keyword === "property") {
      if (tokens[1] === "list") continue;
      if (tokens.length !== 3) return "not_gaussian";
      const declaredType = tokens[1];
      const propertyName = tokens[2] ?? "";
      if (
        currentElement === "vertex" &&
        (declaredType === "float" || declaredType === "float32") &&
        GAUSSIAN_PLY_MARKER_PROPERTIES.includes(
          propertyName as (typeof GAUSSIAN_PLY_MARKER_PROPERTIES)[number],
        )
      ) {
        markers.add(propertyName);
      }
      continue;
    }
    return "not_gaussian";
  }
  return "incomplete_header";
}

/**
 * Classifies a caller-supplied bounded probe. It performs no filesystem I/O;
 * the inspector remains responsible for safe bounded reads and full hashing.
 */
export function detectFoundryInputFile(input: unknown): FoundryFileDetection {
  const probe = FoundryFileProbeSchema.parse(input);
  const extension = fileExtension(probe.relativePath);
  const name = probe.relativePath.split("/").at(-1)?.toLowerCase() ?? "";
  const magic = probe.magicHex;
  const candidates = new Map<FoundryInputType, z.infer<typeof FoundryDetectionCandidateSchema>>();
  const caveats = new Set<string>();

  const add = (
    inputType: FoundryInputType,
    confidence: z.infer<typeof FoundryDetectionConfidenceSchema>,
    evidence: string,
  ): void => {
    const existing = candidates.get(inputType);
    if (existing === undefined) {
      candidates.set(inputType, { inputType, confidence, evidence: [evidence] });
      return;
    }
    if (DETECTION_CONFIDENCE_RANK[confidence] > DETECTION_CONFIDENCE_RANK[existing.confidence]) {
      existing.confidence = confidence;
    }
    if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
  };

  if (magic.startsWith("4153544d2d453537")) add("generic_e57", "high", "astm_e57_magic");
  if (magic.startsWith("4c415346")) add("las_laz", "high", "lasf_magic");
  if (magic.startsWith("58424147")) add("xgrids_xbin", "high", "xbag_magic");
  if (magic.startsWith("676c5446")) add("glb_gltf", "high", "glb_magic");

  if (extension === ".e57") {
    add("generic_e57", magic.startsWith("4153544d2d453537") ? "high" : "low", "e57_extension");
    if (!magic.startsWith("4153544d2d453537")) caveats.add("E57 extension lacks the expected ASTM-E57 signature.");
  }
  if (extension === ".las" || extension === ".laz") {
    add("las_laz", magic.startsWith("4c415346") ? "high" : "medium", "las_or_laz_extension");
  }
  if (extension === ".xyz") add("xyz_point_cloud", "medium", "xyz_extension");
  if (extension === ".xbin") {
    add("xgrids_xbin", magic.startsWith("58424147") ? "high" : "low", "xbin_extension");
    caveats.add("Classification does not authorize proprietary payload decoding.");
  }
  if (extension === ".lcc") add("lcc", "medium", "lcc_extension");
  if (extension === ".lcc2") add("lcc2", "medium", "lcc2_extension");
  if (extension === ".spz") {
    add("spz", "medium", magic.startsWith("1f8b") ? "spz_extension_and_gzip_container" : "spz_extension");
  }
  if (extension === ".sog") {
    add("sog", "medium", magic.startsWith("504b0304") ? "sog_extension_and_zip_container" : "sog_extension");
  }
  if (extension === ".ply") {
    const boundedPlyClassification = classifyBoundedGaussianPlyHeader(
      probe.boundedHeaderText,
    );
    const gaussian = boundedPlyClassification === "gaussian_candidate";
    const verifiedGaussianHeader = gaussian && magic.startsWith("706c79");
    add(gaussian ? "gaussian_ply" : "ply_point_cloud", verifiedGaussianHeader ? "high" : "medium", gaussian ? "gaussian_ply_properties" : "ply_extension");
    if (boundedPlyClassification === "incomplete_header") {
      caveats.add(
        `Gaussian PLY classification is inconclusive because the bounded ${String(FOUNDRY_MAX_BOUNDED_HEADER_CHARACTERS)}-character probe does not contain a complete case-sensitive PLY header.`,
      );
    }
    if (!gaussian) caveats.add("PLY role, units, coordinate frame, and property conventions need header review.");
  }
  if (extension === ".obj") add("obj", "medium", "obj_extension");
  if (extension === ".fbx") add("fbx", "medium", "fbx_extension");
  if (extension === ".glb" || extension === ".gltf") {
    add("glb_gltf", magic.startsWith("676c5446") ? "high" : "medium", "gltf_extension");
  }
  if ([".usd", ".usda", ".usdc", ".usdz"].includes(extension)) {
    add("openusd", "medium", "openusd_extension");
  }
  if ([".ifc", ".dwg", ".dxf", ".nwc", ".step", ".stp"].includes(extension)) {
    add("cad_bim", "medium", "cad_or_bim_extension");
  }
  if (extension === ".pdf") add("floor_plan", "low", "pdf_extension");
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(extension)) {
    add("video", "medium", "video_extension");
  }
  if (extension === ".mcap") add("sensor_log_mcap", "medium", "mcap_extension");
  if ([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng", ".cr2", ".cr3", ".nef", ".arw"].includes(extension)) {
    add("dslr_image", "low", "image_extension");
    add("generic_image", "low", "image_extension");
    add("phone_image", "low", "image_extension");
    add("matterport_panorama", "low", "image_extension");
    add("panorama_360", "low", "image_extension");
    caveats.add("Image class requires EXIF, projection, dimensions, and source-context inspection.");
  }
  if (name.includes("matterpak") && extension === ".zip") {
    add("matterpak_bundle", "low", "matterpak_filename");
    caveats.add("MatterPak classification requires bounded archive inventory and source-rights review.");
  }
  if (name.includes("drone") || name.startsWith("dji_")) {
    add("drone_media", "medium", "drone_filename");
  }
  if (name === "poses.csv" || name === "poses.json" || name.includes("trajectory")) {
    add("trajectory", "medium", "trajectory_filename");
  }
  if (name.includes("control_point") || name.includes("control-network")) {
    add("control_network", "medium", "control_filename");
  }
  if (name === "database.db") {
    const sqliteSignature = magic.startsWith("53514c69746520666f726d6174203300");
    add(
      "colmap_database",
      sqliteSignature ? "high" : "medium",
      sqliteSignature ? "colmap_database_sqlite_signature" : "colmap_database_filename",
    );
    caveats.add("COLMAP database classification requires read-only schema inspection.");
  }
  if (["cameras.bin", "images.bin", "points3d.bin", "frames.bin", "rigs.bin"].includes(name)) {
    add("colmap_sparse_model", "medium", "colmap_sparse_binary_filename");
    caveats.add("COLMAP sparse binary classification requires a bounded strict parser.");
  }
  if (name === "imu.csv" || name.includes("imu_data")) {
    add("imu", "medium", "imu_filename");
  }
  if (name === "gnss.csv" || name.includes("rtk") || name.includes("gnss")) {
    add("gnss_rtk", "medium", "gnss_or_rtk_filename");
  }
  if (name.includes("known_dimension") || name === "rooms.csv" || name === "room_names.csv") {
    add("manual_evidence", "medium", "manual_evidence_filename");
  }
  if (
    extension === ".json" &&
    (name.includes("transform") || name.includes("residual") || name.includes("quality"))
  ) {
    add("evidence_record", "medium", "evidence_record_filename");
  }
  if (
    name.includes("calibration") ||
    name.includes("intrinsic") ||
    name.includes("extrinsic") ||
    name === "camera.yaml" ||
    name === "imu.yaml"
  ) {
    add("calibration_bundle", "medium", "calibration_filename");
  }

  const ordered = [...candidates.values()].sort((left, right) => {
    const rank = DETECTION_CONFIDENCE_RANK[right.confidence] - DETECTION_CONFIDENCE_RANK[left.confidence];
    return rank !== 0 ? rank : left.inputType.localeCompare(right.inputType);
  });
  const highConfidenceCount = ordered.filter((candidate) => candidate.confidence === "high").length;
  const status =
    ordered.length === 0
      ? "unknown"
      : ordered.length === 1 || (highConfidenceCount === 1 && ordered[0]?.confidence === "high")
        ? "detected"
        : "ambiguous";
  return FoundryFileDetectionSchema.parse({ status, candidates: ordered, caveats: [...caveats] });
}

export const FOUNDRY_PROVENANCE_CLASSES = [
  "captured",
  "enhanced_captured",
  "generated_cinematic",
  "concept_imagination",
] as const;
export const FoundryProvenanceClassSchema = z.enum(FOUNDRY_PROVENANCE_CLASSES);
export type FoundryProvenanceClass = z.infer<typeof FoundryProvenanceClassSchema>;

// Truthfulness ordering for lineage monotonicity: a derived asset may keep or
// lower its parents' truthfulness, never raise it — generated material cannot
// become captured evidence through a derivation hop.
const FOUNDRY_PROVENANCE_TRUTHFULNESS: Record<FoundryProvenanceClass, number> = {
  captured: 3,
  enhanced_captured: 2,
  generated_cinematic: 1,
  concept_imagination: 0,
};

export const FOUNDRY_ACCESS_STATES = [
  "direct",
  "official_export",
  "official_api",
  "metadata_only",
  "blocked_technical",
  "blocked_legal",
  "unknown",
] as const;
export const FoundryAccessStateSchema = z.enum(FOUNDRY_ACCESS_STATES);

export const FOUNDRY_EVIDENCE_KINDS = [
  "transform_artifact",
  "residual_report",
  "projection_operation",
  "quality_report",
  "reviewer_attestation",
  "scene_authority_map",
  "release_manifest",
  "mask",
  "provenance_report",
  "fixed_view",
  "calibration_record",
  "other",
] as const;
export const FoundryEvidenceKindSchema = z.enum(FOUNDRY_EVIDENCE_KINDS);

export const FoundryRightsSchema = z
  .object({
    basis: z.enum([
      "customer_owned",
      "explicit_licence",
      "vendor_export_terms",
      "written_permission",
      "public_domain",
      "unknown",
    ]),
    commercialUse: z.enum(["allowed", "restricted", "prohibited", "unknown"]),
    modelTrainingUse: z.enum(["allowed", "requires_review", "prohibited", "unknown"]),
    redistribution: z.enum(["allowed", "restricted", "prohibited", "unknown"]),
    termsReviewedAt: FoundryUtcInstantSchema.nullable(),
    termsReference: z
      .string()
      .url()
      .refine((value) => value.toLowerCase().startsWith("https://"), "terms reference must use HTTPS")
      .nullable(),
    restrictions: z.array(z.string().trim().min(1).max(500)).max(50),
  })
  .strict();
export type FoundryRights = z.infer<typeof FoundryRightsSchema>;

export const FoundrySourceRootSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: z.enum(["local_directory", "removable_media", "object_prefix", "vendor_workspace"]),
    displayName: z.string().trim().min(1).max(160),
    locationRedacted: z.string().trim().min(1).max(500),
    caseSensitivity: z.enum(["sensitive", "insensitive"]),
    readOnly: z.literal(true),
  })
  .strict();

export const FoundryCrsDefinitionSchema = z
  .object({
    authority: z.string().trim().min(1).max(32),
    code: z.string().trim().min(1).max(80),
    axisOrder: z.enum([
      "longitude_latitude",
      "latitude_longitude",
      "easting_northing",
      "northing_easting",
    ]),
    horizontalDatum: z.string().trim().min(1).max(160),
    verticalDatum: z.string().trim().min(1).max(160).nullable(),
    coordinateEpoch: z.number().finite().min(1800).max(2200).nullable(),
  })
  .strict();

export const FoundryCoordinateFrameSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: z.enum([
      "venue_control",
      "room_local",
      "sensor",
      "camera",
      "lidar",
      "geodetic",
      "projected",
      "arbitrary",
    ]),
    units: z.enum(["meters", "millimeters", "centimeters", "feet", "degrees", "unitless"]),
    handedness: z.enum(["right", "left", "unknown"]),
    upAxis: z.enum(["x", "y", "z", "unknown"]),
    authority: z.enum(["measured", "registered", "inferred", "vendor_declared", "unknown"]),
    provenanceAssetIds: z.array(RuntimeManifestKeySchema).max(100),
    crs: FoundryCrsDefinitionSchema.nullable(),
  })
  .strict()
  .superRefine((frame, ctx) => {
    if (frame.authority === "measured") {
      if (frame.units === "unitless" || frame.provenanceAssetIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authority"],
          message: "measured frames require declared units and provenance evidence",
        });
      }
      if (frame.handedness === "unknown" || frame.upAxis === "unknown") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authority"],
          message: "measured frames require known handedness and up axis",
        });
      }
    }
    if (frame.kind === "geodetic" && (frame.units !== "degrees" || frame.crs === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crs"],
        message: "geodetic frames require degree units and a CRS definition",
      });
    }
    if (
      frame.kind === "geodetic" &&
      frame.crs !== null &&
      !["longitude_latitude", "latitude_longitude"].includes(frame.crs.axisOrder)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crs", "axisOrder"],
        message: "geodetic CRS axis order must be longitude/latitude or latitude/longitude",
      });
    }
    if (
      frame.kind === "projected" &&
      (frame.units === "degrees" || frame.units === "unitless" || frame.crs === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crs"],
        message: "projected frames require linear units and a CRS definition",
      });
    }
    if (
      frame.kind === "projected" &&
      frame.crs !== null &&
      !["easting_northing", "northing_easting"].includes(frame.crs.axisOrder)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crs", "axisOrder"],
        message: "projected CRS axis order must be easting/northing or northing/easting",
      });
    }
    if (frame.kind !== "geodetic" && frame.kind !== "projected" && frame.crs !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crs"],
        message: "only geodetic and projected frames carry a CRS definition in v0",
      });
    }
  });

export const FoundryInspectionValueSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "unknown",
]);

export const FoundryAssetInspectionSchema = z
  .object({
    geometryValue: FoundryInspectionValueSchema,
    appearanceValue: FoundryInspectionValueSchema,
    calibrationValue: FoundryInspectionValueSchema,
    scaleValue: FoundryInspectionValueSchema,
    metadataKeys: z.array(z.string().trim().min(1).max(160)).max(1_000),
    decisiveNextTest: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (new Set(inspection.metadataKeys).size !== inspection.metadataKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadataKeys"],
        message: "inspection metadata keys must be unique",
      });
    }
  });

export const FoundryInputAssetSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    sourceRootId: RuntimeManifestKeySchema,
    relativePath: FoundryRelativePathSchema,
    inputType: FoundryInputTypeSchema,
    mediaType: z.string().trim().min(1).max(160),
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: RuntimeSha256Schema,
    immutable: z.literal(true),
    captureState: z.enum(["raw_capture", "official_export", "derived", "reference"]),
    accessState: FoundryAccessStateSchema,
    capturedAt: FoundryUtcInstantSchema.nullable(),
    coordinateFrameId: RuntimeManifestKeySchema.nullable(),
    calibrationAssetIds: z.array(RuntimeManifestKeySchema).max(100),
    parentAssetIds: z.array(RuntimeManifestKeySchema).max(100),
    rights: FoundryRightsSchema,
    provenanceClass: FoundryProvenanceClassSchema,
    evidenceKinds: z.array(FoundryEvidenceKindSchema).max(12),
    inspection: FoundryAssetInspectionSchema,
    notes: z.array(z.string().trim().min(1).max(500)).max(50),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (asset.captureState === "raw_capture" && asset.provenanceClass !== "captured") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceClass"],
        message: "raw captures must use captured provenance",
      });
    }
    if (
      asset.captureState === "raw_capture" &&
      (asset.parentAssetIds.length !== 0 || asset.accessState !== "direct")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureState"],
        message: "raw captures must be direct sources with no parent assets",
      });
    }
    if (
      (asset.provenanceClass === "generated_cinematic" ||
        asset.provenanceClass === "concept_imagination") &&
      asset.parentAssetIds.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentAssetIds"],
        message: "generated assets must identify at least one parent or conditioning asset",
      });
    }
    if (new Set(asset.evidenceKinds).size !== asset.evidenceKinds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceKinds"],
        message: "asset evidence kinds must be unique",
      });
    }
    if (asset.inputType === "evidence_record" && asset.evidenceKinds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceKinds"],
        message: "evidence records require at least one typed evidence kind",
      });
    }
  });
export type FoundryInputAsset = z.infer<typeof FoundryInputAssetSchema>;

export const FoundryTransformEdgeSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    sourceFrameId: RuntimeManifestKeySchema,
    targetFrameId: RuntimeManifestKeySchema,
    operationKind: z.enum(["affine_similarity", "crs_projection"]),
    matrix: RuntimeTransformMatrix4dSchema.nullable(),
    state: z.enum(["proposed", "reviewed", "rejected"]),
    transformArtifactAssetId: RuntimeManifestKeySchema.nullable(),
    residualReportAssetId: RuntimeManifestKeySchema.nullable(),
    projectionArtifactAssetId: RuntimeManifestKeySchema.nullable(),
    reviewerAttestationAssetId: RuntimeManifestKeySchema.nullable(),
    provenanceAssetIds: z.array(RuntimeManifestKeySchema).min(1).max(100),
  })
  .strict()
  .superRefine((edge, ctx) => {
    if (edge.sourceFrameId === edge.targetFrameId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrameId"],
        message: "transform endpoints must differ",
      });
    }
    if (
      edge.state === "reviewed" &&
      (edge.transformArtifactAssetId === null ||
        edge.residualReportAssetId === null ||
        edge.reviewerAttestationAssetId === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifactAssetId"],
        message: "reviewed transforms require TransformArtifact, residual, and reviewer-attestation assets",
      });
    }
    if (
      (edge.operationKind === "affine_similarity") !== (edge.matrix !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matrix"],
        message: "affine operations require a matrix; CRS projections must not use one",
      });
    }
    if (
      edge.operationKind === "crs_projection" &&
      edge.projectionArtifactAssetId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionArtifactAssetId"],
        message: "CRS projections require a typed projection-operation asset",
      });
    }
    if (
      edge.operationKind === "affine_similarity" &&
      edge.projectionArtifactAssetId !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionArtifactAssetId"],
        message: "affine operations cannot ambiguously include a CRS projection",
      });
    }
    const evidenceIds = [
      edge.transformArtifactAssetId,
      edge.residualReportAssetId,
      edge.projectionArtifactAssetId,
      edge.reviewerAttestationAssetId,
    ].filter((value): value is string => value !== null);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformArtifactAssetId"],
        message: "transform evidence references must be distinct",
      });
    }
  });

export const FoundryProvenanceEdgeSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    operationId: RuntimeManifestKeySchema,
    inputAssetIds: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    outputAssetId: RuntimeManifestKeySchema,
    operationVersion: z.string().trim().min(1).max(160),
    environmentDigest: RuntimeSha256Schema,
    createdAt: FoundryUtcInstantSchema,
  })
  .strict();

export const FoundryGeneratedRegionSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    outputAssetId: RuntimeManifestKeySchema,
    sourceAssetIds: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    maskAssetId: RuntimeManifestKeySchema,
    provenanceClass: z.enum(["generated_cinematic", "concept_imagination"]),
    modelName: z.string().trim().min(1).max(160),
    modelVersion: z.string().trim().min(1).max(160),
    checkpointSha256: RuntimeSha256Schema,
    promptOrConditionDigest: RuntimeSha256Schema,
    confidence: z.number().min(0).max(1),
    exportRestrictions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    truthModeDisclosure: z.string().trim().min(20).max(1_000),
  })
  .strict();

function addDuplicateIdIssue(
  values: readonly { id: string }[],
  path: string,
  ctx: z.RefinementCtx,
): void {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} IDs must be unique` });
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

function hasAssetParentCycle(
  assets: readonly { id: string; parentAssetIds: readonly string[] }[],
): boolean {
  const childrenByParent = new Map<string, string[]>();
  const remainingParents = new Map<string, number>();
  for (const asset of assets) {
    remainingParents.set(asset.id, asset.parentAssetIds.length);
    for (const parentId of asset.parentAssetIds) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(asset.id);
      childrenByParent.set(parentId, children);
    }
  }
  const queue = assets
    .filter((asset) => asset.parentAssetIds.length === 0)
    .map((asset) => asset.id);
  let visited = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (id === undefined) continue;
    visited += 1;
    for (const childId of childrenByParent.get(id) ?? []) {
      const next = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }
  return visited !== assets.length;
}

export const FoundryIngestManifestV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_INGEST_MANIFEST_V0),
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    createdBy: z.string().trim().min(1).max(160),
    sourceRoots: z.array(FoundrySourceRootSchema).min(1).max(100),
    coordinateFrames: z.array(FoundryCoordinateFrameSchema).max(10_000),
    transforms: z.array(FoundryTransformEdgeSchema).max(100_000),
    assets: z.array(FoundryInputAssetSchema).min(1).max(100_000),
    provenanceEdges: z.array(FoundryProvenanceEdgeSchema).max(200_000),
    generatedRegions: z.array(FoundryGeneratedRegionSchema).max(100_000),
    legalReviewState: z.enum(["not_reviewed", "requires_review", "approved", "blocked"]),
    sourceMutationPermitted: z.literal(false),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    addDuplicateIdIssue(manifest.sourceRoots, "sourceRoots", ctx);
    addDuplicateIdIssue(manifest.coordinateFrames, "coordinateFrames", ctx);
    addDuplicateIdIssue(manifest.transforms, "transforms", ctx);
    addDuplicateIdIssue(manifest.assets, "assets", ctx);
    addDuplicateIdIssue(manifest.provenanceEdges, "provenanceEdges", ctx);
    addDuplicateIdIssue(manifest.generatedRegions, "generatedRegions", ctx);

    const rootIds = new Set(manifest.sourceRoots.map((root) => root.id));
    const frameIds = new Set(manifest.coordinateFrames.map((frame) => frame.id));
    const framesById = new Map(manifest.coordinateFrames.map((frame) => [frame.id, frame]));
    const assetIds = new Set(manifest.assets.map((asset) => asset.id));
    const assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
    const sourceRootCaseSensitivity = new Map(
      manifest.sourceRoots.map((root) => [root.id, root.caseSensitivity]),
    );
    const assetLocators = manifest.assets.map(
      (asset) => {
        const caseInsensitive =
          sourceRootCaseSensitivity.get(asset.sourceRootId) === "insensitive";
        const comparablePath = caseInsensitive
          ? asset.relativePath.toLowerCase()
          : asset.relativePath;
        return `${asset.sourceRootId}\u0000${comparablePath}`;
      },
    );
    if (new Set(assetLocators).size !== assetLocators.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "a source root and relative path may be declared only once",
      });
    }

    for (const [index, frame] of manifest.coordinateFrames.entries()) {
      if (frame.provenanceAssetIds.some((id) => !assetIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinateFrames", index, "provenanceAssetIds"],
          message: "frame provenance must reference declared assets",
        });
      }
    }

    for (const [index, asset] of manifest.assets.entries()) {
      if (!rootIds.has(asset.sourceRootId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "sourceRootId"],
          message: "asset sourceRootId must reference a declared source root",
        });
      }
      if (asset.coordinateFrameId !== null && !frameIds.has(asset.coordinateFrameId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "coordinateFrameId"],
          message: "asset coordinateFrameId must reference a declared coordinate frame",
        });
      }
      for (const referenceId of [...asset.calibrationAssetIds, ...asset.parentAssetIds]) {
        if (!assetIds.has(referenceId) || referenceId === asset.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", index],
            message: "asset references must point to other declared assets",
          });
        }
      }
      if (
        new Set(asset.calibrationAssetIds).size !== asset.calibrationAssetIds.length ||
        new Set(asset.parentAssetIds).size !== asset.parentAssetIds.length
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index],
          message: "asset calibration and parent references must be unique",
        });
      }
    }

    for (const [index, transform] of manifest.transforms.entries()) {
      if (!frameIds.has(transform.sourceFrameId) || !frameIds.has(transform.targetFrameId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transforms", index],
          message: "transform endpoints must reference declared coordinate frames",
        });
      }
      if (transform.provenanceAssetIds.some((id) => !assetIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transforms", index, "provenanceAssetIds"],
          message: "transform provenance must reference declared assets",
        });
      }
      const evidenceIds = [
        transform.transformArtifactAssetId,
        transform.residualReportAssetId,
        transform.projectionArtifactAssetId,
        transform.reviewerAttestationAssetId,
      ].filter((value): value is string => value !== null);
      if (evidenceIds.some((id) => !assetIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transforms", index],
          message: "transform evidence must reference declared assets",
        });
      }
      const requiredEvidenceKinds: ReadonlyArray<
        [string | null, z.infer<typeof FoundryEvidenceKindSchema>]
      > = [
        [transform.transformArtifactAssetId, "transform_artifact"],
        [transform.residualReportAssetId, "residual_report"],
        [transform.projectionArtifactAssetId, "projection_operation"],
        [transform.reviewerAttestationAssetId, "reviewer_attestation"],
      ];
      for (const [assetId, evidenceKind] of requiredEvidenceKinds) {
        if (
          assetId !== null &&
          assetsById.get(assetId)?.evidenceKinds.includes(evidenceKind) !== true
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["transforms", index],
            message: `transform evidence asset must be typed ${evidenceKind}`,
          });
        }
      }
      const sourceFrame = framesById.get(transform.sourceFrameId);
      const targetFrame = framesById.get(transform.targetFrameId);
      if (
        transform.operationKind === "affine_similarity" &&
        (sourceFrame?.kind === "geodetic" || targetFrame?.kind === "geodetic")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transforms", index, "operationKind"],
          message: "geodetic conversion must be a separate CRS projection operation",
        });
      }
      const endpointKinds = new Set([sourceFrame?.kind, targetFrame?.kind]);
      if (
        transform.operationKind === "crs_projection" &&
        !(endpointKinds.has("geodetic") && endpointKinds.has("projected"))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transforms", index, "operationKind"],
          message: "CRS projection operations must connect geodetic and projected frames",
        });
      }
    }

    for (const [index, edge] of manifest.provenanceEdges.entries()) {
      if (!assetIds.has(edge.outputAssetId) || edge.inputAssetIds.some((id) => !assetIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenanceEdges", index],
          message: "provenance edge assets must be declared",
        });
      }
      if (edge.inputAssetIds.includes(edge.outputAssetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenanceEdges", index, "outputAssetId"],
          message: "a provenance operation cannot overwrite one of its input assets",
        });
      }
      if (new Set(edge.inputAssetIds).size !== edge.inputAssetIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenanceEdges", index, "inputAssetIds"],
          message: "provenance inputs must be unique",
        });
      }
    }

    const producers = new Map<
      string,
      { first: (typeof manifest.provenanceEdges)[number]; count: number }
    >();
    for (const edge of manifest.provenanceEdges) {
      const current = producers.get(edge.outputAssetId);
      producers.set(
        edge.outputAssetId,
        current === undefined ? { first: edge, count: 1 } : { ...current, count: current.count + 1 },
      );
    }
    if (hasAssetParentCycle(manifest.assets)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "asset parent lineage must be acyclic",
      });
    }
    for (const [index, asset] of manifest.assets.entries()) {
      const assetProducer = producers.get(asset.id);
      if ((assetProducer?.count ?? 0) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index],
          message: "an immutable asset may have at most one producing operation",
        });
      }
      if (asset.captureState === "derived" && assetProducer?.count !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "captureState"],
          message: "derived assets require exactly one producing provenance edge",
        });
      }
      if (asset.captureState === "raw_capture" && assetProducer !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "captureState"],
          message: "raw captures cannot have a producing provenance operation",
        });
      }
      if (assetProducer !== undefined && asset.captureState !== "derived") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "captureState"],
          message: "operation-produced assets must use the derived capture state",
        });
      }
      const producer = assetProducer?.first;
      if (producer !== undefined && !sameStringSet(asset.parentAssetIds, producer.inputAssetIds)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "parentAssetIds"],
          message: "asset parents must exactly match the producing operation inputs",
        });
      }
      if (
        (asset.provenanceClass === "generated_cinematic" ||
          asset.provenanceClass === "concept_imagination") &&
        asset.captureState !== "derived"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "captureState"],
          message: "generated assets must be declared as derived",
        });
      }
      const parentTruthfulness = asset.parentAssetIds
        .map((parentId) => assetsById.get(parentId))
        .filter((parent) => parent !== undefined)
        .map((parent) => FOUNDRY_PROVENANCE_TRUTHFULNESS[parent.provenanceClass]);
      if (
        parentTruthfulness.length !== 0 &&
        FOUNDRY_PROVENANCE_TRUTHFULNESS[asset.provenanceClass] >
          Math.min(...parentTruthfulness)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "provenanceClass"],
          message:
            "derived assets cannot claim a more truthful provenance class than their least truthful parent",
        });
      }
    }

    for (const [index, region] of manifest.generatedRegions.entries()) {
      const references = [region.outputAssetId, region.maskAssetId, ...region.sourceAssetIds];
      if (references.some((id) => !assetIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions", index],
          message: "generated-region assets must be declared",
        });
      }
      const output = assetsById.get(region.outputAssetId);
      const mask = assetsById.get(region.maskAssetId);
      if (output !== undefined && output.provenanceClass !== region.provenanceClass) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions", index, "provenanceClass"],
          message: "generated-region provenance must match its output asset",
        });
      }
      if (mask !== undefined && !mask.evidenceKinds.includes("mask")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions", index, "maskAssetId"],
          message: "generated-region masks must reference assets typed as masks",
        });
      }
      if (
        new Set(region.sourceAssetIds).size !== region.sourceAssetIds.length ||
        region.outputAssetId === region.maskAssetId ||
        region.sourceAssetIds.includes(region.outputAssetId) ||
        region.sourceAssetIds.includes(region.maskAssetId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions", index],
          message: "generated output, mask, and unique source assets must be distinct",
        });
      }
      if (
        output !== undefined &&
        ![...region.sourceAssetIds, region.maskAssetId].every((id) =>
          output.parentAssetIds.includes(id),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions", index],
          message: "generated region sources and mask must be declared output parents",
        });
      }
    }

    const generatedRegionCounts = new Map<string, number>();
    for (const region of manifest.generatedRegions) {
      generatedRegionCounts.set(
        region.outputAssetId,
        (generatedRegionCounts.get(region.outputAssetId) ?? 0) + 1,
      );
    }
    for (const [index, asset] of manifest.assets.entries()) {
      const generated =
        asset.provenanceClass === "generated_cinematic" ||
        asset.provenanceClass === "concept_imagination";
      if (generated && generatedRegionCounts.get(asset.id) === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index],
          message: "every generated asset requires at least one generated-region record",
        });
      }
    }

    const requiresLegalReview = manifest.assets.some(
      (asset) =>
        asset.rights.commercialUse !== "allowed" ||
        asset.rights.modelTrainingUse !== "allowed" ||
        asset.rights.redistribution !== "allowed",
    );
    if (requiresLegalReview && manifest.legalReviewState === "approved") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["legalReviewState"],
        message: "manifest cannot be approved while an asset has restricted, prohibited, or unknown rights",
      });
    }
    if (
      manifest.legalReviewState === "approved" &&
      manifest.assets.some(
        (asset) =>
          asset.rights.basis === "unknown" ||
          asset.rights.termsReviewedAt === null ||
          asset.rights.termsReference === null ||
          asset.accessState === "blocked_legal",
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["legalReviewState"],
        message: "approved manifests require a dated HTTPS rights record and no legally blocked asset",
      });
    }
  });
export type FoundryIngestManifestV0 = z.infer<typeof FoundryIngestManifestV0Schema>;

export function computeFoundryIngestManifestSha256(
  manifest: FoundryIngestManifestV0,
): string {
  const canonical = CanonicalJsonValueSchema.parse(manifest);
  const subject = `omnitwin.foundry.ingest-manifest.v0\n${stableCanonicalJson(canonical)}`;
  return `sha256:${sha256Hex(subject)}`;
}

export const FOUNDRY_QUALITY_DIMENSIONS = [
  "geometry",
  "appearance",
  "runtime",
  "semantics",
  "provenance",
] as const;
export const FoundryQualityDimensionSchema = z.enum(FOUNDRY_QUALITY_DIMENSIONS);

export const FOUNDRY_QUALITY_PROFILES = [
  "research",
  "internal_visual",
  "planning",
  "public_release",
  "premium_headset",
  "custom",
] as const;
export const FoundryQualityProfileSchema = z.enum(FOUNDRY_QUALITY_PROFILES);

export const FoundryQualityRequirementSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    dimension: FoundryQualityDimensionSchema,
    metric: z.string().trim().min(1).max(160),
    comparison: z.enum(["lte", "gte", "eq"]),
    threshold: z.number().finite(),
    unit: z.string().trim().min(1).max(80),
    required: z.boolean(),
    scope: z.string().trim().min(1).max(200),
    evidenceRequired: z.array(FoundryEvidenceKindSchema).min(1).max(12),
  })
  .strict();

export const FoundryQualityContractV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_QUALITY_CONTRACT_V0),
    id: RuntimeManifestKeySchema,
    profile: FoundryQualityProfileSchema,
    profileDefinitionId: RuntimeManifestKeySchema,
    profileDefinitionSha256: RuntimeSha256Schema,
    purpose: z.string().trim().min(20).max(1_000),
    requirements: z.array(FoundryQualityRequirementSchema).min(1).max(1_000),
    requiredHumanReviews: z.array(z.string().trim().min(1).max(160)).max(50),
    generatedContentPolicy: z.enum(["forbidden", "separate_derivative_only", "allowed_with_masks"]),
  })
  .strict()
  .superRefine((contract, ctx) => {
    addDuplicateIdIssue(contract.requirements, "requirements", ctx);
    if (new Set(contract.requiredHumanReviews).size !== contract.requiredHumanReviews.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredHumanReviews"],
        message: "required human review kinds must be unique",
      });
    }
    const requiredDimensionsByProfile: Partial<
      Record<typeof contract.profile, readonly (typeof FOUNDRY_QUALITY_DIMENSIONS)[number][]>
    > = {
      internal_visual: ["appearance", "runtime", "provenance"],
      planning: ["geometry", "provenance"],
      public_release: FOUNDRY_QUALITY_DIMENSIONS,
      premium_headset: FOUNDRY_QUALITY_DIMENSIONS,
    };
    const requiredDimensions = requiredDimensionsByProfile[contract.profile] ?? [];
    const declaredRequiredDimensions = new Set(
      contract.requirements
        .filter((requirement) => requirement.required)
        .map((requirement) => requirement.dimension),
    );
    if (requiredDimensions.some((dimension) => !declaredRequiredDimensions.has(dimension))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirements"],
        message: "quality profile omits a mandatory required dimension",
      });
    }
    if (contract.profile !== "research" && contract.requiredHumanReviews.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredHumanReviews"],
        message: "non-research quality profiles require at least one human review",
      });
    }
  });
export type FoundryQualityContractV0 = z.infer<typeof FoundryQualityContractV0Schema>;

export const FoundryQualityMeasurementSchema = z
  .object({
    requirementId: RuntimeManifestKeySchema,
    value: z.number().finite().nullable(),
    status: z.enum(["passed", "failed", "not_measured", "not_applicable"]),
    evidenceAssetIds: z.array(RuntimeManifestKeySchema).max(1_000),
    evidenceKinds: z.array(FoundryEvidenceKindSchema).max(12),
    caveat: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((measurement, ctx) => {
    if ((measurement.status === "passed" || measurement.status === "failed") !== (measurement.value !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "passed or failed measurements require a value; other statuses require null",
      });
    }
    if (
      (measurement.status === "passed" || measurement.status === "failed") &&
      (measurement.evidenceAssetIds.length === 0 || measurement.evidenceKinds.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceAssetIds"],
        message: "measured pass or failure requires evidence assets and evidence kinds",
      });
    }
    if (
      new Set(measurement.evidenceAssetIds).size !== measurement.evidenceAssetIds.length ||
      new Set(measurement.evidenceKinds).size !== measurement.evidenceKinds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceKinds"],
        message: "measurement evidence references and kinds must be unique",
      });
    }
    if (
      (measurement.status === "not_measured" || measurement.status === "not_applicable") &&
      measurement.caveat === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caveat"],
        message: "unmeasured or inapplicable requirements need a caveat",
      });
    }
  });

export const FoundryQualityHumanReviewSchema = z
  .object({
    reviewKind: z.string().trim().min(1).max(160),
    reviewerId: z.string().trim().min(1).max(160),
    reviewerAttestationAssetId: RuntimeManifestKeySchema,
    decision: z.enum(["approved", "rejected"]),
    reviewedAt: FoundryUtcInstantSchema,
    evidenceAssetIds: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    note: z.string().trim().min(20).max(2_000),
  })
  .strict();

export const FoundryQualityReportV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_QUALITY_REPORT_V0),
    id: RuntimeManifestKeySchema,
    contract: FoundryQualityContractV0Schema,
    subjectAssetIds: z.array(RuntimeManifestKeySchema).min(1).max(10_000),
    measurements: z.array(FoundryQualityMeasurementSchema).max(1_000),
    humanReviews: z.array(FoundryQualityHumanReviewSchema).max(100),
    outcome: z.enum(["passed", "failed", "requires_review", "blocked"]),
    evaluatedAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((report, ctx) => {
    const requirements = new Map(report.contract.requirements.map((item) => [item.id, item]));
    const measurementIds = report.measurements.map((item) => item.requirementId);
    if (new Set(report.subjectAssetIds).size !== report.subjectAssetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subjectAssetIds"],
        message: "quality report subject assets must be unique",
      });
    }
    if (new Set(measurementIds).size !== measurementIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measurements"],
        message: "each quality requirement may be measured at most once",
      });
    }
    for (const [index, measurement] of report.measurements.entries()) {
      const requirement = requirements.get(measurement.requirementId);
      if (requirement === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["measurements", index, "requirementId"],
          message: "measurement must reference a contract requirement",
        });
        continue;
      }
      if (measurement.value !== null) {
        const actuallyPassed =
          requirement.comparison === "lte"
            ? measurement.value <= requirement.threshold
            : requirement.comparison === "gte"
              ? measurement.value >= requirement.threshold
              : measurement.value === requirement.threshold;
        if ((measurement.status === "passed") !== actuallyPassed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["measurements", index, "status"],
            message: "measurement status does not match its threshold comparison",
          });
        }
      }
      const suppliedEvidenceKinds = new Set(measurement.evidenceKinds);
      if (
        (measurement.status === "passed" || measurement.status === "failed") &&
        requirement.evidenceRequired.some((kind) => !suppliedEvidenceKinds.has(kind))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["measurements", index, "evidenceKinds"],
          message: "measurement must supply every evidence kind required by the contract",
        });
      }
    }
    const evaluatedAt = Date.parse(report.evaluatedAt);
    for (const [index, review] of report.humanReviews.entries()) {
      if (Date.parse(review.reviewedAt) > evaluatedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["humanReviews", index, "reviewedAt"],
          message: "human review cannot postdate report evaluation",
        });
      }
    }
    if (report.outcome === "passed") {
      const byId = new Map(report.measurements.map((item) => [item.requirementId, item]));
      if (report.contract.requirements.some((item) => item.required && byId.get(item.id)?.status !== "passed")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome"],
          message: "passed reports require every required metric to pass",
        });
      }
      const reviewKinds = new Set(
        report.humanReviews
          .filter((review) => review.decision === "approved")
          .map((review) => review.reviewKind),
      );
      if (report.contract.requiredHumanReviews.some((kind) => !reviewKinds.has(kind))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome"],
          message: "passed reports require every contract human review",
        });
      }
      if (report.humanReviews.some((review) => review.decision === "rejected")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["outcome"],
          message: "a passed report cannot contain a rejected human review",
        });
      }
    }
  });
export type FoundryQualityReportV0 = z.infer<typeof FoundryQualityReportV0Schema>;

export const FoundryQualityEvidenceCatalogSchema = z
  .object({
    assets: z
      .array(
        z
          .object({
            id: RuntimeManifestKeySchema,
            provenanceClass: FoundryProvenanceClassSchema,
            evidenceKinds: z.array(FoundryEvidenceKindSchema).max(12),
          })
          .strict(),
      )
      .max(1_000_000),
    generatedRegionOutputAssetIds: z.array(RuntimeManifestKeySchema).max(100_000),
    profileDefinitions: z
      .array(
        z
          .object({
            profile: FoundryQualityProfileSchema,
            definitionId: RuntimeManifestKeySchema,
            definitionSha256: RuntimeSha256Schema,
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    addDuplicateIdIssue(catalog.assets, "assets", ctx);
    for (const [index, asset] of catalog.assets.entries()) {
      if (new Set(asset.evidenceKinds).size !== asset.evidenceKinds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "evidenceKinds"],
          message: "catalog evidence kinds must be unique",
        });
      }
    }
    if (
      new Set(catalog.generatedRegionOutputAssetIds).size !==
      catalog.generatedRegionOutputAssetIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generatedRegionOutputAssetIds"],
        message: "generated-region output IDs must be unique",
      });
    }
    const profileKeys = catalog.profileDefinitions.map(
      (definition) => `${definition.profile}\u0000${definition.definitionId}`,
    );
    if (new Set(profileKeys).size !== profileKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profileDefinitions"],
        message: "profile registry entries must be unique by profile and definition ID",
      });
    }
  });

export type FoundryQualityEvidenceDecision =
  | { valid: true }
  | { valid: false; issues: string[] };

/** Resolves quality evidence and generated-content policy against a trusted asset catalogue. */
export function validateFoundryQualityEvidence(
  reportInput: unknown,
  catalogInput: unknown,
): FoundryQualityEvidenceDecision {
  const reportResult = FoundryQualityReportV0Schema.safeParse(reportInput);
  const catalogResult = FoundryQualityEvidenceCatalogSchema.safeParse(catalogInput);
  if (!reportResult.success || !catalogResult.success) {
    return { valid: false, issues: ["invalid_report_or_catalog"] };
  }
  const report = reportResult.data;
  const catalog = catalogResult.data;
  const assets = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const generatedRegionOutputs = new Set(catalog.generatedRegionOutputAssetIds);
  const issues = new Set<string>();
  if (
    !catalog.profileDefinitions.some(
      (definition) =>
        definition.profile === report.contract.profile &&
        definition.definitionId === report.contract.profileDefinitionId &&
        definition.definitionSha256 === report.contract.profileDefinitionSha256,
    )
  ) {
    issues.add("quality_profile_definition_unresolved");
  }
  const requireAsset = (id: string): void => {
    if (!assets.has(id)) issues.add(`missing_asset:${id}`);
  };
  for (const id of report.subjectAssetIds) requireAsset(id);
  for (const measurement of report.measurements) {
    for (const id of measurement.evidenceAssetIds) requireAsset(id);
    for (const evidenceKind of measurement.evidenceKinds) {
      if (
        !measurement.evidenceAssetIds.some((id) =>
          assets.get(id)?.evidenceKinds.includes(evidenceKind) === true,
        )
      ) {
        issues.add(`${measurement.requirementId}:unresolved_evidence_kind:${evidenceKind}`);
      }
    }
  }
  for (const review of report.humanReviews) {
    requireAsset(review.reviewerAttestationAssetId);
    for (const id of review.evidenceAssetIds) requireAsset(id);
    if (
      assets
        .get(review.reviewerAttestationAssetId)
        ?.evidenceKinds.includes("reviewer_attestation") !== true
    ) {
      issues.add(`${review.reviewKind}:invalid_reviewer_attestation`);
    }
    if (
      review.reviewKind === "fixed_view" &&
      !review.evidenceAssetIds.some(
        (id) => assets.get(id)?.evidenceKinds.includes("fixed_view") === true,
      )
    ) {
      issues.add("fixed_view:typed_evidence_required");
    }
  }
  const isGeneratedClass = (id: string): boolean => {
    const provenance = assets.get(id)?.provenanceClass;
    return provenance === "generated_cinematic" || provenance === "concept_imagination";
  };
  // Generated material may be a review SUBJECT under a permitting policy, but
  // it can never attest: a model-generated reviewer attestation is
  // self-approval regardless of policy.
  for (const review of report.humanReviews) {
    if (isGeneratedClass(review.reviewerAttestationAssetId)) {
      issues.add(`${review.reviewKind}:generated_reviewer_attestation_forbidden`);
    }
  }
  if (report.contract.generatedContentPolicy === "forbidden") {
    for (const measurement of report.measurements) {
      for (const id of measurement.evidenceAssetIds) {
        if (isGeneratedClass(id)) {
          issues.add(`${measurement.requirementId}:generated_evidence_forbidden:${id}`);
        }
      }
    }
    for (const review of report.humanReviews) {
      for (const id of review.evidenceAssetIds) {
        if (isGeneratedClass(id)) {
          issues.add(`${review.reviewKind}:generated_evidence_forbidden:${id}`);
        }
      }
    }
  }
  const generatedSubjects = report.subjectAssetIds.filter(isGeneratedClass);
  if (
    report.contract.generatedContentPolicy === "forbidden" &&
    generatedSubjects.length !== 0
  ) {
    issues.add("generated_content_forbidden");
  }
  if (
    report.contract.generatedContentPolicy === "separate_derivative_only" &&
    generatedSubjects.length !== 0 &&
    generatedSubjects.length !== report.subjectAssetIds.length
  ) {
    issues.add("generated_and_captured_subjects_must_be_reported_separately");
  }
  if (
    report.contract.generatedContentPolicy === "allowed_with_masks" &&
    generatedSubjects.some((id) => !generatedRegionOutputs.has(id))
  ) {
    issues.add("generated_subject_missing_region_mask_provenance");
  }
  return issues.size === 0
    ? { valid: true }
    : { valid: false, issues: [...issues].sort() };
}

export const FOUNDRY_PROVIDER_KINDS = [
  "local_cpu",
  "local_cuda",
  "runpod",
  "aws",
  "azure",
  "gcp",
  "self_hosted_cluster",
  "other",
] as const;
export const FoundryProviderKindSchema = z.enum(FOUNDRY_PROVIDER_KINDS);
export type FoundryProviderKind = z.infer<typeof FoundryProviderKindSchema>;

export const FoundryRightsPurposeSchema = z.enum([
  "commercial_internal_use",
  "model_training",
  "redistribution",
  "public_release",
]);

export const FoundryJobStageSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: z.enum([
      "inspect",
      "register",
      "align",
      "geometry",
      "appearance",
      "semantics",
      "enhance",
      "qa",
      "package",
    ]),
    dependsOn: z.array(RuntimeManifestKeySchema).max(100),
    containerImage: z.string().max(512).regex(SAFE_CONTAINER_IMAGE),
    command: z.array(FoundryCommandArgumentSchema).min(1).max(1_000),
    inputAssetIds: z.array(RuntimeManifestKeySchema).max(100_000),
    outputNames: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    rightsPurposes: z.array(FoundryRightsPurposeSchema).min(1).max(4),
    cpuCores: z.number().int().positive().max(1_024),
    ramGiB: z.number().int().positive().max(100_000),
    gpuCount: z.number().int().nonnegative().max(128),
    minimumGpuVramGiB: z.number().int().nonnegative().max(1_000),
    scratchGiB: z.number().int().positive().max(1_000_000),
    networkAccess: z.enum(["none", "object_storage_only", "restricted"]),
    checkpoint: z.enum(["none", "stage_boundary", "periodic"]),
    resumable: z.boolean(),
  })
  .strict()
  .superRefine((stage, ctx) => {
    if (stage.gpuCount === 0 && stage.minimumGpuVramGiB !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumGpuVramGiB"],
        message: "CPU stages cannot request GPU VRAM",
      });
    }
    if (stage.resumable && stage.checkpoint === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpoint"],
        message: "resumable stages require checkpoints",
      });
    }
    if (
      new Set(stage.dependsOn).size !== stage.dependsOn.length ||
      new Set(stage.inputAssetIds).size !== stage.inputAssetIds.length ||
      new Set(stage.outputNames).size !== stage.outputNames.length ||
      new Set(stage.rightsPurposes).size !== stage.rightsPurposes.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stage dependencies, inputs, outputs, and rights purposes must not contain duplicates",
      });
    }
  });

function hasStageDependencyCycle(
  stages: readonly { id: string; dependsOn: readonly string[] }[],
): boolean {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    const stage = byId.get(id);
    if (stage === undefined) return false;
    visiting.add(id);
    if (stage.dependsOn.some((dependencyId) => visit(dependencyId))) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return stages.some((stage) => visit(stage.id));
}

export const FoundryComputeApprovalSchema = z
  .object({
    approvalId: RuntimeManifestKeySchema,
    jobSubjectSha256: RuntimeSha256Schema,
    jobId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    approvedBy: FoundryCanonicalActorSchema,
    approvedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
    maximumCostUsd: z.number().finite().positive(),
  })
  .strict()
  .superRefine((approval, ctx) => {
    if (Date.parse(approval.approvedAt) >= Date.parse(approval.expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "compute approval must expire after it is granted",
      });
    }
  });

export const FoundryExecutionConfirmationSchema = z
  .object({
    confirmationId: RuntimeManifestKeySchema,
    jobSubjectSha256: RuntimeSha256Schema,
    jobId: RuntimeManifestKeySchema,
    confirmedBy: FoundryCanonicalActorSchema,
    confirmedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((confirmation, ctx) => {
    if (Date.parse(confirmation.confirmedAt) >= Date.parse(confirmation.expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "execution confirmation must expire after it is recorded",
      });
    }
  });

export const FoundryJobSpecV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_JOB_SPEC_V0),
    id: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    ingestManifestSha256: RuntimeSha256Schema,
    executionIntent: z.enum(["plan_only", "execute"]),
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    stages: z.array(FoundryJobStageSchema).min(1).max(1_000),
    objectStorageProfile: RuntimeManifestKeySchema.nullable(),
    sourceMountMode: z.literal("read_only"),
    outputPrefix: FoundryRelativePathSchema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    budgetCapUsd: z.number().finite().nonnegative(),
    killSwitchEnabled: z.literal(true),
    computeApprovalId: RuntimeManifestKeySchema.nullable(),
    createdAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((job, ctx) => {
    addDuplicateIdIssue(job.stages, "stages", ctx);
    const stageIds = new Set(job.stages.map((stage) => stage.id));
    for (const [index, stage] of job.stages.entries()) {
      if (stage.dependsOn.includes(stage.id) || stage.dependsOn.some((id) => !stageIds.has(id))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "dependsOn"],
          message: "stage dependencies must reference other declared stages",
        });
      }
    }
    if (hasStageDependencyCycle(job.stages)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: "job stage dependencies must be acyclic",
      });
    }
    if (job.estimatedCostUsd > job.budgetCapUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["estimatedCostUsd"],
        message: "estimated cost must not exceed the budget cap",
      });
    }
    if (foundryUsdNumberToMicroUsd(job.estimatedCostUsd) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["estimatedCostUsd"],
        message: "estimated cost must be exactly representable as integer micro-USD",
      });
    }
    if (foundryUsdNumberToMicroUsd(job.budgetCapUsd) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetCapUsd"],
        message: "budget cap must be exactly representable as integer micro-USD",
      });
    }
    const remote = !["local_cpu", "local_cuda"].includes(job.providerKind);
    if (job.executionIntent === "execute" && remote) {
      if (job.computeApprovalId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["computeApprovalId"],
          message: "remote execution requires a trusted compute-approval reference",
        });
      }
    }
    if (job.executionIntent === "execute" && !remote && job.computeApprovalId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["computeApprovalId"],
        message: "local execution uses explicit operator confirmation, not a remote approval",
      });
    }
    if (job.executionIntent === "plan_only" && job.computeApprovalId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["computeApprovalId"],
        message: "plan-only jobs do not consume an execution approval",
      });
    }
    if (
      job.executionIntent === "execute" &&
      !remote &&
      job.stages.some((stage) => stage.rightsPurposes.includes("model_training"))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerKind"],
        message: "D-016 requires model-training execution to use an approved remote provider",
      });
    }
  });
export type FoundryJobSpecV0 = z.infer<typeof FoundryJobSpecV0Schema>;
export type FoundryComputeApproval = z.infer<typeof FoundryComputeApprovalSchema>;
export type FoundryExecutionConfirmation = z.infer<
  typeof FoundryExecutionConfirmationSchema
>;

export type FoundryJobRightsDecision =
  | { allowed: true }
  | { allowed: false; blockers: string[] };

export type FoundryTrustedRightsApprovalDecision =
  | {
      allowed: true;
      job: FoundryJobSpecV0;
      rightsApproval: FoundryRightsApproval;
    }
  | { allowed: false; reason: string };

export const FoundryRightsApprovalSchema = z
  .object({
    jobSubjectSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    policyVersion: RuntimeManifestKeySchema,
    policyDefinitionSha256: RuntimeSha256Schema,
    policyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    decision: z.literal("allowed"),
    decidedBy: FoundryCanonicalActorSchema,
    decidedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((approval, ctx) => {
    if (Date.parse(approval.decidedAt) >= Date.parse(approval.expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "rights approval must expire after the decision",
      });
    }
  });
export type FoundryRightsApproval = z.infer<typeof FoundryRightsApprovalSchema>;

export const FOUNDRY_RIGHTS_POLICY_DEFINITION_V0 =
  "omnitwin.foundry.rights-policy-definition.v0";

export const FoundryRightsPolicyDefinitionV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RIGHTS_POLICY_DEFINITION_V0),
    policyVersion: RuntimeManifestKeySchema,
    policyDefinitionSha256: RuntimeSha256Schema,
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    effectiveAt: FoundryUtcInstantSchema,
    revokedAt: FoundryUtcInstantSchema.nullable(),
    maximumApprovalTtlSeconds: z.number().int().positive().max(31_536_000),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (
      policy.revokedAt !== null &&
      Date.parse(policy.revokedAt) <= Date.parse(policy.effectiveAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["revokedAt"],
        message: "rights-policy revocation must follow its effective instant",
      });
    }
  });
export type FoundryRightsPolicyDefinitionV0 = z.infer<
  typeof FoundryRightsPolicyDefinitionV0Schema
>;

/**
 * Validates the trusted, time-bounded rights decision for one exact JobSpec.
 * This is deliberately pure so durable admission can reuse the same gate
 * without consuming an execution capability.
 */
export function validateFoundryTrustedRightsApproval(
  jobInput: unknown,
  approvalInput: unknown,
  nowInput: Date,
  trustedPolicyInput: unknown,
): FoundryTrustedRightsApprovalDecision {
  const jobResult = FoundryJobSpecV0Schema.safeParse(jobInput);
  if (!jobResult.success) return { allowed: false, reason: "invalid_job_spec" };
  const now = nowInput.getTime();
  if (!Number.isFinite(now)) return { allowed: false, reason: "invalid_dispatch_time" };
  const job = jobResult.data;
  if (Date.parse(job.createdAt) > now) {
    return { allowed: false, reason: "job_not_yet_valid" };
  }
  if (approvalInput === null) {
    return { allowed: false, reason: "rights_approval_required" };
  }
  const policyResult = FoundryRightsPolicyDefinitionV0Schema.safeParse(
    trustedPolicyInput,
  );
  if (!policyResult.success) {
    return { allowed: false, reason: "rights_policy_untrusted" };
  }
  const policy = policyResult.data;
  if (
    Date.parse(policy.effectiveAt) > now ||
    (policy.revokedAt !== null && Date.parse(policy.revokedAt) <= now)
  ) {
    return { allowed: false, reason: "rights_policy_inactive" };
  }
  const rightsResult = FoundryRightsApprovalSchema.safeParse(approvalInput);
  if (!rightsResult.success) {
    return { allowed: false, reason: "rights_approval_untrusted" };
  }
  const rightsApproval = rightsResult.data;
  if (
    rightsApproval.policyVersion !== policy.policyVersion ||
    rightsApproval.policyDefinitionSha256 !== policy.policyDefinitionSha256 ||
    rightsApproval.policyGeneration !== policy.generation
  ) {
    return { allowed: false, reason: "rights_policy_subject_mismatch" };
  }
  if (
    rightsApproval.jobSubjectSha256 !== computeFoundryJobApprovalSubjectSha256(job) ||
    rightsApproval.ingestManifestSha256 !== job.ingestManifestSha256
  ) {
    return { allowed: false, reason: "rights_approval_subject_mismatch" };
  }
  const rightsDecidedAt = Date.parse(rightsApproval.decidedAt);
  if (rightsDecidedAt < Date.parse(job.createdAt)) {
    return { allowed: false, reason: "rights_approval_predates_job" };
  }
  if (rightsDecidedAt > now) {
    return { allowed: false, reason: "rights_approval_not_yet_valid" };
  }
  if (Date.parse(rightsApproval.expiresAt) <= now) {
    return { allowed: false, reason: "rights_approval_expired" };
  }
  if (
    Date.parse(rightsApproval.expiresAt) - rightsDecidedAt >
    policy.maximumApprovalTtlSeconds * 1_000
  ) {
    return { allowed: false, reason: "rights_approval_ttl_exceeds_policy" };
  }
  return { allowed: true, job, rightsApproval };
}

/** Applies stage-specific purposes to trusted ingest rights; global approval remains all-purpose. */
export function validateFoundryJobRights(
  jobInput: unknown,
  manifestInput: unknown,
): FoundryJobRightsDecision {
  const jobResult = FoundryJobSpecV0Schema.safeParse(jobInput);
  const manifestResult = FoundryIngestManifestV0Schema.safeParse(manifestInput);
  if (!jobResult.success || !manifestResult.success) {
    return { allowed: false, blockers: ["invalid_job_or_manifest"] };
  }
  if (
    jobResult.data.ingestManifestSha256 !==
    computeFoundryIngestManifestSha256(manifestResult.data)
  ) {
    return { allowed: false, blockers: ["ingest_manifest_digest_mismatch"] };
  }
  if (manifestResult.data.legalReviewState === "blocked") {
    return { allowed: false, blockers: ["manifest_legal_review_blocked"] };
  }
  const assets = new Map(manifestResult.data.assets.map((asset) => [asset.id, asset]));
  const stagesById = new Map(jobResult.data.stages.map((stage) => [stage.id, stage]));
  // A stage consumes its declared inputs plus, transitively, every input of
  // the stages it depends on: consuming an upstream stage's outputs cannot
  // shed the rights obligations of that stage's sources. Stage plans are
  // schema-guaranteed acyclic before this walk runs.
  const effectiveInputs = new Map<string, ReadonlySet<string>>();
  const collectEffectiveInputs = (stageId: string): ReadonlySet<string> => {
    const memoized = effectiveInputs.get(stageId);
    if (memoized !== undefined) return memoized;
    const stage = stagesById.get(stageId);
    if (stage === undefined) return new Set();
    const collected = new Set(stage.inputAssetIds);
    for (const dependencyId of stage.dependsOn) {
      for (const assetId of collectEffectiveInputs(dependencyId)) {
        collected.add(assetId);
      }
    }
    effectiveInputs.set(stageId, collected);
    return collected;
  };
  const blockers = new Set<string>();
  for (const stage of jobResult.data.stages) {
    for (const assetId of collectEffectiveInputs(stage.id)) {
      const asset = assets.get(assetId);
      if (asset === undefined) {
        blockers.add(`${stage.id}:${assetId}:missing_asset`);
        continue;
      }
      if (
        asset.accessState === "blocked_legal" ||
        asset.rights.basis === "unknown" ||
        asset.rights.termsReviewedAt === null ||
        asset.rights.termsReference === null
      ) {
        blockers.add(`${stage.id}:${assetId}:rights_record_incomplete`);
      }
      if (asset.rights.commercialUse !== "allowed") {
        blockers.add(`${stage.id}:${assetId}:commercial_use_not_allowed`);
      }
      for (const purpose of stage.rightsPurposes) {
        if (
          purpose === "model_training" &&
          asset.rights.modelTrainingUse !== "allowed"
        ) {
          blockers.add(`${stage.id}:${assetId}:model_training_not_allowed`);
        }
        if (
          (purpose === "redistribution" || purpose === "public_release") &&
          asset.rights.redistribution !== "allowed"
        ) {
          blockers.add(`${stage.id}:${assetId}:redistribution_not_allowed`);
        }
      }
    }
  }
  return blockers.size === 0
    ? { allowed: true }
    : { allowed: false, blockers: [...blockers].sort() };
}

export function computeFoundryJobApprovalSubjectSha256(job: FoundryJobSpecV0): string {
  const canonical = CanonicalJsonValueSchema.parse(job);
  const subject = `omnitwin.foundry.job-approval-subject.v0\n${stableCanonicalJson(canonical)}`;
  return `sha256:${sha256Hex(subject)}`;
}

export function computeFoundryJobSpecSha256(job: FoundryJobSpecV0): string {
  const canonical = CanonicalJsonValueSchema.parse(job);
  const subject = `omnitwin.foundry.job-spec.v0\n${stableCanonicalJson(canonical)}`;
  return `sha256:${sha256Hex(subject)}`;
}

export type FoundryDispatchDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export type FoundryDispatchEvaluation =
  | {
      allowed: true;
      job: FoundryJobSpecV0;
      confirmation: FoundryExecutionConfirmation;
      rightsApproval: FoundryRightsApproval;
      computeApproval: FoundryComputeApproval | null;
    }
  | { allowed: false; reason: string };

export interface FoundryDispatchEvaluationContext {
  readonly now: Date;
  /** Must be a fresh, single-use capability from the trusted control plane. */
  readonly trustedConfirmation: FoundryExecutionConfirmation | null;
  /** Must come from the control plane's trusted approval registry. */
  readonly trustedApproval: FoundryComputeApproval | null;
  /** Must come from a trusted, purpose-aware rights-policy decision. */
  readonly trustedRightsApproval: FoundryRightsApproval | null;
  /** Exact active, non-revoked policy definition used by the rights decision. */
  readonly trustedRightsPolicy: FoundryRightsPolicyDefinitionV0 | null;
}

export interface FoundryDispatchContext extends FoundryDispatchEvaluationContext {
  /** Atomically consumes the confirmation ID; false means missing or already consumed. */
  readonly consumeExecutionConfirmation: (confirmationId: string) => boolean;
}

/**
 * Pure dispatch prerequisite evaluation. It never consumes a capability or
 * performs I/O, so a durable control plane can run it inside a transaction and
 * couple the winning confirmation consume to its attempt insert.
 */
export function evaluateFoundryJobDispatch(
  input: unknown,
  context: FoundryDispatchEvaluationContext,
): FoundryDispatchEvaluation {
  const parsed = FoundryJobSpecV0Schema.safeParse(input);
  if (!parsed.success) return { allowed: false, reason: "invalid_job_spec" };
  const now = context.now.getTime();
  if (!Number.isFinite(now)) return { allowed: false, reason: "invalid_dispatch_time" };
  const job = parsed.data;
  if (job.executionIntent !== "execute") return { allowed: false, reason: "plan_only" };
  if (Date.parse(job.createdAt) > now) return { allowed: false, reason: "job_not_yet_valid" };
  if (["local_cpu", "local_cuda"].includes(job.providerKind)) {
    return {
      allowed: false,
      reason: "local_execution_requires_durable_trusted_worker_profile",
    };
  }
  const trustedConfirmation = context.trustedConfirmation;
  if (trustedConfirmation === null) {
    return { allowed: false, reason: "operator_confirmation_required" };
  }
  const confirmationResult = FoundryExecutionConfirmationSchema.safeParse(
    trustedConfirmation,
  );
  if (!confirmationResult.success) {
    return { allowed: false, reason: "operator_confirmation_untrusted" };
  }
  const confirmation = confirmationResult.data;
  if (
    confirmation.jobId !== job.id ||
    confirmation.jobSubjectSha256 !== computeFoundryJobApprovalSubjectSha256(job)
  ) {
    return { allowed: false, reason: "operator_confirmation_subject_mismatch" };
  }
  const confirmedAt = Date.parse(confirmation.confirmedAt);
  if (confirmedAt < Date.parse(job.createdAt)) {
    return { allowed: false, reason: "operator_confirmation_predates_job" };
  }
  if (confirmedAt > now) {
    return { allowed: false, reason: "operator_confirmation_not_yet_valid" };
  }
  if (Date.parse(confirmation.expiresAt) <= now) {
    return { allowed: false, reason: "operator_confirmation_expired" };
  }
  const rightsDecision = validateFoundryTrustedRightsApproval(
    job,
    context.trustedRightsApproval,
    context.now,
    context.trustedRightsPolicy,
  );
  if (!rightsDecision.allowed) return rightsDecision;
  const rightsApproval = rightsDecision.rightsApproval;
  const remote = !["local_cpu", "local_cuda"].includes(job.providerKind);
  let computeApproval: FoundryComputeApproval | null = null;
  if (remote) {
    const trustedApproval = context.trustedApproval;
    if (job.computeApprovalId === null || trustedApproval === null) {
      return { allowed: false, reason: "approval_required" };
    }
    const approvalResult = FoundryComputeApprovalSchema.safeParse(trustedApproval);
    if (!approvalResult.success) return { allowed: false, reason: "approval_untrusted" };
    const approval = approvalResult.data;
    if (
      approval.approvalId !== job.computeApprovalId ||
      approval.jobId !== job.id ||
      approval.projectId !== job.projectId ||
      approval.providerKind !== job.providerKind ||
      approval.providerAdapterId !== job.providerAdapterId
    ) {
      return { allowed: false, reason: "approval_subject_mismatch" };
    }
    if (approval.jobSubjectSha256 !== computeFoundryJobApprovalSubjectSha256(job)) {
      return { allowed: false, reason: "approval_subject_mismatch" };
    }
    if (job.budgetCapUsd > approval.maximumCostUsd) {
      return { allowed: false, reason: "budget_exceeds_approval" };
    }
    const approvedAt = Date.parse(approval.approvedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    if (approvedAt < Date.parse(job.createdAt)) {
      return { allowed: false, reason: "approval_predates_job" };
    }
    if (approvedAt > now) {
      return { allowed: false, reason: "approval_not_yet_valid" };
    }
    if (expiresAt <= now) {
      return { allowed: false, reason: "approval_expired" };
    }
    computeApproval = approval;
  }
  return {
    allowed: true,
    job,
    confirmation,
    rightsApproval,
    computeApproval,
  };
}

/**
 * Backward-compatible in-memory dispatch gate. Durable callers should use
 * evaluateFoundryJobDispatch and consume the confirmation in the same database
 * transaction that records the admitted attempt.
 */
export function decideFoundryJobDispatch(
  input: unknown,
  context: FoundryDispatchContext,
): FoundryDispatchDecision {
  const evaluation = evaluateFoundryJobDispatch(input, context);
  if (!evaluation.allowed) return evaluation;
  try {
    if (!context.consumeExecutionConfirmation(evaluation.confirmation.confirmationId)) {
      return { allowed: false, reason: "operator_confirmation_already_consumed" };
    }
  } catch {
    return { allowed: false, reason: "operator_confirmation_consume_failed" };
  }
  return { allowed: true };
}

export interface FoundryProviderAdapter {
  readonly id: string;
  readonly providerKind: FoundryProviderKind;
  plan(job: FoundryJobSpecV0): Promise<FoundryProviderPlan>;
}

export const FoundryProviderStagePlanSchema = z
  .object({
    stageId: RuntimeManifestKeySchema,
    executionReference: z.string().trim().min(1).max(2_048),
  })
  .strict();

export const FoundryProviderPlanSchema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    estimatedCostUsd: z.number().finite().nonnegative(),
    stagePlans: z.array(FoundryProviderStagePlanSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const stageIds = plan.stagePlans.map((stage) => stage.stageId);
    if (new Set(stageIds).size !== stageIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stagePlans"],
        message: "provider stage plans must be unique",
      });
    }
  });
export type FoundryProviderPlan = z.infer<typeof FoundryProviderPlanSchema>;

export type FoundryProviderPlanDecision =
  | { valid: true }
  | { valid: false; reason: string };

export function validateFoundryProviderPlan(
  jobInput: unknown,
  planInput: unknown,
): FoundryProviderPlanDecision {
  const jobResult = FoundryJobSpecV0Schema.safeParse(jobInput);
  const planResult = FoundryProviderPlanSchema.safeParse(planInput);
  if (!jobResult.success || !planResult.success) {
    return { valid: false, reason: "invalid_job_or_provider_plan" };
  }
  const job = jobResult.data;
  const plan = planResult.data;
  if (
    plan.providerKind !== job.providerKind ||
    plan.providerAdapterId !== job.providerAdapterId ||
    plan.jobSpecSha256 !== computeFoundryJobSpecSha256(job)
  ) {
    return { valid: false, reason: "provider_plan_subject_mismatch" };
  }
  if (plan.estimatedCostUsd > job.budgetCapUsd) {
    return { valid: false, reason: "provider_plan_exceeds_budget" };
  }
  const jobStageIds = job.stages.map((stage) => stage.id);
  const planStageIds = plan.stagePlans.map((stage) => stage.stageId);
  if (!sameStringSet(jobStageIds, planStageIds)) {
    return { valid: false, reason: "provider_plan_stage_mismatch" };
  }
  return { valid: true };
}

export const FOUNDRY_REPRESENTATION_ROLES = [
  "measured_geometry",
  "planning_mesh",
  "collision_mesh",
  "navmesh",
  "architectural_mesh",
  "visual_splat",
  "hero_micro_splat",
  "hero_mesh",
  "pbr_overlay",
  "generated_derivative",
  "semantic_graph",
  "uncertainty_map",
  "camera_spawn_points",
  "guided_camera_paths",
  "room_connectivity",
] as const;
export const FoundryRepresentationRoleSchema = z.enum(FOUNDRY_REPRESENTATION_ROLES);

const FOUNDRY_FORMATS_BY_ROLE: Readonly<
  Record<
    z.infer<typeof FoundryRepresentationRoleSchema>,
    ReadonlySet<string>
  >
> = {
  measured_geometry: new Set(["e57", "las", "laz", "ply", "glb", "gltf", "usd", "usdz"]),
  planning_mesh: new Set(["ply", "glb", "gltf", "usd", "usdz"]),
  collision_mesh: new Set(["ply", "glb", "gltf", "usd", "usdz"]),
  navmesh: new Set(["glb", "gltf", "usd", "usdz", "json"]),
  architectural_mesh: new Set(["ply", "glb", "gltf", "usd", "usdz"]),
  visual_splat: new Set(["ply", "spz", "sog"]),
  hero_micro_splat: new Set(["ply", "spz", "sog"]),
  hero_mesh: new Set(["ply", "glb", "gltf", "usd", "usdz"]),
  pbr_overlay: new Set(["glb", "gltf", "usd", "usdz"]),
  generated_derivative: new Set(["ply", "spz", "sog", "glb", "gltf", "usd", "usdz"]),
  semantic_graph: new Set(["json"]),
  uncertainty_map: new Set(["json"]),
  camera_spawn_points: new Set(["json"]),
  guided_camera_paths: new Set(["json"]),
  room_connectivity: new Set(["json"]),
};

export const FoundryPackageRepresentationSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    role: FoundryRepresentationRoleSchema,
    assetId: RuntimeManifestKeySchema,
    format: z.enum(["e57", "las", "laz", "ply", "spz", "sog", "glb", "gltf", "usd", "usdz", "json"]),
    coordinateFrameId: RuntimeManifestKeySchema,
    transformArtifactAssetId: RuntimeManifestKeySchema.nullable(),
    qualityReportId: RuntimeManifestKeySchema,
    provenanceClass: FoundryProvenanceClassSchema,
    lod: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((representation, ctx) => {
    const measuredRoles = new Set([
      "measured_geometry",
      "planning_mesh",
      "collision_mesh",
      "navmesh",
      "architectural_mesh",
    ]);
    if (measuredRoles.has(representation.role) && representation.provenanceClass !== "captured") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceClass"],
        message: "metric geometry roles must remain captured truth",
      });
    }
    if (
      representation.role === "generated_derivative" &&
      representation.provenanceClass !== "generated_cinematic" &&
      representation.provenanceClass !== "concept_imagination"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceClass"],
        message: "generated derivatives must carry a generated provenance class",
      });
    }
    const generated =
      representation.provenanceClass === "generated_cinematic" ||
      representation.provenanceClass === "concept_imagination";
    if (generated && representation.role !== "generated_derivative") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: "generated provenance is allowed only in generated-derivative roles",
      });
    }
    if (!FOUNDRY_FORMATS_BY_ROLE[representation.role].has(representation.format)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: "representation format is not valid for its declared role",
      });
    }
  });

export const FoundryRoomPackageSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    label: z.string().trim().min(1).max(200),
    roomFrameId: RuntimeManifestKeySchema,
    venueTransformArtifactAssetId: RuntimeManifestKeySchema,
    sceneAuthorityMapAssetId: RuntimeManifestKeySchema,
    representations: z.array(FoundryPackageRepresentationSchema).min(1).max(100),
  })
  .strict()
  .superRefine((room, ctx) => {
    addDuplicateIdIssue(room.representations, "representations", ctx);
    const roles = new Set(room.representations.map((representation) => representation.role));
    if (
      !["measured_geometry", "planning_mesh", "architectural_mesh"].some((role) =>
        roles.has(role as z.infer<typeof FoundryRepresentationRoleSchema>),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["representations"],
        message: "each room requires a captured metric or planning geometry representation",
      });
    }
    for (const requiredRole of [
      "semantic_graph",
      "camera_spawn_points",
      "room_connectivity",
    ] as const) {
      if (!roles.has(requiredRole)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["representations"],
          message: `each room requires a ${requiredRole} representation`,
        });
      }
    }
  });

export const FoundryCanonicalVenuePackageV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_CANONICAL_VENUE_PACKAGE_V0),
    id: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    venueFrameId: RuntimeManifestKeySchema,
    ingestManifestSha256: RuntimeSha256Schema,
    rooms: z.array(FoundryRoomPackageSchema).min(1).max(10_000),
    generatedRegions: z.array(FoundryGeneratedRegionSchema).max(100_000),
    packageQualityReportId: RuntimeManifestKeySchema,
    releaseManifestAssetId: RuntimeManifestKeySchema.nullable(),
    createdAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((venuePackage, ctx) => {
    addDuplicateIdIssue(venuePackage.rooms, "rooms", ctx);
    const representationCount = venuePackage.rooms.reduce(
      (total, room) => total + room.representations.length,
      0,
    );
    if (representationCount > 100_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message: "venue packages may contain at most 100,000 representations in aggregate",
      });
      return;
    }
    const representations = venuePackage.rooms.flatMap((room) => room.representations);
    const representationIds = representations.map((representation) => representation.id);
    if (new Set(representationIds).size !== representationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rooms"],
        message: "representation IDs must be unique across the venue package",
      });
    }
    const generatedRepresentationAssetIds = new Set(
      representations
        .filter((representation) => representation.role === "generated_derivative")
        .map((representation) => representation.assetId),
    );
    const generatedRegionAssetIds = new Set(
      venuePackage.generatedRegions.map((region) => region.outputAssetId),
    );
    for (const assetId of generatedRepresentationAssetIds) {
      if (!generatedRegionAssetIds.has(assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions"],
          message: "every generated representation requires generated-region provenance",
        });
      }
    }
    for (const assetId of generatedRegionAssetIds) {
      if (!generatedRepresentationAssetIds.has(assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["generatedRegions"],
          message: "generated-region outputs must be packaged as generated derivatives",
        });
      }
    }
  });
export type FoundryCanonicalVenuePackageV0 = z.infer<
  typeof FoundryCanonicalVenuePackageV0Schema
>;

export const FoundryPackageReferenceCatalogSchema = z
  .object({
    assets: z
      .array(
        z
          .object({
            id: RuntimeManifestKeySchema,
            provenanceClass: FoundryProvenanceClassSchema,
            evidenceKinds: z.array(FoundryEvidenceKindSchema).max(12),
          })
          .strict(),
      )
      .max(1_000_000),
    coordinateFrameIds: z.array(RuntimeManifestKeySchema).max(100_000),
    qualityReports: z
      .array(
        z
          .object({
            id: RuntimeManifestKeySchema,
            outcome: z.enum(["passed", "failed", "requires_review", "blocked"]),
            evidenceResolved: z.boolean(),
            profileResolved: z.boolean(),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    addDuplicateIdIssue(catalog.assets, "assets", ctx);
    addDuplicateIdIssue(catalog.qualityReports, "qualityReports", ctx);
    if (new Set(catalog.coordinateFrameIds).size !== catalog.coordinateFrameIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinateFrameIds"],
        message: "coordinateFrameIds must contain unique IDs",
      });
    }
    for (const [index, asset] of catalog.assets.entries()) {
      if (new Set(asset.evidenceKinds).size !== asset.evidenceKinds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "evidenceKinds"],
          message: "catalog evidence kinds must be unique",
        });
      }
    }
  });
export type FoundryPackageReferenceCatalog = z.infer<
  typeof FoundryPackageReferenceCatalogSchema
>;

export type FoundryPackageReferenceDecision =
  | { valid: true }
  | { valid: false; missingReferences: string[] };

/** Resolves package references against trusted catalogues; schema parsing alone is not a release gate. */
export function validateFoundryCanonicalPackageReferences(
  input: unknown,
  catalogInput: unknown,
): FoundryPackageReferenceDecision {
  const packageResult = FoundryCanonicalVenuePackageV0Schema.safeParse(input);
  const catalogResult = FoundryPackageReferenceCatalogSchema.safeParse(catalogInput);
  if (!packageResult.success || !catalogResult.success) {
    return { valid: false, missingReferences: ["invalid_package_or_catalog"] };
  }
  const venuePackage = packageResult.data;
  const catalog = catalogResult.data;
  const assets = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const frameIds = new Set(catalog.coordinateFrameIds);
  const qualityReports = new Map(catalog.qualityReports.map((report) => [report.id, report]));
  const missing = new Set<string>();
  const requireAsset = (
    id: string | null,
    evidenceKind?: z.infer<typeof FoundryEvidenceKindSchema>,
  ): void => {
    if (id === null) return;
    const asset = assets.get(id);
    if (asset === undefined) {
      missing.add(`asset:${id}`);
    } else if (evidenceKind !== undefined && !asset.evidenceKinds.includes(evidenceKind)) {
      missing.add(`asset_kind:${id}:${evidenceKind}`);
    }
  };
  const requireFrame = (id: string): void => {
    if (!frameIds.has(id)) missing.add(`frame:${id}`);
  };
  const requireQuality = (id: string): void => {
    const quality = qualityReports.get(id);
    if (quality === undefined) {
      missing.add(`quality:${id}`);
    } else if (
      quality.outcome !== "passed" ||
      !quality.evidenceResolved ||
      !quality.profileResolved
    ) {
      missing.add(`quality_unapproved:${id}`);
    }
  };

  requireFrame(venuePackage.venueFrameId);
  requireQuality(venuePackage.packageQualityReportId);
  requireAsset(venuePackage.releaseManifestAssetId, "release_manifest");
  for (const room of venuePackage.rooms) {
    requireFrame(room.roomFrameId);
    requireAsset(room.venueTransformArtifactAssetId, "transform_artifact");
    requireAsset(room.sceneAuthorityMapAssetId, "scene_authority_map");
    for (const representation of room.representations) {
      requireAsset(representation.assetId);
      const authoritativeAsset = assets.get(representation.assetId);
      if (
        authoritativeAsset !== undefined &&
        authoritativeAsset.provenanceClass !== representation.provenanceClass
      ) {
        missing.add(`provenance_mismatch:${representation.assetId}`);
      }
      requireAsset(representation.transformArtifactAssetId, "transform_artifact");
      requireFrame(representation.coordinateFrameId);
      requireQuality(representation.qualityReportId);
    }
  }
  for (const region of venuePackage.generatedRegions) {
    requireAsset(region.outputAssetId);
    const output = assets.get(region.outputAssetId);
    if (output !== undefined && output.provenanceClass !== region.provenanceClass) {
      missing.add(`provenance_mismatch:${region.outputAssetId}`);
    }
    requireAsset(region.maskAssetId, "mask");
    for (const sourceAssetId of region.sourceAssetIds) requireAsset(sourceAssetId);
  }
  return missing.size === 0
    ? { valid: true }
    : { valid: false, missingReferences: [...missing].sort() };
}
