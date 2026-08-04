# Diary Slice 6 report — the merge-and-deploy pack (T-523)

**Date:** 2026-07-16 · **Branch:** `feature/diary-p0-slice-3` · **Task:** T-523
**Scope delivered:** ① branch↔master reconciliation, ② the owner-run deploy
checklist, ③ the production smoke suite for the Diary's first live week.

> **T-number provenance:** T-521 and T-522 were both claimed by parallel
> sessions (Wave A closure; G4 Action log) while this slice was mid-flight.
> Two immutable reconcile commits and early doc drafts therefore carry
> "T-521 reconcile"/"T-522" labels; every editable artifact now says T-523,
> and the tasks.md row under T-523 is canonical. Forward-only history — no
> amends over parallel sessions' interleaved commits.

---

## 1. Reconciliation (merge 1d360e3b)

`origin/master` had moved (homepage series, deployed to production while the
Diary branch grew). Merged master INTO the feature branch; conflicts and
their resolutions:

| File | Resolution |
| --- | --- |
| `packages/web/index.html` | master's live title ("Trades Hall of Glasgow — weddings and events") + the branch's favicon link |
| `packages/web/src/twin/dollhouse-cutaway.ts` (+test) | branch superset — it adds the `MAX_ENGAGE_ELEVATION_TAN` gate on top of master's behaviour |
| `docs/sessions/2026-07-11.md` | union of both sessions' entries |
| `docs/diagrams/task-graph.md` | ours; the live overlay restored afterwards |

**Post-merge gates, all green on the reconciled branch:** web 267 files /
3,188 tests · api 143 files / 2,622 tests (+5 skipped) · both production
builds · the Slice-4 live diary e2e 5/5 against the local stack.

## 2. Two inherited defects found and fixed on-branch

- **Master's CI is RED** (verified via `gh`: CI=failure, Deploy=skipped at
  `1ecbec23`): two route-lazy source pins in `bundle-splitting.test.ts` /
  `spark-stack.test.ts` never learned the Wave-A `cockpitImport(...)` retry
  wrapper. Fixed by widening the regexes to accept the optional wrapper
  (c89dd43c). Consequence: the auto-migrate deploy workflow has not run for
  ANYONE since the refactor — and merging this branch is what turns master
  green again.
- **Committed journal incoherence:** `packages/api/drizzle/meta/_journal.json`
  (committed blob) listed `0049_reconstruction_foundry` whose `.sql` was
  never committed — `readMigrationFiles` throws, so any fresh checkout
  (CI, deploy runner) would crash mid-migrate. Fixed by committing a journal
  that lists only tracked files (a0830f72, crafted with
  `git hash-object`/`update-index` so the working tree — where Foundry
  sessions keep 0049+0052–0058 locally — was untouched).
  **Invariant established: never commit a journal entry without its file.**

## 3. The deploy checklist (`docs/operations/diary-deploy-checklist.md`)

Key finding that shaped it: **Vercel deploys the web on push WITHOUT waiting
for CI** (the homepage shipped while CI was red), Railway builds the API from
the same push, and `deploy.yml` migrates only after CI succeeds (~15 min
later). Naïve merge-and-push therefore serves Diary code against a database
with no bookings tables for a window. The checklist closes it:

1. Neon backup branch → state report (expect production ledger newest =
   `0043_platform_admin_scope` — verified; deploy.yml never ran, see §2).
2. `DATABASE_URL=<production> pnpm --filter @omnitwin/api db:migrate`
   **FIRST** — applies 0044→0051 in journal order (no cursor stranding,
   possible only because of the §2 journal fix).
3. Merge + push master; CI goes green; deploy.yml's migrate is a no-op.
4. Verify SHAs/health; run the smoke suite (§4); Clerk claims + Foundry
   0049 heads-up ride along.

The Slice-5 runbook is **demoted to state-report + emergency selective-apply
tool** (STATUS blockquote added): its `--apply` path would record 0050/0051
above the cursor and strand 0044–0048 forever.

## 4. The production smoke suite (`packages/web/e2e/production-smoke.spec.ts`, 4dc4dfbd)

`PROD_SMOKE=1`-gated (default runs: 4 skipped, verified); serial on purpose
(a failing read probe skips the write probe — never write into a sick
system). Tests: every API health surface + version log · front door
title/main · signed-in Diary (real lanes from GET /calendar, `Live · N`
presence, claim-safe "Planning support only" line, first-run welcome
dismissed like a person) · **opt-in** (`SMOKE_ALLOW_WRITE=1`) write probe
that lands one labelled house block tomorrow 03:00–03:30 and releases it.
Auth: storage-state path for production's email-code challenge (instructions
in-spec; `.smoke/` gitignored); `SMOKE_TEST_OTP` exists strictly for
dev-instance dress rehearsals.

**Dress rehearsal against the local stack: 4/4 green ×3 consecutive**
(20.7s / 21.8s / 21.3s), after three live-caught fixes worth keeping:

1. **Welcome-overlay race** — probing the welcome with an instant
   `isVisible()` before the board settled let the overlay mount later and
   eat the "New booking" click. Pattern (mirrors Slice-4's helper): wait for
   "Grand Hall" FIRST, then dismiss, then assert hidden.
2. **Regex-unsafe title** — `new RegExp(title)` with a parenthesised date
   never matches (parens = group); titles are now escaped before locator
   regexes.
3. **OTP challenge path** — the fixture's email-code branch needed the
   explicit dev-only `SMOKE_TEST_OTP` answer; production keeps the honest
   fail-with-instructions behaviour.

Residue hygiene: the one `active` probe row left by a mid-rehearsal failure
was deleted from the local dev DB (the `released` trace row from the passing
run is the designed footprint).

Gates on the spec: web `tsc --noEmit` green; package lint green (e2e files
sit outside the eslint/tsc projects by repo convention — additionally
verified with a one-off `tsc --strict --noUncheckedIndexedAccess` probe whose
only diagnostics were the environmental missing-node-types `process`
complaints, zero code defects).

## 5. Review

`everything-claude-code:typescript-reviewer` ran over the full Slice-6 TS
surface (smoke spec, both pin-fix test files, merge resolutions incl.
dollhouse-cutaway). Findings and dispositions are recorded in §5a below;
per the standing rule, findings were implemented literally.

### 5a. Findings

**Verdict: SHIP, zero P0s.** Five findings; the reviewer also positively
verified seven claims (dollhouse superset pure-additive with sound gate
math, index.html union, surgical staging left the parallel session's hunk
intact, every hardcoded UI string in the probe matches the real components,
the welcome ordering is provably race-free — the welcome effect is
synchronous localStorage on auth-store state while lanes need a network
round trip, widened pin regexes empirically reject adversarial inputs).

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | P1 | Write probe: no try/finally, deterministic per-day title → a mid-probe failure orphans an ACTIVE row and a same-day re-run creates an ambiguous duplicate the `.first()` release can mis-target | **FIXED** — per-run token in the title (`#<base36 ms>`), create→release wrapped so any failure path ends in a best-effort second release or a loud `[smoke] WRITE PROBE LEFT AN ACTIVE ROW` log naming the exact title; `retries: 0` file-wide (a retried probe would double-book). Re-rehearsed 4/4 green. |
| 2 | P1 (pre-existing, systemic) | `e2e/**` outside ALL typecheck/lint coverage (tsconfig `include:["src"]`; eslint project service hard-errors) — zero static analysis on specs that perform production writes | **TRACKED as T-524** (dedicated e2e tsconfig + eslint wiring). The reviewer independently ran a strict standalone tsc probe on the smoke spec: 0 errors, no `any`. |
| 3 | P2 | Header documented the happy-path residue (released row) but not the failure residue (active row) | **FIXED** — header now documents the failure residue + the manual cleanup path, alongside Finding 1's runtime logging. |
| 4 | P2 (speculative) | `Promise.race` sign-in could resolve "signed-in" prematurely if Clerk ever navigated off /login before rendering the OTP field | **ACCEPTED with rationale** — explicitly speculative per the reviewer; a premature resolution fails loudly one step later (the Diary assertions demand authenticated surfaces), so the failure mode is a clear test failure, not a silent pass. |
| 5 | P2 (pre-existing) | Only 3 of 9 lazy pages had static-import negative assertions | **FIXED** — all 9 pages now asserted via a loop; bundle-splitting suite 13/13. |

## 6. What this slice deliberately did NOT do

- **No push to master, no deploy** — production is live; a push IS a deploy
  (Vercel §3). The checklist makes the deploy Blake's owner action.
- No production database writes (one read-only ledger SELECT for §3's
  "expect 0043" verification).
- No CAPTCHA/bot-protection circumvention in the smoke auth path — the
  storage-state instruction replaces automation where production challenges.

## 7. Remaining tail (unchanged from Slice 5 unless noted)

- **Blake:** run the checklist §2–§6 (backup → migrate → merge/push →
  verify → smoke); Clerk dashboard claims + verifier re-run; tell the
  Foundry owner about 0049 hand-apply + the journal invariant.
- Command envelopes (Canon §9), hold-reminder delivery job, Redis backplane
  before a second API replica.
- NEW: once merged, watch the first `deploy.yml` run confirm "nothing to
  migrate" (checklist §4).
