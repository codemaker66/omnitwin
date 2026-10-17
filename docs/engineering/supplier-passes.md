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

## Acknowledgements and the cascade

`supplier_acknowledgements.pack_id` cascades from the pass, the pass cascades
from its handoff pack, and the handoff pack from its configuration and snapshot.
Without a migration the database cascade stays, so three things hold the record:

1. Passes are withdrawn, never deleted, and no route deletes a pass.
2. The 72-hour preview cleanup (`services/cleanup.ts`, the one hard delete of
   configurations) skips any configuration a handoff pack was compiled from.
   Snapshot pruning already kept snapshots a handoff pack refers to.
3. Each reply also writes a `supplier_pass.replied` row to `general_audit_log`
   in the same transaction (no foreign key to the pass): status, name given,
   time, pass title, the brief's digest and its item titles. The email given and
   any note stay on the pass only.

Changing the foreign keys to `ON DELETE RESTRICT` (or `SET NULL` with a copied
venue and event) needs a migration and is Blake's decision.

## Checks

- `packages/api/src/__tests__/supplier-pass-scope-postgres.test.ts`: the
  cross-scope gate. A pass for one supplier, event or venue never reads
  another's data; also the role split, stop dates, one live link, replacement
  and the durable reply record. Needs the isolated route-test database
  (`VENVIEWER_ROUTE_TEST_DATABASE_URL`, see the engineering map).
- `cleanup-keeps-supplier-records-postgres.test.ts`: the cascade is real, and
  cleanup does not trigger it.
- `supplier-passes.test.ts`, `components/supplier-passes/__tests__/`,
  `__tests__/SupplierPortalPage.test.tsx`: pure rules, the sheet, the board and
  the supplier's page.

## Not built yet (stage 1 boundary)

Message sending (staff copy the message and send it themselves), the call board
on `/hallkeeper/today`, device binding, planner-mediated issuing, non-supplier
passes (officiants, casual staff, drivers) and the `party_grants` table are
later stages. Opening a link marks it opened even when a member of staff opens
it to check, so "Opened" means the link was opened, not that the supplier did.
