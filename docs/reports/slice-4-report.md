# Diary Slice 4 — prove it live — Report

**Date:** 2026-07-16 · **Branch:** `feature/diary-p0-slice-3` (never pushed; production untouched — see Production safety below)
**Task:** T-518 · **Authority:** Diary Research Canon v1.5 §9/§15 per `docs/strategy/authority-map.md`; architecture doc §11; Blake's instruction: "apply migrations 0050/0051 to a dev database, seed the Trades Hall week, and prove the whole Diary live end-to-end with a Playwright spec."

## Status: GREEN

The Diary is no longer mocked-verified — it is **proven live**. On an isolated local Postgres 16.6, the **entire migration journal (0001→0058)** applied cleanly for the first time ever; the seeded Trades Hall week serves through the real API; and `e2e/diary-live.spec.ts` — two coordinators signed in through the **real Clerk dev instance**, no stubs, no `__OMNITWIN_E2E__` bypass — passed **5/5 scenarios, four consecutive runs**: the board renders the live calendar; the drawer writes a real booking; a public enquiry becomes a pencil through the tray; a genuine two-browser ink race is arbitrated by the btree_gist exclusion (Postgres `23P01` → 409 → the drawer's slot-taken copy); and the ws channel shows `Live · 2` presence and delivers a colleague's booking with **no reload**. The live run did exactly what a prove-it-live slice should: it flushed out four real defects (below), all fixed with tests in this slice.

## Production safety (the first decision of the session)

`packages/api/.env`'s `DATABASE_URL` points at the **`ep-dawn-glitter` Neon project — production's**, per [docs/PRODUCTION.md](../PRODUCTION.md) §Neon. It was never touched: no migration, no seed, no write. (One read-only `SELECT count(*)` verified that a brief mis-route of e2e sign-ins through a parallel session's API — which sits on port 3001 against that DB — created **zero** rows there; only reads occurred.) Everything below runs on the isolated stack.

## The local dev stack (new, reusable — runbook)

| Piece | What / where |
|---|---|
| Postgres 16.6 | Portable EDB binaries in `.dev-db/` (gitignored), `127.0.0.1:54329`, database `omnitwin_dev`. Docker path also authored (`infra/dev-db/docker-compose.yml`) — Docker Desktop's Linux engine currently dies into a GUI error dialog on this workstation (WSL itself is healthy); needs Blake's eyes once, the portable path needs nothing. |
| Driver bridge | `infra/dev-db/neon-ws-bridge.mjs` — the `@neondatabase/serverless` driver is WebSocket-only; with TLS/pipelining off, the proxy is a pure byte shovel `ws://localhost:54331 ↔ tcp://127.0.0.1:54329`. [client.ts](../../packages/api/src/db/client.ts) routes **localhost URLs only** through it (inert for Neon URLs; source-pinned). |
| Migrations | `DATABASE_URL=postgresql://postgres@localhost:54329/omnitwin_dev pnpm --filter @omnitwin/api db:migrate` — drizzle-kit prefers the new `pg` devDependency (plain TCP). |
| Seed | Same URL, `db:seed` (runs through the bridge): venue, 6 rooms, 22 diary bookings (week of Mon 14 Sep 2026), turnaround rules, and two live-e2e staff coordinators (`fiona/graham .coordinator+clerk_test@tradeshall.co.uk`, `clerkId NULL` so the first real sign-in JIT-links to the seeded identity). |
| API | `PORT=3011` + the dev `DATABASE_URL` + `TWIN_PUBLIC_VENUE_SLUGS=trades-hall-glasgow`. **3011, not 3001** — parallel sessions keep a Neon-pointed API on 3001; an unnoticed `EADDRINUSE` there had the e2e briefly talking to the wrong instance. |
| Web | `env -u CLERK_PUBLISHABLE_KEY VITE_API_URL=http://localhost:3011 vite --port 5174 --strictPort`. The env scrub matters (see finding 4). |
| Clerk fixtures | `node infra/dev-db/provision-clerk-test-users.mjs` — Backend-API provisioning (refuses non-`sk_test` keys, marks emails verified). UI sign-**up** is not automatable: Clerk's bot-protection step wedges the form, and automating around a CAPTCHA is off the table. Sign-**in** automates cleanly (password + `424242` on new devices). |
| Run the proof | `E2E_BASE_URL=http://localhost:5174 E2E_API_URL=http://localhost:3011 E2E_START_SERVER=false pnpm --filter @omnitwin/web exec playwright test e2e/diary-live.spec.ts` |

## What the live run proved (DB-level receipts)

- `btree_gist` installed; `bookings_ink_no_overlap` present with the exact half-open predicate — and a direct overlapping insert answered `ERROR: conflicting key value violates exclusion constraint` (23P01) before any app code was involved.
- The two-coordinator race in the spec produced the same 23P01 in `pg.log`, surfaced in coordinator B's drawer as "That slot was just inked by someone else — the board has been refreshed.", while A's ink stood — then the winning ink was released through the lifecycle matrix ("Cancel the ink"), freeing the slot (the spec is self-healing about leftovers from crashed runs).
- `bookings.enquiry_id` provenance (migration 0051) verified by FK presence and by the tray conversion writing a live hold.
- The other session's uncommitted migrations 0049/0052–0058 also applied cleanly — worth a line in their day.

## Live-run findings — all fixed with tests this slice

| # | Found live | Fix |
|---|---|---|
| 1 | **Silently dead submit button** (T-495 defect): the create drawer opens with hold defaults (`rank "1"`, owner); choosing "House block"/"Inked" hides the hygiene fieldset but the stale values rode into the payload — the shared schema rightly rejected ("Only holds carry an option-ladder rank"), and the error rendered under a **hidden** field: nothing visible, no request, dead button. | [drawer-form.ts](../../packages/web/src/pages/diary/lib/drawer-form.ts): `formToCreatePayload` now expresses only the **visible** form (hold-only fields stripped for other kinds); new pure `hiddenFieldError` + drawer wiring surfaces any slotless error as the form-level error — a validation message can never land invisibly again. Unit regressions for both; the e2e create test now passes as a user would experience it. |
| 2 | **Every real Clerk token was rejected locally** (`403 EMAIL_REQUIRED`): the dev instance issues **default** session tokens with **no email claim**; the fail-closed email gate (production relies on customised claims) refused them all. Local real-token auth has been broken repo-wide — masked until now by the e2e bypass and mock tokens. | New [middleware/clerk-email.ts](../../packages/api/src/middleware/clerk-email.ts): when claims lack a usable verified email, resolve the user's **primary verified** address from Clerk's Backend API (the `sub` comes from the already-verified JWT; the secret key is already required). Fail-closed preserved: unverified/missing → the claims-path verdict stands; 5-minute per-clerkId cache; inert in production (custom claims short-circuit). Wired into `authenticate` and `resolveWsUser` (HTTP and both ws channels). 6 unit tests + the pre-existing email-gate security tests stay green and hermetic. **Recommendation for Blake:** add the same session-token claim customisation to the dev Clerk instance (Dashboard → Sessions) — the fallback then goes dormant. |
| 3 | **One idle DB-client error killed the whole API process** mid-e2e (unhandled `'error'` on the Pool → Node exit; also the root of an alternating-run flake), and the resulting thrown 500s were **invisible** (Sentry-only observability, no Sentry in dev). | `pool.on("error")` guard in [client.ts](../../packages/api/src/db/client.ts) (crash → one failed request; the pool self-heals — the flake vanished, four consecutive green runs); [error-normalizer.ts](../../packages/api/src/middleware/error-normalizer.ts) now `request.log.error`s every ≥500 before the Sentry callback. Source-pinned. |
| 4 | **The long-standing "Clerk never works locally" mystery, solved**: the running dev server had baked `pk_live_localbuildcheck` (the build-check fixture!) — `resolveWebClerkPublishableKey` prefers any `pk_live_*` from shell env over `.env`'s `pk_test`, and that fake key decodes to an unresolvable Clerk domain → `ERR_NAME_NOT_RESOLVED` → the "Clerk-failure flip" the A2 session logged. | No code change (the pk_live preference is a deliberate production safeguard): the runbook launches dev Vite with `env -u CLERK_PUBLISHABLE_KEY`, and the trap is recorded in session memory + here. |

## Files created / changed

**Infra (new):** `infra/dev-db/docker-compose.yml`, `infra/dev-db/neon-ws-bridge.mjs`, `infra/dev-db/provision-clerk-test-users.mjs`, `.gitignore` (+`.dev-db/`).
**API:** `db/client.ts` (local-URL proxy branch + pool error guard), `middleware/clerk-email.ts` (new), `middleware/auth.ts`, `ws/auto-save.ts`, `middleware/error-normalizer.ts`, `db/seed.ts` (+2 coordinators), `drizzle.config.ts` (note), `package.json` (+`pg` devDep — rider on the parallel session's file, one line), tests: `__tests__/db-client-local.test.ts` (new, 5), `__tests__/middleware/clerk-email.test.ts` (new, 6).
**Web:** `pages/diary/lib/drawer-form.ts`, `pages/diary/components/BookingDrawer.tsx`, `lib/__tests__/drawer-form.test.ts` (+2), **`e2e/diary-live.spec.ts` + `e2e/support/diary-live.ts` (new — the proof itself)**.

## Verification

**e2e:** `diary-live.spec.ts` 5/5 — **four consecutive runs** (23–25 s each) against the live stack; self-healing across crashed-run leftovers. **Unit/static:** api typecheck ✓ lint ✓ **139 files / 2,575 tests** ✓ build ✓ · web typecheck ✓ lint ✓ **3,140 tests** ✓ · full workspace build ✓ (under the parallel session's new HTTPS-`VITE_API_URL` production gate, satisfied inline for the local check). Totals include the parallel sessions' additions in the shared tree — also green.

## Review (both mandated reviews ran on the slice diff; every finding implemented literally, commit `d8158133`)

**security-reviewer — verdict SHIP** (no P1: fail-closed posture intact and symmetric across HTTP/ws; `payload.sub` trust chain verified against the installed `@clerk/backend`; no info-leak; provisioning script's `sk_test`-only guard correct). Findings, all fixed:

| Finding | Fix |
|---|---|
| P2: fallback cache had no invalidation when Clerk-side identity changes | `evictClerkEmailCacheEntry` wired into `processClerkWebhookEvent` (user.created/updated/deleted) |
| P2: fallback path had zero observability | Backend-API failures now logged; transient failures distinguishable from verdicts |
| P2: transient Clerk failures cached like confirmed verdicts (5-min lockout from a blip) | "unavailable" results are **never** cached (404 = confirmed, cacheable); confirmed-negative verdicts cache only 60 s |
| P2: `db:seed` had no production-DB guard (the `.env` URL **is** the production project) | seed refuses non-local `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1` |
| P3s | in-flight de-duplication (a concurrent burst costs one lookup, tested); oldest-entry eviction instead of clear-all; banned/locked Clerk accounts fail closed; shared `normalizeAuthEmail` |

**typescript-reviewer — verdict Block → resolved.** The P1 was correct and important: the new live spec would run (and fail) in the default CI e2e job, which provisions no stack. Findings, all fixed:

| Finding | Fix |
|---|---|
| P1: `diary-live.spec.ts` unguarded in the default/CI e2e run | file self-gates: skips unless `E2E_DIARY_LIVE=1` — verified both ways (5 skipped without the flag; 5 passed with it) |
| P2: `auth ↔ clerk-email` circular import papered over with dynamic imports | resolved at the root: verified-email primitives extracted to the new leaf `middleware/auth-email.ts`; both call sites now static; `auth.ts` re-exports so no importer changed |
| P2: `createDb` mutated the `neonConfig` singleton with no reset for non-local URLs | explicit else-branch restores driver defaults; regression test (local→neon in one process) |
| P2: cache dedupe claim overstated for concurrent bursts / negative TTL | both already in the security hardening (in-flight promise map; 60 s negative TTL); tests pin each |
| P2: no regression test for the new `request.log.error` on 500s | added — spies the logger, asserts the line fires for 5xx and not for 4xx |
| P2: locator `.first()` inconsistency in the spec | both remaining title locators scoped |
| P3s | bridge `WebSocketServer` error handler (EADDRINUSE says so instead of crashing); loud failure when the leftover-ink sweep can't clear the window; coupling comments on the error-slot lists both sides |

P3s acknowledged, not actioned: the compose file's `:main` proxy tag and its unexercised status (documented in Deviations); the source-text pin for the pool guard (house pattern); no integration test drives the fallback's success path through `authenticate` (the live e2e **is** that path, end-to-end).

## Deviations & riders (Blake Clause)

1. **"Apply 0050/0051" became "apply 0001→0058"** — drizzle-kit applies the whole journal to a fresh database; that is the stronger proof and the first real-Postgres validation the journal has ever had. Production application remains a separate, owner-gated action, unchanged.
2. **Docker path authored but not exercised** — Docker Desktop's engine fails into a GUI error dialog on this workstation (WSL distros healthy; logs captured in-session). The compose file is committed as the preferred path for machines where Docker works; the portable-PG + bridge path is the proven one here.
3. **Auth hardening rode into a Diary slice** — finding 2 is platform auth, not Diary code, but the live proof was impossible without it and the change is fail-closed + production-inert. Flagged rather than silently scoped in.
4. **Shared-tree riders:** `packages/api/package.json` (+1 devDep line) and `pnpm-lock.yaml` touch the parallel session's modified files. `docs/state/tasks.md` got its T-518 row **additively** and is left uncommitted with the ledger's active owner (their in-flight rewrite), per the T-517 precedent.
5. **The e2e writes real fixtures into the dev Clerk instance and the local DB** (two test users; per-run bookings with unique titles; enquiries accumulate by design since conversion never touches the enquiry lifecycle). Resend fires real (rejected) notification attempts — the dev key only delivers to the owner address; expected noise, no mail leaves.
6. **Sign-up automation deliberately not attempted** past Clerk's bot-protection wall — fixtures are provisioned through the sanctioned Backend API instead.

## Open questions (none blocking)

Production migration apply (owner-gated, as every slice has said) · dev Clerk instance session-token claims (makes the fallback dormant) · Docker Desktop engine repair (Blake, once) · CI wiring for the live spec (needs the local stack bootstrapped in CI or a dedicated test DB) · the §9 command-envelope tail, hold-reminder job, Redis backplane (unchanged from Slice 3).

## Recommendation for Slice 5 (one line)

Take the Diary to the venue's hands: apply 0050/0051 to production (owner-run, minutes), configure the dev-instance session-token claims, and put the Board in front of the Trades Hall team for the first real week of pencils — the software is ready before the rollout is.
