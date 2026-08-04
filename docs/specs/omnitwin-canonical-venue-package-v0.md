# OmniTwin canonical venue package v0

**Schema ID:** omnitwin.foundry.canonical-venue-package.v0

**Runtime validator:** packages/types/src/omnitwin-foundry.ts

## Purpose

The canonical venue package is a manifest of authoritative and presentational representations in a shared venue frame. It is not one giant mesh or splat. It lets geometry, planning, collision, appearance, semantics and generated derivatives use the representation best suited to each purpose while preserving lineage.

The package is an input to the existing Reconstruction Foundry. It is not itself public, signed or active.

## Top-level record

| Field | Meaning |
|---|---|
| id / projectId | stable package and source-project keys |
| venueFrameId | canonical venue control frame |
| ingestManifestSha256 | exact source inventory revision |
| rooms | one or more room packages |
| generatedRegions | all synthesized region records |
| packageQualityReportId | package-level quality decision |
| releaseManifestAssetId | release-manifest asset ID, or null until a downstream release exists |
| createdAt | package assembly time |

## Room package

Each room has:

- stable room ID and human label;
- room-local frame ID;
- `venueTransformArtifactAssetId`, referencing the reviewed room-to-venue TransformArtifact asset;
- `sceneAuthorityMapAssetId`, referencing the room's Scene Authority Map asset;
- one or more representation descriptors.

A room cannot be published merely because it has a visual splat. The minimum planning-capable room has measured geometry, planning/collision representations, reviewed transform, semantic room identity, quality evidence and runtime visual representation appropriate to its exposure.

## Representation roles

| Role | Default authority/purpose | Typical formats |
|---|---|---|
| measured_geometry | metric geometry and residual evaluation | E57, LAS/LAZ, PLY |
| planning_mesh | dimensions, cutaways and event layouts | GLB/glTF, USD |
| collision_mesh | runtime physics and picking | GLB/glTF |
| navmesh | route/path simulation | GLB or typed JSON |
| architectural_mesh | high-detail explicit surfaces | GLB/glTF, USD |
| visual_splat | room-wide captured appearance | PLY master, SPZ/SOG runtime |
| hero_micro_splat | focal close-up captured appearance | PLY master, SPZ/SOG runtime |
| hero_mesh | explicit ornament/asset | GLB/glTF, USD |
| pbr_overlay | materials/detail over measured structure | GLB/glTF |
| generated_derivative | cinematic or concept appearance only | PLY, SPZ/SOG, GLB/glTF or USD/USDZ |
| semantic_graph | reviewed rooms/features/routes | JSON |
| uncertainty_map | spatial quality and recapture priority | JSON |
| camera_spawn_points | reviewed fixed camera/spawn definitions | JSON |
| guided_camera_paths | ordered guided-tour camera paths | JSON |
| room_connectivity | reviewed room/portal connectivity graph | JSON |

Metric geometry roles must use captured provenance. A generated derivative must use generated_cinematic or concept_imagination provenance. Enhanced captured appearance does not become measured geometry.

Every representation descriptor declares `id`, `role`, `assetId`, `format`, `coordinateFrameId`, nullable `transformArtifactAssetId`, `qualityReportId`, `provenanceClass` and `lod`. When non-null, `transformArtifactAssetId` is the content-addressed transform evidence for placing that representation in its declared frame; prose paths and implicit transforms are not substitutes.

Every room requires at least one captured `measured_geometry`, `planning_mesh` or `architectural_mesh` representation, plus `semantic_graph`, `camera_spawn_points` and `room_connectivity` JSON representations. `guided_camera_paths` is optional, but when present its ordered keyframes and room transitions must resolve through the reviewed spawn points, room-connectivity graph and collision/navigation authority.

After schema parsing, `validateFoundryCanonicalPackageReferences` must resolve every referenced asset, frame and quality report against trusted catalogues. It requires passed, evidence-resolved and trusted-profile-resolved quality reports; matches representation/generated-output provenance to the authoritative asset; and checks typed TransformArtifact, Scene Authority Map, release-manifest and generated-mask references. Schema parsing alone is not a release gate.

## Master, interchange and runtime

### Source master

The source master is the Foundry manifest plus:

- original authorized images/video/point clouds/calibration;
- unquantized Gaussian arrays with explicit convention metadata;
- reviewed transforms/residuals;
- measured meshes and semantic/provenance graphs;
- quality artifacts, fixed-view camera definitions and connected camera-path artifacts.

Camera/path evidence records camera/image/pose IDs, model and source resolution, intrinsics/distortion, crop/exposure policy, ordered keyframes, path segments, intended speed and loop/room-graph connectivity. Path traversal is checked against reviewed nav/collision authority. A disconnected set of attractive cameras is not a valid room-navigation package.

Generic Gaussian PLY can be retained but is not sufficient as the only canonical definition. Record:

- coordinate frame, units, handedness and up axis;
- quaternion order and normalization;
- linear/log scale and covariance convention;
- linear/sigmoid opacity convention;
- SH degree, coefficient order, basis and colour space;
- source camera/image/exposure lineage.

### Editing/interchange

OpenUSD is the composition/DCC adapter; GLB/glTF is the mesh/material interchange and runtime adapter. An OpenUSD stage must preserve metersPerUnit, upAxis, layer provenance and external asset digests. Custom Gaussian schemas are adapters and cannot become the only master.

### Runtime

- SPZ: compact splat interchange/delivery.
- SOG: streamed/LOD web delivery.
- Spark RAD/RADC: experimental large-scene streaming.
- GLB/glTF: mesh, collision, PBR and semantic-linked scene.
- Khronos Gaussian glTF: feature-flagged until ratified.
- OGC 3D Tiles 1.1: optional geospatial hierarchy.

Never transcode lossy SPZ/SOG into another lossy master. All runtime variants derive from the unquantized master.

## Scene authority

The D-024 Scene Authority Map is mandatory for public candidates. It assigns per-region:

- geometry authority;
- appearance authority;
- lighting authority;
- physics authority;
- semantic authority;
- interaction authority;
- export authority;
- truth status and confidence;
- reconstruction strategy and transform evidence.

Example: E57-derived planning mesh is geometry/physics authority; an independent splat is appearance authority; a reviewed JSON graph is semantic authority; a generated chandelier highlight exists only in a cinematic derivative.

## Semantic graph

Machine proposals may include rooms, doors, windows, walls, stairs, lifts, bars, stages, furniture, fireplaces, chandeliers, artwork, power/AV, service routes, restricted zones and heritage features.

Every node/edge requires:

- stable ID and schema label/version;
- spatial scope in a declared frame;
- source asset/view IDs;
- proposer model/tool and version;
- confidence and calibration bucket;
- review state, reviewer and corrections;
- authority reference and export policy.

Semantics are annotations and relationships. They cannot silently deform geometry.

## Uncertainty map

Uncertainty is multi-channel rather than one heat value:

- observation coverage and view count;
- angular diversity;
- blur/exposure/texture;
- camera/point/mesh residual;
- cross-session consistency;
- semantic confidence;
- runtime compression/LOD loss;
- hero priority and human concern.

Consumers apply separate policies for recapture, review, generative derivatives and runtime detail.

## LOD and chunking

LOD is selected by measured screen/runtime behavior:

- chunk spatially in the venue frame with stable IDs and overlap policy;
- retain a low-cost whole-room fallback before hero chunks;
- make first useful frame and progressive completeness explicit;
- share an occlusion/depth policy between mesh and splat to prevent z-fighting;
- retain transform and authority references at every LOD;
- preserve generated-region masks through simplification;
- declare target device profile, byte/VRAM budgets and quality report.

No fixed splat count is a quality tier by itself.

## Suggested package layout

    package/
      manifest.json
      evidence/
        ingest-manifest.json
        transforms/
        residuals/
        scene-authority/
        quality/
        fixed-views/
        camera-paths/
      venue/
        semantics.json
        control/
      rooms/<room-id>/
        measured/
        planning/
        collision/
        navigation/
        appearance/master/
        appearance/runtime/
        hero/
        generated/
        uncertainty/

Paths are illustrative and relative. The artifact/release manifests supply exact hashes.

## Package gates

1. Ingest manifest is valid and content-addressed.
2. Venue and every room frame have reviewed transform evidence, and each room's `venueTransformArtifactAssetId` resolves.
3. Every representation declares role, frame, format, `transformArtifactAssetId`, quality report and provenance.
4. Metric roles use captured provenance.
5. Every generated output has a region mask and disclosure.
6. Every room's `sceneAuthorityMapAssetId` resolves.
7. Required quality profile passes without missing metrics.
8. Runtime variants trace to an unquantized master.
9. No asset enters a representation whose exact purpose is prohibited: each producing/packaging JobSpec stage declares `rightsPurposes`, and `validateFoundryJobRights` must pass for its exact inputs; unknown/incomplete rights still fail closed.
10. Every room includes captured metric/planning geometry plus resolvable `semantic_graph`, `camera_spawn_points` and `room_connectivity` representations; any `guided_camera_paths` resolve through them.
11. `releaseManifestAssetId`, when non-null, resolves to a private immutable release-manifest asset; public promotion is downstream.
