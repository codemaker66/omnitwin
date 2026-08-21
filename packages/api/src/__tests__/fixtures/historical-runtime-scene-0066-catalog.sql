\set ON_ERROR_STOP on
\set VERBOSITY verbose

SELECT set_config('venviewer.fixture_migrator', :'migration_login', false);

DO $$
DECLARE
  expected_tables constant text[] := ARRAY[
    'hr_scene_map_parser_receipts',
    'hr_scene_member_regions',
    'hr_scene_parser_runtime_identities',
    'hr_scene_parser_runtime_identity_revocations',
    'hr_scene_validation_members',
    'hr_scene_validation_subjects',
    'hr_scene_validations',
    'hr_scene_whole_regions',
    'hr_verified_scene_map_receipts',
    'hr_verified_twin_release_authorities'
  ];
  table_name text;
  migration_login text := current_setting('venviewer.fixture_migrator');
  actual_count integer;
BEGIN
  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_class AS relation
  WHERE relation.relnamespace='public'::regnamespace
    AND relation.relkind='r'
    AND relation.relname=ANY(expected_tables);
  IF actual_count <> 10 THEN
    RAISE EXCEPTION '0066 catalog table inventory mismatch: %', actual_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=relation.relowner
    WHERE relation.relnamespace='public'::regnamespace
      AND relation.relname=ANY(expected_tables)
      AND owner_role.rolname<>'omnitwin_historical_schema_owner'
  ) THEN
    RAISE EXCEPTION '0066 table owner closure failed';
  END IF;

  FOREACH table_name IN ARRAY expected_tables LOOP
    IF has_table_privilege('public',format('public.%I',table_name),'SELECT')
       OR has_table_privilege('omnitwin_api_activation',
            format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('omnitwin_historical_auth_gateway',
            format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege(migration_login,
            format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES')
    THEN
      RAISE EXCEPTION '0066 table ACL closure failed for %', table_name;
    END IF;
  END LOOP;

  IF has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_scene_parser_runtime_identities','SELECT'
     ) OR has_table_privilege(
       'omnitwin_historical_evidence_verifier',
       'public.hr_scene_parser_runtime_identity_revocations','SELECT'
     ) THEN
    RAISE EXCEPTION 'verifier can read parser runtime identity authority';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger_row.tgrelid
    WHERE NOT trigger_row.tgisinternal
      AND relation.relnamespace='public'::regnamespace
      AND relation.relname=ANY(expected_tables)
  ) <> 37 THEN
    RAISE EXCEPTION '0066 trigger inventory mismatch';
  END IF;

  IF EXISTS (
    SELECT expected.table_name
    FROM unnest(expected_tables) AS expected(table_name)
    WHERE (
      SELECT count(*)
      FROM pg_catalog.pg_trigger AS trigger_row
      JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger_row.tgrelid
      WHERE NOT trigger_row.tgisinternal
        AND relation.relnamespace='public'::regnamespace
        AND relation.relname=expected.table_name
        AND trigger_row.tgname IN ('z_hr_reject_row_mutation','z_hr_reject_truncate')
        AND trigger_row.tgenabled='O'
    ) <> 2
  ) THEN
    RAISE EXCEPTION '0066 append-only trigger closure failed';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid='public.hr_scene_map_parser_receipts'::regclass
         AND contype='p' AND conname='hr_scene_map_parser_receipts_pkey'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid='public.hr_verified_scene_map_receipts'::regclass
         AND contype='p' AND conname='hr_verified_scene_map_receipts_pkey'
     ) THEN
    RAISE EXCEPTION '0066 parser/handle primary-key names drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace='public'::regnamespace
      AND procedure.proname LIKE 'hr\_%' ESCAPE '\'
      AND has_function_privilege('public',procedure.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute an hr function';
  END IF;

  IF has_schema_privilege(migration_login,'public','CREATE')
     OR pg_has_role(migration_login,'omnitwin_historical_schema_owner','MEMBER')
     OR pg_has_role(migration_login,'omnitwin_historical_evidence_owner','MEMBER')
  THEN
    RAISE EXCEPTION 'migration principal external-finally closure failed';
  END IF;

  IF (SELECT count(*) FROM public.hr_scene_parser_runtime_identities) <> 0
     OR (SELECT count(*) FROM public.hr_scene_parser_runtime_identity_revocations) <> 0
  THEN
    RAISE EXCEPTION '0066 unexpectedly provisioned production runtime identity';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'appendOnlyTriggerCount',(
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger_row.tgrelid
    WHERE NOT trigger_row.tgisinternal
      AND relation.relnamespace='public'::regnamespace
      AND relation.relname LIKE 'hr\_%' ESCAPE '\'
      AND trigger_row.tgname IN ('z_hr_reject_row_mutation','z_hr_reject_truncate')
  ),
  'runtimeIdentityCount',(
    SELECT count(*) FROM public.hr_scene_parser_runtime_identities
  ),
  'status','historical-runtime-scene-0066-catalog-ok'
)::text;
