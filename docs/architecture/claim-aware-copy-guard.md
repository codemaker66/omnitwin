# Claim-Aware Copy Guard

Status: Planning doctrine
Date: 2026-05-01
Source: CLAIM-COPY-001
Depends on: T-083, T-097, T-123, T-157, T-192
Relates to: Truth Mode, Layout Evidence Pack, Venue Claim Lifecycle Engine, future Venue Claim Graph

## Purpose

Venviewer is a proof-carrying venue reality system. Customer-facing copy must not outrun implemented, measured, inspectable evidence.

The Claim-Aware Copy Guard is the doctrine for preventing public copy drift. It treats marketing language, product labels, proposal text, brief pages, emails, and share cards as claims that need evidence, qualification, or internal-only containment.

This document does not implement the linter or the future Venue Claim Graph integration. It defines the policy those systems must enforce.

## Scope

The guard applies to deployable and customer-facing surfaces:

- Public web pages and route components
- Static assets under deployable public directories
- Pricing pages, landing pages, venue modules, proposal pages, and share cards
- Email templates and exported PDFs when those exist
- Open Graph metadata, SEO copy, and embedded customer-facing JSON
- In-app status labels such as saved, sent, verified, approved, and checked

The guard does not weaken internal architecture ambition. ADRs, research notes, planning docs, audits, and session logs may discuss future systems such as Black Label, Truth Mode, Layout Evidence Packs, Grand Assembly, and Venue Claim Graph if the files are clearly internal and not deployed as customer-facing claims.

## Claim Classes

### Public claim

A statement visible to a customer, client, venue staff member, supplier, investor, or public visitor. Public claims include headings, CTAs, badges, status text, metadata, downloadable outputs, images with embedded text, and route-accessible private briefs.

Public claims require either evidence, qualification, or removal.

### Evidence-backed claim

A public claim that references current supporting evidence: a shipped feature, a current Layout Evidence Pack, a runtime manifest, a QA certificate, a venue approval event, a successful API response, or another active claim in the future Venue Claim Graph.

Evidence-backed claims must preserve scope. "This draft is saved locally" is valid if local persistence succeeded. "Venviewer saves every event plan" is broader and needs server-side persistence evidence.

### Aspirational claim

A future-looking claim about planned capability or target quality. Aspirational claims may be used internally. Public use must be softened and visibly conditional, such as "building toward verified photoreal venue twins" or "planned verification workflow".

### Forbidden claim

A claim that must not appear in public copy unless qualified professional evidence, signed proof, or explicit venue approval exists. Examples include "certified compliant", "fire approved", "surveyor-grade", "laser-survey accuracy", "regulator approved", and unqualified "Black Label certified".

### Conditional claim

A claim that is valid only under explicit conditions. Conditional claims must name or imply their scope and trigger. Examples: "Draft egress review", "Saved locally", "Ready for venue review", "Targeting Black Label capture standard", and "To-scale draft based on current room geometry".

### Internal-only claim

A claim that is allowed in internal planning context but must not ship as customer-facing copy. Internal-only claims include research targets, acquisition-audit critique, ADR ambition, model names, capture-tier aspirations, and unlaunched product capabilities.

## Claim Examples

| Phrase | Public posture | Evidence required before strong wording |
|---|---|---|
| photoreal | Use only as a target unless a real runtime package and visual QA evidence support the specific venue/scene. | T-091 evidence, asset manifest, QA/capture metrics, and Truth Mode disclosure. |
| verified | Must state what was verified and by whom/what. Avoid broad "verified venue" language. | Current verification state, reviewer or validator identity, scope, timestamp, and expiry/staleness rule. |
| Black Label | Public strong form requires capture certification evidence. "Targeting Black Label" may be acceptable when visibly aspirational. | D-015 tier metrics, QA certificate, capture session evidence, current venue scope. |
| survey-grade | Forbidden by default for public copy. Requires qualified survey evidence and scope. | Professional survey provenance, tolerance statement, equipment/method evidence, reviewed certification scope. |
| to scale | Allowed when tied to current geometry source and tolerance. Avoid implying survey/legal precision. | Room dimensions source, units, tolerance policy, and current geometry/runtime reference. |
| saved | Must reflect actual persistence state. "Saved locally" is not the same as server-saved or shared. | Successful local write or server save response, dirty-state model, failure handling. |
| sent | Only after send submission succeeds or is durably queued. Do not display "sent" optimistically without failure recovery. | API success/queue receipt, recipient target, timestamp, retry/failure state. |
| fire/egress | Use "draft egress review" or "planning check" unless expert/legal approval exists. | Layout Evidence Pack witness, policy bundle, assumptions, validator version, human review where required. |
| AI-generated | Must identify AI as proposer or assistive source, not authority. | Generator provenance, deterministic validation result before any "valid" claim. |
| venue-approved | Only after explicit venue approval for the exact snapshot or asset. | Approval event, reviewer identity/role, scope, timestamp, expiry or supersession rules. |

## Policy

Public claims must reference evidence or be softened. The copy system should prefer scoped, honest language over impressive but unsupported language.

Internal ADRs can remain ambitious when clearly internal. The guard must not make architecture docs timid; it must prevent those ambitions from leaking into public pages as if they were shipped facts.

Production copy lint should scan deployable assets and customer-facing source files. The default scan set should include:

- `packages/web/public/`
- Public route/page components under `packages/web/src/`
- Pricing, landing, proposal, share, email, and export templates
- Metadata and static copy files that are bundled into public builds

The linter should not scan every internal doc by default. Internal docs need an explicit allowlist so research language does not create false positives while still preventing accidental deployment of private briefs.

Future copy should be generated or validated against active claims. The long-term system should let copy reference claim IDs, evidence pack IDs, runtime package IDs, QA certificate IDs, approval events, and claim lifecycle state. Stale, contested, expired, withdrawn, or superseded claims must block strong public wording or force safer copy.

## Enforcement Phases

### v0 - Targeted guardrails

The current precedent is T-083 and T-097: remove known unsupported public claims and add targeted regression tests for dangerous phrases and private-brief exposure.

### v1 - Deployable asset claim lint

Add a repository test that scans deployable public assets and customer-facing source files for high-risk claim phrases. The test should support a narrow allowlist with required justification, owner, and expiry date.

### v2 - Claim taxonomy and authoring workflow

Maintain a typed public-copy claim taxonomy so designers, developers, and future content tools can distinguish evidence-backed, aspirational, conditional, forbidden, and internal-only language.

### v3 - Venue Claim Graph integration

When the Venue Claim Graph exists, public copy should be derived from active claim state where possible. Copy generation or linting should verify that strong terms such as "verified", "approved", "sent", and "to scale" map to current claims and supporting evidence.

## Guardrails

- Do not encode legal, fire, accessibility, or survey certification as default marketing language.
- Do not claim photoreal or verified output before T-091-style evidence exists for the relevant venue.
- Do not display success states such as saved, sent, approved, or verified unless the underlying state actually occurred.
- Do not hide unsupported claims with CSS; remove, gate, or soften them at source.
- Do not let private briefs live under deployable public paths.
- Do not make public claims from stale, contested, expired, or superseded evidence without visible qualification.
- Do not imply that a signed artifact proves the physical world is true. Signatures prove chain-of-custody for recorded artifacts.

## Non-goals

- Implementing the full Venue Claim Graph.
- Implementing the deployable asset linter in this doctrine task.
- Rewriting public copy.
- Weakening internal ADRs, research reports, or strategy documents.
- Renaming internal `omnitwin` package scopes.
