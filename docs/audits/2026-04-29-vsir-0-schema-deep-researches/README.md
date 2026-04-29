# VSIR-0 Schema Deep Researches — 2026-04-29

Four independent deep research outputs commissioned for the VSIR-0 concrete schema specification. All four reviewed in sequence, synthesized into ADR D-019.

| File | Source | Key contributions |
|------|--------|-------------------|
| 01-claude-vsir-0-spec.md | Claude Opus 4.6 | branded IDs, matrix4d, narrow QA cert, per-pass spec, RLS plan |
| 02-chatgpt-1-vsir-0-spec.md | ChatGPT (OpenAI) initial | status enum + partial unique, JSONB CHECK constraints, header-in-DB-body-in-file |
| 03-gemini-vsir-0-spec.md | Google Gemini | 404-not-403 tenant guard, pending-session partial index |
| 04-chatgpt-2-vsir-0-spec.md | ChatGPT (OpenAI) refined | BRIN indexes, controlled polymorphism, lineage FK, detached attestation, DSSE precision |

## Synthesis outcome

See ADR D-019 for the committed VSIR-0 design that emerged from these four sources.

## Why four sources

Cross-validation. Where all four converge, the consensus is high-confidence. Where they diverge, the strongest single answer is selected with explicit reasoning. Where any source makes a verifiable technical error, the error is identified and corrected.

Errors identified during synthesis:

- Two sources (Gemini, ChatGPT-2 initial) required JCS canonicalization. Both were wrong — DSSE PAE eliminates the need. ChatGPT-2 acknowledged the error in follow-up review.
- One source (Gemini) replicated the polymorphic anti-pattern from the existing files.contextId column. ChatGPT-2's controlled-polymorphism middle position is the correct fix.
- Two sources (Claude, Gemini) included `prims jsonb` directly on spatial_layer_versions. D-019 supersedes with the "header in DB, body in file" pattern from ChatGPT-1/ChatGPT-2.

## Two follow-up ADRs needed

All four sources independently missed two architectural concerns:

- D-020: VSIR-0 QA jobs orchestration queue table
- D-021: VSIR-0 partition strategy for long-lived growth (HASH or LIST partitioning by venue_id, OR RANGE by created_at — NOT range on venue_id since UUIDs don't have meaningful range ordering)

Both committed as future ADR work.
