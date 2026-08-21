-- Self-contained 0066 behavior fixture. The verifier script runs each
-- labelled phase in order and supplies only exact raw-verifier output as
-- psql variables. Production runtime identity remains intentionally absent;
-- the committed positive path is explicitly local_test_fixture.

-- @phase upstream
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres

BEGIN;
INSERT INTO public.venues(id,name,slug,address)
VALUES (
  '91000000-0000-0000-0000-000000000001',
  'Trades Hall','trades-hall','1 Evidence Street'
);
INSERT INTO public.spaces(
  id,venue_id,name,slug,width_m,length_m,height_m,floor_plan_outline
) VALUES (
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  'Production Fixture Room','receipt-room',10,10,3,'{}'::jsonb
);
INSERT INTO public.users(
  id,email,name,role,venue_id,clerk_id,platform_role
) VALUES
  ('91000000-0000-0000-0000-000000000003',
   'platform-admin@example.test','Platform Admin','admin',NULL,
   'clerk_platform_admin','admin'),
  ('91000000-0000-0000-0000-000000000011',
   'custodian@example.test','Custodian','staff',
   '91000000-0000-0000-0000-000000000001','clerk_custodian','none'),
  ('91000000-0000-0000-0000-000000000012',
   'observer@example.test','Observer','staff',
   '91000000-0000-0000-0000-000000000001','clerk_observer','none'),
  ('91000000-0000-0000-0000-000000000013',
   'prober@example.test','Prober','staff',
   '91000000-0000-0000-0000-000000000001','clerk_prober','none'),
  ('91000000-0000-0000-0000-000000000022',
   'admission-reviewer@example.test','Admission Reviewer','staff',
   '91000000-0000-0000-0000-000000000001','clerk_admission_reviewer','none'),
  ('91000000-0000-0000-0000-000000000023',
   'transform-reviewer@example.test','Transform Reviewer','staff',
   '91000000-0000-0000-0000-000000000001','clerk_transform_reviewer','none'),
  ('91000000-0000-0000-0000-000000000024',
   'twin-approver@example.test','Twin Approver','admin',NULL,
   'clerk_twin_approver','admin'),
  ('91000000-0000-0000-0000-000000000025',
   'scene-registrar@example.test','Scene Registrar','staff',
   '91000000-0000-0000-0000-000000000001','clerk_scene_registrar','none'),
  ('91000000-0000-0000-0000-000000000026',
   'scene-reviewer@example.test','Scene Reviewer','staff',
   '91000000-0000-0000-0000-000000000001','clerk_scene_reviewer','none'),
  ('91000000-0000-0000-0000-000000000027',
   'release-reviewer@example.test','Release Reviewer','admin',NULL,
   'clerk_release_reviewer','admin');
INSERT INTO public.organisations(id,name,status,created_by)
VALUES (
  '91000000-0000-0000-0000-000000000028','Fixture Org','active',
  '91000000-0000-0000-0000-000000000003'
);
INSERT INTO public.workspaces(
  id,organisation_id,name,status,primary_venue_id,created_by
) VALUES (
  '91000000-0000-0000-0000-000000000021',
  '91000000-0000-0000-0000-000000000028',
  'Fixture Workspace','active',
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000003'
);
INSERT INTO public.workspace_memberships(
  id,workspace_id,user_id,email,role,venue_role,status,accepted_at
) VALUES
  ('91000000-0000-0000-0000-000000000031',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000011',
   'custodian@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000032',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000012',
   'observer@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000033',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000013',
   'prober@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000041',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000022',
   'admission-reviewer@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000042',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000023',
   'transform-reviewer@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000043',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000025',
   'scene-registrar@example.test','staff','staff','active',clock_timestamp()),
  ('91000000-0000-0000-0000-000000000044',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000026',
   'scene-reviewer@example.test','staff','staff','active',clock_timestamp());
COMMIT;

\set ON_ERROR_STOP on
\set VERBOSITY verbose

\set ON_ERROR_STOP on
\set VERBOSITY verbose

\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;

INSERT INTO public.hr_evidence_environments(id,mode,configured_by) VALUES (
  '91000000-0000-0000-0000-000000000004',:'environment_mode',
  '91000000-0000-0000-0000-000000000003'
);

INSERT INTO public.hr_scope_epochs(
  id,environment_id,venue_id,space_id,issued_by
) VALUES (
  '91000000-0000-0000-0000-000000000005',
  '91000000-0000-0000-0000-000000000004',
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000003'
);
COMMIT;

\connect :fixture_db postgres
CREATE OR REPLACE FUNCTION public.fixture_wait_for_db_clock(
  p_floor timestamptz,
  p_label text
) RETURNS void
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  attempt integer;
  consecutive_ready integer := 0;
  observed_at timestamptz;
BEGIN
  IF p_floor IS NULL OR p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'fixture DB-clock fence requires an instant and label'
      USING ERRCODE='22023',CONSTRAINT='fixture_db_clock_fence';
  END IF;
  FOR attempt IN 1..500 LOOP
    observed_at := date_trunc('milliseconds',clock_timestamp());
    consecutive_ready := CASE
      WHEN observed_at >= p_floor THEN consecutive_ready + 1
      ELSE 0
    END;
    EXIT WHEN consecutive_ready = 3;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF consecutive_ready <> 3 THEN
    RAISE EXCEPTION
      'fixture DB-clock fence % did not stabilise (observed %, floor %)',
      p_label,observed_at,p_floor
      USING ERRCODE='55000',CONSTRAINT='fixture_db_clock_fence';
  END IF;
END;
$$;

-- @phase upstream-after-scope
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_wait_for_db_clock(scope.effective_at,'provider phase')
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';

INSERT INTO public.hr_provider_capabilities(
  id,environment_id,environment_mode,environment_digest,scope_epoch_id,
  venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
  provider_profile,provider_kind,version_kind,verification_mode,
  anonymous_head_request_digest,anonymous_head_response_digest,
  anonymous_head_status_code,anonymous_get_request_digest,
  anonymous_get_response_digest,anonymous_get_status_code,
  anonymous_denial_class,provider_account_sha256,
  endpoint_authority_sha256,private_bucket_sha256,
  test_object_storage_key_sha256,initial_write_digest,
  initial_read_digest,overwrite_digest,prior_version_reread_digest,
  verified_by
)
SELECT
  '91000000-0000-0000-0000-000000000006',environment_id,
  environment_mode,environment_digest,id,venue_id,space_id,epoch,
  epoch_digest,expires_at,:'provider_profile',:'provider_kind',
  :'version_kind',:'verification_mode',repeat('1',64),
  repeat('2',64),403,repeat('3',64),repeat('4',64),403,
  'access_forbidden',repeat('5',64),repeat('6',64),repeat('7',64),
  repeat('8',64),repeat('9',64),repeat('9',64),repeat('a',64),
  repeat('9',64),'91000000-0000-0000-0000-000000000003'
FROM public.hr_scope_epochs
WHERE id='91000000-0000-0000-0000-000000000005';

INSERT INTO public.hr_object_receipts(
  id,capability_id,receipt_role,storage_key_sha256,storage_version,
  storage_etag,file_name,mime_type,sha256,size_bytes,
  custodian_actor_id,custodian_membership_id,observed_by_actor_id,
  observed_by_membership_id,authenticated_read_request_digest,
  authenticated_read_response_digest,read_at,denial_request_digest,
  denial_response_digest,denial_status_code,denial_class,
  denial_get_request_digest,denial_get_response_digest,
  denial_get_status_code,denial_get_class,denial_probed_by,
  denial_prober_membership_id
) VALUES (
  '91000000-0000-0000-0000-000000000007',
  '91000000-0000-0000-0000-000000000006','source_root',repeat('0',64),
  'source-v1','source-etag','capture.sog',
  'application/vnd.venviewer.sog',repeat('2',64),128,
  '91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000031',
  '91000000-0000-0000-0000-000000000012',
  '91000000-0000-0000-0000-000000000032',
  repeat('3',64),repeat('4',64),clock_timestamp(),repeat('5',64),
  repeat('6',64),403,'access_forbidden',repeat('a',64),repeat('b',64),
  403,'access_forbidden','91000000-0000-0000-0000-000000000013',
  '91000000-0000-0000-0000-000000000033'
);
COMMIT;

\connect :fixture_db venviewer_local_fixture_verifier
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO hr_object_receipts(
  id, capability_id, receipt_role, storage_key_sha256, storage_version,
  storage_etag, file_name, mime_type, sha256, size_bytes,
  custodian_actor_id, custodian_membership_id, observed_by_actor_id,
  observed_by_membership_id, authenticated_read_request_digest,
  authenticated_read_response_digest, read_at, denial_request_digest,
  denial_response_digest, denial_status_code, denial_class,
  denial_get_request_digest, denial_get_response_digest,
  denial_get_status_code, denial_get_class,
  denial_probed_by, denial_prober_membership_id
) VALUES (
  '91000000-0000-0000-0000-000000000008',
  '91000000-0000-0000-0000-000000000006', 'evidence_document',
  repeat('1',64), 'fixture-evidence-v1', 'fixture-evidence-etag',
  'evidence.json', 'application/json', repeat('2',64), 256,
  '91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000031',
  '91000000-0000-0000-0000-000000000012',
  '91000000-0000-0000-0000-000000000032',
  repeat('3',64), repeat('4',64), clock_timestamp(),
  repeat('5',64), repeat('6',64), 403, 'access_forbidden',
  repeat('a',64), repeat('b',64), 403, 'access_forbidden',
  '91000000-0000-0000-0000-000000000013',
  '91000000-0000-0000-0000-000000000033'
);
INSERT INTO hr_evidence_subjects(id, subject_kind, scope_epoch_id)
VALUES (
  '91000000-0000-0000-0000-000000000100', 'capture_import',
  '91000000-0000-0000-0000-000000000005'
);
RESET ROLE;
COMMIT;

\connect :fixture_db postgres
BEGIN;

WITH key_bytes AS (
  SELECT decode('302a300506032b6570032100' || repeat('ab',32),'hex') AS value
), policy_clock AS (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS registered_at
), policy_material AS (
  SELECT p.id, p.purpose, p.key_id, repeat(p.digit,64) AS policy_digest,
    encode(digest(k.value,'sha256'),'hex') AS fingerprint,
    c.registered_at, c.registered_at AS effective_at,
    c.registered_at + interval '20 hours' AS expires_at
  FROM key_bytes k CROSS JOIN policy_clock c CROSS JOIN (VALUES
    ('91000000-0000-0000-0000-000000000110'::uuid,
      'historical_runtime_role_attestation'::text,'fixture-role-key'::text,'7'::text),
    ('91000000-0000-0000-0000-000000000111'::uuid,
      'historical_runtime_capture_content_identity'::text,'fixture-capture-key'::text,'8'::text)
  ) AS p(id,purpose,key_id,digit)
)
INSERT INTO runtime_execution_key_policies(
  id, purpose, algorithm, key_id, public_key_fingerprint, policy_digest,
  policy_body, registered_by, registered_at, effective_at, expires_at
)
SELECT id, purpose, 'ed25519', key_id, fingerprint, policy_digest,
  jsonb_build_object(
    'schemaVersion','historical-runtime-execution-key-policy.v1',
    'policyId',id::text,'purpose',purpose,'algorithm','ed25519',
    'keyId',key_id,'publicKeyFingerprint',fingerprint,
    'policyDigest',policy_digest,
    'registeredBy','91000000-0000-0000-0000-000000000003',
    'registeredAt',hr_iso_utc_ms(registered_at),
    'effectiveAt',hr_iso_utc_ms(effective_at),
    'expiresAt',hr_iso_utc_ms(expires_at)
  ), '91000000-0000-0000-0000-000000000003', registered_at,
  effective_at, expires_at
FROM policy_material;

COMMIT;
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO hr_signing_key_authorities(
  id, environment_id, environment_mode, environment_digest, scope_epoch_id,
  venue_id, space_id, scope_epoch, scope_epoch_digest,
  scope_epoch_expires_at, key_policy_id, purpose, key_policy_digest, key_id,
  public_key_fingerprint, public_key_bytes, policy_effective_at,
  policy_expires_at, registrar_authority_digest, registrar_authority_body,
  verified_by, verified_at, expires_at
)
SELECT CASE p.purpose
    WHEN 'historical_runtime_role_attestation'
      THEN '91000000-0000-0000-0000-000000000120'::uuid
    ELSE '91000000-0000-0000-0000-000000000121'::uuid
  END,
  s.environment_id, s.environment_mode, s.environment_digest, s.id,
  s.venue_id, s.space_id, s.epoch, s.epoch_digest, s.expires_at,
  p.id, p.purpose, p.policy_digest, p.key_id, p.public_key_fingerprint,
  decode('302a300506032b6570032100' || repeat('ab',32),'hex'),
  p.effective_at, p.expires_at, repeat('0',64), '{}',
  '91000000-0000-0000-0000-000000000003', clock_timestamp(), p.expires_at
FROM runtime_execution_key_policies p
CROSS JOIN hr_scope_epochs s
WHERE s.id='91000000-0000-0000-0000-000000000005'
  AND p.id IN (
    '91000000-0000-0000-0000-000000000110',
    '91000000-0000-0000-0000-000000000111'
  );

WITH receipt AS (
  SELECT receipt_body FROM hr_object_receipts
  WHERE id='91000000-0000-0000-0000-000000000007'
), material AS (
  SELECT jsonb_build_object(
    'ancestorState','exact_private_receipt',
    'lineageStartKind','raw_capture_object',
    'members',jsonb_build_array(jsonb_build_object(
      'componentIndex',0,'receipt',receipt_body,
      'relativePath','capture.sog','role','raw_capture')),
    'receiptSetId','91000000-0000-0000-0000-000000000130',
    'rootComponentIndex',0,
    'schemaVersion','historical-runtime-source-receipt-set.v1',
    'unavailableAncestorAttestationDigest',NULL,
    'unavailableAncestorAttestationId',NULL
  ) AS body FROM receipt
), digested AS (
  SELECT body, encode(digest(convert_to(
    E'venviewer.historical-runtime-source-receipt-set.v1\n' ||
      hr_stable_canonical_json(body),'UTF8'),'sha256'),'hex') AS digest
  FROM material
)
INSERT INTO hr_source_receipt_sets(
  id, capture_subject_id, capture_subject_kind, environment_id,
  environment_mode, environment_digest, scope_epoch_id, venue_id, space_id,
  lineage_start_kind, ancestor_state, root_component_index, member_count,
  total_bytes, receipt_set_digest, receipt_set_body
)
SELECT '91000000-0000-0000-0000-000000000130',
  '91000000-0000-0000-0000-000000000100', 'capture_import',
  s.environment_id, s.environment_mode, s.environment_digest, s.id,
  s.venue_id, s.space_id, 'raw_capture_object', 'exact_private_receipt',
  0, 1, 128, d.digest,
  d.body || jsonb_build_object('receiptSetDigest',d.digest)
FROM hr_scope_epochs s CROSS JOIN digested d
WHERE s.id='91000000-0000-0000-0000-000000000005';

INSERT INTO hr_source_receipt_members(
  source_set_id, capture_subject_id, environment_id, environment_mode,
  environment_digest, receipt_set_digest, component_index, role,
  relative_path, receipt_id, receipt_role, venue_id, space_id, capability_id,
  capability_digest, provider_profile, provider_kind,
  provider_account_sha256, endpoint_authority_sha256, private_bucket_sha256,
  receipt_digest, sha256, size_bytes, file_name, mime_type,
  storage_key_sha256, version_kind, storage_version, storage_etag,
  receipt_expires_at
)
SELECT ss.id, ss.capture_subject_id, ss.environment_id, ss.environment_mode,
  ss.environment_digest, ss.receipt_set_digest, 0, 'raw_capture',
  'capture.sog', r.id, r.receipt_role, r.venue_id, r.space_id,
  r.capability_id, r.capability_digest, r.provider_profile, r.provider_kind,
  r.provider_account_sha256, r.endpoint_authority_sha256,
  r.private_bucket_sha256, r.receipt_digest, r.sha256, r.size_bytes,
  r.file_name, r.mime_type, r.storage_key_sha256, r.version_kind,
  r.storage_version, r.storage_etag, r.denial_expires_at
FROM hr_source_receipt_sets ss CROSS JOIN hr_object_receipts r
WHERE ss.id='91000000-0000-0000-0000-000000000130'
  AND r.id='91000000-0000-0000-0000-000000000007';

WITH material AS (
  SELECT jsonb_build_object(
    'conformanceTestVectorSetDigest',repeat('9',64),
    'decoderBinarySha256',repeat('a',64),
    'decoderName','exact-byte-identity','decoderVersion','1.0.0',
    'exactBinaryReason',
      'no-approved-deterministic-decoder-use-exact-versioned-bytes',
    'formatTag','sog',
    'normalizationProfileVersion','historical-runtime-normalization-profile.v1',
    'normalizationSpec','raw-bytes-exact.v1',
    'normalizedSha256',r.sha256,'normalizedSizeBytes',r.size_bytes
  ) AS body, r.*
  FROM hr_object_receipts r
  WHERE r.id='91000000-0000-0000-0000-000000000007'
), digested AS (
  SELECT material.*, encode(digest(convert_to(
    E'venviewer.historical-runtime-normalized-content-identity.v1\n' ||
      hr_stable_canonical_json(body),'UTF8'),'sha256'),'hex') AS digest
  FROM material
)
INSERT INTO hr_normalized_content_identities(
  id, capture_subject_id, capture_subject_kind, environment_id,
  environment_mode, environment_digest, scope_epoch_id, source_set_id,
  venue_id, space_id, source_receipt_set_digest, source_member_count,
  source_total_bytes, root_component_index, root_role, root_relative_path,
  root_receipt_id, root_receipt_digest, root_sha256, root_size_bytes,
  detected_source_format, normalization_spec, format_tag,
  normalization_profile_version, test_vector_set_digest, decoder_name,
  decoder_version, decoder_binary_sha256, normalized_sha256,
  normalized_size_bytes, normalization_digest, normalization_body
)
SELECT '91000000-0000-0000-0000-000000000131', ss.capture_subject_id,
  'capture_import', ss.environment_id, ss.environment_mode,
  ss.environment_digest, ss.scope_epoch_id, ss.id, ss.venue_id, ss.space_id,
  ss.receipt_set_digest, ss.member_count, ss.total_bytes,
  ss.root_component_index, 'raw_capture', 'capture.sog', i.id,
  i.receipt_digest, i.sha256, i.size_bytes, 'sog', 'raw-bytes-exact.v1',
  'sog', 'historical-runtime-normalization-profile.v1', repeat('9',64),
  'exact-byte-identity', '1.0.0', repeat('a',64), i.sha256, i.size_bytes,
  i.digest, i.body
FROM hr_source_receipt_sets ss CROSS JOIN digested i
WHERE ss.id='91000000-0000-0000-0000-000000000130';
RESET ROLE;
COMMIT;

\connect :fixture_db postgres
BEGIN;

CREATE OR REPLACE FUNCTION public.fixture_issue_role(
  p_role_id uuid, p_snapshot_id uuid, p_subject_id uuid, p_role text,
  p_actor_id uuid, p_membership_id uuid, p_evidence jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  envelope bytea;
BEGIN
  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM hr_scope_epochs
     WHERE id='91000000-0000-0000-0000-000000000005'),
    'capture-role authority snapshot'
  );
  INSERT INTO hr_authority_snapshots(
    id, attestation_id, subject_id, subject_kind, environment_id,
    environment_mode, environment_digest, scope_epoch_id, venue_id, space_id,
    actor_id, authentication_source, membership_id, workspace_id
  ) SELECT p_snapshot_id, p_role_id, p_subject_id, 'capture_import',
    s.environment_id, s.environment_mode, s.environment_digest, s.id,
    s.venue_id, s.space_id, p_actor_id,
    CASE s.environment_mode
      WHEN 'test' THEN 'local_test_fixture'
      ELSE 'clerk_session'
    END,
    p_membership_id,
    '91000000-0000-0000-0000-000000000021'
  FROM hr_scope_epochs s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  INSERT INTO hr_role_attestation_drafts(
    id, subject_id, subject_kind, environment_id, environment_mode,
    environment_digest, scope_epoch_id, venue_id, space_id, role, actor_id,
    evidence_body, authority_snapshot_id, signing_key_authority_id, expires_at
  ) SELECT p_role_id, p_subject_id, 'capture_import', s.environment_id,
    s.environment_mode, s.environment_digest, s.id, s.venue_id, s.space_id,
    p_role, p_actor_id, p_evidence, p_snapshot_id,
    '91000000-0000-0000-0000-000000000120',
    clock_timestamp()+interval '12 hours'
  FROM hr_scope_epochs s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM hr_role_attestation_drafts WHERE id=p_role_id),
    'capture-role draft acceptance'
  );

  SELECT convert_to(jsonb_build_object(
    'payloadType',d.payload_type,
    'payload',encode(d.payload_bytes,'base64'),
    'signatures',jsonb_build_array(jsonb_build_object(
      'keyid',d.key_id,
      'sig',encode(decode(repeat('00',64),'hex'),'base64')
    ))
  )::text,'UTF8') INTO STRICT envelope
  FROM hr_role_attestation_drafts d WHERE d.id=p_role_id;
  INSERT INTO hr_role_attestations(id,envelope_bytes)
  VALUES(p_role_id,envelope);
END;
$$;
ALTER FUNCTION public.fixture_issue_role(uuid,uuid,uuid,text,uuid,uuid,jsonb)
  OWNER TO omnitwin_historical_evidence_verifier;

COMMIT;
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_role(
  '91000000-0000-0000-0000-000000000140',
  '91000000-0000-0000-0000-000000000141',
  '91000000-0000-0000-0000-000000000100', 'capture_operator',
  '91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000031',
  jsonb_build_object(
    'schemaVersion','historical-runtime-role-capture-operator.v1',
    'role','capture_operator',
    'captureClass','owner_authorized_existing_capture',
    'lineageStartKind','raw_capture_object',
    'ancestorState','exact_private_receipt',
    'captureTime',jsonb_build_object(
      'state','owner_attested_unknown','reason','fixture',
      'evidenceDocumentDigest',r.receipt_digest),
    'captureDevice',jsonb_build_object(
      'state','owner_attested_unknown','reason','fixture',
      'evidenceDocumentDigest',r.receipt_digest),
    'lineageDocument',jsonb_build_object(
      'scopeDigest',repeat('b',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_object_receipts r
WHERE r.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_role(
  '91000000-0000-0000-0000-000000000142',
  '91000000-0000-0000-0000-000000000143',
  '91000000-0000-0000-0000-000000000100', 'source_custodian',
  '91000000-0000-0000-0000-000000000012',
  '91000000-0000-0000-0000-000000000032',
  jsonb_build_object(
    'schemaVersion','historical-runtime-role-source-custodian.v1',
    'role','source_custodian',
    'sourceReceiptSetDigest',ss.receipt_set_digest,
    'custodyDocument',jsonb_build_object(
      'scopeDigest',repeat('c',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_object_receipts r CROSS JOIN hr_source_receipt_sets ss
WHERE r.id='91000000-0000-0000-0000-000000000008'
  AND ss.id='91000000-0000-0000-0000-000000000130';

INSERT INTO hr_capture_content_subjects(
  capture_root_id, subject_kind, environment_id, environment_mode,
  environment_digest, scope_epoch_id, venue_id, space_id, source_set_id,
  normalization_id, capture_operator_attestation_id,
  source_custodian_attestation_id, normalized_by_actor_id
)
SELECT '91000000-0000-0000-0000-000000000100', 'capture_import',
  s.environment_id, s.environment_mode, s.environment_digest, s.id,
  s.venue_id, s.space_id,
  '91000000-0000-0000-0000-000000000130',
  '91000000-0000-0000-0000-000000000131',
  '91000000-0000-0000-0000-000000000140',
  '91000000-0000-0000-0000-000000000142',
  '91000000-0000-0000-0000-000000000013'
FROM hr_scope_epochs s
WHERE s.id='91000000-0000-0000-0000-000000000005';

SELECT public.fixture_issue_role(
  '91000000-0000-0000-0000-000000000144',
  '91000000-0000-0000-0000-000000000145',
  '91000000-0000-0000-0000-000000000100', 'normalizer',
  '91000000-0000-0000-0000-000000000013',
  '91000000-0000-0000-0000-000000000033',
  jsonb_build_object(
    'schemaVersion','historical-runtime-role-normalizer.v1',
    'role','normalizer',
    'captureContentSubjectDigest',cs.capture_content_subject_digest,
    'normalizationDocument',jsonb_build_object(
      'scopeDigest',repeat('d',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_object_receipts r CROSS JOIN hr_capture_content_subjects cs
WHERE r.id='91000000-0000-0000-0000-000000000008'
  AND cs.capture_root_id='91000000-0000-0000-0000-000000000100';

SELECT public.fixture_issue_role(
  '91000000-0000-0000-0000-000000000146',
  '91000000-0000-0000-0000-000000000147',
  '91000000-0000-0000-0000-000000000100', 'capture_operator',
  '91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000031',
  jsonb_build_object(
    'schemaVersion','historical-runtime-role-capture-operator.v1',
    'role','capture_operator',
    'captureClass','owner_authorized_existing_capture',
    'lineageStartKind','processed_capture_package',
    'ancestorState','owner_attested_unavailable_ancestor',
    'captureTime',jsonb_build_object(
      'state','owner_attested_unknown','reason','fixture',
      'evidenceDocumentDigest',r.receipt_digest),
    'captureDevice',jsonb_build_object(
      'state','owner_attested_unknown','reason','fixture',
      'evidenceDocumentDigest',r.receipt_digest),
    'lineageDocument',jsonb_build_object(
      'scopeDigest',repeat('e',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_object_receipts r
WHERE r.id='91000000-0000-0000-0000-000000000008';

INSERT INTO hr_capture_content_drafts(
  capture_root_id, normalizer_attestation_id, signing_key_authority_id,
  expires_at
) VALUES (
  '91000000-0000-0000-0000-000000000100',
  '91000000-0000-0000-0000-000000000144',
  '91000000-0000-0000-0000-000000000121',
  clock_timestamp()+interval '10 hours'
);

INSERT INTO hr_capture_roots(capture_root_id,envelope_bytes)
SELECT d.capture_root_id,convert_to(jsonb_build_object(
  'payloadType',d.payload_type,
  'payload',encode(d.payload_bytes,'base64'),
  'signatures',jsonb_build_array(jsonb_build_object(
    'keyid',d.key_id,
    'sig',encode(decode(repeat('00',64),'hex'),'base64')
  ))
)::text,'UTF8')
FROM hr_capture_content_drafts d
WHERE d.capture_root_id='91000000-0000-0000-0000-000000000100';
RESET ROLE;
COMMIT;

\connect :fixture_db postgres
DROP FUNCTION public.fixture_issue_role(uuid,uuid,uuid,text,uuid,uuid,jsonb);

SET ROLE omnitwin_historical_evidence_owner;
SELECT hr_assert_capture_root_current(
  '91000000-0000-0000-0000-000000000100',
  '91000000-0000-0000-0000-000000000004',
  (SELECT mode FROM hr_evidence_environments
   WHERE id='91000000-0000-0000-0000-000000000004'),
  (SELECT environment_digest FROM hr_evidence_environments),
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002', clock_timestamp()
) AS root_expires_at;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM hr_assert_capture_source_current(
      '91000000-0000-0000-0000-000000000100',
      '91000000-0000-0000-0000-000000000130',
      '91000000-0000-0000-0000-000000000131',
      '91000000-0000-0000-0000-000000000146',
      '91000000-0000-0000-0000-000000000142',
      '91000000-0000-0000-0000-000000000004',
      (SELECT mode FROM hr_evidence_environments
       WHERE id='91000000-0000-0000-0000-000000000004'),
      (SELECT environment_digest FROM hr_evidence_environments),
      '91000000-0000-0000-0000-000000000005',
      '91000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000002',clock_timestamp()
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'operator/source lineage substitution was accepted';
  END IF;
END;
$$;
RESET ROLE;

SELECT cr.capture_root_id, cr.expires_at,
  min(sm.receipt_expires_at) AS source_min,
  cr.expires_at <= min(sm.receipt_expires_at) AS min_bound
FROM hr_capture_roots cr
JOIN hr_capture_content_subjects cs
  ON cs.capture_root_id=cr.capture_root_id
JOIN hr_source_receipt_members sm ON sm.source_set_id=cs.source_set_id
GROUP BY cr.capture_root_id,cr.expires_at;

\connect :fixture_db venviewer_local_fixture_verifier
SET ROLE omnitwin_historical_evidence_verifier;
DO $$
DECLARE
  material jsonb;
  set_digest text;
  rejected boolean := false;
  source_receipt hr_object_receipts%ROWTYPE;
  scope_row hr_scope_epochs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT source_receipt FROM hr_object_receipts
  WHERE id='91000000-0000-0000-0000-000000000007';
  SELECT * INTO STRICT scope_row FROM hr_scope_epochs
  WHERE id='91000000-0000-0000-0000-000000000005';
  material := jsonb_build_object(
    'ancestorState','exact_private_receipt',
    'lineageStartKind','direct_camera_capture_bundle',
    'members',jsonb_build_array(jsonb_build_object(
      'componentIndex',0,'receipt',source_receipt.receipt_body,
      'relativePath','metadata.json','role','supporting_capture_metadata')),
    'receiptSetId','91000000-0000-0000-0000-000000000160',
    'rootComponentIndex',0,
    'schemaVersion','historical-runtime-source-receipt-set.v1',
    'unavailableAncestorAttestationDigest',NULL,
    'unavailableAncestorAttestationId',NULL
  );
  set_digest := encode(digest(convert_to(
    E'venviewer.historical-runtime-source-receipt-set.v1\n' ||
      hr_stable_canonical_json(material),'UTF8'),'sha256'),'hex');
  BEGIN
    INSERT INTO hr_source_receipt_sets(
      id,capture_subject_id,capture_subject_kind,environment_id,
      environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
      lineage_start_kind,ancestor_state,root_component_index,member_count,
      total_bytes,receipt_set_digest,receipt_set_body
    ) VALUES (
      '91000000-0000-0000-0000-000000000160',
      '91000000-0000-0000-0000-000000000100','capture_import',
      scope_row.environment_id,scope_row.environment_mode,
      scope_row.environment_digest,scope_row.id,scope_row.venue_id,
      scope_row.space_id,'direct_camera_capture_bundle',
      'exact_private_receipt',0,1,source_receipt.size_bytes,set_digest,
      material || jsonb_build_object('receiptSetDigest',set_digest)
    );
    INSERT INTO hr_source_receipt_members(
      source_set_id,capture_subject_id,environment_id,environment_mode,
      environment_digest,receipt_set_digest,component_index,role,
      relative_path,receipt_id,receipt_role,venue_id,space_id,capability_id,
      capability_digest,provider_profile,provider_kind,
      provider_account_sha256,endpoint_authority_sha256,
      private_bucket_sha256,receipt_digest,sha256,size_bytes,file_name,
      mime_type,storage_key_sha256,version_kind,storage_version,storage_etag,
      receipt_expires_at
    ) VALUES (
      '91000000-0000-0000-0000-000000000160',
      '91000000-0000-0000-0000-000000000100',scope_row.environment_id,
      scope_row.environment_mode,scope_row.environment_digest,set_digest,0,
      'supporting_capture_metadata','metadata.json',source_receipt.id,
      source_receipt.receipt_role,source_receipt.venue_id,
      source_receipt.space_id,source_receipt.capability_id,
      source_receipt.capability_digest,source_receipt.provider_profile,
      source_receipt.provider_kind,source_receipt.provider_account_sha256,
      source_receipt.endpoint_authority_sha256,
      source_receipt.private_bucket_sha256,source_receipt.receipt_digest,
      source_receipt.sha256,source_receipt.size_bytes,source_receipt.file_name,
      source_receipt.mime_type,source_receipt.storage_key_sha256,
      source_receipt.version_kind,source_receipt.storage_version,
      source_receipt.storage_etag,source_receipt.denial_expires_at
    );
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'direct-camera metadata root was accepted';
  END IF;
END;
$$;

SELECT count(*) = 0 AS invalid_direct_camera_rolled_back
FROM hr_source_receipt_sets
WHERE id='91000000-0000-0000-0000-000000000160';
RESET ROLE;

\connect :fixture_db postgres
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users(id,email,name,role,venue_id,clerk_id,platform_role) VALUES
 ('91000000-0000-0000-0000-000000000014','capture-owner@example.test','Capture Owner','staff','91000000-0000-0000-0000-000000000001','capture_owner','none'),
 ('91000000-0000-0000-0000-000000000015','privacy-reviewer@example.test','Privacy Reviewer','staff','91000000-0000-0000-0000-000000000001','privacy_reviewer','none'),
 ('91000000-0000-0000-0000-000000000016','movable-reviewer@example.test','Movable Reviewer','staff','91000000-0000-0000-0000-000000000001','movable_reviewer','none'),
 ('91000000-0000-0000-0000-000000000017','capture-final@example.test','Capture Final Reviewer','staff','91000000-0000-0000-0000-000000000001','capture_final','none'),
 ('91000000-0000-0000-0000-000000000018','derivative-producer@example.test','Derivative Producer','staff','91000000-0000-0000-0000-000000000001','derivative_producer','none'),
 ('91000000-0000-0000-0000-000000000019','derivative-custodian@example.test','Derivative Custodian','staff','91000000-0000-0000-0000-000000000001','derivative_custodian','none'),
 ('91000000-0000-0000-0000-000000000020','derivative-reviewer@example.test','Derivative Reviewer','staff','91000000-0000-0000-0000-000000000001','derivative_reviewer','none');

INSERT INTO workspace_memberships(
  id,workspace_id,user_id,email,role,venue_role,status,accepted_at
) VALUES
 ('91000000-0000-0000-0000-000000000034','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000014','capture-owner@example.test','owner','staff','active',now()),
 ('91000000-0000-0000-0000-000000000035','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000015','privacy-reviewer@example.test','staff','staff','active',now()),
 ('91000000-0000-0000-0000-000000000036','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000016','movable-reviewer@example.test','staff','staff','active',now()),
 ('91000000-0000-0000-0000-000000000037','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000017','capture-final@example.test','staff','staff','active',now()),
 ('91000000-0000-0000-0000-000000000038','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000018','derivative-producer@example.test','staff','staff','active',now()),
 ('91000000-0000-0000-0000-000000000039','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000019','derivative-custodian@example.test','staff','staff','active',now()),
 ('91000000-0000-0000-0000-000000000040','91000000-0000-0000-0000-000000000021','91000000-0000-0000-0000-000000000020','derivative-reviewer@example.test','staff','staff','active',now());

COMMIT;
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO hr_evidence_subjects(id,subject_kind,scope_epoch_id)
VALUES (
  '91000000-0000-0000-0000-000000000200','derivation',
  '91000000-0000-0000-0000-000000000005'
);
INSERT INTO hr_object_receipts(
  id,capability_id,receipt_role,storage_key_sha256,storage_version,
  storage_etag,file_name,mime_type,sha256,size_bytes,custodian_actor_id,
  custodian_membership_id,observed_by_actor_id,observed_by_membership_id,
  authenticated_read_request_digest,authenticated_read_response_digest,
  read_at,denial_request_digest,denial_response_digest,denial_status_code,
  denial_class,denial_get_request_digest,denial_get_response_digest,
  denial_get_status_code,denial_get_class,denial_probed_by,
  denial_prober_membership_id
) VALUES (
  '91000000-0000-0000-0000-000000000201',
  '91000000-0000-0000-0000-000000000006','derived_member',repeat('4',64),
  'derived-v1','derived-etag','derived.spz','application/octet-stream',
  repeat('5',64),512,'91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000031',
  '91000000-0000-0000-0000-000000000012',
  '91000000-0000-0000-0000-000000000032',repeat('6',64),repeat('7',64),
  clock_timestamp(),repeat('8',64),repeat('9',64),403,'access_forbidden',
  repeat('a',64),repeat('b',64),403,'access_forbidden',
  '91000000-0000-0000-0000-000000000013',
  '91000000-0000-0000-0000-000000000033'
);
RESET ROLE;
COMMIT;

\connect :fixture_db postgres
BEGIN;

INSERT INTO asset_versions(
  id,venue_slug,room_slug,asset_kind,source_type,file_name,file_ext,r2_key,
  mime_type,sha256,size_bytes,evidence_status,runtime_status
) VALUES (
  '91000000-0000-0000-0000-000000000202','trades-hall','receipt-room',
  'splat','runpod','derived.spz','.spz','evidence/derived-v1.spz',
  'application/octet-stream',repeat('5',64),512,'machine_checked','usable'
);

CREATE OR REPLACE FUNCTION public.fixture_issue_scoped_role(
  p_role_id uuid,p_snapshot_id uuid,p_subject_id uuid,p_subject_kind text,
  p_role text,p_actor_id uuid,p_membership_id uuid,p_evidence jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  envelope bytea;
BEGIN
  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM hr_scope_epochs
     WHERE id='91000000-0000-0000-0000-000000000005'),
    'scoped-role authority snapshot'
  );
  INSERT INTO hr_authority_snapshots(
    id,attestation_id,subject_id,subject_kind,environment_id,
    environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
    actor_id,authentication_source,membership_id,workspace_id
  ) SELECT p_snapshot_id,p_role_id,p_subject_id,p_subject_kind,
    s.environment_id,s.environment_mode,s.environment_digest,s.id,
    s.venue_id,s.space_id,p_actor_id,
    CASE s.environment_mode
      WHEN 'test' THEN 'local_test_fixture'
      ELSE 'clerk_session'
    END,
    p_membership_id,
    '91000000-0000-0000-0000-000000000021'
  FROM hr_scope_epochs s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  INSERT INTO hr_role_attestation_drafts(
    id,subject_id,subject_kind,environment_id,environment_mode,
    environment_digest,scope_epoch_id,venue_id,space_id,role,actor_id,
    evidence_body,authority_snapshot_id,signing_key_authority_id,expires_at
  ) SELECT p_role_id,p_subject_id,p_subject_kind,s.environment_id,
    s.environment_mode,s.environment_digest,s.id,s.venue_id,s.space_id,
    p_role,p_actor_id,p_evidence,p_snapshot_id,
    '91000000-0000-0000-0000-000000000120',
    clock_timestamp()+interval '12 hours'
  FROM hr_scope_epochs s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM hr_role_attestation_drafts WHERE id=p_role_id),
    'scoped-role draft acceptance'
  );

  SELECT convert_to(jsonb_build_object(
    'payloadType',d.payload_type,
    'payload',encode(d.payload_bytes,'base64'),
    'signatures',jsonb_build_array(jsonb_build_object(
      'keyid',d.key_id,
      'sig',encode(decode(repeat('00',64),'hex'),'base64')
    ))
  )::text,'UTF8') INTO STRICT envelope
  FROM hr_role_attestation_drafts d WHERE d.id=p_role_id;
  INSERT INTO hr_role_attestations(id,envelope_bytes)
  VALUES(p_role_id,envelope);
END;
$$;
ALTER FUNCTION public.fixture_issue_scoped_role(
  uuid,uuid,uuid,text,text,uuid,uuid,jsonb
) OWNER TO omnitwin_historical_evidence_verifier;

COMMIT;
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000170',
  '91000000-0000-0000-0000-000000000171',
  '91000000-0000-0000-0000-000000000100','capture_import',
  'owner_authorizer','91000000-0000-0000-0000-000000000014',
  '91000000-0000-0000-0000-000000000034',jsonb_build_object(
    'schemaVersion','historical-runtime-role-owner-authorization.v1',
    'role','owner_authorizer','decision','approved',
    'sourceReceiptSetDigest',ss.receipt_set_digest,
    'authorizedOperations',jsonb_build_array(
      'store_private','convert','render','generate_derivatives',
      'internal_planning','customer_presentation'),
    'authorizationDocument',jsonb_build_object(
      'scopeDigest',repeat('1',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_source_receipt_sets ss CROSS JOIN hr_object_receipts r
WHERE ss.id='91000000-0000-0000-0000-000000000130'
  AND r.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000172',
  '91000000-0000-0000-0000-000000000173',
  '91000000-0000-0000-0000-000000000100','capture_import',
  'privacy_reviewer','91000000-0000-0000-0000-000000000015',
  '91000000-0000-0000-0000-000000000035',jsonb_build_object(
    'schemaVersion','historical-runtime-role-privacy-review.v1',
    'role','privacy_reviewer','decision','approved',
    'sourceReceiptSetDigest',ss.receipt_set_digest,
    'reviewedCategories',jsonb_build_array(
      'faces','personal_documents','vehicle_registrations',
      'access_credentials','private_conversations'),
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('2',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_source_receipt_sets ss CROSS JOIN hr_object_receipts r
WHERE ss.id='91000000-0000-0000-0000-000000000130'
  AND r.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000174',
  '91000000-0000-0000-0000-000000000175',
  '91000000-0000-0000-0000-000000000100','capture_import',
  'movable_content_reviewer','91000000-0000-0000-0000-000000000016',
  '91000000-0000-0000-0000-000000000036',jsonb_build_object(
    'schemaVersion','historical-runtime-role-movable-content-review.v1',
    'role','movable_content_reviewer','decision','approved',
    'treatment','accepted_as_captured',
    'sourceReceiptSetDigest',ss.receipt_set_digest,
    'reviewedCategories',jsonb_build_array(
      'furniture','decor','event_dressing','people','temporary_equipment'),
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('3',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_source_receipt_sets ss CROSS JOIN hr_object_receipts r
WHERE ss.id='91000000-0000-0000-0000-000000000130'
  AND r.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000176',
  '91000000-0000-0000-0000-000000000177',
  '91000000-0000-0000-0000-000000000100','capture_import',
  'capture_final_reviewer','91000000-0000-0000-0000-000000000017',
  '91000000-0000-0000-0000-000000000037',jsonb_build_object(
    'schemaVersion','historical-runtime-role-capture-final-review.v1',
    'role','capture_final_reviewer','decision','approved',
    'captureRootEvidenceDigest',cr.capture_root_evidence_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('4',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_capture_roots cr CROSS JOIN hr_object_receipts r
WHERE cr.capture_root_id='91000000-0000-0000-0000-000000000100'
  AND r.id='91000000-0000-0000-0000-000000000008';

INSERT INTO hr_capture_clearances(
  id,subject_id,subject_kind,environment_id,environment_mode,
  environment_digest,scope_epoch_id,venue_id,space_id,capture_root_id,
  capture_content_subject_digest,capture_root_evidence_digest,
  capture_root_expires_at,source_set_id,source_receipt_set_digest,
  owner_attestation_id,owner_attestation_digest,owner_actor_id,
  owner_expires_at,privacy_attestation_id,privacy_attestation_digest,
  privacy_actor_id,privacy_expires_at,movable_attestation_id,
  movable_attestation_digest,movable_actor_id,movable_expires_at,
  final_attestation_id,final_attestation_digest,final_actor_id,
  final_expires_at,capture_clearance_digest,effective_at,expires_at,
  clearance_body
)
SELECT '91000000-0000-0000-0000-000000000180',cr.capture_root_id,
  'capture_import',cr.environment_id,cr.environment_mode,
  cr.environment_digest,cr.scope_epoch_id,cr.venue_id,cr.space_id,
  cr.capture_root_id,cs.capture_content_subject_digest,
  cr.capture_root_evidence_digest,cr.expires_at,cs.source_set_id,
  cs.source_receipt_set_digest,o.id,o.attestation_digest,o.actor_id,o.expires_at,
  p.id,p.attestation_digest,p.actor_id,p.expires_at,
  m.id,m.attestation_digest,m.actor_id,m.expires_at,
  f.id,f.attestation_digest,f.actor_id,f.expires_at,
  repeat('0',64),clock_timestamp(),clock_timestamp()+interval '1 hour','{}'
FROM hr_capture_roots cr
JOIN hr_capture_content_subjects cs
  ON cs.capture_root_id=cr.capture_root_id
JOIN hr_role_attestations o
  ON o.id='91000000-0000-0000-0000-000000000170'
JOIN hr_role_attestations p
  ON p.id='91000000-0000-0000-0000-000000000172'
JOIN hr_role_attestations m
  ON m.id='91000000-0000-0000-0000-000000000174'
JOIN hr_role_attestations f
  ON f.id='91000000-0000-0000-0000-000000000176'
WHERE cr.capture_root_id='91000000-0000-0000-0000-000000000100';

SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000210',
  '91000000-0000-0000-0000-000000000211',
  '91000000-0000-0000-0000-000000000200','derivation',
  'derivative_producer','91000000-0000-0000-0000-000000000018',
  '91000000-0000-0000-0000-000000000038',jsonb_build_object(
    'schemaVersion','historical-runtime-role-derivative-producer.v1',
    'role','derivative_producer','conversionRecipeDigest',recipe.digest,
    'producerDocument',jsonb_build_object(
      'scopeDigest',repeat('6',64),'documentReceipt',r.receipt_body)
  )
) FROM hr_object_receipts r CROSS JOIN LATERAL (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-conversion-recipe.v1\n' ||
    hr_stable_canonical_json(jsonb_build_object(
      'conversionBinarySha256',repeat('a',64),
      'conversionCommandSha256',repeat('b',64),
      'conversionEnvironmentDigest',repeat('c',64),
      'conversionParametersDigest',repeat('d',64),
      'conversionTool','fixture-converter',
      'conversionVersion','1.0.0'
    )),'UTF8'),'sha256'),'hex') AS digest
) recipe
WHERE r.id='91000000-0000-0000-0000-000000000008';

WITH canonical_member AS (
  SELECT jsonb_build_object(
    'assetVersionId','91000000-0000-0000-0000-000000000202',
    'fileExt','.spz','fileName',r.file_name,'memberIndex',0,
    'mimeType',r.mime_type,'outputReceipt',r.receipt_body,
    'sha256',r.sha256,'sizeBytes',r.size_bytes
  ) AS body
  FROM hr_object_receipts r
  WHERE r.id='91000000-0000-0000-0000-000000000201'
), member_digest AS (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-members.v1\n' ||
    hr_stable_canonical_json(jsonb_build_array(body)),
    'UTF8'),'sha256'),'hex') AS digest
  FROM canonical_member
)
SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000212',
  '91000000-0000-0000-0000-000000000213',
  '91000000-0000-0000-0000-000000000200','derivation',
  'derivative_custodian','91000000-0000-0000-0000-000000000019',
  '91000000-0000-0000-0000-000000000039',jsonb_build_object(
    'schemaVersion','historical-runtime-role-derivative-custodian.v1',
    'role','derivative_custodian','outputReceiptSetDigest',md.digest,
    'custodyDocument',jsonb_build_object(
      'scopeDigest',repeat('7',64),'documentReceipt',r.receipt_body)
  )
) FROM member_digest md CROSS JOIN hr_object_receipts r
WHERE r.id='91000000-0000-0000-0000-000000000008';

WITH canonical_member AS (
  SELECT jsonb_build_object(
    'assetVersionId','91000000-0000-0000-0000-000000000202',
    'fileExt','.spz','fileName',r.file_name,'memberIndex',0,
    'mimeType',r.mime_type,'outputReceipt',r.receipt_body,
    'sha256',r.sha256,'sizeBytes',r.size_bytes
  ) AS body
  FROM hr_object_receipts r
  WHERE r.id='91000000-0000-0000-0000-000000000201'
), member_digest AS (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-derivation-members.v1\n' ||
    hr_stable_canonical_json(jsonb_build_array(body)),
    'UTF8'),'sha256'),'hex') AS digest
  FROM canonical_member
)
SELECT public.fixture_issue_scoped_role(
  '91000000-0000-0000-0000-000000000214',
  '91000000-0000-0000-0000-000000000215',
  '91000000-0000-0000-0000-000000000200','derivation',
  'derivative_reviewer','91000000-0000-0000-0000-000000000020',
  '91000000-0000-0000-0000-000000000040',jsonb_build_object(
    'schemaVersion','historical-runtime-role-derivative-review.v1',
    'role','derivative_reviewer','decision','approved',
    'outputReceiptSetDigest',md.digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('8',64),'documentReceipt',r.receipt_body)
  )
) FROM member_digest md CROSS JOIN hr_object_receipts r
WHERE r.id='91000000-0000-0000-0000-000000000008';

WITH canonical_member AS (
  SELECT jsonb_build_object(
    'assetVersionId','91000000-0000-0000-0000-000000000202',
    'fileExt','.spz','fileName',r.file_name,'memberIndex',0,
    'mimeType',r.mime_type,'outputReceipt',r.receipt_body,
    'sha256',r.sha256,'sizeBytes',r.size_bytes
  ) AS body
  FROM hr_object_receipts r
  WHERE r.id='91000000-0000-0000-0000-000000000201'
)
INSERT INTO hr_derivations(
  id,subject_kind,environment_id,environment_mode,environment_digest,
  scope_epoch_id,venue_id,venue_slug,space_id,space_slug,capture_root_id,
  capture_root_evidence_digest,capture_root_expires_at,
  capture_clearance_id,capture_clearance_digest,
  capture_clearance_expires_at,normalization_id,source_set_id,
  source_receipt_set_digest,input_normalized_content_digest,
  input_normalized_sha256,input_normalized_size_bytes,conversion_tool,
  conversion_version,conversion_binary_sha256,conversion_command_sha256,
  conversion_parameters_digest,conversion_environment_digest,
  conversion_recipe_digest,producer_attestation_id,
  producer_attestation_digest,producer_actor_id,producer_expires_at,
  custodian_attestation_id,custodian_attestation_digest,custodian_actor_id,
  custodian_expires_at,reviewer_attestation_id,reviewer_attestation_digest,
  reviewer_actor_id,reviewer_expires_at,member_count,total_bytes,
  members_digest,minimum_output_receipt_expires_at,
  derivation_evidence_digest,derivation_body,expires_at
)
SELECT '91000000-0000-0000-0000-000000000200','derivation',
  cc.environment_id,cc.environment_mode,cc.environment_digest,
  cc.scope_epoch_id,cc.venue_id,'trades-hall',cc.space_id,'receipt-room',
  cc.capture_root_id,cc.capture_root_evidence_digest,cc.capture_root_expires_at,
  cc.id,cc.capture_clearance_digest,cc.expires_at,ni.id,ni.source_set_id,
  ni.source_receipt_set_digest,ni.normalization_digest,
  ni.normalized_sha256,ni.normalized_size_bytes,'fixture-converter','1.0.0',
  repeat('a',64),repeat('b',64),repeat('d',64),repeat('c',64),
  p.bound_digest,p.id,p.attestation_digest,p.actor_id,p.expires_at,
  c.id,c.attestation_digest,c.actor_id,c.expires_at,
  v.id,v.attestation_digest,v.actor_id,v.expires_at,
  1,512,repeat('0',64),r.denial_expires_at,repeat('0',64),
  jsonb_build_object('members',jsonb_build_array(cm.body)),
  clock_timestamp()+interval '1 hour'
FROM hr_capture_clearances cc
JOIN hr_normalized_content_identities ni
  ON ni.id='91000000-0000-0000-0000-000000000131'
JOIN hr_role_attestations p
  ON p.id='91000000-0000-0000-0000-000000000210'
JOIN hr_role_attestations c
  ON c.id='91000000-0000-0000-0000-000000000212'
JOIN hr_role_attestations v
  ON v.id='91000000-0000-0000-0000-000000000214'
JOIN hr_object_receipts r
  ON r.id='91000000-0000-0000-0000-000000000201'
CROSS JOIN canonical_member cm
WHERE cc.id='91000000-0000-0000-0000-000000000180';

INSERT INTO hr_derivation_members(
  derivation_id,environment_id,environment_mode,environment_digest,
  scope_epoch_id,venue_id,venue_slug,space_id,space_slug,
  derivation_evidence_digest,derivation_expires_at,member_index,
  asset_version_id,file_name,file_ext,mime_type,sha256,size_bytes,
  output_receipt_id,output_receipt_digest,capability_id,capability_digest,
  provider_profile,provider_kind,provider_account_sha256,
  endpoint_authority_sha256,private_bucket_sha256,storage_key_sha256,
  version_kind,storage_version,storage_etag,receipt_expires_at,member_body
)
SELECT d.id,d.environment_id,d.environment_mode,d.environment_digest,
  d.scope_epoch_id,d.venue_id,d.venue_slug,d.space_id,d.space_slug,
  d.derivation_evidence_digest,d.expires_at,0,
  '91000000-0000-0000-0000-000000000202',r.file_name,'.spz',r.mime_type,
  r.sha256,r.size_bytes,r.id,r.receipt_digest,r.capability_id,
  r.capability_digest,r.provider_profile,r.provider_kind,
  r.provider_account_sha256,r.endpoint_authority_sha256,
  r.private_bucket_sha256,r.storage_key_sha256,r.version_kind,
  r.storage_version,r.storage_etag,r.denial_expires_at,
  d.derivation_body->'members'->0
FROM hr_derivations d CROSS JOIN hr_object_receipts r
WHERE d.id='91000000-0000-0000-0000-000000000200'
  AND r.id='91000000-0000-0000-0000-000000000201';

RESET ROLE;
COMMIT;

\connect :fixture_db postgres
DROP FUNCTION public.fixture_issue_scoped_role(
  uuid,uuid,uuid,text,text,uuid,uuid,jsonb
);

SET ROLE omnitwin_historical_evidence_owner;
SELECT hr_assert_capture_clearance_current(
  '91000000-0000-0000-0000-000000000180',
  '91000000-0000-0000-0000-000000000004',
  (SELECT mode FROM hr_evidence_environments
   WHERE id='91000000-0000-0000-0000-000000000004'),
  (SELECT environment_digest FROM hr_evidence_environments),
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',clock_timestamp()
) AS clearance_expires_at;
SELECT hr_assert_derivation_current(
  '91000000-0000-0000-0000-000000000200',
  '91000000-0000-0000-0000-000000000004',
  (SELECT mode FROM hr_evidence_environments
   WHERE id='91000000-0000-0000-0000-000000000004'),
  (SELECT environment_digest FROM hr_evidence_environments),
  '91000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000002',clock_timestamp()
) AS derivation_expires_at;
RESET ROLE;

BEGIN;
UPDATE workspace_memberships
SET status='suspended'
WHERE id='91000000-0000-0000-0000-000000000040';
SET ROLE omnitwin_historical_evidence_owner;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM hr_assert_derivation_current(
      '91000000-0000-0000-0000-000000000200',
      '91000000-0000-0000-0000-000000000004',
      (SELECT mode FROM hr_evidence_environments
       WHERE id='91000000-0000-0000-0000-000000000004'),
      (SELECT environment_digest FROM hr_evidence_environments),
      '91000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000002',clock_timestamp()
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'suspended derivative reviewer remained current';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

SELECT d.id,d.member_count,d.total_bytes,
  d.expires_at <= cc.expires_at AS clearance_bound,
  d.expires_at <= min(dm.receipt_expires_at) AS receipt_bound,
  count(dm.*)=d.member_count AS exact_member_count,
  (SELECT status='active' FROM workspace_memberships
   WHERE id='91000000-0000-0000-0000-000000000040') AS reviewer_restored
FROM hr_derivations d
JOIN hr_capture_clearances cc ON cc.id=d.capture_clearance_id
JOIN hr_derivation_members dm ON dm.derivation_id=d.id
WHERE d.id='91000000-0000-0000-0000-000000000200'
GROUP BY d.id,d.member_count,d.total_bytes,d.expires_at,cc.expires_at;

-- @phase scene-common
\set ON_ERROR_STOP on
\set VERBOSITY verbose

-- Synthetic prerequisite graph for the committed disposable 0066 verifier.
-- Exact byte/key variables come from the composed raw Twin+Scene verifier.
\connect :fixture_db postgres

BEGIN;
WITH fixture_clock AS (
  SELECT '2026-08-20T19:05:00.000Z'::timestamptz AS reviewed_at
)
INSERT INTO public.runtime_packages (
  id, venue_slug, room_slug, primary_visual_asset_version_id, manifest_json,
  evidence_status, runtime_status, created_at, updated_at, revision,
  identity_kind, content_digest
) VALUES (
  '91000000-0000-0000-0000-000000000700', 'trades-hall', 'receipt-room',
  '91000000-0000-0000-0000-000000000202',
  jsonb_build_object(
    'schemaVersion','venviewer.runtime-package.v1',
    'packageType','room-runtime','venueSlug','trades-hall',
    'roomSlug','receipt-room','assets',jsonb_build_object()
  ),
  'machine_checked','internal_ready',
  (SELECT reviewed_at - interval '20 minutes' FROM fixture_clock),
  (SELECT reviewed_at - interval '20 minutes' FROM fixture_clock),
  1,'content_sha256',repeat('a',64)
);

INSERT INTO public.runtime_transform_artifacts (
  id, runtime_package_id, venue_slug, room_slug, transform_artifact_id,
  transform_artifact, review_note, registered_by, created_at, updated_at,
  artifact_digest
) VALUES (
  '91000000-0000-0000-0000-000000000701',
  '91000000-0000-0000-0000-000000000700',
  'trades-hall','receipt-room','receipt-room-transform-v1',
  jsonb_build_object(
    'id','receipt-room-transform-v1','units','meters',
    'sourceFrame','e57_world','targetFrame','receipt_room_local',
    'alignmentMethod','matterport_e57_extraction',
    'reviewer',jsonb_build_object('actorType','human','role','transform_reviewer'),
    'provenance',jsonb_build_object('refs',jsonb_build_array(
      jsonb_build_object(
        'refType','artifact','ref','capture-root/91000000-0000-0000-0000-000000000100'
      )
    ))
  ),
  'Exact fixture transform reviewed against capture lineage.',
  '91000000-0000-0000-0000-000000000023',
  '2026-08-20T18:50:00.000Z','2026-08-20T18:50:00.000Z',
  :'transform_digest'
);

INSERT INTO public.runtime_qa_records (
  id, runtime_package_id, venue_slug, room_slug, record_id, record_json,
  signed_transform_artifact_id, public_exposure_decision,
  asset_evidence_status, runtime_status, reviewed_by, created_at, updated_at,
  record_digest, reviewed_at
) VALUES (
  '91000000-0000-0000-0000-000000000702',
  '91000000-0000-0000-0000-000000000700',
  'trades-hall','receipt-room','receipt-room-qa-v1',
  jsonb_build_object(
    'schemaVersion','runtime-qa-record.v0',
    'recordId','receipt-room-qa-v1',
    'runtimePackageId','91000000-0000-0000-0000-000000000700',
    'venueSlug','trades-hall','roomSlug','receipt-room',
    'assetEvidenceStatus','machine_checked','runtimeStatus','internal_ready',
    'publicExposure',jsonb_build_object('decision','approved_internal_preview'),
    'viewTransform',jsonb_build_object(
      'signedTransformArtifactId','receipt-room-transform-v1'
    ),
    'recordedAt','2026-08-20T18:55:00.000Z'
  ),
  'receipt-room-transform-v1','approved_internal_preview',
  'machine_checked','internal_ready',
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T18:55:00.000Z','2026-08-20T18:55:00.000Z',
  repeat('b',64),'2026-08-20T18:55:00.000Z'
);

INSERT INTO public.reconstruction_review_evidence_artifacts (
  id, venue_slug, artifact_kind, artifact_id, artifact_digest, object_key,
  object_sha256, size_bytes, schema_version, idempotency_key, request_digest,
  registered_by, registered_at
) VALUES (
  '91000000-0000-0000-0000-000000000703','trades-hall',
  'scene_authority_map_v0','receipt-room-scene-map-v1',
  :'scene_artifact_digest','evidence/receipt-room-scene-map.json',
  :'scene_sha256',(:'scene_size')::bigint,
  'venviewer.scene-authority-map.v0','fixture-scene-registry-703',
  encode(digest(convert_to('fixture-scene-registry-703','UTF8'),'sha256'),'hex'),
  '91000000-0000-0000-0000-000000000025',
  '2026-08-20T18:55:00.000Z'
);

INSERT INTO public.runtime_presentation_rights_evidence (
  id, asset_version_id, venue_slug, room_slug, asset_sha256,
  asset_size_bytes, evidence_digest, evidence_body, decision, reviewed_by,
  reviewed_at, created_at
) VALUES (
  '91000000-0000-0000-0000-000000000704',
  '91000000-0000-0000-0000-000000000202',
  'trades-hall','receipt-room',repeat('5',64),512,repeat('c',64),
  jsonb_build_object(
    'schemaVersion','runtime-presentation-rights-evidence.v1',
    'evidenceId','91000000-0000-0000-0000-000000000704',
    'assetVersionId','91000000-0000-0000-0000-000000000202',
    'venueSlug','trades-hall','roomSlug','receipt-room',
    'assetSha256',repeat('5',64),'assetSizeBytes',512,
    'decision','approved',
    'reviewedBy','91000000-0000-0000-0000-000000000022',
    'reviewedAt','2026-08-20T18:56:00.000Z'
  ),
  'approved','91000000-0000-0000-0000-000000000022',
  '2026-08-20T18:56:00.000Z','2026-08-20T18:56:00.000Z'
);

INSERT INTO public.runtime_presentation_admissions (
  id, runtime_package_id, runtime_package_content_digest, venue_slug,
  room_slug, runtime_manifest_digest, reviewed_profile_id,
  reviewed_profile_manifest_fingerprint, runtime_qa_record_id,
  runtime_qa_record_key, runtime_qa_record_digest, runtime_qa_decision,
  runtime_qa_reviewed_by, runtime_qa_reviewed_at,
  runtime_transform_artifact_row_id, runtime_transform_artifact_id,
  runtime_transform_artifact_digest, scene_authority_artifact_row_id,
  scene_authority_artifact_kind, scene_authority_artifact_id,
  scene_authority_map_digest, rights_evidence_digest, member_count,
  decision, admission_digest, admission_body, reviewed_by, reviewed_at,
  created_at
) VALUES (
  '91000000-0000-0000-0000-000000000705',
  '91000000-0000-0000-0000-000000000700',repeat('a',64),
  'trades-hall','receipt-room',repeat('d',64),'receipt-room-profile-v1',
  repeat('e',64),'91000000-0000-0000-0000-000000000702',
  'receipt-room-qa-v1',repeat('b',64),'approved_internal_preview',
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T18:55:00.000Z',
  '91000000-0000-0000-0000-000000000701',
  'receipt-room-transform-v1',:'transform_digest',
  '91000000-0000-0000-0000-000000000703','scene_authority_map_v0',
  'receipt-room-scene-map-v1',:'scene_artifact_digest',repeat('c',64),1,
  'approved',repeat('f',64),
  jsonb_build_object(
    'schemaVersion','runtime-presentation-admission.v1',
    'admissionId','91000000-0000-0000-0000-000000000705',
    'runtimePackageId','91000000-0000-0000-0000-000000000700',
    'runtimePackageContentDigest',repeat('a',64),
    'venueSlug','trades-hall','roomSlug','receipt-room',
    'runtimeManifestDigest',repeat('d',64),
    'reviewedProfileId','receipt-room-profile-v1',
    'reviewedProfileManifestFingerprint',repeat('e',64),
    'runtimeQaRecordId','91000000-0000-0000-0000-000000000702',
    'runtimeQaRecordKey','receipt-room-qa-v1',
    'runtimeQaRecordDigest',repeat('b',64),
    'runtimeQaDecision','approved_internal_preview',
    'runtimeQaReviewedBy','91000000-0000-0000-0000-000000000022',
    'runtimeQaReviewedAt','2026-08-20T18:55:00.000Z',
    'runtimeTransformArtifactRowId','91000000-0000-0000-0000-000000000701',
    'runtimeTransformArtifactId','receipt-room-transform-v1',
    'runtimeTransformArtifactDigest',:'transform_digest',
    'sceneAuthorityArtifactRowId','91000000-0000-0000-0000-000000000703',
    'sceneAuthorityArtifactKind','scene_authority_map_v0',
    'sceneAuthorityArtifactId','receipt-room-scene-map-v1',
    'sceneAuthorityMapDigest',:'scene_artifact_digest',
    'rightsEvidenceDigest',repeat('c',64),'memberCount',1,
    'decision','approved',
    'reviewedBy','91000000-0000-0000-0000-000000000022',
    'reviewedAt','2026-08-20T19:05:00.000Z'
  ),
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T19:05:00.000Z','2026-08-20T19:05:00.000Z'
);

INSERT INTO public.runtime_presentation_admission_members (
  admission_id, runtime_package_id, runtime_package_content_digest,
  venue_slug, room_slug, member_index, asset_version_id, file_name, file_ext,
  mime_type, sha256, size_bytes, storage_key_sha256, rights_evidence_row_id,
  rights_evidence_digest, rights_decision, rights_reviewed_by,
  rights_reviewed_at
) VALUES (
  '91000000-0000-0000-0000-000000000705',
  '91000000-0000-0000-0000-000000000700',repeat('a',64),
  'trades-hall','receipt-room',0,
  '91000000-0000-0000-0000-000000000202','derived.spz','.spz',
  'application/octet-stream',repeat('5',64),512,repeat('4',64),
  '91000000-0000-0000-0000-000000000704',repeat('c',64),'approved',
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T18:56:00.000Z'
);
COMMIT;

SELECT 'legacy_admission_stage',
  (SELECT count(*) FROM public.runtime_packages WHERE id='91000000-0000-0000-0000-000000000700'),
  (SELECT count(*) FROM public.runtime_presentation_admissions WHERE id='91000000-0000-0000-0000-000000000705'),
  (SELECT count(*) FROM public.runtime_presentation_admission_members WHERE admission_id='91000000-0000-0000-0000-000000000705');

\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres

BEGIN;
INSERT INTO public.users (
  id,email,name,role,venue_id,clerk_id,platform_role
) VALUES (
  '91000000-0000-0000-0000-000000000028',
  'prodpath-transform-reviewer@example.test','Prodpath Transform Reviewer',
  'staff','91000000-0000-0000-0000-000000000001',
  'clerk_prodpath_transform_reviewer','none'
);
INSERT INTO public.workspace_memberships (
  id,workspace_id,user_id,email,role,venue_role,status,accepted_at
) VALUES (
  '91000000-0000-0000-0000-000000000045',
  '91000000-0000-0000-0000-000000000021',
  '91000000-0000-0000-0000-000000000028',
  'prodpath-transform-reviewer@example.test','staff','staff','active',
  clock_timestamp()
);
COMMIT;

\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO public.hr_evidence_subjects(id,subject_kind,scope_epoch_id) VALUES
  ('91000000-0000-0000-0000-000000000300','scene_validation',
   '91000000-0000-0000-0000-000000000005'),
  ('91000000-0000-0000-0000-000000000400','reviewed_profile',
   '91000000-0000-0000-0000-000000000005'),
  ('91000000-0000-0000-0000-000000000710','transform_review',
   '91000000-0000-0000-0000-000000000005');
COMMIT;

\connect :fixture_db postgres
CREATE OR REPLACE FUNCTION public.fixture_issue_scoped_role_prodpath(
  p_role_id uuid,p_snapshot_id uuid,p_subject_id uuid,p_subject_kind text,
  p_role text,p_actor_id uuid,p_membership_id uuid,p_evidence jsonb
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  envelope bytea;
BEGIN
  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM public.hr_scope_epochs
     WHERE id='91000000-0000-0000-0000-000000000005'),
    'Scene-role authority snapshot'
  );
  INSERT INTO public.hr_authority_snapshots(
    id,attestation_id,subject_id,subject_kind,environment_id,
    environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
    actor_id,authentication_source,membership_id,workspace_id
  ) SELECT p_snapshot_id,p_role_id,p_subject_id,p_subject_kind,
    s.environment_id,s.environment_mode,s.environment_digest,s.id,
    s.venue_id,s.space_id,p_actor_id,'clerk_session',p_membership_id,
    '91000000-0000-0000-0000-000000000021'
  FROM public.hr_scope_epochs AS s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  INSERT INTO public.hr_role_attestation_drafts(
    id,subject_id,subject_kind,environment_id,environment_mode,
    environment_digest,scope_epoch_id,venue_id,space_id,role,actor_id,
    evidence_body,authority_snapshot_id,signing_key_authority_id,expires_at
  ) SELECT p_role_id,p_subject_id,p_subject_kind,s.environment_id,
    s.environment_mode,s.environment_digest,s.id,s.venue_id,s.space_id,
    p_role,p_actor_id,p_evidence,p_snapshot_id,
    '91000000-0000-0000-0000-000000000120',
    clock_timestamp()+interval '10 hours'
  FROM public.hr_scope_epochs AS s
  WHERE s.id='91000000-0000-0000-0000-000000000005';

  PERFORM public.fixture_wait_for_db_clock(
    (SELECT effective_at FROM public.hr_role_attestation_drafts
     WHERE id=p_role_id),
    'Scene-role draft acceptance'
  );

  SELECT convert_to(jsonb_build_object(
    'payloadType',d.payload_type,
    'payload',encode(d.payload_bytes,'base64'),
    'signatures',jsonb_build_array(jsonb_build_object(
      'keyid',d.key_id,
      'sig',encode(decode(repeat('00',64),'hex'),'base64')
    ))
  )::text,'UTF8') INTO STRICT envelope
  FROM public.hr_role_attestation_drafts AS d WHERE d.id=p_role_id;
  INSERT INTO public.hr_role_attestations(id,envelope_bytes)
  VALUES(p_role_id,envelope);
END;
$$;

\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000720',
  '91000000-0000-0000-0000-000000000721',
  '91000000-0000-0000-0000-000000000400','reviewed_profile',
  'admission_reviewer','91000000-0000-0000-0000-000000000022',
  '91000000-0000-0000-0000-000000000041',jsonb_build_object(
    'schemaVersion','historical-runtime-role-admission-review.v1',
    'role','admission_reviewer','decision','approved',
    'presentationAdmissionDigest',repeat('f',64),
    'presentationAdmissionId','91000000-0000-0000-0000-000000000705',
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('1',64),'documentReceipt',r.receipt_body
    )
  )
) FROM public.hr_object_receipts AS r
WHERE r.id='91000000-0000-0000-0000-000000000008';

WITH transform_subject AS (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-transform-review-subject.v1\n' ||
    public.hr_stable_canonical_json(jsonb_build_object(
      'presentationAdmissionDigest',repeat('f',64),
      'presentationAdmissionId','91000000-0000-0000-0000-000000000705',
      'runtimePackageContentDigest',repeat('a',64),
      'runtimePackageId','91000000-0000-0000-0000-000000000700',
      'schemaVersion','historical-runtime-transform-review-subject.v1',
      'spaceId','91000000-0000-0000-0000-000000000002',
      'transformArtifactDigest',:'transform_digest',
      'transformArtifactId','receipt-room-transform-v1',
      'transformArtifactRowId','91000000-0000-0000-0000-000000000701',
      'transformReviewId','91000000-0000-0000-0000-000000000710',
      'venueId','91000000-0000-0000-0000-000000000001'
    )), 'UTF8'), 'sha256'),'hex') AS subject_digest
), evidence AS (
  SELECT jsonb_build_object(
    'schemaVersion','historical-runtime-role-transform-review.v1',
    'role','transform_reviewer','decision','approved',
    'transformReviewSubjectDigest',t.subject_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('2',64),'documentReceipt',r.receipt_body
    )
  ) AS body
  FROM transform_subject AS t
  CROSS JOIN public.hr_object_receipts AS r
  WHERE r.id='91000000-0000-0000-0000-000000000008'
)
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000722',
  '91000000-0000-0000-0000-000000000723',
  '91000000-0000-0000-0000-000000000710','transform_review',
  'transform_reviewer','91000000-0000-0000-0000-000000000028',
  '91000000-0000-0000-0000-000000000045',e.body
) FROM evidence AS e;

INSERT INTO public.hr_transform_reviews(
  id,subject_kind,environment_id,environment_mode,environment_digest,
  scope_epoch_id,venue_id,venue_slug,space_id,space_slug,
  presentation_admission_id,presentation_admission_digest,runtime_package_id,
  runtime_package_content_digest,admission_decision,admission_reviewed_by,
  admission_reviewed_at,admission_member_count,transform_artifact_row_id,
  transform_artifact_id,transform_artifact_digest,transform_registered_by,
  transform_registered_at,transform_review_subject_digest,
  reviewer_attestation_id,reviewer_attestation_digest,reviewer_actor_id,
  reviewer_expires_at,decision,reviewed_at,expires_at,
  transform_review_digest,transform_review_body,created_at
) SELECT
  '91000000-0000-0000-0000-000000000710','transform_review',
  scope.environment_id,scope.environment_mode,scope.environment_digest,
  scope.id,scope.venue_id,'trades-hall',scope.space_id,'receipt-room',
  '91000000-0000-0000-0000-000000000705',repeat('f',64),
  '91000000-0000-0000-0000-000000000700',repeat('a',64),'approved',
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T19:05:00.000Z'::timestamptz,1,
  '91000000-0000-0000-0000-000000000701',
  'receipt-room-transform-v1',:'transform_digest',
  '91000000-0000-0000-0000-000000000023',
  '2026-08-20T18:50:00.000Z'::timestamptz,
  ra.bound_digest,ra.id,ra.attestation_digest,
  ra.actor_id,ra.expires_at,'approved',clock_timestamp(),ra.expires_at,
  repeat('0',64),'{}'::jsonb,clock_timestamp()
FROM public.hr_role_attestations AS ra
CROSS JOIN public.hr_scope_epochs AS scope
WHERE ra.id='91000000-0000-0000-0000-000000000722'
  AND scope.id='91000000-0000-0000-0000-000000000005';
COMMIT;

\connect :fixture_db postgres
SELECT 'subjects_roles_transform',
  (SELECT count(*) FROM public.hr_evidence_subjects
   WHERE id IN ('91000000-0000-0000-0000-000000000300',
                '91000000-0000-0000-0000-000000000400',
                '91000000-0000-0000-0000-000000000710')) AS subjects,
  (SELECT count(*) FROM public.hr_role_attestations
   WHERE id IN ('91000000-0000-0000-0000-000000000720',
                '91000000-0000-0000-0000-000000000722')) AS roles,
  (SELECT count(*) FROM public.hr_transform_reviews
   WHERE id='91000000-0000-0000-0000-000000000710') AS transform_reviews;

\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres

BEGIN;
WITH policy_clock AS (
  SELECT date_trunc('milliseconds',clock_timestamp()) AS registered_at
), policy_material AS (
  SELECT '91000000-0000-0000-0000-000000000620'::uuid AS id,
    'historical_runtime_twin_release_attestation'::text AS purpose,
    :'key_id'::text AS key_id, :'key_fingerprint'::text AS fingerprint,
    repeat('9',64) AS policy_digest,registered_at,
    registered_at AS effective_at,registered_at+interval '20 hours' AS expires_at
  FROM policy_clock
)
INSERT INTO public.runtime_execution_key_policies(
  id,purpose,algorithm,key_id,public_key_fingerprint,policy_digest,
  policy_body,registered_by,registered_at,effective_at,expires_at
)
SELECT id,purpose,'ed25519',key_id,fingerprint,policy_digest,
  jsonb_build_object(
    'schemaVersion','historical-runtime-execution-key-policy.v1',
    'policyId',id::text,'purpose',purpose,'algorithm','ed25519',
    'keyId',key_id,'publicKeyFingerprint',fingerprint,
    'policyDigest',policy_digest,
    'registeredBy','91000000-0000-0000-0000-000000000003',
    'registeredAt',public.hr_iso_utc_ms(registered_at),
    'effectiveAt',public.hr_iso_utc_ms(effective_at),
    'expiresAt',public.hr_iso_utc_ms(expires_at)
  ),'91000000-0000-0000-0000-000000000003',registered_at,effective_at,
  expires_at
FROM policy_material;

INSERT INTO public.reconstruction_releases(
  id,venue_slug,release_kind,release_digest,source_manifest_sha256,
  release_manifest_sha256,candidate_bucket,candidate_prefix,
  release_manifest_key,file_count,total_bytes,manifest_json,idempotency_key,
  request_digest,created_by,created_at
) VALUES (
  '91000000-0000-0000-0000-000000000600','trades-hall','venue_twin_v1',
  :'release_digest',:'source_sha256',:'release_sha256',
  'fixture-private','release/600','release/600/release-manifest.json',2,8975,
  convert_from(decode(:'release_b64','base64'),'UTF8')::jsonb,
  'fixture-release-600',
  encode(digest(convert_to('fixture-release-600','UTF8'),'sha256'),'hex'),
  '91000000-0000-0000-0000-000000000025',
  '2026-08-20T18:50:00.000Z'
);

INSERT INTO public.reconstruction_release_qa_runs(
  id,release_id,venue_slug,release_kind,qa_profile_version,
  qa_profile_digest,outcome,report_digest,report_key,report_json,created_at
) VALUES (
  '91000000-0000-0000-0000-000000000601',
  '91000000-0000-0000-0000-000000000600','trades-hall','venue_twin_v1',
  'fixture-exact-private-scene-v1',repeat('a',64),'passed',:'qa_digest',
  'release/600/qa.json',jsonb_build_object(
    'schemaVersion','fixture-reconstruction-qa.v1','outcome','passed',
    'releaseDigest',:'release_digest'
  ),'2026-08-20T18:55:00.000Z'
);

INSERT INTO public.reconstruction_release_reviews(
  id,release_id,qa_run_id,venue_slug,release_kind,reviewer_user_id,
  reviewer_authority,decision,target_exposure,release_digest,
  release_manifest_sha256,qa_report_digest,visual_evidence,
  transform_artifact_refs,scene_authority_refs,note,idempotency_key,
  request_digest,review_sequence,supersedes_review_id,reviewed_at
) VALUES (
  '91000000-0000-0000-0000-000000000610',
  '91000000-0000-0000-0000-000000000600',
  '91000000-0000-0000-0000-000000000601','trades-hall','venue_twin_v1',
  '91000000-0000-0000-0000-000000000027','platform_admin','approved',
  'public',:'release_digest',:'release_sha256',:'qa_digest',
  jsonb_build_array(jsonb_build_object(
    'label','Receipt Room exact overview',
    'objectKey','evidence/trades-hall/receipt-room.png',
    'sha256','52d3e3d4f2e5380af83fefcf5283c4febd81f8a524caa5cf128479cba1db521d'
  )),
  jsonb_build_array(jsonb_build_object(
    'artifactId','receipt-room-transform-v1',
    'artifactDigest',:'transform_digest'
  )),
  jsonb_build_array(jsonb_build_object(
    'artifactId','receipt-room-scene-map-v1',
    'artifactDigest',:'scene_artifact_digest'
  )),
  'Exact private release, transform, Scene authority, and raw evidence approved.',
  'fixture-release-review-610',:'review_digest',1,NULL,
  '2026-08-20T19:00:00.000Z'
);

INSERT INTO public.reconstruction_release_attestations(
  id,release_id,venue_slug,release_kind,attestation_type,release_digest,
  qa_report_digest,review_id,review_digest,key_id,public_key_fingerprint,
  statement_sha256,envelope_sha256,r2_key,idempotency_key,request_digest,
  verified_by,verified_at
) VALUES (
  '91000000-0000-0000-0000-000000000611',
  '91000000-0000-0000-0000-000000000600','trades-hall','venue_twin_v1',
  'in_toto_dsse_ed25519',:'release_digest',:'qa_digest',
  '91000000-0000-0000-0000-000000000610',:'review_digest',:'key_id',
  :'key_fingerprint',:'payload_sha256',:'envelope_sha256',
  'evidence/twin-envelope.dsse.json','fixture-release-attestation-611',
  encode(digest(convert_to('fixture-release-attestation-611','UTF8'),'sha256'),'hex'),
  '91000000-0000-0000-0000-000000000003',
  '2026-08-20T19:05:00.000Z'
);
COMMIT;

\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO public.hr_signing_key_authorities(
  id,environment_id,environment_mode,environment_digest,scope_epoch_id,
  venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
  key_policy_id,purpose,key_policy_digest,key_id,public_key_fingerprint,
  public_key_bytes,policy_effective_at,policy_expires_at,
  registrar_authority_digest,registrar_authority_body,verified_by,
  verified_at,expires_at
)
SELECT '91000000-0000-0000-0000-000000000621',s.environment_id,
  s.environment_mode,s.environment_digest,s.id,s.venue_id,s.space_id,s.epoch,
  s.epoch_digest,s.expires_at,p.id,p.purpose,p.policy_digest,p.key_id,
  p.public_key_fingerprint,decode(:'key_der_hex','hex'),p.effective_at,
  p.expires_at,repeat('0',64),'{}'::jsonb,
  '91000000-0000-0000-0000-000000000003',clock_timestamp(),p.expires_at
FROM public.hr_scope_epochs AS s
CROSS JOIN public.runtime_execution_key_policies AS p
WHERE s.id='91000000-0000-0000-0000-000000000005'
  AND p.id='91000000-0000-0000-0000-000000000620';

INSERT INTO public.hr_object_receipts(
  id,capability_id,receipt_role,storage_key_sha256,storage_version,
  storage_etag,file_name,mime_type,sha256,size_bytes,custodian_actor_id,
  custodian_membership_id,observed_by_actor_id,observed_by_membership_id,
  authenticated_read_request_digest,authenticated_read_response_digest,
  read_at,denial_request_digest,denial_response_digest,denial_status_code,
  denial_class,denial_get_request_digest,denial_get_response_digest,
  denial_get_status_code,denial_get_class,denial_probed_by,
  denial_prober_membership_id
) VALUES
  (
    '91000000-0000-0000-0000-000000000630',
    '91000000-0000-0000-0000-000000000006','evidence_document',
    encode(digest(convert_to('evidence/twin-envelope.dsse.json','UTF8'),'sha256'),'hex'),
    'twin-envelope-v1','twin-envelope-etag','twin-envelope.dsse.json',
    'application/json',:'envelope_sha256',(:'envelope_size')::bigint,
    '91000000-0000-0000-0000-000000000011',
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000012',
    '91000000-0000-0000-0000-000000000032',
    encode(digest(convert_to('env-auth-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('env-auth-response','UTF8'),'sha256'),'hex'),
    clock_timestamp(),
    encode(digest(convert_to('env-head-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('env-head-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden',
    encode(digest(convert_to('env-get-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('env-get-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden','91000000-0000-0000-0000-000000000013',
    '91000000-0000-0000-0000-000000000033'
  ),
  (
    '91000000-0000-0000-0000-000000000631',
    '91000000-0000-0000-0000-000000000006','scene',
    encode(digest(convert_to('evidence/receipt-room-scene-map.json','UTF8'),'sha256'),'hex'),
    'scene-map-v1','scene-map-etag','receipt-room-scene-map.json',
    'application/json',:'scene_sha256',(:'scene_size')::bigint,
    '91000000-0000-0000-0000-000000000011',
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000012',
    '91000000-0000-0000-0000-000000000032',
    encode(digest(convert_to('scene-auth-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('scene-auth-response','UTF8'),'sha256'),'hex'),
    clock_timestamp(),
    encode(digest(convert_to('scene-head-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('scene-head-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden',
    encode(digest(convert_to('scene-get-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('scene-get-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden','91000000-0000-0000-0000-000000000013',
    '91000000-0000-0000-0000-000000000033'
  ),
  (
    '91000000-0000-0000-0000-000000000632',
    '91000000-0000-0000-0000-000000000006','evidence_document',
    encode(digest(convert_to('release/600/release-manifest.json','UTF8'),'sha256'),'hex'),
    'release-manifest-v1','release-manifest-etag','release-manifest.json',
    'application/json',:'release_sha256',(:'release_size')::bigint,
    '91000000-0000-0000-0000-000000000011',
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000012',
    '91000000-0000-0000-0000-000000000032',
    encode(digest(convert_to('release-auth-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('release-auth-response','UTF8'),'sha256'),'hex'),
    clock_timestamp(),
    encode(digest(convert_to('release-head-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('release-head-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden',
    encode(digest(convert_to('release-get-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('release-get-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden','91000000-0000-0000-0000-000000000013',
    '91000000-0000-0000-0000-000000000033'
  ),
  (
    '91000000-0000-0000-0000-000000000633',
    '91000000-0000-0000-0000-000000000006','evidence_document',
    encode(digest(convert_to('release/600/manifest.json','UTF8'),'sha256'),'hex'),
    'source-twin-v1','source-twin-etag','manifest.json',
    'application/json',:'source_sha256',(:'source_size')::bigint,
    '91000000-0000-0000-0000-000000000011',
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000012',
    '91000000-0000-0000-0000-000000000032',
    encode(digest(convert_to('source-auth-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('source-auth-response','UTF8'),'sha256'),'hex'),
    clock_timestamp(),
    encode(digest(convert_to('source-head-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('source-head-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden',
    encode(digest(convert_to('source-get-request','UTF8'),'sha256'),'hex'),
    encode(digest(convert_to('source-get-response','UTF8'),'sha256'),'hex'),
    403,'access_forbidden','91000000-0000-0000-0000-000000000013',
    '91000000-0000-0000-0000-000000000033'
  );
COMMIT;

-- @phase local
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_wait_for_db_clock(scope.effective_at,'local Twin snapshot')
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';
INSERT INTO public.hr_authority_snapshots(
  id,attestation_id,subject_id,subject_kind,environment_id,
  environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
  actor_id,authentication_source,membership_id,workspace_id
)
SELECT
  '91000000-0000-0000-0000-000000000649',
  '91000000-0000-0000-0000-000000000650',
  '91000000-0000-0000-0000-000000000300','scene_validation',
  scope.environment_id,scope.environment_mode,scope.environment_digest,
  scope.id,scope.venue_id,scope.space_id,
  '91000000-0000-0000-0000-000000000024',
  'local_test_fixture',NULL,NULL
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';

INSERT INTO public.hr_twin_release_authorities(
  id,subject_id,environment_id,environment_mode,environment_digest,
  scope_epoch_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
  venue_id,space_id,space_slug,release_id,release_review_id,
  release_supersedes_review_id,release_attestation_id,authority_snapshot_id
)
SELECT
  '91000000-0000-0000-0000-000000000650',
  '91000000-0000-0000-0000-000000000300',
  scope.environment_id,scope.environment_mode,scope.environment_digest,
  scope.id,scope.epoch,scope.epoch_digest,scope.expires_at,
  scope.venue_id,scope.space_id,'receipt-room',
  '91000000-0000-0000-0000-000000000600',
  '91000000-0000-0000-0000-000000000610',NULL,
  '91000000-0000-0000-0000-000000000611',
  '91000000-0000-0000-0000-000000000649'
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';
COMMIT;

-- @fixture local-parser-insert-start
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier

BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
WITH member_material AS (
  SELECT jsonb_build_object(
    'admissionRightsDecision', admission."rights_decision",
    'admissionRightsEvidenceDigest', admission."rights_evidence_digest",
    'admissionRightsEvidenceRowId', admission."rights_evidence_row_id"::text,
    'admissionRightsReviewedAt',
      to_char(admission."rights_reviewed_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'admissionRightsReviewedBy', admission."rights_reviewed_by"::text,
    'assetVersionId', derivation."asset_version_id"::text,
    'authorityReference', :'authority_reference',
    'coveredRegionIds', jsonb_build_array('receipt-room-whole'),
    'derivationMemberReceiptDigest', derivation."output_receipt_digest",
    'derivationMemberReceiptExpiresAt',
      to_char(derivation."receipt_expires_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'derivationMemberStorageKeySha256', derivation."storage_key_sha256",
    'derivationOutputReceiptId', derivation."output_receipt_id"::text,
    'fileExt', derivation."file_ext",
    'fileName', derivation."file_name",
    'memberIndex', derivation."member_index",
    'mimeType', derivation."mime_type",
    'sha256', derivation."sha256",
    'sizeBytes', derivation."size_bytes"
  ) AS body
  FROM public."hr_derivation_members" AS derivation
  JOIN public."runtime_presentation_admission_members" AS admission
    ON admission."admission_id" =
      '91000000-0000-0000-0000-000000000705'
   AND admission."member_index" = derivation."member_index"
  WHERE derivation."derivation_id" =
    '91000000-0000-0000-0000-000000000200'
    AND derivation."member_index" = 0
), projection AS (
  SELECT
    jsonb_build_object(
      'ordering','source_twin_manifest_order',
      'projectionVersion','venviewer.scene-room-node-projection.v1',
      'roomTwinNodeIds',jsonb_build_array('scan_000'),
      'spaceSlug','receipt-room'
    ) AS room_projection,
    jsonb_build_array('receipt-room-whole') AS region_ids,
    jsonb_build_array('scan_000') AS twin_node_ids,
    jsonb_build_array(jsonb_build_object(
      'coveredTwinNodeIds',jsonb_build_array('scan_000'),
      'regionId','receipt-room-whole','regionIndex',0
    )) AS ordered_regions,
    jsonb_build_array('mesh/room.glb','manifest.json') AS release_paths,
    jsonb_build_array(member_material.body) AS ordered_members
  FROM member_material
), coverage AS (
  SELECT projection.*,
    jsonb_build_object(
      'coveredTwinNodeIds', projection.twin_node_ids,
      'expectedTwinNodeIds', projection.twin_node_ids,
      'orderedMembers', jsonb_build_array(jsonb_build_object(
        'assetVersionId', member.body->>'assetVersionId',
        'authorityReference', member.body->>'authorityReference',
        'coveredRegionIds', member.body->'coveredRegionIds',
        'derivationMemberReceiptDigest',
          member.body->>'derivationMemberReceiptDigest',
        'derivationMemberStorageKeySha256',
          member.body->>'derivationMemberStorageKeySha256',
        'derivationOutputReceiptId',
          member.body->>'derivationOutputReceiptId',
        'memberIndex', (member.body->>'memberIndex')::integer::text
      )),
      'orderedRegions', jsonb_build_array(jsonb_build_object(
        'coveredTwinNodeIds',jsonb_build_array('scan_000'),
        'regionId','receipt-room-whole','regionIndex','0'
      )),
      'referencedReleasePaths', projection.release_paths,
      'wholeRegionIds', projection.region_ids
    ) AS digest_material
  FROM projection
  CROSS JOIN LATERAL jsonb_array_elements(projection.ordered_members)
    AS member(body)
)
INSERT INTO public."hr_scene_map_parser_receipts"(
  "id","scene_validation_id","presentation_admission_id",
  "presentation_admission_reviewer_attestation_id","derivation_id",
  "transform_review_id","twin_release_authority_id",
  "scene_object_receipt_id","release_manifest_object_receipt_id",
  "source_twin_object_receipt_id","scene_map_bytes",
  "release_manifest_bytes","source_twin_manifest_bytes",
  "verification_profile","parser_policy_digest",
  "parser_implementation_manifest_digest","parser_runtime_identity_id",
  "parsed_map_digest","signed_transform_artifact_ref",
  "signed_scene_authority_map_ref","twin_payload_type","twin_key_id",
  "twin_public_key_fingerprint","twin_envelope_sha256",
  "twin_envelope_byte_length","twin_payload_sha256",
  "twin_payload_byte_length","twin_statement_sha256",
  "twin_predicate_digest","room_projection_body","whole_region_ids",
  "expected_twin_node_ids","covered_twin_node_ids","ordered_regions",
  "referenced_release_paths","ordered_members",
  "expanded_region_node_reference_count",
  "normalized_projection_byte_length","verified_coverage_digest"
)
SELECT
  '91000000-0000-0000-0000-000000000660',
  '91000000-0000-0000-0000-000000000300',
  '91000000-0000-0000-0000-000000000705',
  '91000000-0000-0000-0000-000000000720',
  '91000000-0000-0000-0000-000000000200',
  '91000000-0000-0000-0000-000000000710',
  '91000000-0000-0000-0000-000000000650',
  '91000000-0000-0000-0000-000000000631',
  '91000000-0000-0000-0000-000000000632',
  '91000000-0000-0000-0000-000000000633',
  decode(:'scene_b64','base64'),decode(:'release_b64','base64'),
  decode(:'source_b64','base64'),'local_test_fixture',
  'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1',
  '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17',
  NULL,:'parsed_map_digest',
  jsonb_build_object(
    'artifactId','receipt-room-transform-v1',
    'artifactDigest',:'transform_digest'
  ),
  jsonb_build_object(
    'artifactId','receipt-room-scene-map-v1',
    'artifactDigest',:'scene_artifact_digest'
  ),
  'application/vnd.in-toto+json',:'key_id',:'key_fingerprint',
  :'envelope_sha256',(:'envelope_size')::bigint,:'payload_sha256',
  (:'payload_size')::bigint,:'payload_sha256',:'predicate_digest',
  coverage.room_projection,coverage.region_ids,coverage.twin_node_ids,
  coverage.twin_node_ids,coverage.ordered_regions,coverage.release_paths,
  coverage.ordered_members,1,(:'projection_size')::bigint,
  encode(digest(convert_to(
    E'venviewer.historical-runtime-verified-scene-map-coverage.v1\n'
      || public."hr_stable_canonical_json"(coverage.digest_material),
    'UTF8'
  ),'sha256'),'hex')
FROM coverage;
COMMIT;
-- @fixture local-parser-insert-end

\connect :fixture_db postgres
SELECT 'local_parser_leaf' AS checkpoint,id,verification_profile,
  parser_runtime_identity_id,scene_map_verification_receipt_digest,
  verified_at,expires_at
FROM public.hr_scene_map_parser_receipts
WHERE id='91000000-0000-0000-0000-000000000660';

\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier

SET ROLE omnitwin_historical_evidence_verifier;
SELECT id AS handle_id
FROM public.hr_verified_scene_map_receipts
WHERE parser_receipt_id='91000000-0000-0000-0000-000000000660' \gset
RESET ROLE;

BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO public.hr_scene_validation_subjects(
  id,scene_map_verification_receipt_id,subject_body
) VALUES (
  '91000000-0000-0000-0000-000000000300',:'handle_id',
  jsonb_build_object(
    'coverage',jsonb_build_object('orderedMembers','[]'::jsonb),
    'callerGarbage',true
  )
);
COMMIT;

BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000734',
  '91000000-0000-0000-0000-000000000735',
  '91000000-0000-0000-0000-000000000300','scene_validation',
  'scene_reviewer','91000000-0000-0000-0000-000000000026',
  '91000000-0000-0000-0000-000000000044',jsonb_build_object(
    'schemaVersion','historical-runtime-role-scene-review.v1',
    'role','scene_reviewer','decision','approved',
    'sceneValidationSubjectDigest',subject.scene_validation_subject_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('3',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_scene_validation_subjects AS subject
CROSS JOIN public.hr_object_receipts AS document
WHERE subject.id='91000000-0000-0000-0000-000000000300'
  AND document.id='91000000-0000-0000-0000-000000000008';

INSERT INTO public.hr_scene_validations(
  id,reviewer_attestation_id,scene_validation_subject_digest
)
SELECT subject.id,'91000000-0000-0000-0000-000000000734',
  subject.scene_validation_subject_digest
FROM public.hr_scene_validation_subjects AS subject
WHERE subject.id='91000000-0000-0000-0000-000000000300';
COMMIT;

\connect :fixture_db postgres
SET ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_verified_scene_map_receipt_current(
  :'handle_id',subject.environment_id,subject.environment_mode,
  subject.environment_digest,subject.venue_id,subject.space_id,
  public.hr_wall_clock_ms()
) AS handle_expires_at,
public.hr_assert_scene_map_parser_receipt_current(
  receipt.id,subject.environment_id,subject.environment_mode,
  subject.environment_digest,subject.venue_id,subject.space_id,
  public.hr_wall_clock_ms()
) AS parser_expires_at
FROM public.hr_scene_validation_subjects AS subject
JOIN public.hr_scene_map_parser_receipts AS receipt
  ON receipt.id=subject.scene_map_parser_receipt_id
WHERE subject.id='91000000-0000-0000-0000-000000000300';
RESET ROLE;

SELECT 'local_scene_committed' AS checkpoint,
  receipt.id AS parser_receipt_id,handle.id AS handle_id,
  subject.id AS scene_subject_id,final.id AS scene_final_id,
  receipt.verification_profile,
  receipt.parser_runtime_identity_id IS NULL AS runtime_identity_absent,
  NOT (subject.subject_body ? 'callerGarbage') AS caller_staging_ignored,
  record.record_digest=final.scene_validation_digest AS exact_parent,
  record.created_at=final.created_at AS exact_parent_time
FROM public.hr_scene_map_parser_receipts AS receipt
JOIN public.hr_verified_scene_map_receipts AS handle
  ON handle.parser_receipt_id=receipt.id
JOIN public.hr_scene_validation_subjects AS subject
  ON subject.scene_map_verification_receipt_id=handle.id
JOIN public.hr_scene_validations AS final ON final.id=subject.id
JOIN public.hr_evidence_records AS record ON record.id=final.id
WHERE receipt.id='91000000-0000-0000-0000-000000000660';

-- @phase production
\set ON_ERROR_STOP on
\set VERBOSITY verbose

-- Diagnostic only: establishes the production verified-Twin prerequisite with
-- distinct gateway, API, and isolated verifier LOGIN principals. It does not
-- provision a parser runtime identity.
\connect :fixture_db venviewer_prod_fixture_gateway
BEGIN;
SET LOCAL ROLE omnitwin_historical_auth_gateway;
SELECT (
  public.hr_issue_high_assurance_authenticated_action_assertion(
    '91000000-0000-0000-0000-000000000642',
    'twin_release_authority_approval',jsonb_build_object(
      'authorityId','91000000-0000-0000-0000-000000000652',
      'envelopeReceiptId','91000000-0000-0000-0000-000000000630',
      'expiresAt',to_char(
        (clock_timestamp()+interval '30 minutes') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'releaseAttestationId','91000000-0000-0000-0000-000000000611',
      'releaseId','91000000-0000-0000-0000-000000000600',
      'releaseReviewId','91000000-0000-0000-0000-000000000610',
      'sceneValidationId','91000000-0000-0000-0000-000000000300',
      'signingKeyAuthorityId','91000000-0000-0000-0000-000000000621'
    ),'91000000-0000-0000-0000-000000000005',
    '91000000-0000-0000-0000-000000000024','clerk_session',
    'clerk_twin_approver','fixture-production-twin-approval-session',
    'venviewer_historical_runtime_evidence',
    clock_timestamp()-interval '1 minute',
    clock_timestamp()+interval '30 minutes',NULL,NULL
  )
).id AS assertion_id \gset
COMMIT;

\connect :fixture_db venviewer_prod_fixture_api
BEGIN;
SET LOCAL ROLE omnitwin_api_activation;
SELECT (
  public.hr_authorize_verified_twin_release_authority(:'assertion_id')
).id AS action_snapshot_id \gset
COMMIT;

\connect :fixture_db venviewer_prod_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO public.hr_verified_twin_release_authorities(
  id,subject_id,release_id,release_review_id,release_attestation_id,
  envelope_receipt_id,signing_key_authority_id,
  approval_authority_snapshot_id,envelope_bytes
) VALUES (
  '91000000-0000-0000-0000-000000000652',
  '91000000-0000-0000-0000-000000000300',
  '91000000-0000-0000-0000-000000000600',
  '91000000-0000-0000-0000-000000000610',
  '91000000-0000-0000-0000-000000000611',
  '91000000-0000-0000-0000-000000000630',
  '91000000-0000-0000-0000-000000000621',:'action_snapshot_id',
  decode(:'envelope_b64','base64')
);
COMMIT;

\connect :fixture_db postgres
SELECT 'production_verified_twin_committed' AS checkpoint,
  twin.id,twin.verified_by_database_principal,twin.envelope_sha256,
  twin.payload_sha256,twin.approval_actor_id,
  twin.twin_release_authority_digest,twin.expires_at,
  record.record_digest=twin.twin_release_authority_digest AS exact_parent,
  record.created_at=twin.created_at AS exact_parent_time
FROM public.hr_verified_twin_release_authorities AS twin
JOIN public.hr_evidence_records AS record ON record.id=twin.id
WHERE twin.id='91000000-0000-0000-0000-000000000652';

\set ON_ERROR_STOP on
\set VERBOSITY verbose

-- Production fail-closed gate. Every Scene byte/projection/Twin input is an
-- exact raw-verifier output or is rehydrated from the exact production graph.
-- Runtime identity is deliberately unprovisioned: 0066 must reject the named
-- non-existent identity before any parser or Scene row exists.
\connect :fixture_db venviewer_prod_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
WITH member_material AS (
  SELECT jsonb_build_object(
    'admissionRightsDecision', admission."rights_decision",
    'admissionRightsEvidenceDigest', admission."rights_evidence_digest",
    'admissionRightsEvidenceRowId', admission."rights_evidence_row_id"::text,
    'admissionRightsReviewedAt',
      to_char(admission."rights_reviewed_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'admissionRightsReviewedBy', admission."rights_reviewed_by"::text,
    'assetVersionId', derivation."asset_version_id"::text,
    'authorityReference', :'authority_reference',
    'coveredRegionIds', jsonb_build_array('receipt-room-whole'),
    'derivationMemberReceiptDigest', derivation."output_receipt_digest",
    'derivationMemberReceiptExpiresAt',
      to_char(derivation."receipt_expires_at" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'derivationMemberStorageKeySha256', derivation."storage_key_sha256",
    'derivationOutputReceiptId', derivation."output_receipt_id"::text,
    'fileExt', derivation."file_ext",
    'fileName', derivation."file_name",
    'memberIndex', derivation."member_index",
    'mimeType', derivation."mime_type",
    'sha256', derivation."sha256",
    'sizeBytes', derivation."size_bytes"
  ) AS body
  FROM public."hr_derivation_members" AS derivation
  JOIN public."runtime_presentation_admission_members" AS admission
    ON admission."admission_id" =
      '91000000-0000-0000-0000-000000000705'
   AND admission."member_index" = derivation."member_index"
  WHERE derivation."derivation_id" =
    '91000000-0000-0000-0000-000000000200'
    AND derivation."member_index" = 0
), projection AS (
  SELECT
    jsonb_build_object(
      'ordering','source_twin_manifest_order',
      'projectionVersion','venviewer.scene-room-node-projection.v1',
      'roomTwinNodeIds',jsonb_build_array('scan_000'),
      'spaceSlug','receipt-room'
    ) AS room_projection,
    jsonb_build_array('receipt-room-whole') AS region_ids,
    jsonb_build_array('scan_000') AS twin_node_ids,
    jsonb_build_array(jsonb_build_object(
      'coveredTwinNodeIds',jsonb_build_array('scan_000'),
      'regionId','receipt-room-whole','regionIndex',0
    )) AS ordered_regions,
    jsonb_build_array('mesh/room.glb','manifest.json') AS release_paths,
    jsonb_build_array(member_material.body) AS ordered_members
  FROM member_material
), coverage AS (
  SELECT projection.*,
    jsonb_build_object(
      'coveredTwinNodeIds', projection.twin_node_ids,
      'expectedTwinNodeIds', projection.twin_node_ids,
      'orderedMembers', jsonb_build_array(jsonb_build_object(
        'assetVersionId', member.body->>'assetVersionId',
        'authorityReference', member.body->>'authorityReference',
        'coveredRegionIds', member.body->'coveredRegionIds',
        'derivationMemberReceiptDigest',
          member.body->>'derivationMemberReceiptDigest',
        'derivationMemberStorageKeySha256',
          member.body->>'derivationMemberStorageKeySha256',
        'derivationOutputReceiptId',
          member.body->>'derivationOutputReceiptId',
        'memberIndex', (member.body->>'memberIndex')::integer::text
      )),
      'orderedRegions', jsonb_build_array(jsonb_build_object(
        'coveredTwinNodeIds',jsonb_build_array('scan_000'),
        'regionId','receipt-room-whole','regionIndex','0'
      )),
      'referencedReleasePaths', projection.release_paths,
      'wholeRegionIds', projection.region_ids
    ) AS digest_material
  FROM projection
  CROSS JOIN LATERAL jsonb_array_elements(projection.ordered_members)
    AS member(body)
), twin AS (
  SELECT authority.*,
    encode(digest(convert_to(
      E'venviewer.historical-runtime-twin-release-predicate.v1\n'
        || public.hr_stable_canonical_json(
          authority.statement_body->'predicate'
        ),'UTF8'
    ),'sha256'),'hex') AS predicate_digest
  FROM public.hr_verified_twin_release_authorities AS authority
  WHERE authority.id='91000000-0000-0000-0000-000000000652'
)
INSERT INTO public.hr_scene_map_parser_receipts(
  id,scene_validation_id,presentation_admission_id,
  presentation_admission_reviewer_attestation_id,derivation_id,
  transform_review_id,twin_release_authority_id,
  scene_object_receipt_id,release_manifest_object_receipt_id,
  source_twin_object_receipt_id,scene_map_bytes,
  release_manifest_bytes,source_twin_manifest_bytes,
  verification_profile,parser_policy_digest,
  parser_implementation_manifest_digest,parser_runtime_identity_id,
  parsed_map_digest,signed_transform_artifact_ref,
  signed_scene_authority_map_ref,twin_payload_type,twin_key_id,
  twin_public_key_fingerprint,twin_envelope_sha256,
  twin_envelope_byte_length,twin_payload_sha256,
  twin_payload_byte_length,twin_statement_sha256,twin_predicate_digest,
  room_projection_body,whole_region_ids,expected_twin_node_ids,
  covered_twin_node_ids,ordered_regions,referenced_release_paths,
  ordered_members,expanded_region_node_reference_count,
  normalized_projection_byte_length,verified_coverage_digest
)
SELECT
  '91000000-0000-0000-0000-000000000661',
  '91000000-0000-0000-0000-000000000300',
  '91000000-0000-0000-0000-000000000705',
  '91000000-0000-0000-0000-000000000720',
  '91000000-0000-0000-0000-000000000200',
  '91000000-0000-0000-0000-000000000710',twin.id,
  '91000000-0000-0000-0000-000000000631',
  '91000000-0000-0000-0000-000000000632',
  '91000000-0000-0000-0000-000000000633',
  decode(:'scene_b64','base64'),decode(:'release_b64','base64'),
  decode(:'source_b64','base64'),'production_runtime',
  'f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1',
  '5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17',
  '91000000-0000-0000-0000-000000000669',
  :'parsed_map_digest',
  jsonb_build_object(
    'artifactId','receipt-room-transform-v1',
    'artifactDigest',:'transform_digest'
  ),
  jsonb_build_object(
    'artifactId','receipt-room-scene-map-v1',
    'artifactDigest',:'scene_artifact_digest'
  ),
  twin.payload_type,twin.key_id,twin.public_key_fingerprint,
  twin.envelope_sha256,twin.envelope_byte_length,twin.payload_sha256,
  twin.payload_byte_length,twin.payload_sha256,twin.predicate_digest,
  coverage.room_projection,coverage.region_ids,coverage.twin_node_ids,
  coverage.twin_node_ids,coverage.ordered_regions,coverage.release_paths,
  coverage.ordered_members,1,(:'projection_size')::bigint,
  encode(digest(convert_to(
    E'venviewer.historical-runtime-verified-scene-map-coverage.v1\n'
      || public.hr_stable_canonical_json(coverage.digest_material),
    'UTF8'
  ),'sha256'),'hex')
FROM coverage CROSS JOIN twin;
COMMIT;

-- @phase negative-seed
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier

BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;

-- Two DB-valid private receipts whose bytes match the accepted release/source
-- artifacts but whose purpose roles are intentionally wrong.
INSERT INTO public.hr_object_receipts(
  id,capability_id,receipt_role,storage_key_sha256,storage_version,
  storage_etag,file_name,mime_type,sha256,size_bytes,
  custodian_actor_id,custodian_membership_id,observed_by_actor_id,
  observed_by_membership_id,authenticated_read_request_digest,
  authenticated_read_response_digest,read_at,denial_request_digest,
  denial_response_digest,denial_status_code,denial_class,
  denial_get_request_digest,denial_get_response_digest,
  denial_get_status_code,denial_get_class,denial_probed_by,
  denial_prober_membership_id
)
SELECT
  replacement.id,source.capability_id,'supporting_metadata',
  replacement.storage_key_sha256,replacement.storage_version,
  replacement.storage_etag,source.file_name,source.mime_type,
  source.sha256,source.size_bytes,source.custodian_actor_id,
  source.custodian_membership_id,source.observed_by_actor_id,
  source.observed_by_membership_id,source.authenticated_read_request_digest,
  source.authenticated_read_response_digest,public.hr_wall_clock_ms(),
  source.denial_request_digest,source.denial_response_digest,
  source.denial_status_code,source.denial_class,
  source.denial_get_request_digest,source.denial_get_response_digest,
  source.denial_get_status_code,source.denial_get_class,
  source.denial_probed_by,source.denial_prober_membership_id
FROM (VALUES
  ('91000000-0000-0000-0000-000000000632'::uuid,
   '91000000-0000-0000-0000-000000000682'::uuid,repeat('d',64),
   'wrong-release-role-v1','wrong-release-role-etag'),
  ('91000000-0000-0000-0000-000000000633'::uuid,
   '91000000-0000-0000-0000-000000000683'::uuid,repeat('e',64),
   'wrong-source-role-v1','wrong-source-role-etag')
) AS replacement(source_id,id,storage_key_sha256,storage_version,storage_etag)
JOIN public.hr_object_receipts AS source ON source.id=replacement.source_id;

-- A current, DB-valid non-local provider in the same test scope, plus an
-- exact release-manifest receipt. local_test_fixture must reject the mixed
-- provider even though every underlying object/authority check is current.
INSERT INTO public.hr_provider_capabilities(
  id,environment_id,environment_mode,environment_digest,scope_epoch_id,
  venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
  provider_profile,provider_kind,version_kind,verification_mode,
  anonymous_head_request_digest,anonymous_head_response_digest,
  anonymous_head_status_code,anonymous_get_request_digest,
  anonymous_get_response_digest,anonymous_get_status_code,
  anonymous_denial_class,provider_account_sha256,
  endpoint_authority_sha256,private_bucket_sha256,
  test_object_storage_key_sha256,initial_write_digest,
  initial_read_digest,overwrite_digest,prior_version_reread_digest,verified_by
)
SELECT
  '91000000-0000-0000-0000-000000000606',environment_id,
  environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
  scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
  'runtime_private','s3','s3_version_id','provider_native_version',
  repeat('1',63)||'b',repeat('2',63)||'b',anonymous_head_status_code,
  repeat('3',63)||'b',repeat('4',63)||'b',anonymous_get_status_code,
  anonymous_denial_class,repeat('5',63)||'b',repeat('6',63)||'b',
  repeat('7',63)||'b',repeat('8',63)||'b',repeat('9',63)||'b',
  repeat('9',63)||'b',repeat('a',63)||'b',repeat('9',63)||'b',verified_by
FROM public.hr_provider_capabilities
WHERE id='91000000-0000-0000-0000-000000000006';

INSERT INTO public.hr_object_receipts(
  id,capability_id,receipt_role,storage_key_sha256,storage_version,
  storage_etag,file_name,mime_type,sha256,size_bytes,
  custodian_actor_id,custodian_membership_id,observed_by_actor_id,
  observed_by_membership_id,authenticated_read_request_digest,
  authenticated_read_response_digest,read_at,denial_request_digest,
  denial_response_digest,denial_status_code,denial_class,
  denial_get_request_digest,denial_get_response_digest,
  denial_get_status_code,denial_get_class,denial_probed_by,
  denial_prober_membership_id
)
SELECT
  '91000000-0000-0000-0000-000000000684',
  '91000000-0000-0000-0000-000000000606','evidence_document',
  repeat('f',64),'runtime-private-release-v1','runtime-private-release-etag',
  file_name,mime_type,sha256,size_bytes,custodian_actor_id,
  custodian_membership_id,observed_by_actor_id,observed_by_membership_id,
  authenticated_read_request_digest,authenticated_read_response_digest,
  public.hr_wall_clock_ms(),denial_request_digest,denial_response_digest,
  denial_status_code,denial_class,denial_get_request_digest,
  denial_get_response_digest,denial_get_status_code,denial_get_class,
  denial_probed_by,denial_prober_membership_id
FROM public.hr_object_receipts
WHERE id='91000000-0000-0000-0000-000000000632';

COMMIT;

\connect :fixture_db postgres
SELECT id,receipt_role,provider_profile
FROM public.hr_object_receipts
WHERE id IN (
  '91000000-0000-0000-0000-000000000682',
  '91000000-0000-0000-0000-000000000683',
  '91000000-0000-0000-0000-000000000684'
)
ORDER BY id;
