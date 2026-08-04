# 06 · Gap Audit — omnitwin2 vs the Plan

10 July 2026 · Basis: two thorough repo sweeps (frontend + domain/docs) plus direct spot-checks (schema greps, session logs, capture state). Statuses are evidence-linked; *depth* grades on commercial features are estimates pending a runtime smoke pass in Claude Code — flagged where so.

---

## 1. Headline

**The repo is materially ahead of its own bible.** The bible's "current gaps" list (CRM missing, Event entity missing, proposals missing, evidence runtime incomplete) is stale: the schema has **122 tables** including `events`, `event_phases`, `event_scenarios`, `phase_layout_snapshots`, `opportunities`, `proposals`, `quotes`, `evidence_items`, `claim_states`, `evidence_packs`; ~33 API route groups cover CRM → proposals → ops handoff → event-day; claim-guard code and tests exist; a capture-to-truth factory landed **today** (T-480, session log 2026-07-10); 6,697 tests pass.

The real gap is concentrated in one place: **the experience layer**. The six primitives (01) barely exist in UI. The plan's job is therefore sharper than expected: not "build the platform" — largely done at the spine level — but **make the Floor real on top of a spine that's already there.**

## 2. Scorecard

Status: ✅ present · ◐ partial · ✗ absent · (?) depth unverified

### Track 1 — Reality

| Capability | Status | Evidence |
|---|---|---|
| Runtime package schema + API | ✅ | `/assets/runtime-packages/latest`, `RuntimePackage` schema, trades-hall manifest (149 scan nodes, "ops-grade-2cm", Z-up) |
| Splat loading (Spark) | ✅ | `SparkSplatLayer`, `useRoomRuntimeSplat`; Spark **2.0.0** |
| Real room runtime assets | ◐ | 8 rooms captured; **1 runtime built (Reception Room, 63 MB / 2.0 M splats)**; 7 pending training; `training_runs.jsonl` empty (hygiene flag — doctrine says it records every run) |
| Capture factory | ✅ | T-480 (today): capture-intake CLI, digest-addressed staging, immutable ledgers, fail-closed conflicts, `/dev/capture-intake` |
| Room switching UX | ◐ | venue-slug routing exists; multi-room switch flow unpolished/untested |
| Collision proxy / BVH picking | ✗(?) | no `InstancedMesh`/BVH found in web src (despite instancing screenshots in repo root — verify branch state in Claude Code) |

### Track 2 — Commercial

| Capability | Status | Evidence |
|---|---|---|
| CRM (opportunities, activities, status history) | ✅(?) | schema + routes; UI depth unverified |
| Proposals + versions + share links | ✅(?) | `/proposal/:shareCode`, proposal versioning, claim-guarded validation tests |
| Quotes / line items / pricing rules | ✅(?) | schema + routes |
| Public showcase / landing | ◐ | `/`, `/landing`, `/living-hall`, `/pricing` exist; not the "room resolves" public experience of 00 §5 |
| FOH register (ivory/serif client surface, 02) | ✗ | client pages share BOH styling |
| Payments | ◐ | `stripe_events` table; flow depth unverified |

### Track 3 — Planning → Ops

| Capability | Status | Evidence |
|---|---|---|
| Event entity + phases + scenarios + per-phase layout snapshots | ✅ | `events`, `event_phases`, `event_scenarios`, `phase_layout_snapshots` — the bible said these were missing; they are not |
| Event Architect + Mission Control surfaces | ✅ | `/event-architect`, `/ops/events/:eventId` (T-160/481/482 closed today) |
| Ops handoff / hallkeeper / PDFs | ✅ | `HandoffPack` routes, `HallkeeperPage`, pdfkit sheets, R2 pre-rendering |
| Planner editor core | ✅ | placement/snap/clearance/measure/labels/undo-redo/autosave across ~20 zustand stores (`placement-store`, `editor-store`, `cockpit-store`…) |
| **Timeline UI (scrub, morph, flip-gap)** | ✗ | `cockpit-phase-model.ts` builds phase cards from `EventPhaseGraph` — data ready, no timeline component |
| **Altitude** (2D/3D as one view) | ✗ | 2D is a *separate* `/blueprint` page — exactly the split 01 P1 abolishes |
| **Ghosts** (preview-first material) | ✗ | direct placement only |
| **Live Numbers** | ✗ | `cost-store` exists; no scrubbable vitals |
| **Command pill** | ✗ | only undo/redo shortcuts |
| Walk mode / dollhouse / seat view | ✗ | no first-person; camera bookmarks ≈ POV seed (`bookmark-store`, `CameraReferenceComposer`) |
| Guest-flow simulation | ✗ | schema stubs only (matches plan Phase 7) |

### Track 4 — Evidence

| Capability | Status | Evidence |
|---|---|---|
| Evidence objects + claim lifecycle | ✅ | `evidence_items`, `claim_states`, `evidence_packs`, review gates |
| Claim guard in code | ✅ | `public-claim-guard.test.ts`, claim-config route — the plan's "enforce in CI/egress" is real |
| Truth Mode UI | ◐ | `TruthModeIndicator`, `cockpit-truth-rail-model`, status chips (`vv-status-chip`), **"evidence beams"** — gold light columns anchored to floor points (a repo invention the plan should adopt: Proof made spatial) |

### Track 5 — Reliability

| Capability | Status | Evidence |
|---|---|---|
| Test discipline | ✅ | 6,697 tests; 237 web test files; frame-budget test (`sspp-performance-budget.test.ts`); Playwright |
| Perf engineering | ◐ | adaptive DPR, perf store/overlay; no instancing/BVH/LOD ladder |
| Multiplayer/CRDT | ✗ | none; **T-105 explicitly deferred** — consistent with 04 §6's advice |
| Observability (Sentry/OTel/PostHog) | (?) | not confirmed by sweeps — verify |

## 3. Plan corrections (where repo reality wins)

The plan docs (03 especially) are hereby amended:

1. **Vite + Fastify stay.** 03's Next.js 16 recommendation is withdrawn — the repo is a Vite SPA with a Fastify API, lazy-loaded to keep editor chunks <1.5 MB, and that architecture is *right* for an app-shell product. If public-showcase SEO ever demands SSR, add a thin separate marketing site; don't migrate the app.
2. **Clerk, Neon, Resend, pdfkit are decided** (in production use). 03's WorkOS/Auth.js options collapse to Clerk; Postgres platform = Neon.
3. **No Tailwind migration.** The repo styles with raw CSS variables — and its palette (`--vv-ink`, `--vv-gold`, `--vv-cream`, `--vv-cyan`) has *convergently evolved into House*. Ship House as a token layer over the existing CSS-variable system; 02's Tailwind packaging is dropped.
4. **Naming bridge** — the repo's inventions map cleanly onto the plan's; adopt the mapping instead of renaming twice: Cockpit (overlay system) ≈ the Floor's chrome · cockpit modes (planning/review/flow/proposal) ≈ 01 §modes · evidence beams ≈ Proof, spatialized · `EventPhaseGraph`/phase cards ≈ Timeline data layer · `BlueprintPage` ≈ Plan band (to be absorbed by Altitude) · bookmarks ≈ saved POVs.
5. **Upgrade lane, not rewrite**: three 0.180 / R3F 8.18 / drei 9.122 / Spark 2.0.0 → three r185 / R3F 9.5 / Spark 2.1 (RAD streaming + splat-tree LOD). Sequence it immediately before the Altitude build (G3) — camera work gets rebuilt then anyway. Consolidate motion on one library (framer-motion 12 is in; react-spring also present — pick one).

## 4. The gap list, ordered (G-series)

| # | Gap | Plan ref | Size |
|---|---|---|---|
| G1 | **Reception Room golden loop**: make the one built runtime the default `/plan` experience — manifest → resolve-over-blueprint load → honest status chip | 00 §7 L0 | days |
| G2 | House token layer over `--vv-*` vars; motion consolidation; chip grammar (01 §9) | 02 | days |
| G3 | **Altitude rig**: absorb `/blueprint` into the planner as the Plan band; continuous scroll; ink layer | 01 P1 | weeks |
| G4 | **Action log**: retrofit placement/editor stores to typed invertible Actions (unlocks deep undo, audit, AI tools, future sync) | 03 §1 | weeks, load-bearing |
| G5 | Ghost material + preview-first placement (paste/duplicate/brush previews) | 01 P2 | week |
| G6 | **Timeline UI** over the existing phase model: scrub, morph, flip-gap card, compile-to-ops hook | 01 P3/§7 | weeks |
| G7 | Live Numbers vitals cluster (extend cost-store; guest-count reflow ghost-first, with zone pinning) | 01 P4/§8 | week |
| G8 | Command pill — local verbs + questions first; AI schemes later (Phase 8) | 01 P5 | week |
| G9 | Instancing + BVH + LOD ladder; keep the frame-budget test honest at 500 objects | 01 §17, 03 §5 | week |
| G10 | 7 remaining rooms through the capture factory → runtime packages (RunPod lane) | Track 1 | ops, parallel |
| G11 | FOH register skin on the existing proposal share page (ivory/serif/dusk) | 02, board F | week |
| G12 | Presence/multiplayer — **stays deferred** (T-105) until G1–G8 land | 04 §6 | later |

Sequence note: G1 → G2 → (upgrade lane) → G3/G4 in either order → G5–G8 → G9 → G11. G10 runs in parallel throughout. This is the SS++ ordering expressed against the actual repo.

## 5. Hygiene flags

- `training_runs.jsonl` and `asset_versions.json` are empty while `capture_log.json` shows 8 rooms — doctrine says every run is recorded; reconcile or the evidence story has a hole at its own root.
- Root-level screenshots ("instanced-furniture.jpeg" etc.) imply instancing work that the current web src doesn't show — confirm whether it lives on a branch or was reverted; don't re-do or falsely claim it.
- Two motion libraries, no token file, and 20+ stores with overlapping concerns (`visibility-store` vs `cockpit-store` toggles) — G2/G4 are the moments to consolidate, not before.
- The bible's "current gaps" section should be regenerated from this audit — a stale gap list misdirects every future session.
