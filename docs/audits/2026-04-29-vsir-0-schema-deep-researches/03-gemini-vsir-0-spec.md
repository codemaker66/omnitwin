# VSIR-0 Schema Specification — Gemini (deep research)

Source: Google Gemini deep research mode.
Date received: 2026-04-29.
Used in synthesis as ADR D-019.

Strongest contributions: 404-not-403 tenant guard pattern to prevent UUID enumeration, partial index on pending capture sessions for worker queue polling, explicit Neon serverless pooling caveat in future RLS migration plan.

Errors identified during synthesis: required JCS RFC 8785 canonicalization (incorrect; DSSE PAE eliminates the need), reused polymorphic contextId pattern from existing files table (replicates the anti-pattern the other sources avoid), reprojectionError typed as text (should be numeric), transformationMatrix typed as JSONB (should be fixed-length numeric array), TypeScript code in spec contains syntax errors (empty z.enum() and discriminatedUnion calls), included `prims jsonb` directly on spatial_layer_versions (superseded by D-019).

## Original specification text

[Paste full Gemini deep research text here]
