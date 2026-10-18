# Supplier passes

A supplier pass is a supplier coordination pack (`supplier_coordination_packs`)
with one live link. Staff issue it from the event board (`/ops/events/:eventId`,
the Supplier passes section); the supplier opens it at `/supplier-share/:link`
with no account. Stage 1 of "A Door for Everyone Outside" (October 2026).

## Where it lives

| Part | Code |
| --- | --- |
| Contracts and stop-date rules | `packages/types/src/supplier-coordination.ts` (`SupplierPassBoard`, `SupplierPassSummary`, `SupplierPassDetails`, `defaultSupplierPassExpiry`, `checkSupplierPassExpiry`) |
| Routes | `packages/api/src/routes/supplier-coordination.ts` (`/supplier-coordination/*` for staff, `/supplier-share/*` public) |
| Board, plain words, lineage | `packages/api/src/services/supplier-passes.ts` |
| Staff section and Issue pass sheet | `packages/web/src/components/supplier-passes/` |
| Supplier's page | `packages/web/src/pages/SupplierPortalPage.tsx` |

## Rules the code holds

- **Who.** Staff, managers and admins (`canAdministerVenue`) make, link and
  withdraw passes. Hallkeepers read the board (`canManageVenue`) and change
  nothing. Every read is scoped by venue and event.
- **Stop date.** Every new pass stores one: by default seven days after the
  event's last booked moment (the Diary's active bookings win over the event
  row's own times), at most thirty days after it, never in the past. An undated
  event's pass needs a chosen date. A pass made before this rule, with no stored
  date, is read as stopping seven days after its event; with no date and no
  event, its link does not open. No migration backfills the column.
- **One live link per pass.** Making a link closes the earlier ones. The pass
  row is locked while the link is made, so a withdrawal that lands first wins.
- **Fresh pass, not edit.** A pass's content never changes. When the plan moves
  on, staff make a fresh pass that names the one it replaces
  (`supersedesPackId`): only the same venue, the same event and the same holder
  (same supplier on file, or same name when neither is on file). The earlier
  pass is withdrawn, never deleted, and the fresh pass's page lists what changed
  in that holder's part. The lineage is read from `general_audit_log`.
- **Plain words.** The supplier's page carries no version, hash, link or system
  words. The name given with a reply is shown to staff as "Name given on the
  link", never as a checked identity.

## Acknowledgements are kept by the database

Blake chose "supplier confirmations kept" (October 2026). Migration
`0095_supplier_records_kept` makes both links
in the chain `ON DELETE RESTRICT`:

- `supplier_acknowledgements.pack_id` → `supplier_coordination_packs`: a pass
  with a reply cannot be deleted.
- `supplier_coordination_packs.handoff_pack_id` → `handoff_packs`: a handoff
  pack a pass was issued from cannot be deleted, replied to or not.

Handoff packs still cascade from their configuration and snapshot, so a delete
of either that would reach a pass is refused as a whole: PostgreSQL raises
SQLSTATE 23503 (it reports RESTRICT and NO ACTION keys with the same code)
naming the key, and no row in the chain changes. RESTRICT, not NO ACTION, so
the check runs at the statement and cannot be deferred to commit.

`SET NULL` (with the venue and event copied onto the row) was the fallback if
RESTRICT broke a legitimate flow. It does not: no code deletes a pass, a
handoff pack, a snapshot a handoff pack refers to, or a configuration one was
compiled from, and a pass already carries its own `venue_id` and `event_id`.

Around the keys:

1. Passes are withdrawn, never deleted, and no route deletes a pass.
2. The 72-hour preview cleanup (`services/cleanup.ts`, the one hard delete of
   configurations) skips any configuration a handoff pack was compiled from.
   It is one batch statement, so without the skip a single refused row would
   stop every abandoned preview from being removed. Snapshot pruning keeps
   snapshots a handoff pack refers to; if one were compiled mid-prune, the
   prune is now refused instead of erasing it.
3. Each reply also writes a `supplier_pass.replied` row to `general_audit_log`
   in the same transaction (no foreign key to the pass): status, name given,
   time, pass title, the brief's digest and its item titles. The email given and
   any note stay on the pass only.

What the keys do not cover: a direct `DELETE` of a pass nobody has replied to
still removes it with its items and links (no code does this), and a pass
cascades from its venue (`venue_id`). A venue delete is refused anyway while
any configuration of that venue exists, and every pass has its handoff pack's
configuration behind it.

## Checks

- `packages/api/src/__tests__/supplier-pass-scope-postgres.test.ts`: the
  cross-scope gate. A pass for one supplier, event or venue never reads
  another's data; also the role split, stop dates, one live link, replacement
  and the durable reply record. Needs the isolated route-test database
  (`VENVIEWER_ROUTE_TEST_DATABASE_URL`, see the engineering map).
- `supplier-records-kept-postgres.test.ts`: on the whole migration set, both
  keys are RESTRICT in the catalogue; deleting a replied pass, its handoff
  pack, its configuration or its snapshot is refused and leaves every row;
  a handoff pack with no pass still deletes; preview cleanup removes an
  abandoned preview and keeps one a pass was issued from. Opt-in database
  `VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL` (loopback,
  `/venviewer_supplier_records_test`); CI creates it on the route-test service.
- `supplier-coordination-schema.test.ts`: the Drizzle schema and the journaled
  migration both state RESTRICT.
- `supplier-passes.test.ts`, `components/supplier-passes/__tests__/`,
  `__tests__/SupplierPortalPage.test.tsx`: pure rules, the sheet, the board and
  the supplier's page.

## Not built yet (stage 1 boundary)

Message sending (staff copy the message and send it themselves), the call board
on `/hallkeeper/today`, device binding, planner-mediated issuing, non-supplier
passes (officiants, casual staff, drivers) and the `party_grants` table are
later stages. Opening a link marks it opened even when a member of staff opens
it to check, so "Opened" means the link was opened, not that the supplier did.
