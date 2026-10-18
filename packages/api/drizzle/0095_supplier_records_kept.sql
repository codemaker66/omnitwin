-- What a supplier was told, and what they confirmed, is kept by the database.
--
-- Until now two foreign keys cascaded:
--   supplier_acknowledgements.pack_id          -> supplier_coordination_packs (CASCADE)
--   supplier_coordination_packs.handoff_pack_id -> handoff_packs              (CASCADE)
-- and handoff_packs cascade from their configuration and their snapshot, so a
-- single DELETE of a configuration, a snapshot or a handoff pack silently
-- erased every supplier pass compiled from it, the items the supplier was
-- given and every reply they sent. Application guards (preview cleanup skips
-- configurations with a handoff pack; snapshot pruning keeps snapshots a
-- handoff pack refers to; passes are withdrawn, never deleted) were the only
-- thing holding the record.
--
-- Both keys become ON DELETE RESTRICT. A delete that would reach a pass, or
-- an acknowledged pass, is now refused by PostgreSQL (SQLSTATE 23503,
-- foreign_key_violation) and the whole statement rolls back. RESTRICT rather
-- than NO ACTION: the check cannot be deferred to the end of a transaction. No application flow deletes a pass, a handoff
-- pack, a snapshot a handoff pack refers to, or a configuration a handoff pack
-- was compiled from, so RESTRICT breaks nothing legitimate and SET NULL (with
-- copied venue and event ids) is not needed: the pass already carries its own
-- venue_id and event_id.
--
-- Schema only; no rows change. The keys are found by table, column and
-- referenced table rather than by name, so a database whose constraints were
-- named differently is still corrected, and they are recreated under the
-- PostgreSQL default names 0038 produced. Existing rows already satisfy the
-- keys (the same keys held them). The whole file is one transaction.

DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = 'supplier_acknowledgements'::regclass
      AND c.confrelid = 'supplier_coordination_packs'::regclass
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'pack_id'
  LOOP
    EXECUTE format('ALTER TABLE "supplier_acknowledgements" DROP CONSTRAINT %I', existing.conname);
  END LOOP;

  ALTER TABLE "supplier_acknowledgements"
    ADD CONSTRAINT "supplier_acknowledgements_pack_id_fkey"
    FOREIGN KEY ("pack_id") REFERENCES "supplier_coordination_packs" ("id")
    ON DELETE RESTRICT;

  FOR existing IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = 'supplier_coordination_packs'::regclass
      AND c.confrelid = 'handoff_packs'::regclass
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'handoff_pack_id'
  LOOP
    EXECUTE format('ALTER TABLE "supplier_coordination_packs" DROP CONSTRAINT %I', existing.conname);
  END LOOP;

  ALTER TABLE "supplier_coordination_packs"
    ADD CONSTRAINT "supplier_coordination_packs_handoff_pack_id_fkey"
    FOREIGN KEY ("handoff_pack_id") REFERENCES "handoff_packs" ("id")
    ON DELETE RESTRICT;
END $$;
