import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import {
  RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
} from "./reconstruction-release.js";
import {
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  RECONSTRUCTION_SCENE_MAX_EXPANDED_REGION_NODE_REFERENCES,
  RECONSTRUCTION_SCENE_MAX_NORMALIZED_PROJECTION_BYTES,
} from "./reconstruction-review-evidence.js";
import { TWIN_SCHEMA_ID } from "./twin.js";

export const HISTORICAL_RUNTIME_SCENE_MAP_MAX_BYTES = 4 * 1024 * 1024;
export const HISTORICAL_RUNTIME_RELEASE_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORICAL_RUNTIME_SOURCE_TWIN_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
export const HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION =
  "venviewer.scene-map-private-byte-verifier.v1";
export const HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_SCHEMA_VERSION =
  "venviewer.historical-runtime-scene-map-parser-policy.v1";
export const HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DOMAIN =
  "venviewer.historical-runtime-scene-map-parser-policy.v1\n";

/**
 * Number-free semantic policy recorded by every authenticated parser receipt.
 * Changes require an additive database policy migration; a verifier binary may
 * not silently reinterpret already-accepted bytes.
 */
export const HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY = Object.freeze({
  schemaVersion: HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_SCHEMA_VERSION,
  parserVersion: HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION,
  sceneMapSchemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  releaseManifestSchemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  sourceTwinManifestSchemaVersion: TWIN_SCHEMA_ID,
  twinPredicateSchemaVersion: RECONSTRUCTION_ATTESTATION_PREDICATE_SCHEMA_VERSION,
  twinPayloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  sceneMapSerialization: "stable_canonical_json_utf8_exact_v1",
  releaseManifestSerialization: "json_stringify_pretty_2_lf_utf8_exact_v1",
  sourceTwinManifestSerialization: "json_stringify_pretty_2_lf_utf8_exact_v1",
  duplicateKeyPolicy: "reject_before_json_parse",
  unicodePolicy: "fatal_utf8_no_bom",
  boundsCvfPolicy: "reject_without_exact_frame_transform_proof",
  runtimeLayerPolicy: "appearance_authority_only",
  roomProjectionPolicy: "source_twin_manifest_order_exact_space_slug",
  sceneMapMaximumBytes: String(HISTORICAL_RUNTIME_SCENE_MAP_MAX_BYTES),
  releaseManifestMaximumBytes: String(
    HISTORICAL_RUNTIME_RELEASE_MANIFEST_MAX_BYTES,
  ),
  sourceTwinManifestMaximumBytes: String(
    HISTORICAL_RUNTIME_SOURCE_TWIN_MANIFEST_MAX_BYTES,
  ),
  expandedRegionNodeReferenceMaximum: String(
    RECONSTRUCTION_SCENE_MAX_EXPANDED_REGION_NODE_REFERENCES,
  ),
  normalizedProjectionMaximumBytes: String(
    RECONSTRUCTION_SCENE_MAX_NORMALIZED_PROJECTION_BYTES,
  ),
});

export const HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST = sha256Hex(
  `${HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DOMAIN}${stableCanonicalJson(
    HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY,
  )}`,
);
