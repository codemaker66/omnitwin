# Wave B — foundation (upgrade lane + the Action log)

## CARD B1 · Upgrade lane

Spec: 03 §3 rendering · 06 §3.5
Scope: three 0.180 → r185, @react-three/fiber 8.18 → 9.x (React 19 — check root React version first and include the React upgrade if needed), drei to the R3F-9-compatible major, @sparkjsdev/spark 2.0.0 → 2.1.x (splat-tree LOD + RAD readiness). Run codemods; fix breakages; keep the WebGL2 pipeline (Spark reach doctrine — no WebGPURenderer migration).
DoD: full test suite green; frame-budget test green; Reception Room loads visually identical (pixel-diff tolerance ≤ 1%); a `docs/plan/upgrade-notes.md` records every breaking change touched.
Out of scope: new Spark features (LOD tuning comes with C4/G10 assets), motion-library consolidation (B4 note).
Verify: visual regression on golden routes + manual orbit sanity screenshots.

## CARD B2 · Action schema core (G4a)

Spec: 03 §1 principle 1 · 01 §5 (every mutation an Action) · 04 §4.1 (risks)
Scope: `packages/types` + web store layer: `Action { id, actor, intent, payload, inverse, provenance, ts }`; an action log with apply/invert; inverse-as-snapshot escape hatch for non-algebraic ops (04 §4.1). Pure functions, exhaustively tested. No store rewiring yet.
DoD: property-based tests (apply∘invert = identity on representative action set); serialization round-trip; provenance enum covers operator/AI/import/system; zero UI change.
Out of scope: multiplayer semantics, per-user undo scopes (deferred with T-105).
Verify: vitest only — this card ships no pixels.

## CARD B3 · Store retrofit (G4b)

Spec: 03 §1 · 06 G4
Scope: route `placement-store` + `editor-store` mutations through the Action log (`placeItem`, `moveItem`, `rotateItem`, `placeChairBrush`, label/group ops). Replace `editor-history.js` undo/redo with log traversal. Autosave writes action ranges; existing anonymous-draft persistence keeps working.
DoD: all existing store tests pass unmodified or with mechanical updates; undo depth ≥ 200 with stable memory; audit trail queryable (last N actions with provenance); no interaction latency regression (drag stays < 16 ms).
Out of scope: history filmstrip UI (B4), snapshot/evidence hashing (Wave E ties phases to `phase_layout_snapshots`).
Verify: store test suite + a Playwright drag-undo-redo scenario.

## CARD B4 · History filmstrip + motion consolidation (G4c)

Spec: 01 §5 (history as filmstrip) · 02 §6 tiers · 06 §5 (two motion libs)
Scope: version-history strip with auto-thumbnails (canvas capture on idle), hover-peek, click-to-branch-variant (variant = named fork of the action log). Consolidate motion on framer-motion 12 (`motion/react`) for DOM; remove react-spring usages; add GSAP only if the strip's scrubbing needs it (else defer to Wave E).
DoD: branch-from-history creates a named variant without corrupting the mainline; thumbnails ≤ 50 KB each, capped count; reduced-motion honored; react-spring gone from package.json.
Out of scope: variant compare/diff view (post-F polish), CRDT.
Verify: Playwright flow (edit ×5 → branch from step 2 → both variants intact) + screenshots.
