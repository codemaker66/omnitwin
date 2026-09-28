-- ---------------------------------------------------------------------------
-- 0083 — what each client's link showed, settled from history (T-635, X1)
--
-- 0082 added proposals.sent_version and proposals.accepted_name, but the API
-- running then wrote neither, and every link showed its proposal's current
-- version. The release carrying this migration still shows every link its
-- current version, and keeps sent_version to what the link shows: a send
-- records the version sent, a version saved while a proposal is with the
-- client is on its link at once, and an answer records the version it was
-- given on. The release that makes a link show its sent_version follows only
-- once this migration has run, so it never reads a value the old API left.
--
-- This settles every row to that same rule, from history rather than from
-- what 0082 happened to fill:
-- - with the client (sent): its current version, which its link shows;
-- - answered (accepted, declined, expired, changes asked for, or archived
--   straight from accepted): the newest version saved no later than its
--   latest move into that status (into accepted, for an archived one), the
--   version its link showed as it was answered. This can lower 0082's fill,
--   which took the current version even when a version was saved after the
--   answer. An answered proposal with no recorded answer keeps what it has,
--   or its current version if it has none, as 0082 took.
-- - anything else (a draft, withdrawn, archived otherwise) is left as it is;
--   its link does not open.
--
-- accepted_name: a name 0082 took is cleared when a later acceptance, which
-- the old API recorded without it, is not the one that name was given with.
-- Then 0082's fill runs again: the name on the approval note written with the
-- latest acceptance, through a link. The names this release writes are the
-- ones on those notes, so both statements leave them as they are.
--
-- Versions and moves are stamped with their transaction's start, not its
-- commit, so a version save that began before an answer and committed after it
-- is taken as saved before it; the window is the moment between a save's start
-- and its hold on the row, and only a save racing an answer falls in it.
--
-- Every statement gives the same answer when run again. The whole file runs
-- in one transaction; a lock that cannot be had within ten seconds fails it,
-- and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
UPDATE proposals
SET sent_version = current_version
WHERE status = 'sent'
  AND current_version >= 1
  AND sent_version IS DISTINCT FROM current_version;
--> statement-breakpoint
WITH answered AS (
  SELECT p.id,
    CASE WHEN p.status = 'archived' THEN 'accepted' ELSE p.status END AS answer
  FROM proposals p
  WHERE p.current_version >= 1
    AND (p.status IN ('accepted', 'declined', 'expired', 'changes_requested')
      OR (p.status = 'archived' AND (
        SELECT h.from_status FROM proposal_status_history h
        WHERE h.proposal_id = p.id AND h.to_status = 'archived'
        ORDER BY h.created_at DESC
        LIMIT 1) = 'accepted'))
),
shown AS (
  SELECT a.id,
    (SELECT max(v.version) FROM proposal_versions v
      WHERE v.proposal_id = a.id
        AND v.created_at <= (
          SELECT max(h.created_at) FROM proposal_status_history h
          WHERE h.proposal_id = a.id AND h.to_status = a.answer)) AS version
  FROM answered a
)
UPDATE proposals p
SET sent_version = shown.version
FROM shown
WHERE p.id = shown.id
  AND shown.version IS NOT NULL
  AND p.sent_version IS DISTINCT FROM shown.version;
--> statement-breakpoint
UPDATE proposals
SET sent_version = current_version
WHERE sent_version IS NULL
  AND current_version >= 1
  AND status IN ('accepted', 'declined', 'expired', 'changes_requested');
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
