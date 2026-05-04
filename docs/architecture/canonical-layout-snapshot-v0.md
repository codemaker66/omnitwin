# Canonical Layout Snapshot v0

Status: Planning specification  
Date: 2026-05-01  
Source: LPO-001  
Depends on: Layout Proof Object doctrine, T-159 Layout Proof Object vocabulary

## Purpose

Canonical Layout Snapshot v0 is the immutable layout input that future Layout Proof Objects evaluate. It is not the live planner store, not a database row by itself, and not a proof object. It is the deterministic evidence subject: a frozen representation of one event layout, in one venue/space/runtime context, under one set of scenario assumptions.

The current editor store already has the raw live state needed to create a snapshot: `configId`, `venueId`, `spaceId`, `objects`, `isDirty`, and per-object transforms in `packages/web/src/stores/editor-store.ts`. The database holds the persisted version through `configurations`, `placed_objects`, `spaces`, `asset_definitions`, and related metadata in `packages/api/src/db/schema.ts`. A canonical snapshot must be produced from persisted, saved state, not from unsaved interactive UI state.

## 1. Subject of the Snapshot

The subject is one immutable event layout snapshot for a single configuration in one venue space.

V0 subject fields:

- `schemaVersion`: fixed string, proposed `layout_snapshot.v0`
- `configurationId`
- `venueId`
- `spaceId`
- `layoutName`
- `layoutStyle`
- `visibility`
- `guestCount`
- `createdFromConfigurationUpdatedAt`
- `createdBy` when available
- `snapshotCreatedAt`
- `sourceState`: `saved_configuration`, `submitted_configuration`, or `approved_configuration`

The snapshot should only be generated from a saved configuration state. If `editor-store.isDirty === true`, the UI may show "unsaved changes" and refuse evidence generation until save succeeds.

## 2. Layout Object Identity Rules

Every layout object in the snapshot must have a stable persisted identity.

Rules:

- `objectId` is the persisted `placed_objects.id`.
- Temporary client IDs such as `local-1` are not allowed in a proof snapshot.
- `assetDefinitionId` is required and references the object type being placed.
- The snapshot should copy validator-relevant asset dimensions from `asset_definitions` at snapshot time: `widthM`, `depthM`, `heightM`, `seatCount`, `collisionType`, and `category`.
- `groupId` from placed-object metadata is allowed, but it is not a substitute for object identity.
- `sortOrder` is display/order metadata only. It must not define identity or canonical ordering.
- Deleting and recreating an object creates a new `objectId`, even if the visible pose and asset are identical.

This preserves the distinction between planner state and proof state: the planner can keep local editable objects, but evidence only evaluates saved objects with durable IDs.

## 3. Object Pose Representation

V0 uses the existing editor/database pose model:

- position: `{ x, y, z }`
- rotation: `{ x, y, z }`
- scale: uniform scalar

Coordinate convention:

- `x`: horizontal floor-plan axis in metres
- `y`: vertical height in metres
- `z`: floor-plan depth in metres
- floor containment maps `{ x: positionX, y: positionZ }` into `spaces.floorPlanOutline`, matching `packages/api/src/lib/placement-validation.ts`
- rotations are radians
- scale is a uniform scalar

V0 does not introduce matrices for placed event objects. Transform artifacts remain the right mechanism for runtime/capture asset alignment, but layout object poses continue to use the existing planner pose fields until a separate ADR changes the editor model.

Canonical pose precision:

- position: round to 3 decimal places (millimetres), matching `placed_objects.position_*` scale
- rotation: round to 5 decimal places, matching `placed_objects.rotation_*` scale
- scale: round to 3 decimal places, matching `placed_objects.scale` scale

## 4. Units

The snapshot must explicitly declare units:

- `lengthUnit`: `metre`
- `angleUnit`: `radian`
- `timeUnit`: `ISO-8601 UTC timestamp`
- `currency`: `GBP` when budget evidence is requested

No validator may infer units from field names alone.

## 5. Tolerance Policy

The snapshot must include a tolerance policy used for canonicalization and validator interpretation.

V0 tolerance fields:

- `positionPrecisionM`: `0.001`
- `rotationPrecisionRad`: `0.00001`
- `scalePrecision`: `0.001`
- `floorContainmentToleranceM`: proposed `0.01`
- `clearanceToleranceM`: proposed `0.01`
- `currencyPrecisionMinorUnit`: `1`

Canonical precision and validator tolerance are related but not identical. Canonical precision determines byte-stable serialization; validator tolerance determines whether a layout passes a rule near a boundary.

## 6. Event Metadata

V0 should include only event metadata that can affect validation, operations, or pricing.

Fields:

- `eventType`
- `guestCount`
- `layoutStyle`
- `preferredDate` or event date when known
- `startTime` / `endTime` when known
- `accessibilityRequirements`
- `dietarySummary`
- `doorSchedule`
- `dayOfContact`
- `phaseDeadlines`
- `specialInstructions`

These map to `configurations.guestCount`, `configurations.layoutStyle`, and `configurations.metadata` / `ConfigurationMetadataSchema`. Free-text fields can be included as evidence context but should not silently affect deterministic validators unless a validator explicitly cites them.

## 7. Scenario Assumptions

Scenario assumptions are explicit inputs to evidence. They should use the T-159 categories:

- `event_type`
- `guest_count`
- `seating_style`
- `accessibility_profile`
- `service_model`
- `staffing_model`
- `load_in_model`
- `pricing_model`
- `tolerance_policy`
- `time_window`

Each assumption should include:

- `category`
- `value`
- `source`: `planner_input`, `venue_default`, `policy_bundle`, `system_default`, or `human_reviewer`
- `sourceReference` when available

Assumptions must not be hidden in validator code. If a validator depends on an assumption, the snapshot or policy bundle must expose it.

## 8. Venue and Runtime Package Reference

The snapshot must reference the venue and space truth it was evaluated against.

V0 fields:

- `venueId`
- `venueSlug`
- `spaceId`
- `spaceSlug`
- `spaceName`
- `floorPlanOutline`
- `floorPlanOutlineDigest` once digest helpers exist
- `spaceDimensions`: width, length, height in metres
- `roomGeometrySource`: `space_floor_plan_outline`, `hand_authored_room_geometry`, or `runtime_manifest`
- `runtimeVenueManifestDigest`: nullable in v0 until T-091 real runtime manifests exist
- `runtimePackageId`: nullable in v0 until VSIR/runtime packages exist

For current code, the authoritative persisted 2D shape is `spaces.floorPlanOutline`. `packages/web/src/data/room-geometries.ts` has hand-authored render geometry for Trades Hall rooms and a fallback resolver, but proof snapshots should treat the persisted space polygon as the floor-plan validation source unless a runtime manifest explicitly supersedes it.

## 9. Policy Bundle Reference

The snapshot should cite a policy bundle even before policy bundles are fully implemented.

V0 placeholder fields:

- `policyBundleId`
- `policyBundleDigest`
- `policyBundleVersion`
- `effectiveFrom`
- `effectiveTo`
- `jurisdiction`
- `venueRuleSet`
- `humanReviewRequiredFor`

Until structured policy bundles exist, v0 can use a documented placeholder bundle such as `trades-hall-planning-draft-v0`, but the snapshot must clearly identify it as draft planning policy rather than legal compliance policy.

## 10. Generator Provenance

If a layout was AI-generated or AI-assisted, the snapshot must include generator provenance.

Fields:

- `generatorType`: `human`, `ai_generated`, `ai_assisted`, `template`, or `imported`
- `generatorName`
- `generatorVersion`
- `promptDigest` when applicable
- `sourceTemplateId` when applicable
- `humanEditedAfterGeneration`: boolean
- `generatedAt`

This supports the Layout Proof Object doctrine: AI generators are untrusted proposers; deterministic validators provide checked status.

## 11. Deterministic Ordering Rules

Canonical order must not depend on database return order, editor array order, or JavaScript object insertion order.

V0 ordering:

- top-level object keys sorted lexicographically
- layout objects sorted by `objectId`
- metadata arrays sorted only when order is semantically irrelevant
- `floorPlanOutline` preserves polygon vertex order because geometry depends on it
- `doorSchedule` sorts by door ID/name and then chronological event time
- object metadata keys sorted lexicographically
- scenario assumptions sorted by `category`, then `source`, then stable stringified `value`

Array ordering must be documented field-by-field. Sorting every array blindly would corrupt polygon winding, route order, and timeline semantics.

## 12. Canonicalization Options

Options considered:

- RFC 8785 / JCS canonical JSON: strong existing spec, but adds dependency and cross-implementation burden.
- Local stable JSON profile: small implementation surface, can match existing `configuration_sheet_snapshots.sourceHash` precedent, but must be specified tightly.
- DAG-CBOR or another binary canonical format: robust for content addressing, but overkill for v0 and adds tooling friction.

V0 recommendation: local stable JSON profile, implemented later as a small shared helper with tests. The profile should define key sorting, number rounding, timestamp normalization, null/undefined rules, array ordering, and UTF-8 byte encoding.

This is separate from D-019's DSSE posture. DSSE signs exact payload bytes and does not require JCS. Layout snapshots need deterministic serialization because the layout digest itself is a semantic content address.

## 13. Layout Digest Rules

Do not implement hashing in this design task.

Future implementation should compute:

- `canonicalBytes = utf8(stableCanonicalJson(snapshotWithoutDigest))`
- `layoutDigest = sha256(canonicalBytes)`
- digest format: lowercase hex, 64 characters
- optional domain separation prefix: `venviewer.layout_snapshot.v0\n`

The digest must exclude its own `layoutDigest` field. If the snapshot is stored together with its digest, the stored envelope should be:

- `snapshot`
- `canonicalization`
- `layoutDigest`
- `createdAt`

The digest identifies the evidence subject. It does not prove the layout is valid.

## 14. Staleness Triggers

A proof object or evidence pack tied to this snapshot becomes stale when:

- layout objects change
- object poses change
- object metadata relevant to validation changes
- configuration event metadata changes
- scenario assumptions change
- venue geometry or runtime package reference changes
- floor-plan outline changes
- asset definition dimensions/collision/category change
- policy bundle changes
- validator version or hash changes
- human review expiry passes

These map to the T-159 stale reason vocabulary:

- `layout_changed`
- `venue_geometry_changed`
- `policy_bundle_changed`
- `validator_changed`
- `scenario_changed`
- `event_metadata_changed`

Asset-definition changes should initially be folded into `layout_changed` if the snapshot copies validator-relevant asset fields. If future AssetVersion records become first-class, this can become a dedicated stale reason.

## 15. Non-Goals

- No hashing implementation in this task.
- No TypeScript snapshot schema in this task.
- No validator kernel implementation.
- No solver, navmesh, egress, accessibility, or budget witness implementation.
- No database tables or migrations.
- No runtime/editor behavior change.
- No public compliance, fire, legal, accessibility, or certification claim.
- No DSSE, W3C VC, C2PA, or COSE dependency.

## Implementation Follow-Up

The next implementation slice should add shared TypeScript/Zod schemas for this snapshot shape, fixture tests, and a stable canonicalization helper. It should still avoid validators and proof-object signing. A separate validator-kernel task should consume the snapshot only after the snapshot schema and digest rules are tested.

