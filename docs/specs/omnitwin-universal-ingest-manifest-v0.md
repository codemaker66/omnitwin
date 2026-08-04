# OmniTwin universal ingest manifest v0

**Schema ID:** omnitwin.foundry.ingest-manifest.v0

**Runtime validator:** packages/types/src/omnitwin-foundry.ts

**Portable schema:** docs/specs/omnitwin-universal-ingest-manifest-v0.schema.json

The portable JSON Schema validates shape and local field conditions. The TypeScript Zod schema is also required because it enforces cross-collection references, uniqueness, rights approval and generated-output consistency that portable JSON Schema cannot express concisely.

## Purpose

The manifest is the first durable boundary between arbitrary venue inputs and reconstruction. It inventories bytes without changing them, makes coordinate/calibration relationships explicit, records commercial/training/redistribution policy, and provides stable asset IDs for later transforms and provenance.

It is not a reconstruction result, does not assert that an input is usable, and does not grant rights.

`computeFoundryIngestManifestSha256` defines manifest identity as SHA-256 over domain-separated canonical JSON (`omnitwin.foundry.ingest-manifest.v0` plus the stable canonical representation). Raw file bytes, pretty-printed JSON and an ad hoc hash are not interchangeable with this digest. A JobSpec references this exact value, and purpose-aware rights validation rejects a JobSpec/manifest mismatch before evaluating any asset permission.

## Required top-level fields

| Field | Meaning |
|---|---|
| schemaVersion | exact v0 identifier |
| projectId | stable safe manifest key |
| createdAt / createdBy | accountable creation event |
| sourceRoots | operator-granted read-only roots, with public-safe redacted location |
| coordinateFrames | all known venue/room/sensor/camera/LiDAR/geodetic/projected/arbitrary frames |
| transforms | proposed/reviewed/rejected frame edges |
| assets | immutable file/object inventory |
| provenanceEdges | deterministic operation lineage for derived assets |
| generatedRegions | per-region generated lineage and disclosure |
| legalReviewState | not_reviewed, requires_review, approved or blocked |
| sourceMutationPermitted | always false |

## Source roots

A source root is `local_directory`, `removable_media`, `object_prefix` or `vendor_workspace`. It must be read-only and declare `caseSensitivity` as `sensitive` or `insensitive`, so duplicate relative paths are compared using the source's real semantics. `locationRedacted` is a display-safe locator rather than an unrestricted path or credential. An implementation maintains a private granted-handle mapping outside the manifest.

## Assets

Required input types include:

- Matterport and generic E57;
- LAS/LAZ and PLY point clouds;
- Matterport panoramas, DSLR, 360 and phone imagery;
- ordinary video and RGB-D;
- XGRIDS xbin, LCC and LCC2;
- SPZ, SOG and Gaussian PLY;
- OBJ and GLB/glTF;
- floor plans and CAD/BIM;
- OpenUSD;
- calibration, trajectory and control-network artifacts;
- typed evidence records for transforms, residuals, projections, quality, reviewer attestations, authority maps, release manifests, masks, provenance and fixed views.

Every asset records:

| Field | Rule |
|---|---|
| sourceRootId / relativePath | reference a declared root; relative path is traversal-free POSIX form |
| sizeBytes / sha256 | exact byte identity; digest form is sha256: followed by 64 lowercase hex chars |
| immutable | always true |
| captureState | raw_capture, official_export, derived or reference |
| accessState | direct, official_export, official_api, metadata_only, blocked_technical, blocked_legal or unknown |
| coordinateFrameId | declared frame or null |
| calibrationAssetIds / parentAssetIds | other declared assets, never self |
| rights | separate basis, commercial, model-training and redistribution decisions |
| provenanceClass | captured, enhanced_captured, generated_cinematic or concept_imagination |
| evidenceKinds | zero or more unique typed evidence roles; required for an `evidence_record` input |
| inspection | explicit geometry, appearance, calibration and scale value plus observed metadata keys and the decisive next test |

Raw captures must be captured provenance. Generated assets must identify conditioning/parent assets. Asset type is not evidence of coordinate frame, scale, rights or suitability.

Each inspection value is `none`, `low`, `medium`, `high` or `unknown`. These fields record what bounded inspection found; they are not an automatic suitability score. `decisiveNextTest` is required so an `unknown` or weak signal has an actionable falsifier.

Evidence kinds are `transform_artifact`, `residual_report`, `projection_operation`, `quality_report`, `reviewer_attestation`, `scene_authority_map`, `release_manifest`, `mask`, `provenance_report`, `fixed_view`, `calibration_record` and `other`. Validators check both asset identity and the required evidence kind; a generic file reference cannot stand in for typed evidence.

## Rights

Rights are conservative:

- basis is customer_owned, explicit_licence, vendor_export_terms, written_permission, public_domain or unknown;
- each of commercialUse, modelTrainingUse and redistribution is independently allowed, restricted/prohibited/requires_review or unknown as defined by the schema;
- termsReviewedAt and termsReference preserve the reviewed version;
- restrictions are operator-readable.

The manifest validator refuses `legalReviewState: approved` while any asset has non-allowed commercial, training or redistribution status. This global state is intentionally all-purpose and fail-closed; approval remains a policy record, not legal advice.

Jobs also carry an implemented, narrower execution check. Every JobSpec stage declares one or more `rightsPurposes`, and `validateFoundryJobRights(job, manifest)` evaluates those purposes against each stage input. It fails closed on missing/incomplete rights records and on any permission the exact purpose needs but the asset does not allow. This can permit a reviewed geometry-only internal stage while still blocking model training or redistribution; it does not weaken the stricter global manifest-approval rule.

## Frames and transforms

Frame fields include units, handedness, up axis, authority and `crs`. `crs` is a nullable structured object with `authority`, `code`, `axisOrder`, `horizontalDatum`, nullable `verticalDatum` and nullable `coordinateEpoch`. A geodetic frame requires degree units, a CRS and longitude/latitude axis order; a projected frame requires linear units, a CRS and easting/northing axis order. Other frame kinds require `crs: null`. Unknown is otherwise representable and visible.

A transform has different declared source/target frames, names at least one provenance asset and declares `operationKind`:

- `affine_similarity` requires a finite matrix in the existing TransformArtifactV0/Three.js column-major convention, must set `projectionArtifactAssetId: null`, and cannot directly convert a geodetic endpoint;
- `crs_projection` connects one geodetic and one projected frame, requires `matrix: null`, and requires a typed `projection_operation` asset.

Every edge has proposed, reviewed or rejected state and nullable `transformArtifactAssetId`, `residualReportAssetId`, `projectionArtifactAssetId` and `reviewerAttestationAssetId`. A reviewed edge requires distinct, resolvable `transform_artifact`, `residual_report` and `reviewer_attestation` assets; a CRS projection additionally requires its typed projection-operation asset.

The manifest does not infer a camera/LiDAR pose convention from a four-value rotation.

## Provenance and generated regions

A provenance edge binds input asset IDs, output asset ID, operation/version, environment digest and time. Generated regions additionally require:

- all source asset IDs;
- the generated output and mask asset;
- generated_cinematic or concept_imagination class;
- model name/version and exact checkpoint digest;
- prompt/condition digest rather than secret/raw prompt text;
- confidence, export restrictions and a Truth Mode disclosure.

## Referential invariants

- IDs are unique within each collection.
- All asset/root/frame/provenance/generated references resolve.
- Paths cannot be absolute, contain backslashes or traverse with dot segments.
- Source mutation is never permitted.
- A sample fingerprint is not entered in sha256; only a full digest qualifies.
- Discovery records that have only a sample fingerprint remain outside `FoundryIngestManifestV0`; there is no “not-yet-archival” digest state in v0.
- The manifest is append-by-revision: changes produce a new manifest artifact and provenance edge.

## Minimal example

    {
      "schemaVersion": "omnitwin.foundry.ingest-manifest.v0",
      "projectId": "grand-hall-pilot",
      "createdAt": "2026-07-12T10:00:00.000Z",
      "createdBy": "operator-1",
      "sourceRoots": [{
        "id": "source-e57",
        "kind": "local_directory",
        "displayName": "E57 source",
        "locationRedacted": "E57_ASSET_ROOT/[redacted]",
        "caseSensitivity": "insensitive",
        "readOnly": true
      }],
      "coordinateFrames": [{
        "id": "venue-control",
        "kind": "venue_control",
        "units": "meters",
        "handedness": "right",
        "upAxis": "z",
        "authority": "measured",
        "provenanceAssetIds": ["e57-main"],
        "crs": null
      }],
      "transforms": [],
      "assets": [{
        "id": "e57-main",
        "sourceRootId": "source-e57",
        "relativePath": "cloud_0.e57",
        "inputType": "matterport_e57",
        "mediaType": "model/e57",
        "sizeBytes": 20518437888,
        "sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "immutable": true,
        "captureState": "official_export",
        "accessState": "official_export",
        "capturedAt": null,
        "coordinateFrameId": "venue-control",
        "calibrationAssetIds": [],
        "parentAssetIds": [],
        "rights": {
          "basis": "customer_owned",
          "commercialUse": "allowed",
          "modelTrainingUse": "requires_review",
          "redistribution": "restricted",
          "termsReviewedAt": "2026-07-12T10:00:00.000Z",
          "termsReference": "https://example.invalid/contract-record",
          "restrictions": ["Contract-specific review required before training."]
        },
        "provenanceClass": "captured",
        "evidenceKinds": [],
        "inspection": {
          "geometryValue": "high",
          "appearanceValue": "low",
          "calibrationValue": "medium",
          "scaleValue": "high",
          "metadataKeys": ["scanCount", "pointRecordCount", "bounds"],
          "decisiveNextTest": "Validate registration residuals against reviewed control evidence."
        },
        "notes": ["Registered geometry; acquisition timestamps unavailable."]
      }],
      "provenanceEdges": [],
      "generatedRegions": [],
      "legalReviewState": "requires_review",
      "sourceMutationPermitted": false
    }

## Implementation sequence

1. Inspect signatures and bounded metadata.
2. Present classification and rights questions.
3. Hash authoritative/staged bytes with streaming SHA-256.
4. Emit a deterministic sorted manifest.
5. Validate with both TypeScript and portable JSON Schema.
6. Ask the operator to review roots, rights and frame unknowns.
7. Sign or content-address the manifest before any job plan references it.

No inspector may decrypt a protected archive, probe undocumented proprietary records, follow symlinks outside the granted root or write alongside the source.
