-- ---------------------------------------------------------------------------
-- 0082 — which version the client was sent, and who accepted it (T-635, X1)
--
-- The client's link served proposals.current_version, the latest version
-- saved. While a proposal waits on the venue after the client asked for
-- changes it is still visible to the client, and versions can be saved in
-- that state, so a half-finished version 3 and its prices were live on the
-- client's link before anyone sent it. The link must show the version that
-- was sent: sent_version records it, written by every send from the release
-- after this one, from the proposal's row as the send holds it.
--
-- The client's page names who accepted a proposal. It read the newest
-- "approval_note" comment, a kind the public comment route also accepted
-- from anyone holding the link, so a name could be planted. accepted_name
-- records the name given with the acceptance itself.
--
-- Filled from what the rows prove:
-- - sent_version, for a proposal that is sent, accepted, declined or
--   expired: its current version. Only a platform administrator can save a
--   version in those states, and the link showed whatever was current.
-- - sent_version, for any other proposal: the newest version saved no later
--   than its latest move to "sent" (a proposal the client asked to change
--   and never sent again keeps the version they saw). Both are stamped with
--   their transaction's start, so a save and a send racing within the same
--   moment could be ordered wrongly; production held one proposal version
--   when this was written. A proposal the client asked to change with no
--   recorded send keeps the version its link showed.
-- - accepted_name, for a proposal accepted (or archived straight from
--   accepted): the name on the approval note written in the same
--   transaction, and so with the same timestamp, as its latest acceptance,
--   through a share link. A note from any other moment, or from an earlier
--   acceptance, is not taken.
--
-- Schema first: Railway rebuilds the API as soon as master moves, but Deploy
-- applies migrations only after CI passes. No running code reads these
-- columns yet. The release that does repeats the fill for rows written in
-- between; each rule only fills an empty column or raises sent_version to a
-- version the link showed, so running it again changes nothing. The lock
-- wait is bounded, so a busy table fails the deploy rather than queueing
-- every proposal request behind it.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "sent_version" integer;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "accepted_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT IF EXISTS "proposals_sent_version_positive";
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_sent_version_positive"
  CHECK ("sent_version" IS NULL OR ("sent_version" >= 1 AND "sent_version" <= "current_version"));
--> statement-breakpoint
WITH sent AS (
  SELECT p.id,
    CASE
      WHEN p.current_version < 1 THEN NULL
      WHEN p.status IN ('sent', 'accepted', 'declined', 'expired') THEN p.current_version
      ELSE COALESCE(
        (SELECT max(v.version) FROM proposal_versions v
          WHERE v.proposal_id = p.id
            AND v.created_at <= (
              SELECT max(h.created_at) FROM proposal_status_history h
              WHERE h.proposal_id = p.id AND h.to_status = 'sent')),
        CASE WHEN p.status = 'changes_requested' THEN p.current_version END)
    END AS version
  FROM proposals p
)
UPDATE proposals p
SET sent_version = sent.version
FROM sent
WHERE p.id = sent.id
  AND sent.version IS NOT NULL
  AND (p.sent_version IS NULL OR p.sent_version < sent.version);
--> statement-breakpoint
WITH latest AS (
  SELECT DISTINCT ON (h.proposal_id) h.proposal_id, h.created_at
  FROM proposal_status_history h
  WHERE h.to_status = 'accepted'
  ORDER BY h.proposal_id, h.created_at DESC
),
named AS (
  SELECT latest.proposal_id,
    (SELECT btrim(c.author_name) FROM proposal_comments c
      WHERE c.proposal_id = latest.proposal_id
        AND c.kind = 'approval_note'
        AND c.share_token_id IS NOT NULL
        AND c.created_at = latest.created_at
      ORDER BY c.id
      LIMIT 1) AS name
  FROM latest
)
UPDATE proposals p
SET accepted_name = named.name
FROM named
WHERE p.id = named.proposal_id
  AND p.accepted_name IS NULL
  AND named.name IS NOT NULL
  AND named.name <> ''
  AND (
    p.status = 'accepted'
    OR (p.status = 'archived' AND (
      SELECT h.from_status FROM proposal_status_history h
      WHERE h.proposal_id = p.id AND h.to_status = 'archived'
      ORDER BY h.created_at DESC
      LIMIT 1) = 'accepted')
  );
