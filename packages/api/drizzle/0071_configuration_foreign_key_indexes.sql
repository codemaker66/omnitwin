-- Foreign-key indexes for configuration reads and hard deletes.
--
-- enquiries.configuration_id backs the latest-enquiry lookup of every live
-- hallkeeper sheet and review email (configuration_id = $1 ORDER BY
-- created_at DESC LIMIT 1), the claim's enquiry relink, and the foreign-key
-- check PostgreSQL runs for each configuration a preview cleanup deletes;
-- each of those scanned the whole table. proposals.configuration_id backs the
-- ON DELETE SET NULL action of the same deletes.
--
-- Additive only: no rows, columns or constraints change. Both tables are
-- small, so the non-concurrent build inside the migration transaction holds
-- its write lock briefly; IF NOT EXISTS keeps a manual replay inert.
CREATE INDEX IF NOT EXISTS "enquiries_configuration_created_idx" ON "enquiries" USING btree ("configuration_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_configuration_idx" ON "proposals" USING btree ("configuration_id");
