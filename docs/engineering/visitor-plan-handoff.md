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
(`services/cleanup.ts`, daily via `cleanup.yml`), unless a view-only link to
them is still working (below).

## The PDF (round 1)

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
  by the name the planner shows (below). It has no prices, no capacity verdict,
  no id, no short code and no URL. The footer gives the way forward: the venue's
  events team confirms prices, availability and what the room can hold.
- `hooks/use-visitor-plan-pdf.ts` flushes the autosave first, so the file matches
  the screen, then fetches the PDF and keeps it on the device as a `File`. If the
  drawn geometry changes afterwards, the file is withdrawn ("The plan has
  changed since this PDF was made.") rather than offered stale. Where the browser
  can share files, `navigator.share` hands it to the phone's share sheet;
  everywhere else, Download.

## The view-only link (round 2, migration `configuration_view_tokens`)

- **Table.** `configuration_view_tokens (id, configuration_id → configurations
  ON DELETE CASCADE, token_prefix, token_hash UNIQUE, created_at, expires_at NOT
  NULL, revoked_at)`, with checks that the hash is 64 hex characters and that a
  link expires after it was made. Drizzle: `configurationViewTokens` in
  `db/schema.ts`. Provisional number 0091; the final number is assigned at merge.
- **Token.** `randomBytes(32).toString("base64url")`: 256 bits, 43 characters.
  It is returned once, in the answer that makes it, and stored only as its
  SHA-256; the first eight characters are kept to recognise a link. The shape is
  `PlanViewTokenSchema` in `@omnitwin/types` (`plan-view.ts`).
- **Organiser routes** (`routes/public-plan-views.ts`, the plan's own id):
  `POST /public/configurations/:configId/view-tokens` makes a link (10 an hour;
  only for a plan whose PDF could be drawn; at most 5 working links per plan,
  then 409 `VIEW_LINK_LIMIT`; a row lock on the plan keeps concurrent requests
  inside the limit); `GET …/view-tokens` lists working links without tokens;
  `POST …/view-tokens/:linkId/revoke` stops one (POST, as the other public
  configuration writes are; idempotent, keeps the first stop time; another
  plan's id answers 404).
- **Recipient routes** (the token only): `GET /public/plan-views/:token` returns
  `PlanViewSchema` (room, venue, outline, footprints and counts by planner name,
  the provenance line, last changed, when the link stops), never an id, short
  code or price; `GET /public/plan-views/:token/plan.pdf` is the same PDF. Both
  are `no-store`, `noindex` and `no-referrer`. Every token that does not work
  (malformed, unknown, stopped, expired, or its plan claimed, deleted or swept)
  gets the same 404. No write verb exists under `/plan-views`, and every plan
  route demands a UUID, so a token is never accepted where an id is.
- **Lifetime and retention.** A link works for 30 days (`PLAN_VIEW_LINK_DAYS`)
  unless stopped sooner. `cleanupPreviewConfigurations` now deletes in one
  statement that spares a plan with a working link (not revoked, not expired),
  so a plan gaining a link during the sweep is judged as its row is deleted;
  placed objects and links go with their plan by cascade. Because every link
  expires, no anonymous plan is kept indefinitely by a forgotten link. The link
  is live: it shows the plan as saved, including later changes. Claiming the
  plan into an account ends the link (it reads public previews only).
- **Web.** `api/plan-view.ts`; `hooks/use-visitor-plan-links.ts` (save first,
  make, copy, list, stop); `components/editor/VisitorPlanLinkActions.tsx`, shown
  as "Or send a link" beside the PDF in the Share lens and in the phone's "Send
  your plan" sheet (the top-bar button is now named "Send your plan"). The
  recipient's page is `pages/PlanViewPage.tsx` at `/plan-view/:token`: an ivory
  sheet with the provenance line first, the plan drawn to scale
  (`lib/plan-view-drawing.ts`, the same footprint geometry as the hallkeeper's
  saved plan), counts with a swatch and a name, Download as PDF, and the way on.
  The shared Activity marks every wait.
- **Deploy note.** When the public route allowlist in `vercel.json`
  (public-truth branch) lands, `/plan-view/:token` needs its rewrite there, or
  Vercel will serve the link a 404.

## Names a guest reads

The planner, the PDF and the view-only page name furniture the same way:
`assetDisplayName` (`@omnitwin/types`) gives an item's `plainName` where its
catalogue name is a maker's model reference, else its stored name. Today only
the Burgess Turini 18/3 has one ("Velvet Banquet Chair", the velvet sibling of
the Checked Banquet Chair); the planner's subtitle keeps "Burgess Turini 18/3"
so staff still find it, and the database, inventory and hallkeeper sheet keep
the stock name.

## Checks

```sh
TZ=UTC pnpm --filter @omnitwin/api exec vitest run src/__tests__/visitor-plan-pdf.test.ts --maxWorkers=1
# Route, migration and sweep guarantees on a private disposable PostgreSQL
# (port 55417, database venviewer_visitor_plan_test), one file per run:
VENVIEWER_VISITOR_PLAN_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55417/venviewer_visitor_plan_test \
  TZ=UTC pnpm --filter @omnitwin/api exec vitest run src/__tests__/visitor-plan-postgres.test.ts --maxWorkers=1
VENVIEWER_VISITOR_PLAN_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55417/venviewer_visitor_plan_test \
  TZ=UTC pnpm --filter @omnitwin/api exec vitest run src/__tests__/plan-view-links-postgres.test.ts --maxWorkers=1
TZ=UTC pnpm --filter @omnitwin/types exec vitest run src/__tests__/plan-view.test.ts src/__tests__/asset-catalogue.test.ts --maxWorkers=1
TZ=UTC pnpm --filter @omnitwin/web exec vitest run src/components/editor/__tests__/VisitorPlanPdfActions.test.tsx \
  src/components/editor/__tests__/VisitorPlanLinkActions.test.tsx src/pages/__tests__/PlanViewPage.test.tsx \
  src/lib/__tests__/plan-view-drawing.test.ts --maxWorkers=1
```
