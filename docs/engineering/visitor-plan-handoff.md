# Visitor plan hand-off

Fix-first item 11 of the 16 October 2026 upgrade brief: an organiser with no
account must be able to send their plan to someone (a partner, a boss) without
being told to "sign in as venue staff", and without handing that person the
power to edit it.

## The boundary that shapes everything

An anonymous plan's configuration id is its edit capability.
`POST /public/configurations/:configId/objects/batch` needs only the id, and
`/plan/:shortCode` resolves to the same plan. So nothing given to a third party
may carry the id, the short code or the planner URL.

Unclaimed public previews with no linked enquiry are hard-deleted after 72 hours
(`services/cleanup.ts`, daily via `cleanup.yml`).

## What is built (branch `claude/visitor-share-20261016`)

- `GET /public/configurations/:configId/plan.pdf` (`routes/public-configs.ts`,
  `services/visitor-plan-pdf.ts`). The organiser's own browser asks with the id
  it already holds, under exactly the anonymous GET's rule: a live public
  preview whose room belongs to the configuration's venue. A claimed, deleted,
  cross-venue or unknown plan answers the same bare 404. Rate-limited to 30 an
  hour. `Cache-Control: no-store`.
- The PDF is one A4 page in the house register (forest ink, copper-ink labels,
  mono-printer safe): venue, room, "Drawn by a visitor; not reviewed by the
  venue.", when it last changed in the venue's clock, the vector plan from
  catalogue footprints with a scale bar (`renderHallkeeperFloorPlan`), and counts
  by catalogue name. It has no prices, no capacity verdict, no id, no short code
  and no URL. The footer gives the way forward: the venue's events team confirms
  prices, availability and what the room can hold.
- `hooks/use-visitor-plan-pdf.ts` flushes the autosave first, so the file matches
  the screen, then fetches the PDF and keeps it on the device as a `File`. If the
  drawn geometry changes afterwards, the file is withdrawn ("The plan has
  changed since this PDF was made.") rather than offered stale. Where the browser
  can share files, `navigator.share` hands it to the phone's share sheet;
  everywhere else, Download.
- Desktop: the Share lens shows anonymous organisers this hand-off
  (`VisitorShareLens`); the proposal chain stays staff-only. Phones have no lens
  dock, so `MobilePlannerTopBar` offers "Plan as a PDF" beside Send, opening
  `VisitorPlanPdfSheet`. The Ops lens now names who prepares the setup pack and
  how to reach them.

## Not built: the read-only link (needs a migration)

A link needs a stored, hashed, revocable token, and the cleanup exemption needs
to know which plans have a live one. No existing table can hold it:
`layout_aliases.kind` is constrained to `uuid`, `shortcode` and `user_slug`, and
the share-token tables reference proposals and supplier packs. Configuration
`metadata` is the hallkeeper sheet's source and part of its hash, so it is not a
place for a credential. The brief forbade migrations in this build, so the link
waits on Blake.

Proposed design, following `proposal_share_tokens`:

- `configuration_view_tokens (id, configuration_id → configurations ON DELETE
  CASCADE, token_prefix, token_hash UNIQUE, created_at, expires_at, revoked_at)`.
  The secret is `randomBytes(32).toString("base64url")`, stored as its SHA-256,
  as `hashShareToken` in `routes/proposals.ts` does.
- `POST /public/configurations/:configId/view-tokens` (the organiser's own id,
  rate-limited) issues one; `DELETE …/view-tokens/:prefix` revokes it.
- `GET /public/plan-views/:token` returns a read-only projection (room, outline,
  footprints, the provenance line, last changed), never the id or short code, and
  `…/plan.pdf` reuses `generateVisitorPlanPdf`. A web page at `/plan-view/:token`
  renders it with Activity for its wait.
- `cleanupPreviewConfigurations` gains `NOT EXISTS (live token: revoked_at IS
  NULL AND (expires_at IS NULL OR expires_at > now()))`.
- Tests on isolated PostgreSQL: the token cannot write (every write route refuses
  it), cannot reach another configuration, stops working once revoked or expired,
  and a plan with a live token survives the sweep while one with a revoked token
  does not.

## Checks

```sh
TZ=UTC pnpm --filter @omnitwin/api exec vitest run src/__tests__/visitor-plan-pdf.test.ts --maxWorkers=1
# Route guarantees on a private disposable PostgreSQL (port 55417, database venviewer_visitor_plan_test):
VENVIEWER_VISITOR_PLAN_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55417/venviewer_visitor_plan_test \
  TZ=UTC pnpm --filter @omnitwin/api exec vitest run src/__tests__/visitor-plan-postgres.test.ts --maxWorkers=1
TZ=UTC pnpm --filter @omnitwin/web exec vitest run src/components/editor/__tests__/VisitorPlanPdfActions.test.tsx --maxWorkers=1
```
