-- Committed synthetic local_test_fixture graph extending the accepted 0066
-- parser-handle-Scene fixture. No row here is production evidence.

-- @phase profile-positive
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres

SELECT runtime_transform_artifact_digest AS transform_digest,
  scene_authority_map_digest AS scene_artifact_digest
FROM public.runtime_presentation_admissions
WHERE id='91000000-0000-0000-0000-000000000705' \gset

BEGIN;
INSERT INTO public.users(
  id,email,name,role,venue_id,clerk_id,platform_role
) VALUES
  ('91000000-0000-0000-0000-000000000029',
   'profile-package-custodian@example.test','Profile Package Custodian',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_package_custodian','none'),
  ('91000000-0000-0000-0000-000000000030',
   'profile-qa-reviewer@example.test','Profile QA Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_qa_reviewer','none'),
  ('91000000-0000-0000-0000-000000000031',
   'profile-transform-reviewer@example.test','Profile Transform Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_transform_reviewer','none'),
  ('91000000-0000-0000-0000-000000000032',
   'profile-scene-reviewer@example.test','Profile Scene Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_scene_reviewer','none'),
  ('91000000-0000-0000-0000-000000000033',
   'profile-admission-reviewer@example.test','Profile Admission Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_admission_reviewer','none'),
  ('91000000-0000-0000-0000-000000000034',
   'profile-final-reviewer@example.test','Profile Final Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_final_reviewer','none'),
  ('91000000-0000-0000-0000-000000000035',
   'profile-scene-admission@example.test','Profile Scene Admission Reviewer',
   'staff','91000000-0000-0000-0000-000000000001',
   'clerk_profile_scene_admission','none');
INSERT INTO public.workspace_memberships(
  id,workspace_id,user_id,email,role,venue_role,status,accepted_at
) VALUES
  ('91000000-0000-0000-0000-000000000046',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000029',
   'profile-package-custodian@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000047',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000030',
   'profile-qa-reviewer@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000048',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000031',
   'profile-transform-reviewer@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000049',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000032',
   'profile-scene-reviewer@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000050',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000033',
   'profile-admission-reviewer@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000051',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000034',
   'profile-final-reviewer@example.test','staff','staff','active',
   clock_timestamp()),
  ('91000000-0000-0000-0000-000000000052',
   '91000000-0000-0000-0000-000000000021',
   '91000000-0000-0000-0000-000000000035',
   'profile-scene-admission@example.test','staff','staff','active',
   clock_timestamp());

INSERT INTO public.runtime_qa_records (
  id,runtime_package_id,venue_slug,room_slug,record_id,record_json,
  signed_transform_artifact_id,public_exposure_decision,
  asset_evidence_status,runtime_status,reviewed_by,created_at,updated_at,
  record_digest,reviewed_at
) VALUES (
  '91000000-0000-0000-0000-000000000707',
  '91000000-0000-0000-0000-000000000700','trades-hall','receipt-room',
  'receipt-room-qa-v2',jsonb_build_object(
    'schemaVersion','runtime-qa-record.v0','recordId','receipt-room-qa-v2',
    'runtimePackageId','91000000-0000-0000-0000-000000000700',
    'venueSlug','trades-hall','roomSlug','receipt-room',
    'assetEvidenceStatus','machine_checked','runtimeStatus','internal_ready',
    'publicExposure',jsonb_build_object(
      'decision','approved_internal_preview'
    ),
    'viewTransform',jsonb_build_object(
      'signedTransformArtifactId','receipt-room-transform-v1'
    ),
    'recordedAt','2026-08-20T19:06:00.000Z'
  ),'receipt-room-transform-v1','approved_internal_preview',
  'machine_checked','internal_ready',
  '91000000-0000-0000-0000-000000000030',
  '2026-08-20T19:06:00.000Z','2026-08-20T19:06:00.000Z',
  repeat('8',64),'2026-08-20T19:06:00.000Z'
);

INSERT INTO public.runtime_presentation_admissions (
  id,runtime_package_id,runtime_package_content_digest,venue_slug,
  room_slug,runtime_manifest_digest,reviewed_profile_id,
  reviewed_profile_manifest_fingerprint,runtime_qa_record_id,
  runtime_qa_record_key,runtime_qa_record_digest,runtime_qa_decision,
  runtime_qa_reviewed_by,runtime_qa_reviewed_at,
  runtime_transform_artifact_row_id,runtime_transform_artifact_id,
  runtime_transform_artifact_digest,scene_authority_artifact_row_id,
  scene_authority_artifact_kind,scene_authority_artifact_id,
  scene_authority_map_digest,rights_evidence_digest,member_count,
  decision,admission_digest,admission_body,reviewed_by,reviewed_at,created_at
) VALUES (
  '91000000-0000-0000-0000-000000000706',
  '91000000-0000-0000-0000-000000000700',repeat('a',64),
  'trades-hall','receipt-room',repeat('d',64),'receipt-room-profile-v2',
  repeat('9',64),'91000000-0000-0000-0000-000000000707',
  'receipt-room-qa-v2',repeat('8',64),'approved_internal_preview',
  '91000000-0000-0000-0000-000000000030',
  '2026-08-20T19:06:00.000Z',
  '91000000-0000-0000-0000-000000000701',
  'receipt-room-transform-v1',:'transform_digest',
  '91000000-0000-0000-0000-000000000703','scene_authority_map_v0',
  'receipt-room-scene-map-v1',:'scene_artifact_digest',repeat('c',64),1,
  'approved',repeat('e',64),jsonb_build_object(
    'schemaVersion','runtime-presentation-admission.v1',
    'admissionId','91000000-0000-0000-0000-000000000706',
    'runtimePackageId','91000000-0000-0000-0000-000000000700',
    'runtimePackageContentDigest',repeat('a',64),
    'venueSlug','trades-hall','roomSlug','receipt-room',
    'runtimeManifestDigest',repeat('d',64),
    'reviewedProfileId','receipt-room-profile-v2',
    'reviewedProfileManifestFingerprint',repeat('9',64),
    'runtimeQaRecordId','91000000-0000-0000-0000-000000000707',
    'runtimeQaRecordKey','receipt-room-qa-v2',
    'runtimeQaRecordDigest',repeat('8',64),
    'runtimeQaDecision','approved_internal_preview',
    'runtimeQaReviewedBy','91000000-0000-0000-0000-000000000030',
    'runtimeQaReviewedAt','2026-08-20T19:06:00.000Z',
    'runtimeTransformArtifactRowId',
      '91000000-0000-0000-0000-000000000701',
    'runtimeTransformArtifactId','receipt-room-transform-v1',
    'runtimeTransformArtifactDigest',:'transform_digest',
    'sceneAuthorityArtifactRowId',
      '91000000-0000-0000-0000-000000000703',
    'sceneAuthorityArtifactKind','scene_authority_map_v0',
    'sceneAuthorityArtifactId','receipt-room-scene-map-v1',
    'sceneAuthorityMapDigest',:'scene_artifact_digest',
    'rightsEvidenceDigest',repeat('c',64),'memberCount',1,
    'decision','approved',
    'reviewedBy','91000000-0000-0000-0000-000000000033',
    'reviewedAt','2026-08-20T19:07:00.000Z'
  ),'91000000-0000-0000-0000-000000000033',
  '2026-08-20T19:07:00.000Z','2026-08-20T19:07:00.000Z'
);

INSERT INTO public.runtime_presentation_admission_members (
  admission_id,runtime_package_id,runtime_package_content_digest,
  venue_slug,room_slug,member_index,asset_version_id,file_name,file_ext,
  mime_type,sha256,size_bytes,storage_key_sha256,rights_evidence_row_id,
  rights_evidence_digest,rights_decision,rights_reviewed_by,rights_reviewed_at
) VALUES (
  '91000000-0000-0000-0000-000000000706',
  '91000000-0000-0000-0000-000000000700',repeat('a',64),
  'trades-hall','receipt-room',0,
  '91000000-0000-0000-0000-000000000202','derived.spz','.spz',
  'application/octet-stream',repeat('5',64),512,repeat('4',64),
  '91000000-0000-0000-0000-000000000704',repeat('c',64),'approved',
  '91000000-0000-0000-0000-000000000022',
  '2026-08-20T18:56:00.000Z'
);
COMMIT;

CREATE OR REPLACE FUNCTION public.fixture_assert_profile_qa_current(
  p_attestation_id uuid,p_profile_id uuid,p_admission_id uuid
)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.hr_assert_profile_qa_reviewer_current(
    p_attestation_id,p_profile_id,p_admission_id,scope.environment_id,
    scope.environment_mode,scope.environment_digest,scope.venue_id,
    scope.space_id,public.hr_wall_clock_ms()
  )
  FROM public.hr_scope_epochs AS scope
  WHERE scope.id='91000000-0000-0000-0000-000000000005'
$$;
ALTER FUNCTION public.fixture_assert_profile_qa_current(uuid,uuid,uuid)
  OWNER TO omnitwin_historical_evidence_owner;
REVOKE ALL ON FUNCTION
  public.fixture_assert_profile_qa_current(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.fixture_assert_profile_qa_current(uuid,uuid,uuid)
  TO omnitwin_historical_evidence_verifier;

CREATE OR REPLACE FUNCTION public.fixture_assert_profile_package_current(
  p_attestation_id uuid,p_profile_id uuid,p_admission_id uuid
)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.hr_assert_profile_package_custodian_current(
    p_attestation_id,p_profile_id,p_admission_id,scope.environment_id,
    scope.environment_mode,scope.environment_digest,scope.venue_id,
    scope.space_id,public.hr_wall_clock_ms()
  )
  FROM public.hr_scope_epochs AS scope
  WHERE scope.id='91000000-0000-0000-0000-000000000005'
$$;
ALTER FUNCTION public.fixture_assert_profile_package_current(uuid,uuid,uuid)
  OWNER TO omnitwin_historical_evidence_owner;
REVOKE ALL ON FUNCTION
  public.fixture_assert_profile_package_current(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.fixture_assert_profile_package_current(uuid,uuid,uuid)
  TO omnitwin_historical_evidence_verifier;

CREATE OR REPLACE FUNCTION public.fixture_assert_profile_admission_current(
  p_attestation_id uuid,p_admission_id uuid
)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT public.hr_assert_presentation_admission_reviewer_current(
    p_attestation_id,p_admission_id,scope.environment_id,
    scope.environment_mode,scope.environment_digest,scope.venue_id,
    scope.space_id,public.hr_wall_clock_ms()
  )
  FROM public.hr_scope_epochs AS scope
  WHERE scope.id='91000000-0000-0000-0000-000000000005'
$$;
ALTER FUNCTION public.fixture_assert_profile_admission_current(uuid,uuid)
  OWNER TO omnitwin_historical_evidence_owner;
REVOKE ALL ON FUNCTION
  public.fixture_assert_profile_admission_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.fixture_assert_profile_admission_current(uuid,uuid)
  TO omnitwin_historical_evidence_verifier;

\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
INSERT INTO public.hr_evidence_subjects(id,subject_kind,scope_epoch_id) VALUES
  ('91000000-0000-0000-0000-000000000301','scene_validation',
   '91000000-0000-0000-0000-000000000005'),
  ('91000000-0000-0000-0000-000000000401','reviewed_profile',
   '91000000-0000-0000-0000-000000000005'),
  ('91000000-0000-0000-0000-000000000711','transform_review',
   '91000000-0000-0000-0000-000000000005'),
  ('91000000-0000-0000-0000-000000000740','rights_clearance',
   '91000000-0000-0000-0000-000000000005');

SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000724',
  '91000000-0000-0000-0000-000000000725',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'admission_reviewer','91000000-0000-0000-0000-000000000033',
  '91000000-0000-0000-0000-000000000050',jsonb_build_object(
    'schemaVersion','historical-runtime-role-admission-review.v1',
    'role','admission_reviewer','decision','approved',
    'presentationAdmissionDigest',repeat('e',64),
    'presentationAdmissionId','91000000-0000-0000-0000-000000000706',
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('3',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_object_receipts AS document
WHERE document.id='91000000-0000-0000-0000-000000000008';

-- This valid but deliberately unused attestation has the same exact admission
-- evidence and a distinct actor. The negative phase below proves the profile
-- graph cannot substitute it into the Scene authority path.
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000752',
  '91000000-0000-0000-0000-000000000753',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'admission_reviewer','91000000-0000-0000-0000-000000000035',
  '91000000-0000-0000-0000-000000000052',jsonb_build_object(
    'schemaVersion','historical-runtime-role-admission-review.v1',
    'role','admission_reviewer','decision','approved',
    'presentationAdmissionDigest',repeat('e',64),
    'presentationAdmissionId','91000000-0000-0000-0000-000000000706',
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('3',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_object_receipts AS document
WHERE document.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000726',
  '91000000-0000-0000-0000-000000000727',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'admission_reviewer','91000000-0000-0000-0000-000000000033',
  '91000000-0000-0000-0000-000000000050',jsonb_build_object(
    'schemaVersion','historical-runtime-role-admission-review.v1',
    'role','admission_reviewer','decision','approved',
    'presentationAdmissionDigest',repeat('e',64),
    'presentationAdmissionId','91000000-0000-0000-0000-000000000706',
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('4',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_object_receipts AS document
WHERE document.id='91000000-0000-0000-0000-000000000008';

WITH transform_subject AS (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-transform-review-subject.v1\n'
      || public.hr_stable_canonical_json(jsonb_build_object(
        'presentationAdmissionDigest',repeat('e',64),
        'presentationAdmissionId','91000000-0000-0000-0000-000000000706',
        'runtimePackageContentDigest',repeat('a',64),
        'runtimePackageId','91000000-0000-0000-0000-000000000700',
        'schemaVersion','historical-runtime-transform-review-subject.v1',
        'spaceId','91000000-0000-0000-0000-000000000002',
        'transformArtifactDigest',:'transform_digest',
        'transformArtifactId','receipt-room-transform-v1',
        'transformArtifactRowId','91000000-0000-0000-0000-000000000701',
        'transformReviewId','91000000-0000-0000-0000-000000000711',
        'venueId','91000000-0000-0000-0000-000000000001'
      )),'UTF8'),'sha256'),'hex') AS subject_digest
), transform_evidence AS (
  SELECT jsonb_build_object(
    'schemaVersion','historical-runtime-role-transform-review.v1',
    'role','transform_reviewer','decision','approved',
    'transformReviewSubjectDigest',transform_subject.subject_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('5',64),'documentReceipt',document.receipt_body
    )
  ) AS body
  FROM transform_subject
  CROSS JOIN public.hr_object_receipts AS document
  WHERE document.id='91000000-0000-0000-0000-000000000008'
)
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000728',
  '91000000-0000-0000-0000-000000000729',
  '91000000-0000-0000-0000-000000000711','transform_review',
  'transform_reviewer','91000000-0000-0000-0000-000000000031',
  '91000000-0000-0000-0000-000000000048',transform_evidence.body
)
FROM transform_evidence;

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
)
SELECT
  '91000000-0000-0000-0000-000000000711','transform_review',
  scope.environment_id,scope.environment_mode,scope.environment_digest,
  scope.id,scope.venue_id,'trades-hall',scope.space_id,'receipt-room',
  '91000000-0000-0000-0000-000000000706',repeat('e',64),
  '91000000-0000-0000-0000-000000000700',repeat('a',64),'approved',
  '91000000-0000-0000-0000-000000000033',
  '2026-08-20T19:07:00.000Z'::timestamptz,1,
  '91000000-0000-0000-0000-000000000701',
  'receipt-room-transform-v1',:'transform_digest',
  '91000000-0000-0000-0000-000000000023',
  '2026-08-20T18:50:00.000Z'::timestamptz,
  role.bound_digest,role.id,role.attestation_digest,role.actor_id,
  role.expires_at,'approved',clock_timestamp(),role.expires_at,
  repeat('0',64),'{}'::jsonb,clock_timestamp()
FROM public.hr_role_attestations AS role
CROSS JOIN public.hr_scope_epochs AS scope
WHERE role.id='91000000-0000-0000-0000-000000000728'
  AND scope.id='91000000-0000-0000-0000-000000000005';

INSERT INTO public.hr_authority_snapshots(
  id,attestation_id,subject_id,subject_kind,environment_id,
  environment_mode,environment_digest,scope_epoch_id,venue_id,space_id,
  actor_id,authentication_source,membership_id,workspace_id
)
SELECT
  '91000000-0000-0000-0000-000000000652',
  '91000000-0000-0000-0000-000000000653',
  '91000000-0000-0000-0000-000000000301','scene_validation',
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
  '91000000-0000-0000-0000-000000000653',
  '91000000-0000-0000-0000-000000000301',
  scope.environment_id,scope.environment_mode,scope.environment_digest,
  scope.id,scope.epoch,scope.epoch_digest,scope.expires_at,
  scope.venue_id,scope.space_id,'receipt-room',
  '91000000-0000-0000-0000-000000000600',
  '91000000-0000-0000-0000-000000000610',NULL,
  '91000000-0000-0000-0000-000000000611',
  '91000000-0000-0000-0000-000000000652'
FROM public.hr_scope_epochs AS scope
WHERE scope.id='91000000-0000-0000-0000-000000000005';

INSERT INTO public.hr_scene_map_parser_receipts(
  id,scene_validation_id,presentation_admission_id,
  presentation_admission_reviewer_attestation_id,derivation_id,
  transform_review_id,twin_release_authority_id,scene_object_receipt_id,
  release_manifest_object_receipt_id,source_twin_object_receipt_id,
  scene_map_bytes,release_manifest_bytes,source_twin_manifest_bytes,
  verification_profile,parser_policy_digest,
  parser_implementation_manifest_digest,parser_runtime_identity_id,
  parsed_map_digest,signed_transform_artifact_ref,
  signed_scene_authority_map_ref,twin_payload_type,twin_key_id,
  twin_public_key_fingerprint,twin_envelope_sha256,
  twin_envelope_byte_length,twin_payload_sha256,twin_payload_byte_length,
  twin_statement_sha256,twin_predicate_digest,room_projection_body,
  whole_region_ids,expected_twin_node_ids,covered_twin_node_ids,
  ordered_regions,referenced_release_paths,ordered_members,
  expanded_region_node_reference_count,normalized_projection_byte_length,
  verified_coverage_digest
)
SELECT
  '91000000-0000-0000-0000-000000000661',
  '91000000-0000-0000-0000-000000000301',
  '91000000-0000-0000-0000-000000000706',
  '91000000-0000-0000-0000-000000000724',
  source.derivation_id,
  '91000000-0000-0000-0000-000000000711',
  '91000000-0000-0000-0000-000000000653',
  source.scene_object_receipt_id,source.release_manifest_object_receipt_id,
  source.source_twin_object_receipt_id,source.scene_map_bytes,
  source.release_manifest_bytes,source.source_twin_manifest_bytes,
  source.verification_profile,source.parser_policy_digest,
  source.parser_implementation_manifest_digest,NULL,
  source.parsed_map_digest,source.signed_transform_artifact_ref,
  source.signed_scene_authority_map_ref,source.twin_payload_type,
  source.twin_key_id,source.twin_public_key_fingerprint,
  source.twin_envelope_sha256,source.twin_envelope_byte_length,
  source.twin_payload_sha256,source.twin_payload_byte_length,
  source.twin_statement_sha256,source.twin_predicate_digest,
  source.room_projection_body,source.whole_region_ids,
  source.expected_twin_node_ids,source.covered_twin_node_ids,
  source.ordered_regions,source.referenced_release_paths,
  source.ordered_members,source.expanded_region_node_reference_count,
  source.normalized_projection_byte_length,source.verified_coverage_digest
FROM public.hr_scene_map_parser_receipts AS source
WHERE source.id='91000000-0000-0000-0000-000000000660';

SELECT handle.id AS profile_scene_handle_id
FROM public.hr_verified_scene_map_receipts AS handle
WHERE handle.parser_receipt_id=
  '91000000-0000-0000-0000-000000000661' \gset

INSERT INTO public.hr_scene_validation_subjects(
  id,scene_map_verification_receipt_id,subject_body
) VALUES (
  '91000000-0000-0000-0000-000000000301',
  :'profile_scene_handle_id',jsonb_build_object(
    'coverage',jsonb_build_object('orderedMembers','[]'::jsonb),
    'callerGarbage',true
  )
);

SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000736',
  '91000000-0000-0000-0000-000000000737',
  '91000000-0000-0000-0000-000000000301','scene_validation',
  'scene_reviewer','91000000-0000-0000-0000-000000000032',
  '91000000-0000-0000-0000-000000000049',jsonb_build_object(
    'schemaVersion','historical-runtime-role-scene-review.v1',
    'role','scene_reviewer','decision','approved',
    'sceneValidationSubjectDigest',subject.scene_validation_subject_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('6',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_scene_validation_subjects AS subject
CROSS JOIN public.hr_object_receipts AS document
WHERE subject.id='91000000-0000-0000-0000-000000000301'
  AND document.id='91000000-0000-0000-0000-000000000008';

INSERT INTO public.hr_scene_validations(
  id,reviewer_attestation_id,scene_validation_subject_digest
)
SELECT subject.id,'91000000-0000-0000-0000-000000000736',
  subject.scene_validation_subject_digest
FROM public.hr_scene_validation_subjects AS subject
WHERE subject.id='91000000-0000-0000-0000-000000000301';

SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000730',
  '91000000-0000-0000-0000-000000000731',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'package_custodian','91000000-0000-0000-0000-000000000029',
  '91000000-0000-0000-0000-000000000046',jsonb_build_object(
    'schemaVersion','historical-runtime-role-package-custodian.v1',
    'role','package_custodian',
    'runtimePackageContentDigest',admission.runtime_package_content_digest,
    'runtimeManifestDigest',admission.runtime_manifest_digest,
    'custodyDocument',jsonb_build_object(
      'scopeDigest',repeat('8',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';

SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000732',
  '91000000-0000-0000-0000-000000000733',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'qa_reviewer','91000000-0000-0000-0000-000000000030',
  '91000000-0000-0000-0000-000000000047',jsonb_build_object(
    'schemaVersion','historical-runtime-role-qa-review.v1',
    'role','qa_reviewer','decision',admission.runtime_qa_decision,
    'runtimeQaRecordId',admission.runtime_qa_record_id::text,
    'runtimeQaRecordDigest',admission.runtime_qa_record_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('9',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';

WITH rights_subject AS (
  SELECT jsonb_build_object(
    'assetVersionId',member.asset_version_id::text,
    'derivationEvidenceDigest',derivation.derivation_evidence_digest,
    'derivationId',derivation.id::text,
    'memberIndex',member.member_index,
    'outputReceiptDigest',derived.output_receipt_digest,
    'outputReceiptId',derived.output_receipt_id::text,
    'presentationAdmissionDigest',admission.admission_digest,
    'presentationAdmissionId',admission.id::text,
    'rightsClearanceId','91000000-0000-0000-0000-000000000740',
    'rightsDecision','approved',
    'rightsEvidenceDigest',member.rights_evidence_digest,
    'rightsEvidenceRowId',member.rights_evidence_row_id::text,
    'rightsReviewedAt',to_char(
      member.rights_reviewed_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'rightsReviewedBy',member.rights_reviewed_by::text,
    'schemaVersion','historical-runtime-rights-clearance-subject.v1',
    'spaceId',derivation.space_id::text,
    'venueId',derivation.venue_id::text
  ) AS body
  FROM public.runtime_presentation_admissions AS admission
  JOIN public.runtime_presentation_admission_members AS member
    ON member.admission_id=admission.id AND member.member_index=0
  JOIN public.hr_derivations AS derivation
    ON derivation.id='91000000-0000-0000-0000-000000000200'
  JOIN public.hr_derivation_members AS derived
    ON derived.derivation_id=derivation.id
   AND derived.member_index=member.member_index
  WHERE admission.id='91000000-0000-0000-0000-000000000706'
), rights_digest AS (
  SELECT encode(digest(convert_to(
    E'venviewer.historical-runtime-rights-clearance-subject.v1\n'
      || public.hr_stable_canonical_json(body),'UTF8'
  ),'sha256'),'hex') AS value
  FROM rights_subject
)
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000744',
  '91000000-0000-0000-0000-000000000745',
  '91000000-0000-0000-0000-000000000740','rights_clearance',
  'rights_reviewer','91000000-0000-0000-0000-000000000022',
  '91000000-0000-0000-0000-000000000041',jsonb_build_object(
    'schemaVersion','historical-runtime-role-rights-review.v1',
    'role','rights_reviewer','decision','approved',
    'rightsClearanceSubjectDigest',rights_digest.value,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('7',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM rights_digest
CROSS JOIN public.hr_object_receipts AS document
WHERE document.id='91000000-0000-0000-0000-000000000008';

INSERT INTO public.hr_rights_clearances(
  id,subject_kind,environment_id,environment_mode,environment_digest,
  scope_epoch_id,venue_id,venue_slug,space_id,space_slug,
  derivation_id,derivation_evidence_digest,derivation_expires_at,
  member_index,asset_version_id,file_name,file_ext,mime_type,sha256,size_bytes,
  output_receipt_id,output_receipt_digest,storage_key_sha256,
  output_receipt_expires_at,presentation_admission_id,
  presentation_admission_digest,runtime_package_id,
  runtime_package_content_digest,rights_evidence_row_id,
  rights_evidence_digest,rights_decision,rights_reviewed_by,
  rights_reviewed_at,rights_clearance_subject_digest,
  reviewer_attestation_id,reviewer_attestation_digest,reviewer_actor_id,
  reviewer_expires_at,effective_at,expires_at,rights_clearance_digest,
  rights_clearance_body
)
SELECT
  '91000000-0000-0000-0000-000000000740','rights_clearance',
  derivation.environment_id,derivation.environment_mode,
  derivation.environment_digest,derivation.scope_epoch_id,
  derivation.venue_id,'trades-hall',derivation.space_id,'receipt-room',
  derivation.id,derivation.derivation_evidence_digest,derivation.expires_at,
  member.member_index,member.asset_version_id,member.file_name,member.file_ext,
  member.mime_type,member.sha256,member.size_bytes,derived.output_receipt_id,
  derived.output_receipt_digest,derived.storage_key_sha256,
  derived.receipt_expires_at,admission.id,admission.admission_digest,
  admission.runtime_package_id,admission.runtime_package_content_digest,
  member.rights_evidence_row_id,member.rights_evidence_digest,
  member.rights_decision,member.rights_reviewed_by,member.rights_reviewed_at,
  repeat('0',64),role.id,role.attestation_digest,role.actor_id,role.expires_at,
  public.hr_db_clock_ms(),role.expires_at,repeat('0',64),'{}'::jsonb
FROM public.runtime_presentation_admissions AS admission
JOIN public.runtime_presentation_admission_members AS member
  ON member.admission_id=admission.id AND member.member_index=0
JOIN public.hr_derivations AS derivation
  ON derivation.id='91000000-0000-0000-0000-000000000200'
JOIN public.hr_derivation_members AS derived
  ON derived.derivation_id=derivation.id
 AND derived.member_index=member.member_index
JOIN public.hr_role_attestations AS role
  ON role.id='91000000-0000-0000-0000-000000000744'
WHERE admission.id='91000000-0000-0000-0000-000000000706';

INSERT INTO public.hr_reviewed_profile_subjects(
  id,reviewed_profile_id,presentation_admission_id,capture_clearance_id,
  derivation_id,transform_review_id,scene_validation_id,
  package_custodian_attestation_id,qa_reviewer_attestation_id,
  admission_reviewer_attestation_id,designated_final_reviewer_actor_id,
  subject_body
) VALUES (
  '91000000-0000-0000-0000-000000000401','receipt-room-profile-v2',
  '91000000-0000-0000-0000-000000000706',
  '91000000-0000-0000-0000-000000000180',
  '91000000-0000-0000-0000-000000000200',
  '91000000-0000-0000-0000-000000000711',
  '91000000-0000-0000-0000-000000000301',
  '91000000-0000-0000-0000-000000000730',
  '91000000-0000-0000-0000-000000000732',
  '91000000-0000-0000-0000-000000000726',
  '91000000-0000-0000-0000-000000000034',
  jsonb_build_object(
    'rightsClearanceIds',jsonb_build_array(
      '91000000-0000-0000-0000-000000000740'
    ),
    'callerGarbage',true
  )
);
COMMIT;

BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000738',
  '91000000-0000-0000-0000-000000000739',
  subject.id,'reviewed_profile','profile_final_reviewer',
  '91000000-0000-0000-0000-000000000034',
  '91000000-0000-0000-0000-000000000051',jsonb_build_object(
    'schemaVersion','historical-runtime-role-profile-final-review.v1',
    'role','profile_final_reviewer','decision','approved',
    'reviewedProfileSubjectDigest',subject.reviewed_profile_subject_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('a',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.hr_reviewed_profile_subjects AS subject
CROSS JOIN public.hr_object_receipts AS document
WHERE subject.id='91000000-0000-0000-0000-000000000401'
  AND document.id='91000000-0000-0000-0000-000000000008';

INSERT INTO public.hr_reviewed_profiles(
  id,final_reviewer_attestation_id,reviewed_profile_subject_digest
)
SELECT id,'91000000-0000-0000-0000-000000000738',
  reviewed_profile_subject_digest
FROM public.hr_reviewed_profile_subjects
WHERE id='91000000-0000-0000-0000-000000000401';
COMMIT;

\connect :fixture_db postgres
SET ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
RESET ROLE;

SELECT
  (SELECT count(*) FROM public.hr_reviewed_profile_subjects) AS subjects,
  (SELECT count(*) FROM public.hr_reviewed_profile_actors) AS actors,
  (SELECT count(*) FROM public.hr_reviewed_profile_members) AS members,
  (SELECT count(*) FROM public.hr_reviewed_profiles) AS finals,
  (SELECT count(*) FROM public.hr_rights_clearances
   WHERE id='91000000-0000-0000-0000-000000000740') AS rights,
  NOT EXISTS(
    SELECT 1 FROM public.hr_reviewed_profile_subjects
    WHERE subject_body ? 'callerGarbage'
  ) AS caller_staging_ignored;

-- @phase contradictory-qa
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000742',
  '91000000-0000-0000-0000-000000000743',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'qa_reviewer','91000000-0000-0000-0000-000000000030',
  '91000000-0000-0000-0000-000000000047',jsonb_build_object(
    'schemaVersion','historical-runtime-role-qa-review.v1',
    'role','qa_reviewer','decision',admission.runtime_qa_decision,
    'runtimeQaRecordId','91000000-0000-0000-0000-000000000799',
    'runtimeQaRecordDigest',admission.runtime_qa_record_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('b',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';
SELECT public.fixture_assert_profile_qa_current(
  '91000000-0000-0000-0000-000000000742',
  '91000000-0000-0000-0000-000000000401',
  '91000000-0000-0000-0000-000000000706'
);
COMMIT;

-- @phase contradictory-qa-decision
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000750',
  '91000000-0000-0000-0000-000000000751',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'qa_reviewer','91000000-0000-0000-0000-000000000030',
  '91000000-0000-0000-0000-000000000047',jsonb_build_object(
    'schemaVersion','historical-runtime-role-qa-review.v1',
    'role','qa_reviewer','decision','approved_public',
    'runtimeQaRecordId',admission.runtime_qa_record_id::text,
    'runtimeQaRecordDigest',admission.runtime_qa_record_digest,
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('e',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';
SELECT public.fixture_assert_profile_qa_current(
  '91000000-0000-0000-0000-000000000750',
  '91000000-0000-0000-0000-000000000401',
  '91000000-0000-0000-0000-000000000706'
);
COMMIT;

-- @phase contradictory-package
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000746',
  '91000000-0000-0000-0000-000000000747',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'package_custodian','91000000-0000-0000-0000-000000000029',
  '91000000-0000-0000-0000-000000000046',jsonb_build_object(
    'schemaVersion','historical-runtime-role-package-custodian.v1',
    'role','package_custodian',
    'runtimePackageContentDigest',repeat('1',64),
    'runtimeManifestDigest',admission.runtime_manifest_digest,
    'custodyDocument',jsonb_build_object(
      'scopeDigest',repeat('c',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';
SELECT public.fixture_assert_profile_package_current(
  '91000000-0000-0000-0000-000000000746',
  '91000000-0000-0000-0000-000000000401',
  '91000000-0000-0000-0000-000000000706'
);
COMMIT;

-- @phase contradictory-admission
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db venviewer_local_fixture_verifier
BEGIN;
SET LOCAL ROLE omnitwin_historical_evidence_verifier;
SELECT public.fixture_issue_scoped_role_prodpath(
  '91000000-0000-0000-0000-000000000748',
  '91000000-0000-0000-0000-000000000749',
  '91000000-0000-0000-0000-000000000401','reviewed_profile',
  'admission_reviewer','91000000-0000-0000-0000-000000000033',
  '91000000-0000-0000-0000-000000000050',jsonb_build_object(
    'schemaVersion','historical-runtime-role-admission-review.v1',
    'role','admission_reviewer','decision','approved',
    'presentationAdmissionDigest',admission.admission_digest,
    'presentationAdmissionId','91000000-0000-0000-0000-000000000799',
    'reviewDocument',jsonb_build_object(
      'scopeDigest',repeat('d',64),'documentReceipt',document.receipt_body
    )
  )
)
FROM public.runtime_presentation_admissions AS admission
CROSS JOIN public.hr_object_receipts AS document
WHERE admission.id='91000000-0000-0000-0000-000000000706'
  AND document.id='91000000-0000-0000-0000-000000000008';
SELECT public.fixture_assert_profile_admission_current(
  '91000000-0000-0000-0000-000000000748',
  '91000000-0000-0000-0000-000000000706'
);
COMMIT;

-- @phase currentness-qa-suspended
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
UPDATE public.workspace_memberships SET status='suspended'
WHERE id='91000000-0000-0000-0000-000000000047';
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase currentness-package-suspended
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
UPDATE public.workspace_memberships SET status='suspended'
WHERE id='91000000-0000-0000-0000-000000000046';
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase currentness-scene-suspended
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
UPDATE public.workspace_memberships SET status='suspended'
WHERE id='91000000-0000-0000-0000-000000000049';
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase contradictory-scene-admission-actor
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
ALTER TABLE public.hr_scene_validation_subjects
  DROP CONSTRAINT hr_scene_subjects_shape;
SET LOCAL session_replication_role=replica;
UPDATE public.hr_scene_validation_subjects
SET presentation_admission_reviewer_attestation_id=
      '91000000-0000-0000-0000-000000000752',
    presentation_admission_reviewer_actor_id=
      '91000000-0000-0000-0000-000000000035'
WHERE id='91000000-0000-0000-0000-000000000301';
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase currentness-profile-admission-attestation-expired
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
ALTER TABLE public.hr_role_attestations
  DROP CONSTRAINT hr_role_attestations_shape;
SET LOCAL session_replication_role=replica;
UPDATE public.hr_role_attestations
SET expires_at=public.hr_wall_clock_ms() - interval '1 millisecond'
WHERE id='91000000-0000-0000-0000-000000000726';
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase currentness-scene-admission-attestation-expired
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
ALTER TABLE public.hr_role_attestations
  DROP CONSTRAINT hr_role_attestations_shape;
SET LOCAL session_replication_role=replica;
UPDATE public.hr_role_attestations
SET expires_at=public.hr_wall_clock_ms() - interval '1 millisecond'
WHERE id='91000000-0000-0000-0000-000000000724';
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;

-- @phase currentness-final-suspended
\set ON_ERROR_STOP on
\set VERBOSITY verbose
\connect :fixture_db postgres
BEGIN;
UPDATE public.workspace_memberships SET status='suspended'
WHERE id='91000000-0000-0000-0000-000000000051';
SET LOCAL ROLE omnitwin_historical_evidence_owner;
SELECT public.hr_assert_reviewed_profile_current(
  profile.id,profile.reviewed_profile_evidence_digest,
  profile.environment_id,profile.environment_mode,profile.environment_digest,
  profile.venue_id,profile.space_id,public.hr_wall_clock_ms()
)
FROM public.hr_reviewed_profiles AS profile
WHERE profile.id='91000000-0000-0000-0000-000000000401';
COMMIT;
