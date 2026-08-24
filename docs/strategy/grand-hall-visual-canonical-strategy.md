# Grand Hall visual canonical strategy

Status: canonical direction
Applies to: the individual Trades Hall Grand Hall
Baseline reviewed: `4c7a34bd7bbe77d16bf36c4c82354737073a497a`

## Decision

Venviewer is building a venue visual compositor, not a single-format splat viewer. The Grand Hall master and its browser derivatives may use different representations. Venviewer owns the provider-neutral scene, transforms, evidence, derivatives and publishing decisions; XGRIDS and Matterport are authorised source providers, not the canonical scene schema.

The current exact Grand Hall frontier remains the immutable captured-appearance baseline. No procedural room shell, invented opening, generated floor, neighbouring room, or exterior image may contribute architectural pixels to this room unless a later manifest declares a separately reviewed layer with explicit provenance and authority.

## Current facts that must be preserved

- The selected source is the pinned eleven-member depth-5 SOG frontier from `Grand_Hall.lcc2`: 106,479,738 compressed bytes and 6,019,684 Gaussians.
- Member order, filename, byte length, SHA-256, hierarchy receipt and decoded Gaussian count are verified before attachment.
- All members stay invisible and detached until the complete frontier succeeds; mismatch, timeout or stale lifecycle state disposes the whole set and leaves architecture blank.
- The current transform is a source-derived inspection transform at scale 1. It is not signed metric alignment and cannot authorise measurements, collision or planning.
- Grand Hall procedural architecture, ink, furniture, planning overlays and operational claims remain disabled until reviewed room-local structural evidence exists.
- The exterior facade remains preserved as a separate venue-presentation asset. It is out of scope for the individual-room runtime and must not be merged into Grand Hall geometry.

## Target room scene

`GrandHallScene` is a spatially registered composition with independently governed layers:

| Layer family | Purpose | Authority rule |
| --- | --- | --- |
| Structural authority | Shell, floor, openings, collision, navigation, portals, cutaway groups and planning boundaries | Only reviewed metric evidence may drive planning; a splat-derived proxy must be labelled reconstructed and replaceable. |
| Captured appearance | Immutable XGRIDS baseline and future photo-derived masters | Visual authority; never overwritten by an enhancement or generated derivative. |
| Hero volumes | Bounded high-detail chandelier, painting, timber, ceiling, gilding or fireplace representations | Cross-fade only inside declared bounds with source lineage and quality evidence. |
| Material and lighting | Normals, albedo, roughness, masks, environment and physical-light metadata | Descriptive unless separately reviewed; cannot silently change spatial authority. |
| Semantic scene graph | Room, bays, openings, heritage features, zones, lights, furniture and interactions | References authoritative spatial layers; does not manufacture geometry authority. |
| Generated derivatives | Repair, super-resolution, relighting and director states | Optional and visibly classified; never measurement, collision or captured-master authority. |
| Planner layers | Editable tables, chairs, stages, routes, evidence and event state | Procedural application state, separate from every visual derivative. |
| Runtime derivatives | Ultra, High, Standard, Mobile, Client-safe and Cinematic packages | Derived directly from a declared master with retained lineage and quality evidence. |

The web viewer should consume a typed `RoomScene` composition contract and mount only layers that actually exist. The current exact loader should become the Grand Hall `AppearanceLayer` adapter without weakening its immutable admission contract.

## Truth classes

Every spatial or visual layer must declare exactly one class:

- `MEASURED`: reviewed geometry, scale, opening or spatial control. It may drive planning only within its reviewed scope.
- `CAPTURED`: directly derived from real imagery or sensor observations and eligible to be visual authority.
- `RECONSTRUCTED`: inferred between observations; it requires confidence and provenance and is not measured by implication.
- `ENHANCED_CAPTURED`: observation-backed refinement whose source imagery and derivation remain traceable.
- `GENERATED_CINEMATIC`: synthetic or extrapolated pixels; never silent measurement, collision or planning authority.
- `PROCEDURAL_PLANNER`: editable Venviewer objects and overlays.

Implementation should reconcile these labels with the existing Foundry provenance vocabulary, `RuntimeVenueManifestV0`, `TransformArtifactV0` and Scene Authority Maps. `MEASURED` is a truth class, not a self-executing authority grant: planning or collision still requires explicit authority, spatial registration, scope, and reviewed evidence. Visually aligned data cannot be upgraded into metric truth by label alone.

## Layer authority and failure rules

1. Geometry, appearance, lighting, physics, semantics, interaction and export authority are assigned independently.
2. A visual splat never supplies collision, floor following, portals or room bounds by default.
3. A generated or enhanced layer cannot overwrite its captured parent or increase lineage truthfulness.
4. Missing layers remain absent; placeholders may exist in types but must not emit pixels or claims.
5. Transform registration uses reviewed artifacts. Radiance bounds may frame a camera but are not structural containment.
6. The Room Resolves remains driven by the aggregate state of every visible declared layer. Missing, failed, partial, or zero-unit-ready layers remain visible as such; proxy, appearance, hero, semantic, and planner truth are never substituted for one another.

## Lineage diagnosis gate

No generative pixels enter the Grand Hall runtime before deterministic fixed-camera comparisons establish where quality is lost. Store identical camera descriptions for native LCC reference, highest-quality Gaussian PLY, SOG, SPZ, an independent viewer and Venviewer. Cover a chandelier, painting/frame, carved timber, ceiling ornament, fireplace or other major detail, plain wall, room-wide view and difficult oblique view.

Record source label, asset lineage and format, camera transform, resolution, DPR, Spark settings, splat budget, filtering, screenshot, timing, asset size and available GPU/frame data. Interpret results before selecting repair:

- sharp master but soft runtime: fix encoding or renderer;
- soft master: improve capture or reconstruction;
- isolated hero weakness: recapture or build a bounded Hero Volume.

NHT, 3DGUT, Fixer, ArtiFixer, Gaussian super-resolution and relighting remain research or polish lanes until this gate is complete. Third-party code and model-weight licences remain separately auditable even though project-specific Matterport and XGRIDS rights are owner-confirmed.

## Rights and provenance

The supplied authority record retains the owner statement verbatim:

`Authority status: confirmed by project owner`

`Scope: data use, reconstruction, training, enhancement, derivatives, commercial Venviewer development, reverse engineering and software integration`

The same record explicitly retains redistribution and third-party dissemination permission. This project-specific authority is not an active technical blocker. `state/source_rights.json` is the typed append-only project ledger, additive to the existing Foundry rights/provenance systems; it preserves revision history and a documentary-evidence-location field. The documentary attachment remains pending, and unrelated code, SDK, research implementation, model-weight, checkpoint, and provider licences remain separately reviewable.

## Dependency-aware programme

1. `T-541`: fixed-camera master/runtime lineage diagnosis and compositor slice.
2. `T-542`: reviewed source-derived structural proxy, transform evidence, collision, navigation, portals and cutaway groups.
3. `T-543`: professional RAW/HDR/material and hero-feature capture. This may proceed in parallel with `T-542` after `T-541`.
4. `T-544`: controlled captured-master bake-off: XGRIDS, 3DGUT+SH, 3DGUT+NHT, gsplat and portability candidates.
5. `T-545`: one bounded Hero Volume pilot, after structural/capture/bake-off inputs are ready.
6. `T-546`: materials and lighting understanding.
7. `T-547`: blind, identity-preserving generative repair evaluation.
8. `T-548`: direct-from-master browser runtime distillery.
9. `T-549`: provider-neutral Foundry automation and optional historical XGRIDS adapter work.

The immediate frontend slice is limited to the typed composition contract,
compositor adapters, one truthfully labelled source-envelope and
diagnostic-navigation witness, and the deterministic lineage harness. It must
not invent assets or start unrelated GPU training.
