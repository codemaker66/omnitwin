# Venviewer Artifact Registry

Status: Active planning doctrine  
Date: 2026-05-01  
Source: VAR-001  
Depends on: D-014, D-019, D-024, Exposure Tier, Venue Claim Lifecycle Engine, Data Sufficiency Contract  
Relates to: Truth Mode, Proof-of-Reality, Layout Evidence Pack, Guest Flow Replay, Residual Radiance Layer, Scene Authority Map, License & IP Compliance Ledger, public copy safety

## Purpose

The Venviewer Artifact Registry is the governance model for Venviewer outputs, packages, evidence, reports, exports, and attestations.

Recent architecture work introduced many serious artifact families: RuntimePackage, Layout Evidence Pack, Scene Authority Map, TransformArtifact, Lighting Context Package, Photometric Chain-of-Custody, Residual Radiance assets, `.venreplay.zip`, Policy Bundle, validator witnesses, Truth Mode reports, C2PA/DSSE attestations, OpenUSD exports, and KHR-glTF exports. Without a shared artifact model, these can drift into disconnected files with inconsistent provenance, exposure, freshness, and claim relationships.

The Artifact Registry does not displace VSIR. VSIR remains the canonical venue truth/data model. The registry governs concrete artifacts produced from, attached to, or exported around that truth: their identity, purpose, hashes, exposure tier, freshness state, limitations, compatibility, and evidence/claim relationships.

This doctrine is planning only. It does not implement database tables, runtime code, storage layout, access control, dependencies, public copy, or package renames.

## Core Doctrine

- Every important output should eventually be represented as an artifact record.
- Artifacts are content-addressed or content-hashable where feasible.
- Artifacts declare purpose and limitations; they are not generic blobs.
- Artifacts cite source inputs so Truth Mode and audits can explain where they came from.
- Artifacts declare exposure tier before sharing or publication.
- Artifacts declare freshness state so stale evidence is not shown as current.
- Artifacts can be associated with claims and evidence without becoming those claims.
- Export artifacts are not internal truth. OpenUSD and KHR-glTF are interchange/export targets, not replacements for VSIR or Scene Authority Map.
- Attestations prove chain-of-custody over artifact payloads; they do not prove the physical world remains unchanged.

## Registry Fields

Each artifact record should eventually include:

| Field | Meaning |
|---|---|
| `artifactId` | Stable identifier for the artifact record. May be generated before content hash is available. |
| `artifactType` | One of the governed artifact families. |
| `schemaVersion` | Version of the artifact schema, not the application version. |
| `purpose` | Declared reason for the artifact: runtime delivery, evidence, QA, export, simulation replay, capture QA, public report, partner preview, etc. |
| `sourceInputs` | Inputs by ID/hash/reference: captures, layout snapshot, runtime package, policy bundle, transforms, assumptions, simulator, validator, mesh, splat, probes, or manual review. |
| `contentHash` | Digest of the artifact payload or logical digest policy for compound artifacts. |
| `createdAt` | Timestamp of artifact creation. |
| `createdBy` | User, service, pipeline, or external tool that created the artifact. |
| `exposureTier` | Exposure classification such as `internal_only`, `partner_preview`, `authenticated_client`, `expert_review`, `public_marketing`, or `published_case_study`. |
| `freshnessState` | Current, stale, superseded, expired, partial, not_checked, degraded_evidence, or requires_human_review where applicable. |
| `associatedClaims` | Venue Claim Graph / Claim Lifecycle references the artifact supports, contests, supersedes, or publishes. |
| `associatedEvidence` | Layout Evidence Pack, witness, Proof-of-Reality, Truth Mode report, or QA references connected to the artifact. |
| `runtimeCompatibility` | Runtime requirements or compatibility: web runtime, Three/Spark constraints, target device class, package version, renderer adapter, or fallback path. |
| `exportSafety` | Whether the artifact is internal-only, safe to export, safe for partner preview, safe for public marketing, or requires claim/copy/expert review. |
| `knownLimitations` | Explicit caveats, missing data, unsupported requests, stale inputs, confidence limits, scope boundaries, or review requirements. |

## Artifact Families

The initial governed artifact families are:

| `artifactType` | Description |
|---|---|
| `runtime_package` | Signed or candidate runtime bundle for venue delivery, including manifests and render assets. |
| `layout_evidence_pack` | Customer-facing v0 evidence package for one immutable layout snapshot. |
| `scene_authority_map` | Per-region authority declaration for geometry, appearance, lighting, physics, semantics, interaction, export, truth status, reconstruction strategy, and transforms. |
| `transform_artifact` | Persisted coordinate transform evidence such as ARF -> CVF or CVF -> RRF transforms, residual RMSE, method, landmarks, and provenance. |
| `lighting_context_package` | Zone-scoped lighting/probe/cubemap/influence-volume artifact for object insertion and lighting explanation. |
| `photometric_capture_pack` | Photometric Chain-of-Custody / Appearance Capture QA Pack for fixed-light residual evaluation. |
| `residual_radiance_asset` | Learned or baked residual appearance asset bound to semantic/PBR mesh authority. |
| `venreplay_bundle` | `.venreplay.zip` replay artifact for Guest Flow Replay / flow evidence. |
| `policy_bundle` | Versioned venue/jurisdiction/rule/assumption policy bundle cited by evidence outputs. |
| `witness_block` | Machine-readable validator or review-gate witness output with message keys, facts, derivation, policy refs, and snapshot refs. |
| `proof_object` | Internal Layout Proof Object or related proof/evidence envelope for one immutable subject. |
| `truth_mode_report` | Trust inspection or QA report summarizing evidence/source, verification, confidence, staleness, authority, limitations, and known issues. |
| `openusd_export` | OpenUSD export artifact; interchange target, not internal truth. |
| `khr_gltf_export` | Khronos glTF / KHR export artifact; interchange target, not internal truth. |
| `c2pa_manifest` | C2PA-style manifest or assertion package for exported media/report artifacts. |
| `dsse_attestation` | DSSE envelope, potentially carrying in-toto statement/predicate material for signed artifact attestations. |

Venue Claim Graph data is governed through `associatedClaims`; if a claim graph is exported or snapshotted as a portable file, that export should receive its own artifact record. In-toto material is governed through `dsse_attestation` unless a later ADR creates a separate artifact family.

## Freshness States

Artifact freshness should align with Venue Claim Lifecycle and Data Sufficiency doctrine.

Initial freshness states:

- `current`
- `partial`
- `stale`
- `superseded`
- `expired`
- `not_checked`
- `degraded_evidence`
- `requires_human_review`
- `unsupported_request`

Freshness state is not a visual quality score. A render can look excellent and still be stale for layout evidence, unsupported for legal claims, or degraded because source data is incomplete.

## Runtime Compatibility

Runtime compatibility should be explicit because Venviewer artifacts cross research, runtime, export, and evidence boundaries.

Examples:

- Spark/Three runtime version compatibility
- mobile/tablet/desktop fallback behavior
- mesh-only fallback availability
- residual disable behavior
- renderer-agnostic lighting data requirement
- browser replay compatibility for `.venreplay.zip`
- OpenUSD/KHR export target status
- whether an artifact requires a feature flag, internal route, or expert tool

An artifact that cannot run in the target runtime should not be silently promoted to a runtime package.

## License & IP Compliance

Artifacts produced by third-party tools, research repositories, commercial simulators, model assets, encoders, or runtime dependencies should cite License & IP Compliance Ledger status in provenance before promotion or export.

Registry implications:

- `sourceInputs` should include tool name, version, source URL, and ledger review ID when a tool materially produced or transformed the artifact.
- `knownLimitations` should include redistribution, attribution, copyleft, or commercial-use limits that affect the artifact.
- `exportSafety` should block public or partner exposure when a required tool is `blocked`, `pending_review`, `research_only`, or `benchmark_only` for that exposure.
- `runtimeCompatibility` should note reviewed runtime dependency requirements such as Spark/SPZ/KTX2/BasisU support.

The registry records the artifact; the License & IP Compliance Ledger records whether the toolchain that produced it is approved for the intended purpose.

## Export Safety and Exposure

Artifact export safety depends on Exposure Tier and Claim-Aware Copy Guard rules.

Rules:

- `public_marketing` artifacts require claim/copy review.
- `published_case_study` artifacts require evidence review and source/claim verification.
- `partner_preview` artifacts require authentication, expiring access, or unguessable temporary access.
- `expert_review` artifacts may expose caveats, failed checks, raw metrics, and unsupported claims as review targets.
- `internal_only` artifacts must not live under deployable public paths.
- OpenUSD/KHR exports must preserve limitations and must not imply the export format is internal truth.
- C2PA/DSSE attestations must be described as chain-of-custody or assertion envelopes, not physical-world proof.

## Connections

### Truth Mode

Truth Mode should use the registry to answer:

- which artifact produced or supports this visible region/object/claim
- whether the artifact is current, stale, partial, or requires review
- which source inputs and limitations apply
- which artifact owns geometry, appearance, lighting, or evidence for a region
- whether an export/report/media file is safe for the current audience

### Proof-of-Reality

Proof-of-Reality uses registry records to connect capture, processing, transforms, runtime packages, evidence packs, reports, and attestations into an inspectable chain.

The registry helps prove chain-of-custody. It does not prove that the venue has not changed since capture.

### Layout Evidence Pack

Layout Evidence Packs should cite registry artifact IDs for:

- canonical layout snapshot
- runtime package
- policy bundle
- witness blocks
- review gates
- guest flow replay bundles
- assumptions and venue-supplied data
- attestations where present

### Guest Flow Replay

Guest Flow Replay outputs should register `.venreplay.zip` artifacts and associated witness blocks. Multi-seed summaries can cite many scenario instances and replay artifacts under one Scenario Template.

### Residual Radiance

Residual Radiance experiments should register:

- photometric capture packs
- residual radiance assets
- mesh-only and residual render comparisons
- Authoritative Zone Box references
- residual disable test outputs
- Truth Mode explanation reports

The registry should keep residual assets subordinate to mesh/Scene Authority Map declarations.

### Scene Authority Map

Scene Authority Map artifacts can cite TransformArtifacts, RuntimePackages, residual assets, lighting packages, and capture/evidence artifacts. The registry tracks these as artifacts; the Scene Authority Map still declares which representation is authoritative for each runtime concern.

### Public Copy and Exposure Safety

Public copy should never cite or imply an artifact capability that is not present, current, and safe for the exposure tier.

Examples:

- no "verified" claim without current supporting evidence
- no "photoreal twin" claim from a research-only residual asset
- no "fire approved" claim from a draft Layout Evidence Pack
- no "public case study" use of internal-only `.venreplay.zip` artifacts

## Non-Goals

- No database schema.
- No registry service implementation.
- No runtime loader implementation.
- No storage migration.
- No new dependencies.
- No public marketing copy change.
- No package rename.
- No replacement for VSIR, Scene Authority Map, or RuntimeVenueManifest.
