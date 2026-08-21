\set ON_ERROR_STOP on
\set VERBOSITY verbose

SELECT set_config('venviewer.fixture_migrator', :'migration_login', false);

DO $$
DECLARE
  expected_tables constant text[] := ARRAY[
    'hr_reviewed_profile_actors',
    'hr_reviewed_profile_members',
    'hr_reviewed_profile_subjects',
    'hr_reviewed_profiles'
  ];
  expected_functions constant text[] := ARRAY[
    'hr_assert_evidence_record_leaf_exact',
    'hr_assert_profile_graph_complete',
    'hr_assert_profile_package_custodian_current',
    'hr_assert_profile_qa_reviewer_current',
    'hr_assert_reviewed_profile_current',
    'hr_assert_reviewed_profile_subject_current',
    'hr_issue_reviewed_profile',
    'hr_issue_reviewed_profile_subject',
    'hr_populate_reviewed_profile_children',
    'hr_profile_graph_deferred_guard'
  ];
  expected_triggers constant text[] := ARRAY[
    'hr_reviewed_profile_actors.hr_profile_actor_graph_complete',
    'hr_reviewed_profile_actors.z_hr_reject_row_mutation',
    'hr_reviewed_profile_actors.z_hr_reject_truncate',
    'hr_reviewed_profile_members.hr_profile_member_graph_complete',
    'hr_reviewed_profile_members.z_hr_reject_row_mutation',
    'hr_reviewed_profile_members.z_hr_reject_truncate',
    'hr_reviewed_profile_subjects.a0_hr_require_profile_subject_verifier',
    'hr_reviewed_profile_subjects.b_hr_issue_reviewed_profile_subject',
    'hr_reviewed_profile_subjects.c_hr_populate_reviewed_profile_children',
    'hr_reviewed_profile_subjects.hr_profile_subject_graph_complete',
    'hr_reviewed_profile_subjects.z_hr_reject_row_mutation',
    'hr_reviewed_profile_subjects.z_hr_reject_truncate',
    'hr_reviewed_profiles.a0_hr_require_profile_final_verifier',
    'hr_reviewed_profiles.b_hr_issue_reviewed_profile',
    'hr_reviewed_profiles.hr_profile_final_graph_complete',
    'hr_reviewed_profiles.z_hr_reject_row_mutation',
    'hr_reviewed_profiles.z_hr_reject_truncate'
  ];
  migration_login text := current_setting('venviewer.fixture_migrator');
  privilege_name text;
  role_name text;
  table_name text;
BEGIN
  IF (
    SELECT array_agg(relation.relname::text ORDER BY relation.relname)
    FROM pg_catalog.pg_class AS relation
    WHERE relation.relnamespace='public'::regnamespace
      AND relation.relkind='r'
      AND relation.relname=ANY(expected_tables)
  ) IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION '0067 table inventory mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=relation.relowner
    WHERE relation.relnamespace='public'::regnamespace
      AND relation.relname=ANY(expected_tables)
      AND owner_role.rolname<>'omnitwin_historical_schema_owner'
  ) THEN
    RAISE EXCEPTION '0067 table owner closure failed';
  END IF;

  IF (
    SELECT array_agg(procedure.proname::text ORDER BY procedure.proname)
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
  ) IS DISTINCT FROM expected_functions THEN
    RAISE EXCEPTION '0067 function inventory mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=procedure.proowner
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
      AND (
        procedure.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
        OR CASE
          WHEN procedure.proname IN (
            'hr_assert_profile_graph_complete',
            'hr_assert_reviewed_profile_current'
          ) THEN owner_role.rolname<>'omnitwin_historical_schema_owner'
            OR procedure.prosecdef
          ELSE owner_role.rolname<>'omnitwin_historical_evidence_owner'
            OR NOT procedure.prosecdef
        END
      )
  ) THEN
    RAISE EXCEPTION '0067 function owner/security/search-path closure failed';
  END IF;

  IF (
    SELECT array_agg(
      relation.relname || '.' || trigger_row.tgname
      ORDER BY relation.relname,trigger_row.tgname
    )
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger_row.tgrelid
    WHERE NOT trigger_row.tgisinternal
      AND relation.relnamespace='public'::regnamespace
      AND relation.relname=ANY(expected_tables)
  ) IS DISTINCT FROM expected_triggers THEN
    RAISE EXCEPTION '0067 exact trigger inventory mismatch';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid='public.runtime_presentation_admissions'::regclass
         AND conname='hr_admissions_profile_leaf_unique' AND contype='u'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid='public.runtime_packages'::regclass
         AND conname='hr_runtime_packages_profile_leaf_unique' AND contype='u'
     ) THEN
    RAISE EXCEPTION '0067 exact legacy unique surfaces are absent';
  END IF;

  FOREACH table_name IN ARRAY expected_tables LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      FOREACH role_name IN ARRAY ARRAY[
        'public','omnitwin_api_activation',
        'omnitwin_historical_auth_gateway',migration_login
      ] LOOP
        IF has_table_privilege(
          role_name,format('public.%I',table_name),privilege_name
        ) THEN
          RAISE EXCEPTION '0067 forbidden %.% on %',
            role_name,privilege_name,table_name;
        END IF;
      END LOOP;
    END LOOP;

    IF NOT has_table_privilege(
         'omnitwin_historical_evidence_verifier',
         format('public.%I',table_name),'SELECT'
       ) OR has_table_privilege(
         'omnitwin_historical_evidence_verifier',
         format('public.%I',table_name),
         'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       ) OR NOT has_table_privilege(
         'omnitwin_historical_evidence_owner',
         format('public.%I',table_name),'SELECT'
       ) OR has_table_privilege(
         'omnitwin_historical_evidence_owner',
         format('public.%I',table_name),
         'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       ) THEN
      RAISE EXCEPTION '0067 capability read/mutation matrix drifted for %',
        table_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_reviewed_profile_subjects','INSERT'
     ) OR NOT has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_reviewed_profiles','INSERT'
     ) OR has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_reviewed_profile_actors','INSERT'
     ) OR has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_reviewed_profile_members','INSERT'
     ) OR NOT has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profile_actors','INSERT'
     ) OR NOT has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profile_members','INSERT'
     ) OR has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profile_subjects','INSERT'
     ) OR has_table_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profiles','INSERT'
     ) THEN
    RAISE EXCEPTION '0067 exact INSERT matrix drifted';
  END IF;

  IF NOT has_column_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profile_subjects','id','UPDATE'
     ) OR NOT has_column_privilege(
       'omnitwin_historical_evidence_owner',
       'public.hr_reviewed_profiles','id','UPDATE'
     ) OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_attribute AS attribute
         ON attribute.attrelid=relation.oid
        AND attribute.attnum>0 AND NOT attribute.attisdropped
       WHERE relation.relnamespace='public'::regnamespace
         AND relation.relname=ANY(expected_tables)
         AND has_column_privilege(
           'omnitwin_historical_evidence_owner',relation.oid,
           attribute.attnum,'UPDATE'
         )
         AND NOT (
           relation.relname IN (
             'hr_reviewed_profile_subjects','hr_reviewed_profiles'
           ) AND attribute.attname='id'
         )
     ) THEN
    RAISE EXCEPTION '0067 owner UPDATE(id)-only matrix drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
      AND (
        has_function_privilege('public',procedure.oid,'EXECUTE')
        OR has_function_privilege(
          'omnitwin_historical_evidence_verifier',procedure.oid,'EXECUTE'
        )
        OR has_function_privilege(
          'omnitwin_historical_auth_gateway',procedure.oid,'EXECUTE'
        )
        OR has_function_privilege(
          'omnitwin_api_activation',procedure.oid,'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION '0067 callable-function isolation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
      AND NOT has_function_privilege(
        'omnitwin_historical_evidence_owner',procedure.oid,'EXECUTE'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
      AND has_function_privilege(
        'omnitwin_historical_schema_owner',procedure.oid,'EXECUTE'
      ) <> (procedure.proname IN (
        'hr_assert_profile_graph_complete',
        'hr_assert_reviewed_profile_current'
      ))
  ) THEN
    RAISE EXCEPTION '0067 exact function EXECUTE matrix drifted';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'public','omnitwin_historical_schema_owner',
         'omnitwin_historical_evidence_owner',
         'omnitwin_historical_evidence_verifier',
         'omnitwin_historical_auth_gateway','omnitwin_api_activation',
         migration_login
       ]::text[]) AS checked(role_name)
       WHERE has_schema_privilege(checked.role_name,'public','CREATE')
     )
     OR pg_has_role(
       migration_login,'omnitwin_historical_schema_owner','MEMBER'
     )
     OR pg_has_role(
       migration_login,'omnitwin_historical_evidence_owner','MEMBER'
     ) THEN
    RAISE EXCEPTION '0067 migration principal external-finally closure failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname=ANY(expected_functions)
      AND procedure.prosrc ~
        'hr_execution|phase_layout|quarantine|legacy_activation|event_phases'
  ) THEN
    RAISE EXCEPTION '0067 profile-only function boundary drifted';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'functionCount',10,
  'status','historical-runtime-reviewed-profile-0067-catalog-ok',
  'tableCount',4,
  'triggerCount',17
)::text;
