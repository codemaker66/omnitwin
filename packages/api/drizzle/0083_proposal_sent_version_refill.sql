-- ---------------------------------------------------------------------------
-- 0083 — 0082's fill again, for proposals sent or accepted between the two
-- releases (T-635, X1)
--
-- 0082 added proposals.sent_version and proposals.accepted_name and filled
-- them, but the API running then wrote neither: a proposal it sent after 0082
-- applied can hold an older sent_version, or none, and one it saw accepted
-- has no accepted_name. This release writes both, so the fill runs again.
--
-- accepted_name: 0082's statement, unchanged. It fills only an empty column,
-- and only from the approval note written with the latest acceptance, which
-- this release writes as its own acceptance does.
--
-- sent_version: 0082's rules for a proposal with none. A proposal with one is
-- only ever raised, to the newest version saved no later than its latest move
-- to "sent", as the link had shown it. It is not raised to the current
-- version as 0082's rule for a sent proposal would: from this release a
-- version a platform administrator saves while a proposal is out is a draft,
-- and the link keeps the version that was sent.
--
-- This release reaches production before its migration (Railway rebuilds the
-- API as soon as master moves; Deploy migrates after CI). For those minutes a
-- proposal with no sent_version shows its current version, as it did before.
-- The whole file runs in one transaction; a lock that cannot be had within
-- ten seconds fails it, and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
WITH sent AS (
  SELECT p.id,
    CASE
      WHEN p.current_version < 1 THEN NULL
      WHEN p.sent_version IS NULL AND p.status IN ('sent', 'accepted', 'declined', 'expired') THEN p.current_version
      ELSE COALESCE(
        (SELECT max(v.version) FROM proposal_versions v
          WHERE v.proposal_id = p.id
            AND v.created_at <= (
              SELECT max(h.created_at) FROM proposal_status_history h
              WHERE h.proposal_id = p.id AND h.to_status = 'sent')),
        CASE WHEN p.sent_version IS NULL AND p.status = 'changes_requested' THEN p.current_version END)
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
