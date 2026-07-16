# Wave A closure — acceptance check against 06 G1/G2

2026-07-16 · covers CARD A1 (T-494, `88861196`) · A2 (T-498, `727234a0`) · A3 (T-517, `c86039dd`) · A4 (T-519, `4b69c39e`) · this closure sweep.

## G1 — Reception Room golden loop (00 §7 L0)

| Acceptance element | Verdict | Evidence |
|---|---|---|
| The one built runtime is the default `/plan` experience | **Met** | A1: anonymous bootstrap → `reception-room` (fallback chain to `grand-hall` → first space); e2e-proven logged-out; venue-routing suite 9/9 |
| Manifest → resolve-over-blueprint load | **Met** | A2: blueprint ink first paint, per-chunk coarse-to-fine develop, quiet claim-safe caption, no spinner anywhere, `data-resolve-phase` honesty attribute, reduced-motion crossfades; e2e at a genuine 50 Mbps CDP throttle with develop-start/2 s/complete evidence |
| Honest status chip | **Met, upgraded** | A1: data-driven chip pipeline + canonical atelier fallback copy, never display-hidden (guardrail test); A4: the canonical `EvidenceChip` grammar on the rail/indicator |

**Caveats owed (named owners):**
1. **Signed room-local alignment** — the Reception Room view transform remains "approximate" by its own note; the locally-available twin-pipeline SOG chunks render misaligned against the lcc2-calibrated transform. Owner: capture/registry lane (T-091-adjacent).
2. **Reference-laptop timings** — §21.1/§13 budgets measured locally only (fallback interactive 792–910 ms vs 1.5 s; <300 ms warm ink not yet timed on reference hardware).
3. **Live-loop state changed post-A2** — a parallel workstream retired the legacy runtime-package browser resolver (`use-room-runtime-splat` now degrades to the atelier fallback pending an anonymous profile contract). G1's *wiring* is complete and tested; the *live* default experience currently shows the honest fallback by that workstream's design until their contract lands. Owner: runtime-resolver workstream.

## G2 — House token layer · motion consolidation · chip grammar (02)

| Acceptance element | Verdict | Evidence |
|---|---|---|
| House token layer over `--vv-*` | **Met** | A3: canonical `--house-*` at 02-exact values, single-sourced, 9-test contrast/canon gate; zero visual regression (dashboard 8/8 + public 4/4 pixel suites); 06 §5's "no token file" hygiene flag resolved |
| Chip grammar (01 §9) | **Met** | A4 + this sweep: canonical `EvidenceChip` (four states exactly, provenance badges, icon + label always, focus-ring buttons when interactive); fixture route `/dev/evidence-chips`; consuming surfaces: router fallback, cockpit truth rail, TruthModeIndicator verification row, EditorPage bootstrap blocker |
| Motion consolidation | **Partially met** | A3 tokenized the three duration tiers; the "two motion libraries" hygiene flag no longer reproduces (only `framer-motion@12.38.0` in deps — verified by dependency + import grep today). OPEN: the scene-side ease/spring constants (A2's develop eases, the spring tables) are not yet expressed through the House motion tokens — small C-band follow-up |

**Legacy surface after the sweep (all deliberate, all documented):**
- High-delta `--vv-*` literals (gold ×2, muted, cyan, danger, success, focus, panel ×2) stay frozen pending **Blake's palette decision** — flipping them to House canon is a visible brand shift (e.g. gold `#d7b56d` → brass `#C6A15B`).
- `vv-status-chip` remains for exactly three non-evidence pills: ProtectedRoute's two access states (access ≠ evidence — forcing the grammar would misuse it) and DashboardLayout's user-name tag (not a status; file foreign-locked this pass).
- Four `#090807`-as-text-on-gold sites (OpsHandoff ×2, ProposalsView, CommercialPipelineView) await a semantic on-accent ink token (FOH/F2 territory) — a background token as text colour would be semantically wrong.
- This sweep migrated the five semantically-clean literal sites (DashboardLayout gradient, ReviewsView, NotificationCenter ×2, RoomShowcasePage ×3 — ivory text / bg-0) at sub-pixel-diff deltas. Pixel verification: public suite 4/4 at closure time (covers the RoomShowcase swaps); the dashboard suite was 8/8 for identical deltas at A3 time but is blocked at closure time by a parallel in-flight edit that removed the `#dashboard-main` selector from `DashboardLayout.tsx`/`DashboardPage.tsx` (evidenced: selector absent from their foreign-modified files; this sweep's diff touches no markup). Owner: dashboard/diary workstream.

## Standing flags

- **Branch tip not self-contained for fresh checkouts**: commits since `4b69c39e` register routes for two still-untracked Living Hall pages (`LivingHallRuntimePreviewPage.tsx`, `LivingHallLocalPreflightPage.tsx`). All local actors are unaffected. Owner: Living Hall workstream — commit the pages (preferred) or ask for a forward revert of the registrations.
- Shared-tree incident record (sweep + amend near-miss, fully unwound, lessons memorized) lives in `docs/sessions/2026-07-16.md` under the T-519 addendum.

## Wave verdict

**G1: functionally closed** — every card element shipped and verified; three named caveats, one owned outside this wave. **G2: closed for tokens + chip grammar; one small open item** (ease/spring constants onto the motion tokens). Wave A's remaining work is enumerated above with owners; nothing is silently open.
