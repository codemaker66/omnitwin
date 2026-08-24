# Visual asset and RoomScene manifest v0

Status: Implemented v0 vertical-slice contract

Schema version: `room-scene-manifest/v0`

Normative implementation: `packages/types/src/room-scene-manifest.ts`

## Purpose

This specification documents the strict Zod contracts used to identify visual
asset sets and compose a room from explicitly declared spatial layers. The
canonical manifest records identity, lineage, truth class, evidence, rights,
and layer authority. It does not contain delivery URLs and does not create an
asset that is not present.

The TypeScript/Zod implementation is normative. If this document and the
schema differ, the schema wins and this document must be corrected.

## Object graph

A `RoomSceneManifestV0` contains:

- source-rights records;
- quality-evidence records;
- visual-asset manifests;
- existing `TransformArtifactV0` records;
- spatial-layer descriptors that reference those records;
- reconstruction/enhancement provider integration records; and
- material attachments and lighting variants that target declared layers.

All arrays are manifest-local. Cross-references are checked during parse, and
IDs within each collection must be unique.

## Closed vocabularies

### Truth classes

The six truth classes are exactly:

1. `MEASURED`
2. `CAPTURED`
3. `RECONSTRUCTED`
4. `ENHANCED_CAPTURED`
5. `GENERATED_CINEMATIC`
6. `PROCEDURAL_PLANNER`

These labels classify content. They do not, by themselves, establish spatial
registration, quality, rights, accuracy, or operational authority.

### Layer slots

The seven layer kinds are exactly:

1. `Appearance`
2. `StructuralProxy`
3. `Collision`
4. `HeroVolume`
5. `Semantic`
6. `Planner`
7. `CinematicDerivative`

A missing real layer is absent. Implementations must not add an implicit
eighth slot or fabricate a descriptor to fill one of the seven.

Materials and lighting variants are typed supplemental records, not hidden
layer slots. They must target declared layers and preserve their own truth,
rights, evidence, source, and registration. The current Grand Hall manifest
declares all supplemental/provider collections as empty.

### Authorities

A layer declares one or more of:

- `appearance`
- `geometry`
- `collision`
- `navigation`
- `diagnostic_navigation`
- `semantics`
- `interaction`
- `planning`
- `lighting`
- `export`

Authority is explicit and purpose-specific. Visibility is not authority.

### Intents

A layer declares one or more of `inspection`, `human_diagnostic`, `dollhouse`,
`planning`, or `cinematic`.

## `SourceRightsV0`

| Field | Contract |
|---|---|
| `id` | Manifest key. |
| `sourceFamily` | Manifest key naming the source family. |
| `authorityStatus` | `unknown`, `confirmed_by_project_owner`, `evidence_reviewed`, or `restricted`. |
| `authorityStatement` | Non-empty statement, at most 240 characters. Owner-confirmed records must use the exact statement `Authority status: confirmed by project owner`. |
| `scope` | One or more declared scope values. |
| `scopeStatement` | Non-empty scope explanation, at most 400 characters. |
| `additionalPermissions` | Unique values from `redistribution` and `third_party_dissemination`; defaults to an empty array for non-owner-confirmed records. |
| `evidenceLocation` | Non-empty evidence reference or pending-location placeholder, at most 500 characters. |
| `evidenceLocationStatus` | `pending` or `recorded`. |
| `unrelatedLicensesRequireSeparateReview` | Explicit Boolean guard for unrelated licences. |

The allowed scopes are `data_use`, `reconstruction`, `training`, `enhancement`,
`derivatives`, `commercial_venviewer_development`, `reverse_engineering`, and
`software_integration`.

An owner-confirmed record must retain every scope above, the exact supplied
scope statement, both additional permissions, and the independent unrelated-
licence guard. This makes the supplied dissemination grant explicit without
silently waiving a code, SDK, research implementation, model, or checkpoint
licence.

`pending` is an evidence-location placeholder state, not proof that the
document has been reviewed. `evidence_reviewed` requires a `recorded` location,
but `recorded` alone does not change `authorityStatus` or prove review. Rights
to use data do not change truth class or grant spatial authority.

### Typed append-only rights ledger

`SourceRightsLedgerV0` validates `state/source_rights.json` as version `1`,
ledger type `source-rights`, revision policy `append-only`, and one or more
uniquely identified revisions. Each revision has an ISO date, the literal
authority source `project_owner_statement`, one or more validated
`SourceRightsV0` records, and an explicit separate-licence statement. Revisions
are appended; prior statements are not rewritten. This project ledger is
additive to, not a replacement for, Foundry's broader provenance systems.

## `QualityEvidenceV0`

| Field | Contract |
|---|---|
| `id` | Manifest key. |
| `status` | `unverified`, `machine_checked`, `human_reviewed`, or `not_run`. |
| `confidence` | `unknown`, `appearance_only`, `layout_grade`, `operations_grade`, or `survey_grade`. |
| `evidenceRefs` | Evidence references; defaults to an empty array. |
| `limitations` | One or more non-empty limitations. |

`machine_checked` and `human_reviewed` records require at least one evidence
reference. Any confidence other than `unknown` also requires at least one
evidence reference. A cited artifact supports only the stated confidence and
must be read together with `limitations`.

`not_run` and `unverified` records must use `unknown` confidence. `layout_grade`,
`operations_grade`, and `survey_grade` require `human_reviewed` status; a hash
or machine check alone cannot promote operational quality.

The presence of an evidence reference does not automatically prove measured
alignment, collision suitability, or survey accuracy.

## `VisualAssetMemberV0`

An ordered visual-asset member has:

| Field | Contract |
|---|---|
| `id` | Unique within its visual-asset manifest. |
| `assetVersionId` | Optional UUID, nullable. |
| `fileName` | Non-empty file name, at most 255 characters. |
| `sha256` | Runtime SHA-256 value in the shared canonical format. |
| `sizeBytes` | Positive integer. |
| `gaussianCount` | Optional positive integer. |

Member order is significant for an ordered multi-member asset set.

## `VisualAssetManifestV0`

| Field | Contract |
|---|---|
| `id` | Manifest key. |
| `truthClass` | One of the six closed truth classes. |
| `format` | `lcc`, `lcc2`, `sog`, `spz`, `ply`, `obj`, `glb`, or `json`. |
| `lineageRole` | `source_master` or `runtime_derivative`. |
| `parentArtifactRefs` | One or more source/parent artifact references. |
| `sourceRightsId` | Reference to a rights record declared in the containing room manifest. |
| `qualityEvidenceIds` | One or more references to declared quality-evidence records. |
| `members` | One or more ordered `VisualAssetMemberV0` records. |
| `totalBytes` | Positive integer equal to the exact sum of member byte sizes. |
| `totalGaussianCount` | Optional positive integer equal to the exact member total. |

Member IDs must be unique. If `totalGaussianCount` is present, every member
must declare `gaussianCount`, and their sum must equal it. The parser computes
both totals and rejects inconsistent duplicated summary fields.

The manifest identifies bytes; it does not authorise a public URL, bypass
authenticated transport, or weaken runtime-package receipt verification.

## Layer source

Every `SpatialLayerDescriptorV0` selects exactly one source form:

| `type` | Required fields | Meaning |
|---|---|---|
| `visual_asset_set` | `visualAssetManifestId` | References a visual-asset manifest in this room manifest. |
| `artifact` | `artifactRef`, `sha256` | References a digest-bound non-visual-set artifact. |
| `planner_state` | none | References external planner state. |
| `fixture` | `fixtureRef`, `label` | Explicitly identifies fixture content. It is never an undeclared fallback. |

A `visual_asset_set` reference must resolve locally. An artifact remains only
the artifact it declares; the digest does not promote its authority.

## Spatial registration

Every layer selects exactly one registration form:

| `type` | Required fields | Claim boundary |
|---|---|---|
| `unregistered` | none | No registered spatial authority. |
| `inspection_placement` | `bindingRef` | A placement for inspection/diagnostics, not measured alignment. |
| `transform_artifact` | `transformArtifactId` | References a declared existing `TransformArtifactV0`. The artifact's own provenance and review state govern the claim. |
| `identity_in_rrf` | none | Declares identity in the room reference frame; this label alone is not accuracy evidence. |
| `not_spatial` | none | No spatial placement claim. |

The contract reuses `TransformArtifactV0`; it does not define a competing
transform schema. A `transform_artifact` reference must resolve within
`RoomSceneManifestV0.transformArtifacts`.

## `SpatialLayerDescriptorV0`

| Field | Contract |
|---|---|
| `id` | Unique layer manifest key. |
| `kind` | One of the seven closed layer slots. |
| `truthClass` | One of the six closed truth classes. |
| `source` | One discriminated layer source. |
| `authorities` | One or more explicit authorities. |
| `spatialRegistration` | One discriminated registration state. |
| `qualityEvidenceIds` | One or more references to declared evidence. |
| `sourceRightsId` | Optional and nullable; if present, references declared rights. |
| `intents` | One or more declared intents. |
| `loadPolicy` | `atomic`, `progressive`, `synchronous`, or `external`. |
| `visibleByDefault` | Boolean display hint; not an authority grant. |

### Enforced authority rules

- A visual-asset layer must preserve the referenced asset manifest's truth
  class and rights record and retain all of its declared quality evidence.
- `lcc`, `lcc2`, `sog`, and `spz` visual assets may own appearance or lighting
  only. Structural, navigation, or collision authority requires a separate
  non-radiance artifact; a splat is never a collision volume.
- `GENERATED_CINEMATIC` may own only `appearance` or `lighting`. It cannot own
  geometry, collision, navigation, diagnostic navigation, semantics,
  interaction, planning, or export.
- `Planner` must use `PROCEDURAL_PLANNER` truth, a `planner_state` source, and
  explicit `planning` authority. No other layer may use `planner_state`.
- `CAPTURED` and `ENHANCED_CAPTURED` cannot own geometry, collision,
  navigation, planning, or export.
- `unregistered`, `inspection_placement`, and `not_spatial` layers cannot own
  geometry, collision, navigation, planning, or export. Fixture sources have
  the same operational-authority prohibition.
- `Collision` must declare `collision` authority, use `MEASURED` or
  `RECONSTRUCTED` truth, use `transform_artifact` or `identity_in_rrf`
  registration, and cite human-reviewed `operations_grade` or `survey_grade`
  evidence.
- `collision` authority is valid only on the explicit `Collision` slot;
  `diagnostic_navigation` authority is valid only on `StructuralProxy`.
- Any layer claiming geometry, collision, navigation, planning, or export must
  cite human-reviewed metric evidence. Geometry alone requires at least
  `layout_grade`; collision/navigation/planning/export require
  `operations_grade` or `survey_grade`.

Those rules are necessary but not sufficient evidence. In particular, the
availability of the `Collision` slot does not claim that the current Grand Hall
has measured alignment or an approved collision representation. Such a layer
must remain absent until the real asset, registration, evidence, and renderer
exist.

## Provider and supplemental integration records

`ReconstructionProviderDescriptorV0` names a provider kind from
`xgrids_import`, `gsplat`, `three_dgut`, `neural_harmonic_textures`, `brush`,
or `other`. `EnhancementProviderDescriptorV0` names `fixer`, `artifixer`,
`gaussian_super_resolution`, `relighting`, `material_inference`, or `other`,
and limits outputs to `ENHANCED_CAPTURED` or `GENERATED_CINEMATIC`. Provider
availability is `integration_point`, `available`, or `disabled`; `available`
requires a non-null real implementation reference. A type entry cannot make a
provider real.

`MaterialAttachmentDescriptorV0` declares one or more of `normal`, `albedo`,
`roughness`, `metallic`, `reflective_mask`, and `glass_mask` against declared
layer IDs. `LightingVariantDescriptorV0` declares a captured/reconstructed/
physical/generated lighting kind and an explicit manual, event-state, or
cinematic-only activation. Both records carry source, truth class, rights,
quality evidence, registration, and target-layer references. All references
are validated locally; visual-set sources must preserve the visual manifest's
truth, rights, and evidence.

Material and lighting supplements accept only real `visual_asset_set` or
digest-bound `artifact` sources; `planner_state` and fixtures cannot masquerade
as captured/reconstructed supplemental evidence. Lighting kind and truth class
are fail-closed: `captured_environment` is `CAPTURED`, reconstructed/physical
variants are `RECONSTRUCTED` or `ENHANCED_CAPTURED`, and
`generated_relighting` is `GENERATED_CINEMATIC`.

## `RoomSceneManifestV0`

| Field | Contract |
|---|---|
| `schemaVersion` | Exact literal `room-scene-manifest/v0`. |
| `manifestId` | Manifest key. |
| `venueSlug` | Venue manifest key. |
| `roomSlug` | Room manifest key. |
| `runtimePackageId` | UUID or `null`. |
| `createdAt` | Offset-aware ISO date-time. |
| `sourceRights` | Rights records; defaults to an empty array. |
| `qualityEvidence` | One or more evidence records. |
| `visualAssetManifests` | Visual-asset records; defaults to an empty array. |
| `transformArtifacts` | Existing `TransformArtifactV0` records; defaults to an empty array. |
| `layerDescriptors` | One or more spatial-layer descriptors. |
| `reconstructionProviders` | Typed provider integration records; defaults to an empty array. |
| `enhancementProviders` | Typed enhancement integration records; defaults to an empty array. |
| `materialAttachments` | Typed material-channel attachments; defaults to an empty array. |
| `lightingVariants` | Typed lighting variants; defaults to an empty array. |

The parser rejects:

- duplicate IDs within rights, evidence, visual assets, transforms, layers, or
  supplemental/provider collections;
- a visual asset whose rights or evidence references are undeclared;
- a layer whose visual-asset, rights, evidence, or transform reference is
  undeclared;
- a visual-asset layer that relabels the asset truth/rights or drops any asset
  evidence;
- inconsistent visual member totals;
- fake `available` providers without implementation references or dangling
  supplemental target/rights/evidence/transform/visual references; and
- the authority/truth/registration violations listed above.

## Rendering and substitution boundary

The manifest is declarative. The compositor resolves only declared layer kinds
and keeps one stable scene group per descriptor. Rendering code must preserve
the descriptor's identity, truth class, and authority.

The contract is fail-closed:

- no descriptor means no layer;
- no layer state means `absent`;
- failed appearance remains failed;
- a structural proxy is never substituted for captured appearance;
- a fixture is rendered only when explicitly declared as a fixture source;
- generated content is never substituted for missing captured evidence; and
- diagnostic placement or source extents are never promoted to room geometry
  or collision.

## Grand Hall evidence boundary

The visible Grand Hall appearance and the source-envelope diagnostic are
separate layers with separate claims. Captured appearance is the visual room
evidence. The structural-proxy renderer draws only source-extent wire boxes and
an unreviewed diagnostic spawn marker; its declared claim is
`source_extent_not_room_shell`.

That diagnostic is not a wall, floor, doorway, portal, room shell, measured
alignment, or collision mesh. It must remain hidden outside the explicitly
selected structural-proxy QA view. Nothing in this v0 manifest contract claims
that Grand Hall collision or measured structural alignment exists.

## Compatibility and versioning

`room-scene-manifest/v0` is additive to existing runtime-package and venue
contracts. It references runtime identity and existing transform artifacts; it
does not replace asset admission, digest verification, authenticated delivery,
or the authoritative rights/quality systems those pipelines already use.

Changes to field meaning, truth classes, layer slots, reference rules, or
authority constraints require a new schema version. Adding records within the
existing closed contract does not justify weakening parse-time validation or
inventing missing layer content.
