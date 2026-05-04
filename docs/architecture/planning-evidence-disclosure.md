# Planning Evidence Disclosure

Status: Active planning doctrine  
Date: 2026-05-01  
Source: PED-001  
Depends on: Layout Evidence Pack, Guest Flow Replay, Scotland Policy Bundle, Purpose-Fit Evidence, Calibrated Reliance Principle  
Relates to: Truth Mode, Flow Evidence Pack, `.venreplay.zip`, PDF exports, proposal share pages, Claim-Aware Copy Guard

## Purpose

Planning Evidence Disclosure defines the standard wording and placement rules that keep Venviewer evidence artifacts from being mistaken for legal, fire, accessibility, heritage, licensing, or regulatory certification.

Guest Flow Replay, Flow Evidence Pack, Layout Evidence Pack, Scotland Policy Bundle checks, and future Layout Proof Objects can provide useful planning evidence. They do not automatically become statutory approval or professional assessment. Users must be able to rely appropriately: use evidence when it is useful, verify where it is bounded, and seek human/professional review where required.

This document is planning doctrine only. It does not implement UI, PDF, replay viewer, export, public-copy, or route changes.

## Core Doctrine

- Every evidence artifact must carry a purpose-fit disclosure or watermark appropriate to its assurance level.
- Any output that uses Scotland Policy Bundle, Guest Flow Replay, or Layout Proof Object / Layout Evidence Pack data and is not expert-certified must include a disclosure.
- Disclosures must be visible in the context where the evidence is consumed, not only buried in raw metadata.
- Disclosures must not be softened into vague legal boilerplate. They should be short, concrete, and adjacent to the relevant evidence.
- Expert-certified or professionally reviewed outputs still need scope language that says what was reviewed, by whom, when, and under which assumptions.
- Disclosure wording is part of calibrated reliance: it should reduce overtrust without flooding normal users with fear language.

## Disclosure Phrase Registry

Initial disclosure phrases:

| Phrase | Intended use |
|---|---|
| "Planning evidence — not a fire-safety assessment." | Fire/egress-adjacent planning evidence that has not been reviewed as a fire-safety assessment. |
| "Indicative layout check — review recommended." | Draft validator or operational checks that are useful for planning but not final approval. |
| "Based on supplied assumptions." | Outputs driven by Assumption Ledger entries, venue-supplied data, or scenario settings. |
| "Not statutory approval." | Any output that could otherwise be confused with regulator, authority, fire, accessibility, licensing, or legal approval. |
| "Requires venue/professional review." | Review Gate Engine output, near-threshold result, missing required data, protected heritage area, accessibility uncertainty, or other review-triggered evidence. |

These phrases are starting registry entries. Future implementation should freeze message keys and templates so wording changes do not alter witness/proof hashes.

## Placement Requirements

### Layout Evidence Pack

Layout Evidence Packs should show disclosure at:

- pack cover/summary
- each claim family section where assurance is bounded
- witness details where review gates or assumptions apply
- export/download surfaces
- stale/regeneration views

Examples:

- Capacity draft: "Indicative layout check — review recommended."
- Egress planning witness: "Planning evidence — not a fire-safety assessment."
- Human-review gate: "Requires venue/professional review."

### Guest Flow Replay

Guest Flow Replay should show disclosure near:

- scenario summary
- metrics summary
- replay controls
- heatmaps/bottleneck views
- multi-seed summary
- comparison views

Suggested default: "Based on supplied assumptions. Not statutory approval."

### Flow Evidence Pack

Flow Evidence Pack should include disclosure:

- on the first page/summary
- beside each scenario
- beside metrics that may look conclusive, such as queue wait time, density hotspots, route warnings, or egress planning warnings

Suggested default: "Indicative layout check — review recommended."

### PDF Exports

Evidence PDF exports should include:

- visible watermark or header/footer disclosure
- per-section disclosure when section purpose changes
- assumptions section with "Based on supplied assumptions."
- reviewer section when "Requires venue/professional review." applies

PDFs are high-risk because they travel outside the product context. They need persistent disclosure, not just an in-app tooltip.

### Truth Mode

Truth Mode should display compact evidence disclosure in L1/L2 and drill-down details in L3/L4.

Normal users should see concise cues. Expert users should be able to inspect:

- evidence purpose
- assurance level
- assumptions
- review status
- stale state
- missing data
- professional-review scope where present

### Proposal Share Pages

Proposal/share pages should disclose any evidence-backed claims used to support a layout, price, capacity, guest flow, or operational recommendation.

If the page is customer-facing and no expert review exists, use planning language rather than certification language.

### `.venreplay` Replay Viewer

The `.venreplay.zip` replay viewer should show disclosure:

- before or during replay playback
- near metrics summary
- near scenario assumptions
- in exported screenshots or videos where feasible

Suggested default: "Based on supplied assumptions. Not statutory approval."

## Required Rule

If an output uses any of the following and is not expert-certified for the declared purpose, it must include a disclosure:

- Scotland Policy Bundle
- Guest Flow Replay
- Flow Evidence Pack
- Layout Proof Object
- Layout Evidence Pack
- Deterministic Validator Kernel witness
- Review Gate Engine output
- `.venreplay.zip`
- submitted-route validation or explicit graph-route validation
- accessibility planning evidence
- egress planning evidence
- heritage or protected-zone planning evidence

If the output is expert-certified, the output must still state:

- reviewer identity or role
- review date
- scope
- assumptions
- policy/rule basis
- limits of certification

## Assurance-Level Mapping

| Assurance level | Disclosure posture |
|---|---|
| draft / unreviewed | Use "Indicative layout check — review recommended." |
| assumption-driven | Use "Based on supplied assumptions." |
| fire/egress-adjacent without professional review | Use "Planning evidence — not a fire-safety assessment." |
| statutory/regulatory-adjacent without approval | Use "Not statutory approval." |
| review-gated | Use "Requires venue/professional review." |
| stale | Pair the relevant phrase with stale status: "This evidence is stale." |
| expert-reviewed | State the actual review scope; do not imply wider approval. |

## Relationship To Purpose-Fit Evidence

Disclosures must match the purpose being claimed. A layout may be fit for visual presentation while not fit for fire planning evidence. A Guest Flow Replay may be useful for bar-queue planning while not useful for evacuation certification.

Evidence artifacts should declare the purpose and apply disclosure to that purpose. One disclosure does not cover every purpose automatically.

## Relationship To Calibrated Reliance

Planning Evidence Disclosure is a calibrated reliance mechanism.

It should prevent:

- overtrust: treating a draft planning check as legal approval
- undertrust: burying useful planning evidence under vague disclaimers
- trust junk: adding decorative badges or trust scores without inspectable evidence

The right pattern is concise disclosure plus drill-down evidence.

## Non-Goals

- No UI implementation.
- No PDF export implementation.
- No `.venreplay` viewer implementation.
- No Truth Mode runtime change.
- No public copy change in this task.
- No legal advice.
- No certification claim.
- No package rename.
