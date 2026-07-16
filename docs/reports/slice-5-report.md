# Diary Slice 5 — the production rollout pack — Report

**Date:** 2026-07-16 · **Branch:** `feature/diary-p0-slice-3` (never pushed; production untouched — every apply in this slice ran against disposable local databases)
**Task:** T-520 · **Authority:** Diary Canon §12/§18 per `docs/strategy/authority-map.md`; Blake's instruction: "the owner-run migration script + checklist for 0050/0051, dev-instance Clerk claims verification, and the Board's first-run onboarding for the Trades Hall team."

## Status: GREEN

All three deliverables are built, tested, reviewed (both reviews **Ship**, every finding implemented), and — where a rehearsal is possible without touching production — rehearsed end-to-end. The Diary's path to the venue's hands is now two owner actions long, both scripted and checklisted.

## 1. The owner-run migration kit

**Script:** [apply-diary-rollout.ts](../../packages/api/src/scripts/apply-diary-rollout.ts) · **Checklist:** [diary-production-rollout-runbook.md](../operations/diary-production-rollout-runbook.md)

Dry-run by default; applying takes three deliberate hurdles (`--apply`, `--accept-cursor-jump`, `--host <exact-hostname>`); each migration runs in its own transaction with its drizzle ledger row (sha256 + journal `when` — semantics verified against drizzle-orm's own source); post-apply checks confirm the extension, the ink exclusion constraint, and the provenance column. Security hardening baked in: **pinned sha256 hashes** (a drifted file aborts before anything executes), positive host confirmation, a pg advisory lock against double-runs, full prerequisite coverage (including 0050's `client_accounts`/`opportunities` FK targets), Zod-parsed journal.

**Why not `drizzle-kit migrate`:** its cursor would also apply the Foundry chain (0049, 0052–0058), which is owner-gated separately. **The cursor consequence** (verified in drizzle-orm source): recording 0050/0051 permanently hides the older unapplied 0049 from the standard tool — hence the acknowledgment flag and a Foundry-owner heads-up in the runbook.

**Rehearsed on a disposable local database brought to the believed production state (ledger @ `0048_event_architect_ops_reviews`), twice — once per hardening round.** Proven paths: dry-run report · refusal without the acknowledgment (exit 1) · refusal without/with-wrong `--host` · **drift abort** (a byte appended to 0051 → sha256 mismatch → abort; file restored from git) · full apply with post-checks · idempotent rerun ("Nothing to do") · byte-perfect ledger rows (hashes + timestamps re-derived independently) · live `23P01` on an overlapping ink. The runbook embeds the real rehearsal outputs as the operator's expected-output samples, the Neon backup-branch step, stop conditions (ledger drift), exact rollback SQL (dependency-ordered, verified by the security review against 0050/0051's full object inventory, now guarded by a bookings-must-be-empty precondition), and what the rollout deliberately does **not** do.

## 2. Dev-instance Clerk claims verification

**Tool:** [verify-clerk-claims.mjs](../../infra/dev-db/verify-clerk-claims.mjs) — signs in the fixture coordinator through the locally running app, captures the **actual bearer token** the app sends the API, and grades its claims against the exact names the middleware accepts. PASS = the email gate is satisfied by claims and Slice 4's Backend-API fallback goes dormant; FAIL prints the fix. Localhost-only by design.

**Baseline run (today, pre-configuration): FAIL — correctly.** The dev instance issues default tokens (`azp, exp, fva, iat, iss, nbf, sid, sts, sub, v` — no email claim). The fix is one dashboard action: copy the **production** instance's Sessions → "Customize session token" Claims JSON into the dev instance (the email shortcode `{{user.primary_email_address}}` is confirmed against Clerk's docs; the verified-flag shortcode is deliberately not guessed — production's template is the known-working source). Re-run the tool afterwards; it should print PASS.

## 3. The Board's first-run onboarding

One modal screen — **"The Diary, in one minute"** — greets each coordinator on their first visit: pencil, ink, house block & prospect, the tray, the two keyboard verbs, the live channel, and the standing planning-support disclosure, all in the Diary's own vocabulary (copy lives in `board-copy.ts` under the claim-guard sweep). Dismissal persists per user per device ([lib/welcome.ts](../../packages/web/src/pages/diary/lib/welcome.ts) — throw-safe for kiosks/private browsing); the header's **"How the Diary works"** button re-opens it any time. Ink & Gilt modal styling, Escape + single-control tab trap, `preventScroll` focus, scrollable body with the button always in sight — the last two were live-screenshot findings, fixed and re-shot over the seeded board.

Review hardening: the show-on-first-visit effect keys on the **stable user ID** with a per-mount dismissal ref, so Clerk's auth-object churn can never pop a dismissed panel back over an in-progress board even when storage writes are denied — pinned by a regression test that dismisses under denied persistence, churns the auth store, and asserts the panel stays closed. The live e2e's `openSeededWeek` now dismisses the welcome exactly as a real first-run user would.

## Files created / changed

**Commits:** `513cb154` (rollout script + runbook) · `588f98a2` (claims verifier) · `999cc945` (first-run welcome) · `6b01faab` (post-review hardening).
**New:** `packages/api/src/scripts/apply-diary-rollout.ts`, `docs/operations/diary-production-rollout-runbook.md`, `infra/dev-db/verify-clerk-claims.mjs`, `packages/web/src/pages/diary/lib/welcome.ts` (+3 tests), `components/WelcomePanel.tsx`.
**Changed:** `board-copy.ts` (welcome section), `DiaryBoardPage.tsx` (gating + header button), `DiaryBoardPage.test.tsx` (+3 tests), `diary-board.css`, `e2e/support/diary-live.ts`.

## Verification

Diary units **95/95** (welcome gating 3, page 17 incl. the churn regression, claim-guard sweeping the new copy) · live e2e **5/5** with the welcome in the flow · rollout script rehearsed twice end-to-end on disposable DBs (dropped after) · claims verifier baseline-run against the real dev instance · api lint clean, api-src typecheck clean, web typecheck/lint clean, web build green. Tree-wide caveat (not this slice): the Foundry tools package's in-flight V0→V1 renames fail workspace typecheck, and two web tests in the parallel sessions' own areas (EvidenceChip, living-hall) were failing intermittently as those sessions edit — flagged to their owners, untouched here.

## Review (both mandated reviews ran; verdicts **Ship**; every finding implemented, commit `6b01faab`)

| Reviewer | Findings → resolution |
|---|---|
| security-reviewer (Ship, no P1) | P2 pin migration hashes → **pinned + drift-abort proven live**; P2 positive target identity → **`--host` requirement**; P3 advisory lock → **added**; P3 rollback emptiness guard → **runbook §5**; P3 verifier URL validation → **localhost-only**. Verified clean: no dry-run mutation path, no injection surface (parameterization traced into drizzle source), per-migration transaction semantics safe, rollback SQL complete & correctly ordered, runbook hashes byte-exact. |
| typescript-reviewer (Ship, no P1) | P2 welcome could reopen on auth churn when storage writes fail → **stable-ID effect + dismissal ref + regression test**; P2 prerequisite list missing 0050's two FK targets → **completed**; P2 script/runbook task-number mismatch → **already resolved pre-commit** (reviewer read dispatch-time content; committed files are T-520 throughout). P3s adopted: Zod journal parse, transaction-divergence header note, verifier decode guard. P3s acknowledged, not actioned: claim-name duplication between the .mjs verifier and auth-email.ts (cross-language; must-match comments both sides), no portal for the overlay (max z-index verified; noted as future fragility), `infra/` scripts outside the lint project (pre-existing, repo-wide). Its "concurrent session committing this branch" process note was this session's own commits landing mid-review — verified, no collision. |

## Deviations & riders (Blake Clause)

1. **T-number renumbered mid-session** — T-519 was claimed by the parallel A4 card while this slice ran; everything here is T-520, swept through code and docs.
2. **The Clerk dashboard change is not automatable** — instance session-token customization is dashboard-only; the verifier turns your one manual action into a checked, repeatable PASS/FAIL.
3. **The rollout was rehearsed, not performed** — production remains untouched by standing constraint; the apply is yours, per the runbook.
4. **Shared-tree riders:** tasks.md T-520 row added additively; session log appended; both stay uncommitted with the ledger's active owner (T-517 precedent). No shared source files were touched this slice.

## Blake's two owner actions (everything else is done)

1. **Apply the migrations** — [the runbook](../operations/diary-production-rollout-runbook.md): Neon backup branch → dry-run (read the `ledger newest` line!) → `--apply --accept-cursor-jump --host <hostname>` → tell the Foundry owner about 0049.
2. **Configure the dev Clerk instance** — copy production's session-token Claims JSON in the dashboard → `node infra/dev-db/verify-clerk-claims.mjs` → expect PASS.

## Recommendation for Slice 6 (one line)

Merge and deploy: bring `feature/diary-p0-slice-3` to `master` and production hosting (the migrations will already be waiting), turn the Trades Hall coordinators loose on their first real week of pencils, and let the §9 command-envelope tail ride on what their usage teaches us.
