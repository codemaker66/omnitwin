# RoomScene compositor

Status: Implemented v0 vertical slice

Date: 2026-08-23

Runtime contract: `packages/types/src/room-scene-manifest.ts`

Composition policy: `packages/web/src/lib/room-scene-composition.ts`

Scene mount: `packages/web/src/components/scene/RoomSceneCompositor.tsx`

## Purpose

`RoomSceneCompositor` mounts only layers declared by a validated
`RoomSceneManifestV0`. It keeps evidence classes separate while a user changes
presentation. The compositor does not infer a room shell, manufacture a missing
layer, or replace a failed layer with a visually convenient alternative.

This is a thin runtime read model. It does not activate the proposed general
spatial-graph architecture, replace runtime-package admission, or create
geometry, collision, semantics, planner content, or cinematic derivatives.

## Fixed layer slots

The v0 manifest has exactly seven layer kinds. These are the only compositor
slots:

| Slot | Runtime responsibility | Current presentation selection |
|---|---|---|
| `Appearance` | Declared visible appearance, such as captured radiance. | `appearance` |
| `StructuralProxy` | Explicit structural or diagnostic proxy. Its authority is only what its descriptor declares. | `structural-proxy` |
| `Collision` | A separately evidenced collision representation. | Not selected by either v0 presentation. |
| `HeroVolume` | A declared high-detail visual volume. | `appearance` |
| `Semantic` | Declared semantic visualization. | `appearance` |
| `Planner` | Procedural planner content with planner truth. | Not selected by either v0 presentation. |
| `CinematicDerivative` | A declared generated or derived cinematic visual. | Not selected by either v0 presentation. |

The list is closed. A material attachment, lighting variant, runtime
derivative, source envelope, or transport resource is not an eighth layer
kind. Materials and lighting use typed supplemental records that target real
declared layers and preserve source/truth/rights/evidence/registration. Typed
reconstruction and enhancement provider records are integration capability
metadata, not active implementations. If a real layer or supplemental asset is
not declared, it is absent. The current Grand Hall manifest leaves every
provider, material, and lighting collection empty.

The current resolver supports two presentation values:

- `appearance` selects declared `Appearance`, `HeroVolume`, and `Semantic`
  descriptors, in manifest order.
- `structural-proxy` selects declared `StructuralProxy` descriptors, in
  manifest order.

`Collision`, `Planner`, and `CinematicDerivative` descriptors still receive
stable scene groups if declared, but the current two-mode resolver leaves those
groups hidden. A later presentation mode must be explicit and tested; it must
not be inferred from `visibleByDefault`.

## Truth classes are not interchangeable

Every layer carries one of the six uppercase truth classes defined by the
manifest contract:

| Truth class | Contract posture |
|---|---|
| `MEASURED` | Measurement-derived evidence class. The label alone does not prove registration, accuracy, or authority. |
| `CAPTURED` | Captured visual evidence. The schema prevents it from silently owning geometry, collision, navigation, planning, or export authority. |
| `RECONSTRUCTED` | A reconstruction from source evidence. Its permitted use still depends on declared authority, registration, and quality evidence. |
| `ENHANCED_CAPTURED` | Captured appearance with enhancement. It has the same operational-authority restriction as `CAPTURED`. |
| `GENERATED_CINEMATIC` | Generated display content. It may declare only appearance or lighting authority. |
| `PROCEDURAL_PLANNER` | Explicit planner content. Every `Planner` layer must use this truth class. |

Truth class, authority, spatial registration, quality evidence, and rights are
independent declarations. A truth-class label must never be treated as proof of
measured alignment, a reviewed room-local transform, a navigable floor, or a
collision surface.

The schema binds operational authority to reviewed metric evidence:
geometry requires at least human-reviewed `layout_grade`, while collision,
navigation, planning, and export require human-reviewed `operations_grade` or
`survey_grade`. Collision authority is valid only on `Collision`, and
diagnostic navigation only on `StructuralProxy`; changing `kind` cannot bypass
the evidence gate.

## Composition algorithm

`resolveRoomSceneComposition(manifest, context)` is the only v0 visibility
policy:

1. Map the requested presentation to its allowed layer kinds.
2. Filter `manifest.layerDescriptors` by those kinds, preserving manifest
   order.
3. Return the matching descriptors and IDs as the visible composition.
4. Aggregate the state of every matching visible descriptor. Sanitize and
   clamp each descriptor's counters, then sum loaded and total units.
5. Resolve aggregate status with fail-closed precedence: `failed`, `absent`,
   `loading`, then `ready`. A missing state entry contributes `absent`.
6. If there is no matching descriptor, report `absent` with zero loaded and
   total units.

The resolver does not inspect another layer in search of a fallback. In
particular, a failed `Appearance` layer remains failed; a ready
`StructuralProxy` does not become visible in its place.

## Stable scene mount

`RoomSceneCompositor` receives the validated manifest, resolved composition,
and a typed `renderLayer` callback. It creates one stable child group for every
declared descriptor, whether visible or hidden. Each group is keyed by layer
ID, named `room-scene-layer:<kind>:<id>`, and exposes the descriptor's layer ID,
kind, truth class, and authorities through `userData`.

Changing presentation changes group visibility; it does not remap layer
identity or truth. The outer group exposes the manifest ID and schema version.
This stable mount is important for renderers whose resource lifetimes and
callback identities must survive evidence-view changes.

`renderLayer` is a renderer adapter, not a licence to improvise. It must render
the declared source for the descriptor or return no content/report failure. It
must not synthesize architecture, use a procedural room in place of captured
appearance, or use a proxy as captured pixels.

## Fail-closed and no-substitution rules

The following rules are normative for every caller and renderer adapter:

- Resolve and render only descriptors present in the validated manifest.
- Treat an undeclared layer and a missing layer-state entry as `absent`.
- Keep a failed layer failed. Do not reveal another truth class as fallback.
- Do not promote `visibleByDefault` into evidence or operational authority.
- Do not promote `inspection_placement` into measured alignment.
- Do not treat a visual or diagnostic envelope as a room shell, floor, wall,
  doorway, portal, navigation mesh, or collision mesh.
- Do not make planning, measurement, clearance, export, or safety claims from
  captured appearance alone.
- If a layer renderer is unavailable, leave that layer blank/failed and expose
  the failure through actual layer state.

These rules deliberately permit an honest blank or diagnostic failure state.
They prohibit a plausible but false room.

## Captured appearance versus source-envelope QA

The normal Grand Hall view is the declared captured `Appearance` layer. Its
purpose is visible captured appearance; it is not structural or collision
authority. Appearance and the QA proxy share the same declared
`inspection_placement` binding because the runtime applies that diagnostic
source placement to both; this records composition, not metric registration.

`GrandHallStructuralProxyLayer` is a separate QA-only renderer. It draws
wireframe boxes for source extents and an unreviewed diagnostic spawn marker.
Its own metadata says `source_extent_not_room_shell`. The component explicitly
disclaims walls, floors, doors, portals, and structural-model status, and it is
hidden unless the `structural-proxy` evidence view is selected.

The source-envelope view therefore answers only a diagnostic question about
the extent of supplied source evidence. It does not establish the Grand Hall's
layout, topology, dimensions, room-local alignment, walkable surface, or
collision. No current compositor behavior may describe it as measured.

## Actual load state and Room Resolves

Layer state has four values:

| State | Meaning |
|---|---|
| `absent` | No visible declared layer, or at least one visible descriptor has no actual state entry. |
| `loading` | A declared layer is loading; `loadedUnits` and `totalUnits` come from the renderer. |
| `ready` | The declared layer has completed its required load policy. |
| `failed` | The declared layer failed; partial and total units remain visible. |

`layerStateForRoomResolve` adapts that state without fabricating progress:

- `absent` becomes no asset, no chunks, and `atomicReady: false`.
- `loading` becomes an existing asset with actual progress and
  `atomicReady: false`.
- `ready` becomes an existing asset with actual progress and
  `atomicReady: true`.
- `failed` keeps the actual progress, reports at least one failed unit, and
  keeps `atomicReady: false`.
- a nominal `ready` state with zero total units or incomplete loaded units is
  invalid and is converted to a failed Room Resolves input.

For an atomic appearance asset, `ready` means the complete declared atomic set
is ready. Partial availability must remain `loading` or `failed`; it must not be
presented as the complete room.

## Non-goals

- No inferred room geometry or portal topology.
- No measured-alignment, dimensional-accuracy, navigation, or collision claim.
- No automatic truth-class conversion.
- No procedural fallback for missing captured data.
- No renderer or transport URL inside the canonical manifest.
- No activation of generated cinematic content without a declared layer and
  supporting evidence.
- No expansion beyond the seven v0 slots.

## Change discipline

Any change to slot names, truth classes, selection policy, or load-state
semantics requires a versioned contract change and regression tests in both
`@omnitwin/types` and the web compositor. Adding a real layer requires its
descriptor, source, rights/evidence references, renderer adapter, actual load
state, and an explicit presentation policy. Missing parts must fail closed.
