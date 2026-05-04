# Purpose-Fit Evidence

Status: Active planning doctrine  
Date: 2026-05-01  
Source: PURPOSE-FIT-001  
Depends on: T-123, T-133, T-157, T-198, D-011, D-015, D-024  
Relates to: Truth Mode, Scene Authority Map, Layout Evidence Pack, Calibrated Reliance Principle, Capture Control Network

## Purpose

Purpose-Fit Evidence is Venviewer's doctrine that evidence must be evaluated against a stated use. A venue region, asset, capture, layout, render, simulation, or report is not simply "high quality" or "low quality." It is fit or not fit for a specific purpose.

Research on HVET, BIM, and LOIN reinforces the same point: information requirements must be specified for the decision being made. A single generic quality score collapses too many concerns. It invites overtrust, hides the difference between visual and operational evidence, and lets capture certification sound broader than it is.

Venviewer must distinguish evidence that is:

- fit for visual presentation
- fit for table placement
- fit for hallkeeper setup
- fit for guest flow replay
- fit for accessibility planning
- fit for egress planning evidence
- fit for pricing proposal
- fit for heritage presentation
- fit for architectural survey
- fit for marketing render

## Core Rule

One region can be fit for one purpose and not another.

Examples:

- A chandelier splat may be fit for visual presentation and marketing render, but not fit for collision, export, or architectural survey.
- A simplified artist proxy may be fit for table-placement clearance and hallkeeper setup, but not fit for heritage documentation.
- A deterministic E57 wall mesh may be fit for event layout, hallkeeper setup, and egress planning, but still not fit for architectural survey if control evidence or tolerance is insufficient.
- A pricing proposal may be fit for budget discussion while its accessibility route evidence remains requires-human-review.
- A Guest Flow Replay may be fit for bar-queue planning but not for emergency evacuation certification.

Purpose-fit evidence should prevent both overclaiming and unnecessary distrust. Weak evidence for one purpose may be strong enough for another.

## Purpose Categories

Initial purpose categories:

| Purpose | Meaning | Typical evidence needed |
|---|---|---|
| `visual_presentation` | Looks credible enough for planner/client visual understanding. | Appearance layer, proxy/render provenance, basic scene authority, visible caveats when generated/proxy. |
| `event_layout` | Supports to-scale furniture/table placement and layout decisions. | Metric room geometry, object dimensions, layout tolerance, current floor-plan/runtime reference. |
| `hallkeeper_setup` | Supports venue staff setting up a room from a plan. | Stable object positions, inventory references, clear zones, setup notes, current venue-specific assumptions. |
| `guest_flow` | Supports planning movement, queues, staff/supplier/catering routes, or room flips. | Layout snapshot, navmesh/route model, scenario assumptions, simulator/replay evidence, limitations. |
| `accessibility_planning` | Supports draft accessibility route and seating review. | Route width/turning assumptions, layout geometry, policy bundle, human-review status where needed. |
| `egress_planning` | Supports draft egress or exit-clearance planning evidence. | Policy bundle, layout snapshot, route/clearance witnesses, assumptions, validator version, human-review boundary. |
| `pricing` | Supports costed proposal or budget discussion. | Price book version, inventory availability, package rules, exclusions, taxes/currency, assumption ledger. |
| `heritage_interpretation` | Supports presentation or explanation of protected/heritage elements. | Source/provenance, specialist review where needed, proxy/enhancement labeling, restrictions and caveats. |
| `architectural_survey` | Supports professional/survey-grade architectural measurement or export. | Qualified capture/control evidence, tolerance statement, equipment/method records, reviewer/certification scope. |
| `marketing_render` | Supports public/commercial imagery or cinematic preview. | Visual QA, exposure tier, copy guard review, clear separation from measurement/compliance claims. |

These are purpose categories, not certification labels. They describe the intended decision or output.

## Capture Certification Is Not All-Purpose Validity

Capture certification tiers from D-015 are important, but they must not imply all-purpose validity.

Rules:

- Bronze / appearance-only can be fit for visual presentation or marketing render, not measurement-heavy uses.
- Silver / layout-grade can support event layout when control evidence and tolerances match the room/region, but does not automatically support architectural survey.
- Gold / ops-grade can support more operational uses, but still requires purpose-specific policy, assumptions, and freshness checks.
- Black Label can support high-end capture trust only within declared scope, equipment, tolerance, region, purpose, and review evidence.

"Black Label" must become purpose-aware. A Black Label room shell does not automatically make a chandelier proxy survey-grade, a Guest Flow Replay fire-approved, or a pricing proposal final.

## Truth Mode Integration

Truth Mode should show purpose-specific confidence where relevant.

Default surfaces should stay compact:

- normal planners see whether a selected area is fit for the task they are doing
- hallkeepers see setup and operational readiness
- clients see real-vs-proposed and visual/presentation trust
- QA/expert users can inspect the full purpose matrix

Truth Mode should allow a purpose filter over time:

- "show fit-for-layout"
- "show fit-for-setup"
- "show fit-for-egress-planning"
- "show appearance-only/proxy regions"
- "show not-fit-for-current-purpose"

Truth Mode must not collapse purpose-fit status into one green badge. It should answer "fit for what?" before it answers "good enough?"

## Scene Authority Map Integration

Scene Authority Map already separates geometry, appearance, lighting, physics, semantic, interaction, and export authority. Purpose-Fit Evidence adds the decision layer above that authority split.

Examples:

- `geometry_authority` from E57 mesh may support `event_layout`.
- `appearance_authority` from splat may support `visual_presentation`.
- `interaction_authority` from a simplified proxy may support `hallkeeper_setup`.
- `export_authority` may be insufficient for `architectural_survey`.

A future Scene Authority entry should be able to cite purpose-fit status or evidence references for the purposes it claims to support.

## Layout Evidence Pack Integration

Layout Evidence Packs should declare purpose explicitly.

Every pack or witness should answer:

- What purpose was this evidence generated for?
- Which layout snapshot, policy bundle, assumptions, and runtime/geometry references were used?
- Which claim families were checked?
- Which purposes remain unchecked, stale, failed, or require human review?

The same layout may need different evidence packs or witness sets for event layout, hallkeeper setup, accessibility planning, egress planning, guest flow, and pricing. A pass for one purpose must not silently carry into another.

## Public Copy and Claim Guard Integration

Public copy should avoid one-size-fits-all quality claims.

Rules:

- Say "fit for draft event layout" rather than implying survey accuracy when only layout evidence exists.
- Say "visual presentation render" rather than implying measured geometry when appearance-only assets are used.
- Say "draft egress planning check" rather than "fire approved" unless qualified evidence exists.
- Say "targeting Black Label" or name the actual certified purpose/scope rather than using Black Label as a universal quality badge.
- Any "verified" public claim should include or imply the purpose: verified for what, under which scope, and with which evidence.

The Claim-Aware Copy Guard should eventually map high-risk phrases to required purpose-fit evidence.

## Relationship to Calibrated Reliance

Purpose-Fit Evidence gives calibrated reliance its purpose axis. Users can only rely appropriately if the product tells them what the evidence is fit for.

Without purpose-fit evidence:

- users overtrust visual realism for measurement
- users undertrust useful draft evidence because it is not survey-grade
- certifications become blanket claims
- evidence packs sound broader than their witnesses

Purpose-fit evidence lets Venviewer be ambitious without being vague.

## Guardrails

- Do not publish a single global venue quality score as a substitute for purpose-specific evidence.
- Do not let capture tier alone determine operational validity.
- Do not treat visual fidelity as fit-for-layout or fit-for-survey evidence.
- Do not let one Layout Evidence Pack imply every purpose was checked.
- Do not make Black Label a universal badge detached from scope and purpose.
- Do not hide purpose limitations in expert-only panels when they affect normal user decisions.
- Do not overburden normal users with the full evidence matrix when a compact purpose cue is enough.

## Non-Goals

- No code implementation.
- No runtime UI.
- No public copy changes.
- No database schema.
- No validator implementation.
- No certification claim changes.
- No package rename.
