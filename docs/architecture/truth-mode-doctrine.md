# Truth Mode Doctrine: Trust Inspection, Trust Workflow, and Trust Infrastructure

Status: Active planning doctrine
Date: 2026-04-30
Source: TRUTH-DR-2026-04-30
Depends on: D-009, D-011, D-012, D-014, D-015, D-019, D-024

## Purpose

Truth Mode is Venviewer's trust interface. It is not merely a debug overlay and it is not a single confidence heatmap. Its job is to expose the epistemic state of venue reality: what was scanned, measured, inferred, AI-generated, manually edited, artist-proxied, verified, stale, contested, intentionally suppressed, or unknown.

Truth Mode exists to prevent false confidence in photoreal digital twins. Photoreal rendering can make inferred or generated regions feel measured. Truth Mode must make the boundary visible without making normal planning unusable.

Truth Mode serves multiple users:

- Planners need to know whether a layout decision rests on trustworthy room geometry.
- Hallkeepers need to know what has been verified for operational use.
- Developer and QA users need to inspect alignment, provenance, asset authority, and known failures.
- Clients need to understand real-vs-proposed without being buried in diagnostics.

## Product Shape

Truth Mode grows in three layers:

1. **Trust inspection:** users can inspect what the system knows and why.
2. **Trust workflow:** hallkeepers and operators can approve, contest, expire, and recheck venue facts.
3. **Trust infrastructure:** signed provenance, audit bundles, export assertions, anomaly detection, and collaborative review become part of the substrate.

## Progressive Disclosure

| Level | Surface | Purpose | Default audience |
|---|---|---|---|
| L1 | Persistent viewport trust indicator | Always show the current trust posture without opening a panel. | Everyone |
| L2 | Popover summary | Explain the selected region/object in plain language: source, verification, confidence band, freshness, and authority. | Planners, clients, hallkeepers |
| L3 | Provenance drawer / evidence chain | Show capture source, transform artifact, Scene Authority Map entry, QA metrics, edits, reviewer, and verification state. | Hallkeepers, QA, advanced planners |
| L4 | Raw manifest / signed artifact / audit bundle | Expose raw manifest entries, signed bundle references, hashes, attestations, and exportable audit material. | Developers, auditors, enterprise review |

L1 and L2 are product surfaces. L3 and L4 are inspection and audit surfaces. Normal users must never need L4 to make a planning decision.

## Persona Presets

| Preset | Default visibility | Main question | Truth layers shown by default | Hidden until requested |
|---|---|---|---|---|
| Planner Lite | L1 trust indicator plus L2 on click. | "Can I trust this part of the room enough to plan here?" | Confidence band, verification label, stale/contested warning, real-vs-proposed state. | Raw hashes, full provenance graph, per-pass QA, transform matrices. |
| Hallkeeper Verification | L1 plus worklist and L3 drawer. | "What needs approval, recheck, or contesting before this layout is operational?" | Verification state, expiry, changed-since-last-review, egress/constraint assumptions, reviewer trail. | Raw bundle internals unless opening audit evidence. |
| Developer / QA Debug | L1, L2, L3, and optional L4. | "Which layer owns this region, how was it produced, and what failed?" | Scene Authority Map, layer authority, alignment/debug status, confidence metrics, provenance chain, known issues. | None, except very large raw payloads loaded on demand. |
| Client Real-vs-Proposed | Minimal L1 plus simple L2 language. | "Which parts are the real venue and which parts are proposed event design?" | Real venue, proposed layout, enhanced/proxy badge when relevant, high-level verified/stale warning. | QA numbers, internal method names, raw manifests, implementation detail. |

Presets change defaults only. They do not fork the data model.

## Multi-Axis Truth Model

Truth state MUST NOT collapse into one enum. A region can be `scan_observed`, `verified`, `layout_grade`, `fresh`, owned by an E57 mesh for geometry, owned by splat for appearance, and still have a manually authored material. One field cannot safely represent that.

Every Truth Mode region or object must be able to answer these axes:

- **Evidence/source state:** how the visible or operational asset was produced.
- **Verification state:** whether a competent person or automated gate accepted it for a use.
- **Confidence tier:** what level of measurement or operational certainty applies.
- **Staleness/freshness:** whether the fact may have expired since capture or review.
- **Scene Authority Map references:** which layer/asset owns geometry, appearance, lighting, physics, semantic, interaction, and export authority.
- **Provenance references:** capture source, processing lineage, manual edits, signer, reviewer, and transform artifacts.
- **Known-unknown / observed-empty distinction:** "we observed this region and it is empty" is not the same as "we have no evidence."

## Evidence / Source Vocabulary

Minimum source vocabulary:

- `scan_observed`: directly observed in capture data.
- `sensor_fused`: combined from multiple measured sensors or capture modalities.
- `denoised`: derived from observed data by noise removal.
- `hole_filled`: deterministic or reviewed fill of missing measured data.
- `ai_inferred`: inferred by model or algorithm from measured context.
- `ai_generated`: generated without measurement-grade evidence for that region.
- `human_edited`: edited by a human from measured or inferred source.
- `artist_proxy`: authored proxy asset used as the honest production authority for difficult regions.
- `procedural_runtime`: generated at runtime from deterministic rules or parameters.
- `known_unknown`: known gap or uncertainty; do not imply the system observed content.
- `measured_empty`: observed region confirmed empty at capture or review time.

`known_unknown` and `measured_empty` must remain distinct. This is load-bearing for event setup, egress clearance, back-of-house checks, and heritage fixtures.

## Verification Vocabulary

Minimum verification vocabulary:

- `unverified`: no accepted review or automated gate for the current use.
- `verified`: accepted for the declared use and confidence tier.
- `contested`: disputed by a user, reviewer, metric, or contradictory source.
- `expired`: previously verified but past its configured validity window.
- `suppressed`: intentionally ignored or hidden from an output, with a required reason.

`suppressed` is not deletion. Suppressed facts remain auditable and must explain who suppressed them, why, and for which output scope.

## Confidence and Staleness

Confidence uses D-011 bands, not false precision. Normal users see categorical confidence bands such as survey, ops, layout, appearance-only, or unknown. Developer/QA users may inspect raw metrics when they exist.

Verification decay is configurable by object or region class:

| Region/object class | Example decay policy |
|---|---|
| Movable furniture | Short expiry; recheck when layout changes or furniture is moved. |
| Permanent architecture | Long expiry; recheck after capture refresh, venue works, or contested review. |
| Heritage fixtures | Recheck after capture refresh or specialist review; never silently upgrade to measured. |
| Event layouts | Expire after the event or when a new submitted layout version supersedes it. |
| Egress/constraint assumptions | Expire on layout change, rule change, venue policy update, or authority-map change. |

No universal timer is acceptable. A chair, a wall, a chandelier, and a fire-exit clearance assumption age differently.

## Visual Encoding Principles

Truth Mode visual encoding must be legible, restrained, and accessible:

- Use categorical hue for source/provenance class.
- Use saturation, luminance, or a soft gradient for confidence.
- Use hatch, stipple, outline, icon shape, or line treatment for accessibility and known-unknowns.
- Use badges/glyphs on demand, not as always-on visual clutter.
- Do not use transparency alone as uncertainty.
- Avoid always-on per-Gaussian heatmaps for normal users.
- Keep at most two simultaneous visual channels on by default.
- Preserve the user's ability to keep planning; Truth Mode should reveal trust state, not turn the venue into a diagnostic screen.

Known-unknown regions should have a visibly different pattern from low-confidence observed regions. They are epistemically different.

## Token Requirements

Truth colors and marks must come from semantic design tokens, not hardcoded component-local colors. The first implementation task must add token names for at least:

- `observed`
- `fused`
- `inferred`
- `aiGenerated`
- `humanEdited`
- `artistProxy`
- `verified`
- `contested`
- `stale`
- `knownUnknown`

Each token must include non-color encoding guidance: hatch/stipple/outline/icon shape or line style. Accessibility cannot depend on color vision.

The token home should align with the existing shared design-token posture in `packages/types/src/design-tokens.ts`, with web renderers importing or mapping from shared tokens rather than inventing a second palette.

## Phase Plan

### Truth Mode v0 / T-091C

Scope:

- Mesh-only mode.
- Splat-only mode.
- Hybrid mode.
- Basic authority/confidence/provenance overlay.
- Alignment/debug status.
- Known-issues panel.

Purpose: make T-091B/T-091C honest. This phase is allowed to be feature-flagged and developer/hallkeeper oriented. It must warn or label where provenance is incomplete; it must not globally block hallkeeper exports on generated provenance yet.

### Truth Mode MVP / trust inspection

Scope:

- Persistent trust indicator.
- Truth Mode toggle.
- Truth legend.
- Click-to-provenance popover.
- Threshold/filter control.
- Exportable audit bundle stub.

Purpose: turn the debug surface into the first customer-understandable trust interface.

### Truth Mode v1 / trust workflow

Scope:

- Hallkeeper verification worklist.
- Approve/contest annotations.
- Verification expiry.
- Compare current vs previous state.
- Role-based presets.

Purpose: make trust operational. Venue staff can keep the digital twin honest over time.

### Truth Mode v2 / trust infrastructure

Scope:

- Full provenance graph.
- Signed proof bundle.
- C2PA-style export assertions.
- Anomaly/contradiction detection.
- Collaborative review sessions.

Purpose: make trust portable, auditable, and enterprise-grade.

## Guardrails Against Hallucination and False Confidence

- Do not show "94.2% confident" style false precision to normal users.
- Use categorical confidence bands by default.
- Legal, fire, survey, and operational claims must not exceed measured certification.
- A signed provenance chain proves chain-of-custody for recorded artifacts. It does not prove the physical world was honest at capture time, that the scene has not changed since capture, or that a generated/proxy region is measured.
- AI-generated and artist-proxy regions can be legitimate product assets, but they must be labeled honestly and must not be silently used for measurement-grade claims.
- "Photoreal" is not a trust state.

## Relationship to Existing Architecture

- D-009 defines the layer graph that Truth Mode inspects.
- D-011 defines the spatial confidence budget used by the confidence axis.
- D-012 defines provenance separation and the original truth/imagination/hybrid boundary.
- D-014 defines signed artifact bundles and QA outputs.
- D-015 defines capture certification tiers.
- D-019 defines the VSIR-0 schema and detached attestation posture.
- D-024 defines Scene Authority Map and TransformArtifactV0 references.

This doctrine refines those documents into the product contract for trust inspection, workflow, and infrastructure. It does not implement runtime UI, database schema, C2PA integration, or per-Gaussian metadata.
