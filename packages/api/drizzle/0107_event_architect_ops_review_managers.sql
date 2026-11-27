-- Venue managers record Event Architect Ops reviews (Blake, 11 November 2026:
-- "Yes, managers too").
-- 0107, after #387's 0106 (the release queue's numbering, 11 November); the
-- queue confirms the number at the merge slot (renumber the tag AND the
-- journal `when`).
--
-- 0048 stores each review under its reviewer's authority, and its CHECK named
-- four: venue_staff, venue_hallkeeper, venue_admin and platform_admin. A
-- manager's review is recorded truthfully as venue_manager
-- (EventArchitectOpsReviewerAuthoritySchema in @omnitwin/types), so the CHECK
-- gains that one value and keeps the other four.
--
-- No row changes. Every stored value is one of 0048's four, which the new list
-- keeps, so the re-added CHECK validates whatever production holds. The table
-- is append-only (0048's triggers refuse UPDATE and DELETE), and a constraint
-- change fires neither.
--
-- Dropping and adding the CHECK in one statement takes the table's ACCESS
-- EXCLUSIVE lock once, held until the migration transaction commits, while
-- the re-added CHECK scans the reviews. A bounded wait fails the migration
-- instead of queueing review reads behind it.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "event_architect_ops_reviews"
  DROP CONSTRAINT "event_architect_ops_reviews_authority",
  ADD CONSTRAINT "event_architect_ops_reviews_authority"
    CHECK ("reviewer_authority" IN ('venue_staff', 'venue_hallkeeper', 'venue_manager', 'venue_admin', 'platform_admin'));
