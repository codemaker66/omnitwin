# Calendar Repo Survey — Ground Truth for the Diary Architecture

Status: survey complete. Surveyed from source snapshot 2026-07-04 (omnitwin2-src.zip) by the external architect. Every claim carries a path. Intended home: `docs/strategy/calendar-repo-survey.md`.

## 1. Stack

| Layer | Choice | Evidence |
|---|---|---|
| Monorepo | pnpm workspaces: `packages/api`, `packages/web`, `packages/types`, `tools/*` | `pnpm-workspace.yaml` |
| API | Fastify 5 + Drizzle ORM + Neon Postgres (serverless driver) | `packages/api/package.json` |
| Auth | Clerk (`@clerk/fastify`, `@clerk/react`), platform_role vs venue role split | tasks.md T-471 note; `routes/auth.ts` |
| Realtime | `@fastify/websocket` installed; one channel so far (`api/src/ws/auto-save.ts`) | `packages/api/src/ws/` |
| Email | Resend + react-email; `email_templates`, `email_sends` tables | api deps; `db/schema.ts` :802, :2322 |
| PDF/QR | pdfkit + qrcode; hallkeeper PDF v2 service | `services/hallkeeper-pdf-v2.ts` |
| Web | Vite + React 18 + react-router 7 (`src/router.tsx`), Zustand, framer-motion, R3F/Three 0.180 + Spark (splats), Playwright + Vitest | `packages/web/package.json` |
| Validation | Zod everywhere; shared `@omnitwin/types` | workspace layout |
| Billing | Stripe (`subscriptions`, `stripe_events`) | `db/schema.ts` :862 |
| Deploy | Vercel (web) + Railway (api) + Neon; production live at venviewer.com | `railway.json`; tasks.md T-469/470 |

Test scale: ~92 API test files (~1,985 tests), ~205 web test files (~2,650 tests) per tasks.md 2026-06-24/07-02 notes. Frame-budget, chunk-budget, visual-check, and accessibility harnesses are established gates.

## 2. Schema inventory relevant to the Diary

All in `packages/api/src/db/schema.ts` (2,351 lines). Line refs approximate.

**Identity/tenancy:** `venues` (:46, has `timezone` IANA, default Europe/London), `spaces` (:91 — physical dims, floor outline, mesh; **no capacity fields, no hierarchy/combinability, no turnaround fields**), `users`, `organisations`, `workspaces`, `workspace_memberships`, `workspace_entitlements`, platform_role on users.

**CRM spine:** `enquiries` (:529 — `spaceId` NOT NULL single-space, `preferredDate` date, state varchar, guest + named capture), `enquiry_status_history`, `client_accounts`, `contacts`, `opportunities` (:611 — `stage`, `preferredDate` date, `guestCount`, `estimatedValueMinor` GBP, `nextAction` + `nextActionDueAt` convention, `sourceEnquiryId`), `opportunity_status_history`, `activities`, `follow_up_tasks`.

**Commercial:** `proposals` + versions + status_history + **share_tokens** + comments (:1888–1999), `quotes` + `quote_line_items` + `package_selections`, `pricing_rules` (:697), money in minor units (`services/money.ts`).

**Events core:** `events` (:1103) — venueId, name, eventType, `status` varchar default "draft", `startsAt/endsAt` timestamptz **nullable**, guestCount, **`clientName` denormalised varchar — no clientAccountId/opportunityId FKs**, soft delete. `event_phases` (:1131) — eventId, templateKey, sortOrder, startsAt nullable, durationMinutes, guestCount, density/staffConflicts placeholder fields defaulting to `not_checked` (honest-placeholder pattern), **no spaceId — phases are venue-global, not room-scoped**. `event_scenarios`, `layout_variants`, `event_configuration_links` (:1196), `phase_layout_snapshots`.

**Truth Mode:** `evidence_items`, `check_results`, `assumption_records`, `review_gates` (:1296), `claim_states`, `evidence_packs` + items, `stale_evidence_events`, `general_audit_log` (:1380).

**Ops:** `handoff_packs` (:1403), `task_groups`, `ops_tasks`, `task_assignments`, `task_completion_events`, `ops_status_updates`, `furniture_pick_lists` + items, `hallkeeper_progress` (:334), `event_day_issues`, `queue_zones`, `staff_lanes` (:1865), `load_in_sequences`, `breakdown_sequences`, **`room_flip_plans` (:1616)**, `beo_documents`, `snapshot_diffs` (:1644).

**Suppliers:** `suppliers`, `supplier_instructions`, `supplier_coordination_packs` + items + **share_tokens** + `supplier_acknowledgements` (:1479–1592) — supplier magic links are live (`/supplier-share/:token` route).

**Change/notify:** `event_plan_changes` (:2079 — actorRole, sourceKind/sourceId, title, summary, beforeSummary/after…), `event_plan_notifications` + reads + acknowledgements (:2108–2136). A working "what changed" narrative system already exists.

**Revenue:** `revenue_scenarios`, `pricing_assumptions`, `comfort_constraints`, `scenario_comparisons`, `analytics_snapshots` (:2157–2231).

**Integrations:** `integration_connections`, `webhook_endpoints`, **`external_calendar_links` (:2286 — syncDirection default `read_only`, status `pending_setup`)**, `website_embed_configs`, `integration_events`.

## 3. Collision & reuse table (proposed Diary entity → verdict)

| Proposed | Verdict | Notes |
|---|---|---|
| events | **EXTEND** | Add clientAccountId, opportunityId FKs; keep soft delete; status becomes ops-readiness axis |
| event_phases | **EXTEND (structural)** | Needs `spaceId` (or phase_spaces join) to become the Occupancy Footprint primitive; currently room-blind |
| room_bookings / room_holds | **BUILD (one table)** | Absent. Single `bookings` table: kind `prospect\|hold\|ink\|internal_block`, rank + joint flag, decisionAt, spaceId, eventId nullable, tstzrange; exclusion constraint (ink only) via custom SQL migration — Drizzle can't express EXCLUDE natively; Neon supports btree_gist |
| availability_rules / blackouts | **BUILD** | Rules table generating internal_block bookings; mirror `pricing_rules` shape (:697) for house consistency |
| setup/teardown buffers, turnaround_rules | **BUILD rules; REUSE artifacts** | `load_in_sequences`/`breakdown_sequences`/`room_flip_plans` exist as per-event ops artifacts; the *rules/templates* layer is absent |
| calendar_tasks | **REUSE — do not build a third task system** | `follow_up_tasks` (CRM) + `ops_tasks`/`task_groups`/`task_assignments` (ops). Diary read model unions both |
| calendar_conflicts | **BUILD** | Mirror `check_results`/`review_gates` honesty pattern (typed, explained, `not_checked` defaults) |
| resource_allocations | **BUILD** | `asset_definitions` covers furniture; shared singletons (goods lift, PA, kitchen) absent |
| supplier_arrivals | **EXTEND** | Add arrival windows to supplier_coordination items; tokens/acks already live |
| staff_assignments | **PARTIAL REUSE** | `task_assignments` + `staff_lanes` exist; person-level rota is thin |
| event_status_history | **BUILD (pattern exists)** | Copy enquiry/opportunity/proposal status-history convention; `general_audit_log` is the unified audit stream — don't duplicate it |
| external_calendar_links | **EXISTS** | Scaffold matches R8 (read-only first) |
| reminders/notifications | **REUSE** | `event_plan_notifications` (+reads/acks) and `email_templates`/`email_sends` are the rails for drip/challenge/diff badges |
| recurrence/series | **ABSENT** | Confirmed nowhere; nullable `series_id` plan stands |

## 4. Conventions the Diary must follow

- **Tasks:** `docs/state/tasks.md` — 453 rows, format `| T-NNN | title | status | impact 1–5 | effort days | deps | source (D-NNN decisions, research §) | notes |`; statuses `not-started|in-progress|done|deferred|blocked|rejected`; highest observed ID T-471; "Latest task notes" prose log above the table.
- **Specs/plans:** `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` + matching `plans/` file (Twin, Landing precedents). Decisions live as D-NNN under `docs/decisions/`.
- **Claude Code contract:** root `CLAUDE.md` — squad personas, mandatory handoff protocol (COMPLETED / VERIFIED / UNVERIFIED / REMAINING / NEXT PROMPT), stack lock (Fastify not Express, Drizzle not Prisma, zero `any`), ".claude/AI_INTEGRITY_RULES.md — Seven Laws". Build prompts must conform.
- **Claim safety culture:** pervasive — "planning-grade copy", claim-guard test sweeps, SAFE disclosures, honest placeholder statuses, refusal to hide failures with CSS (T-470 notes). Diary conflict copy must follow ("planning support / human review", never asserted compliance).
- **State machines:** `api/src/state-machines/{config-review,enquiry,proposal}.ts` — add `booking.ts` for the commitment axis.
- **Client-safe = separate token routes:** `/proposal-share/:token`, `/supplier-share/:token`, `public-configs`/`public-enquiries` routes — established pattern; client Diary views follow it, never filtered internal serializers.
- **Design tokens:** `web/src/global.css` — `--vv-ink #090807`, `--vv-gold #d7b56d`, `--vv-cream #f6f1e8`, `--vv-cyan #6bd9e8`, danger/success/focus. Graphite/gold/cyan dark luxury is the house style; "pencil" texture and "ink" fill must be built from these.
- **Dashboard shell:** `/dashboard?view=` switch — existing views: enquiries, pipeline, reviews, analytics, proposals, search, loadouts, settings, onboarding, admin (`pages/DashboardPage.tsx` :207) with role gating (:65). The Diary is a new view (plus probable full-bleed route for the timeline).
- **Routes (web):** `router.tsx` — notable: `/plan`, `/blueprint`, `/hallkeeper/:configId`, `/ops/events/:eventId`, `/ops/handoff/:handoffPackId`, `/venues/:venueSlug/twin`, share routes above.
- **API routes:** `api/src/routes/` — 35 files incl. `events.ts`, `event-day-ops.ts`, `event-plan-lifecycle.ts`, `ops-handoff.ts`, `hallkeeper-sheet.ts`, `revenue-analytics.ts`, `integrations.ts`, `crm.ts`, `public-enquiries.ts`.

## 5. Ten things the architect must know

1. **The one big structural gap:** no booking/hold table anywhere; `events.startsAt/endsAt` nullable and room-blind. Space-time occupancy is currently unrepresented — the Diary's core table is genuinely greenfield.
2. **`event_phases` has no spaceId.** Making phases room-scoped is the highest-risk migration; everything (footprints, flips, buffers, conflicts) depends on it.
3. **`events.clientName` is a string.** CRM linkage (clientAccountId, opportunityId) must be added for the Sell→Hold journey; today events float free of the pipeline.
4. **`enquiries.spaceId` is NOT NULL** — multi-room enquiries can't be expressed at enquiry level; handle multi-room at opportunity/booking level or relax later.
5. **Capacity lives in the planner, not on spaces** — `spaces` has dimensions only; capacity guidance appears at configuration/layout level (capacity card in `/plan`). Fit Finder must join configurations.
6. **Timezone discipline half-done:** `venues.timezone` exists (Europe/London); all Diary business rules must evaluate venue-local (BST/GMT tests required).
7. **Massive reuse wins:** diff/notification system (`event_plan_changes` + notifications), supplier magic links + acks, proposal share tokens + comments, hallkeeper PDF+QR, Resend templates, `general_audit_log`, Truth Mode gates. Roughly half the "signature ten" have rails already laid.
8. **Websocket infra exists but is single-purpose** (auto-save). Server-authoritative realtime for the Diary is native; no third-party realtime dependency required unless R5 research says otherwise.
9. **Exclusion constraint needs a raw SQL migration** (drizzle-kit custom migration; enable `btree_gist` on Neon). Holds may overlap by design; only `ink` participates.
10. **Quality gates are real and enforced** — typecheck/lint/full suites, Playwright matrices, frame budgets, claim-guard sweeps. Build prompts must budget for them (they are why the repo can absorb a feature this size).

## 6. Suggested first task rows (for later, pending Blake's approval — do not add yet)

T-472 Diary domain schema (bookings, ladder, blocks, buffers/turnaround rules, exclusion constraint) · T-473 booking state machine + status history · T-474 calendar read model `GET /calendar` · T-475 multi-room timeline view v1 · T-476 conflict engine v0 (typed, explained, honest defaults) · T-477 hold hygiene (decision dates, reminders, auto-resequence) — IDs to be confirmed against tasks.md at write time.

## 7. Size note

Zip is ~174 MB: `packages/web` 126 MB (visual assets/fixtures), `artifacts/` 17 MB, `output/` 14 MB, root screenshots. Source itself is small; no concern.
