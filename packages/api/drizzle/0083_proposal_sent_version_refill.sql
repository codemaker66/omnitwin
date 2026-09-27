-- ---------------------------------------------------------------------------
-- 0083 — 0082's fill again, for proposals sent or answered between the two
-- releases (T-635, X1)
--
-- 0082 added proposals.sent_version and proposals.accepted_name and filled
-- them, but the API running then wrote neither. The release carrying this
-- migration writes both: each send records the version sent, and each client
-- answer the version its link showed. It still shows every link its current
-- version, as before; the release that makes a link show its sent_version
-- follows only once this migration has run. So no running code reads a column
-- the old API left behind, and nothing written after this release needs
-- filling.
--
-- sent_version is only ever filled or raised, never lowered:
-- - sent, with none: its current version, which its link showed;
-- - accepted, declined, expired or changes asked for: the version the answer
--   was given on, the newest saved no later than the move into that status (a
--   link showed its current version until the release after this one), or the
--   newest saved no later than its latest send if later (else, with none, its
--   current version, as 0082 took for rows from before history was kept);
-- - otherwise: the newest version saved no later than its latest send. A send
--   is its latest move to "sent", or a new link made while it stayed sent,
--   which the old API recorded only as the link.
-- An unanswered proposal is never raised to its current version: a version
-- saved while a proposal is out is a draft until it is sent.
--
-- accepted_name: a name 0082 took is cleared when a later acceptance, which
-- the old API recorded without it, is not the one that name was given with.
-- Then 0082's fill runs again: the name on the approval note written with the
-- latest acceptance, through a link. Names this release writes are the ones
-- on those notes, so both statements leave them as they are.
--
-- Every rule gives the same answer when run again. The whole file runs in one
-- transaction; a lock that cannot be had within ten seconds fails it, and
-- nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
WITH sends AS (
  SELECT p.id,
    (SELECT max(h.created_at) FROM proposal_status_history h
      WHERE h.proposal_id = p.id AND h.to_status = 'sent') AS moved
  FROM proposals p
),
sent_at AS (
  -- A link made after the latest move to "sent", before the next change of
  -- status, sent what was current then.
  SELECT s.id, GREATEST(s.moved, (
    SELECT max(t.created_at) FROM proposal_share_tokens t
    WHERE t.proposal_id = s.id
      AND t.created_at >= s.moved
      AND t.created_at < COALESCE((
        SELECT min(h.created_at) FROM proposal_status_history h
        WHERE h.proposal_id = s.id AND h.created_at > s.moved), 'infinity'::timestamptz)
  )) AS at
  FROM sends s
),
rules AS (
  SELECT p.id, p.status, p.current_version, p.sent_version,
    -- The newest version saved no later than the latest send.
    (SELECT max(v.version) FROM proposal_versions v
      WHERE v.proposal_id = p.id AND v.created_at <= sent_at.at) AS by_send,
    -- The newest version saved no later than the move into its status: for
    -- an answer, the version the link showed as it was given.
    (SELECT max(v.version) FROM proposal_versions v
      WHERE v.proposal_id = p.id
        AND v.created_at <= (
          SELECT max(h.created_at) FROM proposal_status_history h
          WHERE h.proposal_id = p.id AND h.to_status = p.status)) AS by_answer
  FROM proposals p
  JOIN sent_at ON sent_at.id = p.id
),
sent AS (
  SELECT r.id,
    CASE
      WHEN r.current_version < 1 THEN NULL
      WHEN r.sent_version IS NULL AND r.status = 'sent' THEN r.current_version
      WHEN r.status IN ('accepted', 'declined', 'expired', 'changes_requested') THEN COALESCE(
        GREATEST(r.by_send, r.by_answer),
        CASE WHEN r.sent_version IS NULL THEN r.current_version END)
      ELSE r.by_send
    END AS version
  FROM rules r
)
UPDATE proposals p
SET sent_version = sent.version
FROM sent
WHERE p.id = sent.id
  AND sent.version IS NOT NULL
  AND (p.sent_version IS NULL OR p.sent_version < sent.version);
--> statement-breakpoint
UPDATE proposals p
SET accepted_name = NULL
WHERE p.accepted_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM proposal_comments c
    WHERE c.proposal_id = p.id
      AND c.kind = 'approval_note'
      AND c.share_token_id IS NOT NULL
      AND btrim(c.author_name) = p.accepted_name
      AND c.created_at = (
        SELECT max(h.created_at) FROM proposal_status_history h
        WHERE h.proposal_id = p.id AND h.to_status = 'accepted'));
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
