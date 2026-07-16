# G4 — the Action log programme (T-522)

2026-07-16 · spec: 03 §1 principle 1 · gap: 06 §4 G4 ("weeks, load-bearing") · one slice = one session, card discipline applies.

## The one-sentence spec (03 §1, verbatim anchor)

> Every mutation in the product … is one typed, serializable, invertible `Action { id, actor, intent, payload, inverse, provenance, ts }`. … This single decision buys undo/redo, version history, multiplayer sync, the audit trail, AI tool-use (the Action schema *is* the copilot's tool API), phase diffs, and session replay.

## Audit — what already exists (2026-07-16)

**The hard core is built.** `packages/web/src/lib/editor-history.ts` (T-447) is a pure, dependency-free, command-sourced engine recording **invertible field-level deltas** (`HistoryDelta { added, removed, updated: ObjectFieldPatch[] }` with before/after patches), drag-coalescing epochs, selection restore, and bounded memory (100 entries / 2 MB). One timeline already spans the 3D scene and the 2D blueprint (a 42-case reducer feeds the same history). **G4 is an extension of this engine, not a rewrite** — materially smaller risk than the gap audit priced in.

**The gap between `editor-history` and the Action schema:**
1. No envelope — deltas carry no `id / actor / intent / provenance / ts`, and no serialization contract (`@omnitwin/types` has no Action schema).
2. Coverage — only placed-object mutations flow through the engine. Persisted mutations that bypass it: markup strokes (`markup-store`, own persistence schema), lighting rig (`lighting-rig-store`), event details / object notes (API-direct), guideline/measurement/bookmark state where persisted.
3. The undo timeline **evicts** (100-entry cap) — an audit log must be append-only and eviction-exempt.
4. No actor model (operator vs AI vs collaborator) — the AI-tool and audit stories need provenance from day one.
5. No server emission (03 §2: the API "emit[s]/consum[es] Actions") — persistence and the audit read model don't exist.

**Deliberately out of scope for the whole programme:** UI-only stores (device, perf, toast, visibility, xray, section, camera…) are never Actions; Yjs/Zero sync stays deferred (T-105 posture) — the envelope is *designed* so a CRDT layer can adopt it later, but no sync code lands.

## Slices

| Slice | Scope | DoD |
|---|---|---|
| **1 · The envelope + log core** | `ActionSchema` in `@omnitwin/types` (Zod: id, actor `{kind: operator\|ai\|system, ref?}`, intent (namespaced verb, e.g. `object.move`), payload, inverse, provenance, ts); pure `action-log` lib wrapping `editor-history`'s recorded entries into Actions at the `recordChange` seam; append-only in-session log store (eviction-exempt, size-guarded with an explicit overflow policy — summarize, never silently drop); intent derivation from the existing delta labels | Schema + wrap + log pure-tested (TDD); every existing undoable edit emits an Action; undo/redo behaviour byte-identical (existing suites stay green untouched); zero UI change |
| **2 · Coverage widening** | Markup strokes, event details, object notes, lighting rig become Action-emitting (each with named intents + inverses); the blueprint reducer's 42 cases audited for intent names | Each surface's mutations appear in the log with correct inverses (tests per surface); undo scope decision per surface documented (markup keeps its local stroke-undo per T-447's carve-out) |
| **3 · Persistence + audit read model** | Log batches to the API (append-only table, config-scoped, revision-anchored); audit read endpoint; replay-from-log dev verification | Server round-trip tested; audit trail queryable per configuration; claim-safe wording on any surfaced provenance |
| **4 · Consumers** | Evidence lens "Change history" tab reads the audit trail (01 §9 drawer already names it); session-replay dev tool; the AI adapter contract (actions proposed-as-ghosts, never auto-applied — 01 §12 law) | Change history visible in the drawer from real data; replay reproduces a recorded session in dev; AI adapter spec'd + typed, implementation gated on Phase 8 |

Slices 1–2 are pure-frontend and safe alongside the parallel workstreams; slice 3 coordinates with the API lane (booking/diary table conventions apply); slice 4's AI half is contract-only until Phase 8.

## Slice 1 — SHIPPED 2026-07-17

Delivered: ActionSchema in @omnitwin/types; action-log lib (gesture sealing by engine-assigned seq — NOT object identity or length inference); append-only config-scoped log store with explicit fold-on-overflow; editor-store wiring (recordedHistory sweep, undo/redo metas, save + config-boundary flushes, beginActionLogForConfig). Review cycle: two CRITICALs (identity-tracking broken by save-time id remapping; cap-time append+evict masking appends) + one HIGH (stale pre-await history snapshot) found by typescript-reviewer, all fixed same-session with reproductions pinned; a generation-reset defect (seqs restart per config, cursor didn't) caught by our own integration test, fixed via the explicit boundary API. HistoryEntry gained a monotone `seq` (engine change, behaviour-neutral, pinned suites untouched-green).

Deferred to a slice-1.1 hardening pass (reviewer MEDIUMs/LOWs, non-blocking): byte budget on the log store (count-only today; 03 §9 hardware note), appendWithOverflow's maxEntries<2 contract guard, payload type-guards replacing the summary casts, asJson comment honesty, JsonValueSchema prototype-pollution key hardening + z.lazy parse cost (both PRECONDITIONS for slice 3's server ingestion — do not ship slice 3 without them).

## Standing constraints

- TDD throughout; typescript-reviewer per slice; the frame-budget and pixel gates may not regress (the log must never do per-frame work — batch on the existing save/idle boundaries).
- Shared-tree discipline per the 2026-07-16 lessons: pathspec commits, no amends, `git log -1` immediately before committing, hunk-wise staging on shared files.
- The ledger (`docs/state/tasks.md`) is mid-restructure by the diary workstream and was reset today, taking both sessions' day-notes with it (this programme's T-numbers follow the immutable commit messages: next free is T-522). Re-add ledger rows once that file stabilizes.
