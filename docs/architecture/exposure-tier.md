# Exposure Tier for Venviewer Artifacts

Status: Active planning doctrine  
Date: 2026-05-01  
Source: EXPOSURE-001  
Depends on: T-097, T-198, D-012, D-014, D-019  
Relates to: Claim-Aware Copy Guard, Truth Mode, RuntimePackage, Layout Evidence Pack, Venue Claim Lifecycle Engine

## Purpose

Exposure Tier is Venviewer's doctrine for classifying who may see a brief, artifact, claim, page, export, runtime package, demo, or evidence output.

The public `/private/brief` incident showed that path names are not governance. A route called "private" can still be public if it lives in a deployable public path or is reachable without the intended gate. Venviewer needs artifact-level exposure classification so the product can decide whether an artifact is internal, partner-preview, client-authenticated, expert-review, investor-demo, public-marketing, or a published case study before route mechanics, public copy, and sharing flows are added.

This doctrine does not implement access control. It defines the vocabulary and governance rules that future manifests, public-asset scanners, route guards, and claim/copy checks should enforce.

## Exposure Tiers

| Tier | Meaning | Default posture |
|---|---|---|
| `internal_only` | Internal planning, architecture, audit, research, development, or operational material. | Must not be deployed to public static paths or customer-facing routes. Can contain ambitious or unresolved internal language if clearly internal. |
| `partner_preview` | Early preview shared with a venue, capture partner, supplier, or implementation partner before public release. | Requires authentication, expiring access, or unguessable temporary access. Must label prototype/preview status and unsupported claims. |
| `authenticated_client` | Artifact intended for a signed-in client, venue staff member, planner, hallkeeper, or invited collaborator. | Requires authenticated access and scope checks. Claims must reflect the user's current venue/layout/evidence scope. |
| `investor_demo` | Demo or narrative material for fundraising, partnership, or strategic review. | May show roadmap and prototype claims when labelled, but must not be confused with public customer evidence. Access should be explicit and logged where practical. |
| `expert_review` | Technical artifact intended for reviewers, surveyors, fire/accessibility consultants, capture partners, QA, or advisors. | May expose caveats, raw metrics, failed checks, assumptions, and uncertainty. Should preserve audit context and avoid marketing polish hiding limitations. |
| `public_marketing` | Public website, landing page, SEO metadata, social preview, public product page, or public customer-facing copy. | Requires Claim-Aware Copy Guard checks and must not expose private artifacts or unsupported claims. |
| `published_case_study` | Publicly shareable customer/venue case study, public proof package, or externally cited success story. | Requires evidence review, venue/customer approval where applicable, current claim state review, and careful scope wording. |

Exposure tier is not the same as provenance, verification state, or claim lifecycle. An artifact can be `expert_review` and contain unverified evidence. An artifact can be `public_marketing` while only using cautious, qualified claims. An artifact can be `published_case_study` and later require update if its supporting claims become stale.

## Artifact Types

The exposure model applies at minimum to:

| Artifact type | Examples | Default tier guidance |
|---|---|---|
| `private_brief` | Trades Hall private brief, acquisition brief, partner proposal draft. | `internal_only`, `partner_preview`, `investor_demo`, or `authenticated_client`; never public merely because it is under a route. |
| `public_landing_page` | `venviewer.com`, venue module page, pricing page, share landing page. | `public_marketing`; must pass public claim guard. |
| `venue_runtime_package` | Runtime manifest, splat/mesh assets, signed RuntimePackage, QA bundle. | Usually `internal_only`, `expert_review`, or `authenticated_client` until a public asset policy explicitly marks parts public. |
| `proposal_pdf` | Event proposal, budget draft, venue handoff, client presentation. | `authenticated_client` or `partner_preview`; public only after explicit approval and claim review. |
| `cinematic_render` | Planrise clip, Grand Assembly teaser, 3D walkthrough render, still image pack. | `partner_preview`, `authenticated_client`, `investor_demo`, `public_marketing`, or `published_case_study` depending on claims and approvals. |
| `truth_mode_report` | Evidence summary, provenance drawer export, QA report, known-issues report. | `expert_review` or `authenticated_client` by default; public only after scoped review. |
| `layout_evidence_pack` | Layout Proof Object customer-facing pack, witness summary, stale/regeneration record. | `authenticated_client` or `expert_review`; `published_case_study` only after evidence and language review. |
| `research_adr` | ADR, doctrine note, research plan, audit, session log. | `internal_only` unless intentionally published as engineering transparency material. |
| `investor_demo` | Demo deck, demo route, guided prototype, fundraising video. | `investor_demo`; should be separate from public marketing and partner/client deliverables. |

Every important future manifest or export should carry both `artifactType` and `exposureTier`. The absence of a tier should default to `internal_only` until explicitly classified.

## Governance Rules

### Public Marketing

`public_marketing` requires the Claim-Aware Copy Guard. Public surfaces must be scanned or reviewed for unsupported claims, including photoreal, verified, Black Label, survey-grade, fire/egress, certified, approved, saved, sent, AI-generated, and venue-approved language.

Public marketing may use aspirational language only when it is visibly qualified. It must not expose private briefs, raw QA reports, internal research assumptions, or customer data.

### Partner Preview

`partner_preview` requires authentication, an expiring signed link, an unguessable temporary URL with explicit expiry, or another deliberate access mechanism. A partner preview must not rely on obscurity from a predictable path.

Partner previews should clearly label preview/prototype status and must not imply public availability or final certification.

### Internal Only

`internal_only` artifacts cannot live under deployable `public/` paths, public object-storage prefixes, public route trees, SEO-indexable pages, or static output directories.

Internal-only artifacts may discuss future ambitions, risks, audit findings, and unlaunched concepts. They become unsafe only when deployed or presented as customer-facing fact.

### Expert Review

`expert_review` artifacts may expose technical caveats, failed checks, raw metrics, low-confidence regions, open assumptions, control residuals, and unsupported claims as things to review. The point is scrutiny, not marketing.

Expert review outputs should preserve evidence, provenance, assumptions, and limitations rather than hiding them behind polished copy.

### Published Case Study

`published_case_study` requires evidence review before publication:

- active claim state is current, not stale/contested/withdrawn
- supporting evidence pack, runtime package, approval event, or QA report is cited internally
- customer/venue approval exists where applicable
- claims are scoped to the exact venue, capture, layout, date, or event
- private or personally identifiable details are removed

A published case study is public marketing with a stronger evidence and approval burden.

## Private Brief Failure Mode

The previous failure mode was:

1. A brief intended as private contained unsupported or premature claims.
2. It lived under a deployable route/static path.
3. The URL returned public content even though the path contained `/private/`.
4. The system had no artifact-level exposure classification to fail closed.

Exposure Tier fixes this architecturally by requiring:

- the brief to declare `artifactType: private_brief`
- the brief to declare a non-public exposure tier
- deploy tooling to reject `internal_only` material in public output
- route guards to enforce non-public exposure tiers
- claim/copy guard to scan anything that is public or public-adjacent

## RuntimePackage and Manifest Integration

Future runtime manifests, signed bundles, layout evidence packs, truth reports, and cinematic exports should include exposure metadata when they become shareable artifacts.

Suggested fields:

- `artifactType`
- `exposureTier`
- `ownerVenueId`
- `subjectRefs`
- `allowedAudience`
- `expiresAt` where relevant
- `claimReviewStatus`
- `approvalRefs`
- `sourceArtifactRefs`

These fields are planning targets only. This task does not change RuntimeVenueManifestV0, VSIR, DB schema, public routes, or access control.

## Relationship to Claims and Provenance

Exposure Tier governs who may see an artifact. Provenance explains where the artifact came from. Claim-Aware Copy Guard controls what language the artifact may contain. Venue Claim Lifecycle controls whether supporting claims are current, stale, contested, withdrawn, or published.

An artifact should not be allowed to become more exposed unless the claim/copy, provenance, approval, and lifecycle checks required by that tier are satisfied.

## Enforcement Phases

### v0: Doctrine and Manual Classification

Use this vocabulary in planning, briefs, exports, and review notes. Treat missing exposure tier as `internal_only`.

### v1: Metadata in Manifests

Add exposure metadata to runtime manifests, evidence packs, proposal exports, cinematic render manifests, and private brief descriptors.

### v2: Deploy-Time Scanner

Scan deployable static assets, route metadata, and generated public output for artifacts whose exposure tier forbids public deployment.

### v3: Route and Sharing Guards

Enforce route guards, temporary access links, authentication, venue/client scope, expiry, and audit events according to exposure tier.

### v4: Claim-Aware Publishing Workflow

Before publishing public marketing or case studies, require claim review, approval references, and current evidence status.

## Guardrails

- Do not infer privacy from a route name.
- Do not put `internal_only` artifacts under `public/`.
- Do not publish private briefs without an explicit exposure tier and access mechanism.
- Do not let `investor_demo` or `partner_preview` material become public marketing by accident.
- Do not let `public_marketing` bypass the Claim-Aware Copy Guard.
- Do not publish case studies without evidence and approval review.
- Do not hide unsupported claims with CSS or route obscurity.

## Non-Goals

- No access-control implementation in this doctrine.
- No route changes.
- No public copy changes.
- No database schema changes.
- No RuntimeVenueManifestV0 changes.
- No package rename.
