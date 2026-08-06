# Proposal: re-key the activation enable migration from ordinal 0059 to content identity

**Status:** PROPOSAL — not applied. Amending the parent contract requires the third amendment plus its own independent frozen-hash re-audit; nothing here edits any frozen artifact.
**Date:** 2026-07-28
**Origin:** P2-1 of `docs/reports/omnitwin-foundry-activation-v1-nine-artifact-joint-audit-2026-07-28.md`.
**Decision owner:** Blake (with the activation-contract reviewer at the next amendment audit).

## Problem

`docs/specs/omnitwin-foundry-derivative-activation-v1.md` §2/§15/§16 designate a fixed ordinal: "**0059, and only 0059, may enable.**" Ordinal 0059 is permanently consumed by the unrelated, committed planner migration `packages/api/drizzle/0059_action_log.sql` (journal idx 57; 0060 and 0061 follow). The enable clause is therefore unsatisfiable as written. The failure direction is closed — the collision confers no enablement authority — but the contract referent is defective and must be amended before any enable-stage work could ever be specified.

## Proposed amendment (to land in the third amendment, verbatim intent)

Replace the fixed-ordinal designation with content identity plus intervening-chain binding:

> The single enable migration may sit at whatever journal index is next unoccupied at enable time. It is identified by its exact content SHA-256, bound into the enabled-epoch JSON. It must contain only the generation-2 `enabled_release` epoch append; it must not modify migrations 0053–0058; and the epoch evidence must additionally bind the exact SHA-256 of every intervening migration (0059 through N−1) together with catalog proof that none touches any V1 relation, base control table, role, or `fdv1_*` routine.

Sections to update in the same amendment: §2 stage 5, the §15 stage-table row, and the §16 heading/body ("0059 evidence gate" → "enable-migration evidence gate"). All existing prohibitions transfer unchanged to "the enable migration under any ordinal."

## Explicitly rejected alternative

Renumbering `0059_action_log` is inadmissible: it is committed history with committed successors; rewriting would violate the journal's append-only custody and the planner workstream's byte pins, and would recreate the same collision class this amendment removes.

## Why the intervening-chain binding is load-bearing

Ordinal re-keying alone would silently widen the trust base: any migration appended between 0058 and the enable migration would become an unexamined participant in the enabled state. Binding every intervening migration's hash plus a no-touch catalog proof keeps the enable evidence exactly as closed as the original fixed-ordinal design intended.

## Interaction with existing evidence

`packages/api/src/__tests__/foundry-derivative-activation-0058-static-evidence.test.ts` (added 2026-07-28) already asserts that no enable-shaped migration exists at any index and that 0059/0060/0061 contain no `fdv1_`/`enabled_release`/`foundry_derivative` references. It is compatible with this proposal and requires no change when the amendment lands; the amendment's own gate tests would extend, not replace, it.

## Boundary

This proposal grants nothing. 0058 remains disabled; the enable migration — under ordinal 0059 or any successor designation — remains prohibited until the full §16 evidence gate and independent re-audit pass. No execution, provider, credential, spend, signing, publication, or production-database action is authorized by this document.
