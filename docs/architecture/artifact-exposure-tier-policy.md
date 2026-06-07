# Artifact Exposure-Tier Policy

Status: Active planning doctrine  
Date: 2026-06-07  
Source: VAR-001, EXPOSURE-001, CLAIM-COPY-001  
Depends on: T-209, T-283, T-285  
Relates to: Artifact Registry, ArtifactManifestV0, Exposure Tier, Claim-Aware Copy Guard, Upload Access Policy

## Purpose

This policy defines how Artifact Registry records use `exposureTier` and
`exportSafety`. It narrows the broader Exposure Tier doctrine into registry
rules for manifests, evidence packs, runtime packages, reports, exports, and
attestations.

This is not an access-control implementation. It defines the metadata and review
rules that future scanners, route guards, sharing flows, and artifact registry
services should enforce.

## Default Rule

If an artifact has no exposure tier, treat it as `internal_only`. Missing
metadata must never make an artifact easier to publish, share, export, or store
under public paths.

## Exposure Tiers

| Tier | Registry meaning | Minimum controls |
|---|---|---|
| `internal_only` | Internal planning, QA, research, processing output, unreviewed runtime package, debug report, or draft evidence. | Keep out of public static paths and public object prefixes. |
| `partner_preview` | Early material shared with a venue, capture partner, supplier, or implementation partner before public release. | Controlled access, expiry where possible, and visible preview caveats. |
| `authenticated_client` | Artifact intended for a signed-in client, venue staff member, planner, hallkeeper, or invited collaborator. | Authentication and venue/client scope checks. |
| `investor_demo` | Demo or strategic review artifact that may show roadmap or prototype material. | Deliberate access and clear demo/prototype context. |
| `expert_review` | Artifact intended for technical review, QA, capture review, policy review, or professional advice. | Preserve caveats, source inputs, and known limitations. |
| `public_marketing` | Public web or social material derived from artifact output. | Claim/copy guard review and no private source exposure. |
| `published_case_study` | Public venue/customer proof or story derived from artifact output. | Evidence review, approval references, scoped wording, and current freshness. |

## Export Safety

`exportSafety` explains what may be done with an artifact payload or its derived
outputs:

| State | Meaning |
|---|---|
| `internal_only` | Not exportable outside internal systems. |
| `safe_to_export` | Exportable for the declared audience and purpose. |
| `safe_for_partner_preview` | Exportable only for controlled preview. |
| `safe_for_public_marketing` | Cleared for public marketing use after required copy review. |
| `requires_claim_review` | Needs claim/copy review before exposure increases. |
| `requires_expert_review` | Needs expert or operator review before exposure increases. |
| `blocked` | Must not be exported or promoted for the requested purpose. |

Exposure tier and export safety must agree. For example, an artifact with
`exposureTier: internal_only` cannot also be `safe_for_public_marketing`.

## Promotion Rules

Promotion means moving an artifact to a broader audience, public path, customer
route, share link, export package, or public object-store prefix.

An artifact can be promoted only when all of these are true:

- `artifactType` is known.
- `exposureTier` is explicitly set.
- `freshnessState` is suitable for the target purpose.
- `exportSafety` allows the target exposure or explicitly requests the review
  that must happen first.
- `knownLimitations` are present and acceptable for the target audience.
- `sourceInputs` are present and do not include private or uncleared material for
  the target exposure.
- Any associated claims are current enough for the intended wording.
- Any venue/customer approval required for the target exposure exists.

If any required check is missing, keep the artifact at `internal_only` or
`requires_claim_review`.

## Tier Rules

### Internal Only

- Default for new artifacts.
- Required for unprocessed captures, draft runtime packages, QA failures,
  research outputs, raw review reports, and artifacts with unknown tool rights.
- Must not be stored under deployable public paths.
- May contain unresolved caveats as long as it remains internal.

### Partner Preview

- Requires deliberate access: authentication, expiring link, unguessable
  temporary URL, or an equivalent logged sharing mechanism.
- Must visibly preserve preview/prototype status.
- Must not be indexed or linked from public marketing routes.
- Should expire or be reviewed before reuse.

### Authenticated Client

- Requires account/session access and venue/client scope checks.
- Claims must reflect the current artifact purpose, freshness, and limitations.
- If client access includes downloadable outputs, export safety must permit that
  download.

### Investor Demo

- Requires deliberate access and separation from public customer surfaces.
- May show roadmap or prototype work only when context is clear.
- Must not include private customer or venue material unless approved for that
  audience.

### Expert Review

- May expose caveats, failed checks, raw metrics, and uncertainty.
- Should preserve source inputs and limitations rather than polishing them away.
- Can include unverified material, but the artifact must not be re-used as
  public evidence without a separate review path.

### Public Marketing

- Requires the public claim guard and a copy/evidence review.
- Must not reveal private source inputs.
- Must not imply a capability beyond the artifact's current purpose,
  freshness, and limitations.
- Should prefer derived media or summaries over raw internal artifacts.

### Published Case Study

- Requires current supporting artifacts, scoped claim wording, venue/customer
  approval where applicable, and removal of private details.
- If supporting artifacts become stale, expired, contested, or superseded, the
  case-study artifact must be reviewed.

## Storage And Routing Rules

- `internal_only`, `partner_preview`, `authenticated_client`, `investor_demo`,
  and `expert_review` artifacts must not be placed under deployable public
  static directories.
- Public object-store prefixes require `public_marketing` or
  `published_case_study` exposure plus compatible export safety.
- Route names do not make an artifact private. Access mechanism, metadata, and
  storage path must agree.
- If route access and artifact exposure disagree, fail closed to the narrower
  exposure.

## Runtime Package Rules

Runtime packages start as `internal_only` until their source assets, format,
freshness, runtime compatibility, and evidence state are checked for the target
audience. A runtime package can be client-visible without being public marketing
when it is scoped to authenticated client or expert-review routes.

No runtime package should become public-facing merely because its asset URL is
reachable. Artifact exposure and route/storage access must both permit the
audience.

## Scanner Rules

Future scanners should fail or warn when:

- an artifact has no exposure tier;
- an internal or preview artifact appears under deployable public output;
- public routes reference non-public artifacts;
- public artifacts reference private source inputs;
- export safety contradicts exposure tier;
- freshness is `not_checked`, `stale`, `expired`, `degraded_evidence`, or
  `requires_human_review` for a public purpose;
- `knownLimitations` is empty for a public or case-study artifact;
- associated claims are missing or not current enough for the intended wording.

## Review Record

Exposure changes should record:

- artifact ID
- previous exposure tier
- next exposure tier
- previous export safety
- next export safety
- reviewer or service
- approval reference where applicable
- timestamp
- reason
- affected routes, object prefixes, or exports

This can live in a future registry service, artifact audit report, or deployment
scanner. This policy does not implement storage.

## Non-Goals

- No access-control implementation.
- No route changes.
- No object-storage migration.
- No registry service.
- No database schema.
- No public copy changes.
- No runtime loader changes.
