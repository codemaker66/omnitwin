# VSIR-0 Schema Specification — ChatGPT (refined)

Source: ChatGPT (OpenAI), refined second response in same account/conversation as ChatGPT-1.
Date received: 2026-04-29.
Used in synthesis as ADR D-019.

Strongest contributions: BRIN indexes on append-heavy created_at columns, controlled polymorphism in exactly two places (vsir_asset_versions.subject_id, vsir_access_policy_versions.scope_id), three-migration split, parent_layer_version_id self-referencing FK for processing lineage, not_before/not_after on RuntimePackage for time-window validity, coordinateSystemSchema enum, detached DSSE attestation file (vs embedded in manifest), DSSE-doesn't-canonicalize wording precision, KHR-as-RC-alignment-target verification.

Errors identified during synthesis: initially required JCS RFC 8785 canonicalization (corrected by ChatGPT-2 itself in follow-up after Claude's review).

## Original specification text

[Paste full ChatGPT-2 deep research text here]
