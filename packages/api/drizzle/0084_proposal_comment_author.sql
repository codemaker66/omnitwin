-- ---------------------------------------------------------------------------
-- 0084 — who wrote each proposal comment, recorded (T-635, X1)
--
-- A comment's author was read from its link: one written through the
-- client's share link carries share_token_id, a venue reply has none. That
-- reference is ON DELETE SET NULL (0034), so deleting a link would turn its
-- client's words into the venue team's, on the staff desk and on the
-- client's page. The venue's words are held to the claim guard; the
-- client's are kept as written. author_type records which they are, once,
-- when the comment is written.
--
-- Filled from what the rows prove. Only two writers have ever existed:
-- - the client's link (comment, request_changes, approval_note), which always
--   stores the link it came through;
-- - the venue's reply, which always stores kind 'comment', the name
--   'Venue team', no email and no link.
-- A row with a link is the client's. A row without one is the venue's only
-- when it has the reply's exact shape; anything else lost its link and is
-- the client's. Nothing deletes links today, so this is expected to find
-- none.
--
-- Schema first: Railway rebuilds the API as soon as master moves, but Deploy
-- applies migrations only after CI passes, and the API running then does
-- not name the author. A column default cannot read the link, so a trigger
-- fills an author left unnamed from the link as the row is written, when the
-- link is certain. The release after this one names the author on every
-- write; the trigger then fills nothing. NOT NULL and the checks are
-- evaluated after the trigger, so they hold for both releases.
--
-- A venue reply never carries a link. The converse cannot be a check: a
-- client's comment keeps its author when its link is deleted.
--
-- Running it again changes nothing. The lock wait is bounded, so a busy table
-- fails the deploy rather than queueing every proposal request behind it.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD COLUMN IF NOT EXISTS "author_type" varchar(10);
--> statement-breakpoint
UPDATE "proposal_comments"
SET "author_type" = CASE
  WHEN "share_token_id" IS NOT NULL THEN 'client'
  WHEN "kind" = 'comment'
    AND "author_name" = 'Venue team'
    AND "author_email" IS NULL THEN 'staff'
  ELSE 'client'
END
WHERE "author_type" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "proposal_comments_author_from_link"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."author_type" IS NULL THEN
    NEW."author_type" := CASE WHEN NEW."share_token_id" IS NULL THEN 'staff' ELSE 'client' END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposal_comments_author_from_link" ON "proposal_comments";
--> statement-breakpoint
CREATE TRIGGER "proposal_comments_author_from_link"
  BEFORE INSERT ON "proposal_comments"
  FOR EACH ROW EXECUTE FUNCTION "proposal_comments_author_from_link"();
--> statement-breakpoint
ALTER TABLE "proposal_comments" ALTER COLUMN "author_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "proposal_comments" DROP CONSTRAINT IF EXISTS "proposal_comments_author_type_check";
--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_author_type_check"
  CHECK ("author_type" IN ('client', 'staff'));
--> statement-breakpoint
ALTER TABLE "proposal_comments" DROP CONSTRAINT IF EXISTS "proposal_comments_staff_without_link";
--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_staff_without_link"
  CHECK ("author_type" = 'client' OR "share_token_id" IS NULL);
