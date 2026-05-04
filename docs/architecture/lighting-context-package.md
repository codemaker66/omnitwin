# Lighting Context Package and Probe Leakage Guard

Status: Active planning doctrine  
Date: 2026-05-01  
Source: LCP-001  
Depends on: D-024, Residual Radiance Layer, RuntimeVenueManifestV0, TransformArtifactV0
Relates to: Scene Authority Map, Truth Mode, object insertion, Residual Radiance Layer

## Purpose

A Lighting Context Package is the future runtime artifact that tells Venviewer how inserted objects should be lit inside a venue zone.

It should carry zone-scoped lighting volumes, local probe sets, cubemap influence regions, proxy volumes, provenance, and limitations. It must not be one building-wide lighting average. Venue interiors contain walls, windows, stages, bars, chandeliers, doorways, and lighting transitions; lighting interpolation that ignores those boundaries will make inserted objects look wrong and can create false confidence in the scene.

This doctrine is planning only. It does not implement renderer code, add dependencies, or change public copy.

## Renderer Boundary

The current Venviewer web runtime is on Three.js 0.180. Lighting Context Package doctrine must not assume newer renderer APIs such as future LightProbeGrid support from later Three.js releases.

The durable artifact should be renderer-agnostic first:

- spherical-harmonic probe samples
- local cubemap references
- influence volumes
- proxy volumes
- wall, portal, window, stage, bar, and doorway boundaries
- provenance, confidence, and limitations

Three.js, Spark, WebGPU, offline baking, or a future renderer adapter can consume that data later. The architecture commitment is the lighting data boundary, not a specific renderer feature.

## Probe Leakage Guard

Probe leakage happens when light probes or cubemaps influence an object through solid walls, across room boundaries, or across unrelated lighting zones.

The Lighting Context Package must include a Probe Leakage Guard:

- Use many room/zone-scoped lighting volumes, not one giant building-wide probe volume.
- Probes must not interpolate through solid walls.
- Inserted objects choose their lighting context by zone and influence membership, not by a global scene average.
- Probe influence must respect explicit room, wall, portal, stage, bar, window, and doorway boundaries.
- Dense probe clusters should be planned near light transitions such as windows, stages, fireplaces, bars, chandeliers, doorways, and service zones.
- Boundary failures must be inspectable in Truth Mode or QA tooling before any high-confidence object insertion claim.

If required lighting data is missing, the package follows the Data Sufficiency Contract: emit `degraded_evidence`, `not_checked`, `unsupported_request`, or `requires_human_review` rather than pretending object lighting is correct.

## Lighting Volumes

Lighting volumes are spatial regions in the Canonical Venue Frame that define which probes, cubemaps, lightmaps, or learned lighting approximations can influence objects.

Each volume should eventually declare:

- stable volume ID
- venue, space, and zone references
- coordinate frame and units
- convex hull, box, polygon prism, or mesh proxy bounds
- included probe IDs
- excluded wall/occluder references
- portal/connector references
- priority/order when volumes overlap
- purpose: object insertion, preview rendering, hero visualization, QA comparison, or fallback lighting
- confidence tier and provenance
- Scene Authority Map references
- Truth Mode disclosure state

Volumes should be small enough to respect real lighting transitions. Grand Hall should not be represented as one undifferentiated light field.

## Probe Placement Rules

Probe density should increase near lighting discontinuities and object-insertion risk areas:

- walls and corners
- windows and stained glass
- stages and dais edges
- doorways and portals
- bars and service counters
- chandeliers and pendant clusters
- fireplaces and reflective fixtures
- floral installations and tall decor zones
- boundary transitions between daylight, chandelier light, stage light, and darker service areas

Ordinary rooms need at least two vertical probe layers so inserted objects do not receive only floor-level or ceiling-level lighting.

Tall halls, chandeliers, floral installations, balconies, or high ceiling volumes need a third vertical layer. Trades Hall Grand Hall should be treated as a tall-hall case because chandelier and high-wall lighting materially affect object insertion.

## Local Cubemaps and Proxy Volumes

Local cubemaps are not global reflection answers.

Every local cubemap should have:

- an influence region
- a proxy volume used for parallax or reflection approximation where supported
- occluder or wall-boundary references where relevant
- blending rules when multiple cubemaps overlap
- a fallback behavior when no valid cubemap covers the inserted object
- provenance and capture/training reference

Cubemaps must not bleed across walls or zones simply because they are spatially nearby in Euclidean distance.

## Object Insertion Rules

Inserted objects must select lighting context in this order:

1. Explicit object/fixture lighting context override where available.
2. Current room/zone lighting volume membership.
3. Local probe influence volume membership.
4. Local cubemap influence region membership.
5. Declared fallback for the zone.

The renderer or runtime adapter must not use a building-wide lighting average for object insertion unless the package explicitly declares that the scene is a single lighting zone and QA has accepted that simplification.

If an inserted object intersects multiple lighting volumes, the package must provide deterministic blending or priority rules. If the object sits outside every known influence region, the product should show a low-confidence lighting state rather than pretending the object is correctly lit.

## Anti-Leakage Rules

The Lighting Context Package should make these checks possible:

- A probe on one side of a solid wall must not influence an inserted object on the other side unless an explicit portal/transparent boundary allows it.
- A window-adjacent probe should not dominate a deep-room object unless the influence region allows that falloff.
- Stage lighting should not leak into unrelated seating or bar zones without an explicit transition volume.
- Bar/service counter lighting should not light central-floor objects unless they share a zone or transition volume.
- Chandelier or floral-height probes should not override table-height insertion unless the object height intersects the relevant vertical layer.
- Cubemap blending must respect influence regions and proxy volumes, not nearest-probe distance alone.

## Truth Mode and QA Requirements

Truth Mode should eventually be able to show:

- active lighting zone for an inserted object
- probe/cubemap source and provenance
- influence volume boundary
- confidence tier
- fallback state when no valid lighting context exists
- wall-leakage or cross-zone warnings
- whether the object lighting is measured, inferred, artist-authored, or fallback

Normal users should see compact language such as "lighting matched to hall zone" or "lighting requires review." Developer/QA users can inspect raw probe IDs, volume bounds, leakage tests, and blending decisions.

## Failure Gates

An object-insertion lighting path fails if:

- it assumes a Three.js feature newer than the runtime without a verified adapter/fallback
- it uses one giant building-wide probe field for a multi-room or multi-zone venue
- probes interpolate through solid walls
- local cubemaps lack influence regions or proxy volumes
- inserted objects choose lighting by global scene average
- tall halls have only a single floor-level probe layer
- the system cannot explain which lighting context affected an inserted object
- disabling or changing lighting context makes the planning scene misleading without a visible low-confidence state

## Non-Goals

- No renderer implementation.
- No probe baking implementation.
- No dependency adoption.
- No WebGPU, Recast, path tracing, or custom shader commitment.
- No public marketing copy changes.
- No claim that object insertion lighting is production-ready.
