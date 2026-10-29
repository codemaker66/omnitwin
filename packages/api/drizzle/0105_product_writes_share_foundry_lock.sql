-- Product writes share the foundry's global lock (T-677, 27 October 2026).
-- 0105, after #284's 0104 and #258's 0103 (the release queue's numbering, 29 October); the
-- queue confirms the number at the merge slot (renumber the tag AND the journal
-- `when`).
--
-- 0058 put fdv1_root_trigger (each statement) on 57 tables and fdv1_public_guard
-- (each row) on the 18 product tables among them, both taking the global
-- kill-switch lock exclusively. Every write to a layout, room, venue, file or
-- release therefore waited for every other open write, and a transaction that
-- locked a layout's row before writing (a review submit) deadlocked with a
-- save that had taken the lock first and then waited for that row: the save
-- answered 500.
--
-- Product writes need ordering against the kill switch and the foundry's own
-- registrations, which still take the lock exclusively, not against each
-- other. Taken shared, the lock still makes a product write wait for an open
-- kill switch and the kill switch wait for every open product write, and the
-- guard's check still sees a quarantine registered by a transaction it waited
-- for. The foundry's own tables keep the lock exclusive: their writers use it
-- as the head of their lock order.
--
-- One more statement takes it shared: the security event the guard records
-- when a product row names a quarantined object. It is written from inside
-- that product write, which holds the lock shared; taken exclusively there,
-- the lock would be upgraded, and two such writes, or one and a save waiting
-- on its row, could deadlock and lose the event. The foundry's own recorders
-- (the storage-profile pre-scan and the custody guard) fire inside writes to
-- foundry tables, which hold the lock exclusively already.
--
-- Only the two functions change. No trigger or table is touched, so applying
-- this takes no lock on the tables it concerns.

CREATE FUNCTION "fdv1_lock_root_shared"()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('foundry-kill:0:global', 0)
  )
$$;

-- The 18 product tables 0058 root-locks, and a security event recorded from
-- inside another trigger: shared there, exclusive on the rest.
CREATE OR REPLACE FUNCTION "fdv1_root_trigger"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = ANY (ARRAY[
    'venues', 'spaces', 'asset_definitions', 'configurations',
    'configuration_sheet_snapshots', 'photo_references', 'files',
    'website_embed_configs', 'asset_versions', 'runtime_packages',
    'reconstruction_releases', 'reconstruction_release_qa_runs',
    'reconstruction_release_reviews',
    'reconstruction_review_evidence_artifacts',
    'reconstruction_release_attestations',
    'reconstruction_release_publications', 'reconstruction_release_channels',
    'reconstruction_release_channel_events'
  ]::text[]) OR (
    TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'foundry_derivative_quarantine_security_events_v1'
    AND pg_catalog.pg_trigger_depth() > 1
  ) THEN
    PERFORM public."fdv1_lock_root_shared"();
  ELSE
    PERFORM public."fdv1_lock_root"();
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "fdv1_public_guard"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value jsonb := to_jsonb(NEW);
  projection jsonb;
  reference_value text;
  row_identity text;
  database_now timestamptz;
  correlation_value uuid := gen_random_uuid();
  event_value jsonb;
  event_sha text;
BEGIN
  PERFORM public."fdv1_lock_root_shared"();
  projection := public."fdv1_public_projection"(TG_TABLE_NAME, row_value);
  SELECT candidate INTO reference_value
  FROM public."fdv1_json_strings"(projection) candidate
  WHERE public."fdv1_ref_is_quarantine"(candidate)
  ORDER BY candidate COLLATE "C"
  LIMIT 1;
  IF reference_value IS NULL THEN
    RETURN NEW;
  END IF;
  database_now := date_trunc('milliseconds', clock_timestamp());
  row_identity := COALESCE(row_value->>'id', row_value->>'slug', '<pending>');
  event_value := public."fdv1_security_event_json"(
    TG_TABLE_NAME, row_identity, 'quarantine_namespace_or_lineage_denied',
    public."fdv1_normalize_ref"(reference_value), correlation_value, database_now
  );
  event_sha := public."foundry_ecmascript_domain_jsonb_sha256"(
    'omnitwin.foundry.derivative-quarantine-security-event.v1', event_value
  );
  INSERT INTO public."foundry_derivative_quarantine_security_events_v1"(
    "event_sha256", "event_kind", "severity", "state", "offending_table",
    "offending_row_id", "reason_code", "namespace_identity", "actor_kind",
    "actor_key", "correlation_id", "event_json", "recorded_at"
  ) VALUES (
    event_sha, 'quarantine_security_event', 'critical', 'detected', TG_TABLE_NAME,
    row_identity, 'quarantine_namespace_or_lineage_denied',
    public."fdv1_normalize_ref"(reference_value), 'system',
    'system:foundry-derivative-quarantine-guard', correlation_value,
    event_value, database_now
  ) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION "fdv1_lock_root_shared"() FROM PUBLIC;
