# Data Sufficiency Contract

Status: Active planning doctrine  
Date: 2026-05-01  
Source: DSC-001  
Depends on: Layout Proof Object, Scotland Policy Bundle, Review Gate Engine, Assumption Ledger, Venue Data Request Pack  
Relates to: Deterministic Validator Kernel, Guest Flow Replay, Lighting Context Package, Truth Mode

## Purpose

The Data Sufficiency Contract prevents Venviewer from converting missing inputs into false certainty.

No check, simulation, evidence pack, lighting context, or trust surface may silently turn missing data into `pass` or `fail`. Missing or insufficient data must remain visible as an explicit machine-readable outcome and a human-readable disclosure.

This doctrine is planning only. It does not implement validators, simulator code, renderer code, database schema, dependencies, public copy, or package renames.

## Core Rule

When required inputs are missing, stale, unsupported, or outside v0 scope, the system must emit one of:

- `unsupported_request`: the requested claim/check/output is outside available data or v0 capability.
- `not_checked`: the check is known but was not run, or the required submitted input was absent.
- `degraded_evidence`: the system can produce partial evidence, but it is weaker because inputs are missing, lower-confidence, stale, or incomplete.
- `requires_human_review`: machine evidence cannot resolve the request safely and a named review role is required.

The system must not infer:

- missing route data as route pass
- missing venue data as venue approval
- missing probe data as correct lighting
- missing simulation assumptions as valid flow evidence
- missing residual capture metadata as serious appearance evidence
- missing provenance as verified truth

## Validator Kernel Integration

The Deterministic Validator Kernel must test data sufficiency before emitting a domain verdict.

If required inputs are absent, the witness block should emit:

- `messageKey`
- `messageArgs`
- `facts`
- `requiredData`
- `dataSufficiencyOutcome`
- `policyRefs`
- `snapshotRefs`

The kernel still emits message keys and structured facts, not human prose. Human-readable wording belongs to the template catalog.

`unsupported_request`, `not_checked`, `degraded_evidence`, and `requires_human_review` are distinct from `pass` and `fail`. They are not weak passes, hidden warnings, or UI-only labels.

## Scotland Policy Bundle Integration

The Scotland Policy Bundle must use the Data Sufficiency Contract for venue-supplied facts and v0 route boundaries.

Examples:

- no submitted route polyline or graph path: `not_checked` or `unsupported_request`
- missing exit widths: `requires_human_review` or `degraded_evidence`, depending on purpose
- missing protected-surface rule: `requires_human_review`
- request for arbitrary route discovery in v0: `unsupported_request`
- request for legal egress approval from v0 checks: `unsupported_request`

## Guest Flow Replay Integration

Guest Flow Replay must not produce a confident scenario summary when required scenario inputs are missing.

Examples:

- missing guest arrival window: `degraded_evidence`
- missing door availability: `requires_human_review`
- missing vertical connector model for a multi-level route: `not_checked`
- request for evacuation certification from v0 replay: `unsupported_request`
- single-seed sensitive scenario: `degraded_evidence` or `requires_human_review`

## Lighting Context Integration

Lighting Context Package outputs must disclose missing lighting data.

Examples:

- inserted object outside all lighting volumes: `degraded_evidence`
- no local probe/cubemap for a high-contrast transition zone: `degraded_evidence`
- wall boundary missing for probe interpolation: `requires_human_review`
- request for physically accurate relighting from sparse probes: `unsupported_request`

## Truth Mode Integration

Truth Mode must make data sufficiency visible without overwhelming normal users.

Normal users should see compact states such as:

- "Not checked"
- "Needs venue data"
- "Draft evidence"
- "Needs review"
- "Unsupported in this version"

Expert/QA users should be able to inspect required data, missing fields, policy references, assumptions, and witness facts.

Truth Mode must not collapse data sufficiency into a green check or a single confidence percentage.

## Non-Goals

- No implementation of status vocabulary.
- No validator kernel implementation.
- No simulator implementation.
- No renderer implementation.
- No public marketing copy change.
- No package rename.
