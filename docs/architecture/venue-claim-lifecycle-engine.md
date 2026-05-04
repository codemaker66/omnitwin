# Venue Claim Lifecycle Engine

Status: Active planning doctrine  
Date: 2026-05-01  
Source: VCL-001  
Depends on: D-012, D-018, D-024, Truth Mode Doctrine, Layout Proof Object doctrine, Crowd Simulation Replay Bundle doctrine

## Purpose

The Venue Claim Lifecycle Engine is Venviewer's doctrine for managing the state of claims over time. A claim is not static metadata. A claim can be created, supported by evidence, checked by validators, reviewed by people, verified for a declared use, contested, superseded, stale, expired, withdrawn, and published.

This is distinct from a future Venue Claim Graph. The Claim Graph describes relationships between claims: dependencies, contradictions, derivations, subjects, scopes, and provenance links. The Lifecycle Engine describes the temporal state machine for each claim instance: what happened to it, why its current state is valid, what invalidates it, and whether it can be shown as current evidence.

The engine exists because venue truth ages:

- captures become stale
- venue geometry/runtime packages change
- layouts are edited
- policies and venue operating rules update
- validators change
- staff review or contest claims
- proof objects and evidence packs are regenerated
- public exports need to preserve exactly which claim state was published

Without lifecycle states, Truth Mode and Layout Evidence Packs would eventually show old facts as current facts.

## Claim Scope

A claim is an assertion about a venue, asset, layout, policy, evidence pack, simulation, operational plan, price, or export.

Examples:

- "This wall geometry is measured from capture session C."
- "This chandelier proxy is artist-authored and appearance-enhanced."
- "This layout seats 114 guests under assumption set A."
- "This bar queue replay is current for layout snapshot S and simulator version V."
- "This evidence pack requires human review for accessibility routes."
- "This public export was published from proof object P at time T."

Claims must carry explicit subject references. A claim without a subject cannot be invalidated safely.

## Lifecycle States

Claim lifecycle state is separate from Truth Mode evidence/source state and separate from Layout Proof Object claim status. Evidence/source says how an artifact was produced. Claim status says the result of a specific check. Lifecycle says what stage the assertion is in over time.

Required lifecycle states:

| State | Meaning |
|---|---|
| `created` | The claim exists but has no attached evidence beyond its assertion record. |
| `supported` | Evidence or provenance has been attached, but no validator or reviewer has accepted it yet. |
| `machine_checked` | A deterministic validator, QA pass, or replayable process has checked the claim within its declared scope. |
| `human_reviewed` | A named reviewer has reviewed the claim and recorded scope, decision, timestamp, and limitations. |
| `verified` | The claim is accepted for its declared use, confidence tier, assumptions, and expiry policy. |
| `contested` | A user, reviewer, validator, conflicting source, or anomaly has disputed the claim. |
| `superseded` | A newer claim replaces this claim for the same subject/scope. The old claim remains auditable. |
| `stale` | One or more inputs changed, so the claim can no longer be presented as current. |
| `expired` | The claim passed its configured validity window without refresh or re-review. |
| `withdrawn` | The claim was intentionally removed from active use by an authorized actor, with a reason. |
| `published` | The claim state was included in a public export, evidence pack, proposal, or signed bundle. |

`published` is not a truth upgrade. It records that a particular claim state was exported or shown externally. A published claim can later become stale, contested, superseded, expired, or withdrawn.

## Lifecycle Events

Lifecycle changes are caused by events. Events are append-only audit facts; they should not be overwritten.

Required lifecycle events:

| Event | Typical effect |
|---|---|
| `capture_ingested` | Creates or supports claims derived from a capture session. |
| `claim_created` | Creates a new claim for a subject/scope. |
| `evidence_attached` | Moves a claim from created toward supported. |
| `validator_checked` | Records machine check output and may move a claim to machine_checked. |
| `human_reviewed` | Records reviewer decision and may move a claim to human_reviewed or verified. |
| `user_contested` | Moves the claim to contested or records a contestation event against it. |
| `layout_changed` | Stales claims tied to the previous layout snapshot. |
| `venue_geometry_changed` | Stales claims tied to the previous venue geometry/runtime package. |
| `policy_changed` | Stales claims tied to the previous policy bundle or rule version. |
| `validator_changed` | Stales claims whose checked status depended on an older validator version/hash. |
| `capture_refreshed` | Supersedes or stales claims tied to older capture sessions. |
| `claim_published` | Records that a claim state was included in an external or customer-visible artifact. |
| `claim_withdrawn` | Moves a claim to withdrawn with actor and reason. |

Each event should record at minimum:

- claim ID
- event type
- previous lifecycle state
- next lifecycle state
- actor or system component
- timestamp
- subject reference
- evidence/proof/runtime/policy references involved
- reason or validator output reference where applicable
- audit trail reference

## Staleness Triggers

The engine must detect or receive staleness triggers from the systems that own the changed input.

Required triggers:

- layout snapshot changes
- venue runtime package changes
- Scene Authority Map changes
- policy bundle changes
- capture session superseded
- proof object superseded
- verification expiry reached
- manual contestation

Staleness is not deletion. A stale claim remains inspectable, can explain what it used to support, and can be cited historically. It must not appear as current evidence without regeneration or review.

## Regeneration Rules

When a claim becomes stale, Venviewer should decide whether to regenerate automatically, queue human review, or leave the stale state visible.

Default policy:

- Deterministic machine claims may be regenerated automatically when all inputs are available and validator scope is unchanged.
- Claims requiring human judgement move to stale or contested until reviewed.
- Published claims are not mutated. A new claim state or new claim version is created for regenerated evidence.
- If regeneration fails, the claim remains stale with a failure reason.
- If a newer claim replaces an older one for the same subject/scope, the older one becomes superseded.

Regeneration must preserve the old evidence chain so exports and audits can explain what changed.

## Integration With Truth Mode

Truth Mode is the primary inspection surface for claim lifecycle.

Truth Mode should show:

- whether selected venue/layout facts are current, stale, contested, expired, or verified
- why a stale state occurred
- which input changed
- whether regeneration is available
- whether human review is required
- whether a claim was published externally

Normal planners should see plain-language lifecycle summaries. Hallkeepers and QA users can open lifecycle event history through L3/L4 disclosure.

Truth Mode must not collapse lifecycle into a single green trust badge. A region can be scan-observed, machine-checked, stale, and still visually high quality. Those axes remain separate.

## Integration With Layout Evidence Pack

Layout Evidence Packs are only meaningful if their claims are current for the layout snapshot, policy bundle, validator version, runtime package, and assumptions they cite.

The Lifecycle Engine should:

- mark evidence claims stale when the layout snapshot changes
- mark claims stale when a policy bundle or validator changes
- track proof object supersession
- distinguish stale evidence from failed evidence
- record when an evidence pack is regenerated
- preserve published evidence states for audit

Evidence Pack UI should expose current, partial, stale, contested, and requires-human-review states without implying legal certification.

## Integration With Hallkeeper Verification

Hallkeeper verification is a lifecycle workflow, not just a note field.

The engine should support:

- worklists for unreviewed, stale, contested, and expiring claims
- reviewer identity, scope, timestamp, expiry, and limitations
- approve/contest/withdraw actions
- changed-since-last-review detection
- re-review after capture refresh or venue change

Hallkeeper review can move a claim to `human_reviewed` or `verified` only for the declared scope. It must not silently upgrade all downstream claims.

## Integration With Venue Memory

Venue Memory stores historical claims and outcomes as learning material. It must preserve lifecycle context.

Past verified claims can inform future suggestions, but they do not make future claims valid automatically. Venue Memory should retain:

- what was verified
- under which assumptions and policy versions
- which evidence pack or runtime package was current
- whether the claim later became stale, contested, or superseded
- which layouts or operations succeeded or failed in practice

## Integration With Public Export and Provenance

Public exports, proposals, signed bundles, audit packs, and future proof-of-reality exports should include the claim state they are based on.

Export rules:

- Current verified or human-reviewed claims may be shown within their declared scope.
- Stale, contested, expired, and requires-review claims must be labeled or excluded according to output policy.
- Published export records must be immutable.
- Public exports must avoid "certified", "fire approved", "surveyor-grade", or "legally compliant" wording unless qualified evidence exists.
- Signatures prove artifact chain-of-custody, not that the physical venue remains unchanged after capture.

## Integration With Audit Trail

Every lifecycle event should become an Audit Trail event.

Audit Trail must be able to answer:

- who created the claim
- what evidence supported it
- which validator or reviewer changed state
- why it became stale or contested
- what superseded it
- what was published externally
- when it was withdrawn or expired

This creates the operational memory needed for enterprise review without overclaiming public certainty.

## Relationship to Existing Doctrine

- D-012 defines provenance and truth/imagination separation.
- D-024 defines Scene Authority Map ownership and transform artifacts.
- Truth Mode Doctrine defines the trust inspection/workflow/infrastructure surface.
- Layout Proof Object doctrine defines replayable evidence packs tied to immutable layout snapshots.
- Crowd Simulation Replay Bundle doctrine defines simulation evidence that can become witness material.
- Venue Memory stores lifecycle history and outcomes but does not replace current validation.

The Venue Claim Lifecycle Engine connects those concepts by making claim state explicit and time-aware.

## Non-Goals

- No database tables in this doctrine.
- No runtime UI implementation.
- No typed vocabulary implementation.
- No validator kernel or staleness engine implementation.
- No public copy changes.
- No package rename.
- No legal, fire, survey, or accessibility certification claim.
