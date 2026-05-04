# Calibrated Reliance Principle

Status: Active product/UX architecture doctrine  
Date: 2026-05-01  
Source: CALIBRATED-001  
Depends on: T-123, T-135, T-136, T-157, T-172, T-198, D-015  
Relates to: Truth Mode, Layout Evidence Pack, Guest Flow Replay, Claim-Aware Copy Guard, Capture Certification Tiers

## Purpose

Calibrated reliance is Venviewer's global product principle for trust cues. Users should rely when evidence is strong, distrust when evidence is weak, and verify when evidence is uncertain or incomplete.

This principle started in Truth Mode research but applies beyond Truth Mode. It governs AI-generated layouts, Layout Evidence Packs, Guest Flow Replays, mobile save/send states, public copy, photoreal rendering, capture certification, and any UI that asks a user to act on venue truth.

Venviewer should not make users either blindly trust or manually audit everything. The product should help users place the right amount of reliance on each claim, artifact, status, render, and action.

## Core Definitions

### Appropriate Reliance

Appropriate reliance means the user's confidence matches the evidence.

Examples:

- A planner trusts a table-count total because it comes from current saved layout objects.
- A hallkeeper verifies a route because the evidence pack says accessibility requires human review.
- A client understands that a cinematic render is a proposal view, not measured venue proof.
- A capture reviewer trusts Black Label only when the control network, QA report, and certification evidence support it.

### Overtrust

Overtrust happens when the interface makes weak, stale, generated, inferred, failed, or missing evidence feel stronger than it is.

Examples:

- A photoreal render makes generated geometry feel measured.
- A "verified" badge appears without reviewer, validator, scope, timestamp, and expiry.
- A save indicator says "Saved" after a failed request.
- A Guest Flow Replay looks like fire approval instead of planning evidence.

### Undertrust

Undertrust happens when strong evidence is hidden, undersold, noisy, or hard to inspect, causing users to ignore valid product output.

Examples:

- A genuinely current Layout Evidence Pack is buried behind developer language.
- A mobile user cannot see whether their layout was saved even though persistence succeeded.
- A capture tier has strong measured evidence but the UI shows only a generic warning.

### Trust Junk

Trust junk is decorative or vague trust signalling that does not help a user decide what to rely on.

Examples:

- Unexplained numeric trust scores.
- Generic green checkmarks with no scope.
- Badges that say "AI verified" without evidence.
- Heatmaps or confidence percentages that imply precision the system does not have.
- Repeated warnings that do not tell the user what changed, what to do, or whether the issue matters.

Trust junk should be removed or replaced with evidence-linked cues.

### Evidence-Linked Cue

An evidence-linked cue is a UI or copy signal that is backed by inspectable evidence and scoped to a specific claim, action, artifact, or state.

Examples:

- "Saved locally" backed by local persistence state.
- "Draft egress check: requires review" backed by a Layout Evidence Pack witness.
- "Appearance-only region" backed by Scene Authority and Truth Mode source state.
- "Targeting Black Label" backed by an explicit aspirational/public-copy posture, not a certification claim.
- "Verified for layout planning" backed by reviewer/validator identity, scope, timestamp, and expiry.

Evidence-linked cues do not need to expose raw data by default. They must allow progressive drill-down for users who need it.

## Global Rules

- No false precision. Use categorical bands and scoped statements by default.
- No unexplained trust scores. A number without evidence, scope, or action is trust junk.
- Evidence cues must be inspectable. Normal users get compact cues; expert users can drill down.
- "Verified" labels require evidence: subject, scope, evidence source, reviewer or validator, timestamp, and staleness/expiry policy.
- Uncertainty cues must not overload the user. Default surfaces should show the smallest useful signal and reveal details on demand.
- Photoreal appearance is not proof. Visual realism must not silently upgrade geometry, capture, or compliance trust.
- AI output is a proposal until checked by deterministic validators or human reviewers where required.
- Save/send/status language must reflect actual state, not optimistic intent.
- Public copy must be evidence-linked or visibly qualified.

## Application Areas

### Truth Mode

Truth Mode is the main inspection surface for calibrated reliance, but it must not become a wall of warnings.

Truth Mode should:

- show compact L1/L2 cues for normal users
- expose evidence, source, verification, confidence, staleness, provenance, and authority as separate axes
- avoid one green badge for complex truth
- avoid always-on per-Gaussian heatmaps for normal users
- let hallkeepers, QA users, and experts drill down into L3/L4 evidence

Success means users neither overtrust photoreal output nor undertrust measured/verified regions.

### AI Layout Generation

Prompt-To-Perfect and future AI layout generation must present AI as an untrusted proposer.

AI output should:

- label generated layouts as proposed until checked
- expose assumptions that AI introduced
- run deterministic validators before presenting a plan as valid
- distinguish "looks plausible" from "checked against venue rules"
- route uncertain or high-stakes outputs to human review

The user should trust AI for idea generation, not for unchecked operational validity.

### Layout Evidence Packs

Layout Evidence Packs should increase reliance only within the evidence scope.

Evidence Pack cues should:

- show claim status as pass, warn, fail, not checked, inapplicable, requires human review, or stale
- cite policy bundle and assumption scope
- distinguish stale evidence from failed evidence
- avoid legal/fire/accessibility certification language unless qualified evidence exists
- show current evidence compactly and let experts open witness blocks

The product should make "this was checked for this snapshot under these assumptions" clear without forcing normal planners into raw witness JSON.

### Guest Flow Replay

Guest Flow Replay is planning evidence, not observed reality and not evacuation certification.

Replay cues should:

- label the scenario and assumptions
- disclose whether the replay is current, stale, partial, or missing
- show uncertainty categorically, especially for stochastic or single-seed runs
- distinguish simulated agents from captured venue truth
- avoid legal/fire approval language
- require expert or human review for high-stakes route claims

Users should trust replay for operational insight, not for statutory approval.

### Mobile Save and Autosave

Mobile save/send cues are trust cues. They must be honest because users act on them immediately.

Mobile status should:

- say "Saving", "Saved locally", "Saved just now", "Unsaved changes", "Save failed", or "Offline - saved locally" according to actual state
- never show "Saved" if the save request failed
- distinguish local save from server save or team submission
- show retry affordance when failure occurs
- keep the cue compact and visible without cluttering the scene

The user should know whether they can safely close, continue editing, or send.

### Public Marketing Copy

Public copy is a trust interface. It must not outrun current evidence.

Public copy should:

- use evidence-backed claims when evidence exists
- use visibly qualified aspirational copy when evidence does not exist yet
- avoid broad "verified", "photoreal", "survey-grade", "fire-approved", or "Black Label certified" language without supporting evidence
- align with exposure tier and claim/copy guard doctrine
- avoid turning internal roadmap language into public fact

The product should be ambitious internally and precise publicly.

### Photoreal Rendering

Photoreal rendering increases overtrust risk because visual fidelity feels like truth.

Rendering surfaces should:

- distinguish real venue, proposed event objects, generated/proxy assets, and appearance-only regions where needed
- ensure Truth Mode or related cues can reveal measurement/provenance state
- avoid using beauty renders as proof of geometry, safety, or certification
- preserve planning function when appearance layers are disabled or downgraded

The more convincing the render, the more disciplined the evidence cues must be.

### Black Label Certification

Black Label should be trusted only when capture evidence supports it.

Black Label cues should:

- require capture tier metrics, control network evidence, QA report, capture-session scope, and reviewer accountability
- name the venue/space/capture scope
- expose expiry or refresh policy
- avoid implying all downstream layouts, renders, or operational outputs are automatically verified
- degrade or stale when capture, geometry, policy, or review state changes

"Targeting Black Label" is not "Black Label certified." The UI and copy must keep that distinction visible.

## Cue Design Rules

Evidence-linked cues should be:

- scoped: what claim or action is this about?
- current: is the supporting evidence stale?
- inspectable: where can an expert see the backing evidence?
- actionable: what should the user do if it is weak?
- quiet by default: normal users should not be forced through diagnostic panels
- layered: L1/L2 summary, L3/L4 evidence for advanced review

Avoid:

- standalone trust scores
- vague "verified" badges
- confidence percentages without measurement basis
- warning spam
- hiding uncertainty in tooltips only
- positive labels that collapse local, server, team, and public states into one word

## Non-Goals

- No runtime UI implementation in this doctrine.
- No public copy changes.
- No database schema.
- No validation engine.
- No claim graph implementation.
- No package rename.
